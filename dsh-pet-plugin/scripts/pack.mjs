/**
 * 打包分发脚本：校验清单与产物格式 → 跑冒烟测试 → pnpm/npm pack 出 tarball
 * → 解开 tarball 逐项复核里面装的到底是什么。
 *
 * 别人拿到 tarball 后只要一条命令，不需要任何构建授权：
 *   dsh plugin --profile web add ./dsh-pet-plugin-<version>.tgz
 *
 * 用法（零依赖，只需要 node）：
 *   node scripts/pack.mjs              # 全流程，产物落在 dist/
 *   node scripts/pack.mjs --check      # 只校验，不打包
 *   node scripts/pack.mjs --out build  # 换输出目录
 *   node scripts/pack.mjs --packer npm # 强制用 npm pack（默认 pnpm，失败自动退回 npm）
 */
import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 平台模块白名单 —— 浏览器产物只允许 require 这些。
 * 与 packages/client/web/src/platform.ts 的 PLATFORM_MODULES 一致，外加
 * tsdown.client.ts 里那条有文档记载的临时豁免（runtime/client）。
 */
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
])

/**
 * 必须出现在 tarball 里的文件（相对包根）。
 *
 * 不含 README.md：使用说明在仓库根的 README.md、插件详解在 plugin.md，
 * 两份都不在包根，npm 自然不会带上，也没必要为了打包再复制一份进来。
 */
const REQUIRED_IN_TARBALL = ['package.json', 'index.js', 'lib/client.js', 'cordis.patch.yml']

/** 绝不该被打进 tarball 的路径前缀（开发件）。 */
const FORBIDDEN_PREFIXES = ['test/', 'scripts/', 'node_modules/', 'dist/']

const args = process.argv.slice(2)

/**
 * 取一个 `--flag value` 形式的参数。
 * @param flag - 参数名，含前缀。
 * @param fallback - 缺省值。
 * @returns 参数值。
 */
function option(flag, fallback) {
  const at = args.indexOf(flag)
  return at === -1 || args[at + 1] === undefined ? fallback : args[at + 1]
}

const checkOnly = args.includes('--check')
const outDir = resolve(root, option('--out', 'dist'))
const forcedPacker = option('--packer', '')

const problems = []
const notes = []

/**
 * 记一条校验失败。
 * @param message - 失败描述。
 */
function fail(message) {
  problems.push(message)
}

/**
 * 断言一个条件，不成立就记失败。
 * @param condition - 条件。
 * @param message - 失败描述。
 */
function expect(condition, message) {
  if (!condition) fail(message)
}

// ---------------------------------------------------------------- 1. 清单

const pkgPath = join(root, 'package.json')
expect(existsSync(pkgPath), 'package.json 不存在')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

expect(typeof pkg.name === 'string' && pkg.name.length > 0, 'package.json 缺 name')
expect(/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(String(pkg.version)), `version 不是 semver: ${String(pkg.version)}`)
expect(pkg.type === 'module', 'package.json 必须是 "type": "module"（dsh 全仓纯 ESM）')
expect(typeof pkg.main === 'string', 'package.json 缺 main')

// bundle manifest：dsh plugin add 靠它决定要不要往 dsh.profile.bundles 里追加这一层。
const patch = pkg.dsh?.bundle?.patch
expect(typeof patch === 'string', 'dsh.bundle.patch 缺失 —— 没有它 dsh plugin add 只会当普通依赖装进来，不激活任何配置层')
if (typeof patch === 'string') {
  expect(existsSync(resolve(root, patch)), `dsh.bundle.patch 指向的文件不存在: ${patch}`)
}

// client manifest：client-modules 只认 platform === 'web'。
expect(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform 必须是 "web"')
const clientInject = pkg.dsh?.client?.inject
expect(
  clientInject === undefined || (Array.isArray(clientInject) && clientInject.every(x => typeof x === 'string')),
  'dsh.client.inject 必须是字符串数组或省略',
)

// exports：三条都是硬要求。
const exportsField = pkg.exports ?? {}
const clientExport = typeof exportsField['./client'] === 'string'
  ? exportsField['./client']
  : exportsField['./client']?.default
expect(typeof clientExport === 'string', 'exports["./client"] 缺失 —— client-modules 找不到浏览器产物就会抛 "declares dsh.client but exports no ./client bundle"')
expect(
  exportsField['./package.json'] === './package.json',
  'exports["./package.json"] 缺失 —— client-modules 用 require.resolve(`<pkg>/package.json`) 找清单，exports 会挡掉未列出的子路径',
)
expect(typeof exportsField['.'] === 'string' || exportsField['.']?.default !== undefined, 'exports["."] 缺失（host 半入口）')

// files：npm 自动带上 package.json/README，其余必须显式列出。
const files = Array.isArray(pkg.files) ? pkg.files : []
for (const needed of ['index.js', 'lib/client.js', 'cordis.patch.yml']) {
  expect(files.includes(needed), `package.json files 里缺 ${needed} —— 它不会被打进 tarball`)
  expect(existsSync(resolve(root, needed)), `文件不存在: ${needed}`)
}
for (const listed of files) {
  if (FORBIDDEN_PREFIXES.some(prefix => listed.startsWith(prefix))) {
    fail(`package.json files 里列了开发件: ${listed}`)
  }
}

// ------------------------------------------------- 2. cordis.patch.yml

if (typeof patch === 'string' && existsSync(resolve(root, patch))) {
  const patchText = readFileSync(resolve(root, patch), 'utf8')
  expect(/^\s*-\s*insert:/m.test(patchText), `${patch}: 没看到 "- insert:" —— 配置层不会插入任何 Loader 行`)
  // 行里的 name 必须是包名：client-modules 要求「一条活着的 entry，其 options.name 等于包名」。
  const named = new RegExp(`name:\\s*['"]?${pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm')
  expect(named.test(patchText), `${patch}: 没有一行的 name 等于包名 ${pkg.name} —— dsh.client 扫描会跳过这个包`)
}

// -------------------------------------------------- 3. 浏览器产物格式

const clientPath = resolve(root, clientExport ?? 'lib/client.js')
let clientSource = ''
if (!existsSync(clientPath)) {
  fail(`浏览器产物不存在: ${clientExport}`)
} else {
  clientSource = readFileSync(clientPath, 'utf8')

  // 语法先过一遍：产物是 classic script，语法错会在浏览器里变成一次静默的 boot 失败。
  const syntax = spawnSync(process.execPath, ['--check', clientPath], { encoding: 'utf8' })
  expect(syntax.status === 0, `浏览器产物语法错误:\n${syntax.stderr}`)

  // 模块表契约：banner / intro / footer 三件套，缺一件 factory 就注册不上。
  expect(
    clientSource.includes('window.__ModuleLoader__.load('),
    '浏览器产物没有调用 window.__ModuleLoader__.load —— 加载它不会注册任何 factory',
  )
  const idMatch = clientSource.match(/id:\s*(["'])(.+?)\1/)
  expect(idMatch !== null, '浏览器产物里找不到 id 字段')
  if (idMatch !== null) {
    expect(
      idMatch[2] === pkg.name,
      `浏览器产物的 id 是 "${idMatch[2]}"，必须等于包名 "${pkg.name}"（graph row id = entry name = 模块表 key）`,
    )
  }
  expect(/var\s+module\s*=\s*\{\s*exports:\s*\{\s*\}\s*\}/.test(clientSource), '浏览器产物缺 intro: var module = { exports: {} }')
  expect(clientSource.includes('return module.exports'), '浏览器产物缺 footer: return module.exports')
  expect(/exports\.apply\s*=/.test(clientSource), '浏览器产物没有导出 apply —— cordis 不认这是插件')

  // 纯净度：只允许 require 平台模块，其余在浏览器里必然 resolve 失败。
  const required = new Set()
  for (const hit of clientSource.matchAll(/\brequire\(\s*(["'])(.+?)\1\s*\)/g)) required.add(hit[2])
  for (const specifier of required) {
    expect(
      PLATFORM_MODULES.has(specifier),
      `浏览器产物 require 了非平台模块 "${specifier}" —— 模块表里没有它，运行时会抛 resolve 失败`,
    )
  }
  notes.push(`产物 require: ${required.size === 0 ? '(无)' : [...required].join(', ')}`)
  notes.push(`产物大小: ${(clientSource.length / 1024).toFixed(1)} KiB`)
}

// ------------------------------------------------------- 4. 冒烟测试

const smokePath = join(root, 'test', 'smoke.mjs')
if (existsSync(smokePath)) {
  const smoke = spawnSync(process.execPath, [smokePath], { cwd: root, encoding: 'utf8' })
  expect(smoke.status === 0, `冒烟测试失败:\n${smoke.stdout}${smoke.stderr}`)
  if (smoke.status === 0) notes.push(`冒烟测试: ${smoke.stdout.trim()}`)
} else {
  notes.push('冒烟测试: 跳过（test/smoke.mjs 不存在）')
}

report('校验')
if (checkOnly) {
  console.log('\n--check：只校验，不打包。')
  process.exit(0)
}

// ----------------------------------------------------------- 5. 打包

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const packers = forcedPacker === '' ? ['pnpm', 'npm'] : [forcedPacker]
let packed
for (const packer of packers) {
  // Windows 上 pnpm/npm 是 .cmd 包装脚本，Node 只肯经 shell 启动它们；
  // 把整条命令拼成一个字符串（而不是 shell:true + args 数组），避开 DEP0190。
  const run = spawnSync(`${packer} pack --pack-destination "${outDir}"`, {
    cwd: root, encoding: 'utf8', shell: true,
  })
  if (run.status === 0) {
    packed = packer
    break
  }
  const why = run.error?.message ?? (run.stderr ?? '').trim()
  console.warn(`[pack] ${packer} pack 失败${forcedPacker === '' ? '，换下一个' : ''}:\n${why}`)
}
if (packed === undefined) {
  console.error(`\n✗ 打包失败：${packers.join(' / ')} 都跑不起来`)
  process.exit(1)
}

const tarballs = readdirSync(outDir).filter(name => name.endsWith('.tgz'))
expect(tarballs.length === 1, `dist 里应当只有一个 tarball，实际 ${tarballs.length} 个`)
report('打包')
const tarball = join(outDir, tarballs[0])

// --------------------------------------------- 6. 复核 tarball 内容

/**
 * 解析一个未压缩的 tar，返回普通文件条目。tar 的头是 512 字节定长块：
 * name@0(100)、size@124(12, 八进制)、typeflag@156(1)、prefix@345(155)。
 * @param buffer - 解压后的 tar 字节。
 * @returns 条目数组 { name, content }。
 */
function readTar(buffer) {
  const entries = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    /**
     * 读一个 NUL 结尾的定长字符串字段。
     * @param at - 起始偏移。
     * @param length - 字段长度。
     * @returns 去掉 NUL 填充的字符串。
     */
    const field = (at, length) => header.subarray(at, at + length).toString('utf8').replace(/\0.*$/s, '')
    const prefix = field(345, 155)
    const name = field(0, 100)
    const size = Number.parseInt(field(124, 12).trim(), 8) || 0
    const type = String.fromCharCode(header[156])
    const body = offset + 512
    if (name !== '' && (type === '0' || type === '\0' || type === '')) {
      entries.push({
        name: prefix === '' ? name : `${prefix}/${name}`,
        content: buffer.subarray(body, body + size),
      })
    }
    offset = body + Math.ceil(size / 512) * 512
  }
  return entries
}

const entries = readTar(gunzipSync(readFileSync(tarball)))
// npm/pnpm 把所有内容放在 package/ 前缀下。
const inside = new Map(entries.map(entry => [entry.name.replace(/^package\//, ''), entry.content]))

for (const needed of REQUIRED_IN_TARBALL) {
  expect(inside.has(needed), `tarball 里缺 ${needed}`)
}
for (const name of inside.keys()) {
  if (FORBIDDEN_PREFIXES.some(prefix => name.startsWith(prefix))) {
    fail(`tarball 里混进了开发件: ${name}`)
  }
}
// 装出去的产物必须与本地校验过的那一份逐字节相同。
if (inside.has('lib/client.js') && clientSource !== '') {
  expect(
    inside.get('lib/client.js').toString('utf8') === clientSource,
    'tarball 里的 lib/client.js 与本地文件不一致',
  )
}
// 清单也复核一遍：解压出来的 package.json 仍要带两个 dsh manifest。
if (inside.has('package.json')) {
  const shipped = JSON.parse(inside.get('package.json').toString('utf8'))
  expect(shipped.dsh?.bundle?.patch !== undefined, 'tarball 里的 package.json 丢了 dsh.bundle')
  expect(shipped.dsh?.client?.platform === 'web', 'tarball 里的 package.json 丢了 dsh.client')
}

report('复核')

const kib = (readFileSync(tarball).length / 1024).toFixed(1)
console.log(`
✓ ${pkg.name}@${pkg.version} 打包完成（${packed} pack, ${kib} KiB, ${inside.size} 个文件）

  ${tarball}

分发给别人后，对方只需要一条命令，不需要 pnpm 的 allowBuilds 授权：

  dsh plugin --profile web add ${tarball.replace(/\\/g, '/')}
  dsh --profile web --dump-config      # 应当看到 "# == ${pkg.name}" 这一层
  dsh web
`)

/**
 * 打印一个阶段的结果；有失败就整体退出。
 * @param stage - 阶段名，用于报错抬头。
 */
function report(stage) {
  if (problems.length === 0) {
    console.log(`✓ ${stage}通过`)
    for (const note of notes.splice(0)) console.log(`  · ${note}`)
    return
  }
  console.error(`\n✗ ${stage}失败（${problems.length} 项）：`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
