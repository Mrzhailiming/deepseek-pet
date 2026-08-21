/**
 * 本地验证一条龙：跑冒烟测试 → 把本项目装进 dsh 的 web profile → 起 dsh。
 * 改完代码敲这一条，浏览器里就能看真机效果。零依赖，只用 node 自带模块，
 * 也不改宿主仓库一个字节。
 *
 *   node start_dsh.mjs                        # 测 + 装 + 起（默认 profile web）
 *   node start_dsh.mjs --no-test              # 跳过冒烟测试
 *   node start_dsh.mjs --strict               # 测试不过就不装不起（默认只是警告，照样起）
 *   node start_dsh.mjs --no-start             # 只测 + 装，不起
 *   node start_dsh.mjs --repo D:\dsh          # 手动指定宿主仓库根目录
 *   node start_dsh.mjs --profile web          # 换 profile
 *   node start_dsh.mjs --reinstall            # 先 remove 再 add（链坏了 / 换过目录时用）
 *   node start_dsh.mjs --plain                # 不走仓库的 start.sh，直接 pnpm dsh（不带 API key 等环境变量）
 *   node start_dsh.mjs -- --dump-config       # `--` 之后的参数原样交给 dsh
 *
 * 五步，每步都会打一行日志，哪一步挂了就停在哪一步：
 *   1. 找宿主仓库（--repo > $DSH_REPO > 几个常见位置），用 package.json 的 name 校验
 *   2. 在 dsh-pet-plugin 里跑 node test/smoke.mjs（默认只警告不拦路 —— 有时候就是想
 *      先用眼睛看看，测试红着也得让人起得来；要拦就加 --strict）
 *   3. 在仓库根跑 pnpm dsh plugin --profile <p> add <本插件绝对路径>
 *      —— 绝对路径是故意的：宿主的 anchorPathSpec 只改写相对路径，绝对路径原样透传
 *   4. 读 profile 的 package.json 确认依赖与 dsh.profile.bundles 都有 dsh-pet-plugin
 *   5. 起 dsh：先 bash ./stop.sh 停掉上一次留下的那个（3080 占着起不来，而且旧进程跑的是旧代码），
 *      再起 —— 仓库有 start.sh 且有 bash 就走它（那里带着 API key / 证书 / 模型名），否则 pnpm dsh --profile <p>
 *
 * 装出来的是一条 link:（软链到本目录），所以第一次装完之后改 lib/client.js 不用重装，
 * 重跑这个脚本（或者直接重启 dsh）就能看到新代码。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDir = join(here, 'dsh-pet-plugin')
const PLUGIN_NAME = 'dsh-pet-plugin'
const ROOT_PACKAGE = '@deepseek-ai/dsh-root'
const win = process.platform === 'win32'

/** 猜宿主仓库位置：--repo / $DSH_REPO 都没给时按这个顺序试。 */
const REPO_GUESSES = [
  join(here, '..', 'deepseek-harness-master', 'deepseek-harness-master'),
  join(here, '..', 'deepseek-harness-master'),
  join(here, '..', 'deepseek-harness'),
  'C:\\code\\deepseek-harness-master\\deepseek-harness-master',
]

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function step(n, message) {
  console.log(`\n[${n}/5] ${message}`)
}

/** 解析命令行。`--` 之后的一律当成给 dsh 的参数。 */
function parseArgs(argv) {
  const options = {
    repo: '', profile: 'web', start: true, test: true, strict: false, reinstall: false, plain: false, dsh: [],
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') { options.dsh = argv.slice(i + 1); break }
    if (arg === '--no-start') { options.start = false; continue }
    if (arg === '--no-test' || arg === '--skip-test') { options.test = false; continue }
    if (arg === '--test') { options.test = true; continue }
    if (arg === '--strict') { options.strict = true; continue }
    if (arg === '--reinstall') { options.reinstall = true; continue }
    if (arg === '--plain') { options.plain = true; continue }
    if (arg === '-h' || arg === '--help') { options.help = true; continue }
    if (arg === '--repo' || arg === '--profile') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('-')) fail(`${arg} 后面要跟一个值`)
      if (arg === '--repo') options.repo = value
      else options.profile = value
      i += 1
      continue
    }
    fail(`不认识的参数 ${arg}（看 --help）`)
  }
  return options
}

/** 跑一条命令，stdio 直通；返回退出码。win32 上 pnpm 是 .cmd 垫片，spawn 不给 shell 起不来。 */
function run(command, args, cwd) {
  const shell = win && command === 'pnpm'
  // 借了 shell 就得自己管空格：路径里带空格的话不引号会被 shell 拆成两个参数。
  const safe = shell ? args.map(a => (/[\s&|^]/.test(a) ? `"${a}"` : a)) : args
  console.log(`  $ ${command} ${args.join(' ')}${cwd === undefined ? '' : `   (cwd: ${cwd})`}`)
  const result = spawnSync(command, safe, { cwd, stdio: 'inherit', shell })
  if (result.error !== undefined) {
    if (result.error.code === 'ENOENT') return { code: 127, missing: true }
    fail(`跑不起来 ${command}: ${result.error.message}`)
  }
  return { code: result.status ?? 1, missing: false }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 是不是 dsh 宿主仓库根：有 package.json，name 对得上，而且有 dsh 这个 script。 */
function looksLikeRepo(dir) {
  const manifest = readJson(join(dir, 'package.json'))
  if (manifest === null) return false
  return manifest.name === ROOT_PACKAGE || typeof manifest.scripts?.dsh === 'string'
}

/** profile 目录：$DSH_HOME 优先，否则 ~/.dsh，跟宿主的 resolveDshHome 一致。 */
function profileDirOf(profile) {
  const home = process.env.DSH_HOME
  const base = home !== undefined && home !== '' ? home : join(homedir(), '.dsh')
  return join(base, 'profiles', profile)
}

const HELP = `本地验证一条龙：冒烟测试 → 装插件 → 起 dsh

  node start_dsh.mjs [--repo <dsh 仓库根>] [--profile web]
                     [--no-test|--strict] [--no-start] [--reinstall] [--plain]
                     [-- <dsh 的参数>]

  --repo <path>   宿主仓库根目录（默认 $DSH_REPO，再默认几个常见位置）
  --profile <p>   profile 名，默认 web
  --no-test       跳过 dsh-pet-plugin/test/smoke.mjs（默认会跑）
  --strict        测试不过就停（默认只警告，照样装照样起）
  --no-start      只测 + 装，不起
  --reinstall     先 remove 再 add
  --plain         不用仓库的 start.sh，直接 pnpm dsh（就没有 API key / 证书那些环境变量了）
  --              后面的参数原样转给 dsh，例如：-- --dump-config
`

const options = parseArgs(process.argv.slice(2))
if (options.help === true) {
  console.log(HELP)
  process.exit(0)
}

if (!existsSync(join(pluginDir, 'package.json'))) {
  fail(`找不到插件目录 ${pluginDir} —— 这个脚本要待在仓库顶层（和 dsh-pet-plugin 同级）`)
}

// ---- 1. 找宿主仓库 ----
step(1, '找 dsh 宿主仓库')
let repo = ''
const explicit = options.repo !== '' ? options.repo : (process.env.DSH_REPO ?? '')
if (explicit !== '') {
  repo = isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit)
  if (!looksLikeRepo(repo)) fail(`${repo} 看着不像 dsh 仓库根（没有 name 为 ${ROOT_PACKAGE} 或带 dsh script 的 package.json）`)
} else {
  for (const guess of REPO_GUESSES) {
    const dir = resolve(guess)
    if (looksLikeRepo(dir)) { repo = dir; break }
  }
  if (repo === '') {
    fail('猜不到 dsh 仓库在哪 —— 用 --repo <路径> 指一下，或者设环境变量 DSH_REPO\n'
      + `  试过：\n${REPO_GUESSES.map(g => `    ${resolve(g)}`).join('\n')}`)
  }
}
console.log(`  ✓ ${repo}`)

// ---- 2. 冒烟测试 ----
step(2, options.test ? '跑插件冒烟测试' : '跳过冒烟测试（--no-test）')
let testFailed = false
if (options.test) {
  const test = run(process.execPath, [join('test', 'smoke.mjs')], pluginDir)
  if (test.code === 0) {
    console.log('  ✓ 测试通过')
  } else if (options.strict) {
    fail(`冒烟测试没过（退出码 ${test.code}），--strict 说了不过就不往下走`)
  } else {
    testFailed = true
    console.log(`  ⚠ 冒烟测试没过（退出码 ${test.code}）—— 照样装、照样起，眼睛看到的才算数。`)
    console.log('    想让它拦路：--strict；不想跑：--no-test')
  }
}

// ---- 3. 装 ----
step(3, `装进 profile ${options.profile}`)
if (options.reinstall) {
  // remove 可能本来就没装，失败不算错，只提一句。
  const off = run('pnpm', ['dsh', 'plugin', '--profile', options.profile, 'remove', PLUGIN_NAME], repo)
  if (off.missing) fail('PATH 上没有 pnpm —— 装个 pnpm（npm i -g pnpm）再来')
  if (off.code !== 0) console.log('  · remove 没成（大概本来就没装），继续')
}
const add = run('pnpm', ['dsh', 'plugin', '--profile', options.profile, 'add', pluginDir], repo)
if (add.missing) fail('PATH 上没有 pnpm —— 装个 pnpm（npm i -g pnpm）再来')
if (add.code === 127) fail('宿主报了 pnpm not found —— 装个 pnpm 再来')
if (add.code !== 0) fail(`pnpm dsh plugin add 失败（退出码 ${add.code}），上面有 pnpm 自己的报错`)
console.log(`  ✓ 已链到 ${pluginDir}（link:，改代码不用重装，重启 dsh 就行）`)

// ---- 4. 校验 ----
step(4, '校验 profile 清单')
const profileDir = profileDirOf(options.profile)
const manifest = readJson(join(profileDir, 'package.json'))
if (manifest === null) fail(`读不到 ${join(profileDir, 'package.json')}`)
const dependency = manifest.dependencies?.[PLUGIN_NAME]
const bundles = manifest.dsh?.profile?.bundles ?? []
if (typeof dependency !== 'string') fail(`${PLUGIN_NAME} 没进 ${join(profileDir, 'package.json')} 的 dependencies`)
if (!bundles.includes(PLUGIN_NAME)) {
  fail(`${PLUGIN_NAME} 进了 dependencies 但没进 dsh.profile.bundles —— 插件的 dsh.bundle.patch 声明可能有问题`)
}
console.log(`  ✓ ${profileDir}`)
console.log(`    dependencies.${PLUGIN_NAME} = ${dependency}`)
console.log(`    bundles = ${bundles.join(', ')}`)

// ---- 5. 起 ----
if (!options.start) {
  console.log('\n[5/5] 不起 dsh（--no-start）。手动起：')
  console.log(`  cd ${repo} && pnpm dsh --profile ${options.profile}`)
  process.exit(0)
}
step(5, '起 dsh')
if (testFailed) console.log('  ⚠ 提醒一句：这次的冒烟测试是红的（见上面第 2 步）')
// 先停掉上一次留下的那个：3080 被占着的话新的起不来，而且旧进程里跑的是旧代码，
// 「明明改了怎么没变」十次有九次是这个。stop.sh 找不到进程也返回 0。
const stopSh = join(repo, 'stop.sh')
if (existsSync(stopSh)) {
  const stopped = run('bash', ['./stop.sh'], repo)
  if (stopped.missing) console.log('  · 没找到 bash，跳过 stop.sh —— 端口要是还被占着，下面会起不来')
  else if (stopped.code !== 0) console.log(`  · stop.sh 退了 ${stopped.code}，照样往下走`)
}
const startSh = join(repo, 'start.sh')
const useStartSh = !options.plain && options.profile === 'web' && options.dsh.length === 0 && existsSync(startSh)
let launched = { code: 1, missing: true }
if (useStartSh) {
  // start.sh 里带着 DEEPSEEK_API_KEY / BASE_URL / CA 证书 / DSH_MODEL，能用就优先用它。
  console.log('  用仓库自带的 start.sh（带 API key / 证书 / 模型名）')
  launched = run('bash', ['./start.sh'], repo)
  if (launched.missing) console.log('  · 没有 bash，退回 pnpm dsh（环境变量得你自己给）')
}
if (launched.missing) {
  launched = run('pnpm', ['dsh', '--profile', options.profile, ...options.dsh], repo)
  if (launched.missing) fail('PATH 上没有 pnpm')
}
process.exit(launched.code)
