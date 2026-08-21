// =============================================================
// 鲸鱼娘 · client.js 接入片段（CJS，适配 dsh-pet-plugin 的 factory）
// 真 APNG 版：28 张 256x256 透明动图已随包发布，
//   路径 assets/deepseek/apng/deepseek-{stage}-{state}.apng
// 用法：
//   1) 把第 2 节替换 lib/client.js 里的原 WhaleAvatar（原函数是 SVG 矢量绘制）
//   2) CSS 只保留事件态特效（APNG 已内置待机浮沉，勿再叠加 bob 动画）
// =============================================================

// ---- 1) 资源引用 ----
// APNG 已通过 package.json files 打进发布包，运行时用相对路径加载即可：
//   <img src="assets/deepseek/apng/deepseek-baby-normal.apng" />
// 浏览器对 <img> 原生支持 APNG 循环播放，无需任何解码逻辑。
//
// 若你的部署要求单文件（不保留 assets 目录），把 28 个 APNG base64 内联成
// 一个模块（如 deepseekSprites.cjs），src 换成 data: URL，其余逻辑不变。

// ---- 2) 状态映射 + 新 WhaleAvatar ----
function whaleStateOf(props) {
  // 优先级：进食 > 被摸 > 睡 > 饿 > 心情差 > 兴奋 > 普通
  if (props.eating) return "eat";
  if (props.patted) return "pat";
  if (props.asleep) return "sleep";
  if (props.hungry || props.starving) return "hungry";
  if (props.sad) return "sad";
  if (props.tier === "epic") return "excited";
  return "normal";
}

// 数据驱动取帧：优先 manifest.frames[stage][state]，逐级降级到 baby/normal
var MANIFEST = require("../../assets/deepseek/manifest.json"); // 按实际部署调整相对路径
function petFrameOf(stageKey, state) {
  var pet = MANIFEST.pets[MANIFEST.defaultPet];
  var frames = pet && pet.frames[stageKey];
  var file = frames && (frames[state] || frames.normal);
  return file ? "assets/deepseek/apng/" + file : "";
}

// 替换原 function WhaleAvatar(props) { ... }
function WhaleAvatar(props) {
  var stage = whaleStageOf(props.level); // 已有：baby/young/adult/legend（与 manifest 对齐）
  var state = whaleStateOf(props);
  var url = petFrameOf(stage.key, state);
  return h("img", {
    className: "dshpet-whale dshpet-whale-sprite",
    src: url,
    width: stage.size,
    height: stage.size,
    style: { width: String(stage.size) + "px", height: String(stage.size) + "px" },
    alt: "鲸鱼娘（" + stage.label + "）",
    role: "img",
    "aria-label": "鲸鱼娘（" + stage.label + "）"
  });
}

// ---- 3) CSS（追加到 factory 的 style 注入处）----
// APNG 已内置待机浮沉循环，基础样式只需保证尺寸与指针行为：
// .dshpet-whale-sprite{display:block;pointer-events:none;user-select:none;}
//
// 事件态可叠加瞬时特效（与 APNG 播放互不冲突）：
// .dshpet-card[data-pat]    .dshpet-whale-sprite{animation:dshpet-sprite-pat .5s ease-in-out}
// @keyframes dshpet-sprite-pat{0%,100%{transform:rotate(0)}25%{transform:rotate(-4deg)}75%{transform:rotate(4deg)}}
// .dshpet-card[data-eating] .dshpet-whale-sprite{animation:dshpet-sprite-chew .4s ease-in-out}
// @keyframes dshpet-sprite-chew{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.94)}}
//
// 注意：eat / pat 需要上层在喂食 / 摸头时给卡片加 data-eating / data-pat
// （原代码已有 .dshpet-eating 类，可一并复用）。
