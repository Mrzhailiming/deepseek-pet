/**
 * 把 lib/src/ 下的源文件片段拼接成 lib/client.js。
 *
 * 产物与手写版逐字节一致——这只是一步 cat，不做任何转译。
 * 改完源文件跑 `node lib/build.mjs`，再重启 dsh 即可看到新代码。
 *
 *   node lib/build.mjs              # 拼接并写入 lib/client.js
 *   node lib/build.mjs --check      # 只校验语法，不写文件（CI 用）
 *   node lib/build.mjs --dry-run    # 拼接但不写，只打印大小
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, 'src')
const outPath = join(here, 'client.js')

const FRAGMENTS = [
  '_banner.js',
  'config.js',
  'sprites.js',
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

const kib = (Buffer.byteLength(output, 'utf8') / 1024).toFixed(1)

if (checkOnly) {
  writeFileSync(outPath, output)
  const syntax = spawnSync(process.execPath, ['--check', outPath], { encoding: 'utf8' })
  if (syntax.status !== 0) {
    console.error(`✗ 语法错误:\n${syntax.stderr}`)
    process.exit(1)
  }
  console.log(`✓ 语法正确（${kib} KiB）`)
  process.exit(0)
}

if (dryRun) {
  console.log(`[dry-run] ${kib} KiB，${FRAGMENTS.length} 个片段`)
  process.exit(0)
}

writeFileSync(outPath, output)

const syntax = spawnSync(process.execPath, ['--check', outPath], { encoding: 'utf8' })
if (syntax.status !== 0) {
  console.error(`✗ 拼接产物语法错误:\n${syntax.stderr}`)
  process.exit(1)
}

console.log(`✓ lib/client.js 已生成（${kib} KiB，${FRAGMENTS.length} 个片段）`)
