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
     * 每日任务池。每天从中挑 DAILY_QUEST_COUNT 条（见 pickDailyQuests）。
     * `of` 从当天的计数里取进度，`goal` 是达成线；达成即时结算，
     * 不需要点「领取」——多一个按钮不如少一步操作。
     */
    var DAILY_QUEST_POOL = [
      { id: "feeds", icon: "🍽", label: "今日喂食 10 次", goal: 10, of: function (d) { return d.feeds; } },
      { id: "tools", icon: "🛠", label: "今日 5 次工具结果", goal: 5, of: function (d) { return d.tools; } },
      { id: "combo", icon: "🔥", label: "今日打到 7 连击", goal: 7, of: function (d) { return d.bestCombo; } },
      { id: "feeds20", icon: "🍽", label: "今日喂食 20 次", goal: 20, of: function (d) { return d.feeds; } },
      { id: "feeds5", icon: "🍽", label: "今日喂食 5 次", goal: 5, of: function (d) { return d.feeds; } },
      { id: "pats5", icon: "💗", label: "今日摸头 5 次", goal: 5, of: function (d) { return d.pats; } },
      { id: "pats15", icon: "💗", label: "今日摸头 15 次", goal: 15, of: function (d) { return d.pats; } },
      { id: "tok10k", icon: "💠", label: "今日消耗 10k token", goal: 10000, of: function (d) { return d.tokens; } },
      { id: "tok50k", icon: "💠", label: "今日消耗 50k token", goal: 50000, of: function (d) { return d.tokens; } },
      { id: "tools15", icon: "🛠", label: "今日 15 次工具结果", goal: 15, of: function (d) { return d.tools; } },
      { id: "snacks3", icon: "🍬", label: "今日喂 3 次零食", goal: 3, of: function (d) { return d.snacks; } },
      { id: "combo10", icon: "🔥", label: "今日打到满连击", goal: 10, of: function (d) { return d.bestCombo; } }
    ];

    /** 每天从池子里挑几条。 */
    var DAILY_QUEST_COUNT = 3;

    /**
     * 按日序号从池子里挑当天的任务。同一天的结果相同（确定性伪随机），
     * 散列用 fmix32（和 pickLineIndex 同一套），保证每天换三条且不重复。
     * @param dayIndex - 日序号（dayIndexOf 的结果）。
     * @returns 当天的任务数组。
     */
    function pickDailyQuests(dayIndex) {
      var pool = DAILY_QUEST_POOL.slice();
      var picked = [];
      var seed = dayIndex;
      for (var i = 0; i < DAILY_QUEST_COUNT && pool.length > 0; i += 1) {
        seed ^= seed >>> 16;
        seed = Math.imul(seed, 0x85ebca6b);
        seed ^= seed >>> 13;
        seed = Math.imul(seed, 0xc2b2ae35);
        seed ^= seed >>> 16;
        var idx = (seed >>> 0) % pool.length;
        picked.push(pool[idx]);
        pool.splice(idx, 1);
      }
      return picked;
    }

    /** 任务 id → 条目（全池，sanitizeIds 要按它过白名单）。 */
    var QUEST_BY_ID = {};
    DAILY_QUEST_POOL.forEach(function (item) { QUEST_BY_ID[item.id] = item; });

    /**
     * 台词表。每种场合一池子，取哪句由 pickLineIndex 决定 ——
     * **不用 Math.random**：同一串事件说的话必须可复现（冒烟测试要断言台词，
     * 排查「它刚才为什么说这句」也得能重放）。见 pickLineIndex 的说明。
     */
    var BUBBLE_LINES = {
      user_input: ["你说话啦？", "嗯嗯，我在听", "这个我记下了", "说吧说吧", "唔，让我想想…", "收到！", "你的字有点好吃", "等等我消化一下", "好的好的～", "然后呢然后呢", "嗯…有道理", "你的打字速度好快"],
      generation: ["模型又说了一大段…", "读得饱饱的", "这段有点长", "唔…信息量好大", "慢点说，我还在嚼", "这一段够我消化一会儿", "又是一大盘字", "字好多…我慢慢看", "唔这口好大", "满满一整盘", "我努力在消化了", "这一口有营养"],
      tool_result: ["工具跑完了！", "这一锅真香", "再来一个工具！", "热的！趁热吃", "这个有嚼头", "工具的味道最正", "还有吗还有吗", "又吃到好东西了", "嗯！这口正", "刚出炉的最好吃", "下一道！", "工具料理是我的最爱"],
      feast: ["好大一锅！", "吃不下了…还能再来一口", "这么大一份？！", "我的天，这一盘", "撑…但是值得", "这一口顶三口", "肚子要撑爆了", "份量好足！", "今天赢麻了"],
      favorite: ["这个我最爱！", "就是这个味儿！", "呜哇，是这个！", "等的就是它", "再来一份好不好", "对味儿了！", "天天吃这个都行！", "这一口值了", "嘿嘿我的最爱"],
      bored: ["又是这个…有点腻了", "换个口味嘛", "唔…我吃过很多这个了", "能不能来点别的", "有点吃伤了", "还是这个味道啊", "能来点新花样吗", "连着吃好几口了…", "吃伤了吃伤了"],
      frenzy: ["开吃！！", "全都端上来！", "我的时代来了！", "别停别停别停", "冲！！", "这波我能吃很多", "暴风吸入！！", "我能吞下整个宇宙！", "食力全开！！"],
      hungry: ["肚子空了…", "有零食吗？", "咕…", "我我我饿了", "看看我，饿着呢", "喂点东西嘛…", "肚子在叫了…", "再不吃要饿晕了", "我瘦了…"],
      snack: ["糖！", "谢谢～", "甜的！", "还有吗？", "你最好了", "唔…幸福", "好甜好开心", "这颗糖真好吃", "嘿嘿你对我真好"],
      sleep: ["Zzz…", "先睡一会儿…", "困了…", "睡一下就好…", "呼…呼…", "梦里也有工具结果吗…", "打个盹…", "眼睛合上了…", "五分钟…就五分钟…"],
      wake: ["呼啊——我醒了", "我睡了多久？", "唔…醒了醒了", "刚做了个梦…", "咦，你回来了", "伸个懒腰——", "我是不是睡太久了", "精神回来了！", "活力充沛！"],
      pat: ["嘿嘿", "还要摸", "舒服～", "哼哼…再来", "唔…喜欢", "摸摸头最棒了", "尾巴也可以摸的", "嗯嗯嗯", "好开心…", "你手好暖", "再摸一下嘛"],
      pat_more: ["还、还要吗…", "唔…头发乱了", "别停别停", "咕噜咕噜…", "我要化了…", "你今天好黏人", "再这样我要飘起来了", "整个人都酥了…", "嘿嘿嘿嘿嘿"],
      evolve: ["我长大了！", "看看我！变样了吧", "这就是成长吗", "换了个模样！", "我是不是变帅了", "新形态解锁！"],
      morph: ["我变成这样了！", "这就是我们走的路", "跟你学的", "从今天起我是这个样子", "这就是和你在一起的证据"],
      achieve: ["达成！", "我做到了！", "记在小本本上", "厉害了我", "徽章到手！", "又解锁一个！"],
      quest: ["今天的任务完成了！", "今天的活干完了！", "任务清空，撒花", "打卡成功！", "今日份，达成"],
      skill: ["我好像变熟练了", "这活我上手了！", "手感来了", "我又会一点了", "熟练度 +1！", "越做越顺了", "我进步了！"],
      levelup: ["升级了！", "又强了一点", "Lv 往上跳了一格", "我在变强", "叮！经验值已满", "距离满级又近了"],
      combo: ["连上了！", "手速好快", "别停，接着来", "节奏起来了", "连连连！", "停不下来了"],
      full: ["饱了！", "吃不下了…", "撑到肚子鼓鼓的", "满了满了", "再也塞不下了", "饱到想躺平"],
      tired: ["有点困了…", "眼睛睁不开…", "精力见底了", "撑不住了…", "好想睡…", "充电中…"],
      sad: ["唔…有点难过", "你是不是不太理我了", "我不太开心…", "抱一下嘛", "心情有点低落", "能陪我说说话吗"],
      curious: ["这是什么？", "没见过这个…", "让我看看让我看看", "唔，新东西！", "这个我要记下来", "好奇心爆发了", "想知道更多！"],
      proud: ["嘿嘿，我厉害吧", "看到了吗看到了吗", "这个我在行", "哼哼～", "夸我一下嘛", "这波操作可以吧", "我超棒的！"],
      worried: ["唔…没事吧？", "有点不安…", "我们会好的吧", "要不要停一下…", "我有点担心你", "深呼吸深呼吸", "先别急…"],
      night: ["这么晚还在写代码？", "夜深了…要不歇了吧", "我陪着你，但你也别熬太久", "这个点了，眼睛还好吗", "星星都出来了，你还不睡？", "再写一会儿就睡吧"],
      marathon: ["歇会儿吧，你坐了好久了", "起来走两步？", "干了这么久了，喝口水", "我陪你到现在，你也该累了", "站起来动一动吧", "你的肩膀还好吗"]
    };

    /**
     * 动态台词模板：引用记忆/状态数据生成个性化台词。
     *
     * 每个模板是一个函数 (ctx) → string | null。ctx 包含当前 memory、state、
     * sessionEdits、skills 等上下文。返回 null 表示条件不满足、不说这句。
     *
     * 按场合分组：key 对应 BUBBLE_LINES 的 key，say() 挑句子时有概率走动态模板
     * 代替静态池。这样不改 say 的调用方、不动冷却逻辑，只是有时候说的是「活的话」。
     */
    var DYNAMIC_LINES = {
      user_input: [
        function (ctx) {
          if (ctx.totalFeeds < 10) return null;
          return "第 " + String(ctx.totalFeeds) + " 次喂我了，谢谢你一直在";
        },
        function (ctx) {
          if (ctx.togetherDays < 3) return null;
          return "我们在一起第 " + String(ctx.togetherDays) + " 天了";
        }
      ],
      generation: [
        function (ctx) {
          if (ctx.totalTokens < 10000) return null;
          return "累计吞了 " + formatTokens(ctx.totalTokens) + " tok 了，肚量变大了";
        },
        function (ctx) {
          if (ctx.pet.level < 3) return null;
          return "Lv." + String(ctx.pet.level) + " 的我消化能力变强了";
        }
      ],
      tool_result: [
        function (ctx) {
          if (!ctx.lastToolName) return null;
          return ctx.lastToolName + " 的味道我记住了！";
        },
        function (ctx) {
          var tools = ctx.memory.tools;
          if (tools.length === 0) return null;
          return "我最常吃的是 " + tools[0].name + " 做的菜";
        },
        function (ctx) {
          if (!ctx.lastToolName) return null;
          var tool = null;
          for (var i = 0; i < ctx.memory.tools.length; i++) {
            if (ctx.memory.tools[i].name === ctx.lastToolName) { tool = ctx.memory.tools[i]; break; }
          }
          if (tool === null || tool.count < 5) return null;
          return ctx.lastToolName + " 第 " + String(tool.count) + " 次了，我闭着眼都认得出";
        }
      ],
      pat: [
        function (ctx) {
          if (ctx.pats < 20) return null;
          return "你已经摸了我 " + String(ctx.pats) + " 次了哦";
        },
        function (ctx) {
          if (ctx.togetherDays < 2) return null;
          return "每天都摸摸我好不好";
        },
        function (ctx) {
          if (ctx.pet.mood >= 90) return "心情好到要飞起来了～";
          return null;
        }
      ],
      combo: [
        function (ctx) {
          if (ctx.streakCount < 3) return null;
          return "连续第 " + String(ctx.streakCount) + " 天了，节奏真好";
        }
      ],
      levelup: [
        function (ctx) {
          var stage = whaleStageOf(ctx.pet.level);
          if (stage === null) return null;
          return "Lv." + String(ctx.pet.level) + " 了！" + stage.label + "形态越来越强";
        }
      ],
      skill: [
        function (ctx) {
          if (!ctx.lastSkillUp) return null;
          var sk = SKILL_BY_ID[ctx.lastSkillUp];
          if (!sk) return null;
          return sk.label + "又进步了，继续加油！";
        }
      ],
      hungry: [
        function (ctx) {
          var files = ctx.memory.files;
          if (files.length === 0) return null;
          return "饿着肚子看 " + files[0].name + " 好难受…";
        }
      ],
      wake: [
        function (ctx) {
          if (ctx.togetherDays < 2) return null;
          return "新的一天！我们在一起 " + String(ctx.togetherDays) + " 天了";
        },
        function (ctx) {
          var files = ctx.memory.files;
          if (files.length === 0) return null;
          return "醒了！今天还写 " + files[0].name + " 吗？";
        }
      ]
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
      },
      /** @param file - 文件名。@param count - 改了几次。 */
      file_again: function (file, count) {
        return file + " 今天改了 " + String(count) + " 次了哦";
      },
      /** @param days - 连续到访天数。 */
      streak: function (days) {
        return "连续 " + String(days) + " 天都能见到你，好开心";
      },
      /** @param days - 相处天数。 */
      together: function (days) {
        return "不知不觉我们已经相处 " + String(days) + " 天了";
      },
      /** @param level - 宠物等级。 */
      growth: function (level) {
        return "Lv." + String(level) + " 了，一起走了好远呢";
      },
      /** @param tokens - 累计 token。 */
      tokens_milestone: function (tokens) {
        return "我们一共处理了 " + formatTokens(tokens) + " token，真是大工程";
      },
      /** @param skill - 技能名。@param level - 技能等级。 */
      skill_note: function (skill, level) {
        return "你的" + skill + "已经 Lv." + String(level) + " 了，我跟着你学了好多";
      },
      /** @param file - 最常改的文件。@param count - 总次数。 */
      file_expert: function (file, count) {
        return file + " 改了 " + String(count) + " 次了，你是不是很在意这个文件？";
      },
      /** @param errors - 总报错次数。@param recoveries - 恢复次数。 */
      resilience: function (errors, recoveries) {
        return "报过 " + String(errors) + " 次错，跨过 " + String(recoveries) + " 次…你很能扛呀";
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
