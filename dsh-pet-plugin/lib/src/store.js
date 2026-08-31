
    //#region 状态源

    /**
     * 拖拽状态管理器。从 createPetStore 里独立出来：拖拽是纯 UI 交互，
     * 不依赖宠物数值 / 气泡 / 技能等任何游戏状态，只读写自己的两个变量。
     * @returns 拖拽句柄。
     */
    function createDragManager() {
      var moved = false;
      var from = null;
      return {
        begin: function (x, y, pos) {
          from = { x: x, y: y, dx: pos.dx, dy: pos.dy };
          moved = false;
        },
        move: function (x, y, currentPos) {
          if (from === null) return null;
          var next = clampPos({
            dx: from.dx + (x - from.x),
            dy: from.dy + (y - from.y)
          });
          if (next.dx === currentPos.dx && next.dy === currentPos.dy) return null;
          if (Math.abs(x - from.x) + Math.abs(y - from.y) > 4) moved = true;
          return next;
        },
        end: function () {
          if (from === null) return false;
          from = null;
          return true;
        },
        consumeDrag: function () {
          var was = moved;
          moved = false;
          return was;
        },
        active: function () { return from !== null; }
      };
    }

    /**
     * 宠物 + 特效的可观察状态源。整个插件一份，Definition 写、overlay 组件读。
     * @param config - 生效配置。
     * @returns 状态源句柄。
     */
    function createPetStore(config) {
      var listeners = new Set();

      // ─── 连击与特效 ───
      var combo = createComboTracker(config);
      var comboTimer = 0;
      var effectSeq = 0;
      var buffTimer = 0;

      // ─── 数值结算（饥饿 / 心情 / 精力） ───
      var lastRegenAt = 0;
      var hungerCarry = 0;
      var moodCarry = 0;
      var energyCarry = 0;
      var dimCarry = { curiosity: 0, pride: 0, concern: 0 };
      var snackAt = 0;

      // ─── 气泡与台词 ───
      var lastBubbleAt = 0;
      var bubbleTimer = 0;
      var bubbleSeq = 0;
      var lastBubbleDim = false;
      var lineAt = {};

      // ─── 互动（摸头 / 小动作） ───
      var patAt = 0;
      var patRun = 0;
      var idleAt = 0;
      var idleSeq = 0;
      var idleTimer = 0;
      var idleLast = -1;

      // ─── 食性偏好 ───
      var tasteSource = null;
      var tasteCount = 0;

      // ─── 提示与关怀 ───
      var adviceAt = 0;
      var sessionEdits = {};
      var errorStreak = 0;
      var lastErrorTool = null;
      var toolFailStreak = 0;
      var careAt = 0;
      var activeSince = 0;
      var marathonSaid = false;
      var comebackMs = 0;

      // ─── 工具观察 ───
      var callNames = new Map();
      var lastToolName = null;
      var lastSkillUp = null;

      // ─── 拖拽（独立子系统） ───
      var drag = createDragManager();

      // ─── 微游戏 ───
      var miniGameAt = 0;

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
          addPetOpen: false,
          miniGame: null,
          cardDataUrl: null,
          talent: (PET_SPECIES[rec.species] && PET_SPECIES[rec.species].talent) || "",
          prestige: rec.prestige || 0
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
          memory: state.memory,
          prestige: state.prestige
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
        lastToolName = null;
        lastSkillUp = null;
        drag = createDragManager();
        miniGameAt = 0;
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
          var spHunger = PET_SPECIES[collection[activePetId].species];
          if (spHunger && spHunger.hungerBonus > 0) hungerRate *= (1 - spHunger.hungerBonus);
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
            + (pet.hunger >= config.hungryAt ? config.moodDropPerMinHungry : 0)
            + (pet.hunger >= 100 ? config.moodCrashPerMinStarving : 0);
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
       * 构造动态台词需要的上下文快照。从 store 闭包变量 + state 里提取，
       * 避免动态模板直接摸 store 内部（那样模板就不能在外面定义了）。
       */
      function buildDynamicCtx() {
        var memory = state.memory || { files: [], tools: [], hours: [], bornDay: dayIndexOf(Date.now()), errors: 0, recoveries: 0 };
        return {
          pet: state.pet,
          totalFeeds: state.totalFeeds,
          totalTokens: state.totalTokens,
          togetherDays: togetherDaysOf(memory, Date.now()),
          pats: state.pats,
          streakCount: state.streakCount,
          memory: memory,
          sessionEdits: sessionEdits,
          lastToolName: lastToolName,
          lastSkillUp: lastSkillUp,
          skills: state.skills
        };
      }

      /**
       * 说一句这个场合的台词。挑哪句走 pickLineIndex（确定性伪随机）而不是
       * Math.random —— 同一串事件说的话可复现，但听起来不像在背台词。
       *
       * 每 3 次尝试一句动态台词（引用记忆/状态的模板），条件不满足就回退静态池。
       * 这样高频用户不会总是听到一样的话，而且宠物会越来越「认识你」。
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
        // 每 3 次尝试一句动态台词（依赖记忆/状态数据的模板），条件不满足就回退静态池。
        var dynamic = DYNAMIC_LINES[kind];
        if (dynamic !== undefined && dynamic.length > 0 && config.dynamicLinesEvery > 0 && (bubbleSeq + 1) % config.dynamicLinesEvery === 0) {
          var ctx = buildDynamicCtx();
          var dIdx = pickLineIndex(dynamic.length, bubbleSeq + 1, -1);
          var text = dynamic[dIdx](ctx);
          if (text !== null) {
            if (!emitBubble(patch, kind, text, force)) return false;
            lastSkillUp = null;
            return true;
          }
        }
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
        return { day: today, feeds: 0, tools: 0, bestCombo: 0, pats: 0, tokens: 0, snacks: 0, done: [] };
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
          pats: base.pats + (delta.pats === undefined ? 0 : delta.pats),
          tokens: base.tokens + (delta.tokens === undefined ? 0 : delta.tokens),
          snacks: base.snacks + (delta.snacks === undefined ? 0 : delta.snacks),
          done: base.done
        };
        var todayQuests = pickDailyQuests(daily.day);
        var finished = [];
        for (var i = 0; i < todayQuests.length; i += 1) {
          var quest = todayQuests[i];
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
        var spSkill = PET_SPECIES[collection[activePetId].species];
        var skillBonus = spSkill && spSkill.skillBonus && spSkill.skillBonus[key] ? spSkill.skillBonus[key] : 0;
        var adjustedXp = skillBonus > 0 ? Math.max(1, Math.round(xp * (1 + skillBonus))) : xp;
        var base = patch.skills === undefined ? state.skills : patch.skills;
        var result = gainSkill(base, key, adjustedXp, config);
        if (result.skills === base) return;
        patch.skills = result.skills;
        result.ups.forEach(function (up) {
          var item = SKILL_BY_ID[up.key];
          lastSkillUp = up.key;
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
        if (result.masteryUps !== undefined && result.masteryUps.length > 0) {
          result.masteryUps.forEach(function (up) {
            var item = SKILL_BY_ID[up.key];
            var stars = masteryStarsOf(up.tier * config.masteryXpPerTier, config);
            appendNotice(patch, "⭐", "精通 · " + item.label + " " + stars, "mastery", "gold");
          });
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
       * 引用记忆搭一句话。按「有辨识度」的优先级逐条尝试，都走 chat 的长冷却，
       * 所以实际上半小时最多听见一句。触发条件比以前宽松：工具用到 10 次整数倍
       * 就说（不再等 20）、session 里同文件改了 N 次也提一嘴、连续到访/相处天数
       * /技能/等级/累计 token 到整数倍也能搭话。
       * @param patch - 正在攒的 patch。
       * @param call - observeToolCall 的结果。
       * @param now - 当前时刻（epoch ms）。
       */
      function chatMemory(patch, call, now) {
        if (!config.memoryEnabled) return;
        var memory = patch.memory === undefined ? state.memory : patch.memory;
        var pet = patch.pet === undefined ? state.pet : patch.pet;
        // 又在动那个改得最多的文件。
        if (call.file !== null && memory.files.length > 0 && memory.files[0].name === call.file) {
          if (memory.files[0].count >= 5 && chat(patch, "chat", CHAT_LINES.favorite_file(call.file), now)) {
            return;
          }
        }
        // session 里同文件改了好几次（比记忆的 count 更即时，不等 advise 那道冷却）。
        if (call.file !== null && sessionEdits[call.file] !== undefined) {
          var edits = sessionEdits[call.file];
          if (edits >= 4 && edits % 4 === 0) {
            if (chat(patch, "chat", CHAT_LINES.file_again(call.file, edits), now)) return;
          }
        }
        // 某个工具用到 10 的整数倍。
        var tool = null;
        for (var i = 0; i < memory.tools.length; i += 1) {
          if (memory.tools[i].name === call.name) tool = memory.tools[i];
        }
        if (tool !== null && tool.count >= 10 && tool.count % 10 === 0) {
          if (chat(patch, "chat", CHAT_LINES.tool_habit(tool.name, tool.count), now)) return;
        }
        // 连续到访达到里程碑。
        if (state.streakCount >= 3 && state.streakCount % 3 === 0) {
          if (chat(patch, "chat", CHAT_LINES.streak(state.streakCount), now)) return;
        }
        // 相处天数到整周。
        var days = togetherDaysOf(memory, now);
        if (days >= 7 && days % 7 === 0) {
          if (chat(patch, "chat", CHAT_LINES.together(days), now)) return;
        }
        // 技能到一个新的偶数级。
        var skills = patch.skills === undefined ? state.skills : patch.skills;
        for (var si = 0; si < SKILLS.length; si += 1) {
          var sk = skills[SKILLS[si].key];
          if (sk !== undefined && sk.level >= 4 && sk.level % 2 === 0) {
            var label = SKILL_BY_ID[SKILLS[si].key].label;
            if (chat(patch, "chat", CHAT_LINES.skill_note(label, sk.level), now)) return;
            break;
          }
        }
        // 等级到整十级。
        if (pet.level >= 10 && pet.level % 10 === 0) {
          if (chat(patch, "chat", CHAT_LINES.growth(pet.level), now)) return;
        }
        // 累计 token 到 100k 整数倍。
        if (state.totalTokens >= 100000 && state.totalTokens % 100000 < 3000) {
          if (chat(patch, "chat", CHAT_LINES.tokens_milestone(state.totalTokens), now)) return;
        }
        // 文件已经是老朋友了（总计改过 20 次以上）。
        if (call.file !== null && memory.files.length > 0) {
          for (var fi = 0; fi < memory.files.length; fi += 1) {
            if (memory.files[fi].name === call.file && memory.files[fi].count >= 20 && memory.files[fi].count % 10 === 0) {
              if (chat(patch, "chat", CHAT_LINES.file_expert(call.file, memory.files[fi].count), now)) return;
              break;
            }
          }
        }
        // 报错和恢复统计到里程碑。
        if (memory.recoveries >= 10 && memory.recoveries % 25 === 0) {
          if (chat(patch, "chat", CHAT_LINES.resilience(memory.errors, memory.recoveries), now)) return;
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
          var prestigeBonus = 1 + (state.prestige || 0) * config.prestigeExpBonus;
          var expFactor = multiplier
            * vitalFactorOf(pet, config)
            * (frenzy ? config.frenzyExpFactor : 1)
            * prestigeBonus;
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
            combo: count,
            tokens: tokens
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
          // 随机掉蛋：每次喂食有小概率获得一枚蛋（里程碑之外的惊喜通道）
          if (config.eggDropEnabled && eggs.length < MAX_EGGS) {
            var dropChance = config.eggDropBaseChance + count * config.eggDropComboBonus;
            var dropSeed = state.totalFeeds * 2654435761;
            dropSeed ^= dropSeed >>> 16;
            dropSeed = Math.imul(dropSeed, 0x85ebca6b);
            dropSeed ^= dropSeed >>> 13;
            var dropRoll = (dropSeed >>> 0) / 4294967296;
            if (dropRoll < dropChance) {
              var eggPool = ["ocean", "forest", "code", "spark", "circuit"];
              var eggPick = (dropSeed >>> 0) % eggPool.length;
              var droppedEgg = {
                id: "egg-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4),
                type: eggPool[eggPick],
                obtainedAt: Date.now()
              };
              eggs.push(droppedEgg);
              var dropType = EGG_TYPE_BY_KEY[droppedEgg.type];
              var dropPatch = { eggs: eggs.slice() };
              effectSeq += 1;
              var eggEffect = {
                key: "fx" + String(effectSeq),
                icon: "🥚",
                text: "掉落 · " + (dropType ? dropType.label : "蛋"),
                foodAmount: 0, expAmount: 0, tokens: 0,
                foodTier: "large", source: "egg_drop",
                comboCount: 0, comboMultiplier: 1,
                tier: "gold", flight: LOCAL_FLIGHT
              };
              dropPatch.effects = state.effects.concat([eggEffect]);
              setTimeout(function () { dropEffect(eggEffect.key); }, config.effectTtlMs);
              commit(dropPatch);
            }
          }
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
          lastToolName = call.name;
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
          patch.pet = applyDaily(patch, patch.pet, now, { feeds: 1, snacks: 1 });
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
          if (drag.consumeDrag()) return false;
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
          patch.pet = applyDaily(patch, patch.pet, now, { pats: 1 });
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
          drag.begin(x, y, state.pos);
          commit({ dragging: true }, true);
        },
        moveDrag: function (x, y) {
          var next = drag.move(x, y, state.pos);
          if (next !== null) commit({ pos: next, dragging: true }, true);
        },
        dragged: function () {
          return drag.consumeDrag();
        },
        endDrag: function () {
          if (drag.end()) commit({ dragging: false });
        },

        // ─── 微游戏 ───
        startMiniGame: function () {
          if (!config.miniGameEnabled) return false;
          var now = Date.now();
          if (miniGameAt !== 0 && now - miniGameAt < config.miniGameCooldownMs) return false;
          if (state.miniGame !== null) return false;
          miniGameAt = now;
          var icons = ["🥕", "🐟", "🍖", "🌽", "🍗", "🍤", "🍲"];
          var targets = [];
          for (var i = 0; i < config.miniGameTargets; i++) {
            var seed = now + i * 7919;
            seed ^= seed >>> 16;
            seed = Math.imul(seed, 0x85ebca6b);
            seed ^= seed >>> 13;
            targets.push({
              id: i,
              icon: icons[(seed >>> 0) % icons.length],
              x: 10 + ((seed >>> 0) % 60),
              y: 10 + (((seed >>> 8) >>> 0) % 50),
              caught: false
            });
          }
          commit({
            miniGame: {
              targets: targets,
              current: 0,
              startedAt: now,
              deadline: now + config.miniGameTimeoutMs,
              score: 0,
              finished: false,
              success: false
            }
          }, true);
          return true;
        },
        hitMiniGameTarget: function (targetId) {
          if (state.miniGame === null || state.miniGame.finished) return;
          var game = state.miniGame;
          if (targetId !== game.current) return;
          var now = Date.now();
          if (now > game.deadline) {
            commit({
              miniGame: Object.assign({}, game, { finished: true, success: false })
            }, true);
            setTimeout(function () { commit({ miniGame: null }, true); }, 1500);
            return;
          }
          var nextTarget = game.current + 1;
          var targets = game.targets.map(function (t) {
            return t.id === targetId ? Object.assign({}, t, { caught: true }) : t;
          });
          if (nextTarget >= game.targets.length) {
            var pet = settleVitals(now);
            var patch = {
              miniGame: Object.assign({}, game, {
                targets: targets, current: nextTarget, finished: true, success: true, score: game.targets.length
              }),
              pet: feedPet(pet, 0, config.miniGameExpReward, config.miniGameMoodReward, 0)
            };
            if (config.miniGameSnackReward > 0) {
              patch.snacks = Math.min(config.manualSnackMax, state.snacks + config.miniGameSnackReward);
            }
            appendNotice(patch, "🎮", "小游戏通关！+" + String(config.miniGameExpReward) + "⭐", "minigame", "gold");
            say(patch, "proud", true);
            bumpDim(patch, "pride", config.pridePerWin);
            commit(patch);
            setTimeout(function () { commit({ miniGame: null }, true); }, 2000);
          } else {
            commit({
              miniGame: Object.assign({}, game, {
                targets: targets, current: nextTarget,
                deadline: now + config.miniGameTimeoutMs
              })
            }, true);
          }
        },
        failMiniGame: function () {
          if (state.miniGame === null || state.miniGame.finished) return;
          var pet = settleVitals(Date.now());
          var patch = {
            miniGame: Object.assign({}, state.miniGame, { finished: true, success: false }),
            pet: feedPet(pet, 0, 0, 5, 0)
          };
          say(patch, "sad", false);
          commit(patch);
          setTimeout(function () { commit({ miniGame: null }, true); }, 1500);
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
        /** 给当前宠物改名（1-20 字，空名忽略）。改名会写入存档。 */
        renamePet: function (name) {
          var trimmed = String(name === null || name === undefined ? "" : name).trim().slice(0, 20);
          if (trimmed === "") return false;
          activeRecord.name = trimmed;
          saveActiveToCollection();
          var newState = stateFromRecord(activeRecord);
          newState.panelOpen = state.panelOpen;
          newState.eggPanelOpen = state.eggPanelOpen;
          newState.addPetOpen = state.addPetOpen;
          state = newState;
          persist.schedule();
          listeners.forEach(function (listener) { listener(); });
          return true;
        },
        getCollection: function () { return collection; },
        getEggs: function () { return eggs; },
        getGlobalStats: function () { return globalStats; },
        isFavorite: function () { return favorites.indexOf(activePetId) >= 0; },

        generateCard: function () {
          var pet = state.pet;
          var look = lookOf(pet);
          var memory = state.memory;
          var skills = state.skills;
          var W = 320;
          var H = 420;
          var canvas;
          try { canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H; } catch (e) { return; }
          var cx = canvas.getContext("2d");
          if (!cx) return;
          var sp = PET_SPECIES[collection[activePetId].species] || PET_SPECIES.whale;
          var gradColors = {
            whale: ["#1a2a6c", "#b21f1f", "#fdbb2d"],
            cat: ["#2c3e50", "#4ca1af", "#c4e0e5"],
            fox: ["#f12711", "#f5af19", "#ffecd2"],
            bird: ["#2193b0", "#6dd5ed", "#e8f4f8"],
            bug: ["#134e5e", "#71b280", "#e8f5e9"]
          };
          var speciesKey = collection[activePetId].species || "whale";
          var grad = cx.createLinearGradient(0, 0, W, H);
          var gc = gradColors[speciesKey] || gradColors.whale;
          grad.addColorStop(0, gc[0]); grad.addColorStop(0.5, gc[1]); grad.addColorStop(1, gc[2]);
          cx.fillStyle = grad;
          if (typeof cx.roundRect === "function") { cx.beginPath(); cx.roundRect(0, 0, W, H, 16); cx.fill(); }
          else { cx.fillRect(0, 0, W, H); }
          cx.fillStyle = "rgba(255,255,255,0.15)";
          if (typeof cx.roundRect === "function") { cx.beginPath(); cx.roundRect(12, 12, W - 24, H - 24, 12); cx.fill(); }
          else { cx.fillRect(12, 12, W - 24, H - 24); }
          cx.textAlign = "center";
          cx.font = "48px serif";
          cx.fillText(sp.icon, W / 2, 70);
          cx.fillStyle = "#fff";
          cx.font = "bold 20px sans-serif";
          cx.fillText(pet.name, W / 2, 105);
          cx.font = "14px sans-serif";
          cx.fillText("Lv." + String(pet.level) + " " + look.label + (sp.talent ? " · " + sp.talent : ""), W / 2, 128);
          var ctrX = W / 2; var ctrY = 200; var rad = 55;
          var sKeys = ["coding", "research", "debug", "writing"];
          var sLabels = ["\u{1F4BB}编码", "\u{1F50D}探索", "\u{1F41B}调试", "✍️表达"];
          cx.strokeStyle = "rgba(255,255,255,0.3)"; cx.lineWidth = 1;
          for (var ring = 1; ring <= 3; ring++) {
            var rr = rad * ring / 3; cx.beginPath();
            for (var j = 0; j < 4; j++) { var a = (Math.PI / 2) * j - Math.PI / 2; var px = ctrX + rr * Math.cos(a); var py = ctrY + rr * Math.sin(a); if (j === 0) cx.moveTo(px, py); else cx.lineTo(px, py); }
            cx.closePath(); cx.stroke();
          }
          cx.fillStyle = "rgba(100,200,255,0.35)"; cx.strokeStyle = "rgba(100,200,255,0.8)"; cx.lineWidth = 2; cx.beginPath();
          for (var si = 0; si < 4; si++) { var sk = skills[sKeys[si]]; var val = sk ? sk.level / config.skillMaxLevel : 0; var sa = (Math.PI / 2) * si - Math.PI / 2; var sx = ctrX + rad * val * Math.cos(sa); var sy = ctrY + rad * val * Math.sin(sa); if (si === 0) cx.moveTo(sx, sy); else cx.lineTo(sx, sy); }
          cx.closePath(); cx.fill(); cx.stroke();
          cx.fillStyle = "#fff"; cx.font = "11px sans-serif";
          var lo = [[0, -rad - 12], [rad + 8, 4], [0, rad + 16], [-rad - 8, 4]];
          for (var li = 0; li < 4; li++) { var lsk = skills[sKeys[li]]; var ll = lsk ? lsk.level : 0; cx.textAlign = li === 1 ? "left" : li === 3 ? "right" : "center"; cx.fillText(sLabels[li] + " " + String(ll), ctrX + lo[li][0], ctrY + lo[li][1]); }
          cx.textAlign = "center";
          cx.fillStyle = "rgba(255,255,255,0.9)"; cx.font = "12px sans-serif";
          var days = togetherDaysOf(memory, Date.now());
          cx.fillText("\u{1F37D} " + String(state.totalFeeds) + " 次喜食 · \u{1F4A0} " + formatTokens(state.totalTokens) + " tok · \u{1F4C5} " + String(days) + " 天", W / 2, 280);
          var owned = state.achievements;
          if (owned.length > 0) {
            cx.font = "13px sans-serif"; cx.fillStyle = "rgba(255,255,255,0.7)";
            cx.fillText("成就 " + String(owned.length) + "/" + String(ACHIEVEMENTS.length), W / 2, 310);
            cx.font = "20px serif"; var achText = "";
            for (var ai = 0; ai < Math.min(owned.length, 10); ai++) { var ach = ACHIEVEMENT_BY_ID[owned[ai]]; if (ach) achText += ach.icon; }
            cx.fillText(achText, W / 2, 338);
          }
          cx.fillStyle = "rgba(255,255,255,0.5)"; cx.font = "10px sans-serif";
          cx.fillText("\u{1F433} 鲸鱼娘宠物插件 · deepseek-pet", W / 2, H - 20);
          var dataUrl = canvas.toDataURL("image/png");
          commit({ cardDataUrl: dataUrl }, true);
        },
        dismissCard: function () {
          commit({ cardDataUrl: null }, true);
        },

        prestige: function () {
          if (!config.prestigeEnabled) return false;
          var pet = state.pet;
          if (pet.level < config.prestigeMinLevel) return false;
          var newPrestige = (state.prestige || 0) + 1;
          var resetPet = {
            name: pet.name, species: pet.species, avatar: pet.avatar, icon: pet.icon,
            mood: 80, hunger: 60, energy: 75,
            curiosity: 0, pride: 0, concern: 0,
            exp: 0, level: 1, form: ""
          };
          var resetSkills = {};
          SKILLS.forEach(function (item) {
            var old = state.skills[item.key];
            resetSkills[item.key] = { xp: 0, level: 1, mastery: old ? (old.mastery || 0) : 0 };
          });
          var patch = {
            pet: resetPet,
            skills: resetSkills,
            prestige: newPrestige,
            snacks: config.manualSnackMax
          };
          collection[activePetId].prestige = newPrestige;
          appendNotice(patch, "🔄", "轮回 · 第 " + String(newPrestige) + " 世 · 经验+" + String(newPrestige * 5) + "%", "prestige", "epic");
          say(patch, "evolve", true);
          bumpDim(patch, "pride", config.pridePerWin * 2);
          commit(patch);
          return true;
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
      var current = new Map();
      var old = new Map();
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
          if (current.has(key) || old.has(key)) return false;
          current.set(key, now);
          if (current.size > 128) {
            old = current;
            current = new Map();
          }
          return true;
        }
      };
    }

    //#endregion
