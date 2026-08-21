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

      // 本实现补充：进化系统。养到头之后按「主要在干什么」分化成四种形态之一
      evolveEnabled: true,
      // 到这一级才够格分化（正好是传说档那一级，见 WHALE_STAGES）
      evolveMinLevel: 10,
      // 主技能至少这一级 —— 四门都平的人留在传说金鲸，那也是一种养法
      evolveMinSkillLevel: 5,

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
      // 普通升级（未跨档）的得意值，比成就 / 进阶低以免前期常驻得意脸
      pridePerLevelup: 8,
      // 一次工具报错涨多少担忧
      concernPerError: 20,
      // 饿着 / 久坐 / 深夜涨多少担忧
      concernPerWorry: 12,
      // 三维每分钟回落多少（都往 0 走，没事就是没情绪）
      moodDimDecayPerMin: 1.2,
      // 一维涨到这个值才「写在脸上」
      moodDimAt: 70,

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
    var STATE_VERSION = 2;

    /** 多宠物上限。 */
    var MAX_PETS = 999;
    /** 蛋库存上限。 */
    var MAX_EGGS = 99;

    /** 蛋类型定义：key → 对应种族 + 外观。 */
    var EGG_TYPES = [
      { key: "ocean",   label: "海洋蛋",  icon: "🥚", shell: "#b3d4ff", species: "whale" },
      { key: "forest",  label: "森林蛋",  icon: "🥚", shell: "#b3f0c4", species: "fox" },
      { key: "code",    label: "代码蛋",  icon: "🥚", shell: "#e0b3ff", species: "cat" },
      { key: "spark",   label: "灵光蛋",  icon: "🥚", shell: "#ffe6b3", species: "bird" },
      { key: "circuit", label: "电路蛋",  icon: "🥚", shell: "#ffc4c4", species: "bug" },
      { key: "rainbow", label: "彩虹蛋",  icon: "🥚", shell: "linear-gradient(135deg,#b3d4ff,#b3f0c4,#e0b3ff,#ffe6b3,#ffc4c4)", species: "random" }
    ];

    /** key → EGG_TYPES 条目快查。 */
    var EGG_TYPE_BY_KEY = {};
    for (var ei = 0; ei < EGG_TYPES.length; ei++) {
      EGG_TYPE_BY_KEY[EGG_TYPES[ei].key] = EGG_TYPES[ei];
    }

    /** 宠物种族默认属性（孵化时自动填）。 */
    var PET_SPECIES = {
      whale: { name: "深深", icon: "🐳", avatar: "whale", label: "深海小鲸" },
      cat:   { name: "喵喵", icon: "🐱", avatar: "cat",   label: "代码猫" },
      fox:   { name: "狐狐", icon: "🦊", avatar: "fox",   label: "探索狐" },
      bird:  { name: "鸟鸟", icon: "🐦", avatar: "bird",  label: "文鸟" },
      bug:   { name: "虫虫", icon: "🪲", avatar: "bug",   label: "调试虫" }
    };

    /** 蛋里程碑：达成条件 → 获得哪种蛋。每个 id 只领一次。 */
    var EGG_MILESTONES = [
      // Token 累计
      { id: "tok_50k",   egg: "ocean",   test: function (g) { return g.totalTokensAllTime >= 50000; } },
      { id: "tok_200k",  egg: "forest",  test: function (g) { return g.totalTokensAllTime >= 200000; } },
      { id: "tok_500k",  egg: "code",    test: function (g) { return g.totalTokensAllTime >= 500000; } },
      { id: "tok_1m",    egg: "spark",   test: function (g) { return g.totalTokensAllTime >= 1000000; } },
      { id: "tok_3m",    egg: "circuit", test: function (g) { return g.totalTokensAllTime >= 3000000; } },
      { id: "tok_5m",    egg: "rainbow", test: function (g) { return g.totalTokensAllTime >= 5000000; } },
      // 喂食次数
      { id: "conv_200",  egg: "ocean",   test: function (g) { return g.totalFeedsAllTime >= 200; } },
      { id: "conv_500",  egg: "forest",  test: function (g) { return g.totalFeedsAllTime >= 500; } },
      { id: "conv_1000", egg: "code",    test: function (g) { return g.totalFeedsAllTime >= 1000; } },
      { id: "conv_2000", egg: "spark",   test: function (g) { return g.totalFeedsAllTime >= 2000; } },
      // 成就解锁
      { id: "ach_5",     egg: "forest",  test: function (g) { return g.achievementsUnlockedAllTime >= 5; } },
      { id: "ach_10",    egg: "code",    test: function (g) { return g.achievementsUnlockedAllTime >= 10; } },
      { id: "ach_all",   egg: "rainbow", test: function (g) { return g.achievementsUnlockedAllTime >= 20; } },
      // 宠物收集
      { id: "pets_3",    egg: "spark",   test: function (g) { return g.petsHatched >= 3; } },
      { id: "pets_5",    egg: "circuit", test: function (g) { return g.petsHatched >= 5; } },
      { id: "pets_10",   egg: "rainbow", test: function (g) { return g.petsHatched >= 10; } }
    ];

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
    // 鲸鱼娘 28 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）
    // 鲸鱼娘 28 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）
    // 鲸鱼娘 28 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）
    // 鲸鱼娘 28 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）
    // 鲸鱼娘 28 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）
    // 鲸鱼娘 28 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）
    // 鲸鱼娘 28 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）
    // 鲸鱼娘 28 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）
    // 鲸鱼娘 28 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）
    // 鲸鱼娘 28 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）
    var SPRITES = {
    "deepseek-adult-eat.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAEBARQCAAEDAAEEBh8GAQUGAgQHAQIIBxYIDCoJCyQKEDkLBAcMFUEOEjYPBw0PM3YQHlsQPHoQPXoRGkoRJGURRoQSNn4SR4QSVq4TPHgUO4QUQo8USIQVDBcVH1IVRYYVTJ4WPXMXEikXGDsXTo4YI1sYJGAYUY4ZKWsZYrkZc84bKGAcU48dEh0eHy0eIEEegtYfK2kfMmcfR3wgLW8gU44hW5YheL4iQV4jKE0jWJ8kOn0kh80kjtolFiYmKz0mS2QoUoQqM1gqQYIqXJcqZaEqnd4sXIsvO3IvquMwGyswV2oyM0UzRYwzW5QztuM0PGU0v+c2YHY3l8Y4Spc4ibc4qNQ6xus7JDM7Pn08PVM8TYI80fA9cbs+YqM/YppAhqRAqsxBR3JD1vFFcKhGqMZG0O9HSV9HlLNILDxIZZBIorxI2vRLPXlLVo5MfzJObYtSRX5TcZxVNEhWT2xaTH9baqZbebFcPHBcb7VfaYBgSntiToJibnBie8JjPFFlTntlYZJnS31oRXpoS1JoVWNohb5qebZrfpproohsQXdshcxtSXtvgapyjKdzP2dzSHpzc6Fzjkl0PXN1g5Z2Ynh2hcJ4kNJ6RXl7TH5+RnZ+l9Z/P0KAXWSAnMCCgo+DgqyESHqFcouFnrGGS3eLl9eOlcmPoNqQWV+TcnSTgZSXmJ+Xod2YkqiaopCarMGbgoucbH+dqtWforCip9KnZ2eoSUqogHOqeIyuuN6vu9CwtuKxjJu2eHe2jY62u8e5vby6bXO73uK+aXa/oRrA3+PBm6/BoaPBtczB0+HFyuXJf4bJ3+jKzd7Lys/MfYbMzNbNfoTNyt3N2tnOjIzO3OLPe3rPfYLQtLLRfYHTgYfUzsPVUz3VeTbWhn/Xh4jZ2ujao57duEfeycHijDHip5jisari5O7jKCPpxGTr7PPsvrbtozfv6+3xzlvyycDy18708/f10sj12c713tX32c732tD39/n4183528/5+vr5+voA/wBY8FPLAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztvQtUU2f29z9ruRbr/Rt8w5tIgEKwAYXEYKxA5DJE0CmKlbZykSqt4aJg0VqbcdSG4rT0x1jEVbRTphXaWqq1PxVvfxS1GlSoczEaB9TWanSmw2EcybzJ8AsJtyQr797POScJF3WmEPy9650dScJFzvl+nr33s5/LOfzE+f+4/eRJn8CTtn8DeNIn8KTt3wCe9Ak8afs3gCd9Ak/a/g3gSZ/Ak7Z/A3iCx45ISkqKjp7/BM/A+QQBiGRxcUlP6uAe9oQAiKXS2Gj3p0/QC54IgAipVCoZ8pXoh/yk9+1JABCBfumwr6U+gfMg9gQAEP0Rw7/6pPLBxAOYIQ2QSsUjvvykXGDiAUD+CxgeAM4nlwUmHoBEGhAgefyPTZRNPABRQECAaMKP+lB7AkkwgP//OICIAP7IHPjE7EnUARES/owncNjR7YlUgjP4/31i4AmNBUSCJ3PckfZkADw9IyIiQiaflxG/UC5PenIDAeeTABAh4ou4XD+uQCQPiYMuMUDK85/+5AbGEw1AxoM6KIAvEAj4fHjlBxCTCuOXTPCJsDaxAGRBUj6f6+cnAOl8fMfxYxGEFWRN6KmwNpEAokNQ/uTJvhxofn5AXICAO8XXV0QTCOAV5D+JZDCBAJYI+UQ/l0+3P21TfLm0CwQERJYXTdzZsDZxAJQ8op/DD5BKPAAE8DkuAkExGRN2OqxNGIAM1C8gzc0XudQTg5RA9EMYJBZM1PmwNlEAFklRPwl+D5PSurmiAJwlAQALY9ZM0AmxNkEAFvFQup/A7fgBniYA+VJeUECQQpEywT4wMQAUQaTXEwx1fU8COE8ojAwIz89Pmdg8MCEAFoaiagHT+49Qj97P5wEBxWxFcnJyyoT2BRMBIFVBhAtGeD7JfVJi/ACelBcaU5CcAjaRhfFEAFAE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",
    "deepseek-adult-excited.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAAAAAABAAEBAAECAAECBSMDAAEEAQIEAQwFAAEFCSYGAQQGAQQGDCoIAgQIDTYKAQEKBQgKDzMKETwMFEAMH1kNBQ8NEC0NNn8OGEYPDA4PNHkPOH4POoQPPYgPQYwQAwcQMHERHU4RI10RK2wRPIESIlcSKWgSRJATCxgTIlQTJmEUESEUFTUUJFsUJFwUJV4UJ2IUJ2QUSJUVJVcVJVwVKGIVKWUWBw8WExgWQIYXGjkXRooXTpsYGSUYHkMYKl0YOHQYlt4ZU6EakN4bDh0bTZIbV6UbfM8bhNcbitwcJDIcJUkcW6kcbcAdMmIeQ34eX60fVpgfm+MgKzggZLEgaLUgdcghFCghn+YiMk8jFh0jNmYjX6EjZ6kjltEkNEAkTYgkbbQkbrkkf8ElIDMlPVslq+omPWsmpegoRnIoc7oqhsYqtOwrd7wrjcwrodwsd50srOUsu+8tQE8tgKsuTnsvJjkvkbYwICYwuuoxW4Qxwe8zSmEzrdQzxe40VGc1LkU2yvA3ZY84o8g5nLw7z/A8X3I8dYc8jbQ9aHs/gZZAudxBKjJBLThBO1ZBl9BF1fBGz+hHb5pIOEJKSGJLOD1L2fFNrsVQVndQb4VQeqZS3/JVus5WRk9WjaJWw9tXMzxb4/NcX39cmK9dy+JfiLZhVmJhe5JkQE9lao1n5vNppLxqX2xuS2FvhLtv2exwdJlz6fV1S1d1r8h27/x3ydx36vV6VWR6a3Z8gqR8lM99doR+6faA6PWDf42F3O2HUV+Hk7iIX26Ma3uMoNSNiJiO6PeXk6Gbc4abn7Wbq9efZHegfo2mrsKmv9Oqi5iroKezcYSzuM64zNy5lqC7q7K+t72/f5LBws7Ef5LGzN7Io6vNip7O3uzPsbXTc4bVycvY1Nrav8DblaTb3urdjJ3kqbHllarmyMfo3d7purrugJDwn7HxzszywsPy3dfz5OH02NT04Nz13dj16+r19Pf2sL724Nr44t3549v7+vv+6OD+6OAA/wDLODj9AAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnQtQU2fe8N+Zd4b5OszwMV8IC3kTwuRCYJMCIeGyL5BCRLlYEMQCyiuwQKoiV+HVdoFqi5dWa9fFrgusWClKL2IrsqKtt1atrqLVqhWlXmihqOgWaQg0BCbf/3mec3LhpsIBddx/TExOSM7z/53/7bmck/8wPufyH0+6AU9a/g3gSTfgScu/ATzpBjxpeSIAQmJ5bjy1OvZJ7Hu4TD8ATwHPLVAdGmQM8lVHT/veR8i0AwjggfhSL0J9x/3b6ZBpBuDJ5cHN0/T6yXvB9AII4YH+AsstydO6/1FkWgHMx8f/RctNr03n/keTaQUg5nGdnUOmc48Pl+kE4In0Fzz876ZVphNAqLMzl/eUGcC0AhCgCDCN+3skmVYAXO5T5wHTDYAnn8b9PZJMawwAC/Cbxv09kkwnACculyubxv09kkxrHeDH5Yqnc3+PItMKYJaA+1wHQdQX4j7PdQBICDeAPHnppZdent5djyHTPR4QJPA0BvnGqoPDI1JSU1cvfeIUphnArPkhogCu2J3HcwHhK+dmL1s6vS0YLtMKIHpJerBALOAGuAlkMi6f7+Li7KLMS1s9nW0YLtMIYGleZoSS7+zM47q4s+1ZLCGXj8zAOTx/zRvT14rhMm0AFuXkKblcd46DBPrEUBEJ3DkskQsW59TC5U8sFkwTgPkZM1VQCLuzOGIuzxmswBkU50ocuYSAqqBg0fQ0ZIRMD4DotBw0GCJmSXiAAelPGHBlAppA4ROKBNMCILkgG+nN5ch5XAGlPxIXZ2d3AQoEri4RhbnLpqMpI2Q6ACSnpQrQcZfLnJ3xE0sRgw3wwzI8sgtzl09DW0YI4wDOjdgSnZYqRmpzFXAXoydWBAQCF75Hfn52VmHu+0w35hGEaQBfdgzfMj8tQyzAmqIhUQHS30wAVQKw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",
    "deepseek-adult-hungry.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAEBAAECAAECAAECAiAFAQIFBBUGAAAGByQGBygICioKAQQKDDQLAwsMDS4MKnwNFFIOBAgOEkEPF1sPMocQCBcRMYERNowSCA8SNogTFkcTN48TQJAUGVQUKnMURJEVEBcVImgVOZEVRZYWHEwWHWIWPJYWQo0XDSEXFDIXGCMXHDsXHFsXIV0XJU4YHF4ZHGEZHV8ZHmEZM3oZPIQZQp0aIGIaIS0aJ2gaY6obCxcbH2QbS6UdKWUdR5IeKDkeVa0fL1ofO2ogSVkgXbUiEyQiFzgjQ3MjY7skIE4kNEYks+olab8ljccmTX8mTpYmU2ImZ7Ymd8QmqeYmuu4nGyYnPU8nbb0nbcInj90oV58occQomM4on+Eowe8pXnMqJDcqdccqdsYqo8wqw+srecwsKlYsebQse8sskNssz/MtfcsuftAuq9cvW4ovf88vgM8vhdMwh9YxFCsxNWgxX6kxZZcxgtMxg9IxhNEygbkyhtEyh9Mzye00uN02PnQ2aoU4QVw40Ok5bqE6HC861/A7fZo8TGU8hqM8htk8j6o9dI09uc4+SHw+mbQ+xNtAKTVAOlNBzuxB3/JEWHFFVIhFrsRGg8ZG5fNHpLtJ5PRJ6fdKic9LMTxMXZFO5PVU1OxVRltXZ5ZXkt1YOkRZd69as8lbxd5fisFiUWdjZYRjdJpk4/RliatqQU5qk89ueJFvmthwYXJxl7Vy1Od2puB3Sll5g6Z+UmB+b4+Hor2HueeIkbKKVWWKwdaLcHuRzeKVgIyXk56XqcSa4++bY3Obt+KgyeWkm66luM2n1u6qipOqxuevbn+x1fO1l5q3sb+4doa5yNa6oaq65+/G1ODHfY3HvMXMrK3MzNbOh5PS3+nVgZLVkJrXpKfat7Xd6e/iiZvj5OvkxMHmsbHo2dzp0tHqlqbqw8Dr7PHu9PbvurnzqLHz8/b0w8D0z8r00Mz1zsr11M/11c/2zMn21c/21dD29vn2+fr30876+vv82tT82tQA/wAkpTXeAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXtcU1fW95/P+wevn5APL/AmmeSBXHwTIJYh3MHRIdhoGcGCUNQWFLVFRKmgomPxUq8weAWpUq90xGpV1Ha81fFSL7VULCoqaBCMAqIzEig3RSHhk3etvU9CaPvMTBtO6Od5Zp1JchLtZP++e621195n5/gfpv/h9h+D3YDBtn8DGOwGDLb9G8BgN2Cw7d8ABrsBg23/BjDYDRhs+zeAwW7AYNu/AQx2Awbb/g1gsBsw2DYYAMbK3BRKRbDnIHz1j20QAMgUYkWwu2nsuFn2/+4fm/0BBCtEbkznj7X7l//Y7A4gXOwm9mXO/0cCELqJgu39nf/I7A7AzU08zt7f+Y9sMDzg1+D5FrM7AJlI7G3v7/xHZncA7iLR/+wQMI0Qyez+nf/ABqEQCv5VJYHBKIVlvyYXGJTJ0DjIAn6rho0K9RgVF5c/ejCaYLHBARAsCwlVKsRoilBNxAerBqMV1OwPYJFHqEKhEIvEQi9XmViBhzIidY/d28GYvQHEeghEQqEI9ItkfJ6T1A30Aw5l1IZtdm4JY/YFsErj4iUD/SIkIFaIXFx5QkJAIQ5NThuU6bFdAXyglsuFIgHpfxL/CoXclSGgEA+OE9gRwKwdHnKhQkSNEgAGLsNFCmriiA0f2K81ZrMfgFUbPFwEYrN6GgNisUghlBH5SnhE7U+wW3PMZjcAqyar0fchAMz6qQ+IxC4uJAdoxAr1hv129wF7AVi0P0qAfS8QmD3AbCKxzA0cIDRGHbFhw4b9+XZqkNnsBGDW/g1K4v1CgaXnxSQG4EwAQRCVGJEasWEyHHYeC+wE4JP9UWKMf7ELBLuS5kDGCUI1CpkwNDkjJjUqavKGDZMz7NMis9kHQNrkDRlJmOdELuoIONRqZajCRUSyoDJCDS6gyciISFUnb0hK3T/F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",
    "deepseek-adult-normal.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAAAAAABAAEBAAECAAEEAQEGAwUJAQQKBwsOEzgPBAwQDRIQDR8SFj4TGEYUEiQVGUIVGkoWChIWOYYXFyoXPosYEhkYIFEYLnQZNX8aIkcaTaEbJVkbQowcKV8cWbYdR5MeFh0eU6UeXL0fHzQfICghS5UhVqghX7ghZcQiKU4iK0AiL2kiL24iMWQiPH0iW6wiZ74kM3QkUZokWKUkbMglNG8lW6klbsMmPXcmc8onNXYnNnMnNnQnOHQneM4nfNEoNFooNXUoRX4oYKopNkcqN3cqgs4qgtUqiNorKTMsHCMsjd0tKEEvPWswPU8waLAxT4cxcbozR3QzYJM1idE1l+I1puc2Vmo2Vow3QVY3SmA3esM3nuQ5YHA6gcg7JCw8kto+T3k+aKM+ibs/M0NAjNNBa5VBiM5BpN5BruZBtupCVoFCcapCjdJCkNVFbH5Fj9JGebJHT2pHkdRHlNVHl9FHtuRILzZJjJ9LW45Meo5MptBMv+lNttxNzOlOfchPO0ZPdJxPlr9SV29U1OtVp7tWgbpWyeZY0upZQk1Zma5Z2utaZZFantxbwt1cUWdcb6NeZX1e1+xf3+tgtsth3e5i3O5jgqJk4u1l5vBnSVFneKxpfrxqz+dsseZtX3hwcZFxjM5xocNyod5zSlh2jrN2xOR3muB6WF96fal7b3t7m+B8f559md99sdN/mtt/puR/2/KCVWSCyueEirCGwOiHpOWKnL2LiqGMZXGN0+6PeX+Sq9uTl7aVYnSWrMGbmKmdc4Keus6fh4+it+WkorSpk6GpwtepzearbICrsMytr72xeYy1uta5ipi9m6PAdozAy+jBrLHBvMjFzNvL1ubNw8zOfJPOpqnPt7nQz9vU3OnVgZXXi6HZ4uzesLPev7zgnqbh2d/h6O/j5O7klqzoz9Ho5enpvLzpx8Tr7PLv8PXxpbDyzcfyzcnzxMLz1M7z1dDz8/b0srf01dH1y8b10Mv12NL19vj31tH4+Pn72tP72tMA/wAZGw5LAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXlYU9e+9+/fed7igYfyhiEEDvSFyEmQMMQQGcJwGXqRMlMs6It4EIKAUoanKupxhIpSRUGpE9ij1rmKqKXOY62looIK0YiCV0kEMRXM8Oz3t9ZOQrD19vTevXf6vPYbhSQM+/f9rN/6rbX2xL8R77j+zdIBWFp/ArB0AJbWnwAsHYCl9ScASwdgaf0JwNIBWFp/ArB0AJbWnwAsHYCl9ScASwdgaf0JwNIBWFoWAhCW6J+QMDnZMhsfJ4sACJscECCM8IInUy2x+XGyBIBAHk/oaoHt/qosACBkIo8XyPxm3yILAODx3D2Y3+rbxDyACJ6LuyPjW32rmAfg4e7iyfhG3y7mAbi6u/yBeoAFAHi/6wBQH2B+o2+VJeYBHu7OFtjqW2SRmaDIJYR88skX0yyxfXNZZi3wQUSIYyIvIEAaE5tbvmyBRWIwyCIA+M5OLi68iRN5EyUgafb2ndMtEQaWBQCIPN1JOdvb2woRAkns9kOfMh8IFuMAHJ3c3V3tbT3dJ7q78HxcHdzAf2hoaHbrLqYjIcU0AJGLu7sd2xY+TgQFBEx09QzFimlttUhBZBiAs7uLizMXkgD7xwx8eGBfKpXG7G77mNlgsJgFgPw7ObiY+QcCvABMICa7pe0TRqPBYhQA8u9iB/5dxgAEBATwUBGAsWB7W8tHTIaDxSSAIOTfyc3dPAECkITgPyZte0tLWyuD4ZBiEAAX+Xdxcncf3wNAEyVSaX6rbDcQYHwsYA6AtYsLEHBDBcDlDQCSAGlaa+t2WUvLbsbLAHMAnNx5kACe7gjDRDMAkpi1a8Wh2dtbW2XbW7a37mQsIFKMAZjkzuOhBEAl0MXY+BLJxIDo4vysGHFMbP72/Oy1afltDE8JmQLAdnEXohLggjMgIDQgJjc3FAOAIUAiEUtj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",
    "deepseek-adult-pat.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAiYCAAEEAAEECDMGCjYHBAkHDDsHDD0HDj8HFVEIAQIIDTgID0AID0EIEUYJBggJHWAKAwsKBA8KBBMKEUIKGVgKHFwLED0MDjQMKXcNF0wNIGUOAgkOFkcOJWwPAgYQCxEQCyMQFUEQGlIQH18QImcQKXASHloSJWMSJmQSKFsSL34TCRkTHlwTJGITQZwTS6sUFyUUJWEVJWYVM4IVRqMVU7QVYsUWGkcWHT4WNW4XBhMXDycXL3cXNocXPHYXRYoXWrwYFDUYHjAYH1MYIWQYIWYYOYwYPJEYRoAZEBwZIWYZI2cZUJAZedsZiOMaI2YaI2kaKG4aLGYacdQaf98bNV4bmuUcSZ4ce9AdKTsdN34dQZYdacsdjtkdjucdou0eEyUehuQek+sfIUkfY7ofmu8fqO8gU4kgbqohO00hrvMiJVkiVqAiX6ojGDwjYZQjasIjuvMkJk8lFzElVnEmfrgoGR8oMGwoZYAosOkoxPIqR14qgeAqzPMq0vMrOXYrP4grRXErz/QtLlotyvQuSpMudsku1/UxksMx3vkyQn8zbpAzotUz3Pw1Iy81vOk3lLM4hKk5eZo52vo7Mkg7aao8sNg9TIU9pMY/T3dGQWxGWZFILDdMSn1QPVdQXH9ZPEhbSWpbVoRcZZdgd7plZ4FldbNlja9qVm1sc6Ntmr1uRlRuhs5uh81wg8ZyhsFzhc52do13w+d5i896XoJ7T159j9V+iat/k9SBgrWEmNmFk8iHkMqJWW+JbI6KWGiRod6SoLqTaneXhaCcn9edfoylYnylr8msobyunKywvNixhZGxutyzboezweG0vdW3u9640PS6nKW7q7q9zOjBeZLEcY7Eyt3Gjp3GzuDHqLDMt8PNdpXPepjSfZrUr7bV2unZm6jc4evdhqHe5vLfsrXguMDj5/HkyM7mvcDn6fPsoq/tjqjt8Pbvxsbxtbzx7fXx8/jyx8jyzc/zwsb1ysv10NH2q7r2+Pz30tL51db529z529wA/wDXu41kAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnQtUU9e673fvSG6IJySXMU4eEEYyjqyQCDkBDoaAXMPrEAIFlJeKF1AroDIUBGw9FragIhZFutFa0epW2+K7p6iXim7d1lfFenx0H63Po4DvAxaVZ8E9cr8551oBd7e722at6L7ub0ESQLPm/ze/75uPNefKr2xvuP3qVRfgVdvfAbzqArxq+zuAV12AV21/B/CqC/Cq7e8AXnUBXrX9HYBTzxYVMm9ezhinnvLnzJkAQgx+IWOBQs5cJ57058x5ALwMmmjm9btOO+vPmtMAKDVD+t9EANE6ucZJp3o5cxKAELlcE+KcU72kOQmAQaaTj3XOqV7SnAPAXSOX6Zxyppc2Z3mAXPdmA/DSyHVRzjnVS5qzWoEQnZy0gmOjQkKUSmVI1GuSEpzWDxhJaaLHRkUbdBowT09PN083nddrAMF5PcF3oynKR0MpZW52AwavvG10FoB3UjPclDJKRQ3Tj8w7Y6mTSvACcw6AdyIKrHIZmFzuJn+egKd12SsdGzkFQGhBhFoGAJD2P9EPvwiLXOCMQrzAnAAgKj/dE9c+1L9cKRlhVy4necA7PWsR96V4kXEPICffOMKuX8rn8fgMAjnOB56emcFZizkvxouMcwDz8j1kIxTSEaAeCAAIpYInZeJAhvRr9ZFZacu4LseLjGsA8/LVcuXIkSraA3AOlEtVQwQAQHpkVlbaq4oCjgGMyfeWy0aKZDLkAXKGgBulpAl4atw8vTOzwNLmcFuSFxm3AMbmm+Uyd5VcPkImtxPANU/ygKenXu1tNAUHA4GiVzNNxC2AiHy1TEWh0H9ePxAgCTA2NnZUrCkyOBLSQD6nRXmRcQogtShdPoJyIwDchuvH+c/NzcNkCopVp1sDTMb0V5QGuAQwNjdXi3o/EAF2/QwBgKLWh6WbTAFBRrVW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",
    "deepseek-adult-sad.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAAAAAABAAEBAAECAQEDAQEFAQMFAwgIAAIJDjIKBw0MAQYMHlsNI2YOCyQOEzwOFEIOJWsOLHAPFkgPLHsPMIEQCBkQCxIQGk8RBA0RNYcSJ20SOI0TECITFkATOIoTPJMUDykUJGIUOYwUQZoUW8EVEBcVH1UVLXMVR6AWFDIWFicWHDsWX8cWZ88XBhMXI0wXP5EXTKYYKW8YUqwZGkYZJFsZSpsZV7IaCyEaKWoaascab9QaeNQbCxgbHi0bQIcbXbYbcc0bfdMcLXEcLXMcMHccftodK3IdLW4dWqwdYrsdddcdhNkeJTseKWEeLFIeTpAehdYejdsfEiQfUqMfe8wfi90gPU0gkNYgmOAhM3EhVpchZ7sha74iYrUigMYiouQjFjkjLkQjNmUjcMMjdMYkHUsoGCYoJlMoY6ooec4oruYotOQpPXcqQ2wqu+srn9csqeEswegtW6AuSF0vM2EvhLYwabAxQ34xxusyOE4zV2k1HzE1SYg4cbc4ksA4zu05UI86ZX48Uno8YZQ+QXE/JzVBdZNBh59Bk65BvuBC1O9HstNIpshJnL1KLT5LbqZL2fFMXZVOTnxOu9tPyOZUd71WPllYutxZW49ZxeRaPExae61a3PJb4PZc0+xeaqZhgchihMFlapFl3fJnjNZoWGxqR2Fqe8FqhqtqrNJrjsdtR1pujM5vU4pxkK91l954UGp4eKN5f596Y5F6mtt7Z3p7mtV/mbd/ouGAUGqBdoeEoeKGsNiHoeGHo+GIc5qJhpyKW3eMpeKM2+yOkLqQqd6TWnuVbomXlLCawNycsOOekaSfZYihpbyjepepbJCtscivwd+wvNy0dJm2hJ+5d6G6e6K6xeG8nqvBfKTDucbE1evIqrXI1ejJ0OPLws7L1ujQi63RzdvXsb3X3erYnbHc2OPgusPksb3l5+/mk73prbvrvsbt2+Ht6vLt7vPvxszwosLxzNDx1djz0NTz8/b02Nv31tn39/j6+vn73+L73+IA/wC74/HrAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXtcU1e698+f55P5BENC0smbZCCGcAIcoRBCSAOcQ7iHy6BQ5AgC6gieiqCotUItilrHKkq5FFqtCEixlymWqrRWnVrtp7UeBUFRuQwDCAim5RAGiYCf/T5r7dxQO+07SXZ823k2uWqy1++7nvWsZ6299s6/EL9y+xd7F8De9k8A9i6Ave2fAOxdAHvbPwHYuwD2tn8CsHcB7G3/BGDvAtjb7AjAU65OWLPopZfsVwJkdgPgqeTIyWdr7FUEbPYCoGS722nPj5l9ADi7Pyv67QPAme3O9rTHjp9idgHAcmdL7LHfp5k9AEhY7s9KA7APAD7f/ZlxAHsAoPGZLH/qd/sjZg8PYDL5v24Akl87AELEF9ljt081+yRCIpazXfb7FLNTKswVeXpKRNER7pASKiX2TIrsBMCZznVnsx1E7hwOjyfg8eT2KQZhHwALnByYTBGdz6ezOdiAgW+aHQqCzA4AGHQHBzqdDp0hm810YLKAAo/DEyavpr4ohB0ALOQ6IOVsNgvdsfUeACZQBFBdFmRUA/DkOmD1fFI/n8nmcbAHgLmpVlFcGoJyAAwuE+nm0mh09OjAoDmyeHr9QCCQ+tkhagEwuNj7nSAM4idsJp1BYxoJiIMCF1FaHoJiAAu5uPlzGUx9CEABgM7g6/ULZLFxKirLg4xKAAu4uN4duMYYiEMgi8smWwBPFhoUtYTCAiGjEMDzTnTU8PkittHINIBNxx4gEMSGhsbFLaauRMgoBADZH4qA/MfkIwJM0C8UykJDQ4PiMqgrETLqAHjSuXS2uRn1c3hscAEPBQIQGBhVQFmRkFEG4Hk6nUwB9OqN+qHygYBAqAqEGBgaKgsKoqpI2CgDwEXZ71PqH+kXCDlCVXogEJDJxLKoPKrKhIwqAM7gABgAtHiOUT7Z+4ll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",
    "deepseek-adult-sleep.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAECAAECAAEGAQEGBAcIDjEKCAwMETYNAgUNEzsOFD4PFT8PFkMQDRoQF0cQNo0RDhERGUMRTK0SBQ0SGksTFzoTR6MTUrMUHlMVJWoVP5UVWLcWEycWIlsWLX0WW7oXX74YCBEYJmAYKW4YRZkYZMIZExoZKm8ZSJoZSJsaJ04aK2YaTZ8aascbGCwbHkAbUqUbWKsbZb4cIzAcPYkdGiIdLnMdL3cdMWseM3oeX7IebsYgdMshKzghM1ghN3MjSIskbKslQHolidcmYJgmaLQnHSsnJUongdInjtsofMspNUIpO2ApVJApdsEqb7sqk90rd8EresYtLlMtmN8uQVIue8MvQWcvb58vneEwJjUxer0xf8YzSXYzgMYzo+M2TV02hMk2qeg4Vm45erA5vuw6S2o6iMw6j887X3c8VIM8i8s8i8w8k8g9zO4+W5M+hbk+i8o+n88+r+c+xOk/LTk/js9AtOhBkM5BlNJBp+FCaoNCfpxCkc5Cl9RDkatDkc5FmrhFm9hGOEZGZJpHdIpHldNHmNNHmdJJutlJ3fFKm9RKm9ZLhqFLirdLm9VL0+1Ml9FMpdhNmtVObJ9OorlPqcZPrt5Rsc1RzeVUQ1NUkLlUxNtVVnlX5PFY2u1en9tf6PNgdKVghsdh5fFiotJjVGdjZ4llfa9l6/Nn7/huhbVur+JwZXFwjcpwqOBxT1txo95yu+Fzp+F0puB2ltR24fB3jr95h597dI19xeV96PV+ntx/qOSAmtGAo+CCsuaEkKyFW2uIzuyKodmL1u+Mm7iOgZ+P3PKQqNyQ3POS2fKTpt2T3fOWudmZaXqa4vSchY2hsOGmq72nyOGolp6qdIS0fIu0rb21ucq6w9y+0eTDwdLGqarHhZPIzuDJoLDOy9rPjZrQk5vT3OjU2ebVsbDWkJzX1uTcx8Xd4evgm6jg4OrmmrXm6O/nwr3pt7Tu7/Pyzsbz3dTz6+j01c322c/29vf33NL4q8L54NX7+/r7+/oA/wCvPBPEAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXlYU9fW/9//8uQJUHjghxBAIIXwggxlePkhApX5ClRGkaFMBUEQEajwgqBSbS2IYo1oBa4KglpGsaL8VB5Li+JUax24gCNcraggRUOvxMKT31r7nARQUIbE3PvUdYQkqMn+fvZaa6+9zz6H/xL+xe2/ZN0AWdt7ALJugKztPQBZN0DW9h6ArBsga3sPQNYNkLW9ByDrBsja3gOQdQNkbe8ByLoBsrb3AGTdAFnbewCyboCsTcoATJyMTJ1spfsZszOpAnC00DW1NTd2dJLmh8zSpAjA3EJdXY966ii9T5mtSQ+Aubq6urHoxSKpfcxsTXoATNXVF0jtzSVnUgNgrK5uIa33lqRJDYCeljpXWu8tSZMiAK1/49Q3atLLARZa/9bjv8ikB2CBlrXU3luCJsU6wNRUeu8tOZMegI8cLY2Fc5TnfCS1T5CISQfAQidTU4t587im6lpaVr6xIcFS+RSJmBQAmDtxDAx0tSxMuVw1KAZ0rew9vty+S/KfIxmTOICPnFC9lpa6BRhUw5Z2HI6ulVd2YYikP0kyJmkAtroclD9quuoqWhxdXY5HWuFyCX+WREzCAJyo3kflajpKpuRBQ0cNCGiZhab9OzqBZAGYclA+0a+kocRV19LVUlfR1NHgAgFdA7+0VIl+mkRMogAsUL8KpV9HRVeXPIMHJQ3wAThc03ZK8uMkYpIEYDmqX1MJXUGFJqDL1VEnBBLStkrw8yRiEgTgbSD2fzVNLQKAzoO6HDUlLSTgkJW9R3IfKBGTHIBge3WRfnUuEU4cQBcPXY4mSQP22V9m/5tlQokBMPfSEuV/La46DUBXiz50dTXV0QMK0woy/71GQ4kBcDYQ6ddVUaErABQuMnXMgwnZ2WlphZL6SImYpAAs9gDvV1cfdX2SD8YA4KjYeXhm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",
    "deepseek-baby-eat.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAEBAQICAQECARoCAygEAAEEAQMEBjEFCDoHAgUHCzMHGG4IBigIE1QJAQsJDkILLJsMABIMAQUNG2QOH3QOOKYPBxgPG10PKH0QFEkQIW4QJHcQPq4RAyIRBw0RI3ARLYITAhETCzITDScTKHQUMokURrMWNYcXEjwXSKoXTLYYGDEYOIkZBRUZDxoZHVMZPJEaN4EaUbkaVs4bCCYcHEccPY4dJl8dS6AdXNQeUKYgVKshWMAiCBsiGSIiYdkkL2UlIzgoESkpLVApOHEpQoApZ9QrTJQsWKMtIDMvoOoxbtwyZbk0Omg0ToY2Ljs2csU4duI4jds5Kkg5pew6Fy49euA+fc9BKTJBPFxCSXhCZ6pDq+5EgeRFKjpFVYtFc7ZGl+NIielLOUFNX5dOSGpSgcBSiN1TSFZTVXxTaqJUGTdWketXRk9XkNJYSzdalNdbOUZbkttdltheXYNemtxfcKphm+xibpdik9ZjUlxlmdxmQVJnK0NobZRpte5qpu9rXGhrealue71upfBupfBvqvBxiMpzanlziyF0OUx1grF2rvB5cCJ5tPJ6ZZB6fpt7SFt7pOp7tvF7vPF8uPJ+aWx/jbt/l9l/wPKBuvKBxPOCtu+CxvSDgIyFUGOFm8mFyfSHaWKHltqIv/OLn+CLod6MfXuMjaWOneKSfG+VW3SVma+WWWWWbIGXlp6Xod2XqtSde5Sfk2aiye+jj46lo8Glq7umueCpcn2r1PCtsNiucGSwbIKwcXqyh5myusy13vW2ioy4n6a6aH27vd68ioa8nZq9xdbAfJLBq7HDnpnJajXJzeDLh1HM3OfNeYzPur/Qlm7QrqnQ5O/VgZPV2OTXjKLZjZfZrpHZ3N/Z7/bahZbe3urfpJzfu67goajg8/jjiZzlysHolKno8vXp6O3rtLPu+Prw0Mfx1crzrLT02dL1vrj2w7v2ysD30sb32Mr32s/328739vj43c7439H54NP54df5+/v74tP9/v39/v0A/wCQucZKAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnQtU01e2/2d1lqyBAmmcFeRNoYCIiIIoL8UKopG3gBb+8hAQBGEs4wOhBcvTBd7CWB3xgVwEio46+GIuCoVLB1qtoJPWVkArUJSYQPABhACSrPz3Ob/fLw+00wsk5N7V7h95ksfv+zl777PP+Z0kvxP/yu13qt4BVdtvAFS9A6q23wCoegdUbb8BUPUOqNp+A6DqHVC1/QZA1TugavsNgKp3QNX2GwBV74CqTaUATKwNHA2szVW5C6oE4BwVv7+oKH9/fJSz6nZCdQCco7MqK8tKS0tKS0uzwu1UtRuqAmAelVVZWkIYECiL2KCa/VAVAPNoqfyS/fHh4dHxqiKgEgDm8ZWE+uLS0uQNjiZwl7WlgSr2RDUATJIqqebPirKg7nVUwZ6IVQPAnXL/sv3uMnevU8GuqATAyvgysv33qy75S0wFANyLCQ8oLV4/92/+mqkAQBTpAGXhc//er5sKACSVkQFgPffv/brNPQATEkBZ1Jy/9ZtMBR4QV1ZSDFuWKkcAUlMBgADIgcXFJckr5/6t32AqAGCXBfqLS6Pn/p3fZCoAYBJdCgBK4ub+nd9kqqgEnfNRCEhz4EoTawM7O2dnOztHa3OTOd4ZlQyGAkolHmDuaOnkFZ2cn1WMxkZZFSdzE/3ttOdwX+YewBrcE+IcYO3v5ecbklZcWVmGrbKssrKyoaH1Uoo7fa52Zw4BaFs7OruvX267fLm7c3gxDAQCkrO2g/wyPCuEpkXIU2VLe3tzpvvczBXOEQATa/eUCzX1oK/kWH7a9kg/r+zi8PyytF1ZaFqM0k9syGpbnrTXJc7FCHlOAND9j7S2d7WAfyMfLysrzspO8Nudtb/kWCly/krCUBCQBOC8suXJQOtHyi+WlA9A2y6l+clAe4NEHeHxxfl4MhDkl2QnREYm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",
    "deepseek-baby-excited.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAECAAECCC4DAAEDAx8EAQEEAQMFF2QFHG8FL6IGDTgGElYGIIYHIHMHJY0HKJYHKpsHK50HNqkHX9MIAgUIOa0IRrwITsQIZdcIatwJAgoJED4JEUkJI3gJPrMJWMwJb+AKHWoKcd0LatYMBAkMCSsMJX4NAxINDjUNduIOKYQPBA8PW8UPaNAPe+QREjcRgOYSBx8TBhITFE4TGVkTJWoUMogVcdgWDBUWDz4WVrcXCi8XTq0YCiUYFUYYHmAZPZMaFDwbBxgbDTYbRZwcDi8dGUweLG8ehucfFBggIFIgMnkhDyYhImciHUYiXrojKlYjOX8kFjImjOkmmvEnGR4nM2IpacUpkessQIgtHjYxLVczIyg0Pm00R4w0U5w5l+45oe88X6M9JVk9KDU9SHc/Uow/l+RAarBBqfFCfcdEiNVFQGJGMD5IsPNJUn5Jc7dMOkZQW51Tkt5UW4pWPGdWn+NXRlBXfrpYZKdZZ5pZiMdcM0deU2depuVesO9fba9fcqNhKWZkd71kk85nPE5nW25nrelqufFsnNlue6tug8lvY3hwTG1xtu11vvN2S1t2hrR2jN94TV94ot55bX95vfB6fap6wfJ8j8x9S2d9wPF+YZJ+qud+xPN/YnV/ue1/wvKBxvODmuODxfOEk7uGpO6GwvCHP1mKdoaLOXOLdKiLqtmLwvCMVmuMxvKOyPKPjbiRse6TnMWTqO2WVYKWvu6XgpOXs96ZXnOap+Gax/Cby/KfsfOhp8ulbJ+lveKmlqOm1PSobIWoteqoxu6sqb+wyO+0dZK0t9K1YX+1jJ64pau+xt/A2vPCorHD0OnEbozFeZfFtL7N4PTOgqDP1u7QrrrRv8bY3vPZyM/b2+Tddpbg5vPkusLm7PbnhJ/qkKXr7/jt09nwkajxvcLxzs/yepTyiKHytLrzmrDzur/zwcX08vT11tX19vj2yMn219T22tj229f30M/33tr33tz43tn5+Pn6qsL85eH9/f39/f0A/wDhltQqAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXtQ09fW958/GGfCHYHhNtxh5AEGEF8QBuTmIwIjRxFxBOoIikeu1vKghwekIhaOgLTh1aMxNJVDYtBDj5W0WC8VqFCtUgWpIgIawagUlSQQLkmTybv2/v0SAtI+Bwih523Xz9wIhv397LXWXnv/LvkP+e/c/mOpG7DU9geApW7AUtsfAJa6AUttfwBY6gYstf0BYKkbsNT2B4ClbsBS2x8AlroBS21/AFjqBiy1LSmAgI3RSUlJiZEblrANSwfAJzG9pLSGxmDQqOWZKZFL1YylArAhuYTGYrGqkcEjvTR7iRAsEYDYgmpWNYMJG53OZGIGpSlL0pIlAWCdTGXRGdjojOrqssKSgv25h8syI5agLUsBICCFzmKQVs0sT0/cGCKXR0QmZ8UsQWOWAkAyvZrsfwarNHnj1BvhoZpvzBIAiCxk0ZnY++nVeRunv6X51iwBgJRqOuEAdHp6iOb//AzTPICQAjIB0lnZ1hr/6++Y5gGEFlaT+suXIOTfsSUBgDyAzqQlavxvz2JLEgIo/9FZBUufAORLlQRBP52erPk/PYstyTBYjUaA0iWb/0yzJSmEaHQ6rbp85RL86XdtKQCEpNNpNHrBEvzlWWxJJkOhmfRKegnpAQG+PqEbwXx8ApaiLZoGsDLCB8w2s5JeuBlmQKv9wpKzC0rKy8tLCrJTEiMdNU5BgwBCfFdHJ6UcycvLO5KSnEWnJUf7hWeW01gcDqexsbEV2RcX8pIifTU6PGoIwEofx9iDtW2dnR1YaCObxmDlxqNFIfb582wmjQpGYzA58N6N46mrNchAIwB8HBOPtfVyu1o5HBarGq2Dsdh4FYjNZlYzGTVUGBbQ2hgTXrEBwtVjiY4+mmiYXCMAfKMPtvULu1pZWDOyajZs8AqzYDAwCrw6SP6c09pY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",
    "deepseek-baby-hungry.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAECAAwDAAEDARYEAAIEAQIHDEEIBBgIBSoKAQULABILEE4MAAkNBA4NGGMNIHkOJYYQCCESAQ8SARoSGVMTBxQTDCwUJW0VCzgVOZ0XBCMXFEIXFTUXIFkXKXkYRasZAxYZMIUZMm0aBioaCSQaPZEbJmAbSZ8dG0kdULEeCxkeRH0eVbYeV8AfNIgfOXkfUasfWacgFykhDzQhI08hWbgiV7MiXsMjW7ckIDYkKFYkTockaM0lHUAmYrsnDiknXZYnarAncdUoc9cpdtkpec0qbMMqc8gqeNoqfdEqfswrLmUsc74se9wsjustJkouOmwugN8uiOUvhOIvhtMwmu8yMFgygtwynO8zGSszkOg0ieI1OGA1nuw2ovE5Jjc6QHc6pu89e8Q9ktw9luo/NE1ArPFBQWBBZatCn+BCo+hDTHNDVZZFSIFFh9JGapJIneRKj99Kse5Lpt1MWH9Nk71OLD9PQWpPS2NPU4dPdZ9PmeVShK1Sv/FTmdxVn+hVsuRXVm9YXaRZQFNZa7Nam8lat/BavO1cYpRexfBfyvFhoediouJiwu5jZYJku+ZlyO9mPlJmc7tnbqFppMlqqOpq0fNsX4luzvBvfMhvjrNwTGhwq+lxb4hyeqpzM01zapdzy+50rd55ZHB6fJd6htR7SVp9dp5/tOmBkdaDiKiEbHqE2vOJjNqKgauNUmqNk7ySdoKTX3eTmuST3/KXlqiXye+Yq+uZoeia5fWbos6fWHOfgouipumjsuyko7ems9enwfCrjZqsz/KtaYGtruiuxfGvscSvt+yvwPKw2/Oysdyzuuizwuy1vNy3zfK6mqW8c4m8veu8wtm9rb++yfHB1fLCfpTGvtbHqKjHy+fM4fXOzNfP1/PQjpzSepbUsrLW1+rX4fbf19rg4PDihqDit7fi6PXlk6Po4OHp7fXsw8DurLDv8fbwi6DznbL0vLv1yMP20Mr22ND239X29vj33dT44Nb4+fn54dj7+/v85t385t0A/wBsm297AAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnQlQU1f7//8zHWeQKfMDqZRdKCgGCrIoIrIpWwCRTZZQIpSdKiIF8VUU3GrZFKWiqBVtqUsRseCCKBURFVwrIi+0sqhgJBZMlSUQksn/OefehODS9pUb0pn6vSRsIZzv5zzPc8659+bm/wn/5fp/sm6ArPUegKwbIGu9ByDrBsha7wHIugGy1nsAsm6ArPUegKwbIGu9ByDrBsha7wHIugGy1nsAsm6ArPUegKwbIGu9ByDrBsha7wHIugGy1nsAsv33cyw9zczMZs6RXQtkCsDQmO7i5eXsYE7zlFkbZAhA29jNy8vLzcBSVVnbbKasWiE7AFoWXi4uLg7TPsHfTZsho2bIDIChg5cz+Nciv1VVlVE7ZAVA1cIP+p9uKPp+gYzaITMAZn7u7i4u+jL67xKSEYA5Dl7u7l7mmrL575KSEYCZ7gDARWalX0IyAoAywMtBVoVPUjID4OXuZyCb/z1WskoBL3cvLyiBn376ifCjBZqaUzWny6geTDyAjxZ88skn6nQgMFNZ3dBQS0tFUU1JSVFRRUVdfbrmhGOYUADQz+paKtNmzpw5zQwA6BsYGemaaiDpGhnNs7OzNjfQ11LV/GQi2zRhAKbKq1v62joudnOyA81Ts/DzM9M10iDs6xqZzJo1z8kFxgYna+OZ6soTx2BiACjLW8aXXO7o6miov1SY5AUMTHTofjQDBAC63smZEPrsAsOjA81Ge6JyYSIATDdMqWphszsubVvp5eKMutnL3W6uAd3BdN6seXaEc2LDcnGGArk4wX76BDRtIgDIBx25y+7pKE5ydwJhi3az7Nyd7ByczOeK3ePfjTJw8fJbmR80EVEgbQCaNiXQ+Q17vEiHRJzbzZplh1zbiftegoAL2kDM7UcspR8F0gUwVSv/l7aulu248yX62AWq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",
    "deepseek-baby-normal.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAACAAECAR8EBiYEEEkFAAQFAQEFAQIHFFYIAQQICisIGF0IHGgJETwJHXMKEDkLAAwLDzIMABMMAgYMImENIV8NJncOAQkOH1YOI2IOJGUOJGYPBB0PJGAPK2wQBQ0QGEgQPI8QPpQRO4sRPY8RQJMRQZcSQpoTFjkTNn8UAhkUAw8WCBMWDS0XByEXDicYT6kZIE0aBRUaRpQaTqMbEjYcDhwcGT4cJ1YcVbAdEzEdLmIdQIYeCSYgVqshCR0hH0YhXLgiSosjYr8kEiYkGzokPHMkX7MmNWonJksnUpYnacUoHDYobcsoctIpar4pd9csGyUuWJ4uccgvLlIwgt8yJTsyQXc0etA1hd41iOM2YKU3arQ3ieQ4N1w4i+Y6LEM6jOQ6juo7SX4/crxAhNhAkOlBkOdBkexBkupCKzNCRWdCk+tElOtHN1BHVoJHecRHluxMND1Mj+FNmu5QPmJQU4FRYJNTne5UgstXaJlYQVFZUWlaoe9bmeVdoe5eS4BfWm5fc6lgjtRiYJRipO9ipvBmYnpmpu1ncJZqgLdqqfFsm+BvrfBzTFhzfaJ0SmV2V4x2cYR2sfF3jMB4mc96V2p6qel7oeB9Z5V+e5B+tvKBjLCCls+GotCHqd6Hu/OJV3CJa3uKip6Kod2MdaKMlbuMsOaNv/OPeYeSYo6SueyTwfSUxPSXYHeXh5GXo8mZgaiZxfWalaWatdygwOihsdmhxu+ko7akyvOlapilboCmjqWqaoarsMmtz/SveIqvvuC1mbG11PW2rra7c5W92fa+zOPAgJfBq7nDvcfD1+7D2vPHe53H3fTLytrOjKTO4vfRep7SuMLUhKLW5vfX1eDZf6PagqTaxsjbi6fb6ffd4+7ehafeobXh7PfikqzmmrLmwsnm5u3orL7o8Pnp0tHs7/Ts8/vxobryucfzz9Hz2dnz8vT09vr21dX219X23Nr23tr239734dz34d334t334t744975+fr6+/r86eP95+P9/vz9/vwA/wCrZ4XbAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXs4ldn7/79X/OEi08f86KOT3y4VuxmkNM4JJYfIj4xT7CiVK8JVE5pKMZ2kb1OpNOk002k6KoX6NBmjaFJKooQh5TBhy2Gz2Xtf+3evtZ5nHzCfqTy7PddV92o/Pftkr/dr3fe91nqO/yP+yO1/lF0BZdsnAMqugLLtEwBlV0DZ9gmAsiugbPsEQNkVULZ9AqDsCijbPgFQdgWUbZ8AKLsCyrZPAJRdAWXbJwDKroCy7RMAZVdA2fYJgLIroGz7BEDZFVC2fQLwoX7IytzUfPaH+rF3sA8DwMray9vTdZbdB/mxd7MPAWC288Kg5X7Odh/gp97dPgCAWYEhoaHesxT/Q+9ligdg7bc0hONnqvDfeU9TOAAXv9CgEH9rRf/Me5vCAFj5evnOEYvneYeGhIQ6TFHUzwzZFAVgVnRMTEzY4jley0NClvoZKuhXGDAFAbBaEhmybFn4Uu+ApSHLwr3+uQ6gKADOy0JCgMDSpUuXLQtZ6qSYH2HEFATAK2IZ6Ce2NMRCMT/CiCkGgF1ghEQ/APjH9oFihXmAQ6RE/7LwZR+fB4hn+YVLCUQMzAFTjI1mmFpYWCOzMDWcYWusrDypqG7QOWi5JAQiAo1l3zKeYeHkutA7LCR0+fLIiMjly0P8/ZYEOjibzjD+q7+mQFPYQMjaL4J2gqUBkhj4wsTUYWHYUhgjREaERywNRyUcKMALESF+gb4WM6YpqkJ/YYobCpu7hkVGEgYRC03wS7amrn4gPmL50uVLiYVLCrwWERMZ6udl/WEdQZFzAVMH75CYiKWhy0IiXEHUDKeFS2MiQSnSK7XlRD31JCJmuZ+rhdGHywiKnQwZWXv5hYK20Egvc2e/yJjl2OuXheO2X4p1QwknHkB5wvLImKVLbMw/FAKFzwbnOHt5+4UsjVmyJCYiPDwcaCwLl0QA7QE0kXAqKmAa4TprrKKrhk3hAKapQyQEhS+NDMcm0Ulb+FL515B/QIlY7e86y1bRlRMrHMAUc5slIRHLw5Gfg0Usl2Y/eQLLqZiQZsXImDCHGYoPBIUCGOsSGAb9HWrV8AhScNTLZP6l4VKTfRUeERGrw3yNFFk/ZAoEYLwgccPqCIlCpD+cZIGly5Gfh0v8IjxiGUVAygI+GB4eE7dkloKdQGEAxhr+cDpuORnpSD0AZXzk6cuoMRD1+tJwQod6TfpeZNwGX8UOCxQFQGXFrUOoh1su5wERy4EB3fdhzcuXS6KD8hDc9NR/8PmY9YEzFFRHbIoBMMX8p+IdSyWKIoj+iEgZlYgFKeTVyAi0FikhEUF/ImJ9/CwFjo8VAuDz4IclccsjKK3LZNtYhskyoo+iEEEVWQKEWkTcKmfFhYEiAIzd9LJg9fKISEIA8h2tRaqtv1cgnZGRkfg7cgUzWR3jpDACCgCg/kNjbqREvzT+BytEcQSlfwAB2itWxy1WFAHmARid6s2PiYCZHVYTIdOS+HmkZB1pJp+Kodah0HFAv0+RWb0zSkEEGAdglNN3P2Y5UUO1KNZNtW8k7euREn34vRj6G5GEEvWZSIpDzPozaxQzN2AagGFOL8p/tH6ZFpfVHynRJ7EYehkh/zk0SoqA17fkKoYAwwDUc7hlm5dHyvpzhFQNtR4j0+LUOjKZ55R/oLWdublXtsF6+M7cFYoYFDILQD2TW7MXBIbjjVx0FNB6Q0IiIynfiImhNMdI1qXPpSUmJqGkpqamLDsOnp0pXMBoZYkxCmDsD9zWa1DthL07V1NtKhPfMX4hMsoGsWVynoA/FbG3srKssrImPyFy9er8W+ZM1pYYkwA+31Tfen91eFx2ZU3NBXmfRmpCvP9K/Wry8FsmGw3YHyJ3VpaVlVWW1eTHxaxOKE5nvitgEMCU4Kqmym3LEoqbkNfG9fPqmNXefv1UkwJryGDp7zMATWRcMfIA8IFs+OiOsqjPmasvMQYBmN9rarwQnlCC9NdXbsbaZM1t2Wqp7sFsmbecdkIuu5IQqNwBkM4UMZ4GmANg/FNvY3Hc6nysvx57wOrVMhRC3AZVLWvekYQQMrR66NDqmM1EPnKBuNVx93PUGaswMcYATFlRX1+zN+ZYPdJfU58PSs7nxhHfxks/b/RsdRx+QEFGlsTgZb8Q2jdidl5PiInZeQEwnqshAArQt3ZWrmE4CBgDMAcCIHd1XEk91l9/LGZ1dmUuqnMC0gmaHP3Wx/2NhYXRvhCztyw/jtBanU0IFCcgSlcKGe4JmAIw5QdufeW21YfADZD+koTV52qKt0ELH8pOwOKWWa5a/9eWgJerwuJoAnH5ZedpX7lSWYN6Qvxn1t/fzuxwiCkA0AM0XY+Lu95UgwkcW51QUnYI9O/IPbQetfx6b8sNmxM2J4CtT5AYemUzMfR6TBhudRwQO0vur6cjZG9+WWXx3rj1UOL2FrowVGViDAEwzumtr9y5Pi6/vh75QG5c3LaCY3HQqDsOkdaNszdL2LJ58xZp2UItaQMIG7xl4mHvGWoFVK/fsXNzHPGVuNwfGJ0TMARgJejOhea8jtu/ANWW1Bi3N/LuyTZbdmzbsWPHlh1/ZVu2JLiuWo/bGSuNW0/pR0/W036zfmfeHGbqTIwZALa3mirLDm3etvkYxH99/g7KvxMk/r3ZT9dp5w4oO6kHvdxBrcMzMKfALetlIiSBKKde2UL+UlzuJiY7AkYAfL69vqQkfwe08LbzBflndsj6OfbuLVtctRbv3blz7969O6VlJ7XcSS137vQdF7dZkhXA4uKQepIptiD/2bZlc8KhW0zuLWECwOfriovvl5zZAW2JvRyTQIaW6Nm2Hat0v486tBfZob3k/0Ft8axARG8bnRfi/DcgDogg+kvYT7Ztyw5moNK0MQDAeE3R/YL7BVQrYp/ubzsdvrkTdei/2F702LvX9bhFEqJHlR07wtw27EAk0PpO4kE7th3azmAMDB2A0fbi4oKCglwZz+5ve+MXPCYAjh07dqh/kbGox9/bSKmB5DjHaJwddhL1yINSknbss2JAOWVDBuByquQ+6L+f3c+bqQgnUe/wS/WDqGN/Y8BizdPqb6LlEPrN3Cb5kxSlpPhtDE6JhghgRmx2SQG28zLRfUg+zA9Fb6yufrrm2Jm/tGNnCIKNj+8cd05K2SH97ir7+EN7ZZ3k2LEzSUsWMyMe2VAAGM+KvVp8n+gvoF0ZcQApEvFQ+22LHz9+8Hjj3vMg9TwyspQaheF82uLYhUsWei1ZEp1CwTy0zT1QRjuyM2cupDG4w/T9ANhu/CZ4xdpTeTj67+NyRtpIZ87LBfaxwG92xwbG+u67cP78hQtXUDl/5YJsATsP5ehC75CwsFV+S1aFRS9Jo74dNjNNJkwwp/NXjvoqGYA4vTi/oBgHf8F9bAVn6Dg+BurOHEuh1R9KWeKwZBXM7/yWpFy48t/sTNLCwNT0gwdPxnqtWhW2MOUYbvMNjvEXZIIFOcyF81fOMUbgPQEEXyeuf5/Sf7/gPN1IF7KvXLlwIOkY8di98Uu8wsKWRCcnxi6MP3P9enZ29nW6XCf/Z1OPCwcSb9TxXz199nhj9N6UeCCAmnyn+0LkHZJwuYApXj/H1FjgfXNALIn8+xK7QjLZGazrSlIa9ogzB6LDAhd/d7O0oeWPO2vOEc1/bWsf8bq7Xz2rfrwx/sKxvSnY4Y/5zT2NJF8gRpwlOzv3NENHYL8vAOPtBfcpAMUwDiwuzsW1vZKbmwtKLkSTlH8gOmnJxqd/dvH5/Lbq3afRW9dPo0UuKrn4cY16dj332nd1/M5uft1zIJAEis+cR2WVYwr2E6QblGdTBPP3MbNl5L17AePv8kqKkcEsADO4fv7Cldz8/HzQlHs6/gLK9WeS0g5FPXjR0tHRweO/PpuKFacexR+R2Lmr9NqRk/xOXieP3/y8+tnGpOsXsN9f2OaelDvQWXJz8xMZOYpuCN2gy/aMvKKiwqzt6ZjE/fx8cIp8hCA/CTXgBejeLqw9+7y5C/R3dLc8iUUq8/cFSrQjEvnX9xFoufnJv/M7O6Dwm2urnxICkO/2ekQTn5Fov06+fZ2RRDikgZCRy4JgF/UFRcQVgAGKCoQg+sB1HLVXkndX13Uj/bwO/uvdqO3zT/vuw5+hrWDfNcQMSOxqw/o7Onve/FH9bHf0eRz4Z/zcr+UOZvlHmAiCIQ+F7WbllZWUlBSXSBEUZC85BjGbfeV62sanr/m8Lh6yLv6jRNTU1w7uvoYJUBgKrh0ha0czhaCe1wkEeJ2vqqvPBkL2gzHDKrfTmBDxGVLwej4TA8IhAxibXlNCjDAABMWnoy/gHu7cmgev+T1dFIHu9oNXUUOffLA2v0DW9uUWAI2C1Aoej9/Z0NwCBDpRKryzcR9K+Rvc0+RcRuo7RxjYMDBUAJ+vKSsrkRgVCvvicarOjv3lFQ/0o3bt5vO7haWJqN7JT28kF1OjCGTFR49C7ii4lg5dxR+P/iht4QsFAqGg+UX1493R0GekeCQVYEJy4vEzBrLAUAGY51UOIFCSlISzVeLZF+086AE6Ozoa6krrGviCmxD+Bfvu1J5NLZaOIO7np4Ke+6mlgrq7j+r4gpbSnMzMnAp+D4TBjdjk8wc84wsG2D4URgW7lA7AeFd9GWUl0kiIT4GcnZu8+0VLD/JmobCnvbkOGrel6/LVgvyrN/+svpFajBGgRXHJkaz79/Mu8xse1QmFpXsWGKkMG6YyY+WlBnCCp2djl3iGUfONAnr0WVCyyzkbWGYNffvoEAEEl1SWSY1CUBSdBjkqeXdtG58nFDaU3s68XdEhELS8utvQkgwtd6rlVe2N5Pt0wBQXF6YW3U+v6KlrFrTsMRqmoo5NZZjLpZ7XtdWPb2wMLEBjrfu018D/JRkqa1CHO/QB8dAAjD1VLwsAMYBSGH0A62+Gtr+99WstFRUVwwV7SgWCujp+RfK14iMV/Ne1NxKzEYGiQliWZFzNy+G3twgrVg5D2rXMR6ioqMP3NrW0/VFd+3hxrhQWsYIsQ6Nd4AJrlAwAHIBYmSyH7OgD+aC/jico/VYdNSgQUBmmtalC0NnOazh19GqGkN/26vHBw0VlxfePHCkqKylOzWjobOGXugzTGqGqpqrpHBvrrA5fHLaygV968cGabBxZNAVYy983S2yeVVAQq1wAY39qQvttK2UMHc9xLexA8u6LN9uFmTOGIfXqhuaG0K7DZt0WAoHOh1mHW2By0Pz6wcEjhSUlqYmH84rzbvHaOxsWqIxQHf4ZmIbu2rRkZ+QE39wMXvlkzTWZPEsSzT6YC60pKFirXACzymtqKkmRsZrr8V4HX/xsuHUPakQVi6jkRF9rNU0tLfUZQABmBfyWDjQu4vPrfks/lZWXlZF6OCuvpZO/x5ylFxs7EhEYrhp7IG2tlrqWusqi0tcbBwAoO2oqFltlFG9XLoCt6GCIyv6l/qrN7ueveJe0UPObrk1JC9TV+OyzkcPVNEcEV/QAAZt7FKEAABAASURBVB6fR40NhR0Vv2fcKhe2t7R39lT8sEIvr09UyCYEEg8cSAbHUbnU/vq7q5WyOQZK5VUW/P72YuXmAOMcBGCA1Wfsrq5tE/6mBbV3TkpL8VX9bOTIz0auXTtSdc0lmBfIWHe3UCjk83k9PJgFNuSoZYi4raJkHAVq1ifSDiTCn1hQJwuAssprzlCBbxjYRTIUAC7Fg+mvacq4UV3Hb3CByvumpKRFgX4gkCUSlfvq3uvkyRHgd/G7+T2gn9fTIVjj3NjbyhWdwgA+U00vTDsQpaKucrP54NUafKxYpXSZmzpDLJ6TPE+pADbV4wYnzU79jwBk3ahtEexR0VIPTktLS2Z9hqJ6raiXK3qotrZVqh9mCN1d3d1AoKsHfED4UGNxH5fL7Y0lADR8uUUn0haoqKxrO5gnl2RQnskrioIaMLBdbCgAfsIRUFQjIUBK062zL7orzNXVTfelpeWtUMNyEkXcXi7XV+2hsAOUd0mtG5eeri7BT6qf5YlEvekanxFTuycqPp2srm5eOhiAEoZ2kQ4BAE4B9YXp9TL60dERTXlnX/GRAyQeOFF8T5WoYVeJuH01NqrbBZAFQDc8eOhB9HfDumCx2vCRiemL1dQoAqo/iPqKT1irq1/aVYgByGRaAFC/QtkArO4BgKbYXVx8XJzEapoKD75qWKCu7px2tEq0nQIwPKq8t3HXcA3rFpgdYgBUHEDrd8OMkcevstYYrqGmqgZGYkBtDTArilXXCv6uaECiyavknmLkSJEhAJhTjsRqZTbJA6ivL979+jb0+omnq0StwVRzDlfTW+yrMXy42j0SA7wOnmwM8CAF6AzX0BiuhgEYoLQx3Jfb2yvKYBmyrE+X9dNfmVfTVM7IwUJDBbB1WCa3prJEDkDVwdeXVLRM06r6ROUsIv8zDQ0kbPhw1UxhR0cXFOwHyHgkBwjuAZ6RGhiAhqP71JGfDYdOobevaoGh5uJCmU6WHIWW11TfNPRBwNAAmD+sry9ysf2pqb6qSA5AfeKrTerqi4v6uKLbJAL0h6sBAQ3kASgJ4G2EkjyAPaBLcEttONtMjZijh4f9SAQAfGCNZnA6t5/+psLCpnpuupIBQA5oyjT+/CduTRVUB2pF629Kvxw8Qiu9Dxw4BwEYae8I6lFhQ2ALkAfgBEhlgZ4uPjBovaX2maMl0a/h5gEEPnNu7YU/8d03l7Oa6qVZFv/C1WIAwEg/MJRe4FZ9/VYYj4IH5GHxTbjUQ9OYmhuyHoooABM8PO3ViG9bWmosFlARQG8rxXmQ1w0hMNXDcRT6lOpITwDgabAY9Pf2HfztFOIrl2ZqMtDPlSt7q/CuphIYiawg9WmSFOgHrVmGC6ooDxjv4elJeYCavef4xcKuDqrgAOjmkTwoKNdzdHc3gF5AVdUSA7DcDgh7Gy9XJFPia+hIayrM4sKyionjJIYCYEVl4RzIhQ+b6tPL6dYnnpC43zz4JQJwS22ku6enp8dINaRf283DMkpAsh+tH3sAFP5LGzd3dzd9DQ1tM6Tfw9MsB0aPfS+bfz/VhNu/6Woe9Qvcw4VclGyZ2EE6FABGt/Ks0Fahpqb0W1yZHFDPPfX7jwRAucZUT2Q4uFUNPDwstwvo7I9nQ1104beudfRw9/BftWrD+hjsAWblMHrsFbZDBGD9hfElTZgztzw6tQheUzoAsW8GWq6oL1yczq2nswACUJjetrscHLiv1dcRA/A0GzNGb7I7ADglwNm/PwEerzXD3sNzAz5CbnOCv4enezKKgF5+xSmSYIrij9Y3NTU1NjX1piatDQafUz4Ase/XsLDK2frb9vImMgqkgiC5orQC1V+03RLr94nZsCEuxh9y+z1ht3QiwKNHQrAiLJ/pEbmNOrJ0veehq5igoPMUdnxu4ZKkXC4i0NSXt+TA2mHrAAkTF2od4lZhPB2dtenNSeIClUXEE7i30rtauAjAPQOkPyhhGzoaejXnQPxLpLdLGgbUOAByYWuyfQI+KhIdOh7intqHPKgdp8Cmmgzn+LRKFAFNveULU06vNbbN7FN2Nygx48zXz9cU4aFAVh4VC8mlHQLUifXGunl6+m/eho+a3RyxKkOA9PNI/u/uIrMB4gOCcq8N+ChRdLSsjz1ygNaWN+l5IDsvkWWRdJ0LzV/PrUpMSste+7n4mxoGdoswA8Dq3p+1N7ZzcaIKzOslHdWurk48jrkHWXADOXJ22+ZIvyp+F+0BfD4eB+MoQEA6WvOWJGzbjD63JTIahhF9rW1vfs+AYW/ywV9MfE8T/y9PjE87WgKj4Dm3GJkOMgHg64ra5883ZvShJJAYe6SGizuCHGEnFzxAlGrvv43SvyUsS0BiHi35DW/kIqEL5gNJqxK27diSEJJUJRL1tjS3tZ06lX7yxoPa4+qJxcgB+goXR6el5Zch7RsZqDozABbV1VY/f7IRtX3TkYMH12bVQF3rU+91IQJ93ET7BOIBW1bt4/d00f0/v0vKgpSuDmHDrX1J8dHxWS9bWyra6krbmpvhb9f++Xql6dWmJm5v5SkL35SU62UlzGwLQMYEgHkNL6qfP3+wEQYDTcWxTx7sXpOeV1hUmFr6pkXYCk5w2HHVZtS3pWWh7cFd9HaA7m60RVA6EkBR0MVvb66ra25ubmv+va2tDVygua65ravCKha6/6pbB4/Pik7JLSsrYe54cUYAVDQ/f/7s+R3nU/VcbvrZ2tpvzE+ePHnq97o3bXUtncJW0cPDSfFJGfda+NL0j8c+1EPqAR0d7W/A2oh2YvCcd3POw5K8UydvPPnG92gR2ij6z/IA4xwhOGr1s8WBa2HQtv3x81+M7r74sxm0gIxm8IOO9oa65jcd7XhLgNy2QOQFNA80PkYAsGzsBDSD9nULTh68cedZ7ffWV8lWcUY2BWBjAsAXm8BxXz2v3hgfH5iYlXG2+sGc/S9qX7ymlKDWRO3a0o4ISEZANIFuGQId7RSAZmKUD9R9/f3Tp9XV1d+zUskOgpqh7xGijZFTZuZV8No7m19fXLhhQ/TuGzeePF/57WuI5DapvQEESH8HmQNJR8HgATwqDogHtMNnkePIeEDHTasHIP/OSmu/DYWYQE0GY0dLM3PO0B5hZ2en4DfXDUlJyY+hTzw+r6Gjo+WNPIGW9g7iAWgkJNUNLtBAcgH2gPY3bfI5oK2t89tFTx9c/NbF1T9kSRo+IKGymLEsyMxZYyY5gs5OYWZUSlJS0nd3al/cNfqNJ5fLsAe0dEgIdLTQvWB3t+DXX4UyHvCGIiDV/7uJyRxzUwe/0JAwC6ejZTXYBZg6cYqh8wbn3BZ0Cn/efgAAJAVuvHjRZFOnnAqUAiQ5AI2BjjeQ7QLdfMFvFxvoGOjokGQB6Vfb16nbTJ/qtywkKGShkbFFYjbaRFyfztAtK5g6ddb8Zo9wa/o5BGBDtIONxbyKN22SlnyDjdLPw+P+3y+WdmAWzY8etQvpaOigCMgweNNZauLk7u4WFgIAHIzRdUpjUzOyTq1h6PRJxs4eN15Xuu7W+SRsYZ5z1S/xKf1vsP9T+nEOhLbuFjT8Udrc1vGmubRZwJf2Bh0kDRAEaAGZ41tNRzc3t7BVISFh1I0qPldh7sxB5i6gMGVOcMlprH+Vn4enxdcN7UQ76QIlfQAVA91CQRd+hc+XjIO66CBob3lDW4vwBxUzdwAQggD8sy+i8vmuspQk6AdWhQGAuSp7+FIVoElOP94n3E3yoMxcAHsARtDS3tIC1FpahJlj2aDfcWZYQlCI3z8bgMvDa6B/w6owbw9vD08nk9/50O6gBKuXxj+eB2D9MvMAma0koB85ATHQr4fa31E3cDOAVcCtOpgDYJuZvwHZKpv5aJOmx7h5pXyiooMeAdFzHjQGkHiAdEZIEyAMgAJPeEndGhKgm/t0o3GrNgf5ODNWW4kxBsBk+7UUrN9Jfa6nNxBwZ80rFXbQ6rH388leMDwKJAS65Qjw8BqPxEFHp7Bhq7oNan93R1OxETs+zGc+87drYgjAbJfEHbj9l1gbq3uR7fru46x+E/LAAzrJEQE8mZkfb0AM0M95eK8R6BcKcxapTEf63dxtponFpuzp012ZO12ONoYAzFscn5QUHx3oPOMrsbED8gAg4M1W39MgbKePi+L3YI0k/6FCnpOZseRVdLwQOm9GULFJhWXpOB3pN7MSi7+ysGZbKOB2dYyFwFdWLi4meIryhQ3xAPABM9ai3/hCdFwUOgqIeH0Prb2HPCeZQUqgGwAIBQ17rLRsHC2trd3c3Wei5G/h6eXkZP0lU9WVmAIuqTnNGQCgLOA6192RPeLb210CPt7yTbb/8Gg/6KZigB4ZUKVLKBCW7rEapm5j5mxlZ+Ph5oDOFZ/mGhDgE6CAbkABAMY6E/2OI9huju5z9UaszGwQCPh4/kt5Qg/m0SNHgNpCJBBUZH5rMsx4tokVCJ/tOtPaDv1RK78Af39/jsMXTNeWeQC2htag39vT3WKslr2bo5u7PVtz1qacBmhYgNDZw6MLxADVL5D83wPihRW/bZozbKxktj97FnWpAOsg/wB/cALG79jDOADjcWxnd9T+FoaGX1mjHO443X66HstlU2ZFi0CAKODjInk9PXzpvlHQLuA33P7523ljxw62rWOaFwfpD+B4Mx0EDAP40khvkr6No5ujjek4fdb/+9IZ5jEORjYwmHEea2y1aNOl2xUtQgE2IT5KFgyWHQ2lmXu+nacyduxfZDmT+RyQHxQQwPFj+KZFzAIwZrEnTZqoz2br6elPHs9CnddMd2s7I7ajGxrEjR071sRq0cpNey5l5twuLS2taGhurqt79ceLi3NMhg0bpvLXvZy5TwBlHH8bRu+78BYA7Gxtjd/q4t7ToPmRTZw4EZYTJrK+ghetnGHibmthI224KbZjQe1YlXnH7zx+iq36+2EqKvCaid1f/WlrLD4IL0K93uJq61/YWZmbvw2pvwdg6zR//kJXJ3MTAuHf//rX//nXvwf74DSWvsEkQgA/JrLsBv2DX80eO9ZwlvqwldXPnj19BvqfVV9cucglNjZKS93kq0G/Ms0pNEBqoXMHI/BvsZ2dnfjf//5C/IWxubPrQj8fP6+3uNjK3wOw8kahF+Qz39XBydnJwdXVy8sLVi363w7IznTi5EmTaAIToAyar74yUVcxXJu6duXX3wIAMOIDxxNPnEjWUldXNxksC3zhECrxAFiGLpQn8KXJLGsbqFcgqpmDq9d8H05oaFBA0NsMG/4egLEX6oH9AzjYQmkL8JxrYyrjY9NY2O+xfrLUH+TnbY3UtbTULQ4nr3v69PGzZzSBZ7+sSTt8eAE5X2yQXmA2AAii2j8IEXCV/vIXM5y9vH2gZtK6cVDGhFo72TEBQGztgwH407/OCeKg2gSBV8x1ljSFlr6k/SkG+gO2W01TB/kjRqjHpiX+Ul1dLdX/YGPqiROJSP0Ilg5LawCC2a6hQZQHoBoEBXHoibFRBmBBAAAQAElEQVSdqasfJzQoSPpeAFkP8A9yNfl7cW8DwNgB/ppEPxgniPyCv39QwHxrUls7PYNJMgQgA0xiy+cgO2OQh0xLK/lE4h3QXy2JgO+TTyAH0GLpjho9eswolpFdP3KyHoDUhs7HdKdYBPqHBtGeIakhWvf3d32ryy29TTdo6xWECfjLeQD6DR/onbywpxsaTJ4sT2DCaLlo/lJLVXMEMQCQfBH0V+MHJICLsSdOXF2rztIZNRqXMTos+WT4uU0o3bLkf44/6lVMHCTy5dof+aeP09tNHd9qHGDlJfUBYrR+sID5psbiL/UAwGTEAMf/BMiBE1jyFFVVKf0j1KOOpiV+d/Dg2cdPfzl79uDBg7vyimoeumiMGjVKe9So0dqjtEfr9vNea46sl8M6xwkGB/Nl5MsxCAjytnjL23K83UDIlo4CmRgA/RQBN9bs2WwCADOAMmHCBLZ8CrCVOMAIrRGxqYfT0lJSD57NeVhV09Ta2/ryXrDGKG1tbURglI62NqtfGjD159DqsHE4TrbWfqEDtRNOnLffdPSWI0FbG3+pD4QEUZz9AzABn+kjjCYCAIoBcYEJevJN8IUmBUBda4SWutas4OT8mqpGkUj08vaeFb7WuhqjtbV1MAEouiPs5H/fyJsjqx/qYGFBMZFmZ+pd1P5vv+nsbYfCtja0D2D+HH9PdzdHR5jreXr6+NiztQAA7QOTUBxM6N8JzjbUhA5AE4kHAlrqKlo/ifpEovI9FmpqGho62qBfW0d3lA7Sr7YiZ89KeXw4C9IKoQZ+qP0lGV8am/jdd7nT+VvPBaAv8KdigMPxc5xK5E4wMDCzdHM00Js4WcaAwOQxck68YG1y6mLoBDQ1cUcIBLQ0NX/oq9pjqqaDWx6bLgv5gA5r8VWuKEf+hBhTH9kcBxq9OX+p39/6HW7L8/aTIdu5HPJLHH9HrN4Al8ng7QYGBvSzyaQ3mKyvJfvdabEn0k6kgnRNiADkASM0dbW1Vdc5q+mMItp1CABtnVE6qnuampqq+h0EYwfzYakHoEmRZJ0QCcEFv2LzLgcPvMNscAaakgYFhXpOlVVL2ttgcj8P0JVvhAVJaSeORg1DKQBafwRLdxyKdTVduvV1SNHU0VFj7UKHF+b0F2Huw5HEuOyIQBIZFIEAjtc7HTzxLtNh8/lQB3830G4go7+fkdfG2fX77oLko0dPREHrq4/QxP09yXZYv46kaLJYURncVm7r7UX9fxzmQ0HS9pd4/QD9oYFvM/57PwBiczN7SzMDA1mPl9dOvWqg178S077emJiYeiDRVH2Erg5STwhoa0vaH7NgzbrF5TaeuvzjINM9W1eZrOcvRyCIJgDtv/Addxy/2waRGWwDWf3yFCSvGOgNqMTXdx7/cjzxwNHDpmqjR48D/bjIEUD5T22TiMutOnnn6feDnBM4Y76EANUfcbBuOf3z33X/6TtuEZIjQPwd5gDyDAzYA+4BMO9O9ZMnTw4m7zvqogZtD6M9MuYdTccB9oBR2joLcnJuXn7w5I+Krwf5cXNvTCDIx086JqP1k7XQue+8yfBdN4nZjpskr39ADjBga9n1/9LN5tqnj588+eXsd4Y6aLSLteto0P0/1f7ao0eP+PbBnae1dR2CnwfLZBY+uCuY6yOZl0m1h6DuyeHdLzf7ztsEjVnICUhrG5A12faHLsCwv/5pm4S8lte1jx9X/2KkqUP0a6iN8439LspaQ01bMg4YpT1Gdd6D2tft3Tx+w4AsiP6QDRrmzlwYRM/7SAxwqNGxt/V7HDz3HhtFbXXZdBQY0P0BRWACPAZ0AOKvK/idPH573asn80ZAx4cI6C7OKe9F4+B7u3S1JQbRoLW/HV9fQnBpsNsIWM2HKHeQ6EfaOTj6OZxQH9f3OnzivbYK27L09A0MDPrrnzx5Ittg4GaQKZeEnZ08tO3/x2GaqA+ALKBbLsJnBMFgeI3GKIl+mAhbVQjRDnRhxWDXRrBzDvJg+3GoHoBWH8IJDfVzfc+7Mr7nZnFjK5Yee1L/GJhswGaPHlCPrxv45HxpwR4VGAzD2Hf0KJ2HImR9ULbCNBjrHz1qDMyC5jQIenidvA7hpsF+12qutZd0XogJhC7n+AQ6mb/vTSnff7/ANBNDXQqCTAYcpz5go+Y6PjlCokNwG+ZAhk7Wumpqqj+UPyyvqqp6+bL1BzUdYrq6LBgpW+0p5QvgG8KbgwW0sZaTzLYvaHmOz3wHZ/MhHDg7tB0j00zMAcIEGQLjNfs3xZQfheh0aaFQWLpymNbWhyXZJ1IT1yYm+pr6RkUFuyyw0ERzJDAWCxCwWCO0VmY2CDt6fh9sq/40Uz+JfvD7uQ7W5sZD21/KwJ4hW3O9SQZkBgCFrdXvbUgB7R38hks//zhvmMs9cPu+XpjsiPIsrK9ez92uBn3faO1xUEaPHjNmtK4ma8wolrrLzw3C0sE2ac1YyKEzYMBCJ0MGbsbKyK4xtEsEzwEnTJowcBj8TYNQULEyKspUc0U5DPTQdVJ6ReXBKunwf7nFmNFyZZQua8yYMbojXDJ/GwSAMdo/QLZ5+Vkzs4eMoX2DmvqTUfujLUGTR/eLSOOVmbfXRV1JS7n6spdLTPTQWWUrF51bu11tDLgArR96iDHa2kBgtJqm+cB+0M5ZsvUr4F3m/P/NGAIwTZfWDwR07WTemWK1aMWKdeuST1972Uf093JF5c4jVjTiM0vLTbUl6pGNQoEAZQxr3aaV8+QbGRIAnQFDF77bnO+vjam9w0ZsSv94eLAkPcHsdZnlrX3Q23HzT2c19qErQvQ19j10VnNG50Wis+r2qI2RqCc+gJZj1Nb1ibjlt/cEy7iTIR4BYB8IdWKo3owBmDYObRpCDCbKELCLLRAh1aC76VravhpRb19f+tpEJ21f0N/Xi2KgClyAJkD0I9MxRYBgpNB4W7JpyHB+qD+1d4jjx9jtuBk7PkBz/AQZ0yXOOyc+pZDo7+2tvJaWCuO/DK+0pOjUKoQCDIaCP6nKZgFdVV14oqOZgweK8E0RfZkEo4X0VnCIgHfb6vPfjLkjRdkS9QiFNo7ROfFJKTVEv6gx6/C+xCOpi9POnc7uxe2PCYgagzVI1KPcN9p0k6mqhhqL0o8IVH2D/pIdaX9qDMBhLAKYA/DlOKR9IpTx48dPHD9BzwjS9OzElKRCHOx9hfvyWvuuJaWC/muNxP8pAvdY2mOIjR6jsU5U/sOKNaeKWyF08GShphDNC6eZekvbPyDAh7nDxpk7RGaEPol/UI/KBDYLwmBxStJR5OdVGVkoATRdP3369LVKSn8vjoHe+z+p6ugRAtqqMFIScUWV544W9eFPtaYlfgV0nX1CJXuH0RESyr7FxmBmrEf0SwjojzP6anYUxICIW5hVhVu0j1tWXJiH1yRFlFeUY6qmM2bMKB011k9U39BbfPRqjQi9udBZ/KWJg9zRAUxGAIMAvmBNmDRRqh8VNks9OK+osbWwqI84NPhCb8bLPsKil4qCknOi8p9WWJhaBG/NII6PfIabdwK+1ZpsYzvb2jtU5sgA+MdgBDB5lJiR/iSUAyj1+uP1IRno3hZxq0pa6ZQGuTCrUIQ9v6+qkfKBxtNVMEOoKq9qFd0vJh6As0Px6Txuka+KaSCHI9P+QCDUi8Eb7jEIwHjc5IkTKf3YgIB2pqgKxsCNhAC4dGFGH6WvsJWKgd6r+X24z+/r416rkeZHUc25/MatNv6hkn0B1DYADpPnTTB5nKDmRNoDiH59/fEjVzRWJcXHH35JCIiqDjdS+hvz+uhMmH2O8vteUUmWJDtCGDRW9j704tD7vCX6mRsFiZkFAGlwAuUD41EEIAKszN6j8UnxqS9xzHOPlFMjAFFRIbXWKyo+3SjNiIVkiITkX7vWKsrx4kj3f3BwCXVgaB6EjUkAX7Am0TFA6dcfzzZ9WJYUn7QwFTtAXh4d46K8qj7a12uOostuYb/oaz3aiGNEJCpMit/X+zLKjxMkSwBt/Gb0vBlGD5WF0SAmQEcAMr0FOQfinSxcUctWHeHSqrlZdCxAX3+aanbkGYV5aJMJdBbR8fHXyqPmh5IjUoLoraCQApl0AGYB2OliF5AnMFLXyZqlq4faPq9IRI0ARFVZfXQ27Ou7do1eg9euwjxB1Js8fmb0ku2+8zlBtOeTEhTkz+wR88weLG1kAy4wAWfBifoS09PTs7gFOaCxvFeS7Ypwb0i1ev65Vol+UUkh/JeuP3nSdAczT4nyEHyYJu4Dmb0DPbMA7CxmTpBmQamxLdDVBdHcjvaAwhIZAFXn6iXe0Ndb3CQqt5k0adJ0D5+AkBCaAIciwPQpEwyfL2DsakmPA/RlTS8YTYBfXi3iUv18XiMZD2JrulZG4gENBhCnvl3gAWZIPyLAIfqxE4S6MnvjacbPGDGdP1Wf6JcjMF5vwb0+0csTSakPUY7ra8rjysyH+opKcL8veplXiLYeiDAAb05QCCeEbnvK/Fh/X4d3MqYBGNt4mA1CYDzb8PjN8tbTyXduZMBMt6+miLS3iPhBYxNyhvJTJ08mF8Pr5WvZkyfNxfu9kEHbh+L/OZwANqNdgFgB5wwZzveeqj/QA9izHj+4cfnkg+pnd26C99fX9LbWlD8sL29sxaNhGCVV/XbjzrNnl69yy39y0jeYPBMSH1EPj1AOAeBvxuQth7ExDmCatYf3TFDczwP0Fj199uwxOkK++g70+tyqvMsnzbW0TKKyishEUXTqRvWzJ88eXL78PcsA9PsT7SgKQnD7g/lMZToAFHLanIOHt/14fcloWB//r7fo2VPq/IA7t7giUcnRy8fReTLmh6lxsCjjRvUTIPC0+vtxBpPtAzghtHGoR4in5Rhmu0BkCjhxcsZcb29HA8lsAOeDieO+oU4PQAQu//b7vVN3vh2mMnbs2NgitNH85cOMGwRQdfVKPbP5KOnLWyjHbSqb8QBQzKmzpvO9vd2mUvrJcqLOntfPaQDVTx8/ePD4yddsPQsLw+9v3bt18/LlOw8oQNVPXMz8QgfIX+pnbzZdAddPUAQASAPu7u7ec6dT+lGZoL1J2PxH9VOJFzx7/gvLbKqZme5xBONpNXX+xNPnr3+zDqCyv1R+qI+jGXyW6R4AmSIAiG1t3JHZG4wnEQDGnlXR3l73QpIInkGomyFRx5FyUiD+XzUL99iEBnFkxYeiQ5PNzKaOZvR8QdoUAkBs5IAJuM81m0QzYP0sbOlorwMveIrPlatexKYA4PNG0BlEz1818/mdK+eHkswfGroUSoCfmz364FQ28wkQmWIAiGfM9CAI3OynGkzCLjCntKelvYvX/PqP2ufPa189Mp8+lQJA9Ne+auHzecJSCz90jpa/j4+fn7e7oz36ENavgASITEEApATQNXDm2ltaWuqtbOhBV1Tp6mppa2sR/shC0qaiEEAB8eJ1uwDdb0dwabQlsqmUcPQZVAYee8WQKQqAeIYrVo+vAUJs3LcNnE4SfgAABBJJREFU/Bbq8ji80jkTQeNUAPCi9sWr183doB5dP4O/Tn/qIKY/4OBLpkxhAMQzpvcj4KizslSI1Ld0CutW6hFlOj8LeTw+n0+urMPjNywwsxxE/ww7RVVTcQDERjYkAqQE9Gb9XIeOlmq7uUCPyLQcs0eAriqML7LYw+sRlpoOlG854LgjBk2BAMS21vM9ZAk4upnpLVi35+etweOmW1IA9DYJeTJXWRdWmJoNADDw4HMGTZEAxFNYM71lPcDRzdFysj57ohnJc5aocVf2SO49BR7Ab3DpB8DSbJxi+j/KFAoAEoGNbBIgZm9vb0nZVMtJC1rI3cfINTX4LcEGyDcsp86civ+3nM5SyPhHYgoGIDa2mCuNAlq/BIClpZl5Bbozc1dPF766DL8jeDr2DUtqyTZSxPhXxhQNAHKhkyNFwHE+AjDXXhbBVNZtYSe+1wy+vo4Q9QJgM2fid6ebKtT9kSkegNiY5TDfXYaAvRwB3UtCif6eHmGFy1Spd+gZMX7ZoAH2AQBAd2BqRlKBVL+EgN5WAXhAN7qqEBTh77oS+WxDhTe/+AMBQAhsHAcnwF7Bx3ff7MYEBJnjqNBgv9UlUIZuHwgABII5eyYhYC8hgBhMd2mALNhNrrDWI9jExrFvPeC8G0XZBwMAowIjC5uZMBSwt5f1gamsUpQEKA9ogRw4nW1qouDUL2MfEACY8QwLGzN7+UyomwkAenpIBJQask37X55GsfZhASCzmmXNnm42U+IGY34WIP0kAn4e9EpiirQPDwCZ8QxzUwtrto3N9OnTx20iHoDmwh0r//67DJtyABD7v7YmY42sjBahE+V60L13Bz9LRLGmTACUfd3Ax9cX5HUKfmR41+9b2D8AwOwK5AGgn98y2OmiCrZ/AADj20IyIxbc/tAZUPyPAIBPK8PXWV+nhF//BwAQr+Oh6693Cm9+mMGvvP0TAMz+sa65raH0x6HfSf097J8AQPzFvJUrF83+cMNfWftHAFCmfQKg7Aoo2z4BUHYFlG2fACi7Asq2TwCUXQFl2ycAyq6Asu0TAGVXQNn2cQG4KP6VXv11/3/w/x8FgF9fXxSL9/8pFr8+Xnt3/3Gx+O7du3/WvriL3vsoALx49AIDePTo7ovau+AEjwAKcYCPBID4T+IB0Pb70fLPXy9evEje+xgAPD+OlgjAXcoDnv/nhfhRLX7zYwCAmp/8B86PPf9X5BQfTRK8e1e8//ifxwmAu8gbwP1fXPwT58CPAQDu+fajHvDu80e1teD66JVH4kf4jY8AwH+3TwCUXQHFW+3zixf3H//1LuR+8d1fL4r/99f/7N//n+PijyYJ/vrn/ov7Lz4CAJAFLv7n+EV4HP/1+P7/4CHBRwDgrw0R+KgBIPvoAfx/V9GegIOjVbEAAAAASUVORK5CYII=",
    "deepseek-baby-pat.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAEBAgoBAx8CAQICAgUDAAADAgEDAwQDBxUDCioEBg0EBxMFBAQFBAcGAQIGAQQGBgoGCx4GDRYGDzIHEDgIEUkIEiIIFTwIF04IF14INX8INoEIPIwJBgcJE1UJGCwJG0cJIlcJMnsJN4AJN4EKGG4KImUKJmoKLmIKOoMLAgULImEMRpgNHj0OAwcOJkoOTqMOXL0POXsPZ9cQBQkQCQwQGCIQUqMQUqMQUqQQUqYQVq0QYsYRVqkRVqsRcOESWa4SXLESXbMSXbQTBAkTWasTX7QTZb0UBgsUZbsUbscUdtIVCg4VQW0VbcQVd9EWBQsWZLkWftsXM1QXR5EXSIgYERMYICkYVJ4ZdMwaBg4aaLkbc8kbiuMcetIdjuYeFhgeJzEfCBAgW6MgbKYgdscgfdYgkOUiNUEjQ14jgtwkQlEmmOgnDRUnhd4pGR0pe7opg9kpkeIqXpEqhdcri90sh84snuouTnAuWIExICQyhtwyk9w0GyE0iN01ouc2meI3LjQ6qew7TVc8ZYU8epk8ibw9aJ4+Dh4/PUU/nuJBc7NCn99Cr+1DKDJFksZHZHRHpOVJKDFKiKNKpuRKrelKtO9LndFMpuFNmeJQc5dQk69QqeRQt+9TdIJUICtUrttWSElWVFtXnrtZNT9Zt+hasedbp8tbvO9fwfBkQ0xlwO5oyPJpwe9pxPBsW19sqOZss+5uyPNvg7pyPEd00PN2bHF3Q1J30PV4se95T1t61PN91/d+lNKFTVyFaGuFweqHl8aLSlWLfo6OnuCVW2yXdXaXp+uYrduamqicOU2hVmWigoKlkZCrteisqbGxZXe3io+4n5y6uMm7xuG+b4PHn6DIf5DMsrHM0efWd4rak57ev77jfZHj1tzqf5Hspq3s7PPuhZjv3uDwy8fyjKDynKnzo67zpa7zpq/0qbL0t7v1xcT10Mv20Mv20cv20s320s729fj30Mz30cr308z31M76+vr82tL94Nz9/f3+19P+19MA/wCFq7vjAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztfQlYU1f6/n2CkEQggSRAWMOSOuyEqBEeglitFKkiAipUVFyqERFRXKgLKnTAVscuuNdl6oZiQXSwWqeiTl2nVVuqoqiggizKLrvw8P/OufeGoM7/V8lCn868x5ANyX3f7/2+s9ybe4nu/3IQ/b0B/Y3/CdDfG9Df+J8A/b0B/Y3/CdDfG9Df+J8A/b0B/Y1+EiAwWCJx55iIZLLAwP7ZAhr9IUCYxITF4gmEAAGPwxLJZvfDRtDQvQDR7ky20HvIJCmCp52Nq4MRV9Z/NtC5ABImz8tN7u8vl8ulcrm/1NNN7CRki8J0vR00dCxAtITpMNnfP0Au90Psh3gLeRw2j8Nh91sW6FaAMHemt6+/H2Ivl48Y4sBmuQfLZi+cLZsdrdPtUIFuBZAwveVyXz+sgK83mxkcrNOPfxN0KkAg08FXLvVDCgRIHZiSfgu7CnQqgKnR5ACpL/D3k0vNmP08AKCgSwECmV4Bvn6+SAG51x+Ev04FkDGGBGD+vgFDmBIdfvD/D7oUQGI0WU46QCo0+YMYQKcCiIwnIfpSX/kQ0/4v/xR0LIDcFykgtXTX4cf+/6HTGmDgJsf8PQV/lATQrQBhLFe5FPhL3bj9NvR/DTp1AEsI7H2lcrG7jH4tMEzi7u4uCZzdX72CTgdCEv0hcpBA7uoODpAEyyQmHBaLCY3F0mezOBJRcLDOc0OnAkSz+J5IADFXJOOymCZcY76DpSPAy9JByDfiMplME3dZoE7zQ3cChIWFBbNNHJEFhnB5Jjyht6sdyAGzYn+0OoAWR4Y4eQmNmCam7jLdzRJ0I0CYRGIC4UVuhzooneTg5e0mHTFCDrMCqAm+5PxIPmKE/wjfSUO8hWAFkUxHPtCBAMHubIJgCWctWLFivKsXHyng6gYh9yUhpW70LAHemezq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",
    "deepseek-baby-sad.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAEBAQEBARsCAAEDAAkEBCkFAAAFAQIFBh0HARYHBCEHElsICTUIH4UJAQMJBhYJI4oKJI0LAQwLDCkLDj8NF2MNGWgNGm8NH3kNLpUOAgYOJn4ONJwPBwsPOZwROqESEkgSG2MSHWgSHm0TAh4TFlETHWUUMYQURbEVAg4WSrcXCCcXDzMXTrsYCBoYWMQZCBEZHFYZKV4ZPZcbX8kcHUAcZc8eadMgbNohDiUhSqwiEhkiac4jTqglc98mbtIoGEEoGzMoJVkoNWcoX8EpQIopeeMrULMtVrgvet8vfuQwKkYwX7ExGyQzguY0bME1QnQ1UZo3MF84fdI4h+Y5ZJk6i+k8JEI9kOw/NEw/UoJBKDFBi+NDlexFkOdFmu5GPm1HdKxHmO1Ik+dInO5KP1tKne5KnupLLz1Lk+ZLoO9Of7ROou1PkuRPpfBPqPBTTH5UkMdVW55YW4ZYq+ZaJkBanOlbPEdbTWFcs+xeZrZgdMZjPFRjZI9lotJmaKNoYn1ove9qd7Fqy/Rtb5pxMFR1SVt1dMd2YGp2eaN4hK95d855fcN5ht55z/N+dch+q+l/icmAdI6AxO2Bhd6CPVuC1fSEUmKEUmWEjLiEmtKFmOSGTXmHe8OJcnmJzvCKjuKK2fSMiZ+M2vWO2/WQ3PaRmreSXnaT1vKVSl+V4PeWl+KZpeKeaH+eqcmfe6CglLqhsOukpealgpWmeoens8+qWHitj5evkqOxvPCy2+6zpdC3coq3u+65mJ+6wuy7aoy7v+675fO8vsy8wPHAZYDCo7fCwOPGpqzHydnIcYzK6/XNhJrQ0e/Q1OfStbfSvsrX8vfYoa7ZsLnb3ezb9PjewMLgdJPj1Nvk+fvpeZfpmKvr4untfpvtqbfu7fPvucHwhJ/wyMvxkKnzqrj0o7T0qLb1rbr1s77119T2ztD22tf29vj3wMf31NP32dX32db3+fn42Nb42db429j4+vr52tf529f53dj83Nr9/v3/4t7/4t4A/wCDUQ5OAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnQlUU9e6x996iyVrqYGlXBKGKy0BiiIyVERAq4AgKuBFEKRqmcSpjoDQXqJPFLF1arlalJbWqyAJKlgqWlSs4i0OBRGsilgVGgFREzBggECSlfftvU9CgootnJC7Vv2OCQEZzv+3v2nvM+R/FH9x+x9d74Cu7S0AXe+Aru0tAF3vgK7tLQBd74Cu7S0AXe+Aru0tAF3vgK7tLQBd74Cu7S0AXe+Aru0tAF3vgK7tLQBd74Cu7S0AXe+Aru0tAF3vgK7tLQAd/d35C9akpCSs2eCro7+vMt0AWJySnoktPS1Bxwh0AcA3BZRjAwDpqUt0sAu9pgMAi9Mo+empaxb7KoIXLBj6fei1oQcQohz+jCXeQ/7HX7YhB+CbTvRncoKH+k+/0oYagHGKUr/PEP/l19hQAwhW+r/O6x9lQw1gDeUAuk39ajbUAKgISJ08xH/3tTbEAKYQAJlrhvbP9mM68oD/jgqAbKgBLMn874qAIQcwPw0BSKE+c5g4caKLy8SJOuQxVAAm+wYvXhziF+ySAC6QmQDaXfzmeoWGhS9EFhY6L8TPxWGI9kXDhgCAw/zErOJj53ncXJj7JIWkwgQowSUkNDI6OnrZsmXRxODFwtB5OoCgbQAOMbsvV96qzOfl5uRk5uTk8FLmAYCUeatXrwBD0mOjY4kBBYAw3WdoGWgXwPxdFbfuV+bnEOPClpmTkJCWljpvxerVy9T0Ryq36OiFXn5sre6UpmkRgENwXuX9W2U5mZlo7HmZaRwOJzU9MzNlXWramgjwAOL/1PgT/ciio8NCJmpvt/qY1gA4LC7Gg59J9KcnhXkhC12blg4cOKtWY/1o/CN7tYMthC0yOmzuUM2VtATAIb74Lhr9HBT5mTnp64P8Q0ND/RGCCIgATtxa5AHwLzpaY/QRAWSR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",
    "deepseek-baby-sleep.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAEBAQECAAECACQDAQEDAQgDAzADCTgEAQMEBjMEE2cFFHQGC1MGGm4GG2sGJX0GJ34GJ4IGMLcGPNAGRtoHAgUHFYEHGpwHHW8HKH8HKcsHK4YHL8UHMM8HPNgHQtYHUt8ICj8IGo4IHHIII68IJ8QIKoEINrEIQL8IRLcITL4JAQ8JEVoJH3UKARkKBAkKBzYKI34KJo0KMZMLbuQMKqAMZd4NAxQNVMYNdOcOBCMOCA0ODUYOFl0QXtcRBRcSGWYTCCgTDRATjewUPKMUWMEUZc0VDTsVEUsVfOkWCRwWbdAWgNwXCzAXGVQXddcXm/UYIm8YUbcYhe0ZX8YZlPAaMokbDicbSawcEkIdDjUdFBceG0sgP5chJWEjLXokFFIkGCElGkApN4YsFEksIiUune8wpPQxIl0yLWg0LVE0NXM2id43QI48Pno8pvE9MDQ9keQ9qPQ/W6dASZBArvVBa7NBftNCPWVCmexCq/VFn/JHdr5IQFJIUZRJr/RKOj9KtfRLm9tMG09PTHpQpPNRN2lTV51UuvRVPUlVpeZVtfNaWIdaZKlarPFbv/RcTFJcgMZcuvRfjsxfs/NixPRiyvVjZ5RkSX5kbrRm0fVnVmVnuvJnwfRnzvVoJ1to0vVqyPVq2fdsc6FsndRtf7RwU15xmt9xyPVzwPJ0U2B0iM11z/Z3T4Z3Ymx5fr55yvV6Z5h+xvN/ibmCb3uCpeyFX3CGgauGl9CIqOmIr/GNeqmNzPSOl7yPXZCQPWqSpdmSvPGTaXmUeYmYruCekrmfhJOf0/Slc6GltuumqMesw/Ou2vWvt9Wyc5Kz6Pe1jJu2pbG5xOG88fS9gaDCzu/Ds77H4/bJlavJ0vbPv8nSe5zT6fbV09zV2u7XpLXXyc/ZgZ7e7fXfhqLh4+/mmLDpscDr7/fsy83vvcTx6Ozz9Pn0yMn14dr2xcf2zs321NH329b349z35d335d739fP44Nn45dz45d34+fr86uH+/v3+/v0A/wBJsi7aAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXlMU2n793//mEAoiwIGcJdFUVMSFDH4hBoMCBiQHR+YiJpHA8NQJWVTkNjAoPJSoQEpik9hRMYIL/qoKC4MODiDIpsjPLLoCDKAVKzIJpS26Xvd9zmnLS4zvnSb+TnfYw9lEc73c1/XdS/n9PR/ZF+4/kfXB6Br/Q1A1wega/0NQNcHoGv9DUDXB6Br/Q1A1wega/0NQNcHoGv9DUDXB6Br/Q1A1wega/0NQNcHoGv9DUDXB6Br/Q1A1wega+kYwA4vR90egA4BeO3eF+/D/P7770+lJvjp7Ch0BsAvwocVV97S9fz5866uroZT+3R0HDoC4BXBjI3lt2D38K+loaXh1G6dHIluANCTEhOj+M+R+lvqSjOiZbszkg7F6OJQdALA7VBiXCy7C9u/EC3/cvwuHRyLLgD4HUqMjY2t6Qf/dXuUv7HnU/9Dk9I+gB0h0P5xKAD6r7tq/a9/IO0D2BObAhsftf+fwL8OAAQlxqakxJY/72/XUd2fLa0D2OGTGBeHIqA/W9t/+qPSOgBHH4iAuDj28z9HAOggBVANTElJbKnQ+l/+qLQPwCMxLgW2yiSt/+WPSvsA3FhAICWFHa/1v/xRaR+AV1AiREBKYpjW//JHpYORoK0vCoHELzYCZLINLIiBRH/iEy+/wJ0RYaCI1YEMa+0fjHYBhHt7e++V7XVGZSAZukHXwAhPZiQqCYAkKpnpE7bTTcvDQ60BcHTbGRHk4+/v7xMS4eDsC57D9q4PSQbnKXHklpKYmBjH8glbr00G2gHgvSfMhxWViAQuUyJ9XXwiE5kerLTESF9WLIwM4yihWIj0iXDTymEhaQGA4+74Q1HQznEwCY4jtrhYpj8rJRJI+EMGzBZ8NzGOGeSg+QPD0jgA15gLOey4qNgo5J4QYpASGwl7Fisl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",
    "deepseek-legend-eat.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAAAAAEBAAEBAAECAQECAiMEAQIGBBgHAgQHBSsIG3oIH5wJAw0JI6MJI6YJKKsKE2MKLrALCCILDUELJKELM7ULTrwMBQgMJIgMOrkNDDQNRrgOE1EOP78PCRUPFmkPLJUPb9YQSLAQULkQcdYRS8YSCQwSN5wSQKYSWcETFlcTGmwTHHIUDigUVtsVGWEVHnQVYMgWXeAXESEXFjYXac8YHWUYLIAYWcwaEhcbaugcZOQdb+0eHj4eI1ghGigiKGgjMnMjdOYlLEImPYgmfOAoGRgoIjEod+4tfvMvMVwvVI8vhekybtAyke0zOE40IBg0QXc0f8s0itI1ivM1mdw2J0E4mvE5Q185oug6ZKc7qew/JiE/VG8/tfFGMUJHcLdHp9ZIMixJTI5KYopKteJKxu9LvOhOPFRPMRZRl8JSbqBSgq9Uy+9Xxe1YXKpZQjdZzfBbOTZbjt1c0fFfSmVgPhlgb4lidMhjc9VlT0plaLVoXYxqR0dqs+BrPRRrdNRrfNFuSVduzO9vc8JyTSRyetZza5d0wOp1Qix2W0p2dKt6hdx7SRl7WWt7jbl+U2N+nsh/1+2BV02BeYyBhdiBj+GCODeCaFOCl6mEVRqEhLyIThOIh5aJluKLTQ6LYneLi92MDCSMyOePWWOSkuKTRByTlM+TqNeUYSKUdl+aT1Waj6KauOSc1OWepbufczSfhWmhpNqjboam4e2pah+pk3qqfzusbHKstcyusOGvJjyxAimyeSazoJy3jEG7veS8cSq8fJC/nl+/wNDBhzDB5uzDsKzIfnrIyeLJgirKr3PMvdHPjZvPnTTQ0ObQ2eXS7PHTmjbTvbvVlTHXpp7XwKDaiIba2erbqUvcy8jgqD7ilqfkqTLkv2rm6/Hn5u/oiTDos7Trt63stqns1ZLvtTjv8fbwwrrw0Mfw8PDxzrbyw7j0wTX01cn10sP19vf19vn29vf29/n40UH4+fn58Mz628v68ar6+/r7/Pn8/Oz//sH//sEA/wD4XmlJAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnX1cU1e29+fz/MHDhVxewtsNEAqCeXg3oIKKyCADrSKlIlKLIpUiBFHATJEq+IIjghWsSoVaUCptvQh1BBFEmEGoghodDSJoFDGpCBGKEIgpkjufPGvvcxKC49w+Aid55s6s8HJyCMn+ffdaa6+9z8nJbxT/5PYbbTdA2/YvANpugLbtXwC03QBt278AaLsB2rZ/AdB2A7Rt/wKg7QZo2/4FQBsvWnH11q37vb2992/duqiN11c3DQNoutX76q+v2atXt5o02wp10yCAcnXxr5Apt1+CPazSXEvUTWMAmnqx5le996+eVxxU7T6uuHj1yYuXL1+8eNF3R1NtUTcNAbjzEom/f/7vPqDuTt+LPm0g0AiAO8jHbx2ftK/p4OuPKm/v0wICDQBoAvV95a/tLH/18g0PbQUERdS3SN2oB9D14kX3G3Y/eXPm7+h7QW1zXjfKAYD+N+b3h1cntj9X21+uYQJUA+h+8eao3v/kiSojtt5U/0v5yzc5DGVGMYC6Fx3qd08cUm496evuVabB8slhf+dN2YEyoxhA9+Te/LGW3ABHf9n1hNhO64ia/E8v66ht1CSjFkDRy8mpbtM35MaT7oc3+rqepMFmRVfrHrTrxzTyb3UvNVkZUwug6VXF5B3ljUhs2pO+F7UXHvb19d66+rDvTisKjHdVAHpfabIqphbAw1evzfa+KW+srXr4sq+vS6HY9aIPiuAXdzpaUWAc2kM+5NYbKwTKjGoP6CW3ahvRz5XlQOBma193F7p75wmaATy40di6ZxPxd7Crr15dfeNzUWTUAihXqYnC+X9T+YlvGm/e7HjZhQaH7l6YBN25AADuNJaT6fH+KxUzzRjFo0CvisCmIih3Pi//5qva1ps3u1/2NSnqXgGAl92f30Tya/ejB52HGbJm9VNe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",
    "deepseek-legend-excited.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAAAAAABAAEBAAECAAECBSoEAQIFCDIGDUEHAAAHGGUIDTYIFFYJAgQJHGwKCBoKGmAKIXsKJIALAggNBBANHWIOCAoOE0IPR6UQAAMQDCkQRawQSa8RKZESBRASBhYST7QTLYcTVroUNpQUVLQVAwoVMZ4VPIsWDR4WGEgWV7YYChIYN6UYPZsZMnMZT64aFC8bJGYcPKsdDxYdX74gGjUgIlMgYcciWsEiZ8QjExkkI0QkPrEkQ6MnLV0nTJonbckoaL4pX7Ipc80qGB8rb8MsNmUtL0wtQrUtecwuQHcudccvIS0wWaAxK3MzOIgzeNY0guA1OFU1Tr82HR42R7o2TYc2fc43Z684JjI5fN45juE6QWY6h9Y+JCQ/MjxAQVdASsNBebFCTnhDj9tDl+RGnudIMSlIUMtIW4lIh8RJKzRLZ5ZMpu1OoOdPmNVRP0FSTl9Sn+pUdLBVJzNWO0tWpuJYPSZZldBbse1cWm1fgKRfgb9fo91gr+piNT1icZJit/FlothmSFBmSzJnsepnte5pVlJpj7JqZHZrvPFuQ1ZxSCdyvPBzsOVzvPB2n8V2xvJ3YVt3jcx3u+15eYt6OTt6wvF7TF97rdJ+UCeATlaAueaA0fSBnN2CboiCluiE0fOFbmOFh6OFw+6GVmmHXC6H1/iNV2KNzfKTazmUl+CbXXWbZW+cf5ichIGcmqicn+acveqc1u+ddkOer+mgy++muMmoyt6pprSqZoCqmHerkZur4fStgUaudYK5kIa50eS6oKq7cIy76va8po693PPAk6PBkkfCr7XGb4HIn6DIsq3JsIzLvMHQ5vLRoE7Sgp3UvbjUy+TU2eHXfI/Xs7nZtWzarVnepqverVHfhaXhhJfhwsPiyM7jsEvmtrfm7/PpwsDrzs7r4OHsvFnvnbfvzqLv0Mzz38vz6ez0yVf1yWb12tb13tj139f19fj20Xv23tn239n33tn4+fn6/Pv73oX75N778LP85N395tr+5Nz+5NwA/wC+plOrAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztvQtY01e293+e5zx/Rx7kTUPewyGPCdOEZEKhxAiDXKpAIAc1UhRoNYyYViFQZSR4aSOopEJLVFoUFCdq8dUqVdGqWPAudKpooTqS4p0KiIDDq4am3MoIz++/9v4lIVy0PSS/0HnnfKMhCbns9dlrr7X2/u1f+DfiX1z/Nt4NGG/9D4DxbsB4638AjHcDxlv/A2A8PnTjeHzoCzQeAPb/42Ni4/79R44cPPjxOHz8UNkbwIptF/969x937/4D6+eff/6pTVe5286NsJRdAey//qS3t/dv96p1R7Z9Bp3/8eH9Ryp1bT/9/NPdcnu2w1L2A1B+t7e3p+UijP+P2yqH/urTyrafn1bbrSVDZCcAH1c/fXr3r9uM95raLH+Frz+tftp25KVv8dHFr6lomV0AfKp72la5xnx39727OvOd6rvGGwebhjvGEF2su3PtWwraZgcAa+49rR/SufV3+3+69+FnZNdXmxNBeVvTp8Ne+pHJZz5quFPXcoeK1lEPoPJp20HL+2t0Tc/+0d/W9JSMe4ND/2BT0/B0cLH/z/jnR/q6Rw3XPyQ+sn3zqAbwju5pJf5pgqB7qrv39Kf+Z/XkKKiuND+1sr6SGKZr7fjH4fZrD+tqvm54+M8H4D2dsVffqzYmurerm9radp941oa6/v3KerN3VI4SAlrq0PXFR9dqWi7W9Z2gooXUAnhbZ/bqt01h4P22pzo0MJAHlLdVG39/pKnp4IiXX+yu23/iekdHwx19e0PHthG/t4WoBWDZq58eMeaBejT632lrqiT+elenww8eGTUDfNSt1/d3tTQ0tLTr9XoK3B+JUgDv6KoHu/Xtgweh+AcP0D1FztD09F71T/XV1e8TayqbmkYtAWq69PqGuhY9cKDMfhsBePjJqA+X63SVg/eOHNx9sLL6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",
    "deepseek-legend-hungry.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAABAAECAAECAx8FAQEGBi0HBQYICB4ICjgIM5QJBBAJK4oKDUEKOZgLFFYLJ5YLKIELLp0MM6YMbcINCw8NGWUNeMwNe8wOAQUOO7QOiNYPFUYPg9IPjNQQDikQIXIQQaYQaMIQkNcRIIERIXsRMocRktcSc8gTSLsTV60UCA8UT8EUVtIVFC4VHlAVXd4VZ7kVgNQVhNAWEiAWY+QXJmYXLHcXTooYIDkYWMUYW5YYYcsZLlgZO5IZRZ4ZZuAZaucZcOkZkNUaEhUbZbobatQbbKYbidMcICkcfbscjeEdm9weMUYePmgfO30fctwfheEhFjQhc8UieeMjoeQjqOQkVKUkregmQ1coHj0ok+kpJlYptOssGyYtvPAvHRoyKkEzUG40Vp01R4k1xe02OWg3YIQ5qec7PFQ8Jyw8k9U9gqA9grw/ze9Au+BBr9VB1PJCKhxDLzVFVJdFkbNGc75HZaFHbpJHb4FIX3FI0/FJnsJKXLRL1/FMoepOk9dOtOxO0/FP1O5Q0u5TODhYSV5Zv+ZaOB1b0PFjVndjd5tmREloQSFobLZrZ3dshKttneJuOZtuse1zSCJ2TFp2Y3p2eX55p9d6UFd9Ty59YkF9hcx+kbSDThuEXmCFc4yHruGJpNqKq+WKrOSLq+eMrOWMt+SNhIaNq+SOcEqPWGaPWT2PruWPr+SQWR+SbnCSsuKTg6eanLqcZSKflZefstughFaiwuqjY1KjuuakZHKkfISlbiyxdiqxez2ycYC0k2u2dl+2oaa2yem4i465gTLAzN3Bj0rCn4jDfo3DsLXGc4DGnFvHhXXJizTOr5zO2+/Rvb7SeonUmD3Vx57WfozYq2XZi5bZ3uXa4vPcyMnd5fXfv6rf5/Tg6PLhxmzi28zjp0bkn6Xl6/bouGXpsrnp7vXqyVbq7/frtbLt8ffu2Hju8ffv8vbwwMHwx3zw8vbxwb3xysjzsaz00dD10M310cz22bj30s368Of73F7/8Yz/8YwA/wA/Y36lAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXtcU1fW958/Xl5eYLiHQV9ACErQpEEQ5WIIEFCij1AINVwqRpQRUaqoWCxVK9KKMmq8jKkWqLGPVkdFG6t4RRAfkYvABDAFxAttAClQL4AitPPJu/Y+54SgTDsDSZhn3lnHXEhisn/fvdbaa+9zcvIfqv/P7T/GuwHjbf8GMN4NGG/7N4DxbsB4278BjHcDxtv+DWC8GzDe9m8A492A8bbxApCnOlNRQ9gV+GP8TP8ArtT8+OMvYD/9iO2nn375K7Kfvq8ZFw76BVAB0n9Ulo2g9ErN94hChV6bg0yPABS//NJe9quvuAIQvtdTayjTGwD5L+0Ff8fLvv/rLzpvyjDTF4Aff/n1zqfszF//2q7jpgw3PQFQ/vLj3/W6M5ASz+i4LcNNTwDKfvlF8duvQjngJ/3q11sIFP0I6b/oV15whhgGruipPWrT3yhQ1v4LHgNxKqzReOLKrcYXuBb4qeZv/Fddml7rgIIaXAL98ou8pv37n8D+StlP31fo2fUpG4dSGGrgIvn37QjAj983olJ4PG185gJS+Ytx+dwRbHwAFCj0nez/po0LgOyi9p++G48PHsHGBYCsoOannw+Pxye/beMCoEhW/GKgZTw++W0bDwDigoIaxcDPjSrVokWL8CPjUQCQpk8A2eStTJZ/v+bFQPvhEGFk5MaNexPyGvXYijdMnwAkMnSdXVQk+9PlRwql/Myt3Vyw/bUvKlbpsRnDTa8hgGfE2VLZ2T/96RYAaFee4nC5rBplo2LNBwn6bIiG6RWADAgkizGAm0rlTXnFH7gcrq9c0ahMF8SteVefTVGbPgGkiiVFny9fUSAr+FNhu7LI98oZcAC3D5XysoqPeB6RBz5UjUN1pE8AYqk0N8J0hWxpwbWaduWmwH1KyAH7GxuVNTE8MP7FF+Mw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",
    "deepseek-legend-normal.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAECAAEDAAEFEzoGAQQGFUYGGEsHAQEHHVIHJWcIBAgIFj8IIVkINIEJKG0KJWAKKnMKMHsKOIcKO44LGUILPpMLRZ0MLW8MRpoNCRANEzANSqMOAggOT6oPMXMPY8UPZ8gQKmUQVrIRM3YRbMwRcdASJ1wSLmoSW7kSX78SdtQSetgSftoTBhETH0kTUKMTgd0Thd8UCxUUESQUR5YVGDgVN3oWLWMWMm8XHS4XiuEXl+gXnuYYEB4YPoIYkeMYmeIZGC8Zk9sZpOkaIEAaarEbo+kcIDccneYdEhMdJk8eOloeic4emOIeoukfM2cfW6ggLEUhL1YhZbIhkdsiQXYiSIwioekiqOsjOW4jU5gjl+MjnOYjq+wleb0msfAnQmYnTncoib8or+0qGCQrGRotWIIwZpQxKT4zNVUzjto1uPA5dqc8JzE9JyNAPl9ClMdDYa1GQklGTHRHNDBIMj5Okt1QSV9UX4lWPDFYO0ZbRkxem+RfUWdfcaViSDViYIBjgqtpPk5rbopuUkhue7RvTFlvk9txiNByjMpzTyxzX1d2jc55bYN6kdl8fpp9ld19lt5+Vmx/i8aBl9aEVGKEXDWGamyJeZKLb0yNn+KQeX+SipyWotaXfmKYYHWYZS6YZU+YlaeaqeOhbDKje2ylfkqotOGrk5asa4Guo6+vcyevhYuweUSxjmy4fDC4mqC4tcK5dZG6ik26w9+9wty/b3TBdo7Bo4XDgzLEoqDFgWzHp63JfYTJnVfN0OHOf5rOii/OwMfPsa7RiKbTsJvVmD7VrGTXu7nX2unYfYrZli/ci67dhIzevajfwH/f4u3gy8fhh4/iqErjjpTkvbPln5/lvrfmpDjo6vPslbruw2ru8fPvt1fvyMTvzcXv8fjv8vXwx77x0a7x1I7x1dDz0cnz08zz9vn01Mz01M702dT09/n10Mb20Hf22dH22dL32dH3+vv42tH536356OP72c372tH9oMj929D+4YL/483/480A/wBCAGdnAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXtUU9f27+8/GTDIICQQHmGYQSDvBwwe9wcJv8gNVBQZqIAoEFB88Rsqv2MPregQ6xDtUXtbrY9WjYqoWKkvbPHZYzgqjakIUi1KLeQo8jgWCIWGR4+c9I7cudbe4eGj/n6S7Jx7T2ckhIfs9f2sOeeaa++1dv6H7V/c/oerG+Bq+x2AqxvgavsdgKsb4Gr7HYCrG+Bq+x2AqxvgavsdgKsb4Gr7HYCrG+Bq+x2AqxvgaqMYwEmbTae7dOPGbWRXr149dIja479olALQXXr086Pvbtz48hDYl6D/3t+e/vLL0+9uuBADdQB0rY9ulL/0J0evfvfrr7ddBIEyAE2tY+qPvuTnJx/9+oiqtow3qgBU/rx97Iunl176Ozd+vU1Ra8YZdR7QNEpg06NH61/+Sy5wAupyQEVraxXx6pKhqenlv/Prr5Q1x26UjgKVTa1NVbaKptbbj26MfvM4+Vl34+mv31HZGsIoL4R0tfqmp780NTV9oT/+Hnx99DvdoaM3vnv666/fnaS6LcgoBVCBnrYb9D8/rTWgMeFP27/48lHTd7dvuLAQoBSAQYeeqwy1rQ03Zk6fmzL97atPm14+IlBmlAIohwzwv/6jolbf0vBoR8qs1Uf/9qilVUdlC140SgGsr2ww6HQNVVUGQ9PTq5dqW0F/66YY9COXYaAQQLnt7fKGhsqWFn2VvqH16dPWlqanj35u1YVP/zdb7fbX/3/nGJUAyt8ub2qtbGhpaWj5+enTpz8/av3ul6cthtXha2sbqGvGc0ZlCOgry2tbWmqrKqpO7ti4cceBo7ef/vKo1qCvbGjYQWEzJhqVAHSV5fqqTRksloRPZzL5dL6q8MClBkOVoaEqQ0VhOyYYlQAqyys3MZhSlRSML8XPTP7qigaDvmorX0JhQ8YbpQB0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",
    "deepseek-legend-pat.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAABAAEBAAECAAECBBQCY7ACZ7QCargDCDAEAAEEcr0FDDwGCSYGCzUGD0IHEUcHEUoHFU8HFksHYLIIAQEIDzkIE0IIF1MJAgoJCRoJF18KAgcKGlgKG2sKM38KOYcLK4oMJWwNAgQNT58OFkQOIWMOI3EOMpEOZr4PCQ0PEC4PJXoPJ24PJ3IPSJkQXKkRVqIRccoSLW8SOp0SPZASWqkTBxgTQosTTZcUQakUR7UVBQ0WHUkXECIXKVgZFzMZU7YZfdYZjd0aSqoaTb4bNXcbY64bdtAcEBYcK0ocR3gdGCcdUsIdWcMdc9YgHzogNVsgUYQgVskhhNkiXsojaqQjbrokPWUkXLcka9Ikl+ElIC4lXYwlZM0oFhgpJlApe8QqKzwrY74rm9YshcQtbMguVpwud7UvHh0vL1owid0xpN0zbJIzeaQ0QXU1Nl82k8I3JCE4hrA4tuk5Oks5SGI5hc85q+M7W3M7idI7jdU8JjM8S4I+mOQ/tOZAKyZBYbBBjdFCVY1Cn+dCwOtDaLlIjNNIkt5KMj9KYppLRk5Ms+hONCdPmehSxu5UvupWQlNWVG5WfbhYb6RYye9bP0NcYn1cweVePSZgVVZh0PJlh8NlnMBnb4ZnzfNpRShqTVdvquRvrMxvye5yTjJyjtF1X014SVh4ZX97gJZ9TiJ/mdeAaVWBVmKBWUeGViaLlrWMcV6NWWyNpNuQX1+RYC2Wo8aXfGmacoibrtudcDugjJqjaW6ofUisjWitsbquiYeyboezdHqzwty0l5q1wd+3i0y3mne6o6a8i2e9iEi9rJfAe4jAwcXBmV7EwM3HmFLKq6vMllPMpm/N0uDQgofQhJLSvrnVo1nXubjbh4rbiZLcjJHcjJTcoZzdiY/dq1/gs3Hik5fit7jiuLPjk57lkZfmsWLoy8jpwZnqwXrs2NfuxG/vrqzvwrzz39v00Mf00cn00q701s/08/P11M325eD33dT33df4+fn5nb77/Pv7/PsA/wAHbfQGAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnQlUU9n2p3t1r0bJgiQMrpBHVpgaAhTzWAzNkDBIqQwCQRkLFAQRFVQGtRQt54ECB9SgpfFfD1AQC1HRMhqleEj5lPKJYokz+lRotVAfCPhY6X3OvRlwRnNjr9VvR0ISkJzfd/beZ59z7r35b7L/z+2/fekGfGn7D4Av3YAvbf8B8KUb8KXtPwC+dAO+tP0HwJduwJe2/wD40g340vYfAF+6AV/a/gPgSzfgS9t/AGj+LUvE4npJQ0Ndhebf+i2mYQCi+kaJpLFRcvHilXv/ArtwXLPv/6ZpFECtpF404oW63/7Pv/71myab8IZpEkB9/dterf7tX48bNNiK10yDAMRv1Y+s7kqnWHPtGGmaAgACaxvf/ePKy+/5IaVGOYDGSuIbfElE7/k9yRciQL0HSPA9lvdekVLKW/JWox5AaxeKb0ktelwpfTcCSQnlTXmbacADWp9KZbKL58mnjRLgkZqdnZ068tdqJZS35K2mAQCN0qedP9/rJHKBbNrC2ZZOfD4/XJgwY3XyNOLFkvr3uAa1pgkA9Z1Pux7fQy4wLXo6P9zH3ccXzMc3JDxFkLZiWz3Uhu9Lj9QapQCWoZEfAEifdnc9viyK8gL1ID8kPDwEvsJ9g33DYyLXbP2OyjZ8yKj1gHmQ+lDt3/30aXe1V7A7iHcP9uFxbELCEYHw4ODwcOGstQWUNuL9RnEIiBtrpeACl55eKnAHtw8J8fV112cydTnu4YQFh8TEJPywldpWvM+ozgG19QiARDrVx9fH0YDrHhLiDmbO0bMnCaBgEK4tpLgZ7zaqAZTU1l66JBGHQtLjMAwdfUBvCGS/EHeONQ6C8Jh4fniM8Ic1URQ35F1G+SggrpU8lbgh/bqOkPix+SIM9tgHYsJjwvgoCtZS3ZB3GOUAltXXSyZD+NszzEN8fUJUzMacIJBQyI9JWPvDGqpb8najvg4Q106Acd+dae47Uj/KBjFAICJyVtr0yB9+WLmF8qa8zTQwHV7mDkUPxxr0vwYgxMY3BgrCtWvXZq354Ycf/msF9W1506gH8LUZ6LfhQhS4+47UHxHiDhkApMeu3QL3P6ycQHlj3jTqATiAfl8LVAW4j9QfHpHgGyxMiE2IFEQuSouMXftfXyIIKAcQiALA3dEXR4BvOKkd/s0QCBIS3PlCIaQBYeRqYUxM7H/Npbo1bxrlAFAF4GvuTsx+fCOwfKFQGBKSMEuQkhLhEUPYDBgLY2Z9gZGAagCBPhFQA9qA/nAEYLowJSVy1qyEFJgLCCOgBnQPJgAI44GAcKXmXYBqAPZ8FAHgAOHhMAuMmD5j1qy1AAD8HheCMSFyF4gAEuGxmncBigGw3fnueAYMve8THhEWHxY2a1ZkijDcV07AnU8SCIFpkfCH1A//TfUaxQDM3fk2AMCXyIHhKTP40yMTkFwPKAHCUR3k664AEBITPms9te1506gF4Ghu6a4AAKNgeAxaAYD6P8YjFDw+BnkB1ALYwCWCY1I0HgOUArCyceCb2/iSS2CoDIBMwOcjAvxNIbjbfWN8yDQIFhwcs3YqlQ16i1EKwJ4X6osA+GIApkQNEBwcDJ4Q8ssKlAFifH1DPIRyAOE+PglxVDboLUYlAD/z7yzdFQDc3YgCKBwhiAmpueMUHgy+AGWyIgbAB3zSKGzQ24xKAKapqXxzcxuUAiAIPOaG+BALQDEhTuHh6/vO8cPR0OduQ8SAMByNB8F8DS8QUgjAz16WHQwAYBaMqkCvw3wPPnb7mBinCGF8y8nNHk5Agm+KY0AoJKrCcE/Nrg1RCMAtUOblTgAIgYngkja+kzzf8TPDnWraH7RkenmFxJiZCoUxcBOa2uDEGGEZ6peaS127Rhp1AOwsZDJLGxKAh4/v5t71wUtAXkwEdPZufviZgaGh67uWLAnxcYRXEAMzjr2NDyqHUoTBlDXrdaMOAA++IAUAAN+QECgG9g+c9Fm/XEjY1kMhVYN9YGe271/uyEf6Y4ROWvomJiaOoaEBlDXqTaMWAKQAc3MEwMPd5+S5/XO9a+JTsAmPHVrd0/fy5cu+nvYHv3gjJuHC+N1+HA7HQrPVMHUA/GSyVDmAcDOz4INNveeC1wOBGSkp05evvn7sOgB4AQhe9K4A/RF8YXjLbhQD8ZQ16W1GGQBWoEyW7U4A8A33CPBqH+rrO7S95uTy5at3Hbve82Lw5YPely96ex687F1PAIjZ3+IEw0WKRufElAEA/bIAGwQALQQ5bfLugYh/2X7yZO/1nkGwvpcPnrfXbZg3c9vxlq0AgM8XRux/sBxNmmdQ1aa3GWUA0GgeivSbu8NcOPiX/e1DLwHBi54+nPwARk/dN98uWzbvq21/bkUOACGw/sFWmB6G8zOpatRbjFIPcDM3t0fDQIhv8Mn2dqS+50Wf3AZb9p7r7e395507f25NEYYHRyAA66EWDPGJ12AQUJoEHRAAGxvf8ODgX573vOj5J+h9KQfwsgcyQG/vn3/2/rlcGBEeDFGwvt0JSsHgENPplLXqDaMOAAzmPAKAezjf6eRz0N9yvKHpAdIOt76XL56DemR34uMhAlKE/NX7bfDKiHuo5tIAhaWwKY8EYB4S4fHLi75zy7S+3VZ3DgZ/GP1eKPX31lh6C4OFKSnxnn7meFkgPCBzOXXtGmmUzgatzU3M7QGAe0zwhgcN8746+s/nL56/eAF5AO6e95IAWpas4AdDgSSMCGbbo9lAuK/vd5maSoSULojwzLnYBeyDYwIa9s5sAs29vcBgCPz/xXOSwP1fbq0PDkbVYQSfbY+nS8EhbrLpS6hsmdKoBWBvR8SARQg//86fvdh6QDkOg+eYx4M/e0/OnZsCERAhjOBZ+xBrYyEy2QzN7JVSC8BahmPA3T4gxKnlOXQ3yAUXQAUw1MEkgZO7W5akQAjEC+MdOAhAuDA8JFQmC9NIFFABYF0L+cDKXmZnzrN2d3fn+fmsIFPe8xfkSIicoOd57z/bn98JFQIAfkp8KButj4XHCEN8/WWy1ZogQAGAdc3PH5APHVEYGHHd3W14fqbr/0D6e5+/lJcCL1EqABwDDWZCYQI4gacZkQXhKxxcQLZcAwTUD6Bn6J+n/nmHeAzFkMzemmVk4+tuRd+0vwXnQHkldP05WRT3TLOMT0mIF6a4uFib+GAAwogQVEouX6325r1uagdwsL13qH1v+0HiGcwI/O1NWIaO7u4WuXegEnz+HPofF8QPegcJAAO7J8ZPT0iITxCOH+/BwRtFvsKYGA/0/9dTfvycugE0DF5vaR86pfqSBY/HZRvyHLnr2kE/aB+8dv3Fy+d9cv1N0XHBKQnC+IT4uPmeHHO0auobAwTwwsgSqgmoG0DT876+pju98OiO/CVzex7P3prL4fmde0lkwKEhcj6E9J+bmuHCBwdIifRMzkszNfGNgRwYLhTG8FEQUE5AzQAarjdBuXP0wc+yvS/Jl4ygHjY1hWmxtXluz+BLUjehf3BwoH3dnAyvlITp8ZEJ45PTc1xwEoAYAMNBIJs7i9IVYjUDgLzWcrSnqW2vrOEF+ZIhAPDwAACO5uYF1wbl6jGBwaGWo3vzsrxQBohMiEvOKc4ys4cYEEIMgIXiP5C7lkoC6gWwrQem/Q17b7Xtk+19vo14jQsAnDygHLQ2tzGfehItBykAvDh+6sbevDjLSAiAyOlZyUXFOZ6OPniXSKgkkD1LrY0caeoF0DTYvK+t/dTV+1fBGcizYq2h88damtrYOEJR7DVndk37cxLB4LWjzTdu7M1Inp4yPTIyYcqcuJziBRlOOA36oJ0SYYoT/hPZFOYB9QI41/eg7cbVW/fv39+3rY+shuzNzc3yxoILmMa723ilp+fNn1Nz7jnyg6aDV2/eOCVKHi8E/ZEpWfPT0hcUF02x8QHtweFop0CYEoE3yuZS5wNqDoGXz+/fuHvr1q37N+6QAPzAAyzT0zyCbcxSUtzN8tLTi3LyZm9oaGmqOHr15s1TlbULx0MCiIwcPyc9L21B8YJ0T5twdBSZkCCQ4oX+CnVjgZqTYMvLnt77N4DAgz4SgAXH3Fw7PcOLb+OUkMA3zUvPy8nJSZ+wbdt3R2+0Ha0Uif0neyIHSJg4vygnK6e4uDgj2J0YB2LQ8XRQIqKCYDxVKyRqBrAXxfadG7fuwDdUDMgCLSAJZqRnePM94hMShOAB8xGAfPG+U1ebK2trxZO0JseD/kjv5KKioowMAFCc5g61QAjaLguBTJAC3ADBdIoWStVdCF2H/DZ450YvzHR60PMAnoW5U3rO9858z4SEhBTvdAwgp6BEdKqtUpxkN4luPBXpnzExI70IXKCouHhBjq17eIxvBPR+OAyHKUAgIT43laJlQnUDqMBF3h20C/IcPXf7zt58CiiOs5wemZAwfU5RXh70dFG0Vknl0cokGh3MMzIhUpAZl7g4p6hofh5ygfRxPjEh4WgPER1bhwDAf53urOamEqb2ydB1tP/x/EHfC5wD/PwCzW0g6udHu4D+SJeC+XPmzJ8ze6Kdsb9IvAzr94MKIDJyclZiUCKUAZAFgM/ieN/wkBSCgK8PxA5yg5Tp3tnqbi0Vs8EhtOfb29M32ATPHGQ8c5ecvOh9S6DSS0jYfDTJ2Nj4W2MtY2N6idgf6ad7R0bGR3p+lTR5YnRcXt6crBzkIYv5vgQAoY+Pj2koP4VgALEwUc2bx+pfD0Cbvn3PCQfgwVTIPGN+QXPNDJToM099RzfWmikyptP96SUi7ABWrpGRlmGbK5PoSUePtly/3lIzP4cgIJQT8LVJzXaKTyAM/s7qTDUeS6d+ACgLoCkPVMJWfuhQyTl7b9S4hoWFRWY2r0OS54knwd2yeeJ5NBp90kSBINLSdUMgjX70z96XQ31DL6/PQdlgMZ9wgZQUH3dfH+j2bEt+fArSDyaILcxKVk9z1Q9gJhoI+gbPwcNUGc/GPHrvjeaxoN/Wm9CPCJTQ/UWiEn86raRyPPIAZxqDHnjnBbFONtS7ddHKlUWJ8TFYf0JKsLuvr6lM5uFuGhWVHerlneniGT8jbNbatYVqOLBW7QBEJXd60KrHUaQ/wMbcdNONq+tdBWG2Toe3gXgaLSqQ5l9SIlpWIp40SSTOHzcOPMCbztArGCRWCYaeDbVnIQIrZxBBAHWAu4+ve6iPj43qG6V6WcaHFRbGfWY4qBvAspJtL3sgA/ZUQhO5NubmE9ru/+IZJhA4bdpHp9sliSprK0WiysYNEyfU14tK5k20dBEIxkVb8Uz2D5ArBUNDgzWCwpUrV+akEQSgGPQABD4+7q+9mZ+Zk5Nn2uf5gVoBgFuXzPtlCGloqpelOpqb2/gdvf9ov0tabNj2vXa0JJFo2bq9jVKpRJo8u+L8+dZqyezo6EiBwHmuo0nNtWtDQ5AD8CqRjgB8YGXR4umkEwg9bHzeBIAQ+Lg7OadlfXqb1QhAVJJkR5857xxoaG9oFVvBNNg0dd+t23BeuMsAABAASURBVLd/8R4vCNsexTCy0vXb3t7Tcvr4+daGi12XGi51S5O3b+a7xsbOrivYfW1wcAjdAF9PXGwYIrBypYB0gpRgG/e3AAAEHgDGMm3Kp7ZabQBKSgIZLIbxsm29PS0N0m5plLW9vbXsu7bbYCuWuEbaBhjpZdf0DAwMPXvSI+3uvixtf/Zb65WtS/KdnFyDgmbv7RmAKfIQYYO7BbGuizGBtfJMEAEz6re+cwCKDn7aJ+6kqQuAOEmXxWIZf1Wyt6lB2nWvjpe9efvmdbJT90H//ebNnjB+jcs8NwDakMwLly429cCTnsFDnidr3IMFQUFZxwaVAAZqXAUCksDKQgIB5EK3d7y5Rwif7zTl0w6zVg+AEpEdi2XEYmh9I6qsv9TVkG3C63j1qn/gzPGbyANutx2e7OVZuCWrZ4gg8OLCNfx9cLBn6+oz6334QUFBsXnXBvBLEAUDNcGxSgJLC8lcmOL1juOITfl8fvC4wk8ZENQCQFRCY7BYdpPmiWobG2s3ZJuYmOQO9Pe/ejX8e/Oj++AEj/ZpTTv5/ND6l0OkbvS9D996ajLjg4Ndg2KDYtPOkPqHBlpsUgQCwYxZK0kEghlkMgx9ewvc+MgEn0BAHQC+ra+vrKysra9vbKyH8d3ExNrEZHN/f/+Tjo7+k6d+ab56uzlp3fWeczU9gwp78YJcHQcnOLfbFIIgdlaszhkyDw6cM/OBoVOQEksCWLlWMANNB1JSIt6OwC0CEQgb/WxJLR4QWCIWi0UwvYuyY0wSg35rTs1wx4kjJ/428Owfh2qam7dJ/v5k8AkkwEHCA172oo0htC6IXu0/ydocFxs0K3ZKVh+RBQbaPd35AECQEEboX7p06dpC9DxFmDDlravkoRHxYKPPA2oBwNBFxlrGYDBookaeibU15+TwiQMdw8MQBc+O7a9svXy+pW9gUK6/58/nZCgMXP8NBobNrKZzOpAG4qb8jiMAADjbugthlgCK1yIChM0qROfcJazNetuM0AkBiB/1cKgWAHYshCDwO9C/TCSBFGDN3v3kwBFIApAJX53ZsC2/7vLlph6F/jsv8FgHX9dOd5++di0qt+VBTWxsbNbWYwSlgXYXV1v3FAFMexIiBAoAgGDWrLWChNiVb0EQyEcAbEe7cqYeANgDkkoYjGViu8Y6iAG/rccOnB1+ha0h29pkc+vF7t9eEPr7HrxE+vt62s81ne6+cu/0fqOTPbda0iAL1hwjcsDguf1xAlv3BEQgMly4Vklg6WKYBMUKlq5888IzRBCM9lBrtQCgsxCAwHpxZWWg7rbuDSYmBVVbjwxgAMOHuPb29ptP559+/NsTDADrf9L+25V7Vy511W3+7WnD/qFnTbeygmKzanowo75r11qcBQJbH2LyGxEiWKqCYO3atUtnLVpZ9AYC7AKjPcpUHQC8Ami6ukxd3WniZSxdptXFrk2bGg5sOTGMU0BHgDXUhG4FcwNOd52Dfh9sf4Dl33v6+OnFajcTx7lXHrc8G2hqBgBzzuBKYOjamX8c220bGRYfTBBI8Y2IVYkDTKFw5cai2SPbEWqLAHhqHICXD4/IgsiYusz8zu5L26t2HThx9gkg2GwCJbG9NVjAxYtQ7vec6oPI7+xsKNh70AFeBW+5d/p6f9PmtKC4dlwG9PW1nBno6KgZB31PEkgI940Y4QVghWs3bswZeYoZ9oD4yRoG4OFklqoEoMvUM8iWVm/ZOmFFVVXViVdn2PZYPZJa0Hm6b7C5ebD9dGeDm0n2JngN/cykobvuXM342Kw2tGEGmeFBy7H+4f7hM85AwJcgECnk+4aHrR1BIBYIbJyv2hRv5AJ8b80C8HJyk2dBwvTYHP1p26Po9CVHqqrO7ubYKwk0XLz+YN2d9tbWAmt77BfYN0xy752umR23u/lWz8CLa0/6O84hABA9BAFyFSzFNsI3ZMYsVQaxSzduLCtScQI323hbW/7o0uDnAgh1Qmc42TFVXMCAbVAiCmTQ6DUdB45k67LJCADLvfTb3xubLra6IeX2itdNjndeaDl149TVFz3XQPnwP3YdeIYS6PDviAA/hQwDjCAiTMlgbWER+MDGOYrG+NmCecb7aRBAgBOeofnrKgkw9dmMkvr6KBrd7h9nd1kxGAakfGt7kwap5LxE6obU2ysJmGzobGhrbj569U47Lh2AQAcxgpyBPGAbL4yUI4BA8OUDA0VhhAiUpSuKAnAA2/iId00aqQDgZIa/+TNVXEBf35iWVFsfSNfafHaXHVSHemT/F1jnSy5JpLnWcgByDwhorb9669TR5pZ+onQY7uggHxyyRT0fT4ZBJEwFUMkfniIg3CB28UrkA0XyKQAGYGumOQBufHJ+ylIBoMvUotPsakV0ragDVVE0IMDigEyHuoqK/M5/Xfy5orrC3n4EAm5t/dWHbfsOkrJBeD/5/Xdb1PGutilyJwAcfH5ERPx0nBHXLi7GUbCRnAZ6gv54Wy/NAQiWww40UgFAMzZm0ObVf6MVVXUgGwFgMAxNrHM3mGRLHj++V5fPqw4F5Ry2vr4BBwPgiGrbHl5dd+jJK7kRJJ69Ag9wBQKRpBPg7aWEeIQgYjryglkrVwGBsrKNS74IgAC+PN8EslQA4NVvu9qZWpOrqpbQdBEAGssgYAMntfHKFeleDm+TgwmbyWKwUHjAzMmEjQA0bz8yoNA/0IED4VlypCtYimskdgJCf0KkazwffD0iJRYIbCxDAEgC8RoG4MGXPwrUHQkAxgDxMq25VVVb7RhyK1m3rlHS2FiZummDPlOXRdwYuhwTjn5J7dWHp6pO9MsB9J+AiUTHif5jkARBfAKKAFtbJYHYGWjzXCicAVVxGUGgCDJhFNIfb/uORRMKAARbyh/5q+hnGNPA72niZcZLtlRV5UKZzMBeYCeqFDdK6isbRSAcq2dhL2CzWaKfH97efwTNnoaR9w+frXr2quNIx7M410jsAq4QAAJX2wSCADyLFUQIbVNshSmz1patKkMASqEkCk0B+fG2ozr1+LMAKIsuFQAM6H/k9JUzJ4P+qi1QJJEuQEsSNTbWipG3sFDNzEIEIEUy7UTND9u2H4EcONxxtmN4eGDX2VcdB070H7JNcI3EtxmRYWh3DWUEAkjsounEQuGsotIyRKC0NFrmggqh+NGdcvY5APz4TvKHX48MALBJ4qStuwBA1Qq6LkYAWmmB4kYx4fswVjCZyA/gdd1JoqN3Tm0BAMPPThw58WT4RFVHx5EDZ88427oCAWSurpiAK8QC9D+iIIglNwyWlpaWlm2EuyIvPh85gIvGAFjxFaf5KwHQ6Djv05aJZmP9Vbum4gjAcTBPJBKXMDABrB9GT8RlZm3l1X1VCMCTI0eOnO3YdeTEkQNHDiW7AoAZxPiHtpfDwgRhKcgDsFcAgYSUBNcZM8oQAbgrzwhGleDoUsBnhgBfHm5fKwMAaQVvL0gvmr0ehcDsnIVa+DX6TNG8WrR4OImBPYDFImIA6W/8eTOS3j/85MSRsydW5BbUHDgQB1JtI23DQD4hHlsCioAwlBsFApCfsEiQU15aXopcYMd4ISqERqfhUwAokkywwgWi5PNB1NNAYXLeArC82Vu3zslZMLvkK2Nk/igJSkS19fPoDPAAIwyARl9WW19bL1545MiBA4Bg4OzZXLpWSfXu8ajXbSNn2BLCwwQCgoEgDACEueJHkA/D0tPLofeLkQvkQB2QMqpB8NMAKFKfE59P+NtcL5pqFrRySVxQXFy8YEFxOjrkZ7boq798ZUynG4skkotdjRLxV1paWnS6HZix8UxxLVilOHlrFUJw4OzfCuh2tJ+ldZuRRlvXSFvS+REB9F2QCGNB2twZ6AkKh8VFIL28FAVCeV78aB3gkwAoVl7RdgQiMFcwXrkiQLMLdQ0qRg6A7oqLixbMEX8Dgmm68+olks6L3U+rWTRjLa2//OUv8PUNqK+vr60tyUhL3r5+65YtK1JB/4ZW6eXzcSjr2QpskXQB6n/yKzEnMiE2WmaLPGIGREIR6C8vRwBKS/PiRzUT+kQAyg0YPiYwUSCwZZHzQRojYJwgtmjBAoIA6C9aMF9UAvrhN5bVSlpbuyuYBgZ6LLoxEPjLVxAQ9fXz5tUvTEwMqvsGRhD4TdqGexuWne+MQz1uCw4vUAAgrCwnMvJ7mZxA2FKkfycKgdLSnXkjmzr79barBUCajvyRWzgQGCcQuEb40YEAg85yc7IVxKYvIA0d9Fe0IK+k0p+Bxn7dksbGSw1MfWxMFl3rGyRfPIlmJ8pKTFxULcLHjSVJnlYwGRUVrsjtof9tXweQU74yIRE6wRPtnrmGBWEPKC1Dd+U7f1JdJZu/kBIAzrFj5Q89+HzUPttwJyMIaj9TH75tWGx6kQqAoqLinBJxCREe4tp6qTQV1Ovp6enr6SYh/y+xozFokxPB0jagQaJW2ppvYODn7Iw1Q//bKpQTEMISS0sXxaJrjnnGwluHxe7YubN8ZzkGgMLhR7nqgh9//LCYTxoFBAId+RVwQ1HzwmB2xndyCvb15UPmSs9ZoAIgp6i4aINInITXjaESbK0EAHqIgO46CfR/CZQNuvQ4BGBl3LclIpEonw0WMD4WS3adgSSS+mMJL4gtKy0TpBNdgX5hAdK/cwfygx9/RCDKfpw/e86PG/9alk8NANnE2NhY58myVNnk6ClpgthYWzQ9BQbBLqA/MV1Vf1E6xEC0qLGWxUSlT6O0jknqZ1Z0/f1epwi6n8GYkIgtDcpomj7Szw51JlRDANjqxKLHsco4gEE/Jwe3ZEosOMhG7AEYQFlB8Y7SPX/ds2fnnj17dnzMZck+rRCamhYbBK2KjQ1KAwCCCD6h3xKyFgTAKiQe3UECzEmH4XBOiTgJ1366ovPrmKT+Dd2d3U/roG6g6dKSCQBBfnS6EXsEANDnOh69E347AZEQYeBbUEQcJxg2yzVsI+jfSXjAzoKC0jnzd+xBz+d/QMTnAAAnGK8TFqYz3ms8NMuV1B+qDWkrPR1JX7UKAyguzstBWTCpBO8YMHWTJH6EfnCADVbSy1agn8bwW0wCmEpnGGD9+m6ZJABXgatzbCwJIFYbu8BKKH2LiXw/AfwvZ+dODGAPAJgv+xEJL/joa9J95prgZNQqW6yf75YN+oPyilcVryIMABTNKQYKRVGiQCa2QDFTjyRgxMzvPD8NADDoyUsJ/YnRxiwuBmDgFk3GPQRVZqzCpmDHgPlPWXEx2RNBrokkAJQJimUFO0al4DMBQAAECcj+l3lD28ABiheQAFDfz8El4dSSEl0MgBXF1CP0g7XWNVSDA9BYGYQDLE7Moutx2Gwu3NyWjJd7QNgShf6gKbnotUQY8YtLySZMWVxIAkD35TLZxg8P/moDEB0LyQCPAWh1cIoAHABSH6l/FaqB5iMAq2b7V7IIF2CS4vX09fM7s9l+kAHpUekEgEWJGYEGXC5X34DNYbtFT8G5D9KKAkCDnHDxAAAQAElEQVRQUFqSDrwI42BpcTk52kWtTcPSceDv3DlVNvsjBj91AQjTAQCu4ADBaGUA4nNxzqqiBUoAxXPSsQfMp4uSdFUIoChgVrfqG+iiMTAwkUwBiYkT9LlcJmQFpoG+VzKO+zCBDgEgCAOQodyAPaBcviGSvKgMA8D6dwKWIo0BCBWMxSkgHs8KJ6AIWFCcs0oBYEEOCSCdMY+MAdIDgIDRxWp9fTQbphFVQOJiADBVFzqfhfKCYWh0Gsp7YYIpS4Jw76MvHdlkoAIAdhSXK6rewiIVAOD/ee9psnoBjB2rDc2yjY/H6wJTob05q3KKVQCkz0/Hc6I8u0DRazHAnNaZr29gwNZfVy/OJ1NAYmIyg8U1MUFceCah41HHhwmWLwmaFYSOo0MH0cBMBAMoKy5XdHQyGgbKSQAwBswezcFinwVAEKoD7QL9+DTnibGCwuJV81UAFOfl5eE5UTLdTkyOA3ICzHWdfmi8q+6qLinJIvUvnq3LYnJMTDiGRmjDKA0AuMYuiQ4KkgNIxrXPSgBQVl6maEc6coBSnAPRbOjjx8DPBDBZR5ZGAJCRABavKp6zSgmgKC99Pi4JC/xpyiRAEGBuO4+Gu9SuDTStryeTWSBjNkuXpWcCxgMAnKkYQG6cEgD0LSSBnHIYBMqVw90cyIJlexQAZJrygIkuMmiUwNbWVA4gpzRnNqkerVIWpUMdAPrTS5JoI7MgAnAZPMCg7rS+Ht3YODlj4cKgxKC8OQwmi8VGBNChE2wQ6xqWnaYEIEOn0Qo2AgDIg4qGRJfLI4CYD4/mEInPARA9VRaEAJCLMACguHR+QSkSj/SXFsO0aA6aGUycN48mVnoAMGDiHGDANjjdoG/AMtaaVt/YuDAxLT3PDq2XoiMNEQQIAkHY+NwghaHD4qH2Ky4vK4Npn6IhE0p3lhIAUCk4OvssADICALkKN1kQtKp09gSi95GVwbQAKqFV6cbLkuxqA0fo19Nntkpg3tNwxc9An17ZCFablbFy5UQaEDAhzZozUSCYm6xwgMRo9D4wGyzHq8DKluwgxwAoBkdVBX0mgIkyIgTkG4SCxFWlC2XFCgCl6UULiuIWzomeuczuu0rdEfpRDHRlG7Czr5zODWhoRUfZ1i9MTF+ah7ZNOKj/kRdYs53DctMUDhCL3yYsCNWBqjlAtqNcAWC0F6b+rCSIAcSOkz8Py1lVWiDLK11A6i/PyVmwYGGteF6Jv524ZGQEgAtYXT5uwDXI/e2K9LG0UbxMVC+GgWBpNB0AyF3AhDN5yZJEBYDx+G1cl2IHKFWOArIdRB0M1WD5G62kEIBsAh4FFIvEU4pWQWJaWL6AdIHyYpgYVNQ2ltBpk+qjkO6R40BF9yYDmPtsundPKv7qf3xbW5m1EgaCQAaTY60gwM2OVQKQvw1eAd1RrGxIGal/x86fNAogVTYemqXYiUkG5wevgGkgob+0PG9BjqikXkSnldQa4Z5n0hQ5QF+fKb2cyubqVzy90jqJZvyVqHbD/MSlicl0XRUAJn7RWUEEAiIDAICyHTuQA6iU/GVEEfTjjp1zXm8jpQBgxIXcpBh1J8MsAL7NLi8m9YML5M38qrYSqgAUAcgD6CzCA9C6IBoI2FyD448765gGusZfLSsRL4SSaAKdaaJiBoYBwICoArGllZeVIwAq+f6vWH/Zlr+OOgI++ygxSAITFU8gByAaxauK0W4VamXO7K/+l7hyElQBpPMbMxRZEAhIssEDWu91VlvpG+jbGX8jqq9MToyj0/RVCZhw2FYTonUUR8KnY7plZcp8vxDJ37Nz65ado5oIYvtcADBGRSuflJaiVhWUFq9CS7TIFv73ryrrl9FFgWQGoDP0cBWAs4CVNNVAb8Pjf3W1XgIEHH36zMZGcVbGOjrNwGSkcfKrt8nfZQde/y5WyYF5oH7Pzo2pP+0ZvYDPPlAyNkjlQzGKS7FfzkaVKvaAoiS09SVZVrKMzH66ihyABkJp3TTp0389fnzl4uNL1X76usvO19cnb/nVn8bQt34NwVz5BxfP3oO3AYo3Kt92B+r/nQUFoy4CZGoAEB2kcpZGcikxRZu9qpjQnz+vFu99zavE/a5SBxErAtWtT+9dOn/p0iVpZ9el48c7OxtrN+zbl0QHAq8ByO6SEu+xsRwv/6qkgIU794D+Ld/9NPoAUMexwlNUkgBkASIgZhejRLiqQlxbOVNUW9lYj8sAPbIKlq8JWFU2dnW1SpbNk3Rdkp6/3Nn9+PH5evQZzHY0Gk1vZAwcP13xLf7Le3B0FZcqK56fdv51z84f93/MNsibpoajxdNiVZ6sItbrZVPzileVzgH3n6klqhU1Nn5Lxj5ToR8RYEget7ZekRobN3Z3npdKpee7Ohul877+5ls6PoBM1QE6c7lJ8HfzS3EGKCtTDvgLd/4VAfhxtLMAwtRxvoByrxCEr5KPxAtzijeI60u++qb258p6qAWU+uUxoK+7rrWrtfXi4200rerurs7zkkaJpLFTYmfAoqOLK7C4XA4YBpDbmc0xgr9ajDPAjo17lOG+469/HbkjOCpTyxkj0XEqE9AcRdPyxbXir7QmVdaK6ythKFTxfmJlmEWraLzY1dp5aR5bV0vc2dXVeQnc4FKXmMlhs/XlpqdnyOZwAqBkgDnHT+V4J7S4TJkCf4T+H9Ui2Eij4Jqis2eTG4cl9RAAuloicIDd20voLL0RBPSZDP2KuorOrs4SLT0Thtay1q5uZF33Ls3T56ga20DfSFdawTbM/ql8Bzoa4seicsW27/w9e8o+vAf8bqPwsroljeKkvzAYWt/U11dUbYV6mKmnp+oFDDa7umFrRV3Nen9jDhCw21B3qRMheNpox3nd2NMqDbiTd+AaaEveHkW++2nPT58w9qkYhQDqS+y0tHTp/2PC7k1bD+yCGFDMA7AHsAw5BnXVW44c21W13phhYsLSYppwU/PzS0rys+0M3iDAq05iJdXAfPfHzbvkU578hfM/T72MMgCBfn5Jk2gMLTpDy3jrFnS0WMU8tNyvqIL1mYYcjoGkomqgo6Nq1xL0+TJMYzT2w6v6+myG/hsukF9pnFS9EbLdnNFP+d5jVAAIMPMwc7OiM3TpWgza/1yya9eWqgNVFctgbGfoyWeCukZIlKSio/9s/8CBwqlaHBNrAzpZAXMM9MA/RhqXXbdsUl0UJL2P3Pb9SFM7gEAzJzOeEYNmzNDV1TJmak3bdeJvx45UHdhcAgBoumT/67KQKD/p8eH+Ex3D/ce2TKCjM47RpgA5/2HpsUcSMMiXVktlk+ePesL7flMzgEAPH0c91NX4cFEtmm7UlrOv/tbx5MCBzSKGkoAuC4/w2dIzw/1H/jY8/OrYlkBc/RsoF4PYevpKBGyradsa7z1tqNj0nXobrGYADjY8XXSoOKGfpsWgb+149erMwPDZqopKXTkBfV07QtomScdwx5Fj/a+GX51Zb0d0vZKACUfPiEyGBvMqGxvrq8UtA4N9PegK9U1qa7JaAfhb6NIYSqMb03b3D/f3n+nvf3WkocFADxNgMHUZhH52xXH48Ql0ju3w8NklI4t/bFwjJvpVPxFMJr75dlvbS+IKCy+u9576cGs+ztQJQBTIGGF0re3o7PEn6OyPc6254NUMIjbkrl3dhA6QR4fJA4G/5XJe189BCPQMomobS74x3nv1Ts+Q/PoLAz3qCgX1AZjX2Kg4O4SMgIJ/PIHO/1vHq+HfT1cgeWx8PASbw+WgHMCtO4fOjziBz5UaHj7j96YLgOkH1tdOovvPbLvTO9hH6n/eN9ijpmarD4BEWq/sfOhp2rSajoF+cIFjA8O/N2wiuteAwWAZYPVgAdW47zuI8+yHh4+9vgaAvcBt66Fz2/OTZN9dJS9G3H5427Z15wbVlAbUBmCeVNqoAoCWf65/GPdsx4n+C9XZcvfWN0L9T8RAbl0/8Rv9+Dyx4eGa11fCQH/oriMHng0PnNn/3bZbL4nLjrSsg/dr6h3x9oG8T2y32gDMlEoldgr5US2EfLCzHRcqeBwc0RwTLpvwfkxg00mi65GfDGMC20ekAQgSv9xdR44cOIH8Y+D3lqbrQwMQ/wMD1xpk3/WquoCVgwX909qtTgDSaTRS/+Yncvmv+v+G9PNIQTj0uVw2plD9O3GWVD/2APgfwwO5qvI3SK90XTldc+DIsYFXiNFwjWxbQ0vLuXPXBgfaZQd71ynePNDC4ot7AOQAqYisAWoU8l8NPzu94Y2JDbJUXmqd4kxR8mwxSJYKF+CkSp9i6zp+6EDHq/7+/uEzyotDND1QHQeNebz/BwA0SiVirD/wjFLXq/6mbTwuJ2BvXUNFgLyqxzXAJu6mBjL2yRvmUEMS4OR3EfovNlRX1CAAw0/Wq14l6LDKYy44wJcHUCmpr02C7B/1u4r+Vxf28ni8vccPbq7rlpLJH0IAmHC5Px8aHn418gb/5nJQruBs6up+jLp/95LM+MztKAAGtr7r4tJWFhb/L4TATHTmD4Mxov+H26tBf7XEwo3HOf53JYDsumxObsPfVHsf5UBkv3Mh+jkbusAeP/1tBX/58uWZJ4ex/nd89pQ/+D/c/D+t2WqsBMW1tfXzaPnrlQSGf6/mgZqGhgJpLqfgNE8BgLO3mvPz/o7hV0r9KAk++/3ChZ7d0P8bOhGA7tOZmaB/+QqopJ5szVz+jiupcVH/W1iM6rIJSlMjALQHUjkpNzPzHySB4ScNe7Ozs3nZ1VAHcbL/no0TABcBqJNsktQMqPT/8KuOlrp6tIlSx+NUEPqlmauXA4HMmuFXv6+Pf5cD2FkQxvs0AuqcCyAXEGfHZ64fIAmcvgRKHncdB+UwEv69Anc/h81l53Y2SGqOKTLg8HD/tabmqz/XN8Kttrq1C5s0M3M1IrCi49kh5AjvcQCknze6i6fITZ0AvkWbYNsyl1seIgqcC60ok0Mu68KRUHcaBUB+Kjdg88XTEumuM8Ok+uFn55quPnr4sA2dQVRfK+nG+iWZqzOXIwK7j0H3L1/9jgsk2cn1mzoHfkqj1TodXoby4JLMTG8UBMNPKrZv3338Yve9e93d0lQo/S/m48VNifT4hk2Xa6p+J/U/aWm++ug+2MOjtRjAZZDfWUd0P0oB6O6dnztmKI8AJ89RnjJJmHoXREQQxQWZmRAE4AED21EAr9jf2tXd1X0JskDFcbQKdF6ay86/fLxqFzELftbSduPhfcJuVyL9EunlztYK6PzVqzORD6xejm7v+kx6HqnfzcXFc1QXDyFNzUtionrxpszMeM+aYVS5LUF9tzyzuhUIdNVxOdWQBbIvns/P72zddeAQumJOf3vzjUf35fawub4W6imwveNXYwOEmMDqd10pUZECvZxdXLw+IQ2oe1G0RCxGfpt5Zrj/2Yka7L2Zh5ulyAla87n5+TxOfoOk81LNgapDaNBvuqqUD/bo59rGxsZTbY/2ZhIAlpPf33mlSJgFYXNzowvHXwAAEABJREFU8XT29nYZPQF1A1hCDN1AoP/siRNb0ZMVV2+3NVxEcd2QPyEge5MU9FcdqDoDwd92f6Q9vNHcfPX2w0eP1pHCUR6E27uvlMkjQ8DL2dnFy8XFZbRnzqodwNTVywnLrDlx4sSR9ZnLM/ffunn75ilpZxfa/rwMd5cunD1woOr3M5va5MH/SG4PkcHTddGr5S4A+t/zkQIYgIOFqYszcgCIgtE2WO37AksUBNbXHDpyZGtmZvPtm7dvPWw7fokY3kF/f/+RA1U1mzdfVci/f+fOn3fuECDghVvTJq6Wu0Dm+z59lc7jOYB+5ADOTp6QB71TR/kBDOrfGcokCWRm7m2uOXRo/ZKrt4EA3JolreAFnRcvwNSm48iuzdv33sL67/ypuMRq758Eg6tRU+UAVr/302cDeaj/LdycncdZWgIE51H7AAVbY4QPwGC499Hdtub9B+/evomC4PbtP5qPVp/+/Vk/Wt14cvbA9r3379+6/+fzoWfP8BVG0fWEB19gBM1WkxUAYCR993vZERHgNWacszfS7+zp6TS6kpiKvUFMABxh761btx/dvYHU30IMwBPams51oJXi4f7fT/7S9uj+g74BdLVx8ori8PVs4MWfjx4dNQxYrbT3XCyYxXME/Q6WY8Z5uozDHuDpPbo8SMnucC6u3ZZvunsbfezWLVB/99bNmzfv3oTHV5ubm4/X7d7QfPX+ozvPkfpnQ/KLiuP7gaF/PtzHDViuSALvKoGQsSwcHRwcTMeMG+fiTJiniwYvovJOm4tql9Wbbty9hW5A4O7duzcJu3337o27pyate3Tr1p+DqOufPSOvti2/6PbQ4J/rLPzkAN5/jVQ7NzMHR4iAMc4uzoQHOMsBRMHU4CNmBxQdH7AEtb3g6m3U77j3VQ1gzNz26NYDwvOfYenE1XTJi8v3TrPwIwqBFe/rfjB/U28HR0dLAOAJXgAMLJ1xKTDZxdnbC2ojF2+vD1xXiqojRKKWwPyt7fbdm+h26+5rBB5tO/jonwOE2mdK75dfXP+6nwMXIcyc8MH38XJ2cHRzHjPGE77GoVQ4xtLCf/IYbU8v73GQET1dYGz0clP1BH83L9UgofAQmblzT0H2A+dHcQCBcOPuo9uE/puPDp7685mKZLL3SQoDLWwH3tTlcz/Q+9gmjnGEFAAAxo1BBFxcxni5uWhrO3u7jCFGRWTeTl6h5NjgF+rk5KTqFBQCkMkOP7pJesCtR1f3pq472PYIfOLmjZu3jzb3jVA+qKJ/aKCGa2HxkZP7AG03B6+xEAJYv7PLuDHeY7THAocxxKCI9Ft6OVk6OXl7hZp5eXuD/hGVAqUA9j4iQ/7Wo1NRaGs8cFMbjIs3IAuek8seHOEHBIDNJhYOdh/3FoFjTS0QAMLGAQd44oLiYZwCgBcS7eTthMQjG1EoUApg3V0CwK1HBxk0fDU1WuBBGAUAQDvp84MjCBD6n0y2+Pg1zmgzBECJgPwCDxhHAoDOd8I+QNrIOoFSAN9evYv03360D19ZlIX3zbbdgHGw+cEQ/pSJoSc9b3jAwBmuw8ev8/t5qXjACCNjwMnJ0svL29Jb3v+mI/8/pQBkp/A4+Ogw6GcZGeobMpEXrLt690bztaG+a0+Ghq5dudDzDNXAA8oI6K/hoAnuR8aALNTCTAHAeZxS/ziiLnDyhr63BCMJeL22iUotgIMoCdxutgP9eoZ6hoaGekyCQPO1J03S08+utXY+vvBkoOfChZ6BZwoPKMBz/I+NAT+emzwCnNFgOEbxDMZBS6wdG6n/da7UAliHPeA7GtJviAkY6rEYtE13m683SS+3nvuts/PxvQvXLjy+9/dz8mFx4Jofscrj/3Hv8TXXwnksygJjXSxdxhCP5DwsiWHQRUngDazUAkBJ4NFRVf1gQOBwW5NEUtcp7ezs+j+Pr1x5/Phx9+XfyGzQf5KLAZh+uAoizIrnrQ3Cx3p5uzhrj0VGEBgHdTGuhUgCqP/fdCtqAaAkcGMajWFkqGosRtSpOolfamsnAHh8797jexUVF7s7T18jAGzmYQCOyV9/3Hv4c7y0x2o7u3l5uowlAChzAgLgSQCAXPC2jymiGMC22+AALJbhSGMwvqucZlAhvQwA7t3rvnhxMyegoQsR6IMICIAJHlrlGP+xZ8GzzbTHeqNlYWdtbW2CwYhxQO4B3m/zKYoBfHv10Tra6/oNmTT/efoBra2tCEB358XHv7mZ8Oq6Lh/vGeqDMhDNcIGBd9xHuoCR2RgzrhdIVehXEvCUE3CyfPu8mmIAslOHo1gqAUDkAT1dY3+eRQXOAUj/veO51taIQNNQ37MCPMUHHzDVmfjhv4/MysGB5w1ax2hjw9IxgnHj5DHg7RL3jo/opBpAiSiQpafS+fr4Xpdu52BhUtd6sbOrq7X7twITa0dHa56kS3pt4JyhmwPhAqZOGR83IeByeZZo0NceOwamvx5mpmbepA8QSySW3i5ZGe+CSTWAbyqTmK9HAMQAAHCwyIYY6GrtlLqBfEdrR+uA1s7Tzyp48MQRGDiammp/1JHhX7Mt8HKYpyVoR+blrMgDzp4wNsZlJMa9c2ZJNQBZZZLeSPEGGICVo4UDr66189LFi6DfAel3NNnQefr4NEc3uIG5eZiaLYr+8BvIrEKJxSBSv5kLHgKdceh7jp+StnhpxnuuqkI5gJIk/dcAgOkZ+zk6WFhvaL3ceikX6Ucxb+3Ik16u9zN1AwMfcBtrae+d/uGRINAL64Wq18MR6XfW0dFJy0pLS8vIyChcvHRlTsZ7T6mjHMA3UQZv6AcAXPAA68kQA9UmRM53sIasUHFZbOHmRhAw1dZxNhub/qFVET+XsePGjYO619OMx7UKtJtQkDwnLz0nJx0sp6gob/YHEFIOQOanJ3d8A3QjDACAZt7xS608Rwt0c4AvGAgkUaambuADEAWmY3V0tL3TMvzf98f9Q5H2cSjfuxkpy/wJU6PjwJKnfnhRiXoAM6P0ya4nKICxDejIAyxMqrs2WKN1fWu4d7AOaOhs5OE0hlzAFA1pU8Ytnj/p3X87wGXsGNT/MAkM/dKHyr7TvkmS976hwgPYdB7yepMKKQ9pt7CG0tfaQnpZUuloShIADyCG9fR3DoYTXLTxaI/0e3+ifg0AkMnrIDIC4IvNtkMe4GCdu8EaVb04BzhYVNetyzdVGlnX6KRnvHVaNDlOe6xiFcjZ6lNbpwEAdoaqfU9cM5TOQ8WOhZuDNY5/pN/ROr86KcBMBYAOSWBx4kT/1/7mhOi0NNV1oNHtBqmaBgD4EzmQUE/oRx6AANRtgvGfGAHAH7J/jjJVBaBNEphSGDR+8oQJ8lwQNTU5I1Ggrbr65f1JB4hh0wAAGen9hmT/wxcXAKCxvzrX2sFR7gPWbpUTzMDkEDx15AS00wp1oqOzMrLmzJkzP72oKDFt5Cqg56ceKCzTDAA/FPlsrN+Q8AAEAOY8jgEOjuTMxwLVv9uSofrDDJC5QEUzRRvdIAym6Izxjs5C4/viNJ2xY1Tm/GBmHzltfJtpAkAU19BQ7vtsBQCofcH18SzAwhrNBhwtJheOJwBgBt46yLB+PM/VHuPt5Y3XvMhKX87A8hMPE8amCQCyAENl9KNr5nK5LLYjMQPAsyB8c3TkRS8qzFQS8MIAdKaAD+hoE2PiWGcXz7HyNQ+5F3iO+sAoVdMMALbBawQAACaAPACPAMgD/OIWFaZ5mylMmySgo52RniYfErSVqz7k2t9bFvpGYRoB4MczVHo//ONyjQyJzEcQcLQgIwAszUsBYIyOwmBqQwJQIUCsfnp9lgNoBoAs1FCpHx0uzzWycoS4J/TLI4ALEVBYuEhJwEUJQPs1UxLwDvX/rKZpCADXQBn/yKysiAhwcFDmAL8sBIAg4IEAOOmo2hsEMAVLs4/ZRH+PaQZAtptKDGAARuABDg7kSgi+t56M9asSGDuSwBT5iKCgMMbSa3SfMfumaQZAoJfhSA8wZMHYR2QB+XoQEQFyAh4eI2MAjwY68ixImrO398csGb3XNAOAiAGuvP+5XLYR+qBFYED4P/7YyTg5gMJFhd7YBzym6Lxm2joqXuDi5RX3nrnyx5mGAGTzDJQZEGdBUG2BwoD0f2uLgEKFLVq0aDwmYPk6ALIuQBOEMU5m3lmfmQBkGgOQSowDCv3IA9AqIKoBcBxYcycuUiXwfZYXIuDyFgI4F4z1NvOKS/vY7cP3mKYAuBkYjPQAnP/xShjhAYbJeBCU3xZ9n5GJ8uDbfEBHe4ylmZlnxvfvOYT0o01TALgGBiM8wAo0IwLkGGhhYZVFhr+cwKLv0yzRWKj9uvwxLt4epi5phWm56miZpnIAng9xlWYlV05mQd4EQj0y+fc1a7JcPDw8PFX7fpyLk5eXd2baosIstejX2CgQgNaGR3oA9n8U/xZoDIhS6FexNd9njHfRHuOJvUDb0wkKBCeX8VmFa9YUZqkh/pFpCoCDnr4h00iun2OI5wLEijBaEHU09Et7Qz26W/w99PV4b29LtN8x3nn8lIyM70F+oRryP2GaAeAfaqGnr8diYfHwj2dkiHWTBg8NrbKUqslHa8hAWLMGZolpaYWLFi9eg18rLPz88V9umgHg5sVF189jGMo9gGXoqJCPAXBZcWsUusnbGsV3uWEmkCzeexbJ6EwjAAItQ9E11BgMJpEFOFy6FSkdxwDPwoLHSl4zQqtCseIR8awwY9EWdQx/ctMIAC8PdBVhBECPSIGMb6wID8CHg3F5PAuuYUDhG/JfIwEMFmWkFb7jSIdPNE0ASA1mo6sIMlnouuIGXANDJv1/B1pbkzFgwTMCAlAnTFz7AQIoExRmjfKssA+ZBgB87eSga4SuI8iSf9KOnZ3MmEd2v4U1lwVZEeLCKu4N1YWLFBFQiPPglvefQPIJpgEAoR66TJXrSjOZLDtjmcyOi2eDEP2GLOLiOuwJbwZBYWFGIZYOrr9m7RY1Jj+5UQ/A38mAyWSO0M+Cl782gn7H+g2ZxGUluHrvCAIiE67d8snXDn6fUQ8g1EFX8ckyRAAY4Z1cFsvQAKZHBoaGRvIK0ejNIFCYmirfN4xyAHYeevKrSTONsAMYGeGNnK+NWORxcwoA7AmL3uIDa9euyYpWT+F3WPar/OGv+4hLMVEOwI1HZECsH/mAkfxIDhb4AD6G3MiAS66WGU1OzgLByMhv8GDrkmmf2YZf/31YJjv4b5ns34dvtu07CC/8+uvDPx62oZ9RDcA/FHQbYfXkjXQAmczYyk4PHzeop9gz4QKbpKkr1mdtgYr/+y1btq4v+FzxyECsTLbvoeyPtl8f3mwD3X8AA/JaXFQDSOUxmUaKK6qDfj09lvxnRkYsfUxAcdwA11CxzTnpW/U14qHs3xgAWNs+/MKvhw+T1+KiGkCAIa6BVAkojmWiG7KM9A0Vxw0R++YUtOEPrHUfQEAe8CukgT9O3Zb9cRP/kGIA/jxSPxoFjNnoakcAAAFmSURBVJAxjZR72UYQ/vKDJ0kvMPiMne53Gep+GfIDGZKO7n9FTkHkQ4oBBBoSHzBrJNcPbq/8qZ2h8hhC7AVgrHf/sU+0X9tk+w7/+yDiAD6AvAHc//a+f+McSDUAFvGZUugLx7+RSgTIZP/baIR+TEBf7W3APb0PjYC//vHH7T/++AO/8gfEA/oBxQCsyEvpEx6AABip+rjdyENIcSakIAbeZxQDMELiUf+jT5dCAPRGuPjXesoDqOXHkFGRBt9j1AL4i5GeodwDCBJ6I/XZqSQB0gc++Yi/d9nNh4cP7zsIyR9Gg7ZfD8v2nTp1cN+pgzJNVIJfGxmSISD/ZA2jkR7+tWoIsKmJgV//ve/gvsNQ//wBWeDwrwcPHz518CDBQEY9ANBsSHoBtteTPOtNApqLATQ4UgvA2HCEeoDxurqvX9dvQMFA+D6jFoC/IU78RnpG8u9v+DdL5XQCNDc2VH8SeK/9X86OcvACxOs/AAAAAElFTkSuQmCC",
    "deepseek-legend-sad.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAEBARYCAQECBksDAQEDAyYEAggEBRoFAAEFBSgGAQQHBiMHBy0IAQEIBA4IC0IIDU0JDU8JEFgKDlELCScLElQLE2AMBAcMDzoNBxMNF2UNF2gPCAsPGWwPNZEQRrcRFUwRF1gRHXARI34RSbsRT8ESIXYSJ4cSLY4TDRkTESwTKXsTK4wTQ64TVsYTetQUNYgUddYVGEAWDA8WPaAWadIWbdAWfdYXEyEXIWIXJmsXXcwXedgYUrMYYskYYs8ZH1YbGC8bLnQdExQdcNkfHzIfI0wfQIwhLWIhOX0hfd0iZ9YjGyEjSZckJzwoGxUoPGwpLUwpZLUrJiwrMUEsXKctOVMtRnwuVJwvb8Ayg+Y1ToA2JRo2UGk3LjQ4QWQ4Z6c6QVU7jOs+YY8+bpxAVoRBLCFCNTxCdsBEbbBFlO1HX3FIf8pJNSlJS2dKea9NltFOhtBOtehQi9dQm/RQodtRPkBRappRboBRmsFSoe1Tf7dTh8BVkd5VvPBVw/NWpMlWrPNXmOZXpvBYPiZYfJlYk9BatNZbV25bsfVbyfNciaZcn+9dR0ddovVdtu1dt/hfnfBgo/FgqfVgu/Nhte9hwPNiSStkzvNlVExmte9mweNnbGNo1PduZ39wUC1w0e5zUlp2ZUl4VjZ4kMx5XGJ6j6h7fn99dJCBXzKBgJyDsciFXWWHaDiHdFCJ3fCKoduNc0uNgF+OiauOzd+Pl7GRdX6Sl9OXcTiYbHeZh5Ccb16e3OyflJqfpL6heDmhkH6hncOh7PaldoCpnqaqkGKrgT2yraq1eoa1i0K1opO3rrq7l667oG6+k0jBr6XCxMTDmlDDu7/D5erFg4/HqHHKlJnLm0HMk6HOt7jOuK/QydLQ0dLSqlPUoKvWpknZx8jcqEHcwovg3uHiu7HiwLrlvFvmv8Pnq7nouFPptknpy8Pp6urt3cXt39jzwlLz08v04df124j129L13tX18/P2ycH33dT4+fr649z85df8/f38/f0A/wBfiDeKAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnQtUU9fW77/xMTIowwvDhFcuTRoe4RGqII8iFAREqoBYPGIFUWsBn4BRgUDVQMAkvogxkkB5aHlUq6KVerXtKXq19FRNRQ9RPPbgGznU3oq0YJUKZOTOtfcOBATPN06ydzyPf4ZkJ5jNmr8151xzrb2z93/p/s31X+ZugLn1HwDmboC59R8A5m6AufUfAOZugLn1HwDmboC59R8A5m6AuWUuANu2bTPTXx4jygHUNWvafvihFakRnltOVlLdgtGiFMCaphZ144jBGvi37aC6TXOUykaMEYUAKtWNo9x+20/6raMtauqaMUbUATjaPOaNxt/qhrcrNZS1Y4woBNC0ZvQbbb9dHN7eNpYOZaIyB9TV1RnGQO8vf8Oe19cdPVo3/icoEMWjQGVjs7pFfbLx5IG6xt5ffoFX6uajZh0QzVEHbKs82tjYqOn97ZfW9Wb486Nlvkqws/en3/5mtr8+LLMBqOztbW//rdFcf35YlAJoM9hu7/3paFPvveHX2w5S2ZIRUQrg3jCB9S29vZrK6o7epuHfmSkdUApA3asn0Nz76FFT9YaTj9p1+BjQ1k1lQwxEKYBGiHtsI3Ft06OOo0Vbqrtb8N809bZQ2RADUQqg8idw/HdXFookh6s7Ok/VyNZ1NCXPR7/57ZG5ZgPUjgKPun/q/Xx3Xp5k1XZ1d8vW3M9b1vNzVlYfrevtxGphMyRCKgA06we7tZ2a5kct7Uey8rLSPu7sPrVd06FeIsi52NLUrkHZUG2GeTElHvBTB5bpNgo0nZ83aX7q3Lz729Z7nfc6mzXdvRePHOlta1Y3Qee3dFLRmDGiBEBzLxrudpQojnSeOqLu/amzu7uzu7ezvUMDP9rbu++dbNbU6TS/mWNKSAmA97u7uzXq3cLCdQfUFzs7Nd/uLizYfqq9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",
    "deepseek-legend-sleep.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAAAAAABAAEBAAECAQEDAAEEAQMHCSwIAAAIE1QJAAQJDTwJEEUKDjYLBAYLF2EMFlcMH3YMJIANBA0NGmUNJ4oOFEkOK5UPBxgPGVoPHGcPKo8PMp8PTr8QCw0QKIcQO6oQUcIRIG4RQ7MRatASAQUSDi4SMJQSS7wTFjkTJHgTKoQTVsYUP6AUW8sVCBUWCh4WHV4Wgd0XTq4XX7kXYNIXht8YBg0YY8wZEhcZGlAZZ9YaDiMaLXwbNYobUqMbbdgcKFYcb9Ice9odEzgdFysdddYeHUYeIzkeJWUect0gCxYgGB0hW7gheN8jL0QjQpEkbLolISklM2omiOcoRnspEhspaMwpfuEpktkqHDgqJFUqOlwqPHQqg+Iqpekud8kusvAvOkoxkOwySmoyoc8zHCUzteY0UYc0id01KUE1q9o2kuU4T5w5mOs5vvA6y/M7Vm87gNI7lcE8NFs8c5o+JzE+Rlo/g6lA0vdBXpdBYn9B1vZCNUpC0/VDJyREV6pFP31F0PNGoPBG0vNIQGpIvN9IxvNJMjdLZrxMMUFMo+1NotVSSHtTMiVTzvpUQVJWrO9Zy+xcSmNdO01dPT5da6Bdj7pfVoliWW5iitdkPCpkTFRrs/FsmuRud6pu0vlvqO1xR1ZxWF90RzJ2aXt4T296s/B7hbd7nNF+VEWAUGKBZ1+Ee4+Eu/KIUCyKWGyLYUKOwvSReXGRyvKUX3KVWTaXh5iYbFKYveeaxvOeaX+gaDqhyfOjd1amlaSph2+rqsqszvKtlIWvcTywbYexgle0pqi0qbO5wNy51vS6dZK6kGW7fkS+oZm+sLHEk1LFiEzFvsXGdpnGo6rHfpvHnXPH3fTOfqDPwMLRjEzRqX3RrqbR1NzS4O7TmVTY5vXakqfcv5ncwLvdoVvfjavi5u7lqmTm7fXptGbrurjs7vPtpsHu8PXwz9Dw8vbxyrfyu2/yzsnzzcf0ycP10s319/r22dT229n5nb/5yoD62tP72Mj72MgA/wArqSOKAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXtUE+e6/8+fLBawSPKDUBKyyIVDQkhSMcDJ4hoCgqSbFDZYUArqoRZRjIjYVsQLWkRrvf1Qq3ihVqg3VKgXsNJgK9IeUbl5QSpia+S6kaMCUu2a877vTC7Qunv2b89M/G37jZAJQvJ8P/M8z/vOZGbyb9hrrn+zdQC21p8AbB2ArfUnAFsHYGv9CcDWAdhafwKwdQC21p8AbB2ArfUnAFsHYGv9CcDWAdhafwKwxYuW17V29/YDPe5vuXraFhFYRDuALedau7v7jS2NhkaDobGlt//XsbHx5kq6wzCLXgCrzzU01J3agj/Ya/pp5fUnY7/+SGsgFtEJANg/t9fy8Jb1aj/98/MWGkOxiEYA5Z0Nq60e7jX+POG/T/U+PkZfMGbRB2B1a8OExw0NP0/qf51G2oKxiD4Ap85NfNgACEz8jXJjOW3RmEUjgFOmJWRz77lzrY1wYcvPBuLnDd1baIvGLPoAbDlHrN/VdSgXzp3Du155L94YyzuN537/LykVjU1wy7lz5agLnoKOT5269SNa4dUG+L2uu79l78v/ljrROg/YcqquDrjfAlKh/Nypn3+Glg39F881GJ/3X7OJffpngnvPAQanTm0oL29oHb/eUg5nhNcu1tqg+AnRvy2wunxv+d5Te+saOn++29pvOGS4WHWd9iAsoh/A3nOnyn22nKuu6zS2dF/cXGT47+sNf/xXlMkGGQAq4G2fBgCgu/vnyncrW652V9MehEU2ALC3vPxUeQOYCLX0Pv/51nPjte7aWbRHYZYN9geAHtDQeq2hrqXF+PzXny9d6u7eV1rxDv1x4KIfgOOGhvKV735Y3drS3396RhhPIMiPF5QetVUS0A3grSBpUIyULxKJV7a0zJcIwsJkCkXwHEHutwtojoQQzQD+w53pwvGQiEQ8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",
    "deepseek-young-eat.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAAAAAAAAAABAAECAQECBjUDAAEHAQIIAwYJDT0JDkEKCikKEUILEEULEUIMFkwNGVMOAQYOBgsODjcPFkcPG1EPHFMPHFYRCBkREz0RIVsRIVwRIV0SCxISG0wSIVsSIl8SImASImMSJGYSKYETI2ETJGIUAwoUIVYUI14UJWQVKHAXMIcYCx4YJV4ZDikZKWkaBhIaOJYbFC8bGTwdEBshFSEhI0QiRacjLGIjO4gkGy0kRJwlL00mJTEmTrQnS7koVrkpT78pUKwqGiEqN2krUcIrYq4sSIwtP18uTXYuVsYvYtIvcrovfNQvhu0wW8swbNoxc1wxeOQxj+syXIQyXsIyb90ygMgyldgyoeYzQHMzjNAzs/I0HDA0Kko0cY01nO41qO82sPI3JzU4hrM5U5s5aM05bpA5rvM6uPY7i+A7rPM8b6E8muo9b5c+O2BApNZCOkhELDhFTGpFk8dFvPNHR3RIXalNq9BOgK5Ok71O0PRPVoRPdNJPyfRQhdpQruFSNUJTkLJVabNWSFJWVnJXvOxY2PtbntNbveRcZZ1fdsFiqOxiyfJlZ4ZmQVFmXotrU1ttd69tj5RumOFzaZZzhNN3S113epV3nsl5erB5g856hb98nL18ni+BVmWBaG6DiaOGkdyHktGHxe6IXXOKdZqKiL6MdYmNc3eNtNKPpoCRlbSRnNmRnraTXnGTk9WWiKKZfIOcn96docafquCjoq+kaYClqdynv9SobIeohIupla6psKuqq+KqrcGq2PCubH+xkpazteGzuuK4eZa7ZWq7m5y7vM29pqa+eI++0efBd4nBpcjBxujEr67Izt7JydbKc2zMpqnMubrM3e3OgJrRx8LSf5PSo5jUhInV1eTV2ujZs7Da1NPciZ7fw7/f5OzhlJrjkbTjk63mwbvm1L3oqa/o6vHrLwbt3uLuz8jv8PXwvrzyyMTztr30m8D019D07On20sz22dH29vn329T429b4+fr53NP8/fz/4tv/4tsA/wCGJ+VZAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXtUk1fa6Ocv1voSCMlqgHDJYAjgCIIoagl+OBCsoAYonArITUcoUFEotCpWpY6tVStWa1lHy6AdBFRqP6hV1Fq1UBUXoB4uH3hpASH6oRnBtDEESLJynr33mxAutp1j3qQefVISTChrP7/9XPe7382fdC+4/MnSA7C0vARg6QFYWl4CsPQALC0vAVh6AJaWlwAsPQBLy0sAlh6ApeUlAEsPwNLyEoClB2BpeQnA0gOwtLwEYOkBWFpeArD0ACwtLwFYegCWlpcALD0AS8tLAJYegKXFggDmBE6fF+Q/b+H82Ozs2CXzLTQKSwGYMU8UGhIiEoWESqIjMqNWL12dnL3YEgOxCAA/n+CwsLBQIBAiChKFhsFraGh05t+XLTH/WCwAwM8nBJQPDQ0LRXqHhQSHhorgFYhIopJjzT0a8wOYSdQPBfsPFochDlh7BCAkJDhqmZmDgbkB+PmD6ughEmfGxMfHR0hAcaw++IFEEhYal/CWWQdkZgBzgsOI/gsy33gD9F/g4yFCBELDRB7u0/0lgCA6cdN/mnFE5gUwDRt8SKhI/AaS+HkcoY8I6w/v+k/n+SACkpz3Asw3JLMCCAgJJfrHYf3fCOJ4hBAPQATCQvz5mEDY6q3mCwTmBDAnhPi/KO51rL+Y52+IACgXQhzAXiAJy9mRa65BmRGAn4jMf4j4dQwgfmaQhOhOHoBHEuoRFI0QfLJjhZlGZT4As3yw/4eELFj9OpZF/nr9US5EWRA9+YQgAJk73jPTsMwHgBeCtIfaL2op1j/TZ8z840SInrATRCRs2WSeYZkNABQARP/wpUsxgaAQY/1DqSgQFiYKBgAxiXl73jbLuMwGQAjBDwNYvRRLlEgyTn+oBbAhiCSS6KgdeTv2mCUQmgsA1z9MJEIZIDyHABCHjvMA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",
    "deepseek-young-excited.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAAAAAABAAEBAAEBAAECAAEDAQEGAgMJBQkKAAIKDTALEDMLEjsMDSkMFUANGEYNG1EOEzcOHE4PCA4QAgcQHEoRES4RH1IRIFYSIlcTI1YTI1gUDhQUJFcUJFoUJFwUJVkUJVsUJl8VBQ0VDB0VIU8VJVoVJVsWFDIWKmoWTbwXFiQXKF8XVMgYGjwYPJoYWs4ZKl8ZL3QZOIUZS7UZWMYZYdYaCRUaOIAaPIcbNXobad0cKVYcO48cQqkdPIMeGysec+QfECMfFBkgIkMhW74hZMoiRZwibtUieukjMl8kKkokUKkmQaInGiAnRocqIC0qMlQqU5YrOmgsXaYthOsuKjwuc7guedkwT3wwZa4xf+IygMwzQ3MzV4U0gr81ZZw2MkA2O1I4jc45Jy46i+k7jNw7lOs8huE9brM9hq49mu8+RVs+Yos/SnpCTWtCfcZCnvBFLDdFk7lGmO5Hmt5Hm+pJU4RJdZNJkexJoO9JsuFKVGBKidNLWHZLnfFNovBOND5OnMZPXphQp9VUXYpUpexWle5WveRXYXdXq/JXyu9aa6taufBbPEpbSlZbx+5egKdemvFfecBfl+lgb5JhQ01i0vZkapNkhs9nrvJow+9peqtqnPBrjLNsS1ZtbIFuSFdunvBvVnBvldxye5Vz0fF0l/F3hqx4VmJ4Wl94nut6pe57d5N7mtR8lOx9mPB+VWSCZXOCreqDkeGEreGFk7KHOkyHgqeIme2IoeyMdHuMksGMn8GNrs2OS1uRj66Rpt+SveqTrumVXm6YfoSazPCbr+CcmbWco8ictuydbn+iipCk2/Kmt+CnlpytwemupLivZ3myc4Wzyu62t8i3hpe5xuK+1u7BoaLD4PPI0uzKfY/KxMzOrrDQlafS3O/ZgZXZ1Nnb4Orb5vDcpa/deY3duLnkwL/n2tvn7vTqgJHsnbTtysjvuLnyh5f0sLn0xcT008/06uz12dT12tT13dv19ff22NT22dP5+fn73df7+/r7+/oA/wCx0EUAAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztfQtUU1fa9rfWt9b/rVlcEqAr5PaRQD5RwyBIQMVUQC03EZsKWK4BRhsCUimMEQsMQr0ggrSMWi/UOo6DLVNbvLW2WuwIWBW8YQUFUWQEhcbiCGoDISv/u/c5Jwleq5yDM6t9jyE3c7KfZz/vZe9z9sl/GX/l9l8vuwEv234j4GU34GXbbwS87Aa8bPuNgJfdgJdtvxHwshvwsu03Al52A162/UbAy27Ay7bfCBjrL3z73cUrdywZ6299so0xASv+vHLHyq8++qhsxyNvReYnxRrffJ6dHaCjRWNLwNvk/Y6ysqKH3srIzfwFOzjwnunh/v4eOpr0kmLA26vLlo18JRs9X7jinad/rq+fenR6sJeWlry0ILioLNbyaXRhsnHuohKwd5/2qfPD3xMPLg33vve0//iL7eVlgaIky2fLsmLnZxfm5mZVXKlb+OQPHRhuw/dtQ/2b0f1f2vrbRteMl0dA4iKLJ4HLsjMSAD8Q0K1tXUG8+BiNfzvcAX8P9A727Yf7v9wc6L15Z3Sx8CUR8Kc/GSOTAo0L3yZ7e262Oi0XW0VXd/eVJ0aCtqG+78/0Dg4MnkdPBvp6egf+4xSw7uiJEx+VlZUsSkrJLSopK1v9LsoN+dnRgL4wN73kSndXd+uTvKB3YGB4AFlfW9vAQE9H39D5UTZnjAn4w6HWs2WFanV6VlZuFggerLCkYuWSN5RZCdm5uSmh8SmFdVc6rzQ9/uObMfjevoE+zMHNvr5vR9uisSXg0JUrZanBUUEJWbi7kc/nZhVkZWnyY5Pz07MSwhNSwYqam080PPbzB1D3D/b3ESLoG+j9y6ibNJYE7G7tPlEUFZWgTsnKNVkWtnR1XFSKOiIBP0xV1x08u/Vxe8AEIM/vBfQDgz0HjAe+/350jRpDAr7rbi1LiUvI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",
    "deepseek-young-hungry.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAAAAAABAAABAAECAAEEAAEECT8GDE8GEl0HE1gHGWYIAQEIBAUJBAsJHXQJIn0KHpoKI3EKKH8LM4sMDTMMKIoMKnwMK4AMK4EMNYkMNYsMOY8NBx0NFlMNIqYNLJUNOo8NO5YNPpQNP5YNQ5kOEkMOP5QORpoORpwPAQIPAQYPOo0PR6APSJ4PSqERCQsRHlgRKa4RMoMSPpASUagTBxITT6gTT6gUBg4VVKoVVqwWBAcWDSQWGkUXWrEYDxIYJV8YPLAYWa4YWa8YWbMYWrMZDRkZW7IaW7EaX7kbK8EbU6cbX7YbX7ccFSkdChMeR5YfMmwfVrUhIUMhPn8iOXQjFBsjGjAjS8MjX7MjaNwkX8clKE0obtYpGiApMFQqIy4rR4osZboseeEtUJcuOFkuad4vPNUwKjYzHSo1Qmw1WJ82Nkc2br42iOg3Ut04QFs5WoY6THQ6ecs8Z6s8jes9JTBAc+RBaZJBatlCMjVDgulEhuFFQUdFe8FFkutGS15GdJ5GjudHKzVJTORKVYZKf7RMV+hMw/BNWnVOMz5Oc+ZQjM5SnMZWgaJWmetXYpFYe+tYmtpaOEZajLpbiOtbpOFct+NdjutfbZ5hVFtjQkxlZ3Zlx/RmpNRneK5ojaNprO1qs+prvfFulu9vT1hvnuZxoNF0hbp0mMx0tPJ5dpd5mbB6XGN6dIJ6sNZ7R1Z9u/F/pe6BXGSBm9yCwfOFt/CFyfOGh6GGj8iHqu+LVmaObXKPl8iQqeaShoySl7mVanKZ1PCal5+avfKbgJics+ifj8KfptGjst6mYnOmfYCneoWppr+sk6ytpquxeYKzvty1x+a4kI64sLS5wMe7h5K/bITEm5zFi5bFz+XH2+rIu7/Le47Ol53OytDSpqbWkZzcn6jd6PLfs7Dge5fh1djh7fbjeZfk5e3ogZ7q8vfrmqXsw73tpavv9fnwr7Lwv7nyxr7yxr7z+fv0xL30zMX1uLn1yMD1ysH1y8H5y8P52dT52dQA/wCxeLp0AAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnXs81Gn//+//HOZx74xBDkmronrcympsHuWrViFUTiGVKIeOGiu0aXVTdtksEovNZmnUlihCVkpJtW3bYXVAosWt2VqrnB5kGI/5va/r+gxDtXvfmc9nftv2+uycR3u9ntf7/b6u6zOfz8w/JH9z/UPRDVC03gFQdAMUrXcAFN0AResdAEU3QNF6B0DRDVC03gFQdAMUrXcAFN0AResdAEU3QNF6B0DRDVC03gFQdAMUrXcAFN0AResdAIX8X1d++m/Qeolk/Z496EaBYh6A87aCk4VFR/LycnIKU9MFAkHW4biVjLdiWEwD2JJZWCpI2hEE2rEjKmqHn4uNf5SgMFNhCJgFsLKgNCdqN3LvsGgFENgR5M9fvcwvIimvcA+jDRkRowD2FOZFeXuD/QiT9xd5oRjACuXv3pFUdpjJloyIQQDOh0uj/LH/oPlqi/xxGhAGQRFwW1aokGrIHIAtJwX+/v6hyDV/AsR/ENEOaRzsKLu7jbHGjIgxAOsLk8A/H5vWmBUkFYkAfB1VdvnfTLVmREwBWF8Y5e8f4YcK4A4HjYigEQI4FjCApMuXmY8BhgCsPIn880kAzPIOChpNIJSMiTmXyzYz054R0QxgpcTSE90eRvHvjwMgyN8raIx2hIaiEMgpu9xYyPSEgFYA206WXT7sG+gp+SYd7Ed4kwDw9h8LAMpiUFBUkuDy5cuNTI+GNAL4ICQ2Mjbr8mG/1euPB40EwMsAonckRYYG5VyOKgICl+Poa9GrRB+Aue5eXl6L3p8SGeARvgPse1MB4L+GAkCGxKDo9NL0I1lbI6LKBNFliACzZYA2AM7LdnqD1sx632xrpL+/l5c/PzQqJzoiyHsNNQaEBu6Ijs4pLSsrE6QXhQTsSEoPSiqFNDhJV5NeKdoA+EKXr0EIZrkG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",
    "deepseek-young-normal.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAACAAEDAQEECjQFAAAFAgYFDTgGDz0IAQIIBhYIEDoIFEUJGE0JJm4KAQUKG1MKImEKKXEKKnMLEz0LJWYLJ2wLKm8LLXcMBggMIFgMMXsNM34NM38NPY0OBQsODSYOLnMON4UPBQ8PQZMQJF0RFz8SAwgTPYgUCQ8UDBkUDR0URZkVNXkXKmIXPH8XQIsXR58XSqUYHEMZQ48ZTqsaDRMaEykaUZQaVKEcJUgcMWgcTpwdUq4eQoYeWqgfExofGDIfVrQiWKwiYqUjHTgjXLQjYbAkGigkSIwkZ7UkarElPWwmJjknIkUnVpsnb7soK08pGh8rSXgsMlksTZQsYrsudL8wdK8wesgzgr00IjM0bbs0esI1asM2ccY2c7o2gcw3Lz43PVU3VoU4Iyg4OWc4f8Y4htE5XaQ7i8k8ZZE8Zas8hM88hs49RHM9f8w+iMs+itI/SGJBd81CLDJCj9RCkddCrtxDk9RFKjlFu+hHl9lIxO9JNUlKnNtLn99MfrhMoN5Nh8ZNpOJOodZPNjxPT31PdZ1QgdhSYI9SkNNUbqpYQVZaUmJbhqxbyfFdi+BeQEdgnd1gqdlkWIVkmellYHNldJVld7Zltetmb59nTVJnwOxott5qpedtSFVtk95vgqpwgMJwx+1yk7pyzPB0gKx0i810rOh4cH55Tlt5WWJ+oMx/f5Z/jLuAn92AxOqAyeyDrd6EVmOEueSFmdWF0PGGZ3eJaWuLot2Oj6mRm8qTqOCVdIiWYXGYeHqak9ibjJOcruOfsuSgseShsuaiy+qjtOalidSlnKmmh46ouOmpbn+qqsSvvOayfYmz0um0lZq3q7W4vdG/fYzAyevCoqLEjJfFzODF2+vGurzIe47Mq6rPf47Qh5PS1+7UhJDVyMjWtbTYlJ/b19zen6fgsK7hwLvj4+3qxr/s7fPvprbxubnyysP0wLv00cn11sz22M722dH22tH22tP29/f329H5+vn6+/r73tT759/9/fz9/fwA/wAd+Mh8AAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnQtUk1e6989as/JNWJKwEsjtS0g+kwOsnGm4hMsRJMAIFopYgUEBHQGpVgFRER2VgkUdLNXSVizVeqmO2lbtRet4OSNKdYq3qtTWC9bxUqyAxFQMFxMIrHzP3vt9k3BxWjFvPGedeV4xEHzj/v/28zz72fu9/Zv1f7n92/NuwPO2fwF43g143vYvAM+7Ac/b/gXgeTfgedu/ADzvBjxv+xeA5/mfv/jyy8/zv8f2nABMmjglUROfDhYflxgZ8nwage05AHhx8uz8xelRUVHBWq02OCwMvgtLTHV9O4i5HMCCqjXV1YvjwzQKn7CwsGCtBhAAhPj4NFe3hJiLARQujtMER8WHBas4bDepxgFBWOz0Wa5tCzGXAqhcM4XrxlVqg4O1CpWSx3ZThAUHhwVTBILjp892ZWuIuRDApE1rIrlitSYYGwj28XVTYQJaLSEQlp7vuuZQ5joAs3esCRBrtT7BDqbiKpDuYC3lA8GxOZNd1iBiLgOwYEe1vypY66NFwrU0AQXKAzQBeA2OynFxGLgKQOWO6mgF0a/FG01AiWIgLEyHCUQBgmzX+oCLAFTu2JHvo9VqkH7tQAIKpD8qR4c8ICo+1tUEXAOgcsOONSAcRjyq/236YTxAGTC2ehNKi8Fh8fFhYemTXNIoYi4BMHvHjh05CACt3U4gKlbrgxygekd+MM4CYXHwxxWNoswVAFKrd+yojtPSBAZYVE6sjyY2Lip9zS4dHgcAg09wtAtaRZkrAOwCBygKjovSaqNs+okfxOZkp+eEKVDfRy0uDMb6YVNoXRcELgBQtQEApMfPi9dqcuLjKf+P0gZHpecUL1mTnh6rCcJj4ASUITUoI2gVgcw3izLmAUACrK5eEzdvcZhP2OLsoqKc7OycnLB4jSZ+XnFx8bxs0K4mVQAq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",
    "deepseek-young-pat.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAAAAAABAAEBAAECAAEFAAEJBAkLEToMCRoOFUAPAQYPCQ0QECgSBxISG04UG0YVIFMWBQ4WI1kWPZcXJFkXJFsYDBgYJl8YKF0YKF8ZKWIZQp0aFi8aL28bI0wbLmkbNHcdS6QeKVYeOX8fEx0fHDgfM28fN3shPoAhQIUhQowiQ4YjMWAjR4ojR4wjV6wkI0AkOnskSJAkTpMlTpcmP30oGicoKUkoOWooR4QoWqMoYLYpUpUpWpwpabEpa60qN1cqa64rWZ4rbrAsbrMscLItY6stb8guIi4uQm8udM4vZakvbr8wY6kxUYszd7kzd8w1SnQ1XaE2f9Q3XqQ3ecA4KDM4Zak5W5g5aqk6M1Q6XqI6hdk7X6Q8NUA8X6Y8YKM9hcs9idw+UnY+hsg/RmI/ebZBj+BEW4FEktFFkNdIZKVJh8FKRk5KapRLUWZMLjpMia1OmeJPkMtQm9tSaYpVnNJWWm5WlbdYcq9aeKZaeZpbrMteO0pfZ3NfoeRfvd5gSlhigbhknrtmpt1nZIFqU2Rqp+hsy+ttisBvd4ZxhKtx1/Jyq+Vzksdz0u92SVt2cJF5qMx9hZd9mdJ/sOl/temAV3+AuN6CWmWClbmEVmiFm9mFod+FtOiFttiHn9mIuO2Jr+CJuuyMo8+MxOiOanGOw+6PlKCQgKGRyvGS1POTZYWTyfKVgYKXzvOZdrqZpt+ZuN6Z0fObo7GbrsWcYnCdc4adx++d0vOfncKkqs6ldLalhJamx+unc36ot8apjI2s3PSvcrWycYCyuOC2cai2qau6lpy7qKG7x9W8eZO8l6K8mJe/gIu/6PXDtrjFaa7FfYzH1+jLxtTOs67TjpzUipfVh5XVmaDXlqbX4u7X8/jakp7akp/dkqHdwb3hw7zk6urk9fjm1s3noKvq7O/vrbPzubrzycTz4Nb21M334tj43tX45Nr45dv4+vr55Nj55Nn55dn55dr55tr55tv559r559z75tv7+/v9/fz+7uT+7uQA/wDo7350AAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztvQlUVNe2LnzGeOO9KC/8wEUIUApFIz0ijUhrh6BBEZVGUVFUBNtg34AoBoyACBoEj2KDHYFwjnKiaEJyE5Vrrke9NgFFExs0AgoURVNVUJWqUf+ca+1dDWLLxpwx3pnb6ktd37e+2a29a++/KP8ft7/82QP4s+3fBPzZA/iz7d8E/NkD+LPt3wT82QP4s+3fBPzZA/iz7d8E/NkDAJu3s7Ti4sVzFaVbP/vw//mfSsBnG3fMm7f32q1bVZVoVVVV187tnPdhx9DvBMzbuLLXt3eeq3nw8OHDmlsPq4qLys5WVn5XXllZjixc3NnfY9K0fiVg3s6LVbcePrw2u+cHWy/eAquq+tvfYOKLy+AuL2n+rLSiysqz5WeBg4r+HJW29SMBgPLhQwT6sNha64Od1x4CeBR9WVHefsRfnDDYajjYrDxQAVjVrXMfKhz0GwE7qwB9VVnBumXLUitXWKo/+Azgny0jPg+3s8VlZ8+ezZqVkDArdriVlVXSfsJAOahgRn8NTcv6iYCtlaDw4tSYaZMmTZs2KWaDvyP7SSl8UFSE+Itzc4+D759FqyRc5KWNtrLKLadWVfNBYkG/EDDv4sNbxRmLIyZNA/jTIiImRYT6u9NProH4i4px7stmWQ1OK6f4zzIs/K0sb6pVQtlZwkDlw4v9Mbge1h8E7IXJXxcxOnzC6NGjJ0yYMiU0YlrocH8X+OTzKsh4FH9lwuCZRcz8Q+TDG26Vf8ubObOYukH5w5r+jwT9QEDR3/YtneLj5j1q4sRJaKF+fkDAcCdr/a1VlcXlecXE/zcMSmamnyIvZ62yfG34fvqy7NbDrdyPT9s4JyB+/74VIfDoFgr+jwz4+/v7+U0c4e7htPmnoqLiIoK/sjwgq4rOf3lPBsorjyfuB/TlZWVlD5/t5XqA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",
    "deepseek-young-sad.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAABAAECAAEEAAEHAQMKDTIMBAkMDz0OETgOE0QPFEkQEz4RF00RN6ISCBASF0gSGlMSNZcVF0EVHVcWESkXDRYXHU8XNHkXPq4YM3UYP6sbEx0bJWMcM3wdQ7QeFzIeJFYfKmofPoUgPIUhIUEhK10hM24hRaMjGCMjPIEjRo0kOIokPYckR5AlNn0lSpEmL3QmNl4nMnsnN4AnOHknR4snTZYoIDUoNH8oNX4oSrgpL20pNIApNoQpU5sqP38qR5QqWaUqY8ErKUwsN4IsVp4tN4QtOIAtOIIuISguVqMuW58uZbMvWqIvW6QwYasxUpMyQGozYqo0X781Mls1ULs1abE2Z7E4c7w5KzY5THQ5b785cLo8NEc9ecQ+W4A+ZKc+bMI+bbA/eMg/esFAdLlBecBBgdNCdsZEOGdEPk9GMThGUKZGjOBIWJhIf8RIgNJJY5pJi+BKk+lLfdlMhMlMletNR3JOis9Oit1OmO1QWb5QapBRbKNRd71RjsRRl+xSjM5Sk+lUdKpUkdhVSFZVjc5VnO5WNkdWVXxWgKFWi9NWl8xWnexXk+hXl+tXnetYkdFYmOVYodZZjtBZnupaoe9bfrRblu1cbs5ctehdaH1djeZel+Nfmu1fpOthv+1ihcxiqORklu1lq9VmdtlnQVZnU15nYcVnkcFoxvJqneFtdJNukqtvr+x0YZF1Tl91huJ2Ynt2kNN2lex3sd95u+h6jul7fpx7jrl9XWh+bqSBW26CncyGh7yJiN+JmtWJw+uLcneLrNGMVmeMet+Mk+uNboWQzu6Ti5eTkemUmdWWbX6Z1POaZXOezeegfdeigouj1/Glnaamj+qpY3ewd4m03PG2maC5jOi7f5G/q67AcIbDiZjDw9LKdozNd4/NubXOk6TTfpPUoajYgpfYsrLYx8Td3eLfmavf5ezh0tDmqbXqtrfq7vLrw77x0MbzvLzzy8P00Mf11831187208z21sr21sv2+fn628/73dX9/fv9/fsA/wBEn1BTAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztnQlYU9fW99/ne57LDUngMt4oNkoOk5WvSDhaTCCOgNqqKAhYKVbFKtqKCJEIqQMiFbGCGAR7cQAp17ZcRa8DRWtbo7YXa/E6VKWiODA4MphggMCTb+19EkSL3uHN2Xza/lNCSKiu9Ttrrb32Pvsc/8fwG9f/9LUBfa3fAfS1AX2t3wH0tQF9rd8B9LUBfa3fAfS1AX2t3wH0tQF9LUIAPsiYHTmTzF/1H4oIgG0nKy9cuFB58mMSf9l/KAIAZp1Ul5WWllUAg3L2/7b/VOwDmKUuK1CmKBTZZZWVF/ay/tf9p2IdwMyysrwULHlRRWXF3v/f0oB1ACfLcpVKI4GCisriIyPw27MiZ2csnx0fHx/5AdsWvFhsA9irzlQqEQEFPMlLT670HhUQEBmnylWmqTLzkAqKvtzGshEvEssAPqjIVSgZyRMS5NHeg12841R56enpscmZ8JyeCcorKN3bZ3HAMoDiUrlCAcdfGTtugLX1QMppeFRKulKZ3lOZ2ZnpeaV7+6hNYBdAhlqhVKQoUpTLBtjZ2Q20Ek6KTVgKSuj2fhNSZnZuZsHhvkkEdgEUF8Dxh//m2SE5COanx8ZCSsjlKYz7eXnpm1SqHWlQDXLz1H0yRrIK4OMy5L8S++8XbieIgx8gAZgMyMxMl88dl5wHRaBgowoTOMmmMc8RqwD2ZipAygQ7u/Bl46yFcekpqBwomeMPNTAm3NpuHHpdkLMlOy83ty8IsAlgJq6ACoXfgHnycXbC+ejgp6QnjJ2ewPgPgZ811zocvS4oXocIVJLPAjYBbMvDATA3PFYJx987D0d/su+76abxD0bAvFi/6VALcgsOr8vNyy29sodFe3oVmwC+VOIEmCtXLrS2E85DHVF67NSYvPQUFfI/l0Ggmr4Q8h8IbIGm6MKVWSwa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",
    "deepseek-young-sleep.apng":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAADAFBMVEUAAAAAAAAAAAAAAAABAAEBAi4CAAEEAAEECDMGAgQHAAEIC0AIDT4JCCMJDkYLDTMLE1ELFl0MAAUNAQENBQ8NF1YQBAYQCBkQEjkQF0gRHFsRH2USECYSImYSImcSM58THFATIWETJGoTOaoUAQ0UJGUUJmwUPbYUPr0VAQYVJmsVJ28VRskVSskVVtQWCA4WJngWKGwWKG8WKW4WStIXFCsXGDwXI1YXKXMXT9kXWNAXYdkYBxYYKmcYK3YYMIUYaN4ZKHoZKXsZL3oZOpoZTb8ZVN4aCyMaKn0aLX8aL3MaMogab+EbDxobNIwbN5MbR6wbW+McBA4cW8EcZOcdN48dTaEdbOkddusdf+0dhu8di/Adj/IeGDIeIUAeUrQfECkfPJgfkO8gLlsgM24gPpQgXLAgZaMiBxUiKEkia8AjNmEjPYUjlPAldMomCxomJjgmc64nSY4ngdUnnPEoTX4oj+MpME0ppPQqFyEqQXMqVZgsdqMvQmUvWIovntYvqfMxfLszYpwzjMkzsfUzuPY0TW40hK80vPQ1wvU2OFM2xPY3wfc4His7yfc8lb88u/I9nNw+qdtB0PlCKTREu+9FQE9FqONFyPdGX3xGqO1JaahKSVtMMDtOuOpPwfJRdpNSW5pVcqVaN0dcV3RjQ1BkUllqktZuXGVub4dvpcNwaIR0dH11jLp2SFh2sM16Zm96dJl9hbeBUGSBZWmCh8CEhZKHcXqNvNOOdHePkJqSW26UndSVzOqbh5ecg4ucn5+dpuWfnKyggIKlpqaoZHaqp7usioyvtOGzl5m4b4i4v+u6we+7xd6+wcK/xO7Co6XGeI/G1+TKvsLNr7DQjZXQ0OzUhajaxMTgtrXg5+/il6Hk2uLmhJbqgpTqrLHrjavuvr/vpq/vubrv0NHv2djv7/TwusDziZrzwsHzy8n0ysf10Mz10c721M721ND21ND21ND21NH21tL23934msP41tH41tP49/j50tL6+fn7+/r929b9/v39/v0A/wCIeBKWAAABAHRSTlP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AU/cHJQAAEABJREFUeJztvXlUU1f3/98/Pn5/PAsI4bPKI0kgJOEh8CWKARTiRISAJkYBsaCAisggs8ok1YpQsbVqbdVqbavt1zrUrvrpap26HPq01uJUB6BUBVGrdkWGAGtJiwzJym+fc+5NbhDbSm7g+ax2X8EQYjzv19l7n33OPffmBdNf3F4Y6QaMtP0NYKQbMNL2N4CRbsBI298ARroBI21/AxjpBoy0/Q1gpBsw0vY3gJFuwEjb3wBGugEjbX8DGOkGjLT9DWCkGzDS9jeAkW7ASNvfAEa6AaasKePGjZsyYv/9SAJYtjBt1eqlmQmZBUWVlSteXZXtMQKNGCkAcbNDpkZnJCSkZObkZKDvRaVlZVsrSxYOd0NGBkBWyFRNdLRWCaZRZsSjv5XRGSkFxVXvr1g5vE0ZCQBTeGHRWq0SH1ot+UYsPqWoomrdmuFszPADmBISpkV9T+unLVobDU4RnVFQXFE5jF4w7AA8/M3qByMADDIKyspeXTxc7RlmAFNEShz5mAGDg9JCID5am1BatW64nGB4Aczw0dL6iXol0U7r1yL98fCtoOL9kuFp0rACGB1MydcozDmAEQnQ/UpEAL5ySt+venVYqqPhBLA4jNbvo2H2PR0ByDT4e8L7YFUrZgxDo4YRgEcY7fxiFSP+lcwMkJqhQT6AAby/vnIYCAwfgBkKOvbFKBIY6i0ZQBtfkIc4xG+tejaBEzX1vzQ1/fgtO80aNgBxPrR+hfip/E9nwGht5oqI6Mic1Mwq4gOvPPU+vxqR9fT0GX9kpV3DBeD/iszpX6yxqgEs8Y8QpBaBCxQVRRZRBF4d8D4nsXodWP//LgATzKNfkD+d/1UDa6CEDBgAV0TEZBQXZJAgqKp6qi7+An271dejY6dhwwQgS0LSP/wJpbOevwUARaAoMzo6pWhmdHRm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"
    };
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
     * 这只宠物此刻该不该进化、进成哪一种（见 FORMS）。
     *
     * 门槛是**两道**：等级够 `evolveMinLevel`（正好是传说那一档），且有一门技能
     * 明显走在前面 —— 「明显」的意思是它是**唯一**的最高分，且到了
     * `evolveMinSkillLevel`。并列不算：四门都平（新养的宠物就是四门都 Lv.1）
     * 留在传说金鲸那一档，两门并列第一也一样等着，等哪一门先走一步再分化。
     * 靠 SKILLS 的顺序破平会让所有并列的人都变成代码猫 —— 那是在骗人。
     *
     * **一次定终身**：`pet.form` 一旦写上就不再动（二次进化是后面的事），所以
     * 这个函数第一句就把已经进化过的挡掉。
     * @param pet - 宠物状态（读 level / form）。
     * @param skills - 技能表。
     * @param config - 生效配置。
     * @returns FORMS 里的条目；还不够格 / 已经进化过则 null。
     */
    function evolveTargetOf(pet, skills, config) {
      if (!config.evolveEnabled) return null;
      if (typeof pet.form === "string" && pet.form !== "") return null;
      if (typeof pet.level !== "number" || pet.level < config.evolveMinLevel) return null;
      if (skills === null || typeof skills !== "object") return null;
      var best = null;
      var bestLevel = 0;
      var tied = false;
      for (var i = 0; i < SKILLS.length; i += 1) {
        var row = skills[SKILLS[i].key];
        var level = row === undefined ? 0 : row.level;
        if (level > bestLevel) {
          best = SKILLS[i];
          bestLevel = level;
          tied = false;
        } else if (level === bestLevel) tied = true;
      }
      if (best === null || tied) return null;
      if (bestLevel < config.evolveMinSkillLevel) return null;
      var form = FORM_BY_SKILL[best.key];
      return form === undefined ? null : form;
    }

    /**
     * 形态 key → 形态表里那一份。认不出来就 null。
     *
     * 走 `hasOwnProperty` 而不是直接取下标（和 `sanitizeIds` 同一个理由）：
     * 存档里塞一句 `form: "constructor"` 的话，直接取下标会摸到 Object 原型上的
     * 东西，然后当成一份长相去渲染。
     * @param key - 待查的 key，什么类型都可能（存档是外来数据）。
     * @returns FORMS 里的条目，或 null。
     */
    function formOf(key) {
      if (typeof key !== "string" || key === "") return null;
      if (!Object.prototype.hasOwnProperty.call(FORM_BY_KEY, key)) return null;
      return FORM_BY_KEY[key];
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
      // 进化和进阶不是一件事：进阶是长大，进化是「跟着你变成了这个样子」
      morph: ["我变成这样了！", "这就是我们走的路", "跟你学的", "从今天起我是这个样子"],
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

    /** 瞳孔与线稿的墨色：深蓝而不是纯黑，纯黑在二次元赛璐璐里显脏。 */
    var WHALE_INK = "#16224d";

    /** 轮廓描边：比主色深一档的蓝，二次元赛璐璐那种线稿感。 */
    var WHALE_LINE = "#2b3f9e";

    /** 传说档的描边与王冠：一对深浅金。 */
    var WHALE_GOLD_LINE = "#c08a1e";
    var WHALE_GOLD = "#f2c744";

    /**
     * 一份「长相」（art）：一个形态的整套几何。
     *
     * 全部是**纯数据**，不是攒好的 React 节点 —— 节点得由渲染方带 key 创建
     * （见 artNodes），常量区攒好的元素在测试里也不好读。零件描述统一写成
     * `{ t: 标签, p: 属性 }`，`p` 里写了什么就盖掉渲染方给的那一档默认值
     * （比如狐狸耳朵内侧要一层浅色，就自己写 fill）。
     *
     * 槽位与绘制序（`.dshpet-whale-body` 那一组之内，从下往上）：
     *
     *   tail   一枚尾部零件，挂 `.dshpet-whale-tail`（摆尾动画认这个类）
     *   limb   一枚肢体零件，挂 `.dshpet-whale-fin`（划水动画认这个类）
     *   ear    头上那一撮（耳朵 / 呆毛 / 触角），可为 null
     *   body   身体本体，按绘制序；后画的盖前面的（猫是「先屁股后头」）
     *   over   贴在身上的那几片（白肚皮、高光），props 自己写全
     *   extra  只有这一种形态才有的零件（胡须、白尾尖、喙、甲壳中缝）
     *   blush  腮红两枚的圆心
     *   eye    左右眼的圆心（瞳孔缩放走形态表的 eyeGrow）
     *   lid    睡着时那两道下弯的眼睑
     *   mouth  四张基础嘴：平时 / 星星眼那张 / 睡脸 / 饿脸与心情见底
     *   face   三维各自的脸（下面单独说）
     *
     * `face` 里每一维（`MOOD_DIMS` 的 key）各一套：
     *
     *   brow     左右两道眉毛的路径（顺序：左、右）。眉毛是只有情绪才长出来的
     *            部件，挂在**眼睛之外**的一层：眼睛那层在眨，眉毛跟着眨就成了抽搐。
     *   eyeGrow  在形态表的 eyeGrow 之上再乘一次：好奇瞪大、得意眯起。
     *   mouth    嘴型；filled 为 true 时嘴是实心的（张着的 o 型）。
     *   blush    腮红透明度（得意时最红）。
     */
    var WHALE_ART = {
      // 尾鳍与胸鳍在身体之下，免得盖住肚皮的高光。
      tail: {
        t: "path",
        p: {
          d: "M43 27C50 24.6 55 17.6 59.4 18.2 62.4 18.8 58.4 27 57.4 33"
            + "C58.4 39 62.4 47.2 59.4 47.8 55 48.4 50 41.4 43 39Z"
        }
      },
      limb: { t: "path", p: { d: "M17.4 44.5C13 48.6 14.2 54.8 20 52.8 23.8 51.4 25 47.4 24.2 44Z" } },
      ear: null,
      body: [{ t: "ellipse", p: { cx: 29, cy: 33, rx: 20, ry: 17 } }],
      over: [
        // 白肚皮：上沿是一条向上鼓的分界线，下沿沿着身体轮廓的弧走，
        // 这样它是「贴在身上的肚皮」而不是一个浮在身上的白椭圆。弧半径比
        // 身体小 0.7，免得盖掉身体下沿的那条描边。
        {
          t: "path",
          p: {
            d: "M10.3 37C16.8 33 41.2 33 47.7 37A19.3 16.3 0 0 1 10.3 37Z",
            fill: "url(#dshpet-whale-belly)"
          }
        },
        {
          t: "ellipse",
          p: {
            cx: 19.5, cy: 22.5, rx: 6.5, ry: 3.2, fill: "#ffffff",
            opacity: .3, transform: "rotate(-24 19.5 22.5)"
          }
        }
      ],
      extra: null,
      blush: [[14.6, 37.6], [43.4, 37.6]],
      eye: { l: [21.5, 29.5], r: [35, 29.5] },
      lid: [
        "M17.6 29.5C19.4 32.6 23.6 32.6 25.4 29.5",
        "M31.1 29.5C32.9 32.6 37.1 32.6 38.9 29.5"
      ],
      mouth: {
        calm: "M25.6 39.4C27.2 42.2 30.4 42.2 32 39.4",
        excited: "M25 39.4C26.6 43.4 30.4 43.4 32 39.4Z",
        // 睡脸：一条短横，谈不上什么表情。
        asleep: "M26.4 40.4C27.6 40.4 30 40.4 31.2 40.4",
        // 饿脸：把嘴的弧翻过来——控制点抬到端点上方，于是向上鼓成撇嘴。
        // 心情见底也是这张脸：都是「过得不太好」。
        low: "M25.6 41.6C27.2 38.8 30.4 38.8 32 41.6"
      },
      // 喷水柱：只在头顶那一小块，靠动画循环冒出来。幼崽还不会喷，
      // 传说档的喷水口被王冠占了（见 WHALE_STAGES 的注释）。
      spout: [
        {
          t: "path",
          p: {
            d: "M20 17C18.8 13.6 21.4 11.6 20.2 8.6",
            fill: "none", stroke: "#bcd2ff", strokeWidth: 1.6, strokeLinecap: "round"
          }
        },
        { t: "circle", p: { cx: 20.4, cy: 6.6, r: 1.7, fill: "#dbe6ff" } },
        { t: "circle", p: { cx: 16.4, cy: 9.4, r: 1.2, fill: "#dbe6ff", opacity: .85 } },
        { t: "circle", p: { cx: 24.2, cy: 9, r: 1, fill: "#dbe6ff", opacity: .7 } }
      ],
      // 背鳍：成年才长出来，个头要够大才认得出（占了半个身高）。和尾鳍一样
      // 画在身体之前，根部被身体盖住，看起来才像从背上长出来的。
      dorsal: { t: "path", p: { d: "M27 20.5C29.6 13.2 32.4 8 35.2 4.4 38.2 10 40.2 15.4 40.6 21Z" } },
      // 王冠：传说档才有，画在眼睛 / 嘴之后压在最上层。底边贴着头顶弧线，
      // 位置正好是喷水口 —— 所以这一档不喷水。
      crown: {
        t: "path",
        p: {
          d: "M12.4 18.4 13.4 7.2 18.2 12.6 20.2 3.6 22.2 12.6 27 7.2 28 18.4Z",
          fill: WHALE_GOLD, stroke: WHALE_GOLD_LINE, strokeWidth: 1.2, strokeLinejoin: "round"
        }
      },
      face: {
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
      }
    };

    /**
     * 四种进化形态的配色。抽出来单独放是因为 `extra` 里那几件零件（狐狸的白
     * 尾尖、鸟的喙、虫背上的两点）得自己写颜色，在同一个对象字面量里引用不到
     * 自己的 skin。
     */
    var FORM_SKIN = {
      // 猫承着鲸鱼的蓝：一眼看得出是同一只变的。
      cat: ["#b7c4ff", "#7b8cf0", "#4b58c4"],
      fox: ["#ffcf9e", "#f9944a", "#d4691f"],
      bird: ["#c3e6ff", "#7cc0f2", "#3f8ed2"],
      bug: ["#d6ef9a", "#9ccd52", "#6a9a28"]
    };

    /** 四种形态的描边色：各自比 skin[2] 再深一档，赛璐璐线稿感照旧。 */
    var FORM_LINE = {
      cat: "#39429b",
      fox: "#a94f14",
      bird: "#2a6aa8",
      bug: "#4d7318"
    };

    /**
     * 进化形态表：养到头之后按「你主要在干什么」分化成的四种样子。
     *
     * 顺序与 `SKILLS` 对齐（编码 / 探索 / 调试 / 表达 → 猫 / 狐 / 虫 / 鸟）。
     * 和 `WHALE_STAGES` 一样放在常量区、一样不许进 `DEFAULTS`：`resolveConfig`
     * 只接受同类型标量覆盖，表格塞进去会被整份丢掉。
     *
     * 四种**各写一整套五官**（眼位 / 嘴形 / 三维的眉毛与嘴 / 睡脸 / 饿脸都不
     * 共用坐标）—— 分化到这一步才像是四种生物，而不是四张换了色的鲸鱼皮。
     *   key    也是卡片上 data-stage 的值
     *   skill  哪一门技能领先就长成这样（SKILLS 的 key）
     *   icon   变身特效飞进来的那个图标
     *   size   头像边长：62，卡在成年（54）与传说（64）之间 —— 进化档是终点，
     *          得比成年显眼，但别比戴王冠的传说档还大
     */
    var FORMS = [
      {
        key: "cat", skill: "coding", label: "代码猫", icon: "🐱",
        size: 62, skin: FORM_SKIN.cat, line: FORM_LINE.cat, eyeGrow: .95,
        art: {
          // 竖起来打了个钩的尾巴：猫的心情全写在这上面。
          tail: {
            t: "path",
            p: {
              d: "M43.4 50.6C50.6 51.6 55.4 45.2 54.2 38.2"
                + "C53.6 34.6 49.4 35 49.8 38.4C50.4 43.2 47.4 46.8 42.4 45.8Z"
            }
          },
          // 蹲坐时并在身前的两只前爪。
          limb: {
            t: "path",
            p: {
              d: "M23.6 53.6C23.6 50.4 29.4 50.4 29.4 53.6C29.4 56.4 23.6 56.4 23.6 53.6Z"
                + "M34.6 53.6C34.6 50.4 40.4 50.4 40.4 53.6C40.4 56.4 34.6 56.4 34.6 53.6Z"
            }
          },
          ear: [
            { t: "path", p: { d: "M17.6 20.4 16.4 5.6 30.4 13.6Z" } },
            { t: "path", p: { d: "M46.4 20.4 47.6 5.6 33.6 13.6Z" } },
            // 耳朵内侧那层粉：不画的话三角形看着像两片纸。
            { t: "path", p: { d: "M20 18.6 19.2 9.8 27 14.4Z", fill: "#f7c6d9", strokeWidth: .8 } },
            { t: "path", p: { d: "M44 18.6 44.8 9.8 37 14.4Z", fill: "#f7c6d9", strokeWidth: .8 } }
          ],
          // 先屁股后头：后画的头盖住蹲坐的身子，才是「坐着」而不是「摆着」。
          body: [
            { t: "ellipse", p: { cx: 32, cy: 46, rx: 13, ry: 11 } },
            { t: "ellipse", p: { cx: 32, cy: 28, rx: 16, ry: 14 } }
          ],
          over: [
            {
              t: "path",
              p: {
                d: "M21.4 45.6C25.6 41.6 38.4 41.6 42.6 45.6A13 11 0 0 1 21.4 45.6Z",
                fill: "url(#dshpet-whale-belly)"
              }
            },
            {
              t: "ellipse",
              p: {
                cx: 24, cy: 19.6, rx: 6.2, ry: 3, fill: "#ffffff",
                opacity: .3, transform: "rotate(-24 24 19.6)"
              }
            }
          ],
          extra: [
            { t: "path", p: { d: "M30.6 34.6H33.4L32 36.4Z", fill: WHALE_INK } },
            {
              t: "path",
              p: {
                d: "M14.6 32.4 22 34.2M14.8 37 22.2 36.8M49.4 32.4 42 34.2M49.2 37 41.8 36.8",
                fill: "none", stroke: WHALE_INK, strokeWidth: 1, strokeLinecap: "round", opacity: .55
              }
            }
          ],
          blush: [[20.6, 34.2], [43.4, 34.2]],
          eye: { l: [25, 28], r: [39, 28] },
          lid: [
            "M21.4 28C23.4 31.2 27.4 31.2 29.4 28",
            "M34.6 28C36.6 31.2 40.6 31.2 42.6 28"
          ],
          mouth: {
            // ω 形的猫嘴，接在鼻头下面。
            calm: "M28.2 37.2C29.6 39.6 32 39.6 32 37.6C32 39.6 34.4 39.6 35.8 37.2",
            excited: "M27.8 36.8C29.8 41.8 34.2 41.8 36.2 36.8Z",
            asleep: "M29.4 38C30.6 38 33.4 38 34.6 38",
            low: "M28.6 39.4C30.2 36.6 33.8 36.6 35.4 39.4"
          },
          face: {
            curiosity: {
              brow: [
                "M20.6 21.4C22.6 19 27.4 19 29.4 20.8",
                "M34.8 22.2C36.8 21.2 41.4 21.2 43.4 22.2"
              ],
              eyeGrow: 1.12,
              mouth: "M30 37.4C30 40 34 40 34 37.4C34 35.2 30 35.2 30 37.4Z",
              filled: true,
              blush: .5
            },
            pride: {
              brow: [
                "M20.6 20.8C22.6 22.4 27.4 23 29.4 22.4",
                "M34.8 22.4C36.8 23 41.4 22.4 43.4 20.8"
              ],
              eyeGrow: .86,
              mouth: "M27.8 37.2C29.8 40.8 34.2 40.2 35.8 36.8",
              filled: false,
              blush: .68
            },
            concern: {
              brow: [
                "M20.8 22.8C22.8 20.8 27.2 20 29.2 20.6",
                "M35 20.6C37 20 41.2 20.8 43.2 22.8"
              ],
              eyeGrow: 1.04,
              mouth: "M28.4 40C29.4 38 30.8 41 31.8 39C32.8 37 34.2 40 35.2 38.2",
              filled: false,
              blush: .34
            }
          }
        }
      },
      {
        key: "fox", skill: "research", label: "探索狐", icon: "🦊",
        size: 62, skin: FORM_SKIN.fox, line: FORM_LINE.fox, eyeGrow: .95,
        art: {
          // 比身体还粗的大尾巴，尾尖那撮白在 extra 里。
          tail: {
            t: "path",
            p: {
              d: "M41.6 48.6C51.6 50.6 59.4 42 57.4 33"
                + "C56 26.6 49.4 26 46.6 31C43.8 36 45.8 43 39.8 43Z"
            }
          },
          limb: {
            t: "path",
            p: {
              d: "M24.6 51.4C24.6 48.6 28.2 48.6 28.2 51.4L28.2 56.6C28.2 58.2 24.6 58.2 24.6 56.6Z"
                + "M35.8 51.4C35.8 48.6 39.4 48.6 39.4 51.4L39.4 56.6C39.4 58.2 35.8 58.2 35.8 56.6Z"
            }
          },
          // 狐狸的耳朵要大得夸张，那是它的招牌。
          ear: [
            { t: "path", p: { d: "M17.4 21.6 12.6 4 30.2 14.6Z" } },
            { t: "path", p: { d: "M46.6 21.6 51.4 4 33.8 14.6Z" } },
            { t: "path", p: { d: "M19.8 19.4 16.6 8.6 27.4 15.4Z", fill: "#ffe0c2", strokeWidth: .8 } },
            { t: "path", p: { d: "M44.2 19.4 47.4 8.6 36.6 15.4Z", fill: "#ffe0c2", strokeWidth: .8 } }
          ],
          body: [
            { t: "ellipse", p: { cx: 32, cy: 47, rx: 13, ry: 10 } },
            { t: "ellipse", p: { cx: 32, cy: 27, rx: 15, ry: 13 } }
          ],
          over: [
            {
              t: "path",
              p: {
                // 白吻 + 白胸：狐狸的白是从下巴一路淌到胸口的。
                d: "M25.4 32.6C28.4 41.6 35.6 41.6 38.6 32.6Z"
                  + "M22 46.6C26 42.8 38 42.8 42 46.6A13 10 0 0 1 22 46.6Z",
                fill: "url(#dshpet-whale-belly)"
              }
            },
            {
              t: "ellipse",
              p: {
                cx: 24, cy: 19, rx: 6, ry: 3, fill: "#ffffff",
                opacity: .3, transform: "rotate(-24 24 19)"
              }
            }
          ],
          extra: [
            {
              t: "path",
              p: {
                d: "M56.2 30C59.4 32.8 59.6 39.8 56 44.2C53.4 40.4 53.4 33.8 56.2 30Z",
                fill: "#fff6ec", stroke: FORM_LINE.fox, strokeWidth: 1
              }
            },
            { t: "path", p: { d: "M30.7 33.8H33.3L32 35.8Z", fill: WHALE_INK } }
          ],
          blush: [[19.8, 32.6], [44.2, 32.6]],
          eye: { l: [25.4, 27], r: [38.6, 27] },
          lid: [
            "M21.8 27C23.8 30.2 27 30.2 29 27",
            "M35 27C37 30.2 40.2 30.2 42.2 27"
          ],
          mouth: {
            calm: "M29.2 37.8C30.6 40 33.4 40 34.8 37.8",
            excited: "M28.8 37.2C30.8 41.8 33.2 41.8 35.2 37.2Z",
            asleep: "M30.4 38.6C31.4 38.6 32.6 38.6 33.6 38.6",
            low: "M29.2 39.8C30.6 37.4 33.4 37.4 34.8 39.8"
          },
          face: {
            curiosity: {
              brow: [
                "M20.6 20.4C22.6 18 27.2 18 29.2 19.8",
                "M34.8 21.2C36.8 20.2 41.4 20.2 43.4 21.2"
              ],
              eyeGrow: 1.12,
              mouth: "M30 38C30 40.6 34 40.6 34 38C34 35.8 30 35.8 30 38Z",
              filled: true,
              blush: .5
            },
            pride: {
              brow: [
                "M20.6 19.8C22.6 21.4 27.2 22 29.2 21.4",
                "M34.8 21.4C36.8 22 41.4 21.4 43.4 19.8"
              ],
              eyeGrow: .86,
              mouth: "M28.6 38C30.6 41.6 34 41 35.6 37.6",
              filled: false,
              blush: .68
            },
            concern: {
              brow: [
                "M20.8 21.8C22.8 19.8 27 19 29 19.6",
                "M35 19.6C37 19 41.2 19.8 43.2 21.8"
              ],
              eyeGrow: 1.04,
              mouth: "M29 40.6C30 38.6 31.2 41.6 32.2 39.6C33.2 37.6 34.4 40.6 35.4 38.8",
              filled: false,
              blush: .34
            }
          }
        }
      },
      {
        key: "bug", skill: "debug", label: "调试虫", icon: "🪲",
        size: 62, skin: FORM_SKIN.bug, line: FORM_LINE.bug, eyeGrow: .82,
        art: {
          // 尾节：从甲壳下面露出来的那一小截。
          tail: { t: "path", p: { d: "M26.4 47.6C28.8 52.6 35.2 52.6 37.6 47.6Z" } },
          // 三节腿，两侧各一条从甲壳下面伸出来。
          limb: {
            t: "path",
            p: {
              d: "M16.6 33.4C11.8 33.2 8.8 37.2 7.8 42 10.8 40.2 12.8 38.2 17.2 38Z"
                + "M47.4 33.4C52.2 33.2 55.2 37.2 56.2 42 53.2 40.2 51.2 38.2 46.8 38Z"
            }
          },
          ear: [
            {
              t: "path",
              p: {
                d: "M25.6 15.4C23.4 10.4 20.4 8.2 17.8 7.2",
                fill: "none", strokeWidth: 1.5, strokeLinecap: "round"
              }
            },
            {
              t: "path",
              p: {
                d: "M38.4 15.4C40.6 10.4 43.6 8.2 46.2 7.2",
                fill: "none", strokeWidth: 1.5, strokeLinecap: "round"
              }
            },
            { t: "circle", p: { cx: 16.6, cy: 6.2, r: 2 } },
            { t: "circle", p: { cx: 47.4, cy: 6.2, r: 2 } }
          ],
          body: [
            { t: "ellipse", p: { cx: 32, cy: 37, rx: 16, ry: 14 } },
            { t: "ellipse", p: { cx: 32, cy: 22, rx: 11, ry: 8.5 } }
          ],
          over: [
            {
              t: "path",
              p: {
                d: "M18.4 41C23 37 41 37 45.6 41A15.4 13.4 0 0 1 18.4 41Z",
                fill: "url(#dshpet-whale-belly)"
              }
            },
            {
              t: "ellipse",
              p: {
                cx: 23.6, cy: 29.6, rx: 5.6, ry: 2.8, fill: "#ffffff",
                opacity: .3, transform: "rotate(-24 23.6 29.6)"
              }
            }
          ],
          extra: [
            {
              t: "path",
              p: {
                d: "M32 24.6C32 31 32 40 32 50.4",
                fill: "none", stroke: FORM_LINE.bug, strokeWidth: 1.4
              }
            },
            { t: "circle", p: { cx: 23, cy: 33.4, r: 2.8, fill: FORM_LINE.bug, opacity: .5 } },
            { t: "circle", p: { cx: 41, cy: 33.4, r: 2.8, fill: FORM_LINE.bug, opacity: .5 } }
          ],
          blush: [[24.2, 25.6], [39.8, 25.6]],
          eye: { l: [27.4, 22], r: [36.6, 22] },
          lid: [
            "M25.2 22C26.2 24.2 28.6 24.2 29.6 22",
            "M34.4 22C35.4 24.2 37.8 24.2 38.8 22"
          ],
          mouth: {
            calm: "M29.6 26.6C30.8 28.4 33.2 28.4 34.4 26.6",
            excited: "M29.2 26.2C30.8 30 33.2 30 34.8 26.2Z",
            asleep: "M30.4 27.4C31.4 27.4 32.6 27.4 33.6 27.4",
            low: "M29.6 28.2C30.8 26.4 33.2 26.4 34.4 28.2"
          },
          face: {
            // 眉毛短得多：脑袋只有 22 宽，画长了就顶到触角根上去了。
            curiosity: {
              brow: [
                "M23.8 16.4C25 14.8 28.6 14.8 29.8 16",
                "M34.2 17C35.4 16.4 39 16.4 40.2 17"
              ],
              eyeGrow: 1.12,
              mouth: "M30 27C30 29 33.8 29 33.8 27C33.8 25.2 30 25.2 30 27Z",
              filled: true,
              blush: .5
            },
            pride: {
              brow: [
                "M23.8 15.8C25 17.2 28.6 17.6 29.8 17.2",
                "M34.2 17.2C35.4 17.6 39 17.2 40.2 15.8"
              ],
              eyeGrow: .86,
              mouth: "M29.2 26.8C30.6 29.6 33.8 29 34.8 26.2",
              filled: false,
              blush: .68
            },
            concern: {
              brow: [
                "M24 17.4C25.2 15.8 28.4 15.2 29.6 15.8",
                "M34.4 15.8C35.6 15.2 38.8 15.8 40 17.4"
              ],
              eyeGrow: 1.04,
              mouth: "M29.6 28.4C30.4 26.8 31.4 29.2 32.2 27.6C33 26 34 28.4 34.8 27",
              filled: false,
              blush: .34
            }
          }
        }
      },
      {
        key: "bird", skill: "writing", label: "文鸟", icon: "🐦",
        size: 62, skin: FORM_SKIN.bird, line: FORM_LINE.bird, eyeGrow: 1.02,
        art: {
          // 两片尾羽。
          tail: {
            t: "path",
            p: {
              d: "M40.6 43.4C47.6 42.4 53 44.8 57.8 48.2 52 49.2 45.8 48.6 40.6 47Z"
                + "M40.6 46.4C46.8 46.4 51.8 48.6 56.2 51.8 50.4 51.8 44.6 50.8 39.8 49.4Z"
            }
          },
          // 身后那只翅膀（画在身体之下，只露半边）；身前那只在 extra 里。
          limb: {
            t: "path",
            p: { d: "M19.4 29.6C14.8 33.8 14.2 43 18.4 47.8 21.6 44 22.2 34.8 21 29.6Z" }
          },
          // 头顶那撮呆毛。
          ear: [
            { t: "path", p: { d: "M27.4 19.6C28 13.4 30 9.6 32.6 7.2 31.8 12.2 33 15.2 34.4 18.6Z" } }
          ],
          // 团子鸟：头和身子是同一个蛋形，不分段。
          body: [{ t: "ellipse", p: { cx: 31, cy: 34, rx: 15, ry: 16 } }],
          over: [
            {
              t: "path",
              p: {
                d: "M17.2 38.4C21.6 34.4 40.4 34.4 44.8 38.4A15 16 0 0 1 17.2 38.4Z",
                fill: "url(#dshpet-whale-belly)"
              }
            },
            {
              t: "ellipse",
              p: {
                cx: 23, cy: 25, rx: 6, ry: 3, fill: "#ffffff",
                opacity: .3, transform: "rotate(-24 23 25)"
              }
            }
          ],
          extra: [
            {
              t: "path",
              p: {
                d: "M41 30.6C46.6 33 47.6 42.6 42.4 46.4 39.6 42.8 39.4 35.4 41 30.6Z",
                fill: FORM_SKIN.bird[2], stroke: FORM_LINE.bird, strokeWidth: 1.1
              }
            },
            // 喙：嘴画在它上面，一张一合就是在说话。
            {
              t: "path",
              p: {
                d: "M27.8 33.4H35.2L31.5 39.8Z",
                fill: "#ffc95c", stroke: FORM_LINE.bird, strokeWidth: 1
              }
            }
          ],
          blush: [[20.4, 33.4], [42.6, 33.4]],
          eye: { l: [25.2, 28], r: [37.8, 28] },
          lid: [
            "M21.4 28C23.2 30.8 27.2 30.8 29 28",
            "M34 28C35.8 30.8 39.8 30.8 41.6 28"
          ],
          mouth: {
            // 平时是喙上那道缝，激动起来就张开。
            calm: "M28.6 35.4C30.2 35.4 32.8 35.4 34.4 35.4",
            excited: "M28.4 35C30 38.6 33 38.6 34.6 35Z",
            asleep: "M29.6 35.6C30.6 35.6 32.4 35.6 33.4 35.6",
            low: "M28.8 36.6C30.4 34.2 32.6 34.2 34.2 36.6"
          },
          face: {
            curiosity: {
              brow: [
                "M20.4 21.6C22.2 19.2 28 19.2 29.8 21",
                "M33.4 22.4C35.2 21.4 40.4 21.4 42.2 22.4"
              ],
              eyeGrow: 1.12,
              mouth: "M29.4 36C29.4 38.4 33.6 38.4 33.6 36C33.6 33.8 29.4 33.8 29.4 36Z",
              filled: true,
              blush: .5
            },
            pride: {
              brow: [
                "M20.4 21C22.2 22.6 28 23.2 29.8 22.6",
                "M33.4 22.6C35.2 23.2 40.4 22.6 42.2 21"
              ],
              eyeGrow: .86,
              mouth: "M28.4 35.6C30.4 38.6 34 38 35.2 35",
              filled: false,
              blush: .68
            },
            concern: {
              brow: [
                "M20.6 23C22.4 21 27.8 20.2 29.6 20.8",
                "M33.6 20.8C35.4 20.2 40.2 21 42 23"
              ],
              eyeGrow: 1.04,
              mouth: "M28.8 37C29.8 35 31 38 32 36C33 34 34.2 37 35.2 35.2",
              filled: false,
              blush: .34
            }
          }
        }
      }
    ];

    /** 形态 key → 形态。存档里的 form 靠它过白名单。 */
    var FORM_BY_KEY = {};
    /** 技能 key → 形态。主技能靠它换长相。 */
    var FORM_BY_SKILL = {};
    for (var fi = 0; fi < FORMS.length; fi += 1) {
      FORM_BY_KEY[FORMS[fi].key] = FORMS[fi];
      FORM_BY_SKILL[FORMS[fi].skill] = FORMS[fi];
    }

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
      /* APNG 单帧 + CSS keyframes 平滑浮动（之前用 APNG 多帧离散切换，会「跳」）。 */
      ".dshpet-avatar-stack{position:relative;display:inline-block;line-height:0}",
      ".dshpet-whale-sprite{display:block;pointer-events:none;user-select:none}",
      /* 立绘为主 + 收纳面板（新 UI）：默认只见宠物，其余信息收进 popover */
      ".dshpet-card{padding:6px;border-radius:18px}",
      ".dshpet-card .dshpet-whale-sprite{width:96px!important;height:96px!important;border-radius:14px}",
      ".dshpet-card .dshpet-whale-sprite-bob{animation:dshpet-whale-bob 3.2s ease-in-out infinite}",
      "@keyframes dshpet-whale-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}",
      ".dshpet-menu-btn{position:absolute;top:6px;right:6px;width:22px;height:22px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.05);color:#cfd3dc;font-size:12px;line-height:1;cursor:pointer;z-index:3;opacity:.65}",
      ".dshpet-menu-btn:hover{opacity:1;background:rgba(255,255,255,.12)}",
      ".dshpet-card[data-detail-open=true] .dshpet-menu-btn{opacity:1;background:rgba(242,199,68,.22);border-color:rgba(242,199,68,.85);color:#F2C744}",
      ".dshpet-popover{position:absolute;top:calc(100% + 10px);right:0;display:none;flex-direction:column;gap:10px;min-width:232px;padding:14px;border-radius:14px;background:var(--dsw-alias-bg-layer-2,rgba(20,20,26,.97));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.45));z-index:8}",
      ".dshpet-card[data-detail-open=true] .dshpet-popover{display:flex}",
      ".dshpet-sprite-eat,.dshpet-sprite-pat{position:absolute;left:0;top:0;display:none}",
      ".dshpet-eating .dshpet-sprite-eat,.dshpet-patted .dshpet-sprite-pat{display:block}",
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
      /* 变身时整只宠物自己的缩放（白光和光环在 .dshpet-morph 那层）。
         和上面两条同一个道理：一个元素一个 transform，所以三选一。 */
      ".dshpet-morphing{animation:dshpet-morph-pop 1600ms ease-out}",
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
      /* 分化那一刻的变身：一层白光把旧形态糊掉，光环同时扩散出去，白光退下来
         的时候露出来的已经是新形态了（React 早就把新 art 渲染进去了，这层白光
         只是替换的遮羞布）。和 .dshpet-evolve 一样是 both，收在透明态。 */
      ".dshpet-morph{position:absolute;inset:-16px;border-radius:50%;pointer-events:none;",
      "border:2px solid rgba(255,255,255,.9);",
      "background:radial-gradient(circle,rgba(255,255,255,.95),rgba(255,255,255,0) 72%);",
      "animation:dshpet-morph 1600ms ease-out both}",

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
      /* 变身的白光 + 光环：25% 之前白到看不见旧形态，50% 白光退干净（这时候
         露出来的已经是新形态），之后光环自己散出去。 */
      "@keyframes dshpet-morph{",
      "0%{transform:scale(.85);opacity:1}",
      "25%{transform:scale(1.15);opacity:1}",
      "50%{transform:scale(1.25);opacity:.55}",
      "100%{transform:scale(1.7);opacity:0}}",
      /* 宠物本体：缩一下、涨过头、落回原大小。和白光同一条时间轴。 */
      "@keyframes dshpet-morph-pop{",
      "0%{transform:scale(.85)}",
      "25%{transform:scale(1.15)}",
      "50%,100%{transform:scale(1)}}",
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
      ".dshpet-morph,.dshpet-morphing,",
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
      /* 反过来：变身那层白光只在动画里才该出现，animation:none 之后它会一直
         糊在头像上（直到特效超时），所以直接按透明处理 —— 少一段动效，
         不是少一只宠物。 */
      ".dshpet-morph{opacity:0}",
      /* 眼睛也别跟着鼠标飘（listener 本来就不挂，这条兜住已经写进去的值）。 */
      ".dshpet-whale-pupil{transform:none;transition:none}",
      ".dshpet-zzz{animation:none;opacity:1}}",

      /* ─── 多宠物 UI ─── */
      ".dshpet-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;",
      "background:rgba(255,255,255,.7);border:none;border-radius:50%;width:18px;height:18px;",
      "font-size:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;",
      "opacity:.5;transition:opacity .2s}",
      ".dshpet-nav:hover{opacity:1}",
      ".dshpet-nav-left{left:2px}",
      ".dshpet-nav-right{right:2px}",
      ".dshpet-fav{background:none;border:none;cursor:pointer;font-size:12px;margin-left:4px;",
      "color:#ccc;vertical-align:middle;padding:0 2px}",
      ".dshpet-fav[data-active]{color:#f5a623}",
      ".dshpet-dots{display:flex;justify-content:center;gap:3px;margin:2px 0}",
      ".dshpet-dot{width:5px;height:5px;border-radius:50%;background:#d0d0d8;display:inline-block}",
      ".dshpet-dot-active{background:#4d6bfe}",
      ".dshpet-dot-more{font-size:9px;color:#a9a9b2;line-height:5px}",
      ".dshpet-egg-btn{background:none;border:none;cursor:pointer;font-size:14px;position:relative;",
      "padding:2px 6px;border-radius:6px;transition:background .15s}",
      ".dshpet-egg-btn:hover{background:rgba(77,107,254,.08)}",
      ".dshpet-egg-btn[data-open]{background:rgba(77,107,254,.12)}",
      ".dshpet-egg-count{position:absolute;top:-2px;right:0;font-size:9px;",
      "background:#4d6bfe;color:#fff;border-radius:8px;padding:0 3px;min-width:12px;",
      "text-align:center;line-height:14px}",
      ".dshpet-egg-panel{position:absolute;bottom:100%;right:0;margin-bottom:6px;",
      "background:#fff;border-radius:10px;padding:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);",
      "min-width:180px;max-width:260px;z-index:10}",
      ".dshpet-egg-panel-title{font-size:12px;font-weight:600;margin-bottom:8px}",
      ".dshpet-egg-grid{display:flex;flex-wrap:wrap;gap:8px}",
      ".dshpet-egg-item{width:48px;height:56px;border:none;border-radius:8px;cursor:pointer;",
      "display:flex;flex-direction:column;align-items:center;justify-content:center;",
      "font-size:20px;transition:transform .15s}",
      ".dshpet-egg-item:hover{transform:scale(1.1)}",
      ".dshpet-egg-label{font-size:9px;color:#666;margin-top:2px}",
      ".dshpet-egg-close{position:absolute;top:6px;right:8px;background:none;border:none;",
      "font-size:14px;cursor:pointer;color:#999}",
      ".dshpet-hatch-overlay{position:absolute;inset:0;z-index:20;",
      "display:flex;align-items:center;justify-content:center;",
      "background:rgba(0,0,0,.3);border-radius:10px}",
      ".dshpet-hatch-dialog{background:#fff;border-radius:12px;padding:16px;text-align:center;",
      "min-width:180px;box-shadow:0 8px 24px rgba(0,0,0,.15)}",
      ".dshpet-hatch-title{font-size:13px;font-weight:600;margin-bottom:8px}",
      ".dshpet-hatch-preview{font-size:36px;margin:8px 0}",
      ".dshpet-hatch-species{font-size:11px;color:#666;margin-bottom:8px}",
      ".dshpet-hatch-input{width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:6px;",
      "padding:6px 8px;font-size:12px;outline:none;margin-bottom:10px}",
      ".dshpet-hatch-input:focus{border-color:#4d6bfe}",
      ".dshpet-hatch-actions{display:flex;gap:8px;justify-content:center}",
      ".dshpet-hatch-confirm{background:#4d6bfe;color:#fff;border:none;border-radius:6px;",
      "padding:6px 14px;font-size:12px;cursor:pointer}",
      ".dshpet-hatch-confirm:hover{background:#2740c9}",
      ".dshpet-hatch-cancel{background:#f0f0f3;color:#666;border:none;border-radius:6px;",
      "padding:6px 14px;font-size:12px;cursor:pointer}",
      ".dshpet-hatch-cancel:hover{background:#e0e0e6}",
      ".dshpet-add-btn{background:none;border:1px solid #d0d0d8;cursor:pointer;font-size:14px;",
      "width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;",
      "color:#666;transition:all .15s;font-weight:600;line-height:1}",
      ".dshpet-add-btn:hover{border-color:#4d6bfe;color:#4d6bfe;background:rgba(77,107,254,.06)}",
      ".dshpet-addpet-grid{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;justify-content:center}",
      ".dshpet-addpet-species{border:1.5px solid #e0e0e6;border-radius:8px;padding:6px 8px;",
      "background:#fafafa;cursor:pointer;display:flex;flex-direction:column;align-items:center;",
      "gap:2px;transition:all .15s;min-width:48px}",
      ".dshpet-addpet-species:hover{border-color:#4d6bfe;background:#f0f4ff}",
      ".dshpet-addpet-species[data-selected]{border-color:#4d6bfe;background:#eef2ff;box-shadow:0 0 0 2px rgba(77,107,254,.2)}",
      ".dshpet-addpet-icon{font-size:20px}",
      ".dshpet-addpet-label{font-size:9px;color:#666}"
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
        level: 1,
        // 进化形态（FORMS 的 key）。"" = 还没分化，长相按等级走 WHALE_STAGES。
        form: ""
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
        // 形态是进度而不是外观配置：它是「你把它养成了什么」，不跟 config 走。
        // 存档来路都过了 sanitizeSaved（白名单 + 兜底 ""），这里直接收下。
        pet.form = saved.form;
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
        level: pet.level,
        // 同上：形态不带过来的话，进化过的宠物会在下一口饭上变回鲸鱼。
        form: pet.form
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
      if (parsed.v !== 1 && parsed.v !== 2) return null;
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
          exp: numberIn(pet.exp, 0, level * EXP_PER_LEVEL, 0),
          // 进化形态过白名单（和 sanitizeIds 同一路数）：存档里塞个不认识的
          // 形态名 / 数字 / null，就当它没进化 —— 长相表查不到会渲染成空白。
          form: formOf(pet.form) === null ? "" : pet.form
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
            concern: pet.concern,
            // 形态是进度：养成什么样，刷新之后还得是那样。
            form: pet.form
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

    // ─── 多宠物数据层 ──────────────────────────────────────────────

    function generatePetId() {
      return "pet-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    }

    function createFreshPetRecord(speciesKey, name, id) {
      var sp = PET_SPECIES[speciesKey] || PET_SPECIES.whale;
      return {
        id: id,
        species: speciesKey,
        name: name || sp.name,
        avatar: sp.avatar,
        icon: sp.icon,
        bornAt: Date.now(),
        pet: { hunger: 60, mood: 80, energy: 75, curiosity: 0, pride: 0, concern: 0, exp: 0, level: 1, form: "" },
        totalFeeds: 0,
        totalTokens: 0,
        tokensBySource: { user_input: 0, generation: 0, tool_result: 0 },
        snacks: 5,
        achievements: [],
        daily: { day: dayIndexOf(Date.now()), feeds: 0, tools: 0, bestCombo: 0, done: [] },
        streakDay: 0,
        streakCount: 0,
        pats: 0,
        pos: { dx: 0, dy: 0 },
        lastFeedAt: 0,
        skills: { coding: { xp: 0, level: 0 }, research: { xp: 0, level: 0 }, debug: { xp: 0, level: 0 }, writing: { xp: 0, level: 0 } },
        memory: { files: [], tools: [], hours: new Array(24).fill(0), bornDay: dayIndexOf(Date.now()), errors: 0, recoveries: 0 }
      };
    }

    function computePetOrder(collection, favorites) {
      var ids = Object.keys(collection);
      var favSet = {};
      for (var i = 0; i < favorites.length; i++) favSet[favorites[i]] = i;
      ids.sort(function (a, b) {
        var aFav = favSet[a] !== undefined;
        var bFav = favSet[b] !== undefined;
        if (aFav && !bFav) return -1;
        if (!aFav && bFav) return 1;
        if (aFav && bFav) return favSet[a] - favSet[b];
        return (collection[a].bornAt || 0) - (collection[b].bornAt || 0);
      });
      return ids;
    }

    function resolveEggSpecies(eggType) {
      var et = EGG_TYPE_BY_KEY[eggType];
      if (!et) return "whale";
      if (et.species === "random") {
        var keys = Object.keys(PET_SPECIES);
        return keys[Math.floor(Math.random() * keys.length)];
      }
      return et.species;
    }

    function sanitizePetRecord(raw, config) {
      if (raw === null || typeof raw !== "object") return null;
      var pet = raw.pet;
      if (pet === null || typeof pet !== "object") return null;
      var level = numberIn(pet.level, 1, 9999, 1);
      var today = dayIndexOf(Date.now());
      var bySource = raw.tokensBySource;
      if (bySource === null || typeof bySource !== "object") bySource = {};
      return {
        id: typeof raw.id === "string" ? raw.id : generatePetId(),
        species: typeof raw.species === "string" && PET_SPECIES[raw.species] ? raw.species : "whale",
        name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name.slice(0, 20) : "深深",
        avatar: typeof raw.avatar === "string" ? raw.avatar : "whale",
        icon: typeof raw.icon === "string" ? raw.icon : "🐳",
        bornAt: numberIn(raw.bornAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
        pet: {
          hunger: numberIn(pet.hunger, 0, 100, 60),
          mood: numberIn(pet.mood, 0, 100, 80),
          energy: numberIn(pet.energy, 0, 100, 75),
          curiosity: numberIn(pet.curiosity, 0, 100, 0),
          pride: numberIn(pet.pride, 0, 100, 0),
          concern: numberIn(pet.concern, 0, 100, 0),
          level: level,
          exp: numberIn(pet.exp, 0, level * EXP_PER_LEVEL, 0),
          form: formOf(pet.form) === null ? "" : pet.form
        },
        totalFeeds: numberIn(raw.totalFeeds, 0, 1e9, 0),
        totalTokens: numberIn(raw.totalTokens, 0, 1e12, 0),
        tokensBySource: {
          user_input: numberIn(bySource.user_input, 0, 1e12, 0),
          generation: numberIn(bySource.generation, 0, 1e12, 0),
          tool_result: numberIn(bySource.tool_result, 0, 1e12, 0)
        },
        snacks: numberIn(raw.snacks, 0, config.manualSnackMax, config.manualSnackMax),
        achievements: sanitizeIds(raw.achievements, ACHIEVEMENT_BY_ID),
        daily: sanitizeDaily(raw.daily, today),
        streakDay: numberIn(raw.streakDay, 0, 1e9, 0),
        streakCount: numberIn(raw.streakCount, 0, 1e6, 0),
        pats: numberIn(raw.pats, 0, 1e9, 0),
        pos: sanitizePos(raw.pos),
        lastFeedAt: numberIn(raw.lastFeedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        skills: sanitizeSkills(raw.skills, config),
        memory: sanitizeMemory(raw.memory, config, today)
      };
    }

    function freshGlobalStats() {
      return {
        totalTokensAllTime: 0,
        totalFeedsAllTime: 0,
        achievementsUnlockedAllTime: 0,
        petsHatched: 1,
        eggsObtained: []
      };
    }

    function sanitizeGlobal(raw) {
      if (raw === null || typeof raw !== "object") return freshGlobalStats();
      var obtained = [];
      if (Array.isArray(raw.eggsObtained)) {
        for (var i = 0; i < raw.eggsObtained.length; i++) {
          if (typeof raw.eggsObtained[i] === "string") obtained.push(raw.eggsObtained[i]);
        }
      }
      return {
        totalTokensAllTime: numberIn(raw.totalTokensAllTime, 0, 1e15, 0),
        totalFeedsAllTime: numberIn(raw.totalFeedsAllTime, 0, 1e12, 0),
        achievementsUnlockedAllTime: numberIn(raw.achievementsUnlockedAllTime, 0, 1e6, 0),
        petsHatched: numberIn(raw.petsHatched, 0, 1e6, 1),
        eggsObtained: obtained
      };
    }

    function sanitizeEggs(raw) {
      if (!Array.isArray(raw)) return [];
      var result = [];
      for (var i = 0; i < raw.length && i < MAX_EGGS; i++) {
        var e = raw[i];
        if (e === null || typeof e !== "object") continue;
        if (typeof e.id !== "string" || !EGG_TYPE_BY_KEY[e.type]) continue;
        result.push({ id: e.id, type: e.type, obtainedAt: numberIn(e.obtainedAt, 0, Number.MAX_SAFE_INTEGER, 0) });
      }
      return result;
    }

    function freshV2State(config) {
      var id = "pet-0";
      var pets = {};
      pets[id] = createFreshPetRecord("whale", config.petName, id);
      return {
        savedAt: 0,
        activePetId: id,
        favorites: [],
        pets: pets,
        eggs: [],
        global: freshGlobalStats()
      };
    }

    function sanitizeSavedV2(parsed, config) {
      if (parsed === null || typeof parsed !== "object") return freshV2State(config);
      var pets = {};
      var rawPets = parsed.pets;
      if (rawPets !== null && typeof rawPets === "object" && !Array.isArray(rawPets)) {
        var keys = Object.keys(rawPets);
        for (var i = 0; i < keys.length && i < MAX_PETS; i++) {
          var rec = sanitizePetRecord(rawPets[keys[i]], config);
          if (rec !== null) pets[rec.id] = rec;
        }
      }
      if (Object.keys(pets).length === 0) return freshV2State(config);
      var activePetId = typeof parsed.activePetId === "string" && pets[parsed.activePetId]
        ? parsed.activePetId
        : Object.keys(pets)[0];
      var favorites = [];
      if (Array.isArray(parsed.favorites)) {
        for (var i = 0; i < parsed.favorites.length; i++) {
          if (typeof parsed.favorites[i] === "string" && pets[parsed.favorites[i]]) {
            favorites.push(parsed.favorites[i]);
          }
        }
      }
      return {
        savedAt: numberIn(parsed.savedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        activePetId: activePetId,
        favorites: favorites,
        pets: pets,
        eggs: sanitizeEggs(parsed.eggs),
        global: sanitizeGlobal(parsed.global)
      };
    }

    function migrateV1ToV2(parsed, config) {
      var v1 = sanitizeSaved(parsed, config);
      if (v1 === null) return freshV2State(config);
      var petId = "pet-0";
      var pets = {};
      pets[petId] = {
        id: petId,
        species: config.petAvatar === "whale" ? "whale" : config.petAvatar,
        name: config.petName,
        avatar: config.petAvatar,
        icon: config.petIcon,
        bornAt: v1.savedAt > 0 ? v1.savedAt - 86400000 : Date.now(),
        pet: v1.pet,
        totalFeeds: v1.totalFeeds,
        totalTokens: v1.totalTokens,
        tokensBySource: v1.tokensBySource,
        snacks: v1.snacks,
        achievements: v1.achievements,
        daily: v1.daily,
        streakDay: v1.streakDay,
        streakCount: v1.streakCount,
        pats: v1.pats,
        pos: v1.pos,
        lastFeedAt: v1.lastFeedAt,
        skills: v1.skills,
        memory: v1.memory
      };
      return {
        savedAt: v1.savedAt,
        activePetId: petId,
        favorites: [],
        pets: pets,
        eggs: [],
        global: {
          totalTokensAllTime: v1.totalTokens,
          totalFeedsAllTime: v1.totalFeeds,
          achievementsUnlockedAllTime: v1.achievements.length,
          petsHatched: 1,
          eggsObtained: []
        }
      };
    }

    function loadSavedStateV2(config) {
      if (!config.persist) return freshV2State(config);
      var raw = null;
      try {
        raw = window.localStorage.getItem(STATE_KEY);
      } catch (error) {
        return freshV2State(config);
      }
      if (typeof raw !== "string") return freshV2State(config);
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        console.warn("[dsh-pet-plugin] " + STATE_KEY + " 不是合法 JSON，已当作新宠物");
        return freshV2State(config);
      }
      if (parsed === null || typeof parsed !== "object") return freshV2State(config);
      if (parsed.v === 2) return sanitizeSavedV2(parsed, config);
      if (parsed.v === 1) return migrateV1ToV2(parsed, config);
      return freshV2State(config);
    }

    function createPersistenceV2(config, readV2State) {
      var timer = 0;
      var lastBody = "";

      function write() {
        if (timer !== 0) { clearTimeout(timer); timer = 0; }
        var data = readV2State();
        var fingerprint = JSON.stringify(data);
        if (fingerprint === lastBody) return;
        var save = JSON.parse(fingerprint);
        save.v = STATE_VERSION;
        save.savedAt = Date.now();
        try {
          window.localStorage.setItem(STATE_KEY, JSON.stringify(save));
          lastBody = fingerprint;
        } catch (error) { /* 配额满 / 隐私模式 */ }
      }

      return {
        schedule: function () {
          if (!config.persist || timer !== 0) return;
          timer = setTimeout(function () { timer = 0; write(); }, config.saveDebounceMs);
        },
        flush: function () { if (config.persist) write(); },
        dispose: function () { if (timer !== 0) clearTimeout(timer); timer = 0; }
      };
    }

    // ─── 多宠物数据层 END ────────────────────────────────────────────

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
          tokens: Math.ceil(textLengthOf(message.content) / 2),
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
        return { source: "tool_result", tokens: Math.max(Math.ceil(bytes / 2), 1), output: 0 };
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

      // ─── 多宠物集合 ───
      var v2 = loadSavedStateV2(config);
      var collection = v2.pets;
      var activePetId = v2.activePetId;
      var favorites = v2.favorites;
      var eggs = v2.eggs;
      var globalStats = v2.global;

      var activeRecord = collection[activePetId];
      var bootAt = Date.now();

      function stateFromRecord(rec) {
        return {
          pet: createPet(
            { petName: rec.name, petSpecies: PET_SPECIES[rec.species] ? PET_SPECIES[rec.species].label : rec.species, petAvatar: rec.avatar, petIcon: rec.icon },
            rec.pet
          ),
          effects: [],
          comboCount: 0,
          comboMultiplier: 1,
          comboTier: "normal",
          eatKey: 0,
          patKey: 0,
          lastAct: null,
          idleAct: null,
          totalFeeds: rec.totalFeeds,
          totalTokens: rec.totalTokens,
          tokensBySource: rec.tokensBySource,
          snacks: rec.snacks,
          achievements: rec.achievements,
          daily: rec.daily,
          streakDay: rec.streakDay,
          streakCount: rec.streakCount,
          pats: rec.pats,
          skills: createSkills(rec.skills),
          memory: rec.memory,
          pos: rec.pos,
          lastFeedAt: rec.lastFeedAt === 0 ? bootAt : Math.min(rec.lastFeedAt, bootAt),
          asleep: false,
          bubble: null,
          buff: null,
          panelOpen: false,
          dragging: false,
          // 多宠物 UI 状态
          activePetId: activePetId,
          petCount: Object.keys(collection).length,
          favorites: favorites.slice(),
          eggs: eggs.slice(),
          petOrder: computePetOrder(collection, favorites),
          eggPanelOpen: false,
          hatchingEgg: null,
          addPetOpen: false
        };
      }

      var state = stateFromRecord(activeRecord);

      function extractRecordFromState() {
        var pet = state.pet;
        return {
          id: activePetId,
          species: collection[activePetId].species,
          name: pet.name,
          avatar: collection[activePetId].avatar,
          icon: pet.icon,
          bornAt: collection[activePetId].bornAt,
          pet: {
            hunger: pet.hunger, exp: pet.exp, level: pet.level,
            mood: pet.mood, energy: pet.energy,
            curiosity: pet.curiosity, pride: pet.pride, concern: pet.concern,
            form: pet.form
          },
          totalFeeds: state.totalFeeds,
          totalTokens: state.totalTokens,
          tokensBySource: state.tokensBySource,
          snacks: state.snacks,
          achievements: state.achievements,
          daily: state.daily,
          streakDay: state.streakDay,
          streakCount: state.streakCount,
          pats: state.pats,
          pos: state.pos,
          lastFeedAt: state.lastFeedAt,
          skills: state.skills,
          memory: state.memory
        };
      }

      function saveActiveToCollection() {
        collection[activePetId] = extractRecordFromState();
      }

      function resetTransientState() {
        combo.reset();
        comboTimer = 0;
        lastRegenAt = 0;
        hungerCarry = 0;
        moodCarry = 0;
        energyCarry = 0;
        dimCarry = { curiosity: 0, pride: 0, concern: 0 };
        snackAt = 0;
        lastBubbleAt = 0;
        if (bubbleTimer !== 0) clearTimeout(bubbleTimer);
        bubbleTimer = 0;
        bubbleSeq = 0;
        lastBubbleDim = false;
        lineAt = {};
        patAt = 0;
        patRun = 0;
        idleAt = 0;
        idleSeq = 0;
        if (idleTimer !== 0) clearTimeout(idleTimer);
        idleTimer = 0;
        idleLast = -1;
        if (buffTimer !== 0) clearTimeout(buffTimer);
        buffTimer = 0;
        tasteSource = null;
        tasteCount = 0;
        adviceAt = 0;
        sessionEdits = {};
        errorStreak = 0;
        lastErrorTool = null;
        toolFailStreak = 0;
        careAt = 0;
        activeSince = 0;
        marathonSaid = false;
        comebackMs = 0;
        dragMoved = false;
        dragFrom = null;
      }

      var persist = createPersistenceV2(config, function () {
        saveActiveToCollection();
        return {
          activePetId: activePetId,
          favorites: favorites,
          pets: collection,
          eggs: eggs,
          global: globalStats
        };
      });

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
      var savedAt = v2.savedAt || 0;
      if (savedAt > 0) {
        var offlineFrom = Math.max(
          Math.min(savedAt, bootAt),
          bootAt - config.offlineRegenCapMs
        );
        lastRegenAt = offlineFrom;
        snackAt = offlineFrom;
        state.asleep = shouldSleep(bootAt, state.pet);
        state.pet = settleVitals(bootAt);
        state.snacks = settleSnacks(bootAt);
        state.daily = settleDaily(bootAt);
        var away = bootAt - Math.min(savedAt, bootAt);
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
        if (parsed === null || typeof parsed !== "object" || parsed.v !== 2) return;
        var incoming = sanitizeSavedV2(parsed, config);
        if (!incoming || !incoming.pets[incoming.activePetId]) return;
        // 采用外部的完整集合
        collection = incoming.pets;
        favorites = incoming.favorites;
        eggs = incoming.eggs;
        globalStats = incoming.global;
        // 采用外部的活跃宠物
        activePetId = incoming.activePetId;
        activeRecord = collection[activePetId];
        lastRegenAt = Date.now();
        snackAt = lastRegenAt;
        hungerCarry = 0;
        moodCarry = 0;
        energyCarry = 0;
        dimCarry = { curiosity: 0, pride: 0, concern: 0 };
        var rec = activeRecord;
        commit({
          pet: createPet(
            { petName: rec.name, petSpecies: PET_SPECIES[rec.species] ? PET_SPECIES[rec.species].label : rec.species, petAvatar: rec.avatar, petIcon: rec.icon },
            rec.pet
          ),
          totalFeeds: rec.totalFeeds,
          totalTokens: rec.totalTokens,
          tokensBySource: rec.tokensBySource,
          snacks: rec.snacks,
          achievements: rec.achievements,
          daily: sanitizeDaily(rec.daily, dayIndexOf(lastRegenAt)),
          streakDay: rec.streakDay,
          streakCount: rec.streakCount,
          pats: rec.pats,
          skills: rec.skills,
          memory: rec.memory,
          pos: rec.pos,
          lastFeedAt: rec.lastFeedAt === 0 ? lastRegenAt : rec.lastFeedAt,
          asleep: false,
          activePetId: activePetId,
          petCount: Object.keys(collection).length,
          favorites: favorites.slice(),
          eggs: eggs.slice(),
          petOrder: computePetOrder(collection, favorites)
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
          // 普通升级用较低的得意值，前期频繁升级不至于让得意脸常驻。
          if (after.level > before.level) bumpDim(patch, "pride", config.pridePerLevelup);
          // 没跨档也要查一次分化：`evolveMinLevel` 是配置项，被改到档位之间
          // （比如 8）的话，这一支就是唯一能接住那一级的地方。
          if (after.level > before.level) appendMorph(patch);
          return;
        }
        // 蹭 epic 那套彩虹大字，进阶总得比一口饭显眼。
        appendNotice(patch, EVOLVE_ICON, "进阶 · " + stage.label, "evolve", "epic");
        say(patch, "evolve", true);
        bumpDim(patch, "pride", config.pridePerWin);
        // 顶到传说那一档的同一口饭里可能就够分化了：先「进阶 · 传说金鲸」，
        // 再「进化 · 代码猫」，两条特效连着放，顺序正好是这只宠物的经历。
        appendMorph(patch);
      }

      /**
       * 够格就当场分化成对应形态（见 `evolveTargetOf`）。
       *
       * 进化的两个条件由**两条路**分别推动：等级靠喂食涨、技能靠工具调用涨，
       * 所以喂食与工具两边都要查一次（照 `checkAchievements` 的先例）——
       * 只在喂食时查的话，已经 Lv.10 的宠物要等到下一口饭才认，看起来像坏了。
       * @param patch - 正在攒的 patch（这一刻的 pet / skills 优先从它里面取）。
       * @returns 这次分化成的形态；没进化则 null。
       */
      function appendMorph(patch) {
        var pet = patch.pet === undefined ? state.pet : patch.pet;
        var skills = patch.skills === undefined ? state.skills : patch.skills;
        var form = evolveTargetOf(pet, skills, config);
        if (form === null) return null;
        // 一次定终身，所以这一行是**唯一**写 form 的地方。
        patch.pet = Object.assign({}, pet, { form: form.key });
        // 蹭进阶那套彩虹大字，外加卡片上那一段 1.6s 的变身动画（.dshpet-morph
        // 靠这条特效的 source 认出来）。
        appendNotice(patch, form.icon, "进化 · " + form.label, "morph", "epic");
        say(patch, "morph", true);
        bumpDim(patch, "pride", config.pridePerWin);
        return form;
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

      function doCheckEggMilestones() {
        var gained = [];
        for (var i = 0; i < EGG_MILESTONES.length; i++) {
          var m = EGG_MILESTONES[i];
          if (globalStats.eggsObtained.indexOf(m.id) >= 0) continue;
          if (m.test(globalStats)) {
            globalStats.eggsObtained.push(m.id);
            var newEgg = { id: "egg-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), type: m.egg, obtainedAt: Date.now() };
            if (eggs.length < MAX_EGGS) eggs.push(newEgg);
            gained.push(newEgg);
          }
        }
        if (gained.length > 0) {
          commit({ eggs: eggs.slice() });
        }
        return gained;
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
          var exp = Math.max(1, Math.floor(BASE_EXP[source] * expFactor + 0.5))
            + Math.min(2, Math.round(0.3 * Math.log2(1 + tokens / 60)));
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
          // 全局统计 + 里程碑检查
          globalStats.totalTokensAllTime += tokens;
          globalStats.totalFeedsAllTime += 1;
          if (patch.achievements && patch.achievements.length > state.achievements.length) {
            globalStats.achievementsUnlockedAllTime += patch.achievements.length - state.achievements.length;
          }
          commit(patch);
          doCheckEggMilestones();
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
          // 同理，分化的另一半门槛（主技能等级）也是这条路涨的：已经 Lv.10 的
          // 宠物，主技能升到格的**那一次**工具调用就该当场变身。
          appendMorph(patch);
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

        // ─── 多宠物操作 ───
        switchPet: function (direction) {
          var order = state.petOrder;
          if (order.length <= 1) return;
          var idx = order.indexOf(activePetId);
          var next = direction > 0
            ? order[(idx + 1) % order.length]
            : order[(idx - 1 + order.length) % order.length];
          if (next === activePetId) return;
          saveActiveToCollection();
          activePetId = next;
          activeRecord = collection[activePetId];
          resetTransientState();
          var newState = stateFromRecord(activeRecord);
          state = newState;
          persist.schedule();
          listeners.forEach(function (listener) { listener(); });
        },
        toggleFavorite: function () {
          var idx = favorites.indexOf(activePetId);
          if (idx >= 0) favorites.splice(idx, 1);
          else favorites.push(activePetId);
          commit({
            favorites: favorites.slice(),
            petOrder: computePetOrder(collection, favorites)
          });
        },
        openEggPanel: function () {
          commit({ eggPanelOpen: !state.eggPanelOpen, panelOpen: false }, true);
        },
        startHatch: function (eggId) {
          var egg = null;
          for (var i = 0; i < eggs.length; i++) {
            if (eggs[i].id === eggId) { egg = eggs[i]; break; }
          }
          if (!egg) return;
          commit({ hatchingEgg: egg }, true);
        },
        cancelHatch: function () {
          commit({ hatchingEgg: null }, true);
        },
        confirmHatch: function (name) {
          var egg = state.hatchingEgg;
          if (!egg) return false;
          if (Object.keys(collection).length >= MAX_PETS) return false;
          var eggIdx = -1;
          for (var i = 0; i < eggs.length; i++) {
            if (eggs[i].id === egg.id) { eggIdx = i; break; }
          }
          if (eggIdx < 0) return false;
          var species = resolveEggSpecies(egg.type);
          var newId = generatePetId();
          var newRecord = createFreshPetRecord(species, name, newId);
          eggs.splice(eggIdx, 1);
          saveActiveToCollection();
          collection[newId] = newRecord;
          globalStats.petsHatched += 1;
          activePetId = newId;
          activeRecord = newRecord;
          resetTransientState();
          var newState = stateFromRecord(activeRecord);
          newState.hatchingEgg = null;
          newState.eggPanelOpen = false;
          state = newState;
          persist.schedule();
          listeners.forEach(function (listener) { listener(); });
          return true;
        },
        checkEggMilestones: function () { return doCheckEggMilestones(); },
        addPet: function (speciesKey, name) {
          if (Object.keys(collection).length >= MAX_PETS) return false;
          var sp = PET_SPECIES[speciesKey];
          if (!sp) return false;
          var newId = generatePetId();
          var newRecord = createFreshPetRecord(speciesKey, name || sp.name, newId);
          saveActiveToCollection();
          collection[newId] = newRecord;
          globalStats.petsHatched += 1;
          activePetId = newId;
          activeRecord = newRecord;
          resetTransientState();
          var newState = stateFromRecord(activeRecord);
          newState.addPetOpen = false;
          state = newState;
          persist.schedule();
          listeners.forEach(function (listener) { listener(); });
          return true;
        },
        openAddPet: function () {
          commit({ addPetOpen: !state.addPetOpen, panelOpen: false, eggPanelOpen: false }, true);
        },
        getCollection: function () { return collection; },
        getEggs: function () { return eggs; },
        getGlobalStats: function () { return globalStats; },
        isFavorite: function () { return favorites.indexOf(activePetId) >= 0; },

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

    // 配色（WHALE_INK / WHALE_LINE / WHALE_GOLD*）在常量区，和 WHALE_ART 挨着：
    // 那几张长相表里的零件要自己写颜色（王冠、狐狸的白尾尖、虫背上的点）。

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
     * 把长相表里的零件描述（`{ t, p }`，见 WHALE_ART）摊成真节点。
     *
     * key 在这儿给而不是写进常量：常量区存的是数据，不是攒好的元素。`base` 是
     * 这一槽位的默认属性（皮肤 / 描边 / 线宽），零件自己写了同名属性就盖掉它。
     * @param list - 零件数组；null / undefined 时返回 null（这一槽位没有）。
     * @param prefix - key 前缀。
     * @param base - 这一槽位的默认属性；不需要就传 null。
     * @returns 节点数组，或 null。
     */
    function artNodes(list, prefix, base) {
      if (list === null || list === undefined) return null;
      return list.map(function (node, at) {
        var props = { key: prefix + String(at) };
        if (base !== null && base !== undefined) Object.assign(props, base);
        return h(node.t, Object.assign(props, node.p));
      });
    }

    /**
     * 此刻该长成什么样。卡片和头像共用这一个真相源，免得两边各算一次形态。
     *
     * 两条路：没进化过就按等级走 `WHALE_STAGES`（幼崽 / 少年 / 成年 / 传说），
     * 进化过就走 `FORMS` 里那一份 —— 进化是终点，所以没有「下一档」，等级再涨
     * 也不再换长相（`next*` 是 null，tooltip 那句「→ Lv.N」跟着消失）。
     * @param pet - 宠物状态（只读 level 与 form；level 缺省时落到最低档）。
     * @returns 长相描述：{ key, label, aria, size, skin, line, lineWidth, eyeGrow,
     *   art, spout, dorsal, crown, nextLabel, nextLevel }。
     */
    function lookOf(pet) {
      var form = pet === null || pet === undefined ? null : formOf(pet.form);
      if (form !== null) {
        return {
          key: form.key,
          label: form.label,
          aria: "宠物（" + form.label + "）",
          size: form.size,
          skin: form.skin,
          line: form.line,
          lineWidth: 1,
          eyeGrow: form.eyeGrow,
          art: form.art,
          spout: false,
          dorsal: false,
          crown: false,
          nextLabel: null,
          nextLevel: null
        };
      }
      var level = pet === null || pet === undefined ? undefined : pet.level;
      var stage = whaleStageOf(level);
      var next = whaleStageNextOf(level);
      return {
        key: stage.key,
        label: stage.label,
        aria: "鲸鱼宠物（" + stage.label + "）",
        size: stage.size,
        skin: stage.skin,
        line: stage.gold ? WHALE_GOLD_LINE : WHALE_LINE,
        // 金线细了看不出是金的，索性一起加粗；卡片会跟着头像一起长高。
        lineWidth: stage.gold ? 1.5 : 1,
        eyeGrow: stage.eyeGrow,
        art: WHALE_ART,
        spout: stage.spout,
        dorsal: stage.dorsal,
        crown: stage.crown,
        nextLabel: next === null ? null : next.label,
        nextLevel: next === null ? null : next.minLevel
      };
    }

    /**
     * 宠物头像：一张内联 SVG，部件各自挂 CSS 动画（浮沉 / 摆尾 / 划鳍 / 眨眼 /
     * 喷水），epic 连击时加星星眼与闪光。
     *
     * 不用外链图片：插件产物是单文件 JS，塞不了资源，而 SVG 还能跟着 combo
     * 换表情。id 带前缀避免和宿主页面的 defs 撞名。
     *
     * 长相由六件事决定：连击档（星星眼 / 闪光）、睡没睡（闭眼）、饿不饿（耷脸）、
     * 心情差不差（也是耷脸）、**情绪三维**（眉毛 + 嘴型）、**形态**（没进化就是
     * 按等级的鲸鱼四档，进化过就是 FORMS 里那一种）。收的是 level / form 而不是
     * 算好的形态对象，长相在组件里自己算（`lookOf`）—— 缺省 level 时
     * `undefined >= 3` 恒 false，自然落到最低档，不会炸。
     *
     * 四种进化形态**没有各自的组件**，全靠这一个函数吃 `look.art` 里那份几何：
     * 卡片测试靠「第一个函数类型的节点就是头像」定位头像，多一个组件会把它们
     * 带偏（见 renderPanel 的注释）。承重的六个类名（body / tail / fin / eyes /
     * mouth / blush）因此在每种形态上都还在，动画与断言跟着一起活。
     * @param props - { tier, hungry, asleep, sad, dim, level, form }：连击视觉
     *   等级 + 是否饿着 + 是否睡着 + 心情是否见底 + 写在脸上的那一维（moodDimOf
     *   的结果，可为 null）+ 宠物等级 + 进化形态（没进化是 ""）。
     * @returns 头像节点。
     */
    function WhaleAvatar(props) {
      var excited = props.tier === "epic";
      var asleep = props.asleep === true && !excited;
      var starving = props.hungry === true && !excited && !asleep;
      var sad = props.sad === true && !excited && !asleep && !starving;
      // 形态与显示尺寸沿用既有 WHALE_STAGES / whaleStageOf（key 与 manifest 对齐）。
      var stage = whaleStageOf(props.level);
      // 进化形态（代码猫等）没有专属 APNG 素材：图面回退到传说档鲸鱼，
      // 尺寸与名称仍按形态来（formOf 返回 FORMS 条目，label 如「代码猫」）。
      var form = formOf(props.form);
      var imgStage = form !== null ? "legend" : stage.key;
      var label = form !== null ? form.label : ("鲸鱼娘（" + stage.label + "）");
      var size = form !== null ? form.size : stage.size;
      // 状态优先级与旧 SVG 版一致：饿 > 睡 > 心情差 > 连击兴奋 > 普通。
      var state = starving ? "hungry"
        : asleep ? "sleep"
          : sad ? "sad"
            : excited ? "excited"
              : "normal";
      var frame = function (s) { return SPRITES["deepseek-" + imgStage + "-" + s + ".apng"]; };
      var base = frame(state) || SPRITES["deepseek-baby-normal.apng"] || "";
      var common = {
        className: "dshpet-whale dshpet-whale-sprite",
        width: size,
        height: size,
        style: { width: String(size) + "px", height: String(size) + "px", display: "block" },
        alt: "",
        role: "img",
        "aria-label": label
      };
      // eat / pat 两张叠加层由外层 .dshpet-eating / .dshpet-patted 类切换显示，
      // 触发机制与原 SVG 版一致（renderPanel 里 lastAct 挂类，见注释）。
      return h(
        "span",
        { className: "dshpet-avatar-stack", style: { display: "inline-block", position: "relative", lineHeight: 0 } },
        // 底座图带 .dshpet-whale-sprite-bob 类 → CSS keyframes 平滑浮动（不再用 APNG 帧切换）
        h("img", Object.assign({}, common, {
          src: base,
          className: "dshpet-whale dshpet-whale-sprite dshpet-whale-sprite-bob",
          "data-sprite": "deepseek-" + imgStage + "-" + state + ".apng"
        })),
        h("img", Object.assign({}, common, {
          className: "dshpet-whale dshpet-whale-sprite dshpet-sprite-eat",
          src: frame("eat") || base, "aria-hidden": "true",
          "data-sprite": "deepseek-" + imgStage + "-eat.apng"
        })),
        h("img", Object.assign({}, common, {
          className: "dshpet-whale dshpet-whale-sprite dshpet-sprite-pat",
          src: frame("pat") || base, "aria-hidden": "true",
          "data-sprite": "deepseek-" + imgStage + "-pat.apng"
        }))
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
    function renderEggPanel(state, store) {
      return h("div", { className: "dshpet-egg-panel", onClick: function (e) { stopBubbling(e); }, onPointerDown: function (e) { e.stopPropagation(); } },
        h("div", { className: "dshpet-egg-panel-title" }, "蛋库存"),
        h("div", { className: "dshpet-egg-grid" },
          state.eggs.map(function (egg) {
            var et = EGG_TYPE_BY_KEY[egg.type];
            var shellStyle = et && et.shell.indexOf("gradient") >= 0
              ? { background: et.shell }
              : { backgroundColor: et ? et.shell : "#eee" };
            return h("button", {
              key: egg.id,
              className: "dshpet-egg-item",
              type: "button",
              style: shellStyle,
              title: (et ? et.label : "蛋") + "（点击孵化）",
              onClick: function () { store.startHatch(egg.id); }
            }, "🥚", h("span", { className: "dshpet-egg-label" }, et ? et.label : "?"));
          })
        ),
        h("button", {
          className: "dshpet-egg-close",
          type: "button",
          onClick: function () { store.openEggPanel(); }
        }, "×")
      );
    }

    function renderHatchDialog(state, store) {
      var egg = state.hatchingEgg;
      if (!egg) return null;
      var et = EGG_TYPE_BY_KEY[egg.type];
      var species = et ? (et.species === "random" ? "whale" : et.species) : "whale";
      var sp = PET_SPECIES[species] || PET_SPECIES.whale;
      var inputRef = { current: sp.name };
      return h("div", {
        className: "dshpet-hatch-overlay",
        onClick: function (e) { stopBubbling(e); },
        onPointerDown: function (e) { e.stopPropagation(); }
      },
        h("div", { className: "dshpet-hatch-dialog" },
          h("div", { className: "dshpet-hatch-title" }, "孵化 " + (et ? et.label : "蛋")),
          h("div", { className: "dshpet-hatch-preview" }, sp.icon),
          h("div", { className: "dshpet-hatch-species" }, sp.label),
          h("input", {
            className: "dshpet-hatch-input",
            type: "text",
            placeholder: "给它起个名字",
            defaultValue: sp.name,
            maxLength: 20,
            onChange: function (e) { inputRef.current = e.target.value; },
            onPointerDown: function (e) { e.stopPropagation(); },
            onKeyDown: function (e) {
              if (e.key === "Enter") {
                store.confirmHatch(inputRef.current || sp.name);
              }
            }
          }),
          h("div", { className: "dshpet-hatch-actions" },
            h("button", {
              className: "dshpet-hatch-confirm",
              type: "button",
              onClick: function (e) { stopBubbling(e); store.confirmHatch(inputRef.current || sp.name); }
            }, "孵化！"),
            h("button", {
              className: "dshpet-hatch-cancel",
              type: "button",
              onClick: function (e) { stopBubbling(e); store.cancelHatch(); }
            }, "取消")
          )
        )
      );
    }

    function AddPetDialog(props) {
      var store = props.store;
      var speciesKeys = Object.keys(PET_SPECIES);
      var speciesHook = React.useState(speciesKeys[0]);
      var selectedSpecies = speciesHook[0];
      var setSpecies = speciesHook[1];
      var nameRef = React.useRef("");

      return h("div", {
        className: "dshpet-hatch-overlay",
        onClick: function (e) { stopBubbling(e); },
        onPointerDown: function (e) { e.stopPropagation(); }
      },
        h("div", { className: "dshpet-hatch-dialog dshpet-addpet-dialog" },
          h("div", { className: "dshpet-hatch-title" }, "添加宠物"),
          h("div", { className: "dshpet-addpet-grid" },
            speciesKeys.map(function (key) {
              var sp = PET_SPECIES[key];
              return h("button", {
                key: key,
                className: "dshpet-addpet-species",
                type: "button",
                "data-selected": key === selectedSpecies ? "true" : undefined,
                title: sp.label,
                onClick: function (e) {
                  stopBubbling(e);
                  setSpecies(key);
                }
              }, h("span", { className: "dshpet-addpet-icon" }, sp.icon),
                h("span", { className: "dshpet-addpet-label" }, sp.label));
            })
          ),
          h("input", {
            className: "dshpet-hatch-input",
            type: "text",
            placeholder: "给它起个名字（可选）",
            maxLength: 20,
            onChange: function (e) { nameRef.current = e.target.value; },
            onPointerDown: function (e) { e.stopPropagation(); },
            onKeyDown: function (e) {
              if (e.key === "Enter") {
                store.addPet(selectedSpecies, nameRef.current);
              }
            }
          }),
          h("div", { className: "dshpet-hatch-actions" },
            h("button", {
              className: "dshpet-hatch-confirm",
              type: "button",
              onClick: function (e) { stopBubbling(e); store.addPet(selectedSpecies, nameRef.current); }
            }, "添加"),
            h("button", {
              className: "dshpet-hatch-cancel",
              type: "button",
              onClick: function (e) { stopBubbling(e); store.openAddPet(); }
            }, "取消")
          )
        )
      );
    }

    function createPetOverlay(store, config) {
      return function PetOverlay() {
        var stateHook = React.useState(store.getState());
        var state = stateHook[0];
        var setState = stateHook[1];
        var collapsedHook = React.useState(false);
        var collapsed = collapsedHook[0];
        var setCollapsed = collapsedHook[1];
        // 收纳面板（popover）开关：默认收起，只有 ··· 按钮能打开。
        var detailOpenHook = React.useState(false);
        var detailOpen = detailOpenHook[0];
        var setDetailOpen = detailOpenHook[1];

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
        // 长相：没进化就按等级算（不存档、不占状态），进化过就按 pet.form 走。
        // 和头像里那次 lookOf 是同一个函数，所以卡片和头像不会各说一套。
        var look = lookOf(pet);
        // 进阶金环 / 变身白光都直接挂在对应的那条特效上：特效被 dropEffect
        // 撤掉，光也跟着没，不会闪回。
        var evolving = null;
        var morphing = null;
        for (var ei = 0; ei < state.effects.length; ei += 1) {
          if (state.effects[ei].source === "evolve") evolving = state.effects[ei];
          if (state.effects[ei].source === "morph") morphing = state.effects[ei];
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
                "data-stage": look.key,
                "data-asleep": state.asleep ? "true" : undefined,
                "data-buff": frenzy ? "frenzy" : undefined,
                "data-dragging": state.dragging ? "true" : undefined,
                "data-dim": dim === null ? undefined : dim.key,
                // 小动作挂在卡片上（而不是头像上）：几条 idle 各动一个部件，
                // 用一个 data-idle 派发比给每个部件加类干净。
                "data-idle": state.idleAct === null ? undefined : state.idleAct,
                "data-detail-open": detailOpen ? "true" : undefined,
                title: "心情 " + String(pet.mood) + " / 精力 " + String(pet.energy)
                  + (dim === null ? "" : " / " + dim.label + " " + String(pet[dim.key]))
                  + " / 累计喂食 " + String(state.totalFeeds) + " 次"
                  + " / 累计 " + formatTokens(state.totalTokens) + " tok"
                  + " / 形态 " + look.label
                  // 进化过就没有「下一档」了（进化是终点，见 lookOf）。
                  + (look.nextLevel === null
                    ? ""
                    : " → Lv." + String(look.nextLevel) + " " + look.nextLabel)
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
              // 多宠物左箭头
              state.petCount > 1
                ? h("button", {
                  className: "dshpet-nav dshpet-nav-left",
                  type: "button",
                  "aria-label": "上一只宠物",
                  onClick: function (event) { stopBubbling(event); store.switchPet(-1); }
                }, "◀")
                : null,
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
                // 变身也在这条二选一里，而且它赢：一辈子就这一次，
                // 这 1.6 秒里那一口饭的弹跳可以让位。
                h("span", {
                  key: "act-" + String(state.eatKey) + "-" + String(state.patKey)
                    + (morphing === null ? "" : "-m" + morphing.key),
                  className: morphing !== null
                    ? "dshpet-morphing"
                    : state.lastAct === "pat"
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
                    form: pet.form,
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
                  : h("span", { key: "evolve-" + evolving.key, className: "dshpet-evolve" }),
                // 变身：白光罩住 → 弹一下 → 新形态露出来，1.6s 一次性。
                morphing === null
                  ? null
                  : h("span", { key: "morph-" + morphing.key, className: "dshpet-morph" })
              ),
              // 多宠物右箭头
              state.petCount > 1
                ? h("button", {
                  className: "dshpet-nav dshpet-nav-right",
                  type: "button",
                  "aria-label": "下一只宠物",
                  onClick: function (event) { stopBubbling(event); store.switchPet(1); }
                }, "▶")
                : null,
              // 收纳面板：所有非立绘信息都收在这（默认 CSS 隐藏，点 ··· 展开）。
              h(
                "div",
                { className: "dshpet-popover" },
                collapsed
                  ? null
                  : h(
                    "div",
                    { className: "dshpet-meta" },
                  h("div", { className: "dshpet-name" },
                    pet.name + " · Lv." + String(pet.level) + " " + look.label,
                    // 收藏星
                    state.petCount > 1
                      ? h("button", {
                        className: "dshpet-fav",
                        type: "button",
                        "data-active": store.isFavorite() ? "true" : undefined,
                        "aria-label": store.isFavorite() ? "取消收藏" : "收藏",
                        onClick: function (event) { stopBubbling(event); store.toggleFavorite(); }
                      }, store.isFavorite() ? "★" : "☆")
                      : null
                  ),
                  // 点指示器
                  state.petCount > 1
                    ? h("div", { className: "dshpet-dots" },
                      state.petOrder.slice(0, 7).map(function (id, i) {
                        return h("span", {
                          key: id,
                          className: "dshpet-dot" + (id === state.activePetId ? " dshpet-dot-active" : "")
                        });
                      }),
                      state.petOrder.length > 7
                        ? h("span", { className: "dshpet-dot-more" }, "…")
                        : null
                    )
                    : null,
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
              // 添加宠物按钮
              h("button", {
                className: "dshpet-add-btn",
                type: "button",
                title: "添加宠物",
                "aria-label": "添加宠物",
                onClick: function (event) {
                  stopBubbling(event);
                  store.openAddPet();
                }
              }, "+"),
              // 蛋按钮：有蛋才显示
              state.eggs.length > 0
                ? h("button", {
                  className: "dshpet-egg-btn",
                  type: "button",
                  "data-open": state.eggPanelOpen ? "true" : undefined,
                  title: "蛋库存 (" + String(state.eggs.length) + ")",
                  "aria-label": "蛋库存",
                  onClick: function (event) {
                    stopBubbling(event);
                    store.openEggPanel();
                  }
                }, "🥚", h("span", { className: "dshpet-egg-count" }, String(state.eggs.length)))
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
              // 详情按钮：收纳面板开关。立绘为主，其余信息都从这展开。
              h("button", {
                className: "dshpet-menu-btn",
                type: "button",
                "aria-label": detailOpen ? "收起详情" : "查看详情",
                "aria-expanded": detailOpen ? "true" : "false",
                onClick: function (event) {
                  stopBubbling(event);
                  setDetailOpen(!detailOpen);
                }
              }, "···")
            ),
            h(
              "div",
              { className: "dshpet-fx" },
              state.effects.map(function (effect, index) {
                return h(FeedEffect, { key: effect.key, effect: effect, index: index });
              })
            ),
            state.eggPanelOpen ? renderEggPanel(state, store) : null,
            state.hatchingEgg ? renderHatchDialog(state, store) : null,
            state.addPetOpen ? h(AddPetDialog, { store: store }) : null
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
