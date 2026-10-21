/**
 * 矢量头像预览：把 WhaleAvatar 的 SVG 画法按「形态 × 状态」铺成一张 HTML 表，
 * 改长相表（WHALE_ART / FORMS）时用来肉眼过一遍。只渲染静态帧，不带 CSS 动画；
 * 「摸头」一列手动把笑眼换上来（真实卡片里由 .dshpet-patted 切换）。
 *
 *   node lib/build.mjs && node scripts/preview-avatar.mjs [out.html]
 *
 * 默认输出到系统临时目录，路径打印在终端里。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = process.argv[2] ?? join(tmpdir(), 'dshpet-avatar-preview.html')

// 只为预览把内部组件挂到 exports 上，产物文件本身不动。
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  .replace('exports.apply = apply;', 'exports.apply = apply; exports.__WhaleAvatar = WhaleAvatar;')

let factory = null
globalThis.window = { __ModuleLoader__: { load: def => { factory = def.factory } } }
new Function(source)()
const react = { createElement: (type, props, ...children) => ({ type, props, children }) }
const mod = factory(() => react)
const WhaleAvatar = mod.__WhaleAvatar

const attrName = k => k === 'className' ? 'class' : k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())

/** 把桩 React 的节点树写成 SVG 文本。 */
function render(node) {
  if (node === null || node === undefined || node === false) return ''
  if (Array.isArray(node)) return node.map(render).join('')
  if (typeof node !== 'object') return String(node)
  const props = node.props ?? {}
  let attrs = ''
  for (const [k, v] of Object.entries(props)) {
    if (k === 'key' || k === 'children' || v === undefined || v === null) continue
    if (k === 'style') {
      attrs += ` style="${Object.entries(v).map(([sk, sv]) => `${attrName(sk)}:${sv}`).join(';')}"`
      continue
    }
    attrs += ` ${attrName(k)}="${String(v).replace(/"/g, '&quot;')}"`
  }
  return `<${node.type}${attrs}>${render(node.children)}</${node.type}>`
}

const looks = [
  { title: '幼崽 Lv.1', level: 1 }, { title: '少年 Lv.3', level: 3 },
  { title: '成年 Lv.6', level: 6 }, { title: '传说 Lv.10', level: 10 },
  { title: '代码猫', level: 10, form: 'cat' }, { title: '搜索狐', level: 10, form: 'fox' },
  { title: '除错虫', level: 10, form: 'bug' }, { title: '文鸟', level: 10, form: 'bird' },
]
const states = [
  { title: '普通', props: {} },
  { title: '兴奋', props: { tier: 'epic' } },
  { title: '睡觉', props: { asleep: true } },
  { title: '饿', props: { hungry: true } },
  { title: '摸头', props: {}, pat: true },
  { title: '好奇', props: { dim: { key: 'curiosity' } } },
  { title: '得意', props: { dim: { key: 'pride' } } },
  { title: '担忧', props: { dim: { key: 'concern' } } },
]

let rows = ''
for (const look of looks) {
  let cells = `<th>${look.title}</th>`
  for (const st of states) {
    const svg = render(WhaleAvatar({ tier: 'normal', level: look.level, form: look.form ?? '', look: 'svg', ...st.props }))
    cells += `<td class="${st.pat ? 'pat' : ''}">${svg.replace(/style="[^"]*"/, '')}</td>`
  }
  rows += `<tr>${cells}</tr>`
}
const html = `<!doctype html><meta charset="utf-8"><style>
body{background:#1b1c22;color:#ddd;font:13px sans-serif;margin:12px}
td,th{padding:4px;text-align:center}td{background:#262832;border-radius:10px}
svg{width:112px;height:112px;overflow:visible}
.dshpet-whale-happy{display:none}.pat .dshpet-whale-happy{display:inline}.pat .dshpet-whale-eyes{display:none}
</style><table><tr><th></th>${states.map(s => `<th>${s.title}</th>`).join('')}</tr>${rows}</table>`
writeFileSync(out, html)
console.log(out)
