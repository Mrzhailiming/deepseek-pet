/**
 * 把 lib/src/ 下的源文件片段拼接成 lib/client.js，再把立绘素材打成一个按需 chunk。
 *
 * 两件产物：
 *   lib/client.js           逻辑 + 矢量美术（art.js）：源片段逐字拼接，不做任何转译。
 *   lib/client.sprites.js   APNG 立绘：assets/deepseek/apng/*.apng → base64，包成宿主
 *                           认的包内 chunk。只有切到「立绘」画法时浏览器才会去拿它
 *                           （client.js 里 `require.async("./client.sprites.js")`）。
 *
 * 宿主只按 `/plugins/<包名>/client.<name>.js?rev=<rev>` 发同级 chunk，不发图片文件，
 * 所以素材只能以 JS 的形式送到浏览器；rev 取自 client.js 的 mtime / size，因此
 * **chunk 先写、client.js 最后写** —— 只换了素材也会让浏览器拿到新的 chunk。
 *
 * 改完源文件跑 `node lib/build.mjs`，再重启 dsh 即可看到新代码。
 *
 *   node lib/build.mjs              # 拼接并写入两件产物
 *   node lib/build.mjs --check      # 写入后校验语法（CI 用）
 *   node lib/build.mjs --dry-run    # 拼接但不写，只打印大小
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, 'src')
const outPath = join(here, 'client.js')
const spritesOutPath = join(here, 'client.sprites.js')
const apngDir = join(here, '..', 'assets', 'deepseek', 'apng')

/** 包名即模块表 id，主产物和 chunk 都得用它注册。 */
const PACKAGE_ID = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).name
/** chunk 的文件名：宿主只认 `client.<name>.js`。 */
const SPRITES_CHUNK = 'client.sprites.js'

const FRAGMENTS = [
  '_banner.js',
  'config.js',
  'art.js',
  'constants.js',
  'styles.js',
  'logic.js',
  'store.js',
  'views.js',
  'plugin.js',
  '_footer.js',
]

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const dryRun = args.includes('--dry-run')

let output = ''
for (const name of FRAGMENTS) {
  const path = join(srcDir, name)
  try {
    output += readFileSync(path, 'utf8')
  } catch (err) {
    console.error(`✗ 读不到 ${path}: ${err.message}`)
    process.exit(1)
  }
}

/**
 * 立绘 chunk：一个文件名 → data URI 的表。注册格式与宿主 tsdown 生成的 chunk
 * 一致（banner 带 `chunk` 字段，intro / footer 同主产物）。
 * @returns { source, frames }。
 */
function buildSpritesChunk() {
  const files = readdirSync(apngDir).filter(f => f.endsWith('.apng')).sort()
  if (files.length === 0) {
    console.error(`✗ ${apngDir} 下没有 .apng 文件`)
    process.exit(1)
  }
  const table = {}
  for (const f of files) {
    table[f] = `data:image/png;base64,${readFileSync(join(apngDir, f)).toString('base64')}`
  }
  // JSON.parse 比同样大小的对象字面量解析得快；base64 与文件名里都没有单引号和反斜杠。
  const source = `// 鲸鱼娘 ${files.length} 帧 APNG 立绘（由 lib/build.mjs 从 assets/deepseek/apng/ 生成，别手改）\n`
    + `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, chunk: ${JSON.stringify(SPRITES_CHUNK)}, factory: (require) => {\n`
    + 'var module = { exports: {} }; var exports = module.exports;\n'
    + `exports.SPRITES = JSON.parse('${JSON.stringify(table)}');\n`
    + 'return module.exports; } });\n'
  return { source, frames: files.length }
}

const sprites = buildSpritesChunk()
const kib = text => (Buffer.byteLength(text, 'utf8') / 1024).toFixed(1)

if (dryRun) {
  console.log(`[dry-run] client.js ${kib(output)} KiB（${FRAGMENTS.length} 个片段）`
    + ` + ${SPRITES_CHUNK} ${kib(sprites.source)} KiB（${sprites.frames} 帧）`)
  process.exit(0)
}

writeFileSync(spritesOutPath, sprites.source)
writeFileSync(outPath, output)

for (const path of [spritesOutPath, outPath]) {
  const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
  if (syntax.status !== 0) {
    console.error(`✗ ${path} 语法错误:\n${syntax.stderr}`)
    process.exit(1)
  }
}

if (checkOnly) {
  console.log(`✓ 语法正确（client.js ${kib(output)} KiB，${SPRITES_CHUNK} ${kib(sprites.source)} KiB）`)
  process.exit(0)
}

console.log(`✓ lib/client.js 已生成（${kib(output)} KiB，${FRAGMENTS.length} 个片段）`)
console.log(`✓ lib/${SPRITES_CHUNK} 已生成（${kib(sprites.source)} KiB，${sprites.frames} 帧立绘）`)
