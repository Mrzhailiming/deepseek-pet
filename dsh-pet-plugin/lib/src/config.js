    //#region 配置

    /**
     * @typedef {import('../types').PetConfig} PetConfig
     * @typedef {import('../types').PetState} PetState
     * @typedef {import('../types').StoreState} StoreState
     * @typedef {import('../types').PetStore} PetStore
     * @typedef {import('../types').Skills} Skills
     * @typedef {import('../types').SkillRecord} SkillRecord
     * @typedef {import('../types').PetMemory} PetMemory
     * @typedef {import('../types').DailyProgress} DailyProgress
     * @typedef {import('../types').Egg} Egg
     * @typedef {import('../types').PetRecord} PetRecord
     * @typedef {import('../types').GlobalStats} GlobalStats
     * @typedef {import('../types').FeedEffectData} FeedEffectData
     * @typedef {import('../types').Look} Look
     */

    /** @type {PetConfig} 策划里的配置项默认值。浏览器 entry 不携带 cordis 的 config，所以这里是常量表。 */
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
      // hunger 顶满之后每分钟额外掉的心情（叠加在 moodDropPerMinHungry 上）
      moodCrashPerMinStarving: 8,
      // 心情低于这个值时经验倍率归零（饿太久的后果）
      moodExpFreezeAt: 10,
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
      // 微游戏：点击食物的 QTE 小游戏
      miniGameEnabled: true,
      // 游戏冷却时间（5 分钟）
      miniGameCooldownMs: 300000,
      // 每轮几个目标
      miniGameTargets: 3,
      // 每个目标的时限（ms）
      miniGameTimeoutMs: 2000,
      // 成功奖励
      miniGameExpReward: 20,
      miniGameSnackReward: 2,
      miniGameMoodReward: 15,
      bubbleEnabled: true,
      bubbleTtlMs: 2600,
      // 两个普通气泡之间至少隔这么久，否则一轮工具循环会把气泡刷成弹幕；
      // 进阶 / 成就 / 摸头这些「大事」不受它限制
      bubbleMinGapMs: 4000,
      // 每 N 次气泡尝试一句动态台词（引用记忆的模板）；0 = 纯静态池
      dynamicLinesEvery: 3,
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

      // 本实现补充：随机掉蛋。每次喂食有小概率获得一枚蛋
      eggDropEnabled: true,
      // 基础掉蛋概率（0-1，0.005 = 0.5%）
      eggDropBaseChance: 0.005,
      // 连击对掉蛋概率的加成（每连击 +0.1%）
      eggDropComboBonus: 0.001,

      // 本实现补充：技能树。不同工具调用培养不同技能，够高了解锁提示能力
      skillsEnabled: true,
      // 技能等级 L → L+1 需要 L × 这个数的技能经验
      skillXpPerLevel: 20,
      // 技能等级上限
      skillMaxLevel: 10,
      // 满级后每积累这么多技能经验算一阶精通
      masteryXpPerTier: 200,

      // 本实现补充：进化系统。养到头之后按「主要在干什么」分化成四种形态之一
      evolveEnabled: true,
      // 到这一级才够格分化（正好是传说档那一级，见 WHALE_STAGES）
      evolveMinLevel: 10,
      // 主技能至少这一级 —— 四门都平的人留在传说金鲸，那也是一种养法
      evolveMinSkillLevel: 5,

      // 本实现补充：轮回系统。养到头之后可以重置换永久经验加成
      prestigeEnabled: true,
      // 几级才能轮回
      prestigeMinLevel: 30,
      // 每轮回一次经验加成（0.05 = +5%）
      prestigeExpBonus: 0.05,

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
      petName: "大肥鱼",
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

    /** 宠物种族默认属性（孵化时自动填）。talent / hungerBonus / skillBonus 是种族天赋。 */
    var PET_SPECIES = {
      whale: { name: "深深", icon: "🐳", avatar: "whale", label: "深海小鲸", talent: "饱食+10%", hungerBonus: 0.1, skillBonus: null },
      cat:   { name: "喵喵", icon: "🐱", avatar: "cat",   label: "代码猫",   talent: "编码+15%", hungerBonus: 0, skillBonus: { coding: 0.15 } },
      fox:   { name: "狐狐", icon: "🦊", avatar: "fox",   label: "探索狐",   talent: "探索+15%", hungerBonus: 0, skillBonus: { research: 0.15 } },
      bird:  { name: "鸟鸟", icon: "🐦", avatar: "bird",  label: "文鸟",     talent: "表达+15%", hungerBonus: 0, skillBonus: { writing: 0.15 } },
      bug:   { name: "虫虫", icon: "🪲", avatar: "bug",   label: "调试虫",   talent: "调试+15%", hungerBonus: 0, skillBonus: { debug: 0.15 } }
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
      // 集齐**全部**成就才给彩虹蛋。门槛跟成就表走、不写死数字：
      // 将来成就表加了条目，这个门槛自动跟着涨。旧值 20 比成就表（14 枚）大，
      // 永远触发不了，等于这条里程碑形同虚设。
      { id: "ach_all",   egg: "rainbow", test: function (g) { return g.achievementsUnlockedAllTime >= ACHIEVEMENTS.length; } },
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
