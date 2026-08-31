
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
      if (pet.mood <= config.moodExpFreezeAt && pet.hunger >= config.hungryAt) return 0;
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
        skills[item.key] = from === undefined ? { xp: 0, level: 1, mastery: 0 } : from;
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
     * 精通经验 → 精通阶。
     * @param mastery - 精通经验。
     * @param config - 生效配置。
     * @returns 精通阶数（0 = 还没到第一阶）。
     */
    function masteryTierOf(mastery, config) {
      if (config.masteryXpPerTier <= 0) return 0;
      return Math.floor(mastery / config.masteryXpPerTier);
    }

    /**
     * 精通经验 → 星号文本。
     * @param mastery - 精通经验。
     * @param config - 生效配置。
     * @returns "★★" 之类的文本；还没到第一阶则 ""。
     */
    function masteryStarsOf(mastery, config) {
      var tier = masteryTierOf(mastery, config);
      if (tier <= 0) return "";
      var stars = "";
      var display = Math.min(tier, 5);
      for (var i = 0; i < display; i++) stars += "★";
      if (tier > 5) stars += "+" + String(tier - 5);
      return stars;
    }

    /**
     * 给一条技能加经验，够了就升级（可能连升几级）。形状对齐 feedPet：
     * 返回新对象，React 靠引用变化重渲染。
     *
     * 满级之后溢出的经验转入精通计数，每 masteryXpPerTier 一阶。
     * @param skills - 当前技能表。
     * @param key - 技能 key。
     * @param xp - 这次加多少经验。
     * @param config - 生效配置（读 skillXpPerLevel / skillMaxLevel / masteryXpPerTier）。
     * @returns { skills, ups, masteryUps }。
     */
    function gainSkill(skills, key, xp, config) {
      var from = skills[key];
      if (from === undefined || xp <= 0) return { skills: skills, ups: [], masteryUps: [] };
      var level = from.level;
      var have = from.xp + xp;
      var ups = [];
      while (level < config.skillMaxLevel && have >= skillNeedOf(level, config)) {
        have -= skillNeedOf(level, config);
        level += 1;
        ups.push({ key: key, level: level });
      }
      var mastery = typeof from.mastery === "number" ? from.mastery : 0;
      var masteryUps = [];
      if (level >= config.skillMaxLevel) {
        var cap = skillNeedOf(level, config) - 1;
        var overflow = have - cap;
        if (overflow > 0) {
          var oldTier = masteryTierOf(mastery, config);
          mastery += overflow;
          var newTier = masteryTierOf(mastery, config);
          for (var t = oldTier + 1; t <= newTier; t++) {
            masteryUps.push({ key: key, tier: t });
          }
          have = cap;
        }
      }
      var next = Object.assign({}, skills);
      next[key] = { xp: have, level: level, mastery: mastery };
      return { skills: next, ups: ups, masteryUps: masteryUps };
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
      var empty = { day: today, feeds: 0, tools: 0, bestCombo: 0, pats: 0, tokens: 0, snacks: 0, done: [] };
      if (value === null || typeof value !== "object") return empty;
      if (numberIn(value.day, 0, 1e9, -1) !== today) return empty;
      return {
        day: today,
        feeds: numberIn(value.feeds, 0, 1e6, 0),
        tools: numberIn(value.tools, 0, 1e6, 0),
        bestCombo: numberIn(value.bestCombo, 0, 1e6, 0),
        pats: numberIn(value.pats, 0, 1e6, 0),
        tokens: numberIn(value.tokens, 0, 1e12, 0),
        snacks: numberIn(value.snacks, 0, 1e6, 0),
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
          skills[item.key] = { xp: 0, level: 1, mastery: 0 };
          return;
        }
        var level = numberIn(from.level, 1, config.skillMaxLevel, 1);
        skills[item.key] = {
          xp: numberIn(from.xp, 0, skillNeedOf(level, config), 0),
          level: level,
          mastery: numberIn(from.mastery, 0, 1e9, 0)
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
        skills: { coding: { xp: 0, level: 0, mastery: 0 }, research: { xp: 0, level: 0, mastery: 0 }, debug: { xp: 0, level: 0, mastery: 0 }, writing: { xp: 0, level: 0, mastery: 0 } },
        memory: { files: [], tools: [], hours: new Array(24).fill(0), bornDay: dayIndexOf(Date.now()), errors: 0, recoveries: 0 },
        prestige: 0
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
        name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name.slice(0, 20) : "大肥鱼",
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
        memory: sanitizeMemory(raw.memory, config, today),
        prestige: numberIn(raw.prestige, 0, 1000, 0)
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
