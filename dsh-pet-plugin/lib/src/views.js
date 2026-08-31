
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
        // 底座图：APNG 自身 8 帧 sin 浮沉动画（图片动画不受宿主 reduced-motion 影响）。
        // 不再挂 CSS bob 类——两层位移叠加会抖。
        h("img", Object.assign({}, common, {
          src: base,
          className: "dshpet-whale dshpet-whale-sprite",
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
    function renderPanel(state, config, store) {
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
        pickDailyQuests(state.daily.day).forEach(function (quest) {
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
          var stars = masteryStarsOf(typeof skill.mastery === "number" ? skill.mastery : 0, config);
          rows.push(h(
            "div",
            {
              key: "s-" + item.key,
              className: "dshpet-skill",
              title: item.label + " · " + (full
                ? "满级" + (stars !== "" ? " · 精通 " + stars : "")
                : String(skill.xp) + "/" + String(need) + " 到 Lv." + String(skill.level + 1))
            },
            item.icon + " " + item.label,
            h("span", { className: "dshpet-skill-n" }, "Lv." + String(skill.level) + (stars !== "" ? " " + stars : "")),
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
        // 头部：标题 + 关闭按钮（重新排版后信息从这收口）。
        h("div", { className: "dshpet-panel-head" },
          h("span", { className: "dshpet-panel-head-title" }, "成就与任务"),
          h("button", {
            className: "dshpet-close-btn",
            type: "button",
            "aria-label": "关闭成就与任务",
            onClick: function (event) {
              stopBubbling(event);
              store.togglePanel();
            }
          }, "✕")),
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

      // 面板式展开（和成就/任务面板同款）：在卡片上方弹出，显式 pointer-events:auto，
      // 不依赖全屏遮罩——宿主对插件根的 pointer-events 约束不会影响这里。
      return h("div", {
        className: "dshpet-addpet-dialog",
        onClick: function (e) { stopBubbling(e); },
        onPointerDown: function (e) { e.stopPropagation(); }
      },
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
        // popover 展开方向：下方空间不足 320px 就向上弹（避免立绘放大后超框）。
        var popoverUpHook = React.useState(false);
        var popoverUp = popoverUpHook[0];
        var setPopoverUp = popoverUpHook[1];
        // 改名：是否显示输入框 + 输入值。
        var renameOpenHook = React.useState(false);
        var renameOpen = renameOpenHook[0];
        var setRenameOpen = renameOpenHook[1];
        var renameValHook = React.useState("");
        var renameVal = renameValHook[0];
        var setRenameVal = renameValHook[1];

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

        React.useEffect(function () {
          if (state.miniGame === null || state.miniGame.finished) return;
          var remaining = state.miniGame.deadline - Date.now();
          if (remaining <= 0) { store.failMiniGame(); return; }
          var timer = setTimeout(function () { store.failMiniGame(); }, remaining);
          return function () { clearTimeout(timer); };
        }, [state.miniGame === null ? null : state.miniGame.current,
            state.miniGame === null ? null : state.miniGame.finished]);

        var pet = state.pet;
        var fullness = 100 - pet.hunger;
        var expNeed = pet.level * EXP_PER_LEVEL;
        var expRatio = Math.min(100, Math.round(pet.exp / expNeed * 100));
        var showCombo = state.comboCount >= 2;
        // 饿了只是表现层的告警：hunger 封顶 100，宠物不会真的饿死。
        var hungry = pet.hunger >= config.hungryAt;
        var starving = hungry && config.vitalsEnabled && pet.mood <= config.moodExpFreezeAt;
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
                "data-tier": state.comboTier,
                "data-frenzy": frenzy ? "true" : undefined
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
            state.panelOpen ? renderPanel(state, config, store) : null,
            h(
              "div",
              {
                className: "dshpet-card",
                "data-tier": state.comboTier,
                "data-hungry": hungry ? "true" : undefined,
                "data-starving": starving ? "true" : undefined,
                "data-stage": look.key,
                "data-asleep": state.asleep ? "true" : undefined,
                "data-buff": frenzy ? "frenzy" : undefined,
                "data-dragging": state.dragging ? "true" : undefined,
                "data-dim": dim === null ? undefined : dim.key,
                // 小动作挂在卡片上（而不是头像上）：几条 idle 各动一个部件，
                // 用一个 data-idle 派发比给每个部件加类干净。
                "data-idle": state.idleAct === null ? undefined : state.idleAct,
                // 收纳面板与成就/任务面板互斥：成就开着时 popover 不展开，避免两层浮层重叠。
                "data-detail-open": detailOpen && !state.panelOpen ? "true" : undefined,
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
                { className: "dshpet-popover" + (popoverUp ? " dshpet-popover-up" : ""),
                  // 面板内点击不冒泡到卡片：卡片 onClick 会折叠 meta，输入框会被一起关掉。
                  onClick: function (event) { stopBubbling(event); },
                  onPointerDown: function (event) { event.stopPropagation(); } },
                // 头部：标题 + 关闭按钮（重新排版后信息从这收口）。
                h("div", { className: "dshpet-popover-head" },
                  h("span", { className: "dshpet-popover-title" }, "宠物详情"),
                  h("button", {
                    className: "dshpet-close-btn",
                    type: "button",
                    "aria-label": "关闭详情",
                    onClick: function (event) {
                      stopBubbling(event);
                      setDetailOpen(false);
                    }
                  }, "✕")),
                collapsed
                  ? null
                  : h(
                    "div",
                    { className: "dshpet-meta" },
                  h("div", { className: "dshpet-name" },
                    pet.name + " · Lv." + String(pet.level) + " " + look.label + (state.prestige > 0 ? " · 🔄" + String(state.prestige) : ""),
                    // 收藏星
                    state.petCount > 1
                      ? h("button", {
                        className: "dshpet-fav",
                        type: "button",
                        "data-active": store.isFavorite() ? "true" : undefined,
                        "aria-label": store.isFavorite() ? "取消收藏" : "收藏",
                        onClick: function (event) { stopBubbling(event); store.toggleFavorite(); }
                      }, store.isFavorite() ? "★" : "☆")
                      : null,
                    // 改名按钮：打开内联输入框
                    h("button", {
                      className: "dshpet-rename-btn",
                      type: "button",
                      "aria-label": renameOpen ? "收起改名" : "改名",
                      title: "改名",
                      onClick: function (event) {
                        stopBubbling(event);
                        setRenameVal(pet.name);
                        setRenameOpen(!renameOpen);
                      }
                    }, "✏️")
                  ),
                  // 改名输入行：回车或点确定生效
                  renameOpen
                    ? h("div", { className: "dshpet-rename-row" },
                      h("input", {
                        className: "dshpet-rename-input",
                        type: "text",
                        value: renameVal,
                        maxLength: 20,
                        placeholder: "新名字（20 字内）",
                        onChange: function (event) { setRenameVal(event.target.value); },
                        onKeyDown: function (event) {
                          if (event.key === "Enter") {
                            event.stopPropagation();
                            if (store.renamePet(renameVal)) setRenameOpen(false);
                          }
                        }
                      }),
                      h("button", {
                        className: "dshpet-rename-ok",
                        type: "button",
                        onClick: function (event) {
                          stopBubbling(event);
                          if (store.renamePet(renameVal)) setRenameOpen(false);
                        }
                      }, "确定"))
                    : null,
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
                  state.talent
                    ? h("div", { className: "dshpet-sub dshpet-talent" }, "🎁 天赋：" + state.talent)
                    : null,
                  config.prestigeEnabled && pet.level >= config.prestigeMinLevel
                    ? h("button", {
                      className: "dshpet-prestige-btn",
                      type: "button",
                      title: "轮回：重置等级和技能，永久经验加成 +" + String(Math.round((state.prestige + 1) * config.prestigeExpBonus * 100)) + "%",
                      onClick: function (event) {
                        stopBubbling(event);
                        if (typeof window !== "undefined" && typeof window.confirm === "function") {
                          if (!window.confirm("确定要轮回吗？\n\n等级和技能会重置，但获得永久经验加成 +" + String(Math.round((state.prestige + 1) * config.prestigeExpBonus * 100)) + "%\n\n成就、记忆、累计数据都会保留。")) return;
                        }
                        store.prestige();
                      }
                    }, "🔄 轮回" + (state.prestige > 0 ? "（第 " + String(state.prestige + 1) + " 世）" : ""))
                    : null,
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
                    + " " + FOOD_ICON.tool_result.small + formatTokens(state.tokensBySource.tool_result)),
                  h("button", {
                    className: "dshpet-card-btn",
                    type: "button",
                    title: "生成名片",
                    onClick: function (event) { stopBubbling(event); store.generateCard(); }
                  }, "📤 名片")
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
              // 微游戏按钮
              config.miniGameEnabled
                ? h("button", {
                  className: "dshpet-mg-btn",
                  type: "button",
                  title: "玩个小游戏",
                  "aria-label": "小游戏",
                  onClick: function (event) {
                    stopBubbling(event);
                    store.startMiniGame();
                  }
                }, "🎮")
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
                    // 收起收纳面板再开成就面板（两者互斥，避免浮层重叠）。
                    setDetailOpen(false);
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
                  // 打开前量一下卡片下方空间：不够就把面板往上弹，防超框。
                  var cardEl = event.currentTarget.closest(".dshpet-card");
                  var up = false;
                  if (cardEl !== null) {
                    var rect = cardEl.getBoundingClientRect();
                    up = (window.innerHeight - rect.bottom) < 320;
                  }
                  // 成就/任务面板开着时先收起它（两者互斥，避免浮层重叠）。
                  if (state.panelOpen) store.togglePanel();
                  setPopoverUp(up);
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
            state.addPetOpen ? h(AddPetDialog, { store: store }) : null,
            state.miniGame !== null
              ? h("div", { className: "dshpet-minigame" },
                state.miniGame.targets.map(function (target) {
                  return h("span", {
                    key: "mg-" + String(target.id),
                    className: "dshpet-mg-target",
                    "data-caught": target.caught ? "true" : undefined,
                    style: { left: String(target.x) + "%", top: String(target.y) + "%" },
                    onClick: function (event) {
                      stopBubbling(event);
                      store.hitMiniGameTarget(target.id);
                    }
                  }, target.icon);
                }),
                state.miniGame.finished
                  ? h("span", { className: "dshpet-mg-result" },
                    state.miniGame.success ? "🎉 通关！" : "💨 下次加油")
                  : null
              )
              : null,
            state.cardDataUrl !== null
              ? h("div", {
                className: "dshpet-card-overlay",
                onClick: function (event) { stopBubbling(event); store.dismissCard(); },
                onPointerDown: function (event) { event.stopPropagation(); }
              }, h("img", {
                className: "dshpet-card-img",
                src: state.cardDataUrl,
                alt: "宠物名片",
                title: "右键另存为图片，点击关闭"
              }))
              : null
          )
        );
      };
    }

    //#endregion
