// 把 APNG 精灵内联进 lib/client.js 并替换 WhaleAvatar（幂等：重复运行是覆盖更新）
// 运行：node scripts/integrate-apng.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const apngDir = join(root, 'assets', 'deepseek', 'apng')
const clientPath = join(root, 'lib', 'client.js')

// ---- 1) 生成 SPRITES 对象（APNG base64） ----
const files = readdirSync(apngDir).filter(f => f.endsWith('.apng')).sort()
const entries = files.map(f =>
  `    "${f}":"data:image/png;base64,${readFileSync(join(apngDir, f)).toString('base64')}"`
)
const SPRITES_BLOCK =
  '    // 鲸鱼娘 28 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）\n' +
  '    var SPRITES = {\n' + entries.join(',\n') + '\n    };\n'

// ---- 2) 新 WhaleAvatar（保留函数类型，卡片测试仍按「第一个函数组件」定位头像） ----
const NEW_WHALE =
`    function WhaleAvatar(props) {
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
    }`

// ---- 3) sprite CSS（追加到既有 RULES 数组） ----
const CSS_ANCHOR = '      ".dshpet-whale{display:block;width:44px;height:44px;overflow:visible}",'
const CSS_BLOCK =
  '      /* APNG 精灵：底座 + eat/pat 叠加层，切换由外层类触发（APNG 自带浮沉循环）。 */\n' +
  '      ".dshpet-avatar-stack{position:relative;display:inline-block;line-height:0}",\n' +
  '      ".dshpet-whale-sprite{display:block;pointer-events:none;user-select:none}",\n' +
  '      ".dshpet-sprite-eat,.dshpet-sprite-pat{position:absolute;left:0;top:0;display:none}",\n' +
  '      ".dshpet-eating .dshpet-sprite-eat,.dshpet-patted .dshpet-sprite-pat{display:block}",\n'

// ---- 4) 应用 ----
let src = readFileSync(clientPath, 'utf8')

const WHALE_ANCHOR = '    var WHALE_STAGES = ['
// 总是重建 SPRITES（素材有更新时重跑本脚本即可覆盖，幂等）。
const reSpr = /    var SPRITES = \{[\s\S]*?\n    \};/
if (reSpr.test(src)) {
  src = src.replace(reSpr, SPRITES_BLOCK.trimEnd())
  console.log('SPRITES 已重建（' + files.length + ' 帧）')
} else if (src.includes(WHALE_ANCHOR)) {
  src = src.replace(WHALE_ANCHOR, SPRITES_BLOCK + WHALE_ANCHOR)
  console.log('SPRITES 已注入（' + files.length + ' 帧）')
} else {
  throw new Error('找不到注入锚点 WHALE_STAGES')
}

const re = /    function WhaleAvatar\(props\) \{[\s\S]*?\n    \}\n\n    \/\*\*/
if (re.test(src)) {
  src = src.replace(re, NEW_WHALE + '\n\n    /**')
  console.log('WhaleAvatar 已替换为 APNG 版')
} else {
  console.log('未匹配到旧 WhaleAvatar（可能已替换或结构变化）')
}

if (!src.includes('.dshpet-avatar-stack')) {
  if (!src.includes(CSS_ANCHOR)) throw new Error('找不到 CSS 锚点')
  src = src.replace(CSS_ANCHOR, CSS_BLOCK + CSS_ANCHOR)
  console.log('sprite CSS 已追加')
} else {
  console.log('sprite CSS 已存在，跳过')
}

writeFileSync(clientPath, src)
console.log('已写入', clientPath, '（' + (src.length / 1024).toFixed(0) + ' KiB）')
