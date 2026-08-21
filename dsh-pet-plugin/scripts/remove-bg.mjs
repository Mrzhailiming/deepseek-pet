// 鲸鱼娘源 PNG 背景抠除：AI 出图实际是白/浅色不透明底（palette 无完整 alpha），
// 用「边缘 flood-fill」把连通到边缘的背景区域抠成真透明，避免在深色宿主里显示成白块。
// 运行：node scripts/remove-bg.mjs（覆盖写 assets/deepseek/*.png，建议先备份）
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { PNG } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/pngjs')

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '..', 'assets', 'deepseek')
// 输出到独立目录，绝不覆盖源素材（调参可重跑，不用重新导出）
const outDir = join(dir, 'transparent')

function dist(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/** 采样背景色：取四边 alpha>200 的像素 RGB 中位数（角色肤色/深色只是少数，中位数落在背景上）。 */
function sampleBg(d, W, H) {
  const pts = []
  const step = Math.max(1, Math.floor(W / 40))
  for (let x = 0; x < W; x += step) {
    for (const y of [0, H - 1]) { const i = (y * W + x) * 4; if (d[i + 3] > 200) pts.push([d[i], d[i + 1], d[i + 2]]) }
  }
  for (let y = 0; y < H; y += step) {
    for (const x of [0, W - 1]) { const i = (y * W + x) * 4; if (d[i + 3] > 200) pts.push([d[i], d[i + 1], d[i + 2]]) }
  }
  if (pts.length === 0) return [255, 255, 255]
  pts.sort((p, q) => (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]))
  return pts[Math.floor(pts.length / 2)]
}

function removeBg(srcPath, outPath, threshold = 8) {
  const png = PNG.sync.read(readFileSync(srcPath))
  const { width: W, height: H, data: d } = png
  const bg = sampleBg(d, W, H)
  const visited = new Uint8Array(W * H)
  const queue = []
  const push = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H && !visited[y * W + x]) { visited[y * W + x] = 1; queue.push(y * W + x) } }
  // 种子：四条边
  for (let x = 0; x < W; x += 1) { push(x, 0); push(x, H - 1) }
  for (let y = 0; y < H; y += 1) { push(0, y); push(W - 1, y) }
  let removed = 0
  while (queue.length > 0) {
    const idx = queue.pop()
    const x = idx % W, y = (idx - x) / W
    const i = idx * 4
    const a = d[i + 3]
    if (a === 0) continue                       // 本来就透明，跳过
    if (a > 200 && dist([d[i], d[i + 1], d[i + 2]], bg) < threshold) {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0      // 背景 → 全透明且 RGB 清零（防透明像素渲染成白）
      d[i + 3] = 0
      removed += 1
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
    } else if (a <= 200) {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0
      d[i + 3] = 0
      removed += 1
    }
  }
  writeFileSync(outPath, PNG.sync.write(png))
  return { removed, bg }
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
const files = readdirSync(dir).filter(f => f.endsWith('.png')).sort()
let total = 0
for (const f of files) {
  const r = removeBg(join(dir, f), join(outDir, f))
  total += r.removed
  console.log(f.padEnd(36), '抠除', String(r.removed).padStart(6), 'px  背景RGB', r.bg.join(','))
}
console.log('DONE', files.length, '张 →', outDir, '共抠除', total, '像素')
