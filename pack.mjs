/**
 * 打包分发入口：转发到包内的实现 dsh-pet-plugin/scripts/pack.mjs，
 * 参数原样传过去。放一层是为了在仓库顶层有个统一入口：
 *
 *   node pack.mjs                # 等价于 node dsh-pet-plugin/scripts/pack.mjs
 *   node pack.mjs --check
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'dsh-pet-plugin', 'scripts', 'pack.mjs')

const run = spawnSync(process.execPath, [script, ...process.argv.slice(2)], { stdio: 'inherit' })
if (run.error !== undefined) {
  console.error(`✗ 跑不起来 ${script}: ${run.error.message}`)
  process.exit(1)
}
process.exit(run.status ?? 1)
