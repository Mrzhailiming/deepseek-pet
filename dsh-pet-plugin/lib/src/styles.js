
    //#region 样式

    var STYLE_TAG_ID = "dsh-pet-plugin/overlay";

    var CSS = [
      /* 整层挂在 ui-layout 的 shell.overlay 里：默认穿透，只有宠物卡片吃指针事件。 */
      ".dshpet-root{position:absolute;right:20px;bottom:96px;z-index:40;pointer-events:none;contain:layout style;",
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
      /* 暴食时 combo 标签：火焰色高亮 + 放大 + 脉冲阴影。 */
      ".dshpet-combo[data-frenzy=true]{font-size:15px;color:#fff;text-shadow:0 0 8px rgba(255,100,0,.9),0 0 16px rgba(255,60,0,.5);",
      "background:linear-gradient(135deg,rgba(255,80,20,.85),rgba(255,160,40,.75));",
      "box-shadow:0 0 16px rgba(255,100,0,.6),0 0 32px rgba(255,60,0,.3);",
      "animation:dshpet-frenzy-combo-pulse 0.8s ease-in-out infinite alternate,dshpet-frenzy-shake 160ms ease-in-out 1}",

      ".dshpet-stage{position:relative}",

      ".dshpet-card{pointer-events:auto;position:relative;display:flex;align-items:center;gap:10px;contain:layout style;",
      "padding:8px 12px;border-radius:14px;cursor:pointer;user-select:none;",
      "color:var(--dsw-alias-label-primary,#eaeaea);",
      "background:var(--dsw-alias-bg-layer-2,rgba(22,22,26,.82));",
      "border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));",
      "box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.35))}",
      ".dshpet-card[data-tier=gold]{animation:dshpet-shake-light 320ms ease-in-out}",
      ".dshpet-card[data-tier=epic]{animation:dshpet-shake-strong 320ms ease-in-out}",
      /* 睡着了：整张卡片压暗一档，别在夜里发亮。 */
      ".dshpet-card[data-asleep=true]{opacity:.72}",
      /* 暴食 BUFF：强烈的火焰感——呼吸光晕 + 宠物放大 + 火焰粒子 + 底部暖光。 */
      ".dshpet-card[data-buff=frenzy]{border-color:rgba(255,140,40,.85);",
      "box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.35)),0 0 20px rgba(255,140,40,.5),0 0 40px rgba(255,80,20,.25);",
      "animation:dshpet-frenzy-pulse 1.2s ease-in-out infinite,dshpet-frenzy-shake 160ms ease-in-out 1}",
      ".dshpet-card[data-buff=frenzy] .dshpet-whale-sprite{transform:scale(1.08);transition:transform .4s cubic-bezier(.34,1.56,.64,1)}",
      ".dshpet-card[data-buff=frenzy] .dshpet-whale-sprite-bob{animation:dshpet-sprite-bob 2s ease-in-out infinite}",
      /* 暴食火焰粒子：卡片后面一层伪元素喷出上浮的火星。 */
      ".dshpet-card[data-buff=frenzy]::before{content:'';position:absolute;inset:-8px;border-radius:26px;pointer-events:none;z-index:-1;",
      "background:radial-gradient(ellipse at 50% 100%,rgba(255,120,30,.18) 0%,transparent 70%);",
      "animation:dshpet-frenzy-glow 1.6s ease-in-out infinite alternate}",
      ".dshpet-card[data-buff=frenzy]::after{content:'🔥';position:absolute;bottom:-2px;left:50%;font-size:18px;",
      "transform:translateX(-50%);animation:dshpet-frenzy-fire 0.8s ease-in-out infinite alternate;pointer-events:none;z-index:5;",
      "filter:drop-shadow(0 0 4px rgba(255,100,0,.6));text-shadow:0 0 6px rgba(255,80,0,.8)}",
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
      ".dshpet-card{padding:10px;border-radius:22px}",
      ".dshpet-card .dshpet-whale-sprite{width:192px!important;height:192px!important;border-radius:20px}",
      ".dshpet-card .dshpet-whale-sprite-bob{animation:dshpet-sprite-bob 3.2s ease-in-out infinite}",
      // 精灵底座的浮动用专门的名字：和下方 SVG 部件的 dshpet-whale-bob 是两个动画，
      // 同名的话后定义的会整条覆盖先定义的（CSS keyframes 同名后者生效）。
      "@keyframes dshpet-sprite-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}",
      ".dshpet-menu-btn{position:absolute;top:6px;right:6px;width:28px;height:28px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.05);color:#cfd3dc;font-size:14px;line-height:1;cursor:pointer;z-index:3;opacity:.65}",
      ".dshpet-menu-btn:hover{opacity:1;background:rgba(255,255,255,.12)}",
      ".dshpet-card[data-detail-open=true] .dshpet-menu-btn{opacity:1;background:rgba(242,199,68,.22);border-color:rgba(242,199,68,.85);color:#F2C744}",
      ".dshpet-popover{position:absolute;top:calc(100% + 10px);right:0;display:none;flex-direction:column;gap:10px;min-width:260px;max-height:min(60vh,480px);overflow-y:auto;padding:14px;border-radius:14px;background:var(--dsw-alias-bg-layer-2,rgba(20,20,26,.97));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.45));z-index:8}",
      ".dshpet-card[data-detail-open=true] .dshpet-popover{display:flex}",
      ".dshpet-popover-up{bottom:calc(100% + 10px);top:auto}",
      /* 两个浮层面板（收纳面板 / 成就任务面板）的头部与关闭按钮（共用样式） */
      ".dshpet-popover-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
      ".dshpet-popover-title{font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary,#f2f2f2)}",
      ".dshpet-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
      ".dshpet-panel-head-title{font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary,#f2f2f2)}",
      ".dshpet-close-btn{width:22px;height:22px;padding:0;border:none;border-radius:50%;background:rgba(255,255,255,.10);color:#cfd3dc;font-size:12px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}",
      ".dshpet-close-btn:hover{background:rgba(255,255,255,.22);color:#fff}",
      /* 改名：名字行内小铅笔 + 内联输入行 */
      ".dshpet-rename-btn{background:none;border:none;cursor:pointer;font-size:11px;padding:0 2px;color:#a9a9b2;line-height:1;vertical-align:middle}",
      ".dshpet-rename-btn:hover{color:#4d6bfe}",
      ".dshpet-rename-row{display:flex;gap:6px;align-items:center;margin-top:4px}",
      ".dshpet-rename-input{flex:1;min-width:0;box-sizing:border-box;border:1px solid rgba(255,255,255,.2);border-radius:6px;background:rgba(255,255,255,.06);color:#eaeaea;font-size:12px;padding:4px 8px;outline:none}",
      ".dshpet-rename-input:focus{border-color:#4d6bfe}",
      ".dshpet-rename-ok{background:#4d6bfe;color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;flex-shrink:0}",
      ".dshpet-rename-ok:hover{background:#2740c9}",
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

      /* 饥饿见底：灰化头像，提示经验冻结。 */
      ".dshpet-card[data-starving=true] .dshpet-whale{filter:saturate(0.2) brightness(0.85)}",
      ".dshpet-card[data-starving=true] .dshpet-avatar-stack{filter:saturate(0.2) brightness(0.85)}",

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

      /* 微游戏按钮与 QTE 浮层 */
      ".dshpet-mg-btn{background:none;border:1px solid rgba(100,100,255,.3);border-radius:6px;",
      "cursor:pointer;font-size:13px;padding:1px 5px;margin-left:4px;pointer-events:auto;transition:border-color .2s}",
      ".dshpet-mg-btn:hover{border-color:rgba(100,100,255,.6)}",
      ".dshpet-prestige-btn{background:linear-gradient(135deg,rgba(255,215,0,.2),rgba(255,140,0,.2));",
      "border:1px solid rgba(255,215,0,.4);border-radius:6px;cursor:pointer;font-size:11px;",
      "padding:2px 8px;margin-top:4px;pointer-events:auto;color:inherit;transition:border-color .2s}",
      ".dshpet-prestige-btn:hover{border-color:rgba(255,215,0,.7);",
      "background:linear-gradient(135deg,rgba(255,215,0,.3),rgba(255,140,0,.3))}",
      ".dshpet-minigame{position:absolute;left:-20px;top:-20px;right:-20px;bottom:-20px;pointer-events:auto;z-index:10}",
      ".dshpet-mg-target{position:absolute;cursor:pointer;font-size:22px;transition:transform .15s;",
      "user-select:none;animation:dshpet-mg-pop .3s ease-out}",
      ".dshpet-mg-target:hover{transform:scale(1.3)}",
      ".dshpet-mg-target[data-caught=true]{opacity:.3;pointer-events:none;transform:scale(.5)}",
      ".dshpet-mg-result{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);",
      "font-size:14px;font-weight:bold;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.5);",
      "pointer-events:none;animation:dshpet-mg-pop .4s ease-out}",

      /* 名片 */
      ".dshpet-card-btn{background:none;border:1px solid rgba(100,100,255,.3);border-radius:6px;",
      "cursor:pointer;font-size:11px;padding:2px 8px;margin-top:4px;pointer-events:auto;",
      "transition:border-color .2s;color:inherit}",
      ".dshpet-card-btn:hover{border-color:rgba(100,100,255,.6)}",
      ".dshpet-card-overlay{position:fixed;left:0;top:0;right:0;bottom:0;z-index:999;",
      "background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;",
      "pointer-events:auto;cursor:pointer}",
      ".dshpet-card-img{border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.4);",
      "max-width:90vw;max-height:90vh;cursor:default}",

      /* 成就 / 任务面板：从卡片上方展开。它自己吃指针事件（里面有可滚动的
         徽章格），但点它不该冒泡到卡片上去把卡片折叠了（见 onClick 的守卫）。 */
      ".dshpet-panel{pointer-events:auto;position:absolute;bottom:100%;right:0;contain:layout style paint;",
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
      "@keyframes dshpet-mg-pop{0%{transform:scale(0);opacity:0}50%{transform:scale(1.2)}100%{transform:scale(1);opacity:1}}",
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
      /* 暴食 BUFF 的脉冲呼吸光：边框和阴影有节奏地明灭。 */
      "@keyframes dshpet-frenzy-pulse{",
      "0%,100%{box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.35)),0 0 20px rgba(255,140,40,.5),0 0 40px rgba(255,80,20,.25);border-color:rgba(255,140,40,.85)}",
      "50%{box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.35)),0 0 32px rgba(255,120,20,.7),0 0 56px rgba(255,60,10,.35);border-color:rgba(255,100,20,.95)}}",
      /* 暴食触发一瞬的短促震动——比 shake-strong 更快更碎，强调「爆发」。 */
      "@keyframes dshpet-frenzy-shake{",
      "0%,100%{transform:translate(0,0)}",
      "12%{transform:translate(-2px,-1px) rotate(-.6deg)}",
      "25%{transform:translate(2px,1px) rotate(.6deg)}",
      "37%{transform:translate(-1px,1px) rotate(-.4deg)}",
      "50%{transform:translate(1px,-1px) rotate(.4deg)}",
      "62%{transform:translate(-1px,0) rotate(-.2deg)}",
      "75%{transform:translate(1px,0) rotate(.2deg)}",
      "87%{transform:translate(0,1px)}}",
      /* 暴食底部暖光呼吸。 */
      "@keyframes dshpet-frenzy-glow{",
      "0%{opacity:.6;transform:scale(1)}",
      "100%{opacity:1;transform:scale(1.04)}}",
      /* 暴食火焰图标的跳动。 */
      "@keyframes dshpet-frenzy-fire{",
      "0%{transform:translateX(-50%) translateY(0) scale(1);opacity:.9}",
      "100%{transform:translateX(-50%) translateY(-3px) scale(1.15);opacity:1}}",
      /* 暴食 combo 标签的脉冲。 */
      "@keyframes dshpet-frenzy-combo-pulse{",
      "0%{transform:scale(1);box-shadow:0 0 16px rgba(255,100,0,.6),0 0 32px rgba(255,60,0,.3)}",
      "100%{transform:scale(1.05);box-shadow:0 0 22px rgba(255,100,0,.8),0 0 44px rgba(255,60,0,.4)}}",
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
      ".dshpet-combo[data-tier=gold],.dshpet-combo[data-tier=epic],.dshpet-combo[data-frenzy=true],",
      ".dshpet-card[data-tier=gold],.dshpet-card[data-tier=epic],.dshpet-card[data-buff=frenzy],",
      ".dshpet-whale-body,.dshpet-whale-tail,.dshpet-whale-fin,.dshpet-whale-eyes,",
      ".dshpet-whale-spout,.dshpet-whale-sparkle,.dshpet-whale-brow,.dshpet-patted,",
      ".dshpet-whale-sprite-bob,",
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
      ".dshpet-card[data-buff=frenzy]::before,.dshpet-card[data-buff=frenzy]::after{display:none}",
      ".dshpet-zzz{animation:none;opacity:1}}",

      /* ─── 多宠物 UI ─── */
      ".dshpet-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;",
      "background:rgba(255,255,255,.7);border:none;border-radius:50%;width:24px;height:24px;",
      "font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;",
      "opacity:.5;transition:opacity .2s}",
      ".dshpet-nav:hover{opacity:1}",
      ".dshpet-nav-left{left:4px}",
      ".dshpet-nav-right{right:4px}",
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
      ".dshpet-hatch-overlay{position:absolute;top:-9999px;left:-9999px;right:-9999px;bottom:-9999px;z-index:20;",
      "display:flex;align-items:center;justify-content:center;",
      "background:rgba(0,0,0,.3)}",
      ".dshpet-hatch-dialog{position:relative;z-index:1;background:#fff;border-radius:12px;padding:16px;text-align:center;",
      "min-width:200px;box-shadow:0 8px 24px rgba(0,0,0,.15)}",
      /* 添加宠物：面板式展开（与成就面板同款），卡片上方弹出，显式可点 */
      ".dshpet-addpet-dialog{position:absolute;bottom:calc(100% + 8px);right:0;z-index:20;pointer-events:auto;",
      "background:#fff;border-radius:12px;padding:14px;text-align:center;min-width:220px;",
      "box-shadow:0 8px 24px rgba(0,0,0,.18);border:1px solid rgba(0,0,0,.08)}",
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
