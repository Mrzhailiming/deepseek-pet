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

      // 本实现补充：心情 / 精力。策划给了这两个字段和 0-100 的范围，但没给任何
      // 变化规则；这一组是本实现补的规则，vitalsEnabled: false 退回静态展示值。
      vitalsEnabled: true,
      // 一口饭涨多少心情
      moodPerFeed: 2,
      // 摸一次头涨多少心情
      moodPerPat: 6,
      // 每分钟自然回落的心情
      moodDecayPerMin: 0.4,
      // 饿着的时候每分钟额外掉的心情
      moodDropPerMinHungry: 2.5,
      // 心情对经验倍率的摆幅：0 心情 ×(1 - swing/2)，满心情 ×(1 + swing/2)
      moodExpSwing: 0.4,
      // 心情低于这个值就摆委屈脸
      moodSadAt: 30,
      // 陪 Agent 干一次活消耗多少精力
      energyPerFeed: 3,
      // 每分钟回多少精力（睡着时再乘 energySleepFactor）
      energyRegenPerMin: 1.2,
      // 睡眠期间精力回升的倍数
      energySleepFactor: 3,
      // 精力低于这个值算「困了」：睡得更早，而且经验打个折
      lowEnergyAt: 25,
      // 困着时的经验折扣
      tiredExpFactor: 0.85,

      // 本实现补充：睡眠。久了没事件就睡着，任何一次喂食 / 摸头都会把它叫醒
      sleepEnabled: true,
      // 多久没有事件就睡着（困着时按一半算）
      sleepAfterMs: 300000,
      // 睡着时饥饿回升的倍数（睡着了饿得慢）
      sleepHungerFactor: 0.5,

      // 本实现补充：互动。摸头 / 台词气泡 / 拖着卡片换位置
      patEnabled: true,
      // 两次摸头之间的冷却（挡住按住不放刷心情）
      patCooldownMs: 1500,
      bubbleEnabled: true,
      bubbleTtlMs: 2600,
      // 两个普通气泡之间至少隔这么久，否则一轮工具循环会把气泡刷成弹幕；
      // 进阶 / 成就 / 摸头这些「大事」不受它限制
      bubbleMinGapMs: 4000,
      dragEnabled: true,

      // 本实现补充：成就与每日任务
      achievementsEnabled: true,
      // 每解锁一个成就送几格零食（0 = 只给徽章）
      achievementSnacks: 1,
      dailyEnabled: true,
      // 每完成一个每日任务给多少经验 / 几格零食
      dailyQuestExp: 30,
      dailyQuestSnacks: 1,

      // 本实现补充：食性偏好与暴食
      pickyEnabled: true,
      // 最爱的那一口（三个源之一，写别的值等于没有偏好）
      favoriteSource: "tool_result",
      // 吃到最爱时食物量的倍数
      favoriteBonus: 1.3,
      // 连着吃同一种超过这么多口就腻了
      boredomAfter: 8,
      // 腻了之后食物量的倍数
      boredomFactor: 0.75,
      // 连击顶格触发的暴食 BUFF
      frenzyEnabled: true,
      frenzyMs: 15000,
      frenzyExpFactor: 2,
      frenzyFoodFactor: 1.2,

      // 本实现补充：技能树。不同工具调用培养不同技能，够高了解锁提示能力
      skillsEnabled: true,
      // 技能等级 L → L+1 需要 L × 这个数的技能经验
      skillXpPerLevel: 20,
      // 技能等级上限
      skillMaxLevel: 10,

      // 本实现补充：宠物记忆。记住常改的文件 / 常用的工具 / 常在几点干活
      memoryEnabled: true,
      // 记得住几个文件（实现上多留 4 行的缓冲，见 bumpCount）
      memoryFileTop: 8,

      // 本实现补充：真实辅助能力。技能够高时说一句真的有用的话
      adviceEnabled: true,
      // 相关技能到这一级才开口（免得刚认识就好为人师）
      adviceMinSkillLevel: 2,
      // 两条提示之间的冷却：提示的价值全在稀有
      adviceCooldownMs: 60000,
      // 同一个文件在本次会话里改到几次的整数倍就提一句
      adviceRepeatEditAt: 3,
      // 连着几次工具报错就提一句
      adviceErrorStreakAt: 3,

      // 本实现补充：关怀与闲聊。深夜 / 久坐 / 好久不见，以及引用记忆的搭话。
      // 这一类是宠物**主动**开口说的闲话，所以冷却按半小时算而不是按秒
      careEnabled: true,
      // 两句关怀 / 闲聊之间的冷却。它们没有信息量，稀有才不烦人
      careCooldownMs: 1800000,
      // 「深夜」是从几点到几点（含两头，按本地时区；From > To 表示跨午夜）
      careNightFrom: 1,
      careNightTo: 4,
      // 一段不间断的活儿干到多久就劝一句歇会儿（同一段只劝一次）
      careMarathonMs: 7200000,
      // 离开多久算「好久不见」，回来第一次互动时念一句
      careComebackMs: 28800000,

      // 本实现补充：情绪三维。mood 本身就是「开心」那一维，这里另加三维。
      // 三维**只驱动表情和台词**，一点数值曲线都不碰（经验倍率照旧只看 mood）
      moodDimsEnabled: true,
      // 碰到新文件 / 新工具涨多少好奇
      curiosityPerNew: 15,
      // 一次探索类工具调用涨多少好奇
      curiosityPerResearch: 6,
      // 升级 / 成就 / 技能升级 / 跨过报错涨多少得意
      pridePerWin: 20,
      // 一次工具报错涨多少担忧
      concernPerError: 20,
      // 饿着 / 久坐 / 深夜涨多少担忧
      concernPerWorry: 12,
      // 三维每分钟回落多少（都往 0 走，没事就是没情绪）
      moodDimDecayPerMin: 1.2,
      // 一维涨到这个值才「写在脸上」
      moodDimAt: 55,

      // 本实现补充：空闲微交互。眼睛跟鼠标 + 闲下来的小动作 + 摸头的手感
      // 眼睛跟鼠标（走 CSS 自定义属性，不进 React 状态，也不落盘）
      eyeTrackEnabled: true,
      // 瞳孔最多偏出去几个 px
      eyeTrackMax: 1.6,
      // 鼠标停下多久后眼睛归位
      eyeTrackIdleMs: 2000,
      // 闲下来的小动作（打哈欠 / 摆尾 / 翻身 / 偷看）
      idleActEnabled: true,
      // 每隔多久考虑做一个小动作（实际由 10s 的 tick 抽查）
      idleActEveryMs: 45000,
      // 安静这么久才算「闲下来」（免得跟吃饭动画撞车）
      idleActQuietMs: 12000,
      // 一个小动作演多久
      idleActMs: 1400,

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

    /**
     * 技能表：宠物陪你干的四类活。顺序即面板上的展示顺序。
     *
     * 这是整套「工作伙伴」的地基 —— 它是**唯一**知道「你刚才在干什么」的数据：
     * 三个喂食源只看得见「烧了多少 token」，工具的名字要到 `tool/call` 才有。
     */
    var SKILLS = [
      { key: "coding", icon: "💻", label: "编码" },
      { key: "research", icon: "🔍", label: "探索" },
      { key: "debug", icon: "🐛", label: "调试" },
      { key: "writing", icon: "✍️", label: "表达" }
    ];

    /** 技能 key → 条目。渲染与消毒存档都要按 key 查。 */
    var SKILL_BY_ID = {};
    SKILLS.forEach(function (item) { SKILL_BY_ID[item.key] = item; });

    /**
     * 工具名 → 技能。工具名取自宿主仓库里真实注册的那批（packages/*​/tool-*），
     * 不在表里的（MCP 工具、别人的插件工具）落到 SKILL_FALLBACK。
     */
    var TOOL_SKILL = {
      read: "coding",
      write: "coding",
      edit: "coding",
      str_replace_editor: "coding",
      lsp: "coding",

      glob: "research",
      grep: "research",
      web_search: "research",
      web_fetch: "research",
      read_image: "research",
      workspace: "research",

      bash: "debug",
      pwsh: "debug",
      terminal_open: "debug",
      terminal_read: "debug",
      terminal_send: "debug",
      terminal_signal: "debug",
      terminal_list: "debug",
      terminal_close: "debug",
      job_output: "debug",
      job_list: "debug",
      job_kill: "debug",

      todo_write: "writing",
      plan: "writing",
      report: "writing",
      skill: "writing",
      subagent: "writing",
      send_message: "writing",
      list_agents: "writing",
      interrupt_agent: "writing"
    };

    /** 不认识的工具算探索：用一个没见过的工具，本身就是在探索。 */
    var SKILL_FALLBACK = "research";

    /**
     * 「算改了这个文件一次」的工具。read 不算 —— 提示语是「你改了 3 次了」，
     * 翻来翻去地读不该触发它。
     */
    var EDIT_TOOLS = { write: true, edit: true, str_replace_editor: true };

    /** 记忆里工具表的行数上限（文件表的上限跟着 memoryFileTop 走）。 */
    var MEMORY_TOOL_TOP = 12;

    /**
     * 记忆表超容量时多留的缓冲行数。
     *
     * 不留缓冲的话，一旦前 N 名都攒到 2 次以上，新文件（count 1）就永远进不来 ——
     * 记忆会冻在第一天。留几行缓冲，新面孔至少有机会被再改一次。
     */
    var MEMORY_SLACK = 4;

    /** callId → 工具名 这张回查表的条数上限（见 store 里的 callNames）。 */
    var CALL_NAME_CAP = 64;

    /** 摸头飘的图标；成就 / 任务达成各自一个，都走 appendNotice 那条通知管道。 */
    var PAT_ICON = "💗";
    var QUEST_ICON = "📋";

    /** 卡片上开关成就 / 任务面板那个按钮的图标。 */
    var BADGE_ICON = "🏅";

    /**
     * 成就表：里程碑徽章。`test` 只看一份统计快照（见 store 的 statsOf），
     * 所以它是纯函数、可以在任何时刻重算，解锁与否只取决于当下的数字。
     *
     * 刻意不放任何依赖真实时钟的条目（比如「深夜喂食」）：那种条目会让冒烟
     * 测试的结果跟着跑测试的钟点变。`hint` 是没解锁时 tooltip 上的说明。
     */
    var ACHIEVEMENTS = [
      {
        id: "first_feed", icon: "🍼", label: "第一口", hint: "吃到第一口饭",
        test: function (s) { return s.totalFeeds >= 1; }
      },
      {
        id: "gourmet", icon: "🍱", label: "尝遍三味", hint: "三种食材都吃过",
        test: function (s) {
          return s.tokensBySource.user_input > 0 && s.tokensBySource.generation > 0
            && s.tokensBySource.tool_result > 0;
        }
      },
      {
        id: "combo_full", icon: "🔥", label: "满连击", hint: "把 Combo 打到顶格",
        test: function (s, config) { return s.comboCount >= config.maxCombo; }
      },
      {
        id: "feast", icon: "🍲", label: "大胃王", hint: "一口吃下 feast 档的大餐",
        test: function (s) { return s.foodTier === "feast"; }
      },
      {
        id: "tokens_100k", icon: "💠", label: "十万吞吐", hint: "累计消耗 100k token",
        test: function (s) { return s.totalTokens >= 100000; }
      },
      {
        id: "tokens_1m", icon: "🌌", label: "百万吞吐", hint: "累计消耗 1M token",
        test: function (s) { return s.totalTokens >= 1000000; }
      },
      {
        id: "feeds_100", icon: "🍚", label: "百口之家", hint: "累计喂食 100 次",
        test: function (s) { return s.totalFeeds >= 100; }
      },
      {
        id: "pats_50", icon: "🤍", label: "老朋友", hint: "摸头 50 次",
        test: function (s) { return s.pats >= 50; }
      },
      {
        id: "streak_3", icon: "📅", label: "三日之约", hint: "连续 3 天来喂它",
        test: function (s) { return s.streakCount >= 3; }
      },
      {
        id: "level_legend", icon: "👑", label: "传说降临", hint: "养到 Lv.10 传说档",
        test: function (s) { return s.pet.level >= 10; }
      },
      {
        id: "streak_7", icon: "🗓", label: "一周之约", hint: "连续 7 天来喂它",
        test: function (s) { return s.streakCount >= 7; }
      },
      {
        id: "skill_master", icon: "🎓", label: "出师", hint: "任意一门技能练到满级",
        test: function (s, config) {
          for (var i = 0; i < SKILLS.length; i += 1) {
            var row = s.skills[SKILLS[i].key];
            if (row !== undefined && row.level >= config.skillMaxLevel) return true;
          }
          return false;
        }
      },
      {
        id: "recover_50", icon: "🧰", label: "老手", hint: "跨过 50 次工具报错",
        test: function (s) { return s.memory.recoveries >= 50; }
      },
      {
        id: "curious", icon: "🔭", label: "十万个为什么", hint: "把好奇心顶到满格",
        test: function (s) { return s.pet.curiosity >= 100; }
      }
    ];

    /** 成就 id → 条目。渲染徽章与消毒存档都要按 id 查。 */
    var ACHIEVEMENT_BY_ID = {};
    ACHIEVEMENTS.forEach(function (item) { ACHIEVEMENT_BY_ID[item.id] = item; });

    /**
     * 每日任务表。`of` 从当天的计数里取进度，`goal` 是达成线；达成即时结算，
     * 不需要点「领取」——多一个按钮不如少一步操作。
     */
    var DAILY_QUESTS = [
      { id: "feeds", icon: "🍽", label: "今日喂食 10 次", goal: 10, of: function (d) { return d.feeds; } },
      { id: "tools", icon: "🛠", label: "今日 5 次工具结果", goal: 5, of: function (d) { return d.tools; } },
      { id: "combo", icon: "🔥", label: "今日打到 7 连击", goal: 7, of: function (d) { return d.bestCombo; } }
    ];

    /** 任务 id → 条目。 */
    var QUEST_BY_ID = {};
    DAILY_QUESTS.forEach(function (item) { QUEST_BY_ID[item.id] = item; });

    /**
     * 台词表。每种场合一池子，取哪句由 pickLineIndex 决定 ——
     * **不用 Math.random**：同一串事件说的话必须可复现（冒烟测试要断言台词，
     * 排查「它刚才为什么说这句」也得能重放）。见 pickLineIndex 的说明。
     */
    var BUBBLE_LINES = {
      user_input: ["你说话啦？", "嗯嗯，我在听", "这个我记下了", "说吧说吧", "唔，让我想想…", "收到！", "你的字有点好吃"],
      generation: ["模型又说了一大段…", "读得饱饱的", "这段有点长", "唔…信息量好大", "慢点说，我还在嚼", "这一段够我消化一会儿", "又是一大盘字"],
      tool_result: ["工具跑完了！", "这一锅真香", "再来一个工具！", "热的！趁热吃", "这个有嚼头", "工具的味道最正", "还有吗还有吗"],
      feast: ["好大一锅！", "吃不下了…还能再来一口", "这么大一份？！", "我的天，这一盘", "撑…但是值得", "这一口顶三口"],
      favorite: ["这个我最爱！", "就是这个味儿！", "呜哇，是这个！", "等的就是它", "再来一份好不好", "对味儿了！"],
      bored: ["又是这个…有点腻了", "换个口味嘛", "唔…我吃过很多这个了", "能不能来点别的", "有点吃伤了", "还是这个味道啊"],
      frenzy: ["开吃！！", "全都端上来！", "我的时代来了！", "别停别停别停", "冲！！", "这波我能吃很多"],
      hungry: ["肚子空了…", "有零食吗？", "咕…", "我我我饿了", "看看我，饿着呢", "喂点东西嘛…"],
      snack: ["糖！", "谢谢～", "甜的！", "还有吗？", "你最好了", "唔…幸福"],
      sleep: ["Zzz…", "先睡一会儿…", "困了…", "睡一下就好…", "呼…呼…", "梦里也有工具结果吗…"],
      wake: ["呼啊——我醒了", "我睡了多久？", "唔…醒了醒了", "刚做了个梦…", "咦，你回来了", "伸个懒腰——"],
      pat: ["嘿嘿", "还要摸", "舒服～", "哼哼…再来", "唔…喜欢", "摸摸头最棒了", "尾巴也可以摸的"],
      // 连着摸好几下时换一套更黏人的：摸一下和摸十下不该是同一句
      pat_more: ["还、还要吗…", "唔…头发乱了", "别停别停", "咕噜咕噜…", "我要化了…", "你今天好黏人"],
      evolve: ["我长大了！", "看看我！变样了吧", "这就是成长吗", "换了个模样！"],
      achieve: ["达成！", "我做到了！", "记在小本本上", "厉害了我"],
      quest: ["今天的任务完成了！", "今天的活干完了！", "任务清空，撒花"],
      skill: ["我好像变熟练了", "这活我上手了！", "手感来了", "我又会一点了", "熟练度 +1！"],
      // 状态派生：以前这几件事都是静默发生的，只有面板上的数字在动
      levelup: ["升级了！", "又强了一点", "Lv 往上跳了一格", "我在变强"],
      combo: ["连上了！", "手速好快", "别停，接着来", "节奏起来了"],
      full: ["饱了！", "吃不下了…", "撑到肚子鼓鼓的", "满了满了"],
      tired: ["有点困了…", "眼睛睁不开…", "精力见底了", "撑不住了…"],
      sad: ["唔…有点难过", "你是不是不太理我了", "我不太开心…", "抱一下嘛"],
      // 情绪三维越过 moodDimAt 那一刻说的话（只在跨线的那一次说，见 bumpDim）
      curious: ["这是什么？", "没见过这个…", "让我看看让我看看", "唔，新东西！", "这个我要记下来"],
      proud: ["嘿嘿，我厉害吧", "看到了吗看到了吗", "这个我在行", "哼哼～", "夸我一下嘛"],
      worried: ["唔…没事吧？", "有点不安…", "我们会好的吧", "要不要停一下…", "我有点担心你"],
      // 关怀：走 care 那道半小时冷却，不是想说就说
      night: ["这么晚还在写代码？", "夜深了…要不歇了吧", "我陪着你，但你也别熬太久", "这个点了，眼睛还好吗"],
      marathon: ["歇会儿吧，你坐了好久了", "起来走两步？", "干了这么久了，喝口水", "我陪你到现在，你也该累了"]
    };

    /**
     * 哪几种场合算「关怀 / 闲聊」。它们走 care 那道半小时冷却，一旦说出口就
     * 不该被同一瞬间的别的台词顶掉（见 wake）—— 顶掉了冷却也白烧了。
     */
    var CARE_KINDS = { night: true, marathon: true, comeback: true, chat: true };

    /**
     * 提示语模板。和 BUBBLE_LINES 分开一张表：那张表是「说给你听的可爱话」，
     * 从池子里挑一句；这张表要往里填**当下的事实**（哪个文件、第几次），
     * 所以是函数而不是字符串，走 emitBubble 那条直接传文案的路。
     */
    var ADVICE_LINES = {
      /**
       * 措辞跟着次数升级：第 3 次是善意提醒，第 9 次就该换个说法了 ——
       * 同一句话说三遍，第三遍就成了噪音。
       * @param file - 文件名。@param count - 改了几次。
       */
      repeat_edit: function (file, count) {
        if (count >= 9) return file + " 已经第 " + String(count) + " 次了…要不先想清楚再动手？";
        if (count >= 6) return file + " 改了 " + String(count) + " 次还没好，是不是卡住了？";
        return file + " 改到第 " + String(count) + " 次了，跑个测试？";
      },
      /** @param count - 连着报了几次错。 */
      error_streak: function (count) {
        return "连着 " + String(count) + " 次报错了，先看看上一条错误？";
      },
      /** @param tool - 工具名。@param count - 这个工具连着挂了几次。 */
      tool_flaky: function (tool, count) {
        return tool + " 连着挂了 " + String(count) + " 次，换个思路试试？";
      },
      /** @param tool - 终于成功的那个工具。 */
      recovered: function (tool) {
        return tool + " 终于成了！这道坎跨过去了";
      }
    };

    /**
     * 闲聊模板：引用记忆里的东西搭一句话。和 ADVICE_LINES 分开是因为这些**没有
     * 信息量** —— 它们的作用是让宠物显得记得你，所以走 care 那道长冷却，
     * 而不是提示的那道。
     */
    var CHAT_LINES = {
      /** @param text - 已经排好的时长（「8 小时」/「3 天」）。 */
      comeback: function (text) {
        return "你去哪儿了…我等了 " + text;
      },
      /** @param file - 记忆里改得最多的那个文件。 */
      favorite_file: function (file) {
        return "又是 " + file + " 啊";
      },
      /** @param tool - 工具名。@param count - 一共用过几次。 */
      tool_habit: function (tool, count) {
        return "你已经用了 " + String(count) + " 次 " + tool + " 了";
      },
      /** @param range - busyHoursOf 排出来的时段（「21-23」）。 */
      busy_hour: function (range) {
        return "又到你干活的点了（" + range + " 点）";
      }
    };

    /**
     * 从台词池里挑一句的下标。
     *
     * 严格顺序轮换（`seq % len`）虽然可复现，但 1→2→3→1 的死循环几句就被
     * 察觉；`Math.random()` 感觉对了，可整个插件的行为就不可重放了。这里两头
     * 都要：拿 seq 过一遍散列打散成「看不出规律」的数，**再从「除了上一句之
     * 外」的 len-1 句里挑** —— 所以同一句永远不会连着出现两次，而同一串事件
     * 重跑一遍说的还是那几句。
     *
     * 散列用的是 murmur3 的收尾函数（fmix32）。这里**不能**图省事用 xorshift：
     * 种子是 1、2、3… 这种紧挨着的小整数，xorshift 出来的低位跟输入的低位几乎
     * 是线性关系，`% len` 之后周期短到肉眼可见（实测 3 句的池子会排成
     * 「0,2,0,2,0,2…」，中间那句几乎说不出来）。fmix32 的两次乘法 + 三次异或
     * 位移把高位的熵搅进低位，实测各档池子的偏差在 7% 以内、也看不出周期。
     * @param length - 池子里有几句。
     * @param seq - 递增的气泡序号（当种子用）。
     * @param last - 上一次在这个池子里取的下标（没取过传 -1）。
     * @returns 这次该取的下标。
     */
    function pickLineIndex(length, seq, last) {
      if (length <= 1) return 0;
      var x = seq | 0;
      x ^= x >>> 16;
      x = Math.imul(x, 0x85ebca6b);
      x ^= x >>> 13;
      x = Math.imul(x, 0xc2b2ae35);
      x ^= x >>> 16;
      var h = x >>> 0;
      if (last < 0 || last >= length) return h % length;
      // 在 len-1 个「不是上一句」的位置里挑，再映射回真实下标。
      var pick = h % (length - 1);
      return pick >= last ? pick + 1 : pick;
    }

    /** 心情 → 脸。卡片上那行紧凑的状态用它，一眼看出情绪档。 */
    function moodFaceOf(mood) {
      if (mood >= 80) return "😍";
      if (mood >= 50) return "🙂";
      if (mood >= 30) return "😐";
      return "😢";
    }

    /**
     * 情绪的另外三维。
     *
     * `pet.mood` 本身就是「开心」那一维（经验倍率、委屈脸都还是只看它），这三维
     * 是**纯表现**：只换表情和台词，一条数值曲线都不碰。理由是 mood 已经被
     * 食物量 / 经验倍率 / 睡眠 / 成就绑在一起了，再往里塞三个乘数只会让「为什么
     * 这一口只给了 3 经验」变成没人算得清的事。
     *
     * 数组顺序 = 同分时谁写在脸上（脸只有一张）。`line` 是越线那一刻说的话，
     * 对应 BUBBLE_LINES 里的池子。
     */
    var MOOD_DIMS = [
      { key: "pride", icon: "😤", label: "得意", line: "proud" },
      { key: "curiosity", icon: "🤔", label: "好奇", line: "curious" },
      { key: "concern", icon: "😟", label: "担忧", line: "worried" }
    ];

    /**
     * 三维的台词。它们在气泡里排在**日常台词之上、提示之下**（见 emitBubble）：
     * 比「好吃！」值钱一点，但一句「这是什么？」绝不该把紧跟着来的那条真有用的
     * 提示按下去 —— 而工具调用和它的提示常常落在同一毫秒里，光靠限流分不开。
     */
    var DIM_LINE_KINDS = { curious: true, proud: true, worried: true };

    /**
     * 三维各自的长相。眉毛是新部件（平时没有眉毛，有情绪才长出来），
     * 挂在**眼睛之外**的一层：眼睛那层在眨，眉毛跟着眨就成了抽搐。
     *
     *   brow     左右两道眉毛的路径（顺序：左、右）。
     *   eyeGrow  在形态表的 eyeGrow 之上再乘一次：好奇瞪大、得意眯起。
     *   mouth    嘴型；filled 为 true 时嘴是实心的（张着的 o 型）。
     *   blush    腮红透明度（得意时最红）。
     */
    var MOOD_FACE = {
      curiosity: {
        // 一边挑一边平：不对称才是「咦？」而不是「哦」。
        brow: [
          "M17.6 22.4C19.4 20.2 23.6 20.2 25.4 22",
          "M31.1 23.4C32.9 22.4 37.1 22.4 38.9 23.4"
        ],
        eyeGrow: 1.12,
        mouth: "M27 39.8C27 42.3 30.6 42.3 30.6 39.8C30.6 37.6 27 37.6 27 39.8Z",
        filled: true,
        blush: .5
      },
      pride: {
        // 眉毛内侧压下去 + 眼睛眯起来 = 得意。
        brow: [
          "M17.6 21.8C19.4 23.4 23.6 24 25.4 23.4",
          "M31.1 23.4C32.9 24 37.1 23.4 38.9 21.8"
        ],
        eyeGrow: .86,
        // 歪到一边的笑，比平时那条对称的弧更「有话说」。
        mouth: "M24.8 39C26.8 42.6 31.2 42 32.8 38.6",
        filled: false,
        blush: .68
      },
      concern: {
        // 八字眉：内侧抬高、外侧垂下。
        brow: [
          "M17.8 23.8C19.6 21.8 23.4 21 25.2 21.6",
          "M31.3 21.6C33.1 21 36.9 21.8 38.7 23.8"
        ],
        eyeGrow: 1.04,
        // 一条抖的波浪线，比单纯的撇嘴更「有点不安」。
        mouth: "M25.4 41.2C26.4 39.2 27.8 42.2 28.8 40.2C29.8 38.2 31.2 41.2 32.2 39.4",
        filled: false,
        blush: .34
      }
    };

    /**
     * 此刻写在脸上的那一维。三维都在 0 以上时只挑**最高的那一维**，且必须
     * 越过 moodDimAt —— 否则一点点好奇就换张脸，表情会一直抖。
     * @param pet - 宠物对象。@param config - 生效配置。
     * @returns MOOD_DIMS 里的条目；没有一维够格则 null。
     */
    function moodDimOf(pet, config) {
      if (!config.moodDimsEnabled) return null;
      var best = null;
      var bestValue = config.moodDimAt;
      for (var i = 0; i < MOOD_DIMS.length; i += 1) {
        var value = pet[MOOD_DIMS[i].key];
        if (typeof value === "number" && value >= bestValue) {
          // >= 而不是 >：数组靠前的那一维赢下同分（见 MOOD_DIMS 的注释）。
          if (best === null || value > bestValue) { best = MOOD_DIMS[i]; bestValue = value; }
        }
      }
      return best;
    }

    /**
     * 闲下来的小动作。顺序固定，挑哪个走 pickLineIndex（和台词同一套确定性
     * 伪随机），于是「它刚才为什么打了个哈欠」也能重放。
     */
    var IDLE_ACTS = ["yawn", "wag", "roll", "peek"];

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
      /* 睡着了：整张卡片压暗一档，别在夜里发亮。 */
      ".dshpet-card[data-asleep=true]{opacity:.72}",
      /* 暴食 BUFF：卡片描一圈暖橙，和「饿了」的红警示区分得开。 */
      ".dshpet-card[data-buff=frenzy]{border-color:rgba(255,159,67,.7);",
      "box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.35)),0 0 16px rgba(255,159,67,.4)}",
      /* 拖着的时候换抓手光标，并停掉过渡，免得卡片追着指针慢半拍。 */
      ".dshpet-card[data-dragging=true]{cursor:grabbing;transition:none}",

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
      /* 眼睛跟鼠标：偏移量是 .dshpet-root 上的两个自定义属性，由一个
         pointermove 监听直接写（不进 React 状态，见 trackEyes）。整条链上
         没有一次 re-render —— 鼠标一动就重渲染整张卡片是划不来的。
         瞳孔单独一层，因为 .dshpet-whale-eyes 那层在眨（scaleY），
         偏移写在眨眼那层上会被眨眼的 transform 整条覆盖掉。 */
      ".dshpet-whale-pupil{transform:translate(var(--dshpet-eye-x,0px),var(--dshpet-eye-y,0px));",
      "transition:transform 140ms ease-out}",
      /* 眉毛：平时没有，有情绪才长出来（见 MOOD_FACE）。刻意不挂动画 ——
         它跟眼睛是两层，一起眨会变成抽搐。 */
      ".dshpet-whale-brow{animation:dshpet-brow-in 260ms ease-out both}",
      /* 进食那一刻：卡片给头像挂 .dshpet-eating，顺带让嘴张一下、腮红烧一下。 */
      ".dshpet-eating .dshpet-whale-mouth{animation:dshpet-whale-chew 400ms ease-out}",
      ".dshpet-eating .dshpet-whale-blush{animation:dshpet-whale-blush 620ms ease-out}",
      /* 摸头的手感：整只鲸被按扁一下再弹回来。和 .dshpet-eating 二选一
         （见 lastAct）：两个动画都在动同一个 span 的 transform。 */
      ".dshpet-patted{animation:dshpet-pat-squish 420ms ease-out}",
      /* 闲下来的小动作：卡片挂 data-idle，各自只动一个部件。两个复用了既有的
         keyframes（摆尾 / 眨眼），只是把时长压短、次数写死 —— 待机动作和
         「刚做了个小动作」的区别本来就只是节奏。 */
      ".dshpet-card[data-idle=wag] .dshpet-whale-tail{",
      "animation:dshpet-whale-wag 300ms ease-in-out 4}",
      ".dshpet-card[data-idle=peek] .dshpet-whale-eyes{",
      "animation:dshpet-whale-blink 700ms ease-in-out 2}",
      ".dshpet-card[data-idle=yawn] .dshpet-whale-mouth{",
      "animation:dshpet-idle-yawn 1400ms ease-in-out}",
      ".dshpet-card[data-idle=roll] .dshpet-whale-body{",
      "animation:dshpet-idle-roll 1400ms ease-in-out}",
      ".dshpet-halo{position:absolute;inset:-12px;border-radius:50%;pointer-events:none;",
      "background:radial-gradient(circle,rgba(255,214,102,.55),rgba(255,214,102,0) 70%);",
      "animation:dshpet-glow-pulse 900ms ease-in-out infinite}",
      /* 进阶那一刻头像外面炸开的一圈金环。both 收在透明态，所以特效撤掉
         之前它就已经看不见了，不会闪回。 */
      ".dshpet-evolve{position:absolute;inset:-14px;border-radius:50%;pointer-events:none;",
      "border:2px solid rgba(242,199,68,.9);",
      "animation:dshpet-evolve-ring 1400ms ease-out both}",

      /* 睡着时头顶那个飘上去的 Zzz。 */
      ".dshpet-zzz{position:absolute;top:-10px;right:-8px;font-size:14px;line-height:1;",
      "pointer-events:none;animation:dshpet-zzz-drift 2.6s ease-in-out infinite}",

      /* 台词气泡：贴在卡片左上方，尖角朝下指着宠物。整条穿透 —— 它只是台词，
         不该抢走卡片的点击。 */
      ".dshpet-bubble{position:absolute;bottom:100%;right:8px;margin-bottom:8px;",
      "max-width:210px;padding:5px 9px;border-radius:12px;pointer-events:none;",
      "font-size:11px;line-height:15px;white-space:nowrap;",
      "color:var(--dsw-alias-label-primary,#eaeaea);",
      "background:var(--dsw-alias-bg-layer-3,rgba(38,38,44,.94));",
      "border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));",
      "box-shadow:var(--dsw-shadow-lv2,0 4px 14px rgba(0,0,0,.3));",
      "animation:dshpet-bubble-in 220ms ease-out both}",
      ".dshpet-bubble::after{content:\"\";position:absolute;right:16px;bottom:-5px;",
      "width:8px;height:8px;transform:rotate(45deg);",
      "background:var(--dsw-alias-bg-layer-3,rgba(38,38,44,.94));",
      "border-right:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));",
      "border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))}",
      /* 提示（「这文件你改到第 3 次了」）不是日常台词：给一道暖色左边框，
         让「它在说一件跟你手上的活有关的事」一眼可辨。 */
      ".dshpet-bubble[data-kind=advice]{border-left:3px solid #ffd34d;",
      "white-space:normal;font-weight:600}",
      /* 关怀与闲聊（「这么晚还在写代码？」「又是 client.js 啊」）：也不是日常
         台词，但它没有信息量，所以给一道**冷色**细边框而不是提示那道暖色 ——
         「它在关心你」和「它在告诉你一件事」得能一眼分开。不加粗。 */
      ".dshpet-bubble[data-kind=night],.dshpet-bubble[data-kind=marathon],",
      ".dshpet-bubble[data-kind=comeback],.dshpet-bubble[data-kind=chat]{",
      "border-left:3px solid #6cc7e8;white-space:normal}",

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
      ".dshpet-bar-mood>i{background:#ff86ac}",
      ".dshpet-bar-energy>i{background:#47e6b1}",
      /* 心情 / 精力见底：换成告警色，和饱食条同一套语言。 */
      ".dshpet-bar-mood[data-low=true]>i{background:#ff5f6d}",
      ".dshpet-bar-energy[data-low=true]>i{background:#ffd34d}",
      /* 卡片上那行紧凑状态：一个脸 + 心情 / 精力数字，等宽免得跳动。 */
      ".dshpet-vitals{white-space:nowrap;font-variant-numeric:tabular-nums}",
      /* 徽章行：解锁的亮着，没解锁的压到很暗（位置留着，好知道还有几个）。 */
      ".dshpet-badges{display:flex;flex-wrap:wrap;gap:2px;font-size:11px;line-height:14px}",
      ".dshpet-badge{opacity:.22;filter:grayscale(1)}",
      ".dshpet-badge[data-owned=true]{opacity:1;filter:none}",
      /* 饿了：饱食条转红 + 卡片边框告警。纯表现，宠物并不会真的饿死。 */
      ".dshpet-bar-full[data-low=true]>i{background:#ff5f6d}",
      ".dshpet-card[data-hungry=true]{border-color:rgba(255,95,109,.55);",
      "box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.35)),0 0 12px rgba(255,95,109,.28)}",

      /* 零食按钮：卡片的第三格，折叠时也在（折叠只藏 .dshpet-meta）。
         按钮不继承宿主字体，所以显式 font:inherit；.dshpet-root 是穿透的，
         所以这里要把指针事件收回来。 */
      ".dshpet-snack,.dshpet-badge-btn{pointer-events:auto;flex-shrink:0;display:flex;",
      "align-items:center;gap:3px;",
      "margin:0;padding:5px 7px;border-radius:10px;cursor:pointer;font:inherit;font-size:16px;",
      "line-height:1;color:inherit;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.08));",
      "border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));",
      "transition:background 160ms ease-out}",
      ".dshpet-snack:hover,.dshpet-badge-btn:hover{background:rgba(255,255,255,.18)}",
      ".dshpet-snack:active,.dshpet-badge-btn:active{transform:scale(.94)}",
      ".dshpet-snack:disabled{opacity:.38;cursor:default;transform:none}",
      /* 面板开着的时候按钮保持按下的样子，好知道是它开的。 */
      ".dshpet-badge-btn[data-open=true]{background:rgba(77,107,254,.28);",
      "border-color:rgba(77,107,254,.6)}",
      /* 攒着零食又饿着：晃一下提醒你点它。 */
      ".dshpet-snack[data-urge=true]{animation:dshpet-snack-urge 1.4s ease-in-out infinite}",
      ".dshpet-snack-n{font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;",
      "color:var(--dsw-alias-label-secondary,#a9a9b2)}",

      /* 成就 / 任务面板：从卡片上方展开。它自己吃指针事件（里面有可滚动的
         徽章格），但点它不该冒泡到卡片上去把卡片折叠了（见 onClick 的守卫）。 */
      ".dshpet-panel{pointer-events:auto;position:absolute;bottom:100%;right:0;",
      "margin-bottom:8px;width:236px;display:flex;flex-direction:column;gap:6px;",
      "padding:10px;border-radius:14px;cursor:default;",
      "color:var(--dsw-alias-label-primary,#eaeaea);",
      "background:var(--dsw-alias-bg-layer-2,rgba(22,22,26,.94));",
      "border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));",
      "box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.35));",
      /* 面板从三段（状态 / 任务 / 成就）长到五段（+ 技能 / 记忆），小屏上
         装不下了，所以给它一个高度上限并允许滚动。 */
      "max-height:min(70vh,520px);overflow-y:auto;",
      "animation:dshpet-panel-in 180ms ease-out both}",
      ".dshpet-panel-title{font-size:11px;font-weight:700;line-height:14px;",
      "color:var(--dsw-alias-label-secondary,#a9a9b2)}",
      ".dshpet-quest{display:flex;align-items:center;gap:6px;font-size:11px;line-height:15px}",
      ".dshpet-quest-n{margin-left:auto;font-variant-numeric:tabular-nums;",
      "color:var(--dsw-alias-label-secondary,#a9a9b2)}",
      /* 完成的任务划掉：一眼扫出还剩哪几条。 */
      ".dshpet-quest[data-done=true]{color:#47e6b1;text-decoration:line-through}",
      /* 技能行：图标 + 名字 + Lv.N + 一条细进度条（条子固定宽，四行对得齐）。 */
      ".dshpet-skill{display:flex;align-items:center;gap:6px;font-size:11px;line-height:15px}",
      ".dshpet-skill-n{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:700;",
      "color:var(--dsw-alias-label-secondary,#a9a9b2)}",
      /* 这条是 span（面板里那一行是 flex），所以要自己把 display 变回块。 */
      ".dshpet-bar-skill{display:block;flex:0 0 56px;height:3px}",
      ".dshpet-bar-skill>i{background:#c86dd7}",
      ".dshpet-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;",
      "font-size:17px;line-height:1.2;text-align:center}",

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
      /* 睡着时那个 Zzz 往上飘一小段，飘到头再淡出重来。 */
      "@keyframes dshpet-zzz-drift{",
      "0%{opacity:0;transform:translate(0,2px) scale(.8)}",
      "30%{opacity:1}",
      "100%{opacity:0;transform:translate(4px,-10px) scale(1.1)}}",
      "@keyframes dshpet-bubble-in{",
      "0%{opacity:0;transform:translateY(4px) scale(.94)}",
      "100%{opacity:1;transform:translateY(0) scale(1)}}",
      "@keyframes dshpet-panel-in{",
      "0%{opacity:0;transform:translateY(6px)}",
      "100%{opacity:1;transform:translateY(0)}}",
      /* 眉毛长出来：从眼睛那头滑上去一小段，别让它「啪」地出现。 */
      "@keyframes dshpet-brow-in{",
      "0%{opacity:0;transform:translateY(1.5px)}",
      "100%{opacity:1;transform:translateY(0)}}",
      /* 摸头：按扁一下再弹回来。比 eat-bounce 更「被戳了」而不是「在吃」。 */
      "@keyframes dshpet-pat-squish{",
      "0%,100%{transform:scale(1,1)}",
      "35%{transform:scale(1.12,.86) translateY(1.5px)}",
      "70%{transform:scale(.96,1.06)}}",
      /* 打哈欠：嘴慢慢张到很大再收回去（scaleY 比换路径便宜，也不用重渲染）。 */
      "@keyframes dshpet-idle-yawn{",
      "0%,100%{transform:scaleY(1)}",
      "25%{transform:scaleY(2.6) translateY(1px)}",
      "55%{transform:scaleY(3) translateY(1.2px)}",
      "85%{transform:scaleY(1.2)}}",
      /* 翻个身：整只鲸慢慢侧过去再翻回来。 */
      "@keyframes dshpet-idle-roll{",
      "0%,100%{transform:rotate(0) translateY(0)}",
      "30%{transform:rotate(-13deg) translateY(-1.5px)}",
      "65%{transform:rotate(11deg) translateY(-1px)}}",

      /* 降级：尊重系统的减少动效偏好。 */
      "@media (prefers-reduced-motion:reduce){",
      ".dshpet-food,.dshpet-float,.dshpet-eating,.dshpet-halo,.dshpet-evolve,",
      ".dshpet-snack[data-urge=true],.dshpet-bubble,.dshpet-panel,",
      ".dshpet-combo[data-tier=gold],.dshpet-combo[data-tier=epic],",
      ".dshpet-card[data-tier=gold],.dshpet-card[data-tier=epic],",
      ".dshpet-whale-body,.dshpet-whale-tail,.dshpet-whale-fin,.dshpet-whale-eyes,",
      ".dshpet-whale-spout,.dshpet-whale-sparkle,.dshpet-whale-brow,.dshpet-patted,",
      ".dshpet-eating .dshpet-whale-mouth,.dshpet-eating .dshpet-whale-blush,",
      /* 小动作在这个偏好下根本不会被触发（trackEyes 之外 store 也不排它），
         这几条是双保险：万一存档里留着一个 data-idle，也别动。 */
      ".dshpet-card[data-idle=wag] .dshpet-whale-tail,",
      ".dshpet-card[data-idle=peek] .dshpet-whale-eyes,",
      ".dshpet-card[data-idle=yawn] .dshpet-whale-mouth,",
      ".dshpet-card[data-idle=roll] .dshpet-whale-body",
      "{animation:none}",
      /* 喷水柱与 Zzz 都是靠动画才可见的，关动画后给它们一个静态可见态。 */
      ".dshpet-whale-spout{opacity:1}",
      /* 眉毛的动画是 both，关掉动画会停在 0% 的透明态，所以显式写回可见。 */
      ".dshpet-whale-brow{opacity:1}",
      /* 眼睛也别跟着鼠标飘（listener 本来就不挂，这条兜住已经写进去的值）。 */
      ".dshpet-whale-pupil{transform:none;transition:none}",
      ".dshpet-zzz{animation:none;opacity:1}}"
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
        // 另外三维从 0 起：刚认识没什么可好奇、可得意、可担忧的（见 MOOD_DIMS）。
        curiosity: 0,
        pride: 0,
        concern: 0,
        exp: 0,
        level: 1
      };
      // 只继承进度数字：名字 / 种族 / 形象永远跟当前配置走。
      if (saved !== null && saved !== undefined) {
        pet.mood = saved.mood;
        pet.hunger = saved.hunger;
        pet.energy = saved.energy;
        pet.curiosity = saved.curiosity;
        pet.pride = saved.pride;
        pet.concern = saved.concern;
        pet.exp = saved.exp;
        pet.level = saved.level;
      }
      return pet;
    }

    /**
     * 心情 → 经验倍率。满心情 ×(1 + swing/2)、零心情 ×(1 - swing/2)，
     * 默认 swing = 0.4 ⇒ 0.8x ~ 1.2x。心情是「养得好不好」的长期项，所以
     * 摆幅刻意做得比连击（最高 3.0x）小一截：它是底噪，不是主导项。
     * @param pet - 宠物状态。
     * @param config - 生效配置。
     * @returns 倍率。
     */
    function moodFactorOf(pet, config) {
      if (!config.vitalsEnabled) return 1;
      return 1 - config.moodExpSwing / 2 + config.moodExpSwing * (pet.mood / 100);
    }

    /**
     * 心情 + 精力合起来的经验倍率：心情给一个连续的摆幅，精力见底再打个折
     * （困着的宠物学得慢）。
     * @param pet - 宠物状态。
     * @param config - 生效配置。
     * @returns 倍率。
     */
    function vitalFactorOf(pet, config) {
      if (!config.vitalsEnabled) return 1;
      var tired = pet.energy < config.lowEnergyAt ? config.tiredExpFactor : 1;
      return moodFactorOf(pet, config) * tired;
    }

    /**
     * epoch ms → 本地日序号（同一天的两个时刻算出同一个整数，相邻两天差 1）。
     *
     * 每日任务与连续到访都按**本地**日切换，所以要把时区偏移算进去；
     * 直接 `floor(now / 86400000)` 切在 UTC 零点，对东八区的人是早上 8 点。
     * @param now - 时刻（epoch ms）。
     * @returns 日序号。
     */
    function dayIndexOf(now) {
      var offsetMs = new Date(now).getTimezoneOffset() * 60000;
      return Math.floor((now - offsetMs) / 86400000);
    }

    /**
     * 把拖拽偏移夹回「还看得见」的范围内。
     *
     * 卡片本来贴在右下角，所以往左 / 往上（负方向）能走整个视口，往右 / 往下
     * 只留一点点余量。夹的是偏移量而不是元素矩形：量元素得先渲染，而这里要在
     * 每个 pointermove 上算一次。留 `MARGIN` 的余量是为了「至少还揪得住一角」。
     * @param pos - { dx, dy } 候选偏移。
     * @returns 夹过的 { dx, dy }。
     */
    function clampPos(pos) {
      var MARGIN = 48;
      var width = 1920;
      var height = 1080;
      if (typeof window !== "undefined") {
        if (typeof window.innerWidth === "number" && window.innerWidth > 0) width = window.innerWidth;
        if (typeof window.innerHeight === "number" && window.innerHeight > 0) height = window.innerHeight;
      }
      return {
        dx: clamp(Math.round(pos.dx), -(width - MARGIN), MARGIN),
        dy: clamp(Math.round(pos.dy), -(height - MARGIN), MARGIN)
      };
    }

    /**
     * 喂一次食：hunger 下降、exp 累积、够了就升级，顺带动一下心情 / 精力。
     * 返回新对象（React 靠引用变化重渲染）。
     * @param pet - 当前宠物状态。
     * @param food - 本次食物量。
     * @param exp - 本次经验值。
     * @param moodDelta - 心情变化量（可负，缺省 0）。
     * @param energyDelta - 精力变化量（可负，缺省 0）。
     * @returns 喂食后的宠物状态。
     */
    function feedPet(pet, food, exp, moodDelta, energyDelta) {
      var moodUp = typeof moodDelta === "number" ? moodDelta : 0;
      var energyUp = typeof energyDelta === "number" ? energyDelta : 0;
      var next = {
        name: pet.name,
        species: pet.species,
        avatar: pet.avatar,
        icon: pet.icon,
        mood: clamp(pet.mood + moodUp, 0, 100),
        hunger: Math.max(0, pet.hunger - food),
        energy: clamp(pet.energy + energyUp, 0, 100),
        // 三维原样带过来：这个函数是整只 pet 逐字段重建的，漏一个就静默清零。
        curiosity: pet.curiosity,
        pride: pet.pride,
        concern: pet.concern,
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
     * 一份空技能表：四条技能各自 { xp, level }。
     * @param saved - 存档里的技能表；没有传 null。
     * @returns 技能表。
     */
    function createSkills(saved) {
      var skills = {};
      SKILLS.forEach(function (item) {
        var from = saved === null || saved === undefined ? undefined : saved[item.key];
        skills[item.key] = from === undefined ? { xp: 0, level: 1 } : from;
      });
      return skills;
    }

    /**
     * 一份空记忆：还没见过任何文件 / 工具，从今天开始相处。
     * @param today - 今天的日序号。
     * @returns 记忆对象。
     */
    function createMemory(today) {
      var hours = [];
      for (var h = 0; h < 24; h += 1) hours.push(0);
      return { files: [], tools: [], hours: hours, bornDay: today, errors: 0, recoveries: 0 };
    }

    /**
     * 相处了几天（第一天就是 1 天）。
     * @param memory - 记忆对象。
     * @param now - 当前时刻（epoch ms）。
     * @returns 天数（至少 1）。
     */
    function togetherDaysOf(memory, now) {
      return Math.max(1, dayIndexOf(now) - memory.bornDay + 1);
    }

    /**
     * 工具名 → 技能 key。不认识的工具算探索（见 SKILL_FALLBACK）。
     * @param toolName - 工具名（tool/call 的 data.name）。
     * @returns 技能 key。
     */
    function skillOf(toolName) {
      var key = TOOL_SKILL[toolName];
      return key === undefined ? SKILL_FALLBACK : key;
    }

    /**
     * 这一级还差多少技能经验才能升级。
     * @param level - 当前技能等级。
     * @param config - 生效配置（读 skillXpPerLevel）。
     * @returns 升级所需的经验。
     */
    function skillNeedOf(level, config) {
      return level * config.skillXpPerLevel;
    }

    /**
     * 给一条技能加经验，够了就升级（可能连升几级）。形状对齐 feedPet：
     * 返回新对象，React 靠引用变化重渲染。
     *
     * 满级之后经验停在「离升级还差 1 点」而不是继续涨：面板上那条进度条到顶
     * 就该是满的，而不是一个永远在涨、永远不会兑现的数字。
     * @param skills - 当前技能表。
     * @param key - 技能 key。
     * @param xp - 这次加多少经验。
     * @param config - 生效配置（读 skillXpPerLevel / skillMaxLevel）。
     * @returns { skills, ups }：新技能表 + 这次升到的等级列表（升了几级就几条）。
     */
    function gainSkill(skills, key, xp, config) {
      var from = skills[key];
      if (from === undefined || xp <= 0) return { skills: skills, ups: [] };
      var level = from.level;
      var have = from.xp + xp;
      var ups = [];
      while (level < config.skillMaxLevel && have >= skillNeedOf(level, config)) {
        have -= skillNeedOf(level, config);
        level += 1;
        ups.push({ key: key, level: level });
      }
      if (level >= config.skillMaxLevel) have = Math.min(have, skillNeedOf(level, config) - 1);
      var next = Object.assign({}, skills);
      next[key] = { xp: have, level: level };
      return { skills: next, ups: ups };
    }

    /**
     * 记忆表（文件 / 工具）的增计数：给 name 那行 +1，按次数降序排好，超容量
     * 就挤掉一行。
     *
     * 挤的是**同分里最靠前的那个**（= 最久没被碰过的那个），而不是末行 ——
     * 末行往往正是刚进来的新面孔，挤它等于让记忆冻在第一天。
     * @param rows - 当前的行数组（降序）。
     * @param name - 这次碰到的名字。
     * @param cap - 行数上限。
     * @returns 新的行数组。
     */
    function bumpCount(rows, name, cap) {
      var next = [];
      var found = false;
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].name === name) {
          next.push({ name: name, count: rows[i].count + 1 });
          found = true;
        } else {
          next.push({ name: rows[i].name, count: rows[i].count });
        }
      }
      if (!found) next.push({ name: name, count: 1 });
      // sort 是稳定的，所以同分的一串仍然保持「先进来的在前」。
      next.sort(function (a, b) { return b.count - a.count; });
      while (next.length > cap) {
        var min = next[next.length - 1].count;
        var at = next.length - 1;
        while (at > 0 && next[at - 1].count === min) at -= 1;
        next.splice(at, 1);
      }
      return next;
    }

    /**
     * 系统开了「减少动效」偏好吗。
     *
     * 样式表里那条 `@media (prefers-reduced-motion:reduce)` 已经把动画全关了，
     * 这个函数管的是**别把事情做起来**：眼睛跟鼠标那个监听、闲下来的小动作，
     * 关了动画也还是会白跑一趟。取不到 matchMedia 就当没开 —— 那是老浏览器或
     * 测试环境，宁可动起来也别静默地把一整套表现关掉。
     * @returns 开了就是 true。
     */
    function prefersReducedMotion() {
      if (typeof window === "undefined") return false;
      if (typeof window.matchMedia !== "function") return false;
      var query = window.matchMedia("(prefers-reduced-motion: reduce)");
      return query !== null && query !== undefined && query.matches === true;
    }

    /**
     * 记忆表里有没有这一行。「第一次见到的东西」要在 bumpCount 之前问，问完
     * 才涨好奇心 —— 涨完再问的话，每次都是「见过」。
     * @param rows - 行数组。@param name - 名字。
     * @returns 见过就是 true。
     */
    function hasRow(rows, name) {
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].name === name) return true;
      }
      return false;
    }

    /**
     * 路径 → 文件名。记忆里只留 basename：够用来说「client.js 改到第 3 次了」，
     * 又不把整棵目录树落进 localStorage。
     * @param path - 任意路径（可能是 Windows 的反斜杠）。
     * @returns 文件名（截到 40 字）；取不出来就 null。
     */
    function baseNameOf(path) {
      if (typeof path !== "string" || path === "") return null;
      var parts = path.split(/[\\/]/);
      for (var i = parts.length - 1; i >= 0; i -= 1) {
        if (parts[i] !== "") return parts[i].slice(0, 40);
      }
      return null;
    }

    /**
     * 活动直方图 → 「你常在几点干活」。取三小时的滑动窗口里最热的那一段
     * （跨零点也算，所以窗口是环形的）。
     * @param hours - 24 格的活动计数。
     * @returns "21-23" 这样的文本；一次活动都没有则 null。
     */
    function busyHoursOf(hours) {
      var best = 0;
      var at = -1;
      for (var start = 0; start < 24; start += 1) {
        var sum = hours[start] + hours[(start + 1) % 24] + hours[(start + 2) % 24];
        if (sum > best) {
          best = sum;
          at = start;
        }
      }
      if (at < 0) return null;
      return String(at) + "-" + String((at + 2) % 24);
    }

    /**
     * 把「离开了多久」排成一句人话。只取一个量级（不写「1 天 3 小时」）——
     * 这是句闲聊，不是计时器。
     * @param ms - 离开的时长（毫秒）。
     * @returns 「40 分钟」/「8 小时」/「3 天」。
     */
    function awayTextOf(ms) {
      var hours = Math.floor(ms / 3600000);
      if (hours < 1) return String(Math.max(1, Math.floor(ms / 60000))) + " 分钟";
      if (hours < 24) return String(hours) + " 小时";
      return String(Math.floor(hours / 24)) + " 天";
    }

    /**
     * 现在算不算「深夜」。From > To 时表示跨午夜（比如 23 → 4）。
     * @param hour - 本地小时（0-23）。
     * @param from - 起点小时（含）。
     * @param to - 终点小时（含）。
     * @returns 落在区间里就是 true。
     */
    function isNightHour(hour, from, to) {
      if (from <= to) return hour >= from && hour <= to;
      return hour >= from || hour <= to;
    }

    /**
     * 洗一份 id 列表（成就 / 已完成任务）：只留白名单里认得的 id，去重、保序。
     *
     * 存档里的这两个字段是数组，而不是标量，所以不能走 numberIn 那一路；
     * 白名单过滤同时挡住了「手改控制台塞进来的假 id」和「旧版本删掉的条目」。
     * @param value - 原始值（期望是字符串数组）。
     * @param table - id → 条目 的白名单表。
     * @returns 清洗后的 id 数组。
     */
    function sanitizeIds(value, table) {
      if (!Array.isArray(value)) return [];
      var kept = [];
      for (var i = 0; i < value.length; i += 1) {
        var id = value[i];
        if (typeof id !== "string") continue;
        if (!Object.prototype.hasOwnProperty.call(table, id)) continue;
        if (kept.indexOf(id) >= 0) continue;
        kept.push(id);
      }
      return kept;
    }

    /**
     * 洗一份当天的任务进度。`day` 对不上今天的话整份丢掉（换天就该从零开始），
     * 所以这里同时承担了「跨天重置」的职责。
     * @param value - 原始值。
     * @param today - 今天的日序号。
     * @returns 当天的进度对象。
     */
    function sanitizeDaily(value, today) {
      var empty = { day: today, feeds: 0, tools: 0, bestCombo: 0, done: [] };
      if (value === null || typeof value !== "object") return empty;
      if (numberIn(value.day, 0, 1e9, -1) !== today) return empty;
      return {
        day: today,
        feeds: numberIn(value.feeds, 0, 1e6, 0),
        tools: numberIn(value.tools, 0, 1e6, 0),
        bestCombo: numberIn(value.bestCombo, 0, 1e6, 0),
        done: sanitizeIds(value.done, QUEST_BY_ID)
      };
    }

    /**
     * 洗一份卡片位移（拖拽换过的位置）。范围给得比任何屏幕都宽，真正的夹取
     * 在 store 里按当时的视口做——存档里的屏幕尺寸和现在这块屏没关系。
     * @param value - 原始值。
     * @returns { dx, dy }。
     */
    function sanitizePos(value) {
      if (value === null || typeof value !== "object") return { dx: 0, dy: 0 };
      return {
        dx: numberIn(value.dx, -8192, 8192, 0),
        dy: numberIn(value.dy, -8192, 8192, 0)
      };
    }

    /**
     * 洗一份技能表：只认 SKILLS 里的四个 key，等级夹进 [1, skillMaxLevel]，
     * 经验夹进这一级的需求量（存档里的天文数字不该让 gainSkill 空转，和
     * sanitizeSaved 夹 exp 是同一条理由）。
     * @param value - 原始值。
     * @param config - 生效配置（读 skillXpPerLevel / skillMaxLevel）。
     * @returns 技能表。
     */
    function sanitizeSkills(value, config) {
      var raw = value === null || typeof value !== "object" ? {} : value;
      var skills = {};
      SKILLS.forEach(function (item) {
        var from = raw[item.key];
        if (from === null || typeof from !== "object") {
          skills[item.key] = { xp: 0, level: 1 };
          return;
        }
        var level = numberIn(from.level, 1, config.skillMaxLevel, 1);
        skills[item.key] = {
          xp: numberIn(from.xp, 0, skillNeedOf(level, config), 0),
          level: level
        };
      });
      return skills;
    }

    /**
     * 洗一份记忆表的行数组（文件 / 工具）：丢掉不成形的行，名字按 basename
     * 规则截断，按次数降序，砍到容量上限。
     * @param value - 原始值（期望是 { name, count } 数组）。
     * @param cap - 行数上限。
     * @returns 清洗后的行数组。
     */
    function sanitizeRows(value, cap) {
      if (!Array.isArray(value)) return [];
      var rows = [];
      var seen = {};
      for (var i = 0; i < value.length; i += 1) {
        var row = value[i];
        if (row === null || typeof row !== "object") continue;
        var name = baseNameOf(row.name);
        if (name === null) continue;
        if (Object.prototype.hasOwnProperty.call(seen, name)) continue;
        seen[name] = true;
        rows.push({ name: name, count: numberIn(row.count, 1, 1e9, 1) });
      }
      rows.sort(function (a, b) { return b.count - a.count; });
      return rows.slice(0, cap);
    }

    /**
     * 洗一份宠物记忆。
     * @param value - 原始值。
     * @param config - 生效配置（读 memoryFileTop）。
     * @param today - 今天的日序号（bornDay 缺失时的兜底）。
     * @returns 记忆对象。
     */
    function sanitizeMemory(value, config, today) {
      var raw = value === null || typeof value !== "object" ? {} : value;
      var hours = [];
      var from = Array.isArray(raw.hours) ? raw.hours : [];
      for (var h = 0; h < 24; h += 1) hours.push(numberIn(from[h], 0, 1e9, 0));
      // bornDay 不能只夹范围：0 / 负数会被夹成 0，于是面板上写「相处 20460 天」，
      // 比没有这个字段更糟。落在「有意义的过去」之外就当作没记过。
      var bornDay = numberIn(raw.bornDay, 0, 1e9, -1);
      if (bornDay <= 0 || bornDay > today) bornDay = today;
      return {
        files: sanitizeRows(raw.files, config.memoryFileTop + MEMORY_SLACK),
        tools: sanitizeRows(raw.tools, MEMORY_TOOL_TOP),
        hours: hours,
        // 老存档没有 bornDay：兜底成今天，于是「相处 N 天」从现在开始数，
        // 而不是显示一个假的大数字。
        bornDay: bornDay,
        errors: numberIn(raw.errors, 0, 1e9, 0),
        recoveries: numberIn(raw.recoveries, 0, 1e9, 0)
      };
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
      var today = dayIndexOf(Date.now());
      return {
        savedAt: numberIn(parsed.savedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        pet: {
          hunger: numberIn(pet.hunger, 0, 100, 60),
          mood: numberIn(pet.mood, 0, 100, 80),
          energy: numberIn(pet.energy, 0, 100, 75),
          // 情绪三维：老存档没有这几个字段，兜底 0 = 没情绪，和新养的一样。
          curiosity: numberIn(pet.curiosity, 0, 100, 0),
          pride: numberIn(pet.pride, 0, 100, 0),
          concern: numberIn(pet.concern, 0, 100, 0),
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
        },
        // 下面这些都是 0.2.0 加的字段。和 snacks 当年一样，**不动版本号**：
        // 缺字段的老存档走各自的兜底（空列表 / 0 / 不位移），等级和累计一个不丢。
        achievements: sanitizeIds(parsed.achievements, ACHIEVEMENT_BY_ID),
        daily: sanitizeDaily(parsed.daily, today),
        // 上一次「有喂食」的那一天，以及到那天为止连了几天。
        streakDay: numberIn(parsed.streakDay, 0, 1e9, 0),
        streakCount: numberIn(parsed.streakCount, 0, 1e6, 0),
        pats: numberIn(parsed.pats, 0, 1e9, 0),
        pos: sanitizePos(parsed.pos),
        // 最后一次被喂 / 被摸的时刻：睡眠状态是从它算出来的，所以要存。
        lastFeedAt: numberIn(parsed.lastFeedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        // 0.3.0 新增的两份长期积累。仍然**不动版本号**，理由同上：
        // 老存档缺这两个字段就从空技能 / 空记忆开始养，别的进度一个不丢。
        skills: sanitizeSkills(parsed.skills, config),
        memory: sanitizeMemory(parsed.memory, config, today)
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
            energy: pet.energy,
            curiosity: pet.curiosity,
            pride: pet.pride,
            concern: pet.concern
          },
          totalFeeds: state.totalFeeds,
          totalTokens: state.totalTokens,
          tokensBySource: state.tokensBySource,
          snacks: state.snacks,
          // 长期积累也归进度：徽章、当天的任务进度、连续到访、摸头次数、
          // 拖到哪儿了、以及睡眠要用的「最后一次互动时刻」。
          achievements: state.achievements,
          daily: state.daily,
          streakDay: state.streakDay,
          streakCount: state.streakCount,
          pats: state.pats,
          pos: state.pos,
          lastFeedAt: state.lastFeedAt,
          // 技能与记忆：养出来的东西，刷新不该归零。
          skills: state.skills,
          memory: state.memory
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
     *
     * `output` 单独拆出来给「表达」技能用：那条技能长的是**模型写了多少字**，
     * 跟上下文有多长没关系，所以不能拿 tokens 凑。
     * @param event - 原始 session 事件。
     * @returns { source, tokens, output } 或 null。
     */
    function classify(event) {
      if (event.type === "user/message") {
        var message = event.data;
        if (message === null || typeof message !== "object") return null;
        var source = message.source;
        if (source === null || typeof source !== "object" || source.kind !== "user") return null;
        return {
          source: "user_input",
          tokens: Math.floor(textLengthOf(message.content) / 4),
          output: 0
        };
      }
      if (event.type === "assistant/message") {
        var usage = event.data === null ? undefined : event.data.usage;
        if (usage === null || typeof usage !== "object") return null;
        // outputTokens 缺失 = adapter 没报 usage，这一条不算一次 generation。
        if (typeof usage.outputTokens !== "number") return null;
        // 这一步真实的消耗是 input + output：上下文越长，喂的分量越大。
        var inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
        return {
          source: "generation",
          tokens: usage.outputTokens + inputTokens,
          output: Math.max(0, usage.outputTokens)
        };
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
        return { source: "tool_result", tokens: Math.max(Math.floor(bytes / 4), 1), output: 0 };
      }
      return null;
    }

    /**
     * 从 tool/call 的 arguments（JSON 字符串）里挖出「这次动的是哪个文件」。
     *
     * 文件类工具的线上参数名是 `file_path`；`path` 是给外部 / MCP 工具留的
     * 别名。解析不出来就 null —— 大多数工具本来就不带文件。
     * @param raw - data.arguments。
     * @returns 文件名，或 null。
     */
    function fileArgOf(raw) {
      if (typeof raw !== "string" || raw === "") return null;
      var args;
      try {
        args = JSON.parse(raw);
      } catch (error) {
        return null;
      }
      if (args === null || typeof args !== "object") return null;
      var name = baseNameOf(args.file_path);
      return name === null ? baseNameOf(args.path) : name;
    }

    /**
     * 把一条 tool/call 归成一次「观察」：谁被调用了、动的哪个文件。
     *
     * 注意这条事件**不喂食**：不进 combo、不进 token 统计、不动饱食 / 心情 /
     * 精力、不算今天来喂过。否则一轮工具循环里 call 和 result 各记一次账，
     * combo 会翻倍、消耗面板会重复计数。它只长技能和记忆。
     * @param event - 原始 session 事件。
     * @returns { callId, name, file } 或 null。
     */
    function observeToolCall(event) {
      if (event.type !== "tool/call") return null;
      var data = event.data;
      if (data === null || typeof data !== "object") return null;
      if (typeof data.name !== "string" || data.name === "") return null;
      return {
        callId: typeof data.callId === "string" ? data.callId : "",
        name: data.name,
        file: fileArgOf(data.arguments)
      };
    }

    /**
     * 把一条 tool/result 归成一次「这次成了还是没成」。
     *
     * 工具名不在 tool/result 里，只能靠 content block 上的 toolCallId 回查
     * 先前那条 tool/call（store 里存着这张小表），「同一个工具报错后又成功」
     * 才算克服了一次困难。
     * @param event - 原始 session 事件。
     * @returns { callId, failed } 或 null。
     */
    function observeToolResult(event) {
      if (event.type !== "tool/result") return null;
      var data = event.data;
      if (data === null || typeof data !== "object") return null;
      var callId = "";
      var message = data.message;
      var content = message === null || message === undefined ? null : message.content;
      if (Array.isArray(content)) {
        for (var i = 0; i < content.length; i += 1) {
          var block = content[i];
          if (block !== null && typeof block === "object" && typeof block.toolCallId === "string") {
            callId = block.toolCallId;
            break;
          }
        }
      }
      var error = data.error;
      return {
        callId: callId,
        failed: error !== null && typeof error === "object" && typeof error.name === "string"
      };
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
      /** 上次结算三条数值（饥饿 / 心情 / 精力）的时刻；0 表示还没结算过。 */
      var lastRegenAt = 0;
      /** 回升的小数余额。hunger 必须保持整数（界面直接把它渲染成数字）。 */
      var hungerCarry = 0;
      /** 心情 / 精力的小数余额，同理。 */
      var moodCarry = 0;
      var energyCarry = 0;
      /** 情绪三维的小数余额（三维共用一份衰减速率，但各自攒余额）。 */
      var dimCarry = { curiosity: 0, pride: 0, concern: 0 };
      /** 当前那一格零食开始回充的时刻；0 表示还没起算。 */
      var snackAt = 0;
      /** 气泡：上一次说话的时刻（限流用）、撤台词的定时器、挑台词的种子。 */
      var lastBubbleAt = 0;
      var bubbleTimer = 0;
      var bubbleSeq = 0;
      /** 上一句是不是情绪三维那三句（垫场话，谁都能顶掉它，见 emitBubble）。 */
      var lastBubbleDim = false;
      /**
       * 每个场合上一次取到的台词下标（场合 → 下标）。pickLineIndex 靠它做到
       * 「同一句永不连着出现两次」；按场合分开记，否则两个场合会互相干扰。
       */
      var lineAt = {};
      /** 上一次摸头的时刻（冷却用）。 */
      var patAt = 0;
      /** 这一串连着摸的第几下（换台词用；断了就归 1）。 */
      var patRun = 0;
      /** 上一次演小动作的时刻、抽小动作用的种子、撤小动作的定时器。 */
      var idleAt = 0;
      var idleSeq = 0;
      var idleTimer = 0;
      /** 上一次抽到的小动作下标（pickLineIndex 的「上一句」）。 */
      var idleLast = -1;
      /** 暴食 BUFF 到期的定时器。 */
      var buffTimer = 0;
      /** 连着吃的是哪一种、吃了几口（食性偏好用；纯瞬时态，不落盘）。 */
      var tasteSource = null;
      var tasteCount = 0;
      /** 上一次说提示的时刻（提示自己的冷却，比气泡限流更长）。 */
      var adviceAt = 0;
      /**
       * 本次会话里每个文件被改了几次（basename → 次数）。
       *
       * 刻意**不落盘**：「你今天已经改它三次了」说的是当下这段活，跨天记账会
       * 变成一句陈年旧账。
       */
      var sessionEdits = {};
      /** 连着几条工具结果报错了、上一条报错的是哪个工具（都是瞬时态）。 */
      var errorStreak = 0;
      var lastErrorTool = null;
      /** 同一个工具连着挂了几次（换个工具就归零）。 */
      var toolFailStreak = 0;
      /** 上一次说关怀 / 闲聊的时刻（care 自己的冷却，比提示的还长）。 */
      var careAt = 0;
      /**
       * 这一段不间断的活儿是从什么时候开始的；0 表示还没起算。
       * 中间睡过一觉（超过 sleepAfterMs 没动静）就重新起算 —— 「你坐了两小时」
       * 说的是真的连着坐了两小时，不是「两小时前来过一次」。
       */
      var activeSince = 0;
      /** 「久坐」这一段劝过了没有（同一段只劝一次）。 */
      var marathonSaid = false;
      /** 启动时算出来的离开时长；念过那句「好久不见」就清零。 */
      var comebackMs = 0;
      /**
       * callId → 工具名。tool/result 里没有工具名，只能靠这张小表回查。
       * 上限 CALL_NAME_CAP 条，满了就丢最早的——过期的调用不会再有结果回来。
       */
      var callNames = new Map();
      /** 一次拖拽是否真的挪动过：挪过就把随后那次 click（摸头）吞掉。 */
      var dragMoved = false;
      /** 这一次拖拽的基准：按下时的指针坐标与当时的偏移；null 表示没在拖。 */
      var dragFrom = null;
      var saved = loadSavedState(config);
      var bootAt = Date.now();
      var state = {
        pet: createPet(config, saved === null ? null : saved.pet),
        effects: [],
        comboCount: 0,
        comboMultiplier: 1,
        comboTier: "normal",
        eatKey: 0,
        // 摸头的次数计数器（和 eatKey 同一个用法：变一次 → 头像重挂载 →
        // 挤压动画重播）与「最近一次是吃还是被摸」。头像只有一个 className
        // 位子，两个动画都动 transform，所以只能挂最近发生的那一个。
        patKey: 0,
        lastAct: null,
        // 正在演的那个空闲小动作（yawn / wag / roll / peek），null 表示没在演。
        idleAct: null,
        totalFeeds: saved === null ? 0 : saved.totalFeeds,
        totalTokens: saved === null ? 0 : saved.totalTokens,
        tokensBySource: saved === null
          ? { user_input: 0, generation: 0, tool_result: 0 }
          : saved.tokensBySource,
        // 新宠物一上来就是满格：第一次见面别让人干等 45 秒才能喂。
        snacks: saved === null ? config.manualSnackMax : saved.snacks,
        // 已解锁的成就 id（顺序即解锁顺序）。
        achievements: saved === null ? [] : saved.achievements,
        // 当天的任务进度；跨天由 settleDaily 重置。
        daily: saved === null
          ? { day: dayIndexOf(bootAt), feeds: 0, tools: 0, bestCombo: 0, done: [] }
          : saved.daily,
        streakDay: saved === null ? 0 : saved.streakDay,
        streakCount: saved === null ? 0 : saved.streakCount,
        pats: saved === null ? 0 : saved.pats,
        // 技能与记忆：跟等级一样是养出来的，所以从存档里接着长。
        skills: createSkills(saved === null ? null : saved.skills),
        memory: saved === null ? createMemory(dayIndexOf(bootAt)) : saved.memory,
        pos: saved === null ? { dx: 0, dy: 0 } : saved.pos,
        // 最后一次被喂 / 被摸的时刻。新宠物从「刚被摸过」起算，否则一上来就在睡。
        lastFeedAt: saved === null || saved.lastFeedAt === 0
          ? bootAt
          : Math.min(saved.lastFeedAt, bootAt),
        // 下面几个都是瞬时态，不落盘：睡没睡、在说什么、有没有 BUFF、
        // 面板开没开、正在被拖着没有。
        asleep: false,
        bubble: null,
        buff: null,
        panelOpen: false,
        dragging: false
      };
      var persist = createPersistence(config, function () { return state; });

      /** 发布一次新的顶层状态对象。 */
      function commit(patch, skipSave) {
        state = Object.assign({}, state, patch);
        if (skipSave !== true) persist.schedule();
        listeners.forEach(function (listener) { listener(); });
      }

      /**
       * 结算「从上次结算到现在」的三条随时间走的数值，返回结算后的 pet
       * （没变就返回原对象）：
       *
       *   饥饿  每分钟 +hungerRegenPerMin，睡着时乘 sleepHungerFactor（睡着饿得慢）
       *   心情  每分钟 -moodDecayPerMin，饿着的时候再多掉 moodDropPerMinHungry
       *   精力  每分钟 +energyRegenPerMin，睡着时乘 energySleepFactor（睡着回得快）
       *
       * 惰性结算而不是常驻定时器：喂食路径上顺手算一次就够了，展示层另有一个
       * 低频 tick 让空闲时的进度条也会动。三条共用一个锚点 `lastRegenAt`，
       * 所以「这段空闲有多长」只算一次。
       *
       * 睡眠因子按**当下**的睡眠状态整段套用（而不是逐段积分）：一段空闲要么
       * 整段醒着要么整段睡着的时候它是准的，跨越入睡点的那一段会略有偏差 ——
       * 换来的是不必为此维护一条状态变迁的时间线。
       * @param now - 当前时刻（epoch ms）。
       * @returns 结算后的宠物状态；无变化时是原引用。
       */
      function settleVitals(now) {
        if (lastRegenAt === 0) {
          lastRegenAt = now;
          return state.pet;
        }
        var minutes = (now - lastRegenAt) / 60000;
        lastRegenAt = now;
        if (minutes <= 0) return state.pet;
        var pet = state.pet;
        var hunger = pet.hunger;
        var mood = pet.mood;
        var energy = pet.energy;
        if (config.hungerRegenPerMin > 0) {
          var hungerRate = state.asleep
            ? config.hungerRegenPerMin * config.sleepHungerFactor
            : config.hungerRegenPerMin;
          hungerCarry += minutes * hungerRate;
          var hungerWhole = Math.floor(hungerCarry);
          if (hungerWhole >= 1) {
            hungerCarry -= hungerWhole;
            hunger = Math.min(100, hunger + hungerWhole);
          }
        }
        if (config.vitalsEnabled) {
          // 心情按「结算前」的饥饿判断饿不饿：这一段空闲里它就是这么饿着的。
          var moodRate = config.moodDecayPerMin
            + (pet.hunger >= config.hungryAt ? config.moodDropPerMinHungry : 0);
          moodCarry += minutes * moodRate;
          var moodWhole = Math.floor(moodCarry);
          if (moodWhole >= 1) {
            moodCarry -= moodWhole;
            mood = Math.max(0, mood - moodWhole);
          }
          var energyRate = config.energyRegenPerMin
            * (state.asleep ? config.energySleepFactor : 1);
          energyCarry += minutes * energyRate;
          var energyWhole = Math.floor(energyCarry);
          if (energyWhole >= 1) {
            energyCarry -= energyWhole;
            energy = Math.min(100, energy + energyWhole);
          }
        }
        // 情绪三维都往 0 走：没事发生就是没情绪。和上面三条一样走「取整 + 留
        // 余额」，免得 0.4/分钟的衰减在整数上永远迈不出第一步。
        var dims = null;
        if (config.moodDimsEnabled && config.moodDimDecayPerMin > 0) {
          for (var i = 0; i < MOOD_DIMS.length; i += 1) {
            var key = MOOD_DIMS[i].key;
            if (pet[key] <= 0) { dimCarry[key] = 0; continue; }
            dimCarry[key] += minutes * config.moodDimDecayPerMin;
            var whole = Math.floor(dimCarry[key]);
            if (whole < 1) continue;
            dimCarry[key] -= whole;
            var value = Math.max(0, pet[key] - whole);
            if (value === pet[key]) continue;
            if (dims === null) dims = {};
            dims[key] = value;
          }
        }
        if (hunger === pet.hunger && mood === pet.mood && energy === pet.energy
          && dims === null) return pet;
        var next = Object.assign({}, pet, { hunger: hunger, mood: mood, energy: energy });
        return dims === null ? next : Object.assign(next, dims);
      }

      /**
       * 这只宠物现在该不该在睡：从「最后一次被喂 / 被摸」算起。困着（精力低于
       * lowEnergyAt）的时候门槛砍半 —— 累了就睡得早。
       * @param now - 当前时刻（epoch ms）。
       * @param pet - 用来判断困不困的宠物状态。
       * @returns 该睡就是 true。
       */
      function shouldSleep(now, pet) {
        if (!config.sleepEnabled) return false;
        var threshold = config.vitalsEnabled && pet.energy < config.lowEnergyAt
          ? config.sleepAfterMs / 2
          : config.sleepAfterMs;
        return now - state.lastFeedAt >= threshold;
      }

      /**
       * 说出一句**给定的**话：往 patch 里塞一个气泡，并安排一个定时器到点撤掉。
       *
       * 普通场合（吃到东西、腻了）受 bubbleMinGapMs 限流，否则一轮工具循环会把
       * 气泡刷成弹幕；`force` 留给进阶 / 成就 / 摸头这些「大事」，它们该说就说。
       *
       * 例外一条：占着位子的是情绪三维那三句（DIM_LINE_KINDS）而来的是提示时，
       * 限流不算 —— 让「这是什么？」挡住「这文件你改到第 3 次了」是本末倒置，
       * 而这两件事常常发生在同一毫秒（一次工具调用同时推好奇心和查提示）。
       * @param patch - 正在攒的 patch。
       * @param kind - 场合（也是气泡上的 data-kind）。
       * @param text - 这一句的文案。
       * @param force - 是否忽略限流。
       * @returns 真的说出来了才是 true（被限流 / 关了气泡都是 false）。
       */
      function emitBubble(patch, kind, text, force) {
        if (!config.bubbleEnabled) return false;
        var now = Date.now();
        var isDim = DIM_LINE_KINDS[kind] === true;
        // 三维那三句给提示让位：只让给提示，不让给日常台词 ——「我有点担心你」
        // 比「好吃！」值钱，但比「这文件你改到第 3 次了」不值钱。
        var yields = lastBubbleDim && kind === "advice";
        if (force !== true && !yields && now - lastBubbleAt < config.bubbleMinGapMs) {
          return false;
        }
        lastBubbleAt = now;
        lastBubbleDim = isDim;
        bubbleSeq += 1;
        var bubble = {
          key: "b" + String(bubbleSeq),
          kind: kind,
          text: text
        };
        patch.bubble = bubble;
        if (bubbleTimer !== 0) clearTimeout(bubbleTimer);
        bubbleTimer = setTimeout(function () {
          bubbleTimer = 0;
          // 期间可能已经换了一句：只撤自己那一条，别把新台词抹掉。
          if (state.bubble !== null && state.bubble.key === bubble.key) {
            commit({ bubble: null }, true);
          }
        }, config.bubbleTtlMs);
        return true;
      }

      /**
       * 说一句这个场合的台词。挑哪句走 pickLineIndex（确定性伪随机）而不是
       * Math.random —— 同一串事件说的话可复现，但听起来不像在背台词。
       *
       * 下标要在**说出来之后**才记进 lineAt：被限流挡住的那次等于没说，把它
       * 算进「上一句」会让真正说出口的那句莫名其妙地避开一个选项。
       * @param patch - 正在攒的 patch。
       * @param kind - 场合（BUBBLE_LINES 的键）。
       * @param force - 是否忽略限流。
       * @returns 真的说出来了才是 true。
       */
      function say(patch, kind, force) {
        var lines = BUBBLE_LINES[kind];
        if (lines === undefined) return false;
        var last = lineAt[kind] === undefined ? -1 : lineAt[kind];
        var at = pickLineIndex(lines.length, bubbleSeq + 1, last);
        if (!emitBubble(patch, kind, lines[at], force)) return false;
        lineAt[kind] = at;
        return true;
      }

      /**
       * 推一维情绪（好奇 / 得意 / 担忧），越过 moodDimAt 的那一次顺手说一句。
       *
       * 台词只在**跨线那一刻**说，而不是每次涨都说：一轮工具循环里好奇心会被
       * 推好几次，每次都说一遍就成了刷屏。而且这一句刻意**不强插**（force 为
       * false）—— 它没有「升级了」「解锁成就」那么值钱，抢不到气泡就算了。
       *
       * 这三维一点数值曲线都不碰（见 MOOD_DIMS），所以这里只改 pet 上那一个
       * 字段，不走 feedPet。
       * @param patch - 正在攒的 patch。
       * @param key - 哪一维（MOOD_DIMS 的 key）。
       * @param amount - 涨多少（非正数直接跳过）。
       */
      function bumpDim(patch, key, amount) {
        if (!config.moodDimsEnabled || amount <= 0) return;
        var pet = patch.pet === undefined ? state.pet : patch.pet;
        var before = pet[key];
        if (typeof before !== "number") return;
        var value = clamp(before + amount, 0, 100);
        if (value === before) return;
        var one = {};
        one[key] = value;
        patch.pet = Object.assign({}, pet, one);
        if (before >= config.moodDimAt || value < config.moodDimAt) return;
        for (var i = 0; i < MOOD_DIMS.length; i += 1) {
          if (MOOD_DIMS[i].key === key) say(patch, MOOD_DIMS[i].line, false);
        }
      }

      /**
       * 结算暴食 BUFF：过期就返回 null。BUFF 是瞬时态，不落盘。
       * @param now - 当前时刻（epoch ms）。
       * @returns 仍然有效的 BUFF，或 null。
       */
      function settleBuff(now) {
        if (state.buff === null) return null;
        return state.buff.until > now ? state.buff : null;
      }

      /**
       * 当天的任务进度：跨天就清零重开（连续到访另算，见 bumpStreak）。
       * @param now - 当前时刻（epoch ms）。
       * @returns 当天的进度对象；同一天里返回原引用。
       */
      function settleDaily(now) {
        var today = dayIndexOf(now);
        if (state.daily.day === today) return state.daily;
        return { day: today, feeds: 0, tools: 0, bestCombo: 0, done: [] };
      }

      /**
       * 「今天来喂过了」：把连续到访天数推进一格。昨天也来过就 +1，断了就重新
       * 从 1 数起，同一天里第二次喂食不再累加。
       * @param now - 当前时刻（epoch ms）。
       * @returns { streakDay, streakCount }。
       */
      function bumpStreak(now) {
        var today = dayIndexOf(now);
        if (state.streakDay === today) {
          return { streakDay: today, streakCount: state.streakCount };
        }
        var continued = state.streakDay === today - 1;
        return {
          streakDay: today,
          streakCount: continued ? state.streakCount + 1 : 1
        };
      }

      /**
       * 结算「从上次结算到现在」回了几格零食。与 settleVitals 同一个形状：
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

      // 离线期间也会饿：把结算起点摆在存档时刻，剩下的交给 settleVitals。
      // 起点最多回溯 offlineRegenCapMs，也顺手兜住存档时间戳跑到未来的情况
      // （改过系统时钟 / 跨时区的机器）。
      if (saved !== null && saved.savedAt > 0) {
        var offlineFrom = Math.max(
          Math.min(saved.savedAt, bootAt),
          bootAt - config.offlineRegenCapMs
        );
        lastRegenAt = offlineFrom;
        // 零食用同一个起点：离线期间照攒（上限就是格数上限，不用另设 cap），
        // 所以出门一天回来是饿着的，但兜里的零食满了，正好把它救回来。
        // 注意先摆好这个锚点——settleVitals 会把 lastRegenAt 推到 bootAt。
        snackAt = offlineFrom;
        // 睡眠状态要**先**定下来：离线这段时间没人喂它，所以它大概是睡着的，
        // 而饥饿 / 精力的结算要按睡着的速率走。
        state.asleep = shouldSleep(bootAt, state.pet);
        // 还没有订阅者，直接改初始状态即可，不用走 commit。
        state.pet = settleVitals(bootAt);
        state.snacks = settleSnacks(bootAt);
        state.daily = settleDaily(bootAt);
        // 「好久不见」按**未截断**的离开时长算：饥饿封在 24h 是为了不让宠物
        // 饿死，可离开了三天这件事本身值得它念一句。
        var away = bootAt - Math.min(saved.savedAt, bootAt);
        if (away >= config.careComebackMs) comebackMs = away;
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
        moodCarry = 0;
        energyCarry = 0;
        dimCarry = { curiosity: 0, pride: 0, concern: 0 };
        commit({
          pet: createPet(config, incoming.pet),
          totalFeeds: incoming.totalFeeds,
          totalTokens: incoming.totalTokens,
          tokensBySource: incoming.tokensBySource,
          snacks: incoming.snacks,
          achievements: incoming.achievements,
          daily: sanitizeDaily(incoming.daily, dayIndexOf(lastRegenAt)),
          streakDay: incoming.streakDay,
          streakCount: incoming.streakCount,
          pats: incoming.pats,
          skills: incoming.skills,
          memory: incoming.memory,
          // 位置也跟着走：两个标签页养的是同一只，摆在同一个角落才不别扭。
          pos: incoming.pos,
          lastFeedAt: incoming.lastFeedAt === 0 ? lastRegenAt : incoming.lastFeedAt,
          asleep: false
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
       * 往 patch 里追加一条**通知类特效**：带 text 的特效直接飘这整句，不拼
       * 「+N 食物」那套数字（见 FeedEffect）。进阶 / 成就 / 任务达成 / 摸头
       * 都走这一条管道，所以它们自动继承特效的时序、TTL 与「减少动效」降级。
       * @param patch - 正在攒的 patch。
       * @param icon - 飞进来的那个图标。
       * @param text - 飘字的整句文案。
       * @param source - 特效来源标记（evolve / achieve / quest / pat）。
       * @param tier - 视觉等级（epic 是彩虹大字）。
       * @returns 追加的那条特效；关了特效开关时是 null。
       */
      function appendNotice(patch, icon, text, source, tier) {
        // 和别的特效同一个开关：关了特效就只是静静地把数值改掉。
        if (!config.effectsEnabled) return null;
        effectSeq += 1;
        var effect = {
          key: "fx" + String(effectSeq),
          icon: icon,
          text: text,
          foodAmount: 0,
          expAmount: 0,
          tokens: 0,
          foodTier: "large",
          source: source,
          comboCount: 0,
          comboMultiplier: 1,
          tier: tier,
          flight: LOCAL_FLIGHT
        };
        var base = patch.effects === undefined ? state.effects : patch.effects;
        patch.effects = base.concat([effect]);
        setTimeout(function () { dropEffect(effect.key); }, config.effectTtlMs);
        return effect;
      }

      /**
       * 这份 patch 里是不是已经躺了一句关怀（见 `CARE_KINDS`）。
       *
       * 气泡只有一个位子，而关怀那几句半小时才够格说一次 —— 被同一瞬间的别的
       * 台词顶掉，那道冷却就白烧了。所以想强插气泡的地方（睡醒、升级）都先问
       * 一句这个。反过来日常台词不用问：它们本来就排在关怀后面，抢不到。
       * @param patch - 正在攒的 patch。
       */
      function careHolds(patch) {
        return patch.bubble !== undefined && CARE_KINDS[patch.bubble.kind] === true;
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
        var stage = whaleStageOf(after.level);
        if (stage === whaleStageOf(before.level)) {
          // 没跨档但确实升了级：不飘特效（前期几口一次，会成噪音），但说一句 ——
          // 一句台词比一条彩虹大字便宜得多，而升级本来该被看见。
          //
          // 强插（force）：这一口的日常台词早就先说了，不强插的话「升级了！」
          // 永远排不上。关怀那几句除外 —— 它比升一级值钱。
          if (after.level > before.level && !careHolds(patch)) say(patch, "levelup", true);
          // 升级也值得得意一下（哪怕没跨档）。放在 say 后面：得意那句
          // 不强插，所以「升级了！」照旧先说。
          if (after.level > before.level) bumpDim(patch, "pride", config.pridePerWin);
          return;
        }
        // 蹭 epic 那套彩虹大字，进阶总得比一口饭显眼。
        appendNotice(patch, EVOLVE_ICON, "进阶 · " + stage.label, "evolve", "epic");
        say(patch, "evolve", true);
        bumpDim(patch, "pride", config.pridePerWin);
      }

      /**
       * 攒一份成就判定用的统计快照。`patch` 里已经算出来的字段优先，因为成就
       * 该看的是**这一口之后**的数字。
       * @param patch - 正在攒的 patch。
       * @param pet - 这一口之后的宠物状态。
       * @param extra - 只在当下成立的瞬时项（连击数、这一口的食物档位）。
       * @returns 统计快照。
       */
      function statsOf(patch, pet, extra) {
        var pick = function (key) {
          return patch[key] === undefined ? state[key] : patch[key];
        };
        return {
          pet: pet,
          totalFeeds: pick("totalFeeds"),
          totalTokens: pick("totalTokens"),
          tokensBySource: pick("tokensBySource"),
          pats: pick("pats"),
          streakCount: pick("streakCount"),
          // 技能与记忆也进快照：「出师」「老手」这两条成就要读它们。
          skills: pick("skills"),
          memory: pick("memory"),
          comboCount: extra.comboCount === undefined ? 0 : extra.comboCount,
          foodTier: extra.foodTier === undefined ? null : extra.foodTier
        };
      }

      /**
       * 逐条查成就：没解锁又达标的就地解锁，飘一条徽章特效并送几格零食。
       *
       * 奖励刻意只给零食而不给经验：给经验会连锁升级 → 连锁进阶，一条成就能
       * 把三条特效同时炸出来；零食是「能立刻用掉的一点好处」，不掺进曲线里。
       * @param patch - 正在攒的 patch。
       * @param pet - 这一口之后的宠物状态。
       * @param extra - 瞬时项（见 statsOf）。
       * @returns 这一次解锁的条数。
       */
      function checkAchievements(patch, pet, extra) {
        if (!config.achievementsEnabled) return 0;
        var owned = patch.achievements === undefined ? state.achievements : patch.achievements;
        var stats = statsOf(patch, pet, extra);
        var gained = [];
        for (var i = 0; i < ACHIEVEMENTS.length; i += 1) {
          var item = ACHIEVEMENTS[i];
          if (owned.indexOf(item.id) >= 0) continue;
          if (item.test(stats, config) !== true) continue;
          gained.push(item);
        }
        if (gained.length === 0) return 0;
        patch.achievements = owned.concat(gained.map(function (item) { return item.id; }));
        if (config.achievementSnacks > 0) {
          var snacks = patch.snacks === undefined ? state.snacks : patch.snacks;
          patch.snacks = Math.min(
            config.manualSnackMax,
            snacks + gained.length * config.achievementSnacks
          );
        }
        gained.forEach(function (item) {
          appendNotice(patch, item.icon, "成就 · " + item.label, "achieve", "epic");
        });
        say(patch, "achieve", true);
        bumpDim(patch, "pride", gained.length * config.pridePerWin);
        return gained.length;
      }

      /**
       * 推进当天的任务进度，达成的当场结算（给经验 + 零食 + 一条特效）。
       *
       * 不做「领取」这一步：多一个按钮不如少一步操作，达成即到账。经验通过
       * feedPet 加进去，所以任务奖励也能把等级顶过形态门槛（调用方随后统一
       * 比一次进阶）。
       * @param patch - 正在攒的 patch。
       * @param pet - 这一口之后的宠物状态。
       * @param now - 当前时刻（epoch ms）。
       * @param delta - 这一次的增量 { feeds, tools, combo }（缺的当 0）。
       * @returns 结算完奖励的宠物状态（没达成任何任务时是原引用）。
       */
      function applyDaily(patch, pet, now, delta) {
        if (!config.dailyEnabled) return pet;
        var base = settleDaily(now);
        var daily = {
          day: base.day,
          feeds: base.feeds + (delta.feeds === undefined ? 0 : delta.feeds),
          tools: base.tools + (delta.tools === undefined ? 0 : delta.tools),
          bestCombo: Math.max(base.bestCombo, delta.combo === undefined ? 0 : delta.combo),
          done: base.done
        };
        var finished = [];
        for (var i = 0; i < DAILY_QUESTS.length; i += 1) {
          var quest = DAILY_QUESTS[i];
          if (daily.done.indexOf(quest.id) >= 0) continue;
          if (quest.of(daily) < quest.goal) continue;
          finished.push(quest);
        }
        var next = pet;
        if (finished.length > 0) {
          daily.done = daily.done.concat(finished.map(function (quest) { return quest.id; }));
          if (config.dailyQuestExp > 0) {
            next = feedPet(pet, 0, finished.length * config.dailyQuestExp);
          }
          if (config.dailyQuestSnacks > 0) {
            var snacks = patch.snacks === undefined ? state.snacks : patch.snacks;
            patch.snacks = Math.min(
              config.manualSnackMax,
              snacks + finished.length * config.dailyQuestSnacks
            );
          }
          finished.forEach(function (quest) {
            appendNotice(patch, QUEST_ICON, "任务达成 · " + quest.label, "quest", "gold");
          });
          say(patch, "quest", true);
        }
        patch.daily = daily;
        return next;
      }

      /**
       * 给一条技能加经验；升级了就飘一条通知（复用 appendNotice，于是自动继承
       * TTL 与「减少动效」降级）。
       * @param patch - 正在攒的 patch。
       * @param key - 技能 key。
       * @param xp - 这次加多少经验。
       */
      function applySkill(patch, key, xp) {
        if (!config.skillsEnabled || xp <= 0) return;
        var base = patch.skills === undefined ? state.skills : patch.skills;
        var result = gainSkill(base, key, xp, config);
        if (result.skills === base) return;
        patch.skills = result.skills;
        result.ups.forEach(function (up) {
          var item = SKILL_BY_ID[up.key];
          appendNotice(
            patch,
            item.icon,
            "技能 · " + item.label + " Lv." + String(up.level),
            "skill",
            "gold"
          );
        });
        if (result.ups.length > 0) {
          say(patch, "skill", true);
          bumpDim(patch, "pride", config.pridePerWin);
        }
      }

      /**
       * 取 patch 里那份可改的记忆（第一次调用时从当前状态拷一份）。
       * hours 也要拷：它是数组，原地改会把旧快照一起改掉。
       * @param patch - 正在攒的 patch。
       * @returns 可以就地改的记忆对象。
       */
      function memoryOf(patch) {
        if (patch.memory === undefined) {
          patch.memory = Object.assign({}, state.memory, { hours: state.memory.hours.slice() });
        }
        return patch.memory;
      }

      /**
       * 说一句**真的有用的话**（「这文件你改到第 3 次了」）。
       *
       * 三道闸：对应技能得够高（技能低就是「还不熟你的活」，凭什么给建议）、
       * 提示自己的冷却（adviceCooldownMs，比普通气泡限流长得多），以及气泡本身
       * 的限流。三道都过了才说 —— 这条玩法的底线是零打扰。
       * @param patch - 正在攒的 patch。
       * @param text - 这一句的文案。
       * @param skillKey - 要求够高的那条技能。
       * @param now - 当前时刻（epoch ms）。
       * @returns 真的说出来了才是 true。
       */
      function advise(patch, text, skillKey, now) {
        if (!config.adviceEnabled) return false;
        var skills = patch.skills === undefined ? state.skills : patch.skills;
        var skill = skills[skillKey];
        if (skill === undefined || skill.level < config.adviceMinSkillLevel) return false;
        if (adviceAt !== 0 && now - adviceAt < config.adviceCooldownMs) return false;
        if (!emitBubble(patch, "advice", text, false)) return false;
        adviceAt = now;
        return true;
      }

      /**
       * 主动搭一句闲话：关怀（深夜 / 久坐 / 好久不见）或引用记忆（「又是
       * client.js 啊」）。
       *
       * 和 advise 分开是因为**这些话没有信息量**：advise 帮你解决问题，值得占
       * 一次开口；chat 只是让宠物显得记得你，所以冷却按半小时算（careCooldownMs
       * 默认 30 分钟）。也正因为没信息量，它和提示共用不了那道冷却——不然一句
       * 闲聊能把一条真有用的提示按下去半分钟。
       * @param patch - 正在攒的 patch。
       * @param kind - 场合（也是 data-kind；text 为 null 时同时用来取台词池）。
       * @param text - 动态文案，或 null（从 BUBBLE_LINES[kind] 里挑一句）。
       * @param now - 当前时刻（epoch ms）。
       * @returns 真的说出来了才是 true。
       */
      function chat(patch, kind, text, now) {
        if (!config.careEnabled) return false;
        if (careAt !== 0 && now - careAt < config.careCooldownMs) return false;
        var said = text === null
          ? say(patch, kind, false)
          : emitBubble(patch, kind, text, false);
        if (said) careAt = now;
        return said;
      }

      /**
       * 干活干到该歇了没有？深夜 / 久坐各一句，都走 chat 的长冷却。
       *
       * 挂在喂食上而不是 tick 上：劝人歇会儿这件事，得在人**正在干活**的时候
       * 说才有意义；空闲十分钟之后弹一句「歇会儿吧」只会让人莫名其妙。
       * @param patch - 正在攒的 patch。
       * @param now - 当前时刻（epoch ms）。
       */
      function careFor(patch, now) {
        // 「好久不见」优先：这是回来之后的第一句，比劝歇更该先说。
        if (comebackMs > 0) {
          if (chat(patch, "comeback", CHAT_LINES.comeback(awayTextOf(comebackMs)), now)) {
            comebackMs = 0;
          }
          return;
        }
        // 一段活儿的起点：中间断得够久（睡了一觉）就重新起算。
        if (activeSince === 0 || now - state.lastFeedAt >= config.sleepAfterMs) {
          activeSince = now;
          marathonSaid = false;
        }
        // 担忧只在这句**真的说出口**时才涨（chat 返回 true = 过了半小时那道
        // 冷却）。按「此刻是不是深夜」涨的话，凌晨那几小时里每一次工具调用都
        // 会把担忧推满，另外两维就再也写不上脸了。
        if (!marathonSaid && now - activeSince >= config.careMarathonMs) {
          if (chat(patch, "marathon", null, now)) {
            marathonSaid = true;
            bumpDim(patch, "concern", config.concernPerWorry);
          }
          return;
        }
        if (isNightHour(new Date(now).getHours(), config.careNightFrom, config.careNightTo)) {
          if (chat(patch, "night", null, now)) bumpDim(patch, "concern", config.concernPerWorry);
        }
      }

      /**
       * 引用记忆搭一句话。三句里挑**第一句成立的**，都走 chat 的长冷却，所以
       * 实际上半小时最多听见一句。
       * @param patch - 正在攒的 patch。
       * @param call - observeToolCall 的结果。
       * @param now - 当前时刻（epoch ms）。
       */
      function chatMemory(patch, call, now) {
        if (!config.memoryEnabled) return;
        var memory = patch.memory === undefined ? state.memory : patch.memory;
        // 又在动那个改得最多的文件：这是最有「它认得你」感觉的一句。
        if (call.file !== null && memory.files.length > 0 && memory.files[0].name === call.file) {
          if (memory.files[0].count >= 5 && chat(patch, "chat", CHAT_LINES.favorite_file(call.file), now)) {
            return;
          }
        }
        // 某个工具用到整十次：一个不痛不痒但确实是「记着」的数字。
        var tool = null;
        for (var i = 0; i < memory.tools.length; i += 1) {
          if (memory.tools[i].name === call.name) tool = memory.tools[i];
        }
        if (tool !== null && tool.count >= 20 && tool.count % 10 === 0) {
          if (chat(patch, "chat", CHAT_LINES.tool_habit(tool.name, tool.count), now)) return;
        }
        // 又到了它记下来的那个时段。
        var range = busyHoursOf(memory.hours);
        if (range !== null) {
          var hour = new Date(now).getHours();
          var from = Number(range.split("-")[0]);
          if (isNightHour(hour, from, (from + 2) % 24)) {
            chat(patch, "chat", CHAT_LINES.busy_hour(range), now);
          }
        }
      }

      /**
       * 闲下来演一个小动作（打哈欠 / 摆尾 / 翻身 / 偷看）。
       *
       * 蹭展示层那个 10s 的 tick，不另起定时器：这件事只需要「大约每隔
       * idleActEveryMs 来一次」，精确到秒毫无意义。
       *
       * 三道闸挡住撞车：睡着不动（睡着有 Zzz，再摆尾就成了装睡）、离上一次
       * 互动得够久（否则会和吃饭那个弹跳同时演）、离上一个小动作也得够久。
       * 挑哪个动作走 pickLineIndex，和台词同一套确定性伪随机。
       * @param patch - 正在攒的 patch。
       * @param now - 当前时刻（epoch ms）。
       * @param asleep - 这一拍结算出来的睡眠状态。
       */
      function idlePlay(patch, now, asleep) {
        if (!config.idleActEnabled || asleep) return;
        if (state.idleAct !== null) return;
        if (now - state.lastFeedAt < config.idleActQuietMs) return;
        if (idleAt !== 0 && now - idleAt < config.idleActEveryMs) return;
        if (prefersReducedMotion()) return;
        idleAt = now;
        idleSeq += 1;
        var at = pickLineIndex(IDLE_ACTS.length, idleSeq, idleLast);
        idleLast = at;
        patch.idleAct = IDLE_ACTS[at];
        if (idleTimer !== 0) clearTimeout(idleTimer);
        idleTimer = setTimeout(function () {
          idleTimer = 0;
          // 小动作是纯展示态，撤它不值得触发一次落盘。
          if (state.idleAct !== null) commit({ idleAct: null }, true);
        }, config.idleActMs);
      }

      /**
       * 任何一次互动都会把它叫醒：清掉睡眠、把睡眠计时的锚点推到当下。
       * 从睡着被叫醒时额外说一句（打个哈欠），本来就醒着就什么都不说。
       *
       * 相处够久（≥ 3 天）就换成一句带天数的动态台词 —— 记忆得**说得出来**
       * 才算记忆，不然它只是面板上的一个数字。
       * @param patch - 正在攒的 patch。
       * @param now - 当前时刻（epoch ms）。
       */
      function wake(patch, now) {
        patch.lastFeedAt = now;
        if (!state.asleep) return;
        patch.asleep = false;
        // 打个哈欠不比「你去哪儿了」重要。别的台词（吃到最爱、糖）该让路的还是
        // 让路 —— 醒来这一下比它们值钱。
        if (careHolds(patch)) return;
        if (config.memoryEnabled) {
          var days = togetherDaysOf(state.memory, now);
          if (days >= 3) {
            emitBubble(patch, "wake", "又见面了，这是第 " + String(days) + " 天…（打哈欠）", true);
            return;
          }
        }
        say(patch, "wake", true);
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
         * 空闲时的低频结算：把三条数值、零食回格、每日进度、BUFF 与睡眠都推进
         * 到当下，有变化才发布。展示层每 10s 调一次，好让进度条与零食数在没有
         * 事件时也会动。
         */
        tick: function () {
          var now = Date.now();
          // 顺序要紧：settleVitals 按**这一段**的睡眠状态算速率，所以先结算
          // 数值，再拿结算后的精力去判断该不该睡（见 settleVitals 的说明）。
          var pet = settleVitals(now);
          var snacks = settleSnacks(now);
          var daily = settleDaily(now);
          var buff = settleBuff(now);
          var asleep = shouldSleep(now, pet);
          var patch = {};
          if (pet !== state.pet) patch.pet = pet;
          if (snacks !== state.snacks) patch.snacks = snacks;
          if (daily !== state.daily) patch.daily = daily;
          if (buff !== state.buff) patch.buff = buff;
          if (asleep !== state.asleep) {
            patch.asleep = asleep;
            // 只在**刚睡着**时说一句；醒来那句由互动侧发（见 wake）。
            if (asleep) say(patch, "sleep", true);
          }
          // 这两句都只在**刚跨过线**的那一次说：tick 每 10s 一次，逐次喊会把
          // 气泡刷成弹幕。醒着才说 —— 睡着的宠物不该抱怨。
          //
          // 「困了」不在这儿：空闲时精力只回不掉（settleVitals），所以那条线只
          // 可能在**喂食**时被跌破，判定跟着放在 feed 里。
          if (patch.pet !== undefined && !asleep) {
            if (state.pet.hunger < config.hungryAt && pet.hunger >= config.hungryAt) {
              say(patch, "hungry", true);
              // 饿着也算一件让它不安的事（只在跨过饿线那一次涨）。
              bumpDim(patch, "concern", config.concernPerWorry);
            } else if (
              config.vitalsEnabled
              && state.pet.mood >= config.moodSadAt
              && pet.mood < config.moodSadAt
            ) {
              // 心情跌破线：脸已经换成委屈的了，再补一句。
              say(patch, "sad", false);
            }
          }
          idlePlay(patch, now, asleep);
          if (Object.keys(patch).length > 0) commit(patch);
        },
        /**
         * 喂一次食：结算数值 → 走 combo → 算食物量/经验 → 更新宠物 → 加一条特效，
         * 顺带推进每日任务、连续到访、成就与暴食 BUFF。
         * @param source - 触发源。
         * @param tokens - 估算的 token 数。
         * @param now - 事件时刻（epoch ms）。
         * @param output - 这一步模型写了多少 token（只有 generation 有；表达技能用）。
         */
        feed: function (source, tokens, now, output) {
          // 先把这段空闲攒下的饥饿补回来，再吃这一口——否则食物量的大小
          // 在饱食度顶格之后就没有意义了。
          var pet = settleVitals(now);
          var count = combo.tick(now);
          var multiplier = multiplierOf(count);
          var buff = settleBuff(now);
          // 挑食：同一种食材连着吃会腻，最爱的那一口有加成。计数放在 store 的
          // 私有变量里而不落盘——「腻了」是当下这串活动的性质，不该跨天记账。
          var favorite = false;
          var bored = false;
          var taste = 1;
          if (config.pickyEnabled) {
            if (source === tasteSource) {
              tasteCount += 1;
            } else {
              tasteSource = source;
              tasteCount = 1;
            }
            favorite = source === config.favoriteSource;
            bored = tasteCount > config.boredomAfter;
            if (favorite) taste *= config.favoriteBonus;
            if (bored) taste *= config.boredomFactor;
          }
          var frenzy = buff !== null && buff.kind === "frenzy";
          // 主项来自 token 量级，连击只加一个 0..+5 的常数：连击若也走乘法，
          // ×3.0 会盖过 token 本身的差别。挑食与 BUFF 是乘在主项上的口味系数。
          var food = clamp(
            Math.round(foodFromTokens(tokens, config) * taste * (frenzy ? config.frenzyFoodFactor : 1))
              + Math.floor(count / 2),
            config.minFood,
            config.maxFood
          );
          var expFactor = multiplier
            * vitalFactorOf(pet, config)
            * (frenzy ? config.frenzyExpFactor : 1);
          var exp = Math.max(1, Math.floor(BASE_EXP[source] * expFactor + 0.5));
          var tier = tierOf(count);
          var foodTier = foodTierOf(tokens);
          var bySource = Object.assign({}, state.tokensBySource);
          bySource[source] += tokens;
          var patch = {
            // 吃到就开心；干活会累，所以每一口都扣一点精力（累了经验打折，
            // 见 vitalFactorOf）。
            pet: feedPet(
              pet,
              food,
              exp,
              config.vitalsEnabled ? config.moodPerFeed : 0,
              config.vitalsEnabled ? -config.energyPerFeed : 0
            ),
            comboCount: count,
            comboMultiplier: multiplier,
            comboTier: tier,
            eatKey: state.eatKey + 1,
            lastAct: "eat",
            // 吃上了就别再演小动作：打哈欠那条 CSS 比进食张嘴更具体，
            // 不撤掉的话嘴上会演着哈欠而不是在嚼。
            idleAct: null,
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
          // 顶到满连击就开一段暴食 BUFF：连击本身封顶在 ×3.0，再往上堆没有
          // 回报，这段限时双倍才是「把连击打满」的奖励。期间再顶到满就续期。
          var opened = false;
          if (config.frenzyEnabled && count >= config.maxCombo) {
            opened = !frenzy;
            patch.buff = { kind: "frenzy", until: now + config.frenzyMs };
            if (buffTimer !== 0) clearTimeout(buffTimer);
            buffTimer = setTimeout(function () {
              buffTimer = 0;
              // BUFF 是瞬时态，撤掉它不值得触发一次落盘。
              if (state.buff !== null && state.buff.until <= Date.now()) {
                commit({ buff: null }, true);
              }
            }, config.frenzyMs);
          } else if (buff !== state.buff) {
            patch.buff = buff;
          }
          // 一次只说一句，按「值得一提」的程度挑：开 BUFF > 大餐 > 吃饱 >
          // 困了 > 腻了 > 连击升档 > 最爱 > 这一类事件的日常台词。
          //
          // 连击升档夹在中间是量出来的：它排在「腻了」前面就把那句挤掉了，可
          // 升档本来就有彩虹字 + 震动 + 徽标三重提示，「腻了」除了这句话没有
          // 别的信号；但它又必须排在「最爱」**前面** —— 默认最爱就是工具结果，
          // 排在后面的话一整串工具循环里「连上了！」永远轮不到开口。
          //
          // 「困了」的判定在这儿而不在 tick 里：空闲时精力只回不掉，那条线只
          // 可能被喂食本身跌破。
          var line = source;
          if (opened) line = "frenzy";
          else if (foodTier === "feast") line = "feast";
          else if (patch.pet.hunger === 0 && pet.hunger > 0) line = "full";
          else if (
            config.vitalsEnabled
            && pet.energy >= config.lowEnergyAt
            && patch.pet.energy < config.lowEnergyAt
          ) line = "tired";
          else if (bored) line = "bored";
          else if (tier !== state.comboTier && tier !== "normal") line = "combo";
          else if (favorite) line = "favorite";
          // 关怀要排在日常台词**前面**：它半小时才够格说一次，而日常台词每 4 秒
          // 就有一句在等着。排在后面的话，喂食一稀疏（纯聊天、没有工具循环）
          // 日常台词次次都说得出口，关怀就永远轮不到 —— 于是深夜那句永远不响。
          careFor(patch, now);
          say(patch, line, opened);
          wake(patch, now);
          // 「表达」技能长的是模型写出来的字数：每 2000 输出 token 算 1 点，
          // 单条最多 +5（一次超长输出不该顶掉几十次工具调用的份量）。
          if (source === "generation" && typeof output === "number") {
            applySkill(patch, "writing", Math.min(5, Math.floor(output / 2000)));
          }
          var streak = bumpStreak(now);
          patch.streakDay = streak.streakDay;
          patch.streakCount = streak.streakCount;
          // 任务奖励也给经验，所以要在比进阶之前结算掉。
          patch.pet = applyDaily(patch, patch.pet, now, {
            feeds: 1,
            tools: source === "tool_result" ? 1 : 0,
            combo: count
          });
          checkAchievements(patch, patch.pet, { comboCount: count, foodTier: foodTier });
          appendEvolve(patch, pet, patch.pet);
          commit(patch);
          if (comboTimer !== 0) clearTimeout(comboTimer);
          comboTimer = setTimeout(expireCombo, config.comboWindowMs);
        },
        /**
         * 看一眼这次工具调用：长技能、记进记忆、必要时提一句。
         *
         * **不喂食**（不进 combo / token 统计 / 饱食心情精力 / 今日到访），理由
         * 见 observeToolCall 的说明。也不叫醒它 —— 醒不醒由 tool/result 那一口
         * 决定，一次调用刚发出去还什么都没吃到。
         * @param call - observeToolCall 的结果 { callId, name, file }。
         * @param now - 事件时刻（epoch ms）。
         */
        observeTool: function (call, now) {
          if (call.callId !== "") {
            // Map 保持插入序，满了就丢最早的那条。
            if (callNames.size >= CALL_NAME_CAP) {
              var oldest = callNames.keys().next();
              if (!oldest.done) callNames.delete(oldest.value);
            }
            callNames.set(call.callId, call.name);
          }
          var patch = {};
          // 好奇心得在记忆被改之前算：新面孔的判定问的是「记忆里还没有它」。
          // 探索类工具本身也算一点好奇（去搜、去抓网页，本来就是在好奇）。
          var fresh = 0;
          if (config.moodDimsEnabled) {
            if (skillOf(call.name) === "research") fresh += config.curiosityPerResearch;
            if (config.memoryEnabled) {
              if (!hasRow(state.memory.tools, call.name)) fresh += config.curiosityPerNew;
              if (call.file !== null && !hasRow(state.memory.files, call.file)) {
                fresh += config.curiosityPerNew;
              }
            }
          }
          applySkill(patch, skillOf(call.name), 1);
          if (config.memoryEnabled) {
            var memory = memoryOf(patch);
            memory.tools = bumpCount(memory.tools, call.name, MEMORY_TOOL_TOP);
            if (call.file !== null) {
              memory.files = bumpCount(memory.files, call.file, config.memoryFileTop + MEMORY_SLACK);
            }
            // 「常在几点干活」按工具调用统计：聊天的时刻不算干活的时刻。
            memory.hours[new Date(now).getHours()] += 1;
          }
          if (call.file !== null && EDIT_TOOLS[call.name] === true) {
            sessionEdits[call.file] = (sessionEdits[call.file] === undefined
              ? 0
              : sessionEdits[call.file]) + 1;
            var times = sessionEdits[call.file];
            // 每到阈值的整数倍提一次：第 3 次说一句，第 6 次再说一句，
            // 中间那几次不啰嗦（真正的限流还有 adviceCooldownMs 兜着）。
            if (times >= config.adviceRepeatEditAt && times % config.adviceRepeatEditAt === 0) {
              advise(patch, ADVICE_LINES.repeat_edit(call.file, times), "coding", now);
            }
          }
          // 提示没说出来（不够级 / 在冷却里）才轮到闲聊：一句真有用的话永远
          // 优先于「又是 client.js 啊」。
          if (patch.bubble === undefined) chatMemory(patch, call, now);
          bumpDim(patch, "curiosity", fresh);
          // 「出师」「十万个为什么」这几条成就是被工具调用推动的，所以这条路
          // 也查一遍 —— 不查的话它们要等到下一口饭才认，看起来像坏了。
          checkAchievements(patch, patch.pet === undefined ? state.pet : patch.pet, {});
          if (Object.keys(patch).length > 0) commit(patch);
        },
        /**
         * 看一眼这次工具结果成没成：数错误连击、记「克服过的困难」，连着报错
         * 就提一句。同样**不喂食** —— 这条事件的喂食那一份由 feed 走。
         * @param result - observeToolResult 的结果 { callId, failed }。
         * @param now - 事件时刻（epoch ms）。
         */
        observeToolResult: function (result, now) {
          var name = callNames.get(result.callId);
          if (result.callId !== "") callNames.delete(result.callId);
          var patch = {};
          if (result.failed) {
            // 同一个工具连着挂 vs 各种工具轮着挂，是两种不同的卡法：前者该换
            // 思路，后者该看看上一条错误。所以两个计数各记一份。
            toolFailStreak = name !== undefined && name === lastErrorTool ? toolFailStreak + 1 : 1;
            errorStreak += 1;
            lastErrorTool = name === undefined ? null : name;
            if (config.memoryEnabled) memoryOf(patch).errors += 1;
            if (
              errorStreak >= config.adviceErrorStreakAt
              && errorStreak % config.adviceErrorStreakAt === 0
            ) {
              advise(patch, ADVICE_LINES.error_streak(errorStreak), "debug", now);
            } else if (name !== undefined && toolFailStreak >= 2) {
              advise(patch, ADVICE_LINES.tool_flaky(name, toolFailStreak), "debug", now);
            }
            bumpDim(patch, "concern", config.concernPerError);
          } else {
            // 「同一个工具刚报过错，这次成了」= 跨过了一道坎。换个工具做成了
            // 别的事不算——那不是把这个坎跨过去。
            if (
              config.memoryEnabled
              && lastErrorTool !== null
              && name !== undefined
              && name === lastErrorTool
            ) {
              memoryOf(patch).recoveries += 1;
              // 跨过去了那一刻夸一句 —— 这一整套里唯一一句**正面**的提示。
              // 前面两条都是「你好像卡住了」，只报忧不报喜的伙伴挺让人烦的。
              advise(patch, ADVICE_LINES.recovered(name), "debug", now);
              // 跨过一道坎，值得得意 —— 和升级 / 成就同一档的「赢了」。
              bumpDim(patch, "pride", config.pridePerWin);
            }
            errorStreak = 0;
            toolFailStreak = 0;
            lastErrorTool = null;
          }
          checkAchievements(patch, patch.pet === undefined ? state.pet : patch.pet, {});
          if (Object.keys(patch).length > 0) commit(patch);
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
          var pet = settleVitals(now);
          var snacks = settleSnacks(now);
          if (snacks <= 0) {
            // 喂不动也要把刚结算出来的饥饿发布出去，否则界面停在旧数字上。
            if (pet !== state.pet) commit({ pet: pet });
            return false;
          }
          var food = config.manualFeedFood;
          var exp = config.manualFeedExp;
          var patch = {
            // 手喂只涨心情不扣精力：这是零食，不是干活。
            pet: feedPet(pet, food, exp, config.vitalsEnabled ? config.moodPerFeed : 0, 0),
            eatKey: state.eatKey + 1,
            lastAct: "eat",
            // 吃上了就别再演小动作：打哈欠那条 CSS 比进食张嘴更具体，
            // 不撤掉的话嘴上会演着哈欠而不是在嚼。
            idleAct: null,
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
          say(patch, "snack", false);
          wake(patch, now);
          // 手喂也算「今天来喂过了」，也数进今日喂食任务。
          var streak = bumpStreak(now);
          patch.streakDay = streak.streakDay;
          patch.streakCount = streak.streakCount;
          patch.pet = applyDaily(patch, patch.pet, now, { feeds: 1 });
          checkAchievements(patch, patch.pet, {});
          // 手喂也能把等级顶过门槛（一口 1 点经验，也算数）。
          appendEvolve(patch, pet, patch.pet);
          commit(patch);
          return true;
        },
        /**
         * 摸一下头：涨心情、把它叫醒、飘一串爱心，头像挤压一下。
         *
         * 冷却存在的唯一理由是别让人靠连点把心情刷满 —— 心情有经验加成
         * （见 moodFactorOf），点得快就等于点出经验来了。拖动过后紧接着的
         * 那一次点击不算摸头：那是「刚把它拖到别处」的手，不是「摸它」的手。
         *
         * 连着摸（每两下之间不超过一个冷却的三倍）会换一套更黏人的台词：摸一下
         * 和摸十下不该是同一句，可这又不值得为它多存一个字段 —— 计数是会话内的
         * 私有量，刷新就忘。
         * @returns 真的摸到了才是 true。
         */
        pat: function () {
          if (!config.patEnabled) return false;
          // 拖完 pointerup 之后浏览器还会补一次 click，吞掉它。
          if (dragMoved) {
            dragMoved = false;
            return false;
          }
          var now = Date.now();
          if (now - patAt < config.patCooldownMs) return false;
          // 上一下摸完还没凉透就算「连着摸」；凉了就重新从第一下数。
          patRun = patAt !== 0 && now - patAt <= config.patCooldownMs * 3 ? patRun + 1 : 1;
          patAt = now;
          var pet = settleVitals(now);
          var patch = {
            pet: feedPet(pet, 0, 0, config.vitalsEnabled ? config.moodPerPat : 0, 0),
            pats: state.pats + 1,
            // 挤压一下：和 eatKey 同一个套路，key 变了动画才会重播。
            patKey: state.patKey + 1,
            lastAct: "pat",
            // 摸头是「有人在动它」，正在演的小动作让位。
            idleAct: null
          };
          appendNotice(patch, PAT_ICON, "摸摸头", "pat", "normal");
          say(patch, patRun >= 3 ? "pat_more" : "pat", true);
          wake(patch, now);
          checkAchievements(patch, patch.pet, {});
          commit(patch);
          return true;
        },
        /** 开 / 收成就与任务面板（纯界面状态，不落盘）。 */
        togglePanel: function () {
          commit({ panelOpen: !state.panelOpen }, true);
        },
        /**
         * 开始拖动：记下手指按下的位置与当下的偏移，后续 moveDrag 都以此为基准。
         *
         * 这几个基准量存在 store 的私有变量里而不是组件里 —— 组件每帧都会重建，
         * 拿不住跨事件的量（也没有 useRef 可用）。
         * @param x - 指针的视口横坐标。
         * @param y - 指针的视口纵坐标。
         */
        beginDrag: function (x, y) {
          if (!config.dragEnabled) return;
          dragFrom = { x: x, y: y, dx: state.pos.dx, dy: state.pos.dy };
          dragMoved = false;
          commit({ dragging: true }, true);
        },
        /**
         * 拖动中：把偏移改到指针处。拖动期间不落盘（一次拖动几十个事件），
         * 松手时才存一次。
         * @param x - 指针的视口横坐标。
         * @param y - 指针的视口纵坐标。
         */
        moveDrag: function (x, y) {
          if (dragFrom === null) return;
          var next = clampPos({
            dx: dragFrom.dx + (x - dragFrom.x),
            dy: dragFrom.dy + (y - dragFrom.y)
          });
          if (next.dx === state.pos.dx && next.dy === state.pos.dy) return;
          // 挪出几像素才算「拖过」：手抖不该把摸头吞掉。
          if (Math.abs(x - dragFrom.x) + Math.abs(y - dragFrom.y) > 4) dragMoved = true;
          commit({ pos: next, dragging: true }, true);
        },
        /**
         * 「刚刚那一下是拖动吗」：是就返回 true 并清掉标记。
         *
         * 浏览器在 pointerup 之后还会补发一次 click，视图拿这个把它吞掉，
         * 免得「把卡片拖到别处」顺手变成「折叠卡片」/「摸头」。
         * @returns 刚结束的那次拖动真的挪动过就是 true。
         */
        dragged: function () {
          var moved = dragMoved;
          dragMoved = false;
          return moved;
        },
        /** 松手：结束拖动并把位置落盘。 */
        endDrag: function () {
          if (dragFrom === null) return;
          dragFrom = null;
          // 这一次 commit 不跳过落盘，位置就此记住。
          commit({ dragging: false });
        },
        /** 卸载时把进度落盘、停掉悬空的定时器、摘掉窗口监听。 */
        dispose: function () {
          if (comboTimer !== 0) clearTimeout(comboTimer);
          comboTimer = 0;
          if (bubbleTimer !== 0) clearTimeout(bubbleTimer);
          bubbleTimer = 0;
          if (buffTimer !== 0) clearTimeout(buffTimer);
          buffTimer = 0;
          if (idleTimer !== 0) clearTimeout(idleTimer);
          idleTimer = 0;
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
     *
     * 整只眼睛包在一层 `.dshpet-whale-pupil` 里，那一层的 transform 由
     * `--dshpet-eye-x/y` 驱动（眼睛跟鼠标，见 trackEyes）。包一层而不是直接把
     * 偏移写在眼睛上：偏移得和眨眼（`.dshpet-whale-eyes` 的 scaleY）分在两层，
     * 同一个元素上的 transform 只有一个，写一起就互相覆盖。
     * @param key - React key（同一层里有左右两只眼）。
     * @param cx - 眼睛中心 x（viewBox 坐标）。
     * @param cy - 眼睛中心 y。
     * @param star - 是否画成星星眼。
     * @param grow - 瞳孔缩放（形态表的 eyeGrow，缺省 1）。
     * @returns 眼睛节点。
     */
    function whaleEye(key, cx, cy, star, grow) {
      var k = typeof grow === "number" ? grow : 1;
      var inner = star
        ? [
          h("path", {
            key: "star",
            d: "M0-6C.7-2 2-.7 6 0 2 .7 .7 2 0 6-.7 2-2 .7-6 0-2-.7-.7-2 0-6Z",
            // 缩放接在平移之后，所以缩的是星星本身而不是它的位置。
            transform: "translate(" + cx + " " + cy + ") scale(" + k + ")",
            fill: "#ffe066"
          }),
          h("circle", { key: "core", cx: cx, cy: cy, r: 1.5 * k, fill: "#fff8d6" })
        ]
        : [
          h("ellipse", {
            key: "iris", cx: cx, cy: cy, rx: 4.2 * k, ry: 5.2 * k, fill: WHALE_INK
          }),
          h("circle", { key: "hi", cx: cx - 1.3 * k, cy: cy - 2 * k, r: 1.7 * k, fill: "#ffffff" }),
          h("circle", {
            key: "hi2", cx: cx + 1.2 * k, cy: cy + 2.2 * k, r: .85 * k,
            fill: "#ffffff", opacity: .75
          })
        ];
      return h("g", { key: key, className: "dshpet-whale-pupil" }, inner);
    }

    /**
     * DeepSeek 二次元小鲸的头像：一张 44px 的内联 SVG，部件各自挂 CSS 动画
     * （浮沉 / 摆尾 / 划鳍 / 眨眼 / 喷水），epic 连击时加星星眼与闪光。
     *
     * 不用外链图片：插件产物是单文件 JS，塞不了资源，而 SVG 还能跟着 combo
     * 换表情。id 带前缀避免和宿主页面的 defs 撞名。
     *
     * 长相由六件事决定：连击档（星星眼 / 闪光）、睡没睡（闭眼）、饿不饿（耷脸）、
     * 心情差不差（也是耷脸）、**情绪三维**（眉毛 + 嘴型，见 MOOD_FACE）、
     * **等级形态**（体型 / 配色 / 眼睛比例 / 喷水柱 / 背鳍 / 王冠，见
     * WHALE_STAGES）。收的是 level 而不是 stage 对象，形态在组件里自己算 ——
     * 缺省 level 时 `undefined >= 3` 恒 false，自然落到最低档，不会炸。
     * @param props - { tier, hungry, asleep, sad, dim, level }：连击视觉等级 +
     *   是否饿着 + 是否睡着 + 心情是否见底 + 写在脸上的那一维（moodDimOf 的
     *   结果，可为 null）+ 宠物等级。
     * @returns 鲸鱼节点。
     */
    function WhaleAvatar(props) {
      var excited = props.tier === "epic";
      // 表情只有一个位子，按「此刻最该被看见的那件事」排：正在被猛喂 > 睡着 >
      // 饿着 > 心情差 > 情绪三维。（嘴里还嚼着呢的时候就别摆饿脸了。）
      //
      // 三维排在最后是刻意的：它们**纯表现**，而前面四件事各自都连着一条真实的
      // 数值（连击倍率 / 睡眠 / 饱食 / 心情），被一张「好奇脸」盖掉的话，界面就
      // 在骗人了。
      var asleep = props.asleep === true && !excited;
      var starving = props.hungry === true && !excited && !asleep;
      var sad = props.sad === true && !excited && !asleep && !starving;
      var face = props.dim === undefined || props.dim === null
        || excited || asleep || starving || sad
        ? null
        : MOOD_FACE[props.dim.key];
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
          h("g", {
            className: "dshpet-whale-blush",
            opacity: starving ? .25 : face === null ? .5 : face.blush
          },
            h("ellipse", { cx: 14.6, cy: 37.6, rx: 3.4, ry: 2, fill: "#ff86ac" }),
            h("ellipse", { cx: 43.4, cy: 37.6, rx: 3.4, ry: 2, fill: "#ff86ac" })),
          // 睡着就把眼睛换成两道下弯的眼睑（顺带也不眨了——闭着的眼没什么可眨）。
          h("g", { className: "dshpet-whale-eyes" },
            asleep
              ? [
                h("path", {
                  key: "lidL", d: "M17.6 29.5C19.4 32.6 23.6 32.6 25.4 29.5",
                  fill: "none", stroke: WHALE_INK, strokeWidth: 1.5, strokeLinecap: "round"
                }),
                h("path", {
                  key: "lidR", d: "M31.1 29.5C32.9 32.6 37.1 32.6 38.9 29.5",
                  fill: "none", stroke: WHALE_INK, strokeWidth: 1.5, strokeLinecap: "round"
                })
              ]
              : [
                // 有情绪时瞳孔再缩放一档（好奇瞪大、得意眯起）。
                whaleEye("eL", 21.5, 29.5, excited,
                  stage.eyeGrow * (face === null ? 1 : face.eyeGrow)),
                whaleEye("eR", 35, 29.5, excited,
                  stage.eyeGrow * (face === null ? 1 : face.eyeGrow))
              ]),
          // 眉毛：只有情绪够格写在脸上时才有这一层，所以平时的鲸鱼没有眉毛。
          // 单独一层而不是塞进 .dshpet-whale-eyes：那层在眨，眉毛跟着眨会抽搐。
          face === null
            ? null
            : h(
              "g",
              { className: "dshpet-whale-brow" },
              face.brow.map(function (d, at) {
                return h("path", {
                  key: "brow" + String(at),
                  d: d,
                  fill: "none",
                  stroke: WHALE_INK,
                  strokeWidth: 1.4,
                  strokeLinecap: "round"
                });
              })
            ),
          h("path", {
            className: "dshpet-whale-mouth",
            d: excited
              ? "M25 39.4C26.6 43.4 30.4 43.4 32 39.4Z"
              // 睡脸：一条短横，谈不上什么表情。
              : asleep
                ? "M26.4 40.4C27.6 40.4 30 40.4 31.2 40.4"
                // 饿脸：把嘴的弧翻过来——控制点抬到端点上方，于是向上鼓成撇嘴。
                // 心情见底也是这张脸：都是「过得不太好」。
                : starving || sad
                  ? "M25.6 41.6C27.2 38.8 30.4 38.8 32 41.6"
                  : face !== null
                    ? face.mouth
                    : "M25.6 39.4C27.2 42.2 30.4 42.2 32 39.4",
            fill: excited || (face !== null && face.filled) ? WHALE_INK : "none",
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
     * 拦住一次事件的冒泡（拦不住会顺手把卡片折叠掉）。
     * @param event - React 合成事件；桩件里可能什么都不传。
     */
    function stopBubbling(event) {
      if (event === null || event === undefined) return;
      if (typeof event.stopPropagation !== "function") return;
      event.stopPropagation();
    }

    /**
     * 台词气泡。没在说话就返回 null。
     * @param state - 当前状态。
     * @returns 气泡节点或 null。
     */
    function renderBubble(state) {
      if (state.bubble === null) return null;
      return h(
        "div",
        {
          // key 跟着这一句变：换台词要重播一次弹入动画。
          key: state.bubble.key,
          className: "dshpet-bubble",
          "data-kind": state.bubble.kind,
          "aria-live": "polite"
        },
        state.bubble.text
      );
    }

    /**
     * 成就 / 任务面板。刻意写成普通函数而不是 React 组件：卡片里那几处
     * `findNode(card, 节点是函数)` 靠「第一个组件就是鲸鱼」定位头像，多一个
     * 组件就会把它们带偏。
     * @param state - 当前状态。
     * @param config - 生效配置。
     * @returns 面板节点。
     */
    function renderPanel(state, config) {
      var pet = state.pet;
      var owned = state.achievements;
      var rows = [];
      rows.push(h("div", { key: "t-status", className: "dshpet-panel-title" }, "状态"));
      rows.push(h("div", { key: "status", className: "dshpet-sub" },
        moodFaceOf(pet.mood) + " 心情 " + String(pet.mood)
        + " · ⚡ 精力 " + String(pet.energy)
        + (state.asleep ? " · 睡着了" : "")));
      rows.push(h("div", {
        key: "mood-bar",
        className: "dshpet-bar dshpet-bar-mood",
        "data-low": pet.mood < config.moodSadAt ? "true" : undefined
      }, h("i", { style: { width: String(pet.mood) + "%" } })));
      rows.push(h("div", {
        key: "energy-bar",
        className: "dshpet-bar dshpet-bar-energy",
        "data-low": pet.energy < config.lowEnergyAt ? "true" : undefined
      }, h("i", { style: { width: String(pet.energy) + "%" } })));
      // 情绪三维：只写一行文字，不给进度条。它们不驱动任何数值（见 MOOD_DIMS），
      // 配上一条和心情 / 精力一样的条子就等于在说「这也是个属性」。
      if (config.moodDimsEnabled) {
        var dim = moodDimOf(pet, config);
        rows.push(h("div", { key: "dims", className: "dshpet-sub dshpet-dims" },
          MOOD_DIMS.map(function (item) {
            return item.icon + " " + item.label + " " + String(pet[item.key]);
          }).join(" · ")
          + (dim === null ? "" : " · 写在脸上：" + dim.label)));
      }
      if (config.dailyEnabled) {
        rows.push(h("div", { key: "t-daily", className: "dshpet-panel-title" },
          "今日任务 · 连续到访 " + String(state.streakCount) + " 天"));
        DAILY_QUESTS.forEach(function (quest) {
          var done = state.daily.done.indexOf(quest.id) >= 0;
          var progress = Math.min(quest.goal, quest.of(state.daily));
          rows.push(h(
            "div",
            {
              key: "q-" + quest.id,
              className: "dshpet-quest",
              "data-done": done ? "true" : undefined,
              title: "达成给 " + String(config.dailyQuestExp) + " 经验 + "
                + String(config.dailyQuestSnacks) + " 零食"
            },
            quest.icon + " " + quest.label,
            h("span", { className: "dshpet-quest-n" },
              String(progress) + "/" + String(quest.goal))
          ));
        });
      }
      if (config.skillsEnabled) {
        rows.push(h("div", { key: "t-skill", className: "dshpet-panel-title" }, "技能"));
        SKILLS.forEach(function (item) {
          var skill = state.skills[item.key];
          var need = skillNeedOf(skill.level, config);
          var full = skill.level >= config.skillMaxLevel;
          rows.push(h(
            "div",
            {
              key: "s-" + item.key,
              className: "dshpet-skill",
              title: item.label + " · " + (full
                ? "已经满级了"
                : String(skill.xp) + "/" + String(need) + " 到 Lv." + String(skill.level + 1))
            },
            item.icon + " " + item.label,
            h("span", { className: "dshpet-skill-n" }, "Lv." + String(skill.level)),
            h("span", { className: "dshpet-bar dshpet-bar-skill" },
              h("i", { style: { width: String(Math.round((skill.xp / need) * 100)) + "%" } }))
          ));
        });
      }
      if (config.memoryEnabled) {
        var memory = state.memory;
        // 天数按「最后一次互动」算而不是 Date.now()：渲染是纯函数，同一份
        // 状态渲染两次该得到同一块界面（也让冒烟测试不跟着挂钟走）。
        rows.push(h("div", { key: "t-memory", className: "dshpet-panel-title" },
          "记忆 · 相处 " + String(togetherDaysOf(memory, state.lastFeedAt)) + " 天"));
        var lines = [];
        if (memory.files.length > 0) {
          lines.push("📄 常改 " + memory.files.slice(0, config.memoryFileTop).map(function (row) {
            return row.name + "(" + String(row.count) + ")";
          }).join(" "));
        }
        if (memory.tools.length > 0) {
          lines.push("🔧 最常用 " + memory.tools[0].name + "(" + String(memory.tools[0].count) + ")");
        }
        var busy = busyHoursOf(memory.hours);
        if (busy !== null) lines.push("🕘 常在 " + busy + " 点干活");
        if (memory.errors > 0) {
          lines.push("💪 跨过 " + String(memory.recoveries) + "/" + String(memory.errors) + " 次报错");
        }
        // 一次都没观察到工具调用时给一句占位，免得标题下面空着一片。
        if (lines.length === 0) lines.push("还在慢慢认识你");
        lines.forEach(function (text, at) {
          rows.push(h("div", { key: "m-" + String(at), className: "dshpet-sub" }, text));
        });
      }
      if (config.achievementsEnabled) {
        rows.push(h("div", { key: "t-badge", className: "dshpet-panel-title" },
          "成就 " + String(owned.length) + "/" + String(ACHIEVEMENTS.length)));
        rows.push(h("div", { key: "grid", className: "dshpet-grid" },
          ACHIEVEMENTS.map(function (item) {
            var has = owned.indexOf(item.id) >= 0;
            return h("span", {
              key: item.id,
              className: "dshpet-badge",
              "data-owned": has ? "true" : undefined,
              // 没解锁的写着怎么解锁；解锁了的就只报名字。
              title: item.label + (has ? "" : " · " + item.hint)
            }, item.icon);
          })));
      }
      return h(
        "div",
        {
          className: "dshpet-panel",
          // 面板铺在卡片上方，点它不该把卡片折叠掉。
          onClick: stopBubbling
        },
        rows
      );
    }

    /**
     * 开始一次拖拽：把后续的 pointermove / pointerup 挂到 window 上。
     *
     * 挂 window 而不是卡片自己：指针跑得比重渲染快，只听卡片会在快速拖动时
     * 丢掉事件。监听器在 pointerup 时自己摘掉，所以不需要组件层面的清理。
     * @param store - 宠物状态源。
     * @param event - pointerdown 事件。
     */
    function beginCardDrag(store, event) {
      if (event === null || event === undefined) return;
      if (typeof event.clientX !== "number" || typeof event.clientY !== "number") return;
      if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
      store.beginDrag(event.clientX, event.clientY);
      var onMove = function (moveEvent) {
        store.moveDrag(moveEvent.clientX, moveEvent.clientY);
      };
      var onUp = function () {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        store.endDrag();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }

    /**
     * 让瞳孔跟着鼠标转。
     *
     * 全程不进 React 状态：算出来的偏移量直接以 `--dshpet-eye-x/y` 写在
     * `.dshpet-root` 上，由 `.dshpet-whale-pupil` 的 transform 读走。鼠标一动
     * 就 setState 会把整张卡片（含面板、徽章墙）重渲染一遍，为了两颗瞳孔挪
     * 一像素，太贵了。
     *
     * 头像矩形是缓存的、最多每 500ms 重量一次：pointermove 一秒能来上百次，
     * 每次都 getBoundingClientRect 会强制同步布局。卡片可以被拖动，所以缓存
     * 也不能是永久的。
     *
     * 减少动效时**根本不挂监听**（不是挂了再判断）—— 关掉动效的人不该为一个
     * 装饰性效果付出每秒上百次回调。
     * @param config - 生效配置（开关、幅度上限、回正延迟）。
     * @returns 摘监听的函数；没挂上时返回一个空函数。
     */
    function trackEyes(config) {
      var noop = function () {};
      if (!config.eyeTrackEnabled) return noop;
      if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
        return noop;
      }
      if (typeof document === "undefined" || typeof document.querySelector !== "function") {
        return noop;
      }
      if (prefersReducedMotion()) return noop;
      var rect = null;
      var rectAt = 0;
      var backTimer = 0;
      var write = function (x, y) {
        var root = document.querySelector(".dshpet-root");
        if (root === null || root.style === null || root.style === undefined) return;
        if (typeof root.style.setProperty !== "function") return;
        root.style.setProperty("--dshpet-eye-x", x.toFixed(2) + "px");
        root.style.setProperty("--dshpet-eye-y", y.toFixed(2) + "px");
      };
      var onMove = function (event) {
        if (typeof event.clientX !== "number" || typeof event.clientY !== "number") return;
        var now = Date.now();
        if (rect === null || now - rectAt > 500) {
          var avatar = document.querySelector(".dshpet-avatar");
          if (avatar === null || typeof avatar.getBoundingClientRect !== "function") return;
          var box = avatar.getBoundingClientRect();
          // 还没布局出来的时候量到的中心点是 (0,0)，会把眼睛一路瞪到左上角。
          if (box.width <= 0 || box.height <= 0) return;
          rect = box;
          rectAt = now;
        }
        var dx = event.clientX - (rect.left + rect.width / 2);
        var dy = event.clientY - (rect.top + rect.height / 2);
        var dist = Math.sqrt(dx * dx + dy * dy);
        // 归一化再乘幅度：这样偏移只表示「往哪儿看」，不表示「离多远」。
        // 鼠标压在头像上（dist 约 0）时不动，免得除出 NaN。
        var scale = dist < 1 ? 0 : config.eyeTrackMax / dist;
        write(dx * scale, dy * scale);
        if (backTimer !== 0) clearTimeout(backTimer);
        backTimer = setTimeout(function () {
          backTimer = 0;
          // 鼠标停下（或离开窗口）一会儿就回正，不然它会一直斜着眼看某个角落。
          write(0, 0);
        }, config.eyeTrackIdleMs);
      };
      window.addEventListener("pointermove", onMove);
      return function () {
        window.removeEventListener("pointermove", onMove);
        if (backTimer !== 0) clearTimeout(backTimer);
        backTimer = 0;
      };
    }

    /**
     * 宠物 overlay：连击徽标 + 台词气泡 + 成就面板 + 宠物卡片 + 零食按钮 +
     * 特效层。点卡片折叠/展开属性面板，点头像摸头，拖卡片换位置，点零食按钮
     * 喂一口。
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

        React.useEffect(function () {
          // 眼睛跟鼠标。挂在这里而不是插件 setup 里：监听器的寿命应该和这层
          // overlay 一样，卸载即摘。
          return trackEyes(config);
        }, []);

        var pet = state.pet;
        var fullness = 100 - pet.hunger;
        var expNeed = pet.level * EXP_PER_LEVEL;
        var expRatio = Math.min(100, Math.round(pet.exp / expNeed * 100));
        var showCombo = state.comboCount >= 2;
        // 饿了只是表现层的告警：hunger 封顶 100，宠物不会真的饿死。
        var hungry = pet.hunger >= config.hungryAt;
        // 心情见底 / 精力见底同理，都只是脸色和条的颜色。
        var sad = config.vitalsEnabled && pet.mood < config.moodSadAt;
        var tired = config.vitalsEnabled && pet.energy < config.lowEnergyAt;
        var frenzy = state.buff !== null && state.buff.kind === "frenzy";
        // 情绪三维里最突出的那一维（都没过线就是 null）。它排在上面四种脸色
        // **之后**才轮得到：那四种各自对应一个真实数字，三维只管表情。
        var dim = moodDimOf(pet, config);
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

        // 拖过的位置：整层跟着平移（卡片仍然贴在自己那个角上，只是被挪开了）。
        var rootStyle = state.pos.dx === 0 && state.pos.dy === 0
          ? undefined
          : {
            transform: "translate(" + String(state.pos.dx) + "px,"
              + String(state.pos.dy) + "px)"
          };

        return h(
          "div",
          { className: "dshpet-root", style: rootStyle },
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
                // 暴食期间倍率是双份的，徽标上得写出来，否则数字对不上账。
                + (frenzy ? "  🔥×" + String(config.frenzyExpFactor) : "")
            )
            : null,
          h(
            "div",
            { className: "dshpet-stage" },
            renderBubble(state),
            state.panelOpen ? renderPanel(state, config) : null,
            h(
              "div",
              {
                className: "dshpet-card",
                "data-tier": state.comboTier,
                "data-hungry": hungry ? "true" : undefined,
                "data-stage": stage.key,
                "data-asleep": state.asleep ? "true" : undefined,
                "data-buff": frenzy ? "frenzy" : undefined,
                "data-dragging": state.dragging ? "true" : undefined,
                "data-dim": dim === null ? undefined : dim.key,
                // 小动作挂在卡片上（而不是头像上）：几条 idle 各动一个部件，
                // 用一个 data-idle 派发比给每个部件加类干净。
                "data-idle": state.idleAct === null ? undefined : state.idleAct,
                title: "心情 " + String(pet.mood) + " / 精力 " + String(pet.energy)
                  + (dim === null ? "" : " / " + dim.label + " " + String(pet[dim.key]))
                  + " / 累计喂食 " + String(state.totalFeeds) + " 次"
                  + " / 累计 " + formatTokens(state.totalTokens) + " tok"
                  + " / 形态 " + stage.label
                  + (nextStage === null
                    ? ""
                    : " → Lv." + String(nextStage.minLevel) + " " + nextStage.label)
                  + "（点击折叠"
                  + (config.patEnabled ? "，点头像摸摸" : "")
                  + (config.dragEnabled ? "，拖动换位置" : "")
                  + "）",
                onClick: function () {
                  // 刚拖完那一下不算点击（浏览器会在 pointerup 后补一次 click）。
                  if (store.dragged()) return;
                  setCollapsed(!collapsed);
                },
                onPointerDown: config.dragEnabled
                  ? function (event) { beginCardDrag(store, event); }
                  : undefined
              },
              h(
                "span",
                {
                  className: "dshpet-avatar",
                  // 摸头挂在头像上而不是整张卡片上：卡片的点击是折叠，两件事
                  // 得分得开，所以这里要拦住冒泡。
                  onClick: config.patEnabled
                    ? function (event) {
                      stopBubbling(event);
                      store.pat();
                    }
                    : undefined
                },
                // key 随「刚做了什么」变化 → 节点重挂载 → 动画重新播放
                // （鲸鱼的张嘴 / 脸红也挂在 .dshpet-eating 的后代选择器上）。
                // 进食和摸头都在动 transform，一个元素只有一个 transform，
                // 所以是二选一而不是两个类叠着挂 —— 摸头这一下更近，它赢。
                h("span", {
                  key: "act-" + String(state.eatKey) + "-" + String(state.patKey),
                  className: state.lastAct === "pat"
                    ? "dshpet-patted"
                    : state.lastAct === "eat" ? "dshpet-eating" : undefined,
                  style: { display: "inline-block" }
                }, pet.avatar === "whale"
                  ? h(WhaleAvatar, {
                    tier: state.comboTier,
                    hungry: hungry,
                    asleep: state.asleep,
                    sad: sad,
                    level: pet.level,
                    dim: dim
                  })
                  // emoji 头像是用户自己配的字形，插件不擅自按等级换。
                  : pet.icon),
                state.comboTier === "epic" ? h("span", { className: "dshpet-halo" }) : null,
                state.asleep
                  ? h("span", { className: "dshpet-zzz", "aria-hidden": "true" }, "💤")
                  : null,
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
                  // 心情 / 精力那一行：卡片上只报数字与一个脸，细节留给面板。
                  config.vitalsEnabled
                    ? h("div", { className: "dshpet-sub dshpet-vitals" },
                      moodFaceOf(pet.mood) + " " + String(pet.mood)
                      + " · ⚡ " + String(pet.energy)
                      + (state.asleep ? " · 💤 睡着" : tired ? " · 困了" : "")
                      + (frenzy ? " · 🔥 暴食" : ""))
                    : null,
                  // 徽章行：只摆已解锁的，没解锁的留给面板（卡片得窄）。
                  config.achievementsEnabled && state.achievements.length > 0
                    ? h("div", { className: "dshpet-badges" },
                      state.achievements.map(function (id) {
                        var item = ACHIEVEMENT_BY_ID[id];
                        return h("span", {
                          key: id,
                          className: "dshpet-badge",
                          "data-owned": "true",
                          title: item.label
                        }, item.icon);
                      }))
                    : null,
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
                    stopBubbling(event);
                    store.snack();
                  }
                }, SNACK_ICON, h("span", { className: "dshpet-snack-n" }, String(snacks)))
                : null,
              // 成就 / 任务面板的开关。和零食按钮一样是卡片的一格，折叠时也在。
              config.achievementsEnabled || config.dailyEnabled
                ? h("button", {
                  className: "dshpet-badge-btn",
                  type: "button",
                  "data-open": state.panelOpen ? "true" : undefined,
                  title: state.panelOpen ? "收起成就与任务" : "看看成就与今日任务",
                  "aria-label": "成就与今日任务",
                  "aria-expanded": state.panelOpen ? "true" : "false",
                  onClick: function (event) {
                    stopBubbling(event);
                    store.togglePanel();
                  }
                }, BADGE_ICON)
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
       *
       * 三类喂食事件之外还认一类**只观察不喂食**的事件（tool/call）：技能与
       * 记忆是从「你在用哪个工具」长出来的，而那个名字只有 tool/call 才有。
       * 它走同一道 gate，所以翻历史 / 重放同样不会重复记账。
       */
      var petFeedDefinition = {
        kind: "dsh-pet-feed",
        match: function (event) {
          if (classify(event) === null && observeToolCall(event) === null) return null;
          return { id: "seq-" + String(event.seq), role: "start" };
        },
        start: function (_context, match) {
          var event = match.event;
          var classified = classify(event);
          var call = observeToolCall(event);
          if ((classified !== null || call !== null) && gate.admit(event)) {
            var now = Date.now();
            if (call !== null) store.observeTool(call, now);
            // tool/result 既喂食又要看成没成，两件事都做。
            var result = observeToolResult(event);
            if (result !== null) store.observeToolResult(result, now);
            if (classified !== null) {
              store.feed(classified.source, classified.tokens, now, classified.output);
            }
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
