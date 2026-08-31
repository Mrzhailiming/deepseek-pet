/**
 * 把 APNG 精灵重建为 lib/src/sprites.js（幂等：重复运行是覆盖更新）。
 *
 * 素材管线：assets/deepseek/apng/*.apng → base64 内联 → lib/src/sprites.js
 * 之后跑 `node lib/build.mjs` 把所有片段拼回 lib/client.js。
 *
 * 运行：node scripts/integrate-apng.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const apngDir = join(root, 'assets', 'deepseek', 'apng')
const spritesPath = join(root, 'lib', 'src', 'sprites.js')

const files = readdirSync(apngDir).filter(f => f.endsWith('.apng')).sort()
if (files.length === 0) {
  console.error('✗ assets/deepseek/apng/ 下没有 .apng 文件')
  process.exit(1)
}

const obj = {}
for (const f of files) {
  obj[f] = `data:image/png;base64,${readFileSync(join(apngDir, f)).toString('base64')}`
}
const json = JSON.stringify(obj)

const content =
  '    // 鲸鱼娘 ' + files.length + ' 帧 APNG 精灵（base64 内联，由 scripts/integrate-apng.mjs 生成）\n' +
  "    var SPRITES = JSON.parse('" + json + "');\n"

writeFileSync(spritesPath, content)
console.log('✓ SPRITES 已写入 lib/src/sprites.js（' + files.length + ' 帧，' + (content.length / 1024).toFixed(0) + ' KiB）')
