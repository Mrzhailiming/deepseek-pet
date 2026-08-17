/**
 * 宠物自动喂食插件，浏览器半 —— 手写产物（无构建步骤）。
 *
 * 这个文件必须是 dsh Web 壳的模块表能吃下的格式：执行它只是向
 * window.__ModuleLoader__ 注册一个 CJS factory，真正的副作用（含样式注入）
 * 发生在 factory 被 materialize 的时候。banner / footer / intro 与
 * packages/client/tsdown.client.ts 生成的产物逐字一致，id 必须等于包名。
 *
 * factory 里只允许 require 平台模块（react / react-dom / @deepseek-ai/cordis /
 * dsh-client-ui-slots 等），本文件只用到 react。
 *
 * 数据来源：ctx.conversationEvents 的 Definition 接缝。match(event) 拿到的是
 * 原始 SessionEvent，于是三个喂食源分别是 user/message、带 usage 的
 * assistant/message、以及 tool/result。宿主→浏览器的事件转发白名单
 * (API_REMOTE_FORWARDED_EVENTS) 是编译期常量，加不了新事件，所以整套逻辑
 * （combo、宠物状态、特效）都下沉在浏览器里。
 */
window.__ModuleLoader__.load({
  id: "dsh-pet-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var ReactNs = require("react");
    var React = typeof ReactNs.createElement === "function" ? ReactNs : ReactNs.default;
    var h = React.createElement;

    //#region 配置

    /** 策划里的配置项默认值。浏览器 entry 不携带 cordis 的 config，所以这里是常量表。 */
    var DEFAULTS = {
      // pet.auto_feed.*
      enabled: true,
      comboWindowMs: 5000,
      maxCombo: 10,
      minFood: 1,
      maxFood: 30,
      // 对数曲线的起点尺度：约等于「第一份食物的 token 量」
      tokensPerFood: 60,
      // token 每翻一倍多给的食物份数
      foodPerDouble: 2.5,
      // 空闲时每分钟回升的饥饿度（0 = 关闭，退回策划的只降不升）
      hungerRegenPerMin: 2,
      // 本实现补充：主动喂食。Agent 不干活时也能自己喂，免得只能看着它饿
      manualFeedEnabled: true,
      // 一口零食顶多少饥饿（固定值，不走 token 曲线——手喂没有 token 可言）
      manualFeedFood: 15,
      // 一口零食给多少经验（0 = 不给）。1 exp / 45s 相对「一级 100 exp」可忽略
      manualFeedExp: 1,
      // 零食格数上限：攒满能一次把饿惨的宠物救回来
      manualSnackMax: 5,
      // 多久回一格零食（<= 0 视为永远满格）
      manualSnackRegenMs: 45000,
      // hunger 到这个值就算「饿了」，触发警告表现（红条 + 耷脸 + 按钮脉冲）
      hungryAt: 80,
      // pet.effects.*
      effectsEnabled: true,
      effectTtlMs: 2200,
      // 本实现补充：食物从会话区飞向宠物（false 则退回策划的就地飞入）
      flyFromConversation: true,
      // 本实现补充：只喂「刚发生」的事件，避免翻历史 / 重放时被历史日志刷屏
      freshnessMs: 30000,
      // 本实现补充：宠物进度落 localStorage（false = 每次刷新都从 Lv.1 重来）
      persist: true,
      // 合并写窗口：一轮工具循环里的连续喂食只写一次
      saveDebounceMs: 1500,
      // 离线饥饿最多按这么长时间结算（默认 24h），也顺手兜住系统时钟乱跳
      offlineRegenCapMs: 86400000,
      // 宠物外观：DeepSeek 二次元小鲸
      petName: "深深",
      petSpecies: "深海小鲸",
      // "whale" 用内联 SVG 画二次元鲸鱼；"emoji" 退回 petIcon 那个字形
      petAvatar: "whale",
      petIcon: "🐳"
    };

    /** localStorage 覆盖键：浏览器侧唯一的调参接缝（cordis config 到不了这一半）。 */
    var CONFIG_KEY = "dsh-pet-plugin/config";

    /**
     * 存档键。与配置分开两个键：配置是人手写的，这份是插件写的，
     * 清进度不该顺手把调参也清掉。
     */
    var STATE_KEY = "dsh-pet-plugin/state";

    /** 存档格式版本。对不上就当没存过——宁可从头养，也不读半懂的旧档。 */
    var STATE_VERSION = 1;

    /**
     * 读取用户覆盖并与默认值合并。只接受与默认值同类型的字段，其余静默忽略。
     * @returns 生效的配置对象。
     */
    function resolveConfig() {
      var config = Object.assign({}, DEFAULTS);
      var raw = null;
      try {
        raw = window.localStorage.getItem(CONFIG_KEY);
      } catch (error) {
        // 隐私模式 / 被禁用的 storage：用默认值，不吵。
        raw = null;
      }
      if (raw === null) return config;
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        console.warn("[dsh-pet-plugin] " + CONFIG_KEY + " 不是合法 JSON，已忽略");
        return config;
      }
      if (parsed === null || typeof parsed !== "object") return config;
      Object.keys(DEFAULTS).forEach(function (key) {
        var value = parsed[key];
        if (typeof value === typeof DEFAULTS[key]) config[key] = value;
      });
      return config;
    }

    /** 三个触发源的基础经验值。 */
    var BASE_EXP = { user_input: 1, generation: 2, tool_result: 3 };

    /**
     * 触发源 × 食物档位 → 图标。同一行从左到右是同一类食材的从小到大，
     * small 档保留三个源原本的 🥕/🐟/🍖，所以「看图标认触发源」这个特征不丢。
     */
    var FOOD_ICON = {
      user_input: { tiny: "🌱", small: "🥕", large: "🌽", feast: "🍉" },
      generation: { tiny: "🍤", small: "🐟", large: "🐠", feast: "🐋" },
      tool_result: { tiny: "🍢", small: "🍖", large: "🍗", feast: "🍲" }
    };

    /**
     * 主动喂食的图标。不进 FOOD_ICON：那张表按 token 量级分档，而零食是手喂的，
     * 没有 token 可言，永远是这一颗。
     */
    var SNACK_ICON = "🍬";

    /** 单级升级所需经验 = level × EXP_PER_LEVEL。 */
    var EXP_PER_LEVEL = 100;

    /** 跨形态档那一刻飘的图标。 */
    var EVOLVE_ICON = "✨";

    /**
     * 等级形态表：等级越高长得越大、颜色越深，而且**每一档换一处剪影**
     * （喷水柱 → 背鳍 → 王冠），所以一眼就能看出养到哪一档了。
     * `young` 那档就是加这个功能之前的长相。
     *
     * 放在常量区而不是视图区：store 也要用它判断「这一口有没有跨档」。
     * 后面几个字段是美术参数，只有 WhaleAvatar 读：
     *   size     头像边长（px）—— 体型直接改这个，34 到 64 差了将近两倍，
     *            远比缩 viewBox 看得出来；viewBox 四档都是 `0 0 64 64`，所以
     *            一个路径坐标都不用动。也不能走 transform：`.dshpet-whale-body`
     *            上挂着浮沉动画，往同一个节点写 transform 会被动画覆盖。
     *   skin     皮肤渐变的三个 stop（从上到下）。跨度刻意拉到「近乎白」到
     *            「近乎海军蓝」，四档摆在一起才分得清 —— 只调色相分不出来。
     *   eyeGrow  瞳孔缩放：幼崽眼睛大得夸张才有幼崽感。
     *   gold     描边换成金色并加粗（传说档）。
     * minLevel 从小到大排，whaleStageOf 从后往前找第一个够得上的。
     */
    var WHALE_STAGES = [
      {
        key: "baby", label: "幼崽", minLevel: 1,
        size: 34,
        skin: ["#e2ecff", "#b3c9ff", "#8aa4f0"],
        eyeGrow: 1.4, spout: false, dorsal: false, crown: false, gold: false
      },
      {
        key: "young", label: "少年", minLevel: 3,
        size: 44,
        skin: ["#8fabff", "#4d6bfe", "#2f4bd8"],
        eyeGrow: 1, spout: true, dorsal: false, crown: false, gold: false
      },
      {
        key: "adult", label: "成年", minLevel: 6,
        size: 54,
        skin: ["#6f8cff", "#2740c9", "#16226e"],
        eyeGrow: .92, spout: true, dorsal: true, crown: false, gold: false
      },
      {
        key: "legend", label: "传说", minLevel: 10,
        size: 64,
        skin: ["#5f7cff", "#1b2a8f", "#0b1240"],
        // 喷水口被王冠占了，所以传说档不喷水。
        eyeGrow: .92, spout: false, dorsal: true, crown: true, gold: true
      }
    ];

    /**
     * 等级 → 形态。等级上不封顶，所以最高档是「≥ minLevel」而不是一个区间。
     * @param level - 宠物等级（undefined 时落到最低档）。
     * @returns 形态描述对象。
     */
    function whaleStageOf(level) {
      var stage = WHALE_STAGES[0];
      for (var i = 1; i < WHALE_STAGES.length; i += 1) {
        if (level >= WHALE_STAGES[i].minLevel) stage = WHALE_STAGES[i];
      }
      return stage;
    }

    /**
     * 下一档形态，只给 tooltip 用（「还差几级」）。
     * @param level - 宠物等级。
     * @returns 下一档形态；已经是最高档则 null。
     */
    function whaleStageNextOf(level) {
      for (var i = 0; i < WHALE_STAGES.length; i += 1) {
        if (level < WHALE_STAGES[i].minLevel) return WHALE_STAGES[i];
      }
      return null;
    }

    //#endregion

    //#region 样式

    var STYLE_TAG_ID = "dsh-pet-plugin/overlay";

    var CSS = [
      /* 整层挂在 ui-layout 的 shell.overlay 里：默认穿透，只有宠物卡片吃指针事件。 */
      ".dshpet-root{position:absolute;right:20px;bottom:96px;z-index:40;pointer-events:none;",
      "display:flex;flex-direction:column;align-items:flex-end;gap:6px;",
      "font-family:inherit;-webkit-font-smoothing:antialiased}",

      ".dshpet-combo{padding:2px 10px;border-radius:999px;font-size:13px;font-weight:700;",
      "letter-spacing:.4px;line-height:18px}",
      ".dshpet-combo[data-tier=normal]{color:var(--dsw-alias-label-primary,#eaeaea);",
      "background:var(--dsw-alias-bg-layer-2,rgba(22,22,26,.72))}",
      ".dshpet-combo[data-tier=gold]{color:#ffd34d;background:rgba(255,196,0,.16);",
      "box-shadow:0 0 12px rgba(255,196,0,.45);animation:dshpet-shake-light 320ms ease-in-out}",
      ".dshpet-combo[data-tier=epic]{font-size:16px;color:transparent;",
      "background-image:linear-gradient(90deg,#ff5f6d,#ffc371,#47e6b1,#5b8cff,#c86dd7,#ff5f6d);",
      "background-size:200% 100%;-webkit-background-clip:text;background-clip:text;",
      "animation:dshpet-rainbow-shift 1.2s linear infinite,dshpet-shake-strong 320ms ease-in-out}",

      ".dshpet-stage{position:relative}",

      ".dshpet-card{pointer-events:auto;position:relative;display:flex;align-items:center;gap:10px;",
      "padding:8px 12px;border-radius:14px;cursor:pointer;user-select:none;",
      "color:var(--dsw-alias-label-primary,#eaeaea);",
      "background:var(--dsw-alias-bg-layer-2,rgba(22,22,26,.82));",
      "border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));",
      "box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.35))}",
      ".dshpet-card[data-tier=gold]{animation:dshpet-shake-light 320ms ease-in-out}",
      ".dshpet-card[data-tier=epic]{animation:dshpet-shake-strong 320ms ease-in-out}",

      ".dshpet-avatar{position:relative;font-size:30px;line-height:1}",
      ".dshpet-eating{animation:dshpet-eat-bounce 400ms ease-out}",

      /* 二次元鲸鱼：整只鲸是一张 44px 的内联 SVG，各部件靠 CSS 各自呼吸。
         SVG 里一律用 transform-box:fill-box + transform-origin:center，
         否则 transform 的原点是 viewBox 原点而不是部件自己。 */
      ".dshpet-whale{display:block;width:44px;height:44px;overflow:visible}",
      ".dshpet-whale *{transform-box:fill-box;transform-origin:center}",
      ".dshpet-whale-body{animation:dshpet-whale-bob 3.2s ease-in-out infinite}",
      ".dshpet-whale-tail{animation:dshpet-whale-wag 1.6s ease-in-out infinite;",
      "transform-origin:left center}",
      ".dshpet-whale-fin{animation:dshpet-whale-fin 2.4s ease-in-out infinite;",
      "transform-origin:top center}",
      ".dshpet-whale-eyes{animation:dshpet-whale-blink 5.2s ease-in-out infinite}",
      ".dshpet-whale-spout{animation:dshpet-whale-spout 2.6s ease-out infinite}",
      ".dshpet-whale-sparkle{animation:dshpet-whale-sparkle 1.1s ease-in-out infinite}",
      /* 进食那一刻：卡片给头像挂 .dshpet-eating，顺带让嘴张一下、腮红烧一下。 */
      ".dshpet-eating .dshpet-whale-mouth{animation:dshpet-whale-chew 400ms ease-out}",
      ".dshpet-eating .dshpet-whale-blush{animation:dshpet-whale-blush 620ms ease-out}",
      ".dshpet-halo{position:absolute;inset:-12px;border-radius:50%;pointer-events:none;",
      "background:radial-gradient(circle,rgba(255,214,102,.55),rgba(255,214,102,0) 70%);",
      "animation:dshpet-glow-pulse 900ms ease-in-out infinite}",
      /* 进阶那一刻头像外面炸开的一圈金环。both 收在透明态，所以特效撤掉
         之前它就已经看不见了，不会闪回。 */
      ".dshpet-evolve{position:absolute;inset:-14px;border-radius:50%;pointer-events:none;",
      "border:2px solid rgba(242,199,68,.9);",
      "animation:dshpet-evolve-ring 1400ms ease-out both}",

      ".dshpet-meta{display:flex;flex-direction:column;gap:3px;min-width:150px}",
      ".dshpet-name{font-size:12px;font-weight:600;line-height:16px}",
      ".dshpet-sub{font-size:11px;line-height:14px;color:var(--dsw-alias-label-secondary,#a9a9b2)}",
      /* token 面板：数字等宽，连击时一串数字跳动不会让整行左右晃。 */
      ".dshpet-tokens{white-space:nowrap;font-variant-numeric:tabular-nums}",
      ".dshpet-bar{height:4px;border-radius:2px;overflow:hidden;",
      "background:var(--dsw-alias-border-l2,rgba(255,255,255,.14))}",
      ".dshpet-bar>i{display:block;height:100%;border-radius:2px;transition:width 240ms ease-out}",
      ".dshpet-bar-full>i{background:#ff9f43}",
      ".dshpet-bar-exp>i{background:var(--dsw-alias-brand-primary,#4d6bfe)}",
      /* 饿了：饱食条转红 + 卡片边框告警。纯表现，宠物并不会真的饿死。 */
      ".dshpet-bar-full[data-low=true]>i{background:#ff5f6d}",
      ".dshpet-card[data-hungry=true]{border-color:rgba(255,95,109,.55);",
      "box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.35)),0 0 12px rgba(255,95,109,.28)}",

      /* 零食按钮：卡片的第三格，折叠时也在（折叠只藏 .dshpet-meta）。
         按钮不继承宿主字体，所以显式 font:inherit；.dshpet-root 是穿透的，
         所以这里要把指针事件收回来。 */
      ".dshpet-snack{pointer-events:auto;flex-shrink:0;display:flex;align-items:center;gap:3px;",
      "margin:0;padding:5px 7px;border-radius:10px;cursor:pointer;font:inherit;font-size:16px;",
      "line-height:1;color:inherit;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.08));",
      "border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));",
      "transition:background 160ms ease-out}",
      ".dshpet-snack:hover{background:rgba(255,255,255,.18)}",
      ".dshpet-snack:active{transform:scale(.94)}",
      ".dshpet-snack:disabled{opacity:.38;cursor:default;transform:none}",
      /* 攒着零食又饿着：晃一下提醒你点它。 */
      ".dshpet-snack[data-urge=true]{animation:dshpet-snack-urge 1.4s ease-in-out infinite}",
      ".dshpet-snack-n{font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;",
      "color:var(--dsw-alias-label-secondary,#a9a9b2)}",

      /* 特效层：贴在卡片上方，完全穿透。 */
      ".dshpet-fx{position:absolute;left:0;right:0;bottom:0;height:0;pointer-events:none}",
      ".dshpet-food{position:absolute;bottom:6px;font-size:22px;line-height:1;",
      "animation:dshpet-fly-in 600ms cubic-bezier(.22,1.3,.36,1) both}",
      /* 从会话区飞过来：起点是喂食时量出的视口位移 --dshpet-dx/dy。
         位移量走自定义属性，所以整段轨迹仍然只是一条 CSS 动画。 */
      ".dshpet-food[data-flight=across]{animation-name:dshpet-fly-across;",
      "filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))}",
      /* 食物大小 = 这一口的 token 量级（data-size 与 data-flight 正交：
         一个管字号，一个管轨迹）。feast 档额外给一圈暖光。 */
      ".dshpet-food[data-size=tiny]{font-size:16px}",
      ".dshpet-food[data-size=small]{font-size:22px}",
      ".dshpet-food[data-size=large]{font-size:30px}",
      /* 这条排在 across 之后，filter 会整条覆盖它，所以把投影也写回来。 */
      ".dshpet-food[data-size=feast]{font-size:38px;",
      "filter:drop-shadow(0 2px 6px rgba(0,0,0,.45)) ",
      "drop-shadow(0 0 10px rgba(255,214,102,.75))}",
      ".dshpet-float{position:absolute;bottom:26px;white-space:nowrap;font-size:13px;",
      "font-weight:700;line-height:16px;animation:dshpet-float-up 1200ms ease-out both;",
      "animation-delay:600ms}",
      ".dshpet-float[data-tier=normal]{color:#ffffff;text-shadow:0 1px 3px rgba(0,0,0,.55)}",
      ".dshpet-float[data-tier=gold]{color:#ffd34d;font-size:15px;",
      "text-shadow:0 0 10px rgba(255,196,0,.7)}",
      ".dshpet-float[data-tier=epic]{font-size:18px;color:transparent;",
      "background-image:linear-gradient(90deg,#ff5f6d,#ffc371,#47e6b1,#5b8cff,#c86dd7,#ff5f6d);",
      "background-size:200% 100%;-webkit-background-clip:text;background-clip:text;",
      "animation:dshpet-float-up 1200ms ease-out both,dshpet-rainbow-shift 1.2s linear infinite;",
      "animation-delay:600ms,0s}",

      /* 以下 keyframes 逐字取自策划的「前端 CSS 动画参考」，仅加前缀。 */
      "@keyframes dshpet-fly-in{",
      "0%{opacity:0;transform:translateY(40px) scale(.3)}",
      "60%{opacity:1;transform:translateY(-5px) scale(1.2)}",
      "100%{opacity:1;transform:translateY(0) scale(1)}}",
      "@keyframes dshpet-float-up{",
      "0%{opacity:0;transform:translateY(0)}",
      "30%{opacity:1;transform:translateY(-8px)}",
      "100%{opacity:0;transform:translateY(-30px)}}",
      "@keyframes dshpet-eat-bounce{",
      "0%,100%{transform:scale(1)}",
      "30%{transform:scale(1.15) rotate(-3deg)}",
      "60%{transform:scale(.95) rotate(2deg)}}",
      "@keyframes dshpet-rainbow-shift{",
      "0%{background-position:0% 50%}",
      "100%{background-position:200% 50%}}",
      "@keyframes dshpet-snack-urge{",
      "0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}",
      "@keyframes dshpet-glow-pulse{",
      "0%,100%{opacity:.6;transform:scale(1)}",
      "50%{opacity:1;transform:scale(1.1)}}",
      /* 策划的 fly-in 是「就地从下方飞入」；这条是它的跨屏版本，起点改成
         会话区里的实际位置，落点仍然是宠物。除起点外时序与 fly-in 一致。 */
      "@keyframes dshpet-fly-across{",
      "0%{opacity:0;transform:translate(var(--dshpet-dx,0px),var(--dshpet-dy,40px)) scale(.35)}",
      "12%{opacity:1}",
      "70%{transform:translate(0,-5px) scale(1.2)}",
      "100%{opacity:1;transform:translate(0,0) scale(1)}}",
      /* 策划写了「轻微震动」「强震」但没给 keyframes，这两条是本实现补的。 */
      "@keyframes dshpet-shake-light{",
      "0%,100%{transform:translateX(0)}25%{transform:translateX(-1.5px)}",
      "75%{transform:translateX(1.5px)}}",
      /* 鲸鱼的待机动作：浮沉、摆尾、划鳍、眨眼、喷水、闪光，以及进食时的
         张嘴 / 脸红。都是本实现补的，策划只规定了 eat-bounce。 */
      "@keyframes dshpet-whale-bob{",
      "0%,100%{transform:translateY(0) rotate(-1deg)}",
      "50%{transform:translateY(-1.6px) rotate(1deg)}}",
      "@keyframes dshpet-whale-wag{",
      "0%,100%{transform:rotate(-7deg)}50%{transform:rotate(9deg)}}",
      "@keyframes dshpet-whale-fin{",
      "0%,100%{transform:rotate(4deg)}50%{transform:rotate(-14deg)}}",
      "@keyframes dshpet-whale-blink{",
      "0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}",
      "@keyframes dshpet-whale-spout{",
      "0%{opacity:0;transform:translateY(3px) scale(.5)}",
      "35%{opacity:1;transform:translateY(-1px) scale(1)}",
      "100%{opacity:0;transform:translateY(-6px) scale(.7)}}",
      "@keyframes dshpet-whale-sparkle{",
      "0%,100%{opacity:.35;transform:scale(.7) rotate(0)}",
      "50%{opacity:1;transform:scale(1.15) rotate(45deg)}}",
      "@keyframes dshpet-whale-chew{",
      "0%,100%{transform:scaleY(1)}",
      "35%{transform:scaleY(2.1) translateY(.6px)}",
      "70%{transform:scaleY(.7)}}",
      "@keyframes dshpet-whale-blush{",
      "0%,100%{opacity:.5;transform:scale(1)}",
      "40%{opacity:.95;transform:scale(1.25)}}",
      "@keyframes dshpet-evolve-ring{",
      "0%{transform:scale(.6);opacity:1}",
      "100%{transform:scale(1.5);opacity:0}}",
      "@keyframes dshpet-shake-strong{",
      "0%,100%{transform:translate(0,0) rotate(0)}",
      "20%{transform:translate(-3px,1px) rotate(-.8deg)}",
      "40%{transform:translate(3px,-1px) rotate(.8deg)}",
      "60%{transform:translate(-2px,-1px) rotate(-.5deg)}",
      "80%{transform:translate(2px,1px) rotate(.5deg)}}",

      /* 降级：尊重系统的减少动效偏好。 */
      "@media (prefers-reduced-motion:reduce){",
      ".dshpet-food,.dshpet-float,.dshpet-eating,.dshpet-halo,.dshpet-evolve,",
      ".dshpet-snack[data-urge=true],",
      ".dshpet-combo[data-tier=gold],.dshpet-combo[data-tier=epic],",
      ".dshpet-card[data-tier=gold],.dshpet-card[data-tier=epic],",
      ".dshpet-whale-body,.dshpet-whale-tail,.dshpet-whale-fin,.dshpet-whale-eyes,",
      ".dshpet-whale-spout,.dshpet-whale-sparkle,",
      ".dshpet-eating .dshpet-whale-mouth,.dshpet-eating .dshpet-whale-blush",
      "{animation:none}",
      /* 喷水柱是靠动画才可见的，关动画后给它一个静态可见态。 */
      ".dshpet-whale-spout{opacity:1}}"
    ].join("");

    /** 注入一次样式表；与 tsdown 的 css-modules 内联插件同一个惯例。 */
    function installStyles() {
      if (typeof document === "undefined") return;
      var selector = "style[data-plugin-css=" + JSON.stringify(STYLE_TAG_ID) + "]";
      if (document.querySelector(selector) !== null) return;
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-pet-plugin";
      tag.dataset.pluginCss = STYLE_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    //#endregion

    //#region 纯逻辑

    /**
     * 夹取到闭区间。
     * @param value - 待夹取的值。
     * @param low - 下界。
     * @param high - 上界。
     * @returns 夹取结果。
     */
    function clamp(value, low, high) {
      return value < low ? low : value > high ? high : value;
    }

    /**
     * 取一个规规矩矩的整数：类型不对 / 非有限一律用兜底值，然后夹到区间里。
     * 存档里的每个数字都要过这一关。
     * @param value - 待清洗的值。
     * @param low - 下界。
     * @param high - 上界。
     * @param fallback - 类型不对时的兜底值。
     * @returns 清洗后的整数。
     */
    function numberIn(value, low, high, fallback) {
      if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
      return clamp(Math.floor(value), low, high);
    }

    /**
     * Combo 计数器（策划的 ComboTracker，可独立复用）。
     * @param config - 生效配置（读 comboWindowMs / maxCombo）。
     * @returns 计数器句柄。
     */
    function createComboTracker(config) {
      var count = 0;
      var lastTime = 0;
      return {
        /**
         * 记一次事件。
         * @param now - 事件时刻（epoch ms）。
         * @returns 记完之后的连击数。
         */
        tick: function (now) {
          if (now - lastTime > config.comboWindowMs) count = 0;
          count = Math.min(count + 1, config.maxCombo);
          lastTime = now;
          return count;
        },
        /** 归零（展示层超时后调用）。 */
        reset: function () {
          count = 0;
          lastTime = 0;
        }
      };
    }

    /**
     * 连击数 → 经验倍率。1 + 0.2 × count，count 已在 tick 里夹到 maxCombo，
     * 故上限 3.0x。只作用于经验：食物量若也乘这个倍率，×3.0 会盖过 token 量级
     * 本身的差别，所以食物那边改成加法加成（见 store.feed）。
     * @param count - 当前连击数。
     * @returns 倍率。
     */
    function multiplierOf(count) {
      return 1 + 0.2 * count;
    }

    /**
     * token 量级 → 食物量主项。
     *
     * 策划的 `tokens / tokensPerFood` 是线性的，配上 `[1, 15]` 的夹取等于把
     * token 量级抹平：1450 token 就顶格，之后 6KB 和 60KB 的工具结果一样大。
     * 这里换成对数曲线——token 每翻一倍多给 foodPerDouble 份——所以从几十
     * token 到几十万 token 全程都还能分得出大小。
     * @param tokens - 估算的 token 数。
     * @param config - 生效配置（读 tokensPerFood / foodPerDouble）。
     * @returns 食物量主项（未加连击加成、未夹取）。
     */
    function foodFromTokens(tokens, config) {
      var ratio = 1 + Math.max(0, tokens) / config.tokensPerFood;
      return Math.floor(config.foodPerDouble * Math.log2(ratio) + 0.5);
    }

    /**
     * token 量级 → 食物档位。阈值取曲线上 4 / 10 / 16 份的断点。
     * @param tokens - 估算的 token 数。
     * @returns "tiny" | "small" | "large" | "feast"。
     */
    function foodTierOf(tokens) {
      if (tokens >= 5000) return "feast";
      if (tokens >= 800) return "large";
      if (tokens >= 120) return "small";
      return "tiny";
    }

    /**
     * token 数 → 紧凑文本（999 / 1.2k / 12.3k / 1.2M），整千整万不留 ".0"。
     * @param tokens - token 数。
     * @returns 展示文本。
     */
    function formatTokens(tokens) {
      if (tokens < 1000) return String(tokens);
      // 阈值取 999950 而不是 1000000：再大一点点就会四舍五入成 "1000k"。
      var small = tokens < 999950;
      var unit = small ? "k" : "M";
      var scaled = tokens / (small ? 1000 : 1000000);
      // 1.0k → 1k：整数部分够读了，小数点只留给真的不整的数。
      var text = scaled.toFixed(1);
      if (text.slice(-2) === ".0") text = text.slice(0, -2);
      return text + unit;
    }

    /**
     * 连击数 → 视觉等级。
     * @param count - 当前连击数。
     * @returns "normal" | "gold" | "epic"。
     */
    function tierOf(count) {
      if (count >= 7) return "epic";
      if (count >= 4) return "gold";
      return "normal";
    }

    /**
     * 初始宠物状态。
     * @param config - 生效配置（读外观字段）。
     * @param saved - 存档里的进度数字；没有存档传 null。
     * @returns PetState。
     */
    function createPet(config, saved) {
      var pet = {
        name: config.petName,
        species: config.petSpecies,
        avatar: config.petAvatar,
        icon: config.petIcon,
        mood: 80,
        hunger: 60,
        energy: 75,
        exp: 0,
        level: 1
      };
      // 只继承进度数字：名字 / 种族 / 形象永远跟当前配置走。
      if (saved !== null && saved !== undefined) {
        pet.mood = saved.mood;
        pet.hunger = saved.hunger;
        pet.energy = saved.energy;
        pet.exp = saved.exp;
        pet.level = saved.level;
      }
      return pet;
    }

    /**
     * 喂一次食：hunger 下降、exp 累积、够了就升级。返回新对象（React 靠引用变化重渲染）。
     * @param pet - 当前宠物状态。
     * @param food - 本次食物量。
     * @param exp - 本次经验值。
     * @returns 喂食后的宠物状态。
     */
    function feedPet(pet, food, exp) {
      var next = {
        name: pet.name,
        species: pet.species,
        avatar: pet.avatar,
        icon: pet.icon,
        mood: pet.mood,
        hunger: Math.max(0, pet.hunger - food),
        energy: pet.energy,
        exp: pet.exp + exp,
        level: pet.level
      };
      while (next.exp >= next.level * EXP_PER_LEVEL) {
        next.exp -= next.level * EXP_PER_LEVEL;
        next.level += 1;
      }
      return next;
    }

    /**
     * 把 localStorage 里读出来的东西洗成一份能用的存档；任何一处不对就返回
     * null（= 当作没存过，从头养一只）。
     *
     * 这道关要挡住三种东西：手改坏的数据、旧版本的存档、以及同域下别人写的
     * 同名键。所以字段逐个查类型 + 夹范围，而不是 Object.assign 一把梭。
     * @param parsed - JSON.parse 出来的原始值。
     * @param config - 生效配置（零食格数的上限与兜底值要用它）。
     * @returns 清洗后的存档，或 null。
     */
    function sanitizeSaved(parsed, config) {
      if (parsed === null || typeof parsed !== "object") return null;
      if (parsed.v !== STATE_VERSION) return null;
      var pet = parsed.pet;
      if (pet === null || typeof pet !== "object") return null;
      var bySource = parsed.tokensBySource;
      if (bySource === null || typeof bySource !== "object") bySource = {};
      var level = numberIn(pet.level, 1, 9999, 1);
      return {
        savedAt: numberIn(parsed.savedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        pet: {
          hunger: numberIn(pet.hunger, 0, 100, 60),
          mood: numberIn(pet.mood, 0, 100, 80),
          energy: numberIn(pet.energy, 0, 100, 75),
          level: level,
          // exp 最多留一级的量：存档里的天文数字不该让 feedPet 的升级循环空转。
          exp: numberIn(pet.exp, 0, level * EXP_PER_LEVEL, 0)
        },
        totalFeeds: numberIn(parsed.totalFeeds, 0, 1e9, 0),
        totalTokens: numberIn(parsed.totalTokens, 0, 1e12, 0),
        // 兜底给满格：0.1.0 的存档没有这个字段，升级上来直接能喂，
        // 不用为「加了个字段」而让所有人从 Lv.1 重来。
        snacks: numberIn(parsed.snacks, 0, config.manualSnackMax, config.manualSnackMax),
        tokensBySource: {
          user_input: numberIn(bySource.user_input, 0, 1e12, 0),
          generation: numberIn(bySource.generation, 0, 1e12, 0),
          tool_result: numberIn(bySource.tool_result, 0, 1e12, 0)
        }
      };
    }

    /**
     * 读一次存档。关了持久化 / 读不到 / 读坏了都返回 null。
     * @param config - 生效配置（读 persist）。
     * @returns 清洗后的存档，或 null。
     */
    function loadSavedState(config) {
      if (!config.persist) return null;
      var raw = null;
      try {
        raw = window.localStorage.getItem(STATE_KEY);
      } catch (error) {
        // 隐私模式 / storage 被禁：当作新宠物，不吵。
        return null;
      }
      if (typeof raw !== "string") return null;
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        console.warn("[dsh-pet-plugin] " + STATE_KEY + " 不是合法 JSON，已当作新宠物");
        return null;
      }
      return sanitizeSaved(parsed, config);
    }

    /**
     * 存档写入器：合并写 + 退出补刀。
     *
     * 一轮工具循环每秒能喂好几次，每次都同步写 localStorage 太浪费，所以按
     * saveDebounceMs 合并；页面要走的时候立刻把最后一次写掉，免得丢掉最后
     * 几口。内容没变则一次都不写。
     * @param config - 生效配置（读 persist / saveDebounceMs）。
     * @param readState - 取当前状态快照的回调。
     * @returns 写入器句柄。
     */
    function createPersistence(config, readState) {
      var timer = 0;
      /** 上次写下去的内容指纹（不含 v / savedAt，否则永远判不出「没变」）。 */
      var lastBody = "";

      /** 立刻写一次；内容与上次相同就跳过。 */
      function write() {
        if (timer !== 0) {
          clearTimeout(timer);
          timer = 0;
        }
        var state = readState();
        var pet = state.pet;
        // 只存进度：effects / combo / eatKey 是转瞬即逝的展示态，
        // name / species / avatar 归配置管——改了 petName 不该被存档拽回去。
        var body = {
          pet: {
            hunger: pet.hunger,
            exp: pet.exp,
            level: pet.level,
            mood: pet.mood,
            energy: pet.energy
          },
          totalFeeds: state.totalFeeds,
          totalTokens: state.totalTokens,
          tokensBySource: state.tokensBySource,
          snacks: state.snacks
        };
        var fingerprint = JSON.stringify(body);
        if (fingerprint === lastBody) return;
        body.v = STATE_VERSION;
        body.savedAt = Date.now();
        try {
          window.localStorage.setItem(STATE_KEY, JSON.stringify(body));
          lastBody = fingerprint;
        } catch (error) {
          // 配额写满 / 隐私模式：宠物照样能玩，只是这一次没存下来。
        }
      }

      return {
        /** 安排一次合并写（窗口内的后续调用被并进同一次）。 */
        schedule: function () {
          if (!config.persist || timer !== 0) return;
          timer = setTimeout(function () {
            timer = 0;
            write();
          }, config.saveDebounceMs);
        },
        /** 立刻落盘（页面要走了 / 插件要卸了）。 */
        flush: function () {
          if (config.persist) write();
        },
        /** 停掉悬空的合并写定时器。 */
        dispose: function () {
          if (timer !== 0) clearTimeout(timer);
          timer = 0;
        }
      };
    }

    /** 找不到会话锚点时的退路：策划原本的「就地从下方飞入」。 */
    var LOCAL_FLIGHT = { dx: 0, dy: 40, across: false };

    /**
     * 量出「这口食物从哪儿飞过来」。
     *
     * 起点取会话滚动区（`[data-conversation-scroll]`，ui-conversation 的
     * ConversationRoot 挂的锚点，ChatView / StatsLine / InputBar 都在 closest
     * 它）底部——新消息、新工具结果都是在那儿冒出来的；终点取宠物头像中心。
     *
     * 两个矩形都是 getBoundingClientRect 的视口坐标，相减得到的是纯位移，
     * 所以可以直接喂给食物元素的 translate，不关心中间隔了几层定位上下文。
     * @param spread - 0~1 的横向散布系数，连击时避免叠成一条线。
     * @returns { dx, dy, across }；across 为 false 表示退回就地飞入。
     */
    function measureFlight(spread) {
      if (typeof document === "undefined" || typeof document.querySelector !== "function") {
        return LOCAL_FLIGHT;
      }
      var avatar = document.querySelector(".dshpet-avatar");
      var scroll = document.querySelector("[data-conversation-scroll]");
      if (avatar === null || scroll === null) return LOCAL_FLIGHT;
      if (typeof avatar.getBoundingClientRect !== "function") return LOCAL_FLIGHT;
      if (typeof scroll.getBoundingClientRect !== "function") return LOCAL_FLIGHT;
      var to = avatar.getBoundingClientRect();
      var from = scroll.getBoundingClientRect();
      // 会话区还没布局（宽高为 0）时量出来的位移没有意义。
      if (from.width <= 0 || from.height <= 0) return LOCAL_FLIGHT;
      var fromX = from.left + from.width * (0.34 + 0.32 * spread);
      var fromY = from.bottom - Math.min(120, from.height * 0.22);
      return {
        dx: Math.round(fromX - (to.left + to.width / 2)),
        dy: Math.round(fromY - (to.top + to.height / 2)),
        across: true
      };
    }

    /**
     * UTF-8 字节数（工具结果的 token 估算用）。
     * @param text - 任意字符串。
     * @returns 字节数；没有 TextEncoder 时退化为字符数。
     */
    function byteLengthOf(text) {
      if (typeof TextEncoder === "function") return new TextEncoder().encode(text).length;
      return text.length;
    }

    /**
     * 累计一组 content block 的可见文本长度。
     * @param content - ContentBlock 数组（可能缺失）。
     * @returns 字符数。
     */
    function textLengthOf(content) {
      if (!Array.isArray(content)) return 0;
      var total = 0;
      for (var i = 0; i < content.length; i += 1) {
        var block = content[i];
        if (block !== null && typeof block === "object" && typeof block.text === "string") {
          total += block.text.length;
        }
      }
      return total;
    }

    /**
     * 把一条原始 SessionEvent 归类成喂食源 + token 数；不是喂食源就返回 null。
     *
     * user/message 只认 source.kind === "user"（插件注入的上下文也是 user/message，
     * 那不是「用户输入」）；assistant/message 只在 adapter 报了 usage 时才算一次
     * generation，取 input + output 的全量消耗；tool/result 用结果字节数估算，
     * 至少 1 token。
     * @param event - 原始 session 事件。
     * @returns { source, tokens } 或 null。
     */
    function classify(event) {
      if (event.type === "user/message") {
        var message = event.data;
        if (message === null || typeof message !== "object") return null;
        var source = message.source;
        if (source === null || typeof source !== "object" || source.kind !== "user") return null;
        return { source: "user_input", tokens: Math.floor(textLengthOf(message.content) / 4) };
      }
      if (event.type === "assistant/message") {
        var usage = event.data === null ? undefined : event.data.usage;
        if (usage === null || typeof usage !== "object") return null;
        // outputTokens 缺失 = adapter 没报 usage，这一条不算一次 generation。
        if (typeof usage.outputTokens !== "number") return null;
        // 这一步真实的消耗是 input + output：上下文越长，喂的分量越大。
        var inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
        return { source: "generation", tokens: usage.outputTokens + inputTokens };
      }
      if (event.type === "tool/result") {
        var payload = event.data === null ? undefined : event.data.message;
        var content = payload === null || payload === undefined ? [] : payload.content;
        var bytes = 0;
        try {
          bytes = byteLengthOf(JSON.stringify(content));
        } catch (error) {
          // 循环引用之类：退化成最小喂食量而不是丢掉这次事件。
          bytes = 4;
        }
        return { source: "tool_result", tokens: Math.max(Math.floor(bytes / 4), 1) };
      }
      return null;
    }

    //#endregion

    //#region 状态源

    /**
     * 宠物 + 特效的可观察状态源。整个插件一份，Definition 写、overlay 组件读。
     * @param config - 生效配置。
     * @returns 状态源句柄。
     */
    function createPetStore(config) {
      var listeners = new Set();
      var combo = createComboTracker(config);
      var comboTimer = 0;
      var effectSeq = 0;
      /** 上次结算饥饿回升的时刻；0 表示还没结算过（第一次结算时对齐到当下）。 */
      var lastRegenAt = 0;
      /** 回升的小数余额。hunger 必须保持整数（界面直接把它渲染成数字）。 */
      var hungerCarry = 0;
      /** 当前那一格零食开始回充的时刻；0 表示还没起算。 */
      var snackAt = 0;
      var saved = loadSavedState(config);
      var state = {
        pet: createPet(config, saved === null ? null : saved.pet),
        effects: [],
        comboCount: 0,
        comboMultiplier: 1,
        comboTier: "normal",
        eatKey: 0,
        totalFeeds: saved === null ? 0 : saved.totalFeeds,
        totalTokens: saved === null ? 0 : saved.totalTokens,
        tokensBySource: saved === null
          ? { user_input: 0, generation: 0, tool_result: 0 }
          : saved.tokensBySource,
        // 新宠物一上来就是满格：第一次见面别让人干等 45 秒才能喂。
        snacks: saved === null ? config.manualSnackMax : saved.snacks
      };
      var persist = createPersistence(config, function () { return state; });

      /** 发布一次新的顶层状态对象。 */
      function commit(patch, skipSave) {
        state = Object.assign({}, state, patch);
        if (skipSave !== true) persist.schedule();
        listeners.forEach(function (listener) { listener(); });
      }

      /**
       * 结算「从上次结算到现在」的饥饿回升，返回回升后的 pet（没变就返回原对象）。
       *
       * 惰性结算而不是常驻定时器：喂食路径上顺手算一次就够了，展示层另有一个
       * 低频 tick 让空闲时的进度条也会动。
       * @param now - 当前时刻（epoch ms）。
       * @returns 回升后的宠物状态；无变化时是原引用。
       */
      function regenHunger(now) {
        if (config.hungerRegenPerMin <= 0) return state.pet;
        if (lastRegenAt === 0) {
          lastRegenAt = now;
          return state.pet;
        }
        var minutes = (now - lastRegenAt) / 60000;
        lastRegenAt = now;
        if (minutes <= 0) return state.pet;
        hungerCarry += minutes * config.hungerRegenPerMin;
        var whole = Math.floor(hungerCarry);
        if (whole < 1) return state.pet;
        hungerCarry -= whole;
        var hunger = Math.min(100, state.pet.hunger + whole);
        if (hunger === state.pet.hunger) return state.pet;
        return Object.assign({}, state.pet, { hunger: hunger });
      }

      /**
       * 结算「从上次结算到现在」回了几格零食。与 regenHunger 同一个形状：
       * 返回结算后的值、只动锚点，由调用方决定要不要 commit。
       *
       * 格数是整数，所以不需要 hungerCarry 那样的小数余额——把用掉的整格时间
       * 从锚点上推掉就行，余下的零头留在锚点里继续攒。
       * @param now - 当前时刻（epoch ms）。
       * @returns 结算后的格数；没变时就是 state.snacks。
       */
      function settleSnacks(now) {
        var max = config.manualSnackMax;
        // 回充间隔非正 = 「永远满格」，别在这里除以 0。
        if (config.manualSnackRegenMs <= 0) return max;
        if (state.snacks >= max) {
          // 已经满了就把起算点推到当下，免得空闲一夜攒出一堆离线余量，
          // 一喂就瞬间回满。
          snackAt = now;
          return state.snacks;
        }
        if (snackAt === 0) {
          snackAt = now;
          return state.snacks;
        }
        var gained = Math.floor((now - snackAt) / config.manualSnackRegenMs);
        if (gained <= 0) return state.snacks;
        snackAt += gained * config.manualSnackRegenMs;
        var next = Math.min(max, state.snacks + gained);
        if (next >= max) snackAt = now;
        return next;
      }

      // 离线期间也会饿：把结算起点摆在存档时刻，剩下的交给 regenHunger。
      // 起点最多回溯 offlineRegenCapMs，也顺手兜住存档时间戳跑到未来的情况
      // （改过系统时钟 / 跨时区的机器）。
      if (saved !== null && saved.savedAt > 0) {
        var bootAt = Date.now();
        var offlineFrom = Math.max(
          Math.min(saved.savedAt, bootAt),
          bootAt - config.offlineRegenCapMs
        );
        lastRegenAt = offlineFrom;
        // 零食用同一个起点：离线期间照攒（上限就是格数上限，不用另设 cap），
        // 所以出门一天回来是饿着的，但兜里的零食满了，正好把它救回来。
        // 注意先摆好这个锚点——regenHunger 会把 lastRegenAt 推到 bootAt。
        snackAt = offlineFrom;
        // 还没有订阅者，直接改初始状态即可，不用走 commit。
        state.pet = regenHunger(bootAt);
        state.snacks = settleSnacks(bootAt);
      }

      /**
       * 别的标签页写了新存档：直接采纳（同一个 localStorage，后写为准）。
       * storage 事件只在**其它**标签页写入时触发，所以不会自己听见自己。
       * @param event - StorageEvent。
       */
      function adoptExternal(event) {
        if (event === null || typeof event !== "object") return;
        if (event.key !== STATE_KEY || typeof event.newValue !== "string") return;
        var parsed;
        try {
          parsed = JSON.parse(event.newValue);
        } catch (error) {
          return;
        }
        var incoming = sanitizeSaved(parsed, config);
        if (incoming === null) return;
        // 这份进度刚从另一个标签页落盘，回升 / 回格都重新起算、也不用再写回去。
        lastRegenAt = Date.now();
        snackAt = lastRegenAt;
        hungerCarry = 0;
        commit({
          pet: createPet(config, incoming.pet),
          totalFeeds: incoming.totalFeeds,
          totalTokens: incoming.totalTokens,
          tokensBySource: incoming.tokensBySource,
          snacks: incoming.snacks
        }, true);
      }

      /**
       * 挂上跨标签页同步与「页面要走了赶紧存」的监听。
       * @returns 摘掉这些监听的函数。
       */
      function attachWindowListeners() {
        if (!config.persist) return function () {};
        if (typeof window === "undefined") return function () {};
        if (typeof window.addEventListener !== "function") return function () {};
        var onExit = function () { persist.flush(); };
        window.addEventListener("storage", adoptExternal);
        window.addEventListener("pagehide", onExit);
        // visibilitychange 从 document 冒泡上来；切后台时 pagehide 不一定来。
        window.addEventListener("visibilitychange", onExit);
        return function () {
          window.removeEventListener("storage", adoptExternal);
          window.removeEventListener("pagehide", onExit);
          window.removeEventListener("visibilitychange", onExit);
        };
      }

      var detachWindowListeners = attachWindowListeners();

      /** 连击展示超时归零（策划：5 秒无新事件后重置 combo 显示）。 */
      function expireCombo() {
        comboTimer = 0;
        combo.reset();
        commit({ comboCount: 0, comboMultiplier: 1, comboTier: "normal" });
      }

      /** 撤下一条过期特效。 */
      function dropEffect(key) {
        var kept = state.effects.filter(function (effect) { return effect.key !== key; });
        if (kept.length !== state.effects.length) commit({ effects: kept });
      }

      /**
       * 这一口如果把等级顶过了形态门槛，就在喂食那条特效后面再补一条进阶特效。
       *
       * 判定放在 store 里而不是视图里：视图是无状态渲染，比不出「上一帧是哪一档」。
       * 只在**跨档**时飘 —— 普通升级前期几口一次，飘起来很快就成噪音了。
       * @param patch - 正在攒的 patch（喂食那条特效已经在里面了）。
       * @param before - 喂之前的宠物。
       * @param after - 喂之后的宠物。
       */
      function appendEvolve(patch, before, after) {
        // 和别的特效同一个开关：关了特效就只是静静地换个长相。
        if (!config.effectsEnabled) return;
        var stage = whaleStageOf(after.level);
        if (stage === whaleStageOf(before.level)) return;
        effectSeq += 1;
        var effect = {
          key: "fx" + String(effectSeq),
          icon: EVOLVE_ICON,
          // 有 text 的特效直接飘这段字，不拼「+N 食物」那套数字（见 FeedEffect）。
          text: "进阶 · " + stage.label,
          foodAmount: 0,
          expAmount: 0,
          tokens: 0,
          foodTier: "large",
          source: "evolve",
          comboCount: 0,
          comboMultiplier: 1,
          // 蹭 epic 那套彩虹大字，进阶总得比一口饭显眼。
          tier: "epic",
          flight: LOCAL_FLIGHT
        };
        var base = patch.effects === undefined ? state.effects : patch.effects;
        patch.effects = base.concat([effect]);
        setTimeout(function () { dropEffect(effect.key); }, config.effectTtlMs);
      }

      return {
        /** @returns 当前快照（引用稳定直到下一次 commit）。 */
        getState: function () { return state; },
        /**
         * 订阅变化。
         * @param listener - 变化回调。
         * @returns 退订函数。
         */
        subscribe: function (listener) {
          listeners.add(listener);
          return function () { listeners.delete(listener); };
        },
        /**
         * 空闲时的低频结算：把饥饿回升与零食回格都推进到当下，有变化才发布。
         * 展示层每 10s 调一次，好让进度条与零食数在没有事件时也会动。
         */
        tick: function () {
          var now = Date.now();
          var pet = regenHunger(now);
          var snacks = settleSnacks(now);
          var patch = {};
          if (pet !== state.pet) patch.pet = pet;
          if (snacks !== state.snacks) patch.snacks = snacks;
          if (patch.pet !== undefined || patch.snacks !== undefined) commit(patch);
        },
        /**
         * 喂一次食：结算饥饿回升 → 走 combo → 算食物量/经验 → 更新宠物 → 加一条特效。
         * @param source - 触发源。
         * @param tokens - 估算的 token 数。
         * @param now - 事件时刻（epoch ms）。
         */
        feed: function (source, tokens, now) {
          // 先把这段空闲攒下的饥饿补回来，再吃这一口——否则食物量的大小
          // 在饱食度顶格之后就没有意义了。
          var pet = regenHunger(now);
          var count = combo.tick(now);
          var multiplier = multiplierOf(count);
          // 主项来自 token 量级，连击只加一个 0..+5 的常数：连击若也走乘法，
          // ×3.0 会盖过 token 本身的差别。
          var food = clamp(
            foodFromTokens(tokens, config) + Math.floor(count / 2),
            config.minFood,
            config.maxFood
          );
          var exp = Math.max(1, Math.floor(BASE_EXP[source] * multiplier + 0.5));
          var tier = tierOf(count);
          var foodTier = foodTierOf(tokens);
          var bySource = Object.assign({}, state.tokensBySource);
          bySource[source] += tokens;
          var patch = {
            pet: feedPet(pet, food, exp),
            comboCount: count,
            comboMultiplier: multiplier,
            comboTier: tier,
            eatKey: state.eatKey + 1,
            totalFeeds: state.totalFeeds + 1,
            totalTokens: state.totalTokens + tokens,
            tokensBySource: bySource,
            // Agent 喂食不消耗零食，这里只是顺手结算一下，好让存档里的格数
            // 保持新鲜（存档的格数是靠 savedAt 复算的）。
            snacks: settleSnacks(now)
          };
          if (config.effectsEnabled) {
            effectSeq += 1;
            // 起点必须在这一刻量：事件刚发生，会话区的位置就是它该出现的位置。
            var flight = config.flyFromConversation
              ? measureFlight((effectSeq % 5) / 4)
              : LOCAL_FLIGHT;
            var effect = {
              key: "fx" + String(effectSeq),
              icon: FOOD_ICON[source][foodTier],
              foodAmount: food,
              expAmount: exp,
              tokens: tokens,
              foodTier: foodTier,
              source: source,
              comboCount: count,
              comboMultiplier: multiplier,
              tier: tier,
              flight: flight
            };
            patch.effects = state.effects.concat([effect]);
            setTimeout(function () { dropEffect(effect.key); }, config.effectTtlMs);
          }
          appendEvolve(patch, pet, patch.pet);
          commit(patch);
          if (comboTimer !== 0) clearTimeout(comboTimer);
          comboTimer = setTimeout(expireCombo, config.comboWindowMs);
        },
        /**
         * 主动喂一口零食：消耗一格库存，换固定的食物量与一点经验。
         *
         * Agent 不干活的时候这是唯一能把饱食度喂回去的通道。刻意不碰三样东西：
         *   - **不进 combo**：否则点五下就能把连击顶到 ×2.0，让后面 Agent 真喂
         *     的那一口白拿倍率；
         *   - **不进 token 统计**：零食不是 Agent 的消耗，混进去会污染
         *     「消耗 xx tok」那块面板；
         *   - **库存限流**：所以点着不放也刷不出等级（满打满算 1 exp / 45s）。
         * @returns 真的喂进去了才是 true（关了功能 / 没库存都是 false）。
         */
        snack: function () {
          if (!config.manualFeedEnabled) return false;
          var now = Date.now();
          // 顺序和 feed 一致：先把这段空闲攒下的饥饿补回来，再喂这一口。
          var pet = regenHunger(now);
          var snacks = settleSnacks(now);
          if (snacks <= 0) {
            // 喂不动也要把刚结算出来的饥饿发布出去，否则界面停在旧数字上。
            if (pet !== state.pet) commit({ pet: pet });
            return false;
          }
          var food = config.manualFeedFood;
          var exp = config.manualFeedExp;
          var patch = {
            pet: feedPet(pet, food, exp),
            eatKey: state.eatKey + 1,
            // tooltip 上写的是「累计喂食 N 次」，手喂也是喂。
            totalFeeds: state.totalFeeds + 1,
            snacks: snacks - 1
          };
          if (config.effectsEnabled) {
            effectSeq += 1;
            var effect = {
              key: "fx" + String(effectSeq),
              icon: SNACK_ICON,
              foodAmount: food,
              expAmount: exp,
              // 0 token：飘字看见这个就不写「x tok」了（见 FeedEffect）。
              tokens: 0,
              foodTier: "small",
              source: "manual",
              comboCount: 0,
              comboMultiplier: 1,
              tier: "normal",
              // 零食是你手喂的，就地从下方飞入——它跟会话里的任何事件都无关。
              flight: LOCAL_FLIGHT
            };
            patch.effects = state.effects.concat([effect]);
            setTimeout(function () { dropEffect(effect.key); }, config.effectTtlMs);
          }
          // 手喂也能把等级顶过门槛（一口 1 点经验，也算数）。
          appendEvolve(patch, pet, patch.pet);
          commit(patch);
          return true;
        },
        /** 卸载时把进度落盘、停掉悬空的定时器、摘掉窗口监听。 */
        dispose: function () {
          if (comboTimer !== 0) clearTimeout(comboTimer);
          comboTimer = 0;
          detachWindowListeners();
          persist.flush();
          persist.dispose();
          listeners.clear();
        }
      };
    }

    /**
     * 幂等闸门：同一条事件只喂一次，且只喂「刚发生」的事件。
     *
     * Conversation 引擎会在翻历史 / 重放时重新折叠同一批事件，Definition 的
     * start 因此可能被同一 seq 再次调用；同时打开一个旧会话会一次性折叠整段
     * 日志。seq 是会话内单调的、跨会话不可比，所以键用 seq+time+type 复合，
     * 并只保留 freshnessMs 窗口内的键——过了窗口的事件本来就不喂。
     * @param config - 生效配置（读 freshnessMs）。
     * @returns 闸门句柄。
     */
    function createFeedGate(config) {
      var seen = new Map();
      return {
        /**
         * 这条事件是否应当触发喂食。
         * @param event - 原始 session 事件。
         * @returns 应当喂食时为 true。
         */
        admit: function (event) {
          var now = Date.now();
          if (typeof event.time !== "number" || now - event.time > config.freshnessMs) return false;
          var key = String(event.seq) + ":" + String(event.time) + ":" + event.type;
          if (seen.has(key)) return false;
          seen.set(key, now);
          if (seen.size > 256) {
            seen.forEach(function (stamp, old) {
              if (now - stamp > config.freshnessMs) seen.delete(old);
            });
          }
          return true;
        }
      };
    }

    //#endregion

    //#region 视图

    /** 瞳孔 / 嘴的深蓝墨色；主体渐变取 DeepSeek 的品牌蓝 #4d6bfe。 */
    var WHALE_INK = "#16224d";

    /** 轮廓描边：比主色深一档的蓝，二次元赛璐璐那种线稿感。 */
    var WHALE_LINE = "#2b3f9e";

    /** 传说档的描边与王冠：一对深浅金。 */
    var WHALE_GOLD_LINE = "#c08a1e";
    var WHALE_GOLD = "#f2c744";

    /**
     * 一只眼睛。normal/gold 是带高光的圆瞳，epic 直接变星星眼。
     * @param cx - 眼睛中心 x（viewBox 坐标）。
     * @param cy - 眼睛中心 y。
     * @param star - 是否画成星星眼。
     * @param grow - 瞳孔缩放（形态表的 eyeGrow，缺省 1）。
     * @returns 眼睛节点数组。
     */
    function whaleEye(cx, cy, star, grow) {
      var k = typeof grow === "number" ? grow : 1;
      if (star) {
        return [
          h("path", {
            key: "star",
            d: "M0-6C.7-2 2-.7 6 0 2 .7 .7 2 0 6-.7 2-2 .7-6 0-2-.7-.7-2 0-6Z",
            // 缩放接在平移之后，所以缩的是星星本身而不是它的位置。
            transform: "translate(" + cx + " " + cy + ") scale(" + k + ")",
            fill: "#ffe066"
          }),
          h("circle", { key: "core", cx: cx, cy: cy, r: 1.5 * k, fill: "#fff8d6" })
        ];
      }
      return [
        h("ellipse", {
          key: "iris", cx: cx, cy: cy, rx: 4.2 * k, ry: 5.2 * k, fill: WHALE_INK
        }),
        h("circle", { key: "hi", cx: cx - 1.3 * k, cy: cy - 2 * k, r: 1.7 * k, fill: "#ffffff" }),
        h("circle", {
          key: "hi2", cx: cx + 1.2 * k, cy: cy + 2.2 * k, r: .85 * k,
          fill: "#ffffff", opacity: .75
        })
      ];
    }

    /**
     * DeepSeek 二次元小鲸的头像：一张 44px 的内联 SVG，部件各自挂 CSS 动画
     * （浮沉 / 摆尾 / 划鳍 / 眨眼 / 喷水），epic 连击时加星星眼与闪光。
     *
     * 不用外链图片：插件产物是单文件 JS，塞不了资源，而 SVG 还能跟着 combo
     * 换表情。id 带前缀避免和宿主页面的 defs 撞名。
     *
     * 长相由三件事决定：连击档（星星眼 / 闪光）、饿不饿（耷脸）、**等级形态**
     * （体型 / 配色 / 眼睛比例 / 喷水柱 / 背鳍 / 王冠，见 WHALE_STAGES）。
     * 收的是 level 而不是 stage 对象，形态在组件里自己算 —— 缺省 level 时
     * `undefined >= 3` 恒 false，自然落到最低档，不会炸。
     * @param props - { tier, hungry, level }：连击视觉等级 + 是否饿着 + 宠物等级。
     * @returns 鲸鱼节点。
     */
    function WhaleAvatar(props) {
      var excited = props.tier === "epic";
      // 正在被猛喂的时候不摆饿脸——嘴里还嚼着呢。
      var starving = props.hungry === true && !excited;
      var stage = whaleStageOf(props.level);
      var line = stage.gold ? WHALE_GOLD_LINE : WHALE_LINE;
      // 金线细了看不出是金的，索性一起加粗；卡片会跟着头像一起长高。
      var lw = stage.gold ? 1.5 : 1;
      return h(
        "svg",
        {
          className: "dshpet-whale",
          viewBox: "0 0 64 64",
          // 体型直接改边长（覆盖 .dshpet-whale 的 44px），路径坐标一个不动。
          style: { width: String(stage.size) + "px", height: String(stage.size) + "px" },
          role: "img",
          "aria-label": "鲸鱼宠物（" + stage.label + "）"
        },
        h(
          "defs",
          null,
          h(
            "linearGradient",
            { id: "dshpet-whale-skin", x1: "0", y1: "0", x2: "0", y2: "1" },
            h("stop", { offset: "0", stopColor: stage.skin[0] }),
            h("stop", { offset: ".55", stopColor: stage.skin[1] }),
            h("stop", { offset: "1", stopColor: stage.skin[2] })
          ),
          h(
            "linearGradient",
            { id: "dshpet-whale-belly", x1: "0", y1: "0", x2: "0", y2: "1" },
            h("stop", { offset: "0", stopColor: "#ffffff", stopOpacity: ".92" }),
            h("stop", { offset: "1", stopColor: "#d7e2ff", stopOpacity: ".85" })
          )
        ),
        // 喷水柱：只在头顶那一小块，靠动画循环冒出来。幼崽还不会喷，
        // 传说档的喷水口被王冠占了（见 WHALE_STAGES 的注释）。
        stage.spout
          ? h(
            "g",
            { className: "dshpet-whale-spout" },
            h("path", {
              d: "M20 17C18.8 13.6 21.4 11.6 20.2 8.6",
              fill: "none",
              stroke: "#bcd2ff",
              strokeWidth: 1.6,
              strokeLinecap: "round"
            }),
            h("circle", { cx: 20.4, cy: 6.6, r: 1.7, fill: "#dbe6ff" }),
            h("circle", { cx: 16.4, cy: 9.4, r: 1.2, fill: "#dbe6ff", opacity: .85 }),
            h("circle", { cx: 24.2, cy: 9, r: 1, fill: "#dbe6ff", opacity: .7 })
          )
          : null,
        h(
          "g",
          { className: "dshpet-whale-body" },
          // 尾鳍与胸鳍在身体之下，免得盖住肚皮的高光。
          h("path", {
            className: "dshpet-whale-tail",
            d: "M43 27C50 24.6 55 17.6 59.4 18.2 62.4 18.8 58.4 27 57.4 33"
              + "C58.4 39 62.4 47.2 59.4 47.8 55 48.4 50 41.4 43 39Z",
            fill: "url(#dshpet-whale-skin)",
            stroke: line,
            strokeWidth: 1.1 * lw
          }),
          h("path", {
            className: "dshpet-whale-fin",
            d: "M17.4 44.5C13 48.6 14.2 54.8 20 52.8 23.8 51.4 25 47.4 24.2 44Z",
            // 比身体最深的那一档再深一点，四档的配色差异才连胸鳍一起走。
            fill: stage.skin[2],
            stroke: line,
            strokeWidth: 1.1 * lw
          }),
          // 背鳍：成年才长出来，个头要够大才认得出（占了半个身高）。和尾鳍一样
          // 画在身体之前，根部被身体盖住，看起来才像从背上长出来的。
          stage.dorsal
            ? h("path", {
              className: "dshpet-whale-dorsal",
              d: "M27 20.5C29.6 13.2 32.4 8 35.2 4.4 38.2 10 40.2 15.4 40.6 21Z",
              fill: "url(#dshpet-whale-skin)",
              stroke: line,
              strokeWidth: 1.1 * lw
            })
            : null,
          h("ellipse", {
            cx: 29, cy: 33, rx: 20, ry: 17,
            fill: "url(#dshpet-whale-skin)",
            stroke: line,
            strokeWidth: 1.2 * lw
          }),
          // 白肚皮：上沿是一条向上鼓的分界线，下沿沿着身体轮廓的弧走，
          // 这样它是「贴在身上的肚皮」而不是一个浮在身上的白椭圆。弧半径比
          // 身体小 0.7，免得盖掉身体下沿的那条描边。
          h("path", {
            d: "M10.3 37C16.8 33 41.2 33 47.7 37A19.3 16.3 0 0 1 10.3 37Z",
            fill: "url(#dshpet-whale-belly)"
          }),
          h("ellipse", {
            cx: 19.5, cy: 22.5, rx: 6.5, ry: 3.2, fill: "#ffffff",
            opacity: .3, transform: "rotate(-24 19.5 22.5)"
          }),
          h("g", { className: "dshpet-whale-blush", opacity: starving ? .25 : .5 },
            h("ellipse", { cx: 14.6, cy: 37.6, rx: 3.4, ry: 2, fill: "#ff86ac" }),
            h("ellipse", { cx: 43.4, cy: 37.6, rx: 3.4, ry: 2, fill: "#ff86ac" })),
          h("g", { className: "dshpet-whale-eyes" },
            whaleEye(21.5, 29.5, excited, stage.eyeGrow),
            whaleEye(35, 29.5, excited, stage.eyeGrow)),
          h("path", {
            className: "dshpet-whale-mouth",
            d: excited
              ? "M25 39.4C26.6 43.4 30.4 43.4 32 39.4Z"
              // 饿脸：把嘴的弧翻过来——控制点抬到端点上方，于是向上鼓成撇嘴。
              : starving
                ? "M25.6 41.6C27.2 38.8 30.4 38.8 32 41.6"
                : "M25.6 39.4C27.2 42.2 30.4 42.2 32 39.4",
            fill: excited ? WHALE_INK : "none",
            stroke: WHALE_INK,
            strokeWidth: 1.5,
            strokeLinecap: "round"
          }),
          // 王冠：传说档才有，画在眼睛 / 嘴之后压在最上层。底边贴着头顶弧线，
          // 位置正好是喷水口 —— 所以这一档不喷水。
          stage.crown
            ? h("path", {
              className: "dshpet-whale-crown",
              d: "M12.4 18.4 13.4 7.2 18.2 12.6 20.2 3.6 22.2 12.6 27 7.2 28 18.4Z",
              fill: WHALE_GOLD,
              stroke: WHALE_GOLD_LINE,
              strokeWidth: 1.2,
              strokeLinejoin: "round"
            })
            : null
        ),
        excited
          ? h(
            "g",
            { className: "dshpet-whale-sparkle", fill: "#ffe066" },
            h("path", { d: "M0-3.4C.4-.9 .9-.4 3.4 0 .9 .4 .4 .9 0 3.4-.4 .9-.9 .4-3.4 0-.9-.4-.4-.9 0-3.4Z", transform: "translate(6 16)" }),
            h("path", { d: "M0-2.6C.3-.7 .7-.3 2.6 0 .7 .3 .3 .7 0 2.6-.3 .7-.7 .3-2.6 0-.7-.3-.3-.7 0-2.6Z", transform: "translate(54 12)" })
          )
          : null
      );
    }

    /**
     * 一条特效：食物飞入（600ms）→ 飘字（1200ms，延迟 600ms 起）。
     * @param props - { effect, index }。
     * @returns 特效节点。
     */
    function FeedEffect(props) {
      var effect = props.effect;
      // 同时存在多条时横向错开，避免完全重叠。
      var offset = (props.index % 4) * 11;
      var flight = effect.flight || LOCAL_FLIGHT;
      var foodStyle = { left: String(14 + offset) + "px" };
      // 落点仍是宠物，只有起点被挪到会话区；位移经自定义属性交给 keyframe。
      foodStyle["--dshpet-dx"] = String(flight.dx) + "px";
      foodStyle["--dshpet-dy"] = String(flight.dy) + "px";
      return h(
        React.Fragment,
        null,
        h("span", {
          className: "dshpet-food",
          "data-flight": flight.across ? "across" : "local",
          // 字号跟着这一口的 token 量级：小食一小口，大消耗一大坨。
          "data-size": effect.foodTier,
          style: foodStyle,
          "aria-hidden": "true"
        }, effect.icon),
        h("span", {
          className: "dshpet-float",
          "data-tier": effect.tier,
          style: { left: String(44 + offset) + "px" }
        }, effect.text
          // 通知类特效（目前只有进阶）自带整句文案，没有食物量可报，
          // 走这一支就不拼「+N 食物 · X tok +M ⭐」那套数字了。
          ? effect.text
          : "+" + String(effect.foodAmount) + " " + effect.icon
            // 手喂的零食没有 token 可报（"0 tok" 是噪音），只有真消耗才写这一段。
            + (effect.tokens > 0 ? " · " + formatTokens(effect.tokens) + " tok" : "")
            + "  +" + String(effect.expAmount) + " ⭐")
      );
    }

    /**
     * 宠物 overlay：连击徽标 + 宠物卡片 + 零食按钮 + 特效层。
     * 点卡片折叠/展开属性面板，点零食按钮喂一口。
     * @param store - 宠物状态源。
     * @param config - 生效配置（读零食与「饿了」的阈值）。
     * @returns overlay 组件。
     */
    function createPetOverlay(store, config) {
      return function PetOverlay() {
        var stateHook = React.useState(store.getState());
        var state = stateHook[0];
        var setState = stateHook[1];
        var collapsedHook = React.useState(false);
        var collapsed = collapsedHook[0];
        var setCollapsed = collapsedHook[1];

        React.useEffect(function () {
          // 订阅前后各读一次，避免 mount 与首次 feed 之间的窗口丢状态。
          setState(store.getState());
          return store.subscribe(function () { setState(store.getState()); });
        }, []);

        React.useEffect(function () {
          // 饥饿回升本身是喂食时惰性结算的；这个低频 tick 只是为了让空闲时
          // 的饱食度进度条也会动。挂在组件上，卸载即停。
          var timer = setInterval(store.tick, 10000);
          return function () { clearInterval(timer); };
        }, []);

        var pet = state.pet;
        var fullness = 100 - pet.hunger;
        var expNeed = pet.level * EXP_PER_LEVEL;
        var expRatio = Math.min(100, Math.round(pet.exp / expNeed * 100));
        var showCombo = state.comboCount >= 2;
        // 饿了只是表现层的告警：hunger 封顶 100，宠物不会真的饿死。
        var hungry = pet.hunger >= config.hungryAt;
        var snacks = state.snacks;
        var canFeed = config.manualFeedEnabled && snacks > 0;
        // 形态纯粹从等级算出来，不存档、不占状态。
        var stage = whaleStageOf(pet.level);
        var nextStage = whaleStageNextOf(pet.level);
        // 进阶金环直接挂在那条进阶特效上：特效被 dropEffect 撤掉，环也跟着没。
        var evolving = null;
        for (var ei = 0; ei < state.effects.length; ei += 1) {
          if (state.effects[ei].source === "evolve") evolving = state.effects[ei];
        }

        return h(
          "div",
          { className: "dshpet-root" },
          showCombo
            ? h(
              "div",
              {
                // key 随每次喂食变化 → 重挂载 → gold/epic 的震动重新播放。
                key: "combo-" + String(state.eatKey),
                className: "dshpet-combo",
                "data-tier": state.comboTier
              },
              "COMBO ×" + String(state.comboCount) + "  " + state.comboMultiplier.toFixed(1) + "x"
            )
            : null,
          h(
            "div",
            { className: "dshpet-stage" },
            h(
              "div",
              {
                className: "dshpet-card",
                "data-tier": state.comboTier,
                "data-hungry": hungry ? "true" : undefined,
                "data-stage": stage.key,
                title: "心情 " + String(pet.mood) + " / 精力 " + String(pet.energy)
                  + " / 累计喂食 " + String(state.totalFeeds) + " 次"
                  + " / 累计 " + formatTokens(state.totalTokens) + " tok"
                  + " / 形态 " + stage.label
                  + (nextStage === null
                    ? ""
                    : " → Lv." + String(nextStage.minLevel) + " " + nextStage.label)
                  + "（点击折叠）",
                onClick: function () { setCollapsed(!collapsed); }
              },
              h(
                "span",
                { className: "dshpet-avatar" },
                // key 随 eatKey 变化 → 节点重挂载 → 进食弹跳动画重新播放
                // （鲸鱼的张嘴 / 脸红也挂在 .dshpet-eating 的后代选择器上）。
                h("span", {
                  key: "eat-" + String(state.eatKey),
                  className: state.eatKey > 0 ? "dshpet-eating" : undefined,
                  style: { display: "inline-block" }
                }, pet.avatar === "whale"
                  ? h(WhaleAvatar, {
                    tier: state.comboTier, hungry: hungry, level: pet.level
                  })
                  // emoji 头像是用户自己配的字形，插件不擅自按等级换。
                  : pet.icon),
                state.comboTier === "epic" ? h("span", { className: "dshpet-halo" }) : null,
                evolving === null
                  ? null
                  : h("span", { key: "evolve-" + evolving.key, className: "dshpet-evolve" })
              ),
              collapsed
                ? null
                : h(
                  "div",
                  { className: "dshpet-meta" },
                  h("div", { className: "dshpet-name" },
                    pet.name + " · Lv." + String(pet.level) + " " + stage.label),
                  h("div", {
                    className: "dshpet-bar dshpet-bar-full",
                    "data-low": hungry ? "true" : undefined
                  }, h("i", { style: { width: String(fullness) + "%" } })),
                  h("div", { className: "dshpet-bar dshpet-bar-exp" },
                    h("i", { style: { width: String(expRatio) + "%" } })),
                  h("div", { className: "dshpet-sub" },
                    pet.species + " · 饱食 " + String(fullness) + " · EXP "
                    + String(pet.exp) + "/" + String(expNeed)),
                  // token 消耗面板：总量 + 三个源各自的量（图标取 small 档）。
                  h("div", { className: "dshpet-sub dshpet-tokens" },
                    "消耗 " + formatTokens(state.totalTokens) + " tok · "
                    + FOOD_ICON.user_input.small + formatTokens(state.tokensBySource.user_input)
                    + " " + FOOD_ICON.generation.small + formatTokens(state.tokensBySource.generation)
                    + " " + FOOD_ICON.tool_result.small + formatTokens(state.tokensBySource.tool_result))
                ),
              // 零食按钮是卡片的第三格，所以折叠状态下也点得到（折叠只藏 meta）。
              config.manualFeedEnabled
                ? h("button", {
                  className: "dshpet-snack",
                  type: "button",
                  disabled: !canFeed,
                  // 攒着零食又饿着：晃一下提醒你点它。
                  "data-urge": hungry && canFeed ? "true" : undefined,
                  title: (canFeed ? "喂一口零食" : "零食攒完了")
                    + "（" + String(snacks) + "/" + String(config.manualSnackMax) + "，"
                    + String(Math.round(config.manualSnackRegenMs / 1000)) + " 秒回一格）",
                  "aria-label": "喂一口零食，还剩 " + String(snacks) + " 个",
                  onClick: function (event) {
                    // 卡片本身的 onClick 是折叠/展开，必须拦住冒泡。
                    if (event !== null && event !== undefined
                      && typeof event.stopPropagation === "function") {
                      event.stopPropagation();
                    }
                    store.snack();
                  }
                }, SNACK_ICON, h("span", { className: "dshpet-snack-n" }, String(snacks)))
                : null
            ),
            h(
              "div",
              { className: "dshpet-fx" },
              state.effects.map(function (effect, index) {
                return h(FeedEffect, { key: effect.key, effect: effect, index: index });
              })
            )
          )
        );
      };
    }

    //#endregion

    //#region 插件体

    /** 需要的浏览器服务：slot 系统 + Conversation Definition 注册表。 */
    var inject = ["slots", "conversationEvents"];

    /**
     * 浏览器插件体。
     * @param ctx - client 根 context。
     */
    function apply(ctx) {
      var config = resolveConfig();
      if (!config.enabled) return;

      installStyles();

      var store = createPetStore(config);
      var gate = createFeedGate(config);
      ctx.effect(function () {
        return function () { store.dispose(); };
      }, "dsh-pet-plugin: store");

      /**
       * 每条喂食事件自成一个 Context：id 用 seq，role 恒为 start，所以
       * start 对每条事件最多被引擎调用一次（引擎对同一 Context 的第二个
       * start 会抛错），重放由 gate 兜住。state-only，不声明 target，
       * publication 取 "none" —— 本 Definition 不产出任何视图节点。
       */
      var petFeedDefinition = {
        kind: "dsh-pet-feed",
        match: function (event) {
          if (classify(event) === null) return null;
          return { id: "seq-" + String(event.seq), role: "start" };
        },
        start: function (_context, match) {
          var event = match.event;
          var classified = classify(event);
          if (classified !== null && gate.admit(event)) {
            store.feed(classified.source, classified.tokens, Date.now());
          }
          return { seq: event.seq };
        },
        update: function (context) { return context.state; },
        publication: function () { return "none"; }
      };

      ctx.effect(
        function () { return ctx.conversationEvents.register(petFeedDefinition); },
        "dsh-pet-plugin: feed observer"
      );

      // overlay 恒注册：effectsEnabled 管的是「飞行特效」（store.feed / snack 里
      // 那层守卫），不是宠物卡片本身——卡片上还有主动喂食的入口，关了特效也得留着。
      ctx.slots.inject("shell.overlay", function () {
        return ctx.slots.register({
          name: "shell.overlay",
          id: "pet",
          order: 50
        }, createPetOverlay(store, config));
      });
    }

    //#endregion

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
