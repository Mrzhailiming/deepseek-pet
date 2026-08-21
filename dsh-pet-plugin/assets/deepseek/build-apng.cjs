// 鲸鱼娘精灵 -> 真 APNG 合成脚本（透明 + 调色板量化）
// 流程：源 484x484 PNG -> 抠除背景(已预处理) -> ffmpeg scale 256 -> palettegen/paletteuse
//       量化成 pal8（256 色 + tRNS 透明，体积从 RGBA 的 ~200KB/帧 降到 ~20KB/帧）
//       -> pngjs 生成轻浮动帧 -> 逐帧 paletteuse -> ffmpeg 合成 APNG
// 运行：node assets/deepseek/build-apng.cjs（也可由 scripts/pack.mjs 自动触发）
// 依赖：pngjs + ffmpeg-static，按以下顺序查找：
//       1) dsh-pet-plugin/node_modules  2) assets/deepseek/node_modules
//       3) 本机 WorkBuddy managed workspace（开发环境）
//       找不到时请先安装：cd dsh-pet-plugin && npm i -D pngjs ffmpeg-static
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

/**
 * 解析一个 npm 包在磁盘上的目录（支持多级 fallback，保证 clone 后能跑）。
 * @param name - 包名。
 * @returns 包目录，找不到返回 null。
 */
function resolvePkg(name) {
  const candidates = [
    path.join(__dirname, '..', '..', 'node_modules', name),                         // 包根 node_modules
    path.join(__dirname, 'node_modules', name),                                     // 素材目录旁 node_modules
    path.join('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules', name), // 本机开发环境
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

const pngjsDir = resolvePkg('pngjs')
if (!pngjsDir) {
  console.error('✗ 找不到 pngjs 依赖 —— 请先安装：cd dsh-pet-plugin && npm i -D pngjs ffmpeg-static')
  process.exit(1)
}
const PNG = require(pngjsDir).PNG

const ffDir = resolvePkg('ffmpeg-static')
if (!ffDir) {
  console.error('✗ 找不到 ffmpeg-static 依赖 —— 请先安装：cd dsh-pet-plugin && npm i -D pngjs ffmpeg-static')
  process.exit(1)
}
const FFMPEG = path.join(ffDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

const BASE = path.join(__dirname, 'v2-transparent')   // 透明素材（当前为 v5 精修版内容）
const OUT = path.join(__dirname, 'apng')              // 合成产物
const STAGES = ['baby', 'young', 'adult', 'legend']
const STATES = ['normal', 'eat', 'sleep', 'hungry', 'excited', 'sad', 'pat']
const FRAMES = 8          // 8 帧 sin 平滑浮沉：帧间位移差 ~3px，视觉连续不跳。
                          // APNG 是图片动画，不受宿主 prefers-reduced-motion 影响（CSS 动画会被禁）
const FPS = 6             // 6fps：8 帧浮沉循环 1.33s/次，动作舒缓（用户要求降低频率）
const AMP = 4             // 浮沉幅度(px)：8 帧 ±4px 柔和呼吸
const SIZE = 256          // 输出边长，对齐原始需求

const tmpDir = path.join(os.tmpdir(), 'deepseek_apng_tmp')
const tmp256 = path.join(tmpDir, 'sprite_256.png')
const tmpPal = path.join(tmpDir, 'palette.png')
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

const PALETTE_GEN = 'palettegen=max_colors=255:stats_mode=diff'
const PALETTE_USE = '[0:v][1:v]paletteuse=dither=bayer:bayer_scale=5'

let ok = 0, fail = 0

for (const stage of STAGES) {
  for (const state of STATES) {
    const src = path.join(BASE, `deepseek-${stage}-${state}.png`)
    if (!fs.existsSync(src)) { console.log('MISS', src); fail++; continue }
    // 每状态独立帧目录 + 时间戳，避免上一轮残留帧混入合成（APNG 不支持多调色板）
    const framesDir = path.join(tmpDir, 'frames', `${stage}-${state}-${Date.now()}`)
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true })

    // 1) 缩放到 256x256（保持透明 RGBA）
    execSync(`"${FFMPEG}" -y -i "${src}" -vf scale=${SIZE}:${SIZE} "${tmp256}"`, { stdio: 'ignore' })
    // 2) 生成调色板（基于原位帧统计，两帧共用同一调色板，避免闪烁）
    execSync(`"${FFMPEG}" -y -i "${tmp256}" -vf ${PALETTE_GEN} "${tmpPal}"`, { stdio: 'ignore' })
    // 3) 帧 0：原位，量化
    execSync(`"${FFMPEG}" -y -i "${tmp256}" -i "${tmpPal}" -lavfi "${PALETTE_USE}" "${framesDir}/frame_00.png"`, { stdio: 'ignore' })

    // 4) 其余帧：pngjs 生成轻浮动（整张透明 PNG 上下位移）后逐帧量化
    const sprite = PNG.sync.read(fs.readFileSync(tmp256))
    for (let i = 1; i < FRAMES; i++) {
      // sin 平滑采样：0 → +AMP → 0 → -AMP → 0…，帧间位移差小，循环无跳变
      const off = Math.round(Math.sin((i / FRAMES) * 2 * Math.PI) * AMP)
      const out = new PNG({ width: SIZE, height: SIZE })
      for (let y = 0; y < SIZE; y++) {
        const sy = y + off
        if (sy < 0 || sy >= SIZE) continue
        for (let x = 0; x < SIZE; x++) {
          const si = (sy * SIZE + x) * 4
          const di = (y * SIZE + x) * 4
          out.data[di] = sprite.data[si]
          out.data[di + 1] = sprite.data[si + 1]
          out.data[di + 2] = sprite.data[si + 2]
          out.data[di + 3] = sprite.data[si + 3]
        }
      }
      const raw = path.join(framesDir, '_raw.png')
      fs.writeFileSync(raw, PNG.sync.write(out))
      execSync(`"${FFMPEG}" -y -i "${raw}" -i "${tmpPal}" -lavfi "${PALETTE_USE}" "${framesDir}/frame_${String(i).padStart(2, '0')}.png"`, { stdio: 'ignore' })
    }

    // 5) 合成 APNG（无限循环）
    const apng = path.join(OUT, `deepseek-${stage}-${state}.apng`)
    execSync(`"${FFMPEG}" -y -framerate ${FPS} -i "${framesDir}/frame_%02d.png" -plays 0 -f apng "${apng}"`, { stdio: 'ignore' })

    const sz = fs.statSync(apng).size
    const flag = sz <= 200 * 1024 ? 'OK' : 'LARGE'
    console.log(`${flag} ${stage}-${state}.apng  ${(sz / 1024).toFixed(1)}KB`)
    if (flag === 'OK') ok++; else fail++
  }
}

console.log(`\nDONE ok=${ok} fail=${fail}`)
