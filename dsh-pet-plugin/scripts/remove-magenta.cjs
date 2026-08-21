// 批量抠除洋红背景（ImageGen v2 素材）→ 真透明 PNG
// 输入：.workbuddy/rembg_test/v2/{stage}-{state}/*.png
// 输出：assets/deepseek/v2-transparent/{stage}-{state}.png
const fs = require('fs')
const path = require('path')
const PNG = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/pngjs').PNG

const SRC = 'C:/code/deepseek-pet/.workbuddy/rembg_test/v2'
const OUT = 'C:/code/deepseek-pet/dsh-pet-plugin/assets/deepseek/v2-transparent'
const STAGES = ['baby', 'young', 'adult', 'legend']
const STATES = ['normal', 'eat', 'sleep', 'hungry', 'excited', 'sad', 'pat']
const TH = 90

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)

function removeBg(file, outFile) {
  const png = PNG.sync.read(fs.readFileSync(file))
  const { width: W, height: H, data: d } = png
  const bg = [d[10 * 4], d[10 * 4 + 1], d[10 * 4 + 2]]
  const visited = new Uint8Array(W * H)
  const q = []
  const push = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H && !visited[y * W + x]) { visited[y * W + x] = 1; q.push(y * W + x) } }
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1) }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y) }
  let removed = 0
  while (q.length) {
    const idx = q.pop()
    const x = idx % W, y = (idx - x) / W
    const i = idx * 4
    const a = d[i + 3]
    if (a === 0) continue
    if (a > 200 && dist([d[i], d[i + 1], d[i + 2]], bg) < TH) {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0
      removed++
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
    } else if (a <= 200) {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0
      removed++
    }
  }
  fs.writeFileSync(outFile, PNG.sync.write(png))
  return { removed, bg }
}

let ok = 0
for (const stage of STAGES) {
  for (const state of STATES) {
    const dir = path.join(SRC, `${stage}-${state}`)
    if (!fs.existsSync(dir)) { console.log('MISS', stage, state); continue }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'))
    if (files.length === 0) { console.log('EMPTY', stage, state); continue }
    const r = removeBg(path.join(dir, files[0]), path.join(OUT, `deepseek-${stage}-${state}.png`))
    console.log(`OK ${stage}-${state} 抠除 ${r.removed} 背景RGB ${r.bg.join(',')}`)
    ok++
  }
}
console.log(`DONE ${ok}/28`)
