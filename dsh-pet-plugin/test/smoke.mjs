/**
 * 无依赖冒烟测试：用桩件把 lib/client.js 的 factory 跑起来，喂一串假的
 * SessionEvent，断言 combo / 食物量 / 经验 / 特效 / 幂等闸门的行为。
 *
 * 只需要 node，不需要安装任何依赖：
 *   node test/smoke.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// ---- 桩件 ----------------------------------------------------------------

/** 只记录节点结构的 React 桩：hooks 返回初值，effect 立即执行。 */
const effects = []
const react = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: initial => [initial, () => {}],
  useEffect: (fn) => { effects.push(fn) },
}

const styleTags = []

/** 造一个只会量矩形的假元素。 */
const fakeElement = rect => ({ getBoundingClientRect: () => rect })

/**
 * 假 DOM。`anchors` 决定 measureFlight 能不能量到会话区与宠物头像；
 * 置为 null 就模拟「没有会话打开」，用来验证退回就地飞入的分支。
 */
/** 眼睛跟鼠标写的那两个 CSS 变量都落在这儿（产物直接写 style，不进 React）。 */
const eyeVars = new Map()
const ANCHORS = {
  '[data-conversation-scroll]': fakeElement({ left: 260, top: 60, right: 1160, bottom: 860, width: 900, height: 800 }),
  '.dshpet-avatar': fakeElement({ left: 1320, top: 800, right: 1350, bottom: 830, width: 30, height: 30 }),
  '.dshpet-root': {
    style: { setProperty: (name, value) => { eyeVars.set(name, value) } },
  },
}
let anchors = ANCHORS
const document = {
  querySelector: (selector) => {
    if (anchors !== null && Object.hasOwn(anchors, selector)) return anchors[selector]
    return styleTags.find(tag => selector.includes(tag.dataset.pluginCss)) ?? null
  },
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: tag => { styleTags.push(tag) } },
}

let registered = null
let overlay = null
const ctx = {
  effect: (fn) => { fn() },
  conversationEvents: {
    register: (definition) => { registered = definition; return () => {} },
  },
  slots: {
    inject: (name, callback) => { assert.equal(name, 'shell.overlay'); callback() },
    register: (options, component) => { overlay = { options, component }; return () => {} },
  },
}

const loaded = []

/** localStorage 桩：真的存东西，持久化那一半才测得动。 */
const storage = new Map()
const fakeLocalStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)) },
  removeItem: (key) => { storage.delete(key) },
}

/** window 事件桩：把监听器记下来，测试里手动派发。 */
const windowListeners = new Map()
/** 派发一个假的 window 事件。 */
const fireWindow = (type, event) => {
  for (const fn of windowListeners.get(type) ?? []) fn(event)
}

globalThis.window = {
  __ModuleLoader__: { load: entry => { loaded.push(entry) } },
  localStorage: fakeLocalStorage,
  addEventListener: (type, fn) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set())
    windowListeners.get(type).add(fn)
  },
  removeEventListener: (type, fn) => { windowListeners.get(type)?.delete(fn) },
}
globalThis.document = document
globalThis.TextEncoder = TextEncoder

// ---- 执行产物 ------------------------------------------------------------

const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
// 产物是浏览器 CJS factory；在 node 里直接 eval 它即可完成注册。
new Function('window', 'document', 'TextEncoder', 'console', source)(
  globalThis.window, document, TextEncoder, console,
)

assert.equal(loaded.length, 1, 'factory 应当只注册一次')
assert.equal(loaded[0].id, 'dsh-pet-plugin', 'id 必须等于包名')

const mod = loaded[0].factory(specifier => {
  if (specifier === 'react') return react
  throw new Error(`产物 require 了非平台模块: ${specifier}`)
})

assert.deepEqual(mod.inject, ['slots', 'conversationEvents'])
mod.apply(ctx)
assert.ok(registered !== null, 'Definition 应当已注册')
assert.ok(overlay !== null, 'overlay 应当已注册进 shell.overlay')
assert.equal(overlay.options.id, 'pet')
assert.equal(styleTags.length, 1, '样式应当注入且只注入一次')
/** 注入的样式表原文；用来核对渲染树里的部件都有对应规则。 */
const CSS_TEXT = styleTags[0].textContent

/**
 * 从产物源码里抠出某个场合的台词池。
 *
 * 台词表不导出，本来是逐字钉死一句（`'还要摸'`），但取哪句现在走确定性伪随机
 * （pickLineIndex），钉死一句等于把 hash 的输出写进测试 —— 往池子里加一句台词
 * 就会红一片，而那不是回归。改成断言「说出来的这句确实来自这个池子」。
 * @param {string} kind 场合名（BUBBLE_LINES 的键）
 * @returns {string[]} 这个场合的所有台词
 */
function linesOf(kind) {
  const head = `\n      ${kind}: [`
  const at = source.indexOf(head)
  assert.ok(at >= 0, `台词表里应当有 ${kind} 这一档`)
  const body = source.slice(at + head.length)
  const lines = body.slice(0, body.indexOf(']')).match(/"[^"]*"/g)
  assert.ok(lines !== null && lines.length > 0, `${kind} 的台词池是空的`)
  return lines.map(text => text.slice(1, -1))
}

// ---- 驱动事件 ------------------------------------------------------------

let seq = 0
const now = () => Date.now()

/** 造一条 user/message 事件。 */
const userEvent = text => ({
  type: 'user/message', seq: ++seq, time: now(),
  data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
})

/** 造一条带 usage 的 assistant/message 事件。 */
const assistantEvent = outputTokens => ({
  type: 'assistant/message', seq: ++seq, time: now(),
  data: { turn: 1, step: 1, message: { role: 'assistant' }, usage: { inputTokens: 0, outputTokens } },
})

/** tool/result 的 message.content —— 产物就是照它的 JSON 长度估 token 的。 */
const toolContentOf = size => [
  { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'x'.repeat(size) }] },
]

/** 造一条 tool/result 事件。 */
const toolEvent = size => ({
  type: 'tool/result', seq: ++seq, time: now(),
  data: { turn: 1, step: 1, message: { role: 'user', content: toolContentOf(size) } },
})

/**
 * 照抄产物 classify 里的 token 估算：tool/result 按 content 的 JSON 字节数折半。
 * 别在断言里写死数字 —— 这个系数是要调的，写死了每次调都得改一排期望值。
 */
const toolTokensOf = size => Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(toolContentOf(size)), 'utf8') / 2))

/** 把一条事件送进某份 Definition，模拟引擎的 match → start。 */
function dispatchVia(definition, event) {
  const match = definition.match(event)
  if (match === null) return null
  assert.equal(match.role, 'start')
  const state = definition.start({ state: undefined, matches: [] }, { event, view: undefined }, {})
  assert.deepEqual(state, { seq: event.seq })
  return match
}

/** 把一条事件送进主实例。 */
function dispatch(event) {
  return dispatchVia(registered, event)
}

// 不是喂食源的事件必须被忽略。
assert.equal(registered.match({ type: 'turn/start', seq: ++seq, time: now(), data: { turn: 1 } }), null)
// 没有 usage 的 assistant/message 不算一次 generation。
assert.equal(registered.match({ type: 'assistant/message', seq: ++seq, time: now(), data: {} }), null)
// 插件注入的上下文虽然也是 user/message，但不是「用户输入」。
assert.equal(registered.match({
  type: 'user/message', seq: ++seq, time: now(),
  data: { source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: 'hi' }] },
}), null)

// combo 1：用户输入 400 字 ≈ 100 tokens
//   → food = floor(2.5*log2(1+100/60)+0.5) + floor(1/2) = 4 + 0 = 4，exp = 1*1.2+0.5 → 1
const first = userEvent('字'.repeat(400))
dispatch(first)

// combo 2：generation 1000 tokens → floor(2.5*log2(1+1000/60)+0.5) + 1 = 10 + 1 = 11
dispatch(assistantEvent(1000))

// combo 3..：工具结果
for (let i = 0; i < 8; i += 1) dispatch(toolEvent(4000))

// 幂等：同一条事件重复折叠（引擎在翻历史 / 边界解析时会重跑 start）不再喂食。
const before = overlayState().totalFeeds
dispatch(first)
assert.equal(overlayState().totalFeeds, before, '同一条事件不应被喂两次')

// 陈旧事件（打开旧会话时整段日志会被折叠一次）匹配得上，但不喂食。
const stale = {
  type: 'assistant/message', seq: ++seq, time: now() - 10 * 60 * 1000,
  data: { usage: { outputTokens: 500 } },
}
assert.equal(registered.match(stale).role, 'start')
const beforeStale = overlayState().totalFeeds
registered.start({ state: undefined, matches: [] }, { event: stale, view: undefined }, {})
assert.equal(overlayState().totalFeeds, beforeStale, '陈旧事件不应喂食')

const STATE_KEY = 'dsh-pet-plugin/state'
const CONFIG_KEY = 'dsh-pet-plugin/config'

/** 从一个 overlay 组件里读 store 的当前状态（第一个 useState 初值就是快照）。 */
function stateOf(component) {
  let captured
  const original = react.useState
  react.useState = (initial) => {
    if (captured === undefined) captured = initial
    return [initial, () => {}]
  }
  try {
    component({})
  } finally {
    react.useState = original
  }
  return captured
}

/** 主实例的当前状态。 */
function overlayState() {
  return stateOf(overlay.component)
}

/**
 * 用当前 localStorage 的内容重启一份插件实例（config 也重新读一遍）。
 * @returns { component, readState } —— 组件本身 + 读它状态的函数。
 */
function bootFresh() {
  let freshOverlay = null
  let freshDefinition = null
  const freshMod = loaded[0].factory(specifier => {
    if (specifier === 'react') return react
    throw new Error(`产物 require 了非平台模块: ${specifier}`)
  })
  freshMod.apply({
    effect: (fn) => { fn() },
    conversationEvents: {
      register: (definition) => { freshDefinition = definition; return () => {} },
    },
    slots: {
      inject: (name, callback) => { callback() },
      register: (options, component) => { freshOverlay = { options, component }; return () => {} },
    },
  })
  assert.ok(freshOverlay !== null, '重启的实例也应当注册 overlay')
  return {
    component: freshOverlay.component,
    readState: () => stateOf(freshOverlay.component),
    /** 往这份实例喂一条事件（Agent 喂食那条路，和主实例走同样的闸门）。 */
    feed: (event) => dispatchVia(freshDefinition, event),
  }
}

/**
 * 只挑「一口饭」那种特效：通知类特效（进阶 / 成就 / 任务 / 摸头）自带整句
 * 文案、没有食物量与飞行轨迹可言，混进来会把下面几条断言全带偏。
 */
const isFeedFx = effect => effect.text === undefined

/** 最后一口饭那条特效（跳过后面可能追加的成就 / 任务通知）。 */
const lastFeedFx = () => overlayState().effects.filter(isFeedFx).at(-1)

const state = overlayState()
assert.equal(state.comboCount, 10, 'combo 应当在第 10 次封顶')
assert.equal(Number(state.comboMultiplier.toFixed(1)), 3, '倍率上限 3.0x')
assert.equal(state.comboTier, 'epic')
assert.equal(state.totalFeeds, 10)
assert.ok(state.pet.hunger < 60, 'hunger 应当被喂下来')
assert.ok(state.pet.level >= 1)
assert.ok(state.effects.length > 0, '应当有活跃特效')
for (const effect of state.effects.filter(isFeedFx)) {
  assert.ok(effect.foodAmount >= 1 && effect.foodAmount <= 30, `食物量越界: ${effect.foodAmount}`)
  assert.ok(effect.expAmount >= 1)
  assert.ok(['tiny', 'small', 'large', 'feast'].includes(effect.foodTier), `档位非法: ${effect.foodTier}`)
  assert.equal(typeof effect.tokens, 'number')
}

// ---- 食物的飞行轨迹 ------------------------------------------------------

// 起点应当量到会话区里、终点是宠物头像；上面的假矩形里会话区在宠物左上方。
// fromX ∈ [260+900×0.34, 260+900×0.66] = [566, 854]，头像中心 x = 1335 → dx < 0
// fromY = 860 - min(120, 800×0.22) = 740，头像中心 y = 815 → dy = -75
for (const effect of state.effects.filter(isFeedFx)) {
  assert.equal(effect.flight.across, true, '应当量到会话锚点')
  assert.equal(effect.flight.dy, -75, `dy 应当是 -75，实际 ${effect.flight.dy}`)
  assert.ok(effect.flight.dx <= -481 && effect.flight.dx >= -769, `dx 越界: ${effect.flight.dx}`)
}
assert.ok(
  new Set(state.effects.filter(isFeedFx).map(e => e.flight.dx)).size > 1,
  '连击时起点应当横向散开，而不是叠成一条线',
)

// 渲染一遍，确认组件本体不抛。
const tree = overlay.component({})
assert.equal(tree.props.className, 'dshpet-root')
assert.equal(effects.length >= 1, true, '组件应当订阅 store')

// 位移必须真的走到食物元素的自定义属性上，否则 keyframe 读不到。
/** 在渲染树里深度查找第一个满足断言的节点。 */
function findNode(node, predicate) {
  if (node === null || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of [node.children ?? [], node.props?.children ?? []].flat(2)) {
    const hit = findNode(child, predicate)
    if (hit !== null) return hit
  }
  return null
}

/** 同上，但把所有命中的节点都收上来（数徽章 / 数任务行要用）。 */
function findAll(node, predicate, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  for (const child of [node.children ?? [], node.props?.children ?? []].flat(2)) {
    findAll(child, predicate, out)
  }
  return out
}
const fx = findNode(tree, n => n.props?.className === 'dshpet-fx')
assert.ok(fx !== null, '特效层应当在渲染树里')
const feedEl = findNode(fx, n => typeof n.type === 'function')
assert.ok(feedEl !== null, '应当渲染出 FeedEffect')
const food = findNode(feedEl.type(feedEl.props), n => n.props?.className === 'dshpet-food')
assert.ok(food !== null, '应当渲染出食物元素')
assert.equal(food.props['data-flight'], 'across')
assert.match(food.props.style['--dshpet-dx'], /^-\d+px$/)
assert.equal(food.props.style['--dshpet-dy'], '-75px')

/** 鲸鱼底座精灵的文件名（APNG 版没有嘴型/部件节点，用 data-sprite 区分状态）。 */
const srcOf = whale => {
  const img = findNode(whale, n => n.props && Object.prototype.hasOwnProperty.call(n.props, 'data-sprite'))
  return img ? img.props['data-sprite'] : ''
}
/** 鲸鱼底座 img 的无障碍名（aria-label 在 img 上，不在叠加容器上）。 */
const ariaOf = whale => {
  const img = findNode(whale, n => n.props && Object.prototype.hasOwnProperty.call(n.props, 'data-sprite'))
  return img ? img.props['aria-label'] : ''
}

// 头像是 APNG 精灵的二次元鲸鱼；epic 连击时切到兴奋态动图。
const avatar = findNode(tree, n => n.props?.className === 'dshpet-avatar')
assert.ok(avatar !== null, '头像应当在渲染树里')
const whaleEl = findNode(avatar, n => typeof n.type === 'function')
assert.ok(whaleEl !== null, 'petAvatar=whale 时头像里应当是组件而不是 emoji')
assert.equal(whaleEl.props.tier, 'epic', '此刻应当是 epic 连击')
const whale = whaleEl.type(whaleEl.props)
assert.equal(whale.type, 'span', 'APNG 版头像是一个叠加容器')
assert.equal(whale.props.className, 'dshpet-avatar-stack')
// 底座 + eat/pat 三层 img 都在，且都有对应样式（APNG 自带浮沉循环动画）。
for (const cls of ['dshpet-whale-sprite', 'dshpet-sprite-eat', 'dshpet-sprite-pat']) {
  assert.ok(
    findNode(whale, n => typeof n.props?.className === 'string' && n.props.className.includes(cls)) !== null,
    `缺精灵层: ${cls}`,
  )
  assert.ok(CSS_TEXT.includes('.' + cls), `${cls} 没有对应样式`)
}
assert.ok(
  srcOf(whale).indexOf('-excited.apng') !== -1,
  'epic 时底座应当是兴奋态动图',
)
const calmWhale = whaleEl.type({ tier: 'normal' })
assert.equal(
  srcOf(calmWhale).indexOf('-excited.apng') !== -1, false,
  'normal 时不该是兴奋态',
)
assert.notEqual(
  srcOf(calmWhale), srcOf(whale),
  'epic 的动图应当和平时不同',
)

// 没有会话打开（量不到锚点）时退回策划原本的就地飞入，而不是飞到屏幕外。
anchors = null
dispatch(userEvent('之后'))
const fallback = lastFeedFx()
assert.equal(fallback.flight.across, false, '量不到锚点时应当退回就地飞入')
assert.equal(fallback.flight.dx, 0)
assert.equal(fallback.flight.dy, 40)
const localFood = findNode(
  ((el) => el.type(el.props))(findNode(
    findNode(overlay.component({}), n => n.props?.className === 'dshpet-fx'),
    n => typeof n.type === 'function' && n.props.effect.key === fallback.key,
  )),
  n => n.props?.className === 'dshpet-food',
)
assert.equal(localFood.props['data-flight'], 'local')

// ---- 食物模型体现 token 消耗量 -------------------------------------------

/**
 * 喂一条 generation 事件，返回它产生的那条特效 + 当时的连击数 + 这一口吃下去
 * 之前暴食 BUFF 在不在（BUFF 是乘在食物量上的，核对曲线时得把它算进来）。
 */
function feedTokens(tokens) {
  const frenzy = overlayState().buff !== null
  dispatch(assistantEvent(tokens))
  const snapshot = overlayState()
  return { effect: snapshot.effects.filter(isFeedFx).at(-1), combo: snapshot.comboCount, frenzy }
}

/** 产物里的食物量公式，照抄一份用来核对曲线本身。 */
const expectFood = (tokens, combo, frenzy = false) => Math.min(30, Math.max(1,
  Math.round(Math.floor(2.5 * Math.log2(1 + tokens / 60) + 0.5) * (frenzy ? 1.2 : 1))
  + Math.floor(combo / 2)))

// 四个量级：曲线值对得上、严格递增、档位分别是 tiny/small/large/feast。
const LADDER = [20, 200, 2000, 20000]
const TIERS = ['tiny', 'small', 'large', 'feast']
const rungs = LADDER.map(feedTokens)
rungs.forEach((rung, i) => {
  assert.equal(rung.effect.tokens, LADDER[i], `token 数应当原样带到特效上`)
  assert.equal(
    rung.effect.foodAmount, expectFood(LADDER[i], rung.combo, rung.frenzy),
    `${LADDER[i]} token 的食物量应当是 ${expectFood(LADDER[i], rung.combo, rung.frenzy)}，`
    + `实际 ${rung.effect.foodAmount}`,
  )
  assert.ok(rung.effect.foodAmount <= 30, `食物量越界: ${rung.effect.foodAmount}`)
  assert.equal(rung.effect.foodTier, TIERS[i], `${LADDER[i]} token 应当是 ${TIERS[i]} 档`)
})
for (let i = 1; i < rungs.length; i += 1) {
  assert.ok(
    rungs[i].effect.foodAmount > rungs[i - 1].effect.foodAmount,
    `食物量应当随 token 量级严格递增: ${LADDER[i - 1]}→${rungs[i - 1].effect.foodAmount}, `
    + `${LADDER[i]}→${rungs[i].effect.foodAmount}`,
  )
}
// 四个档位的图标必须互不相同，否则「看大小认量级」就只剩字号一条线索。
assert.equal(new Set(rungs.map(r => r.effect.icon)).size, 4, '四个档位应当是四个不同图标')

// token 口径 = input + output：1800+200 与纯 2000 output 应当完全等价。
dispatch({
  type: 'assistant/message', seq: ++seq, time: now(),
  data: { usage: { inputTokens: 1800, outputTokens: 200 } },
})
const splitState = overlayState()
const splitEffect = splitState.effects.filter(isFeedFx).at(-1)
assert.equal(splitEffect.tokens, 2000, 'inputTokens 必须计入消耗量')
// 两边的连击加成必须一样，等价比较才成立；连击此刻已封顶在 10。
assert.equal(splitState.comboCount, rungs[2].combo, '两次比较应当处在同一连击档')
assert.equal(
  splitEffect.foodAmount, rungs[2].effect.foodAmount,
  '1800+200 与 0+2000 应当喂出同样多的食物',
)

// 累计 token：总量 = 三个源之和，且随喂食增长。
const counted = overlayState()
assert.equal(
  counted.totalTokens,
  counted.tokensBySource.user_input + counted.tokensBySource.generation
  + counted.tokensBySource.tool_result,
  '累计 token 应当等于三个源之和',
)
assert.ok(counted.totalTokens > 20000, `累计 token 偏小: ${counted.totalTokens}`)
for (const source of ['user_input', 'generation', 'tool_result']) {
  assert.ok(counted.tokensBySource[source] > 0, `${source} 应当有累计 token`)
}

// 渲染层：食物元素带 data-size，飘字里有 token 文本，档位都有对应 CSS。
const tokenTree = overlay.component({})
const lastFx = findNode(
  findNode(tokenTree, n => n.props?.className === 'dshpet-fx'),
  n => typeof n.type === 'function' && n.props.effect.key === splitEffect.key,
)
const lastRendered = lastFx.type(lastFx.props)
assert.equal(
  findNode(lastRendered, n => n.props?.className === 'dshpet-food').props['data-size'],
  splitEffect.foodTier,
  'data-size 应当等于这一口的档位',
)
const floatText = findNode(lastRendered, n => n.props?.className === 'dshpet-float').children.join('')
assert.match(floatText, /\d+(\.\d)?k? tok/, `飘字里应当有 token 数，实际: ${floatText}`)
for (const tier of TIERS) {
  assert.ok(CSS_TEXT.includes(`[data-size=${tier}]`), `${tier} 档没有对应字号规则`)
}
// 累计面板那一行。
const panel = findNode(tokenTree, n => n.props?.className === 'dshpet-sub dshpet-tokens')
assert.ok(panel !== null, '卡片里应当有累计 token 面板')
assert.match(panel.children.join(''), /^消耗 \S+ tok · /, '面板文案不对: ' + panel.children.join(''))
assert.ok(CSS_TEXT.includes('.dshpet-tokens'), '.dshpet-tokens 没有对应样式')

// ---- 时间饥饿回升 --------------------------------------------------------

// hunger 此刻已经被喂到 0；把时钟推 30 分钟，回升应当把它顶回去（每分钟 +2，
// 封顶 100），随后这一口再扣掉自己的食物量。
assert.equal(overlayState().pet.hunger, 0, '前面的连喂应当已经把 hunger 喂到 0')
const realNow = Date.now
try {
  const later = realNow() + 30 * 60 * 1000
  Date.now = () => later
  dispatch(userEvent('之后又过了半小时'))
  const regened = overlayState()
  assert.ok(
    regened.pet.hunger > 0,
    `空闲 30 分钟后 hunger 应当回升，实际 ${regened.pet.hunger}`,
  )
  assert.ok(
    regened.pet.hunger <= 60,
    `回升量应当是 30min × 2 = 60 再减掉这一口，实际 ${regened.pet.hunger}`,
  )
} finally {
  Date.now = realNow
}

// ---- 主动喂食：零食 ------------------------------------------------------

const MANUAL_FOOD = 15
const SNACK_MAX = 5
const SNACK_REGEN_MS = 45 * 1000

/** 在一棵渲染树里找零食按钮（没有就返回 null）。 */
function snackButton(component) {
  return findNode(component({}), n => n.props?.className === 'dshpet-snack')
}

/** 点一下零食按钮，返回它有没有拦住冒泡（拦不住会顺手把卡片折叠掉）。 */
function clickSnack(component) {
  const button = snackButton(component)
  assert.ok(button !== null, '卡片上应当有零食按钮')
  let stopped = false
  button.props.onClick({ stopPropagation: () => { stopped = true } })
  return stopped
}

/** 累计经验：升级会把 exp 扣掉，按等级折算回来才好比较。 */
const totalExp = pet => (pet.level - 1) * pet.level / 2 * 100 + pet.exp

/** 饱食条 / 鲸鱼嘴型：饿了的警告要断言到具体节点上。 */
const cardOf = component => findNode(component({}), n => n.props?.className === 'dshpet-card')
const fullBarOf = card => findNode(card, n => n.props?.className === 'dshpet-bar dshpet-bar-full')

// 把会话锚点装回来（前面测就地飞入时置成了 null）：这样「零食不从会话区飞」
// 才是个有意义的断言，而不是恰好赶上了量不到锚点的退路。
anchors = ANCHORS

// 满格、可点，按钮上写着剩几个。
assert.equal(overlayState().snacks, SNACK_MAX, '新宠物应当一上来就是满格零食')
const idleButton = snackButton(overlay.component)
assert.equal(idleButton.props.disabled, false, '有库存时按钮应当可点')
assert.equal(idleButton.children[0], '🍬', '按钮上应当是零食图标')
assert.equal(
  findNode(idleButton, n => n.props?.className === 'dshpet-snack-n').children.join(''),
  String(SNACK_MAX), '按钮上应当写着还剩几个',
)
assert.ok(CSS_TEXT.includes('.dshpet-snack'), '.dshpet-snack 没有对应样式')

// 点一口：只动饱食度 / 经验 / 喂食次数 / 库存，别的一个字节都不许动。
const beforeSnack = overlayState()
assert.equal(clickSnack(overlay.component), true, '零食按钮必须拦住冒泡，否则会把卡片折叠掉')
const afterSnack = overlayState()
assert.equal(
  afterSnack.pet.hunger, beforeSnack.pet.hunger - MANUAL_FOOD,
  `一口零食应当正好顶 ${MANUAL_FOOD} 点饥饿`,
)
assert.equal(afterSnack.snacks, beforeSnack.snacks - 1, '喂一口应当扣一格库存')
assert.equal(afterSnack.totalFeeds, beforeSnack.totalFeeds + 1, '手喂也算喂食次数')
assert.equal(totalExp(afterSnack.pet), totalExp(beforeSnack.pet) + 1, '一口零食应当给 1 点经验')
assert.equal(afterSnack.totalTokens, beforeSnack.totalTokens, '手喂不是 Agent 消耗，不该进 token 统计')
assert.deepEqual(afterSnack.tokensBySource, beforeSnack.tokensBySource, '手喂不该改分源统计')
assert.equal(afterSnack.comboCount, beforeSnack.comboCount, '手喂不该攒连击（否则能刷经验倍率）')

// 特效：固定的零食图标、不报 token、就地飞入。
const snackEffect = afterSnack.effects.filter(isFeedFx).at(-1)
assert.equal(snackEffect.icon, '🍬')
assert.equal(snackEffect.source, 'manual')
assert.equal(snackEffect.tokens, 0, '零食没有 token 可言')
assert.equal(snackEffect.foodAmount, MANUAL_FOOD)
assert.equal(snackEffect.foodTier, 'small', '零食固定小食档，不参与 token 分档')
assert.equal(snackEffect.tier, 'normal', '手喂的飘字不该染上连击档位')
assert.equal(snackEffect.flight.across, false, '零食就地飞入，不从会话区飞')
const snackFxEl = findNode(
  findNode(overlay.component({}), n => n.props?.className === 'dshpet-fx'),
  n => typeof n.type === 'function' && n.props.effect.key === snackEffect.key,
)
assert.ok(snackFxEl !== null, '零食也应当渲染出一条特效')
const snackFloat = findNode(
  snackFxEl.type(snackFxEl.props), n => n.props?.className === 'dshpet-float',
).children.join('')
assert.doesNotMatch(snackFloat, /tok/, `手喂的飘字不该写 token: ${snackFloat}`)
assert.equal(snackFloat, '+15 🍬  +1 ⭐', '飘字文案不对: ' + snackFloat)

// 库存限流：连点到空，按钮变灰，再点也喂不进去。
for (let i = 1; i < SNACK_MAX; i += 1) clickSnack(overlay.component)
const empty = overlayState()
assert.equal(empty.snacks, 0, `连点 ${SNACK_MAX} 次应当把库存点空`)
assert.equal(snackButton(overlay.component).props.disabled, true, '没库存时按钮应当禁用')
clickSnack(overlay.component) // 浏览器里 disabled 不会触发，这里直接调 onClick 验 store 侧的守卫
const stillEmpty = overlayState()
assert.equal(stillEmpty.snacks, 0, '没库存时不该扣出负数')
assert.equal(stillEmpty.totalFeeds, empty.totalFeeds, '没库存时不该喂进去')
assert.equal(stillEmpty.pet.hunger, empty.pet.hunger, '没库存时饱食度不该动')

const snackNow = Date.now
try {
  // 45 秒回一格：回来的这一格立刻又被吃掉。
  const later = snackNow() + SNACK_REGEN_MS
  Date.now = () => later
  clickSnack(overlay.component)
  const regened = overlayState()
  assert.equal(regened.totalFeeds, empty.totalFeeds + 1, `${SNACK_REGEN_MS / 1000} 秒后应当又能喂一口`)
  assert.equal(regened.snacks, 0, '回的那一格应当被这一口吃掉')

  // 饿了：把时钟推 60 分钟（每分钟 +2 → 顶到 100），这一口顺手把饥饿结算进来。
  const hungryAt = snackNow() + 60 * 60 * 1000
  Date.now = () => hungryAt
  clickSnack(overlay.component)
  const starving = overlayState()
  assert.ok(starving.pet.hunger >= 80, `此刻应当饿着，实际 ${starving.pet.hunger}`)
  const hungryCard = cardOf(overlay.component)
  assert.equal(hungryCard.props['data-hungry'], 'true', '饿了卡片应当挂告警标记')
  assert.equal(fullBarOf(hungryCard).props['data-low'], 'true', '饿了饱食条应当变红')
  assert.equal(snackButton(overlay.component).props['data-urge'], 'true', '饿着又有零食时按钮应当提醒')
  const hungryWhaleEl = findNode(hungryCard, n => typeof n.type === 'function')
  assert.equal(hungryWhaleEl.props.hungry, true, '饿了应当把状态传给鲸鱼')
  assert.notEqual(
    srcOf(hungryWhaleEl.type(hungryWhaleEl.props)), srcOf(calmWhale),
    '饿脸应当切换到 hungry 态动图',
  )
  assert.ok(
    srcOf(hungryWhaleEl.type(hungryWhaleEl.props)).indexOf('-hungry.apng') !== -1,
    '饿脸应当用 hungry 态动图',
  )
  assert.ok(CSS_TEXT.includes('.dshpet-card[data-hungry=true]'), '饿了的卡片没有对应样式')
  assert.ok(CSS_TEXT.includes('.dshpet-bar-full[data-low=true]'), '变红的饱食条没有对应样式')
  assert.ok(CSS_TEXT.includes('dshpet-snack-urge'), '按钮脉冲没有对应动画')

  // 喂回去：三个告警标记一起消失（宠物不会饿死，饿只是个提醒）。
  clickSnack(overlay.component)
  clickSnack(overlay.component)
  const fed = overlayState()
  assert.ok(fed.pet.hunger < 80, `喂两口之后应当不饿了，实际 ${fed.pet.hunger}`)
  const fedCard = cardOf(overlay.component)
  assert.equal(fedCard.props['data-hungry'], undefined, '不饿了就不该再挂告警')
  assert.equal(fullBarOf(fedCard).props['data-low'], undefined, '不饿了饱食条应当恢复橙色')
  assert.equal(snackButton(overlay.component).props['data-urge'], undefined, '不饿了按钮就别跳了')
} finally {
  Date.now = snackNow
}

// 整场喂了这么多口也只升到 Lv.2（还在幼崽档），所以一条进阶特效都不该有 ——
// 普通升级不飘「进阶」，否则前期每喂几口就来一次，很快就成噪音。
const soFar = overlayState()
assert.ok(soFar.pet.level < 3, `主实例应当还在幼崽档，实际 Lv.${soFar.pet.level}`)
assert.equal(
  soFar.effects.filter(e => e.source === 'evolve').length, 0,
  '没跨档就不该飘进阶特效',
)

// 两个开关（`effectsEnabled` / `manualFeedEnabled`）要另起一份实例才测得了，
// 而重启的实例会跟着 pagehide 一起抢着落盘 —— 所以挪到持久化小节后面去测。

// ---- 持久化 --------------------------------------------------------------

// 页面要走的时候必须落盘（平时是 1.5s 合并写）。
fireWindow('pagehide')
const savedRaw = fakeLocalStorage.getItem(STATE_KEY)
assert.ok(savedRaw !== null, 'pagehide 时应当把进度写进 localStorage')
const savedDoc = JSON.parse(savedRaw)
const live = overlayState()
assert.equal(savedDoc.v, 2, '存档应当带版本号')
assert.equal(typeof savedDoc.savedAt, 'number', '存档应当带时间戳')
// v2 格式：宠物数据在 savedDoc.pets[activePetId] 里
const savedPetRec = savedDoc.pets[savedDoc.activePetId]
assert.ok(savedPetRec, '存档应当有活跃宠物记录')
assert.equal(savedPetRec.pet.level, live.pet.level)
assert.equal(savedPetRec.pet.hunger, live.pet.hunger)
assert.equal(savedPetRec.pet.exp, live.pet.exp)
assert.equal(savedPetRec.totalFeeds, live.totalFeeds)
assert.equal(savedPetRec.totalTokens, live.totalTokens)
assert.deepEqual(savedPetRec.tokensBySource, live.tokensBySource)
assert.equal(savedPetRec.snacks, live.snacks, '零食格数也要落盘，否则刷新就是白送 5 格')
// 转瞬即逝的东西不该进存档
assert.equal(savedDoc.effects, undefined, 'effects 不该进存档')
assert.equal(savedDoc.comboCount, undefined, 'combo 不该进存档')

// 别的标签页写了新存档 → 本标签页跟着走（同一个 localStorage，后写为准）。
fireWindow('storage', {
  key: STATE_KEY,
  newValue: JSON.stringify({
    v: 2, savedAt: Date.now(),
    activePetId: 'pet-0', favorites: [],
    pets: { 'pet-0': {
      id: 'pet-0', species: 'whale', name: '深深', avatar: 'whale', icon: '🐳', bornAt: Date.now(),
      pet: { hunger: 42, exp: 7, level: 9, mood: 80, energy: 75, curiosity: 0, pride: 0, concern: 0, form: '' },
      totalFeeds: 99, totalTokens: 88888, snacks: 2,
      tokensBySource: { user_input: 1, generation: 2, tool_result: 3 },
      achievements: [], daily: { day: 0, feeds: 0, tools: 0, bestCombo: 0, done: [] },
      streakDay: 0, streakCount: 0, pats: 0, pos: { dx: 0, dy: 0 }, lastFeedAt: 0,
      skills: { coding: { xp: 0, level: 0 }, research: { xp: 0, level: 0 }, debug: { xp: 0, level: 0 }, writing: { xp: 0, level: 0 } },
      memory: { files: [], tools: [], hours: new Array(24).fill(0), bornDay: 0, errors: 0, recoveries: 0 }
    }},
    eggs: [],
    global: { totalTokensAllTime: 88888, totalFeedsAllTime: 99, achievementsUnlockedAllTime: 0, petsHatched: 1, eggsObtained: [] }
  }),
})
const synced = overlayState()
assert.equal(synced.pet.level, 9, '应当采纳别的标签页的存档')
assert.equal(synced.totalTokens, 88888)
assert.equal(synced.snacks, 2, '零食格数也跟着别的标签页走')
assert.equal(synced.pet.name, '深深', '名字仍然来自存档，不被配置覆盖')
// 无关的键、坏数据、removeItem（newValue = null）都不该动状态。
fireWindow('storage', { key: 'unrelated', newValue: '{"v":2}' })
fireWindow('storage', { key: STATE_KEY, newValue: '{oops' })
fireWindow('storage', { key: STATE_KEY, newValue: null })
assert.equal(overlayState().pet.level, 9, '无效的 storage 事件不该改状态')

// 重启后进度回来，并且按离线时长饿了一截（10min × 2 = 20）。
storage.set(STATE_KEY, JSON.stringify({
  v: 1, savedAt: Date.now() - 10 * 60 * 1000,
  pet: { hunger: 10, exp: 5, level: 3, mood: 66, energy: 70 },
  totalFeeds: 7, totalTokens: 1234, snacks: 1,
  tokensBySource: { user_input: 4, generation: 1200, tool_result: 30 },
}))
const restored = bootFresh().readState()
assert.equal(restored.pet.level, 3, '等级应当从存档恢复')
assert.equal(restored.pet.exp, 5)
// 心情 / 精力跟饥饿一样按离线时长结算：10min × 0.4 掉 4 点心情，10min × 1.2 回 12 点精力。
assert.equal(restored.pet.mood, 62, `离线 10 分钟应当掉 4 点心情，实际 ${restored.pet.mood}`)
assert.equal(restored.pet.energy, 82, `离线 10 分钟应当回 12 点精力，实际 ${restored.pet.energy}`)
assert.equal(restored.totalFeeds, 7)
assert.equal(restored.totalTokens, 1234)
assert.deepEqual(restored.tokensBySource, { user_input: 4, generation: 1200, tool_result: 30 })
assert.equal(restored.pet.hunger, 28, `离线 10 分钟鲸鱼天赋(×0.9)应当回升 18 点饥饿，实际 ${restored.pet.hunger}`)
assert.equal(restored.pet.name, '大肥鱼', 'v1 存档没有名字，回落到配置默认名')
// 离线期间零食照攒：10 分钟够回 13 格，上限就是格数上限。
assert.equal(restored.snacks, SNACK_MAX, `离线 10 分钟应当攒满零食，实际 ${restored.snacks}`)

// savedAt 就是当下 → 格数原样带回来，不白送也不白扣。
storage.set(STATE_KEY, JSON.stringify({
  v: 1, savedAt: Date.now(),
  pet: { hunger: 10, exp: 0, level: 1, mood: 80, energy: 75 },
  totalFeeds: 1, totalTokens: 10, snacks: 2,
  tokensBySource: { user_input: 10, generation: 0, tool_result: 0 },
}))
assert.equal(bootFresh().readState().snacks, 2, '刚存的档应当原样保留零食格数')

// 0.1.0 的存档没有 snacks 字段：加字段没动版本号，所以老存档照样认，
// 缺的那格兜底给满 —— 不该为了「加了个字段」让人从 Lv.1 重来。
storage.set(STATE_KEY, JSON.stringify({
  v: 1, savedAt: Date.now(),
  pet: { hunger: 20, exp: 0, level: 4, mood: 80, energy: 75 },
  totalFeeds: 3, totalTokens: 20,
  tokensBySource: { user_input: 20, generation: 0, tool_result: 0 },
}))
const upgraded = bootFresh().readState()
assert.equal(upgraded.pet.level, 4, '加字段不该让老存档失效')
assert.equal(upgraded.snacks, SNACK_MAX, '老存档缺 snacks 字段时应当兜底给满格')

// 离线很久：按上限结算，最多饿到 100，不会溢出。
storage.set(STATE_KEY, JSON.stringify({
  v: 1, savedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
  pet: { hunger: 0, exp: 0, level: 2, mood: 80, energy: 75 },
  totalFeeds: 1, totalTokens: 10,
  tokensBySource: { user_input: 10, generation: 0, tool_result: 0 },
}))
assert.equal(bootFresh().readState().pet.hunger, 100, '离线太久最多饿到 100')

// 坏存档 / 版本对不上 → 当作新宠物，而不是抛异常。
storage.set(STATE_KEY, '{oops')
const warnings = []
const realWarn = console.warn
console.warn = (...args) => { warnings.push(args.join(' ')) }
try {
  assert.equal(bootFresh().readState().pet.level, 1, '坏存档应当当作新宠物')
} finally {
  console.warn = realWarn
}
assert.equal(warnings.length, 1, '坏存档应当只警告一次')
assert.match(warnings[0], /新宠物/, '警告文案不对: ' + warnings[0])
storage.set(STATE_KEY, JSON.stringify({ v: 99, pet: { level: 50 } }))
const versioned = bootFresh().readState()
assert.equal(versioned.pet.level, 1, '版本对不上应当当作新宠物')
assert.equal(versioned.pet.hunger, 60, '新宠物的初始饥饿是 60')
assert.equal(versioned.totalTokens, 0)

// 越界 / 类型不对的字段被逐个夹回来（同域下别人写的同名键也走这条路）。
storage.set(STATE_KEY, JSON.stringify({
  v: 1, savedAt: Date.now(),
  pet: { hunger: 9999, exp: -5, level: 0, mood: 'x', energy: null },
  totalFeeds: -1, totalTokens: 'NaN', tokensBySource: null, snacks: 99,
}))
const cleaned = bootFresh().readState()
assert.equal(cleaned.pet.hunger, 100, 'hunger 应当被夹到 100')
assert.equal(cleaned.pet.level, 1, 'level 至少是 1')
assert.equal(cleaned.pet.exp, 0)
assert.equal(cleaned.pet.mood, 80, '类型不对的字段用默认值')
assert.equal(cleaned.pet.energy, 75)
assert.equal(cleaned.totalFeeds, 0)
assert.equal(cleaned.totalTokens, 0)
assert.deepEqual(cleaned.tokensBySource, { user_input: 0, generation: 0, tool_result: 0 })
assert.equal(cleaned.snacks, SNACK_MAX, '零食格数应当被夹回上限')

// persist: false → 存档摆在那儿也不读。
storage.set(CONFIG_KEY, JSON.stringify({ persist: false }))
storage.set(STATE_KEY, JSON.stringify({
  v: 1, savedAt: Date.now(),
  pet: { hunger: 3, exp: 0, level: 7, mood: 80, energy: 75 },
  totalFeeds: 1, totalTokens: 5,
  tokensBySource: { user_input: 5, generation: 0, tool_result: 0 },
}))
assert.equal(bootFresh().readState().pet.level, 1, 'persist:false 时不应当读存档')
storage.delete(CONFIG_KEY)

// ---- 开关 ----------------------------------------------------------------

// effectsEnabled 只管飞行特效：卡片和上面的喂食入口都得留着。
storage.set(CONFIG_KEY, JSON.stringify({ effectsEnabled: false }))
const noFx = bootFresh()
assert.ok(cardOf(noFx.component) !== null, 'effectsEnabled:false 时宠物卡片仍然应当在')
assert.ok(snackButton(noFx.component) !== null, '关了特效也得能主动喂食')

// manualFeedEnabled: false → 按钮整个不渲染，卡片照旧。
storage.set(CONFIG_KEY, JSON.stringify({ manualFeedEnabled: false }))
const noSnack = bootFresh()
assert.equal(snackButton(noSnack.component), null, '关了主动喂食就不该渲染按钮')
assert.ok(cardOf(noSnack.component) !== null, '关了主动喂食卡片还在')
storage.delete(CONFIG_KEY)

// ---- 等级形态 ------------------------------------------------------------

// 要靠 bootFresh() 摆等级，而重启的实例会跟着 pagehide 抢着落盘 —— 所以这一节
// 只能排在持久化小节之后（和「开关」一样的理由）。

/**
 * 造一只指定等级的鲸鱼：写一份只有 level 不同的存档，重启一份实例。
 * @param level - 想看的等级。
 * @param exp - 当前等级内的经验（默认 0）。
 * @returns { card, whale, name, boot }。
 */
function stageCase(level, exp = 0) {
  storage.set(STATE_KEY, JSON.stringify({
    v: 1, savedAt: Date.now(),
    pet: { hunger: 20, exp, level, mood: 80, energy: 75 },
    totalFeeds: 1, totalTokens: 10, snacks: SNACK_MAX,
    tokensBySource: { user_input: 10, generation: 0, tool_result: 0 },
  }))
  const boot = bootFresh()
  const card = cardOf(boot.component)
  const whaleNode = findNode(card, n => typeof n.type === 'function')
  return {
    boot,
    card,
    whale: whaleNode.type(whaleNode.props),
    name: findNode(card, n => n.props?.className === 'dshpet-name')
      .children.filter(c => typeof c === 'string').join(''),
  }
}

/** 底座精灵图即档位指纹：四档文件名各不相同（APNG 版无皮肤渐变/描边节点）。 */
const stageImgOf = whale => srcOf(whale)

const STAGES = [
  { level: 1, key: 'baby', label: '幼崽', spout: false, dorsal: false, crown: false },
  { level: 3, key: 'young', label: '少年', spout: true, dorsal: false, crown: false },
  { level: 6, key: 'adult', label: '成年', spout: true, dorsal: true, crown: false },
  // 传说档的喷水口被王冠占了，所以最高档反而不喷水。
  { level: 10, key: 'legend', label: '传说', spout: false, dorsal: true, crown: true },
]

const sizes = []
const seenSkin = new Set()
for (const stage of STAGES) {
  const got = stageCase(stage.level)
  assert.equal(got.card.props['data-stage'], stage.key, `Lv.${stage.level} 的形态标记不对`)
  assert.equal(
    got.name, `大肥鱼 · Lv.${stage.level} ${stage.label}`,
    `Lv.${stage.level} 的名字行不对: ${got.name}`,
  )
  assert.match(
    ariaOf(got.whale), new RegExp(stage.label),
    `Lv.${stage.level} 的 aria-label 应当写着形态名`,
  )
  // 体型走头像边长；APNG 版没有 viewBox，改为断言正方形尺寸。
  const img = findNode(got.whale, n => n.props && Object.prototype.hasOwnProperty.call(n.props, 'data-sprite'))
  assert.equal(
    img.props.style.height, img.props.style.width, '头像应当是正方形',
  )
  sizes.push(Number.parseInt(img.props.style.width, 10))
  seenSkin.add(stageImgOf(got.whale))
  // 底座动图应当是本档文件（baby/young/adult/legend 各不同）。
  assert.ok(
    stageImgOf(got.whale).indexOf('-'.concat(stage.key, '-')) !== -1,
    `${stage.label} 的底座动图应当是 ${stage.key} 档`,
  )
  // 每档都必须有完整的三层 img（底座 + eat/pat 叠加）。
  for (const cls of ['dshpet-whale-sprite', 'dshpet-sprite-eat', 'dshpet-sprite-pat']) {
    assert.ok(
      findNode(got.whale, n => typeof n.props?.className === 'string' && n.props.className.includes(cls)) !== null,
      `${stage.label} 缺精灵层: ${cls}`,
    )
  }
}
// 体型必须一档比一档大，而且拉得开 —— 差几个像素等于没变（这一条是「区分度
// 不够」那次返工留下的）。
assert.deepEqual(
  sizes, [...sizes].sort((a, b) => a - b), `体型应当一档比一档大，实际 ${sizes}`,
)
assert.ok(
  sizes.at(-1) >= sizes[0] * 1.8,
  `最高档应当至少是最低档的 1.8 倍，实际 ${sizes[0]} → ${sizes.at(-1)}`,
)
assert.equal(seenSkin.size, 4, '四档配色应当互不相同')

// 门槛边界：挡住「用 < 还是 <=」这类差一错误。
for (const [level, key] of [[2, 'baby'], [5, 'young'], [9, 'adult'], [50, 'legend']]) {
  assert.equal(stageCase(level).card.props['data-stage'], key, `Lv.${level} 应当是 ${key}`)
}

// tooltip：写着当前形态 + 下一档的门槛；最高档没有箭头那一段。
const babyTitle = stageCase(1).card.props.title
assert.match(babyTitle, /形态 幼崽 → Lv\.3 少年/, 'tooltip 应当写着下一档: ' + babyTitle)
const legendTitle = stageCase(10).card.props.title
assert.match(legendTitle, /形态 传说/, 'tooltip 应当写着当前形态: ' + legendTitle)
assert.doesNotMatch(legendTitle, /→/, '最高档不该再指下一档: ' + legendTitle)

// 进阶那一刻：差 1 点经验升 Lv.3，点一口零食（给 1 点经验）正好跨档。
const evolveCase = stageCase(2, 199)
assert.equal(evolveCase.card.props['data-stage'], 'baby', '跨档前应当还是幼崽')
clickSnack(evolveCase.boot.component)
const evolved = evolveCase.boot.readState()
assert.equal(evolved.pet.level, 3, '这一口应当把等级顶到 3')
const evolveFx = evolved.effects.filter(e => e.source === 'evolve')
assert.equal(evolveFx.length, 1, '跨档应当飘一条进阶特效')
assert.equal(evolveFx[0].text, '进阶 · 少年', '进阶文案不对: ' + evolveFx[0].text)
assert.equal(evolveFx[0].tier, 'epic', '进阶蹭 epic 那套彩虹大字')
assert.equal(evolveFx[0].flight.across, false, '进阶特效就地飘，不从会话区飞')
const evolvedCard = cardOf(evolveCase.boot.component)
assert.equal(evolvedCard.props['data-stage'], 'young', '跨档后应当换成少年')
// 飘字直接是整句文案，不拼「+0 食物 / +0 ⭐」那套数字。
const evolveFxEl = findNode(
  findNode(evolveCase.boot.component({}), n => n.props?.className === 'dshpet-fx'),
  n => typeof n.type === 'function' && n.props.effect.key === evolveFx[0].key,
)
assert.ok(evolveFxEl !== null, '进阶也应当渲染出一条特效')
const evolveFloat = findNode(
  evolveFxEl.type(evolveFxEl.props), n => n.props?.className === 'dshpet-float',
).children.join('')
assert.equal(evolveFloat, '进阶 · 少年', '进阶飘字不该拼食物量: ' + evolveFloat)
// 头像外面那一圈一次性金环，跟着特效一起来、一起走。
assert.ok(
  findNode(evolvedCard, n => n.props?.className === 'dshpet-evolve') !== null,
  '进阶时头像外面应当有一圈金环',
)
assert.ok(CSS_TEXT.includes('.dshpet-evolve'), '.dshpet-evolve 没有对应样式')
assert.ok(CSS_TEXT.includes('dshpet-evolve-ring'), '金环没有对应动画')
storage.delete(STATE_KEY)

// ---- 心情 / 精力 / 睡眠 --------------------------------------------------

// 下面几节都用「摆一份存档 + 冻住时钟 + 重启一份实例」的办法：随时间走的数值
// 与跨天逻辑只有这样才断言得准（也和上面两节一样，必须排在持久化小节之后）。

/** 一个固定的起始时刻。断言不该跟着跑测试的钟点变，所以不用真实的 now。 */
const T = 1767225600000

/** 本地日序号，与产物里的 dayIndexOf 同一套算法（每日任务 / 连续到访要用）。 */
const dayIndexOf = ms => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60000) / 86400000)

/**
 * 摆一份存档、把时钟冻在 `clock`，然后重启一份实例。
 * @param clock - 冻住的「现在」（同时当作存档时刻，所以不产生离线结算）。
 * @param save - 存档正文（v / savedAt 自动补上）。
 */
function bootAt(clock, save) {
  Date.now = () => clock
  storage.set(STATE_KEY, JSON.stringify(Object.assign({ v: 1, savedAt: clock }, save)))
  return bootFresh()
}

/**
 * 掏出一份实例的低频 tick（组件里那个 10s setInterval 的回调）。
 *
 * 桩件的 useEffect 只把回调收进数组、并不执行，所以这里手动跑一遍，再用一个
 * 假的 setInterval 把 store.tick 截下来 —— 空闲时的结算（饿、心情、精力、
 * 零食回格、跨天、睡着）全靠它推进。
 */
function tickerOf(component) {
  const from = effects.length
  component({})
  const realSetInterval = globalThis.setInterval
  let tick = null
  globalThis.setInterval = (fn) => { tick = fn; return 0 }
  try {
    for (const fn of effects.slice(from)) fn()
  } finally {
    globalThis.setInterval = realSetInterval
  }
  assert.ok(tick !== null, '组件应当挂一个低频 tick')
  return tick
}

const vitalsClock = Date.now
try {
  const vit = bootAt(T, {
    pet: { hunger: 0, exp: 0, level: 2, mood: 50, energy: 50 },
    totalFeeds: 3, totalTokens: 100, snacks: SNACK_MAX,
    tokensBySource: { user_input: 100, generation: 0, tool_result: 0 },
    // 第一口那个成就先给了：不然下面喂零食时它会抢掉气泡，这一节想看的是睡醒。
    achievements: ['first_feed'],
    lastFeedAt: T,
  })
  const tick = tickerOf(vit.component)
  const born = vit.readState()
  assert.equal(born.pet.mood, 50, 'savedAt 就是当下 → 心情原样带回来')
  assert.equal(born.pet.energy, 50)
  assert.equal(born.asleep, false, '刚喂过不该在睡')
  assert.match(
    cardOf(vit.component).props.title, /点头像摸摸.*拖动换位置/,
    'tooltip 应当写着能摸头、能拖: ' + cardOf(vit.component).props.title,
  )

  // 空闲 10 分钟：心情 -0.4/min、精力 +1.2/min、饥饿 +2/min，而且过了 5 分钟的
  // 睡眠门槛 → 睡着，顺手说一句 Zzz。
  Date.now = () => T + 10 * 60 * 1000
  tick()
  const idle = vit.readState()
  assert.equal(idle.pet.mood, 46, `空闲 10 分钟应当掉 4 点心情，实际 ${idle.pet.mood}`)
  assert.equal(idle.pet.energy, 62, `空闲 10 分钟应当回 12 点精力，实际 ${idle.pet.energy}`)
  assert.equal(idle.pet.hunger, 18, `空闲 10 分钟鲸鱼天赋(×0.9)应当饿 18 点，实际 ${idle.pet.hunger}`)
  assert.equal(idle.asleep, true, '5 分钟没有事件就该睡了')
  assert.equal(idle.bubble.kind, 'sleep', '刚睡着应当说一句')

  // 睡着的样子：卡片挂标记、头像旁边一串 Zzz、鲸鱼闭眼 + 平嘴。
  const sleepCard = cardOf(vit.component)
  assert.equal(sleepCard.props['data-asleep'], 'true', '睡着的卡片应当挂标记')
  assert.ok(
    findNode(sleepCard, n => n.props?.className === 'dshpet-zzz') !== null,
    '睡着应当飘 Zzz',
  )
  const sleepWhaleEl = findNode(sleepCard, n => typeof n.type === 'function')
  assert.equal(sleepWhaleEl.props.asleep, true, '睡着应当把状态传给鲸鱼')
  assert.notEqual(
    srcOf(sleepWhaleEl.type(sleepWhaleEl.props)), srcOf(calmWhale),
    '睡脸应当切换到 sleep 态动图',
  )
  assert.ok(
    srcOf(sleepWhaleEl.type(sleepWhaleEl.props)).indexOf('-sleep.apng') !== -1,
    '睡脸应当用 sleep 态动图',
  )
  assert.ok(CSS_TEXT.includes('.dshpet-card[data-asleep=true]'), '睡着的卡片没有对应样式')
  assert.ok(CSS_TEXT.includes('.dshpet-zzz'), 'Zzz 没有对应样式')

  // 又睡了 10 分钟：精力回得快（×3）、饿得慢（×0.5）。
  Date.now = () => T + 20 * 60 * 1000
  tick()
  const slept = vit.readState()
  assert.equal(slept.pet.energy, 98, `睡着精力应当回 36 点，实际 ${slept.pet.energy}`)
  assert.equal(slept.pet.hunger, 27, `睡着鲸鱼天赋(×0.9×0.5)只该饿 9 点，实际 ${slept.pet.hunger}`)

  // 喂一口就叫醒（摸头同理），醒来还打个哈欠。
  clickSnack(vit.component)
  const woke = vit.readState()
  assert.equal(woke.asleep, false, '喂一口应当把它叫醒')
  assert.equal(woke.bubble.kind, 'wake', '醒来应当打个哈欠')
  assert.equal(woke.pet.mood, 44, `一口零食应当涨 2 点心情，实际 ${woke.pet.mood}`)
  assert.equal(woke.pet.energy, 98, '零食不是干活，不该扣精力')
  // 卡片上那一行紧凑的状态：一个脸 + 两个数字。
  const vitalsLine = findNode(vit.component({}), n => n.props?.className === 'dshpet-sub dshpet-vitals')
  assert.ok(vitalsLine !== null, '卡片上应当有心情 / 精力那一行')
  assert.equal(vitalsLine.children.join(''), '😐 44 · ⚡ 98', '状态行文案不对: ' + vitalsLine.children.join(''))

  // sleepEnabled: false → 永远不睡，而且刚饿过线会喊一声。
  storage.set(CONFIG_KEY, JSON.stringify({ sleepEnabled: false }))
  const awake = bootAt(T, {
    pet: { hunger: 70, exp: 0, level: 2, mood: 90, energy: 90 },
    totalFeeds: 1, totalTokens: 10, snacks: 0,
    tokensBySource: { user_input: 10, generation: 0, tool_result: 0 },
    lastFeedAt: T,
  })
  const awakeTick = tickerOf(awake.component)
  Date.now = () => T + 60 * 60 * 1000
  awakeTick()
  const still = awake.readState()
  assert.equal(still.asleep, false, 'sleepEnabled:false 就永远不睡')
  assert.equal(still.pet.hunger, 100, '关了睡眠饥饿也不打折 → 顶到 100')
  assert.equal(still.bubble.kind, 'hungry', '刚饿过线应当喊一声')

  // vitalsEnabled: false → 心情 / 精力退回静态展示值，那一行也不渲染。
  storage.set(CONFIG_KEY, JSON.stringify({ vitalsEnabled: false }))
  const flat = bootAt(T, {
    pet: { hunger: 0, exp: 0, level: 2, mood: 50, energy: 50 },
    totalFeeds: 1, totalTokens: 10, snacks: 1,
    tokensBySource: { user_input: 10, generation: 0, tool_result: 0 },
    lastFeedAt: T,
  })
  const flatTick = tickerOf(flat.component)
  Date.now = () => T + 30 * 60 * 1000
  flatTick()
  const flatState = flat.readState()
  assert.equal(flatState.pet.mood, 50, 'vitalsEnabled:false 时心情应当纹丝不动')
  assert.equal(flatState.pet.energy, 50, '精力同理')
  assert.equal(flatState.pet.hunger, 54, '关了心情精力，饥饿照旧回升（鲸鱼×0.9: 30min×1.8=54）')
  assert.equal(
    findNode(flat.component({}), n => n.props?.className === 'dshpet-sub dshpet-vitals'), null,
    '关了就不该渲染心情 / 精力那一行',
  )

  // 互动与养成的开关一起关掉：该没的部件一个都不该剩。
  storage.set(CONFIG_KEY, JSON.stringify({
    patEnabled: false, dragEnabled: false, bubbleEnabled: false,
    achievementsEnabled: false, dailyEnabled: false,
  }))
  const bare = bootAt(T, {
    pet: { hunger: 40, exp: 0, level: 2, mood: 50, energy: 50 },
    totalFeeds: 1, totalTokens: 10, snacks: 2,
    tokensBySource: { user_input: 10, generation: 0, tool_result: 0 },
    lastFeedAt: T,
  })
  const bareCard = cardOf(bare.component)
  assert.equal(
    findNode(bareCard, n => n.props?.className === 'dshpet-avatar').props.onClick, undefined,
    '关了摸头，头像就不该吃点击',
  )
  assert.equal(bareCard.props.onPointerDown, undefined, '关了拖动就不该听 pointerdown')
  assert.doesNotMatch(bareCard.props.title, /摸摸|拖动/, 'tooltip 不该写关掉的玩法: ' + bareCard.props.title)
  assert.equal(
    findNode(bare.component({}), n => n.props?.className === 'dshpet-badge-btn'), null,
    '成就与任务都关了就不该有那个按钮',
  )
  clickSnack(bare.component)
  const bareFed = bare.readState()
  assert.equal(bareFed.bubble, null, '关了气泡就不该说话')
  assert.deepEqual(bareFed.achievements, [], '关了成就就不该解锁')
  assert.equal(bareFed.daily.feeds, 0, '关了每日任务就不该记进度')
  storage.delete(CONFIG_KEY)
} finally {
  Date.now = vitalsClock
}

// ---- 成就 / 每日任务 / 连续到访 -------------------------------------------

const questClock = Date.now
try {
  const T1 = T + 3 * 86400000
  const today = dayIndexOf(T1)
  // 摆在「差一口就达成今日喂食任务」且「昨天也来过」的位置上：这一口零食应当
  // 同时结算任务奖励、把连续到访推到 3 天、并因此解锁三日之约。
  const quest = bootAt(T1, {
    pet: { hunger: 50, exp: 0, level: 1, mood: 80, energy: 75 },
    totalFeeds: 9, totalTokens: 500, snacks: 2,
    tokensBySource: { user_input: 500, generation: 0, tool_result: 0 },
    achievements: ['first_feed'],
    daily: { day: today, feeds: 9, tools: 0, bestCombo: 0, pats: 0, tokens: 0, snacks: 0, done: [] },
    streakDay: today - 1, streakCount: 2,
    lastFeedAt: T1,
  })
  clickSnack(quest.component)
  const done = quest.readState()
  assert.equal(done.daily.feeds, 10, '手喂也数进今日喂食任务')
  assert.deepEqual(done.daily.done, ['feeds'], '够 10 次应当当场结算掉这条任务')
  assert.equal(done.pet.exp, 31, `任务奖励 30 + 零食 1 点经验，实际 ${done.pet.exp}`)
  assert.equal(done.streakCount, 3, '昨天也来过 → 连续到访 +1')
  assert.equal(done.streakDay, today)
  assert.deepEqual(
    done.achievements, ['first_feed', 'streak_3'],
    '连了 3 天应当解锁三日之约: ' + done.achievements.join(),
  )
  // 任务与成就各补一格零食：2 - 1（吃掉的）+ 1 + 1 = 3。
  assert.equal(done.snacks, 3, `两份奖励各补一格零食，实际 ${done.snacks}`)

  // 两条通知都走特效那条管道（所以自动继承 TTL 与「减少动效」降级）。
  const notices = done.effects.filter(e => e.text !== undefined)
  const texts = notices.map(e => e.text)
  assert.ok(texts.includes('任务达成 · 今日喂食 10 次'), '任务达成应当飘一条: ' + texts.join())
  assert.ok(texts.includes('成就 · 三日之约'), '成就应当飘一条: ' + texts.join())
  assert.equal(notices.find(e => e.source === 'quest').tier, 'gold', '任务用金色那档')
  assert.equal(notices.find(e => e.source === 'achieve').tier, 'epic', '成就用 epic 那套大字')
  assert.equal(notices.find(e => e.source === 'achieve').icon, '📅', '成就的图标应当是它自己那个')
  for (const notice of notices) {
    assert.equal(notice.foodAmount, 0, '通知不是饭，没有食物量')
    assert.equal(notice.flight.across, false, '通知就地飘，不从会话区飞')
  }
  assert.equal(done.bubble.kind, 'achieve', '最后说的是成就那句')

  // 卡片上的徽章行只摆已解锁的（没解锁的留给面板，卡片得窄）。
  const questCard = cardOf(quest.component)
  assert.ok(
    findNode(questCard, n => n.props?.className === 'dshpet-badges') !== null,
    '解锁了就该有徽章行',
  )
  assert.equal(
    findAll(questCard, n => n.props?.className === 'dshpet-badge').length, 2,
    '徽章行应当只摆已解锁的两个',
  )

  // 面板：点 🏅 开，里面是「状态 / 今日任务 / 技能 / 记忆 / 成就」五段。
  const badgeBtn = findNode(quest.component({}), n => n.props?.className === 'dshpet-badge-btn')
  assert.ok(badgeBtn !== null, '卡片上应当有开面板的按钮')
  assert.equal(badgeBtn.props['aria-expanded'], 'false')
  let panelStopped = false
  badgeBtn.props.onClick({ stopPropagation: () => { panelStopped = true } })
  assert.equal(panelStopped, true, '开面板必须拦住冒泡，否则顺手把卡片折叠了')
  assert.equal(quest.readState().panelOpen, true, '点一下应当开面板')
  const panelNode = findNode(quest.component({}), n => n.props?.className === 'dshpet-panel')
  assert.ok(panelNode !== null, '开了就该渲染面板')
  assert.deepEqual(
    findAll(panelNode, n => n.props?.className === 'dshpet-panel-title').map(n => n.children.join('')),
    ['状态', '今日任务 · 连续到访 3 天', '技能', '记忆 · 相处 1 天', '成就 2/14'],
    '面板的五段标题不对',
  )
  assert.equal(
    findNode(panelNode, n => n.props?.className === 'dshpet-bar dshpet-bar-mood')
      .children[0].props.style.width, '82%',
    '面板里的心情条应当按心情走',
  )
  const quests = findAll(panelNode, n => n.props?.className === 'dshpet-quest')
  assert.equal(quests.length, 3, '面板应当摆三条每日任务')
  assert.equal(quests[0].props['data-done'], 'true', '达成的那条应当划掉')
  assert.equal(
    findNode(quests[0], n => n.props?.className === 'dshpet-quest-n').children.join(''), '10/10',
    '进度应当写满',
  )
  assert.equal(quests[1].props['data-done'], undefined, '没达成的那条不该划掉')
  assert.equal(
    findAll(panelNode, n => n.props?.className === 'dshpet-badge').length, 14,
    '面板应当摆全部成就',
  )
  const lockedBadges = findAll(
    panelNode,
    n => n.props?.className === 'dshpet-badge' && n.props['data-owned'] === undefined,
  )
  assert.equal(lockedBadges.length, 12, '此刻应当还有 12 个没解锁')
  assert.match(
    lockedBadges[0].props.title, / · /,
    '没解锁的徽章 tooltip 应当写着怎么解锁: ' + lockedBadges[0].props.title,
  )
  for (const cls of ['.dshpet-panel', '.dshpet-quest', '.dshpet-grid', '.dshpet-badges',
    '.dshpet-badge[data-owned=true]', '.dshpet-bar-mood', '.dshpet-bar-energy']) {
    assert.ok(CSS_TEXT.includes(cls), `${cls} 没有对应样式`)
  }
  const openBtn = findNode(quest.component({}), n => n.props?.className === 'dshpet-badge-btn')
  assert.equal(openBtn.props['data-open'], 'true', '开着的按钮应当挂标记')
  assert.equal(openBtn.props['aria-expanded'], 'true')
  openBtn.props.onClick({ stopPropagation: () => {} })
  assert.equal(quest.readState().panelOpen, false, '再点一下应当收起来')

  // 长期积累要落盘（徽章 / 当天进度 / 连续到访 / 摸头次数 / 位置 / 最后互动时刻）。
  fireWindow('pagehide')
  const questSaved = JSON.parse(fakeLocalStorage.getItem(STATE_KEY))
  const questRec = questSaved.pets[questSaved.activePetId]
  assert.deepEqual(questRec.achievements, ['first_feed', 'streak_3'], '徽章要落盘')
  assert.equal(questRec.daily.feeds, 10, '当天的任务进度要落盘')
  assert.deepEqual(questRec.daily.done, ['feeds'])
  assert.equal(questRec.streakCount, 3, '连续到访要落盘')
  assert.equal(questRec.streakDay, today)
  assert.equal(typeof questRec.pats, 'number', '摸头次数要落盘（有条成就看它）')
  assert.equal(typeof questRec.lastFeedAt, 'number', '睡眠是从它算出来的，也要落盘')
  assert.equal(questSaved.buff, undefined, 'BUFF 是瞬时态，不该进存档')
  assert.equal(questSaved.bubble, undefined, '台词同理')

  // 换一天：当天进度清零；连续到访要等下一口喂食才推进。
  Date.now = () => T1 + 86400000
  tickerOf(quest.component)()
  const nextDay = quest.readState()
  assert.equal(nextDay.daily.day, today + 1, '跨天应当换一份进度')
  assert.equal(nextDay.daily.feeds, 0, '跨天当天进度清零')
  assert.deepEqual(nextDay.daily.done, [], '已完成列表也清零')
  assert.equal(nextDay.streakCount, 3, '光是 tick 不算来喂过，连续天数先不动')
  clickSnack(quest.component)
  assert.equal(quest.readState().streakCount, 4, '第二天来喂 → 连续到访 +1')
  // 断掉一天就从 1 重新数。
  Date.now = () => T1 + 3 * 86400000
  clickSnack(quest.component)
  assert.equal(quest.readState().streakCount, 1, '断了一天应当从 1 重新数')
  assert.equal(quest.readState().streakDay, dayIndexOf(T1 + 3 * 86400000))
} finally {
  Date.now = questClock
}

// ---- 互动：摸头 / 拖动 / 台词气泡 ----------------------------------------

storage.set(CONFIG_KEY, JSON.stringify({ dailyEnabled: false }))
const playClock = Date.now
try {
  const T2 = T + 10 * 86400000
  // 摸头次数摆在 49：这一下顺手把「老朋友」也解锁了。
  const play = bootAt(T2, {
    pet: { hunger: 40, exp: 0, level: 2, mood: 50, energy: 75 },
    totalFeeds: 5, totalTokens: 100, snacks: 3,
    tokensBySource: { user_input: 100, generation: 0, tool_result: 0 },
    achievements: ['first_feed'], pats: 48, lastFeedAt: T2,
  })

  /** 点一下头像（摸头挂在它身上），返回它有没有拦住冒泡。 */
  function patOnce() {
    const avatar = findNode(play.component({}), n => n.props?.className === 'dshpet-avatar')
    assert.ok(avatar !== null, '卡片上应当有头像')
    let stopped = false
    avatar.props.onClick({ stopPropagation: () => { stopped = true } })
    return stopped
  }

  assert.equal(patOnce(), true, '摸头必须拦住冒泡，否则顺手把卡片折叠了')
  const patted = play.readState()
  assert.equal(patted.pats, 49, '摸一下应当记一次')
  assert.equal(patted.pet.mood, 56, `摸一下应当涨 6 点心情，实际 ${patted.pet.mood}`)
  assert.equal(patted.pet.hunger, 40, '摸头不顶饱食度')
  const heart = patted.effects.filter(e => e.text !== undefined).at(-1)
  assert.equal(heart.text, '摸摸头', '摸头应当飘一条: ' + heart.text)
  assert.equal(heart.icon, '💗')
  assert.equal(heart.source, 'pat')
  assert.equal(heart.tier, 'normal', '摸头不该蹭 epic 那套彩虹大字')
  assert.equal(patted.bubble.kind, 'pat', '摸头应当说句话')
  // 取哪句走确定性伪随机（不用 Math.random），所以它一定来自这个池子，
  // 而且同一串事件重跑一遍还是这句 —— 下面「连着摸两次」就是在验这一点。
  const patLines = linesOf('pat')
  assert.ok(patLines.length >= 6, `摸头台词应当扩到 6 句以上，实际 ${patLines.length}`)
  assert.ok(patLines.includes(patted.bubble.text), '摸头台词不在池子里: ' + patted.bubble.text)

  // 冷却：连点刷不出心情（心情有经验加成，点得快就等于点出经验来了）。
  patOnce()
  assert.equal(play.readState().pats, 49, '冷却里的摸头不该算')
  assert.equal(play.readState().pet.mood, 56, '冷却里的摸头也不该涨心情')
  Date.now = () => T2 + 2000
  patOnce()
  const older = play.readState()
  assert.equal(older.pats, 50, '过了冷却应当又能摸')
  assert.ok(older.achievements.includes('pats_50'), '摸够 50 次应当解锁老朋友')

  // 拖动：整层跟着平移，位置记在存档里。
  const dragCard = cardOf(play.component)
  assert.equal(typeof dragCard.props.onPointerDown, 'function', '卡片应当能拖')
  dragCard.props.onPointerDown({ clientX: 500, clientY: 400 })
  assert.equal(play.readState().dragging, true, '按下就算开始拖')
  assert.equal(cardOf(play.component).props['data-dragging'], 'true', '拖着的卡片应当挂标记')
  assert.ok(CSS_TEXT.includes('[data-dragging=true]'), '拖动没有对应样式')
  fireWindow('pointermove', { clientX: 460, clientY: 330 })
  assert.deepEqual(
    play.readState().pos, { dx: -40, dy: -70 },
    '拖动应当把偏移改到指针处，实际 ' + JSON.stringify(play.readState().pos),
  )
  assert.deepEqual(
    findNode(play.component({}), n => n.props?.className === 'dshpet-root').props.style,
    { transform: 'translate(-40px,-70px)' },
    '偏移应当落到整层的 transform 上',
  )
  // 往右下拖到天边也得留住一角（量不到视口时按 1920×1080 兜底，余量 48）。
  fireWindow('pointermove', { clientX: 9000, clientY: 9000 })
  assert.deepEqual(play.readState().pos, { dx: 48, dy: 48 }, '往右下拖应当夹在余量上')
  fireWindow('pointermove', { clientX: 460, clientY: 330 })
  // 松手：结束拖动，监听器自己摘掉。
  fireWindow('pointerup', {})
  assert.equal(play.readState().dragging, false, '松手应当结束拖动')
  fireWindow('pointermove', { clientX: 100, clientY: 100 })
  assert.deepEqual(
    play.readState().pos, { dx: -40, dy: -70 }, '松手之后的移动不该再改位置',
  )
  // 浏览器在 pointerup 之后还会补一次 click：那是「刚把它拖到别处」的手。
  Date.now = () => T2 + 10000
  patOnce()
  assert.equal(play.readState().pats, 50, '拖完补的那一次点击不该算摸头')
  patOnce()
  assert.equal(play.readState().pats, 51, '再点一下才是真的摸')

  // 位置落盘：松手那一下就存，重启后还在那儿。
  fireWindow('pagehide')
  const posSaved = JSON.parse(fakeLocalStorage.getItem(STATE_KEY))
  assert.deepEqual(
    posSaved.pets[posSaved.activePetId].pos, { dx: -40, dy: -70 },
    '拖过的位置应当落盘',
  )
  assert.deepEqual(
    bootFresh().readState().pos, { dx: -40, dy: -70 }, '重启后应当回到拖过的位置',
  )

  // 气泡限流：普通场合两句之间至少隔 4 秒，否则一轮工具循环会把气泡刷成弹幕。
  Date.now = () => T2 + 20000
  clickSnack(play.component)
  const said = play.readState().bubble
  assert.equal(said.kind, 'snack', '喂零食应当说句话')
  clickSnack(play.component)
  assert.equal(play.readState().bubble.key, said.key, '限流窗口内不该换台词')
  Date.now = () => T2 + 30000
  clickSnack(play.component)
  const later = play.readState().bubble
  assert.notEqual(later.key, said.key, '过了限流窗口才换')
  // pickLineIndex 的核心保证：同一句永远不连着出现两次。顺序轮换做不到「听起来
  // 不像背台词」，Math.random 做不到「不连着重复」，所以两头都要。
  const snackLines = linesOf('snack')
  assert.ok(snackLines.includes(said.text) && snackLines.includes(later.text), '零食台词应当来自池子')
  assert.equal(later.kind, 'snack')
  assert.notEqual(later.text, said.text, '同一句台词不该连着说两遍')
  // 渲染层：气泡在卡片上方，带场合与 aria-live。
  const bubbleNode = findNode(play.component({}), n => n.props?.className === 'dshpet-bubble')
  assert.ok(bubbleNode !== null, '说话时应当渲染气泡')
  assert.equal(bubbleNode.props['data-kind'], later.kind)
  assert.equal(bubbleNode.props['aria-live'], 'polite', '气泡应当念给读屏器听')
  assert.equal(bubbleNode.children.join(''), later.text)
  assert.ok(CSS_TEXT.includes('.dshpet-bubble'), '.dshpet-bubble 没有对应样式')
} finally {
  Date.now = playClock
  storage.delete(CONFIG_KEY)
}

// ---- 挑食与暴食 BUFF -----------------------------------------------------

const eatClock = Date.now
try {
  const T3 = T + 20 * 86400000
  /** 当天的任务全标成已完成：任务奖励也给经验，会把下面的经验断言带偏。 */
  const ALL_QUESTS = { day: dayIndexOf(T3), feeds: 0, tools: 0, bestCombo: 0, pats: 0, tokens: 0, snacks: 0, done: ['feeds', 'tools', 'combo', 'feeds20', 'feeds5', 'pats5', 'pats15', 'tok10k', 'tok50k', 'tools15', 'snacks3', 'combo10'] }
  const EATEN_SAVE = {
    pet: { hunger: 60, exp: 0, level: 3, mood: 80, energy: 90 },
    totalFeeds: 20, totalTokens: 5000, snacks: 0,
    tokensBySource: { user_input: 1000, generation: 2000, tool_result: 2000 },
    // 满连击那个成就也先给了：不然顶格那一下它会抢掉暴食的台词。
    achievements: ['first_feed', 'gourmet', 'combo_full'],
    daily: ALL_QUESTS, streakDay: dayIndexOf(T3), streakCount: 1, lastFeedAt: T3,
  }

  /**
   * 照抄产物的经验公式：连击倍率 × 心情摆幅 × 困了打折 × 暴食双倍，
   * 再加一份「这一口有多大」的封顶奖励（最多 +2，大 token 的一口更值钱）。
   */
  const BASE_EXP = { user_input: 1, generation: 2, tool_result: 3 }
  const vitalFactor = pet => (0.8 + 0.4 * (pet.mood / 100)) * (pet.energy < 25 ? 0.85 : 1)
  const expOf = (source, pet, combo, frenzy, tokens) => Math.max(1, Math.floor(
    BASE_EXP[source] * (1 + 0.2 * combo) * vitalFactor(pet) * (frenzy ? 2 : 1) + 0.5,
  )) + Math.min(2, Math.round(0.3 * Math.log2(1 + tokens / 60)))
  /** 照抄产物的食物公式：token 曲线 × 口味系数 × 暴食加成 + 连击常数。 */
  const foodOf = (tokens, combo, taste, frenzy) => Math.min(30, Math.max(1,
    Math.round(Math.floor(2.5 * Math.log2(1 + tokens / 60) + 0.5) * taste * (frenzy ? 1.2 : 1))
    + Math.floor(combo / 2),
  ))
  /** 往某份实例喂一条事件，回报喂之前的快照 + 这一口的那条特效。 */
  const eaterOf = inst => (event) => {
    const pre = inst.readState()
    inst.feed(event)
    const post = inst.readState()
    return {
      pre, post, combo: post.comboCount,
      // BUFF 是乘在这一口上的，所以要的是「吃之前」在不在。
      frenzy: pre.buff !== null,
      fx: post.effects.filter(isFeedFx).at(-1),
    }
  }

  const eat = bootAt(T3, EATEN_SAVE)
  const eatOne = eaterOf(eat)

  // 8 口最爱的（tool_result）：只有 1.3 倍加成，还没吃腻。
  let hit = null
  for (let i = 0; i < 8; i += 1) hit = eatOne(toolEvent(4000))
  assert.equal(hit.combo, 8, '八口应当攒到 8 连击')
  assert.equal(
    hit.fx.foodAmount, foodOf(toolTokensOf(4000), 8, 1.3, false),
    `最爱的一口应当有 1.3 倍加成，实际 ${hit.fx.foodAmount}`,
  )
  assert.equal(
    hit.fx.expAmount, expOf('tool_result', hit.pre.pet, 8, false, toolTokensOf(4000)),
    `经验应当带上心情摆幅，实际 ${hit.fx.expAmount}`,
  )
  // 第 9 口同一种就腻了：1.3 × 0.75，比刚才少。
  const bored = eatOne(toolEvent(4000))
  assert.equal(
    bored.fx.foodAmount, foodOf(toolTokensOf(4000), 9, 1.3 * 0.75, false),
    `连着吃第 9 口应当腻了，实际 ${bored.fx.foodAmount}`,
  )
  assert.ok(
    bored.fx.foodAmount < hit.fx.foodAmount,
    `腻了应当比刚才少：${hit.fx.foodAmount} → ${bored.fx.foodAmount}`,
  )
  // 换一种口味就不腻了：同样的 token 量，没有加成也没有折扣。
  const other = eatOne(assistantEvent(1000))
  assert.equal(other.combo, 10, '第十口应当顶格')
  assert.equal(other.frenzy, false, '第十口之前还没有 BUFF')
  assert.equal(
    other.fx.foodAmount, foodOf(1000, 10, 1, false),
    `换了口味口味系数应当回到 1，实际 ${other.fx.foodAmount}`,
  )
  assert.equal(
    other.fx.expAmount, expOf('generation', other.pre.pet, 10, false, 1000),
    '开 BUFF 那一口自己还没享受双倍',
  )

  // 顶到满连击 → 开一段暴食 BUFF（连击封顶在 ×3.0，再往上堆没有回报）。
  const opened = eat.readState()
  assert.ok(opened.buff !== null, '顶到满连击应当开一段暴食 BUFF')
  assert.equal(opened.buff.kind, 'frenzy')
  assert.equal(opened.buff.until, T3 + 15000, 'BUFF 应当从这一刻起算 15 秒')
  assert.equal(opened.bubble.kind, 'frenzy', '开 BUFF 该喊一句（不受限流管）')
  assert.equal(cardOf(eat.component).props['data-buff'], 'frenzy', '暴食的卡片应当挂标记')
  assert.match(
    findNode(eat.component({}), n => n.props?.className === 'dshpet-combo').children.join(''),
    /🔥×2/, '暴食期间倍率是双份的，徽标上要写出来',
  )
  assert.ok(CSS_TEXT.includes('[data-buff=frenzy]'), 'BUFF 没有对应样式')

  // BUFF 生效的下一口：经验双倍、食物 1.2 倍。
  const inBuff = eatOne(toolEvent(4000))
  assert.equal(inBuff.frenzy, true, 'BUFF 还在')
  assert.equal(
    inBuff.fx.expAmount, expOf('tool_result', inBuff.pre.pet, 10, true, toolTokensOf(4000)),
    `暴食期间经验应当双倍，实际 ${inBuff.fx.expAmount}`,
  )
  assert.ok(
    inBuff.fx.expAmount >= expOf('tool_result', inBuff.pre.pet, 10, false, toolTokensOf(4000)) * 1.8,
    '双倍必须真的翻上去',
  )
  assert.equal(
    inBuff.fx.foodAmount, foodOf(toolTokensOf(4000), 10, 1.3, true),
    `暴食期间食物也该多一点，实际 ${inBuff.fx.foodAmount}`,
  )

  // 期间再顶到满连击就续期（连击窗口 5 秒内，所以还是满格）。
  Date.now = () => T3 + 3000
  eatOne(toolEvent(4000))
  assert.equal(
    eat.readState().buff.until, T3 + 3000 + 15000, 'BUFF 期间再顶格应当续期',
  )

  // 过了尾巴：BUFF 没了，隔这么久连击也断了。
  Date.now = () => T3 + 3000 + 15000 + 1
  const after = eatOne(toolEvent(4000))
  assert.equal(after.post.buff, null, 'BUFF 到点就该没了')
  assert.equal(after.combo, 1, '隔了 15 秒连击也断了')
  assert.equal(
    after.fx.foodAmount, foodOf(toolTokensOf(4000), 1, 1.3, false),
    `BUFF 过期后食物量应当回到常态，实际 ${after.fx.foodAmount}`,
  )
  assert.equal(after.fx.expAmount, expOf('tool_result', after.pre.pet, 1, false, toolTokensOf(4000)))
  assert.equal(after.post.bubble.kind, 'favorite', '吃到最爱应当夸一句')

  // 再连着吃到第 9 口，这次隔够了限流窗口 → 抱怨一句「换个口味」。
  for (let i = 0; i < 5; i += 1) eatOne(toolEvent(4000))
  Date.now = () => T3 + 3000 + 15000 + 1 + 5000
  eatOne(toolEvent(4000))
  assert.equal(eat.readState().bubble.kind, 'bored', '腻了应当抱怨一句')

  // 关掉挑食与暴食：食物量退回纯 token 曲线，顶格也不再开 BUFF。
  storage.set(CONFIG_KEY, JSON.stringify({ pickyEnabled: false, frenzyEnabled: false }))
  const plain = bootAt(T3, EATEN_SAVE)
  const plainEat = eaterOf(plain)
  let plainLast = null
  for (let i = 0; i < 10; i += 1) plainLast = plainEat(toolEvent(4000))
  assert.equal(plainLast.combo, 10, '关了这两条也照样攒连击')
  assert.equal(plain.readState().buff, null, 'frenzyEnabled:false 时不该开 BUFF')
  assert.equal(
    plainLast.fx.foodAmount, foodOf(toolTokensOf(4000), 10, 1, false),
    `pickyEnabled:false 时口味系数应当是 1，实际 ${plainLast.fx.foodAmount}`,
  )
  assert.equal(
    findNode(plain.component({}), n => n.props?.className === 'dshpet-combo').children.join('')
      .includes('🔥'), false, '没有 BUFF 就不该在徽标上写它',
  )
  storage.delete(CONFIG_KEY)
  storage.delete(STATE_KEY)
} finally {
  Date.now = eatClock
}

// ---- 技能与宠物记忆 ------------------------------------------------------

/**
 * 造一条 tool/call 事件：技能与记忆的唯一数据来源（三个喂食源只看得见
 * 「烧了多少 token」，工具的名字要到这条事件才有）。
 */
const callEvent = (name, args, callId) => ({
  type: 'tool/call', seq: ++seq, time: Date.now(),
  data: { turn: 1, step: 1, callId, name, arguments: args === null ? '' : JSON.stringify(args) },
})

/** 造一条带 / 不带错误的 tool/result 事件（callId 用来回查工具名）。 */
const resultEvent = (callId, error) => ({
  type: 'tool/result', seq: ++seq, time: Date.now(),
  data: {
    turn: 1, step: 1,
    message: {
      role: 'user',
      content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: 'x'.repeat(400) }] }],
    },
    error,
  },
})

const workClock = Date.now
try {
  const T4 = T + 5 * 86400000
  const workHour = new Date(T4).getHours()
  const workDay = dayIndexOf(T4)
  /**
   * 一份「已经养了几天」的存档。三条今日任务与两个成就先标成拿过了：这一节
   * 想看的是技能通知与提示气泡，别让任务 / 成就的强制台词抢走它们。
   */
  const WORK_SAVE = {
    pet: { hunger: 40, exp: 0, level: 2, mood: 80, energy: 80 },
    totalFeeds: 4, totalTokens: 4000, snacks: SNACK_MAX,
    tokensBySource: { user_input: 1000, generation: 2000, tool_result: 1000 },
    achievements: ['first_feed', 'gourmet'],
    daily: { day: workDay, feeds: 0, tools: 0, bestCombo: 0, done: ['feeds', 'tools', 'combo', 'feeds20', 'feeds5', 'pats5', 'pats15', 'tok10k', 'tok50k', 'tools15', 'snacks3', 'combo10'] },
    streakDay: workDay, streakCount: 1,
    lastFeedAt: T4,
  }

  // tool/call 只观察不喂食：技能涨了，但喂食那一侧一个数字都不该动。
  const base = bootAt(T4, WORK_SAVE)
  const before = base.readState()
  base.feed(callEvent('edit', { file_path: 'C:\\code\\deepseek-pet\\lib\\client.js' }, 'k1'))
  const one = base.readState()
  assert.equal(one.totalFeeds, before.totalFeeds, 'tool/call 不该算一次喂食')
  assert.equal(one.totalTokens, before.totalTokens, 'tool/call 不该进 token 统计')
  assert.deepEqual(one.tokensBySource, before.tokensBySource, '消耗面板不该被污染')
  assert.equal(one.comboCount, 0, 'tool/call 不该攒连击（否则一轮循环翻倍）')
  assert.equal(one.pet.hunger, before.pet.hunger, 'tool/call 不是饭，不该喂饱它')
  assert.equal(one.daily.tools, 0, 'tool/call 不算一次工具结果')
  assert.equal(one.skills.coding.xp, 1, '读写文件长的是编码技能')
  assert.deepEqual(one.memory.files, [{ name: 'client.js', count: 1 }], '记忆只留 basename')
  assert.deepEqual(one.memory.tools, [{ name: 'edit', count: 1 }])
  assert.equal(one.memory.hours[workHour], 1, '活动应当落在事件那个小时格里')

  // 工具名 → 技能的映射：四条各一例，外加一个没见过的工具落到探索。
  base.feed(callEvent('grep', { pattern: 'x' }, 'k2'))
  base.feed(callEvent('bash', { command: 'ls' }, 'k3'))
  base.feed(callEvent('todo_write', {}, 'k4'))
  base.feed(callEvent('mcp__notes__search', {}, 'k5'))
  const mapped = base.readState()
  assert.equal(mapped.skills.coding.xp, 1)
  assert.equal(mapped.skills.research.xp, 2, '不认识的工具也该落到探索')
  assert.equal(mapped.skills.debug.xp, 1)
  assert.equal(mapped.skills.writing.xp, 1)
  assert.deepEqual(
    mapped.memory.tools.map(r => r.name),
    ['edit', 'grep', 'bash', 'todo_write', 'mcp__notes__search'],
    '同分的一串应当保持先来后到',
  )
  assert.equal(mapped.memory.hours[workHour], 5)

  // 表达技能还有另一个来源：模型写了多少字（每 2000 输出 token 算 1 点）。
  base.feed(assistantEvent(6000))
  assert.equal(base.readState().skills.writing.xp, 4, '6000 输出 token → +3')
  base.feed(assistantEvent(30000))
  assert.equal(base.readState().skills.writing.xp, 9, '单条最多 +5，不该被一次超长输出顶满')
  assert.deepEqual(
    base.readState().memory.files, [{ name: 'client.js', count: 1 }],
    'generation 不带文件名，不该动记忆里的文件表',
  )

  // 面板上看得见：四条技能各一行 + 几行记忆。
  findNode(base.component({}), n => n.props?.className === 'dshpet-badge-btn')
    .props.onClick({ stopPropagation: () => {} })
  const workPanel = findNode(base.component({}), n => n.props?.className === 'dshpet-panel')
  const skillRows = findAll(workPanel, n => n.props?.className === 'dshpet-skill')
  assert.equal(skillRows.length, 4, '面板应当摆四条技能')
  assert.equal(
    findNode(skillRows[0], n => n.props?.className === 'dshpet-skill-n').children.join(''), 'Lv.1',
  )
  assert.equal(
    findNode(skillRows[0], n => n.props?.className === 'dshpet-bar dshpet-bar-skill')
      .children[0].props.style.width, '5%',
    '技能条应当按「这一级攒了多少」走（1/20）',
  )
  const memoryLines = findAll(workPanel, n => n.props?.className === 'dshpet-sub')
    .map(n => n.children.join(''))
  assert.ok(memoryLines.some(t => t.includes('常改 client.js(1)')), '记忆段应当写常改的文件: ' + memoryLines.join(' | '))
  assert.ok(memoryLines.some(t => t.includes('最常用 edit(1)')), '记忆段应当写最常用的工具')
  assert.ok(memoryLines.some(t => t.includes('点干活')), '记忆段应当写常在几点干活')

  // 攒够就升级：把每级的门槛调小，好在一节测试里走到 Lv.2（提示能力的门槛）。
  storage.set(CONFIG_KEY, JSON.stringify({ skillXpPerLevel: 3 }))
  const quick = bootAt(T4, WORK_SAVE)
  for (const id of ['r1', 'r2', 'r3']) quick.feed(callEvent('read', { file_path: 'a.js' }, id))
  const up = quick.readState()
  assert.equal(up.skills.coding.level, 2, '3 次调用应当把编码顶到 Lv.2')
  assert.equal(up.skills.coding.xp, 0, '升级应当把门槛那份扣掉')
  assert.ok(
    up.effects.filter(e => e.text !== undefined).map(e => e.text).includes('技能 · 编码 Lv.2'),
    '升级应当飘一条通知',
  )
  assert.equal(up.bubble.kind, 'skill', '升级应当说一句')

  // 提示一：同一个文件反复改。read 不算「改」，所以上面那三次不该触发它。
  Date.now = () => T4 + 5000
  quick.feed(callEvent('edit', { file_path: 'C:/x/client.js' }, 'e1'))
  // （说的是别的什么都行 —— 碰到没见过的文件时好奇心那句也可能占着气泡，
  //   要紧的是「提示」这一类还没轮到。）
  assert.notEqual(quick.readState().bubble.kind, 'advice', '改第 1 次还不到提示的时候')
  quick.feed(callEvent('edit', { file_path: 'C:/x/client.js' }, 'e2'))
  quick.feed(callEvent('edit', { file_path: 'C:/x/client.js' }, 'e3'))
  const advised = quick.readState()
  assert.equal(advised.bubble.kind, 'advice', '第 3 次改同一个文件应当提一句')
  assert.equal(advised.bubble.text, 'client.js 改到第 3 次了，跑个测试？')

  // 冷却期内不再说第二遍（第 6 次也到了阈值的整数倍，但 60 秒还没过）。
  Date.now = () => T4 + 8000
  for (const id of ['e4', 'e5', 'e6']) {
    quick.feed(callEvent('edit', { file_path: 'C:/x/client.js' }, id))
  }
  // （这三次把编码顶到了 Lv.3，所以说的是升级那句 —— 但提示不该再来一遍。）
  assert.notEqual(quick.readState().bubble.kind, 'advice', '提示冷却期内不该再说第二遍')

  // 提示二：连着报错。同样要求对应技能（调试）够高。
  Date.now = () => T4 + 80000
  for (const id of ['b1', 'b2', 'b3']) quick.feed(callEvent('bash', { command: 'x' }, id))
  assert.equal(quick.readState().skills.debug.level, 2, '调试也得先熟起来')
  Date.now = () => T4 + 90000
  quick.feed(resultEvent('b1', { name: 'ToolError', code: 'E' }))
  Date.now = () => T4 + 90001
  quick.feed(resultEvent('b2', { name: 'ToolError', code: 'E' }))
  const twoErrors = quick.readState()
  assert.equal(twoErrors.memory.errors, 2, '报错次数该记着')
  assert.notEqual(twoErrors.bubble.kind, 'advice', '连着 2 次还不到阈值')
  Date.now = () => T4 + 95000
  quick.feed(resultEvent('b3', { name: 'ToolError', code: 'E' }))
  const threeErrors = quick.readState()
  assert.equal(threeErrors.bubble.kind, 'advice', '连着 3 次报错应当提一句')
  assert.equal(threeErrors.bubble.text, '连着 3 次报错了，先看看上一条错误？')
  assert.equal(threeErrors.memory.errors, 3)
  assert.equal(threeErrors.memory.recoveries, 0, '还没走出来')

  // 同一个工具报错后又成功 = 跨过一道坎；换个工具做成了别的事不算。
  Date.now = () => T4 + 96000
  quick.feed(callEvent('bash', { command: 'x' }, 'b4'))
  quick.feed(resultEvent('b4', undefined))
  assert.equal(quick.readState().memory.recoveries, 1, '同一个工具转成功应当 +1')
  assert.equal(quick.readState().memory.errors, 3, '成功不该再记一次错')
  quick.feed(callEvent('bash', { command: 'x' }, 'b6'))
  quick.feed(resultEvent('b6', { name: 'ToolError', code: 'E' }))
  quick.feed(callEvent('grep', { pattern: 'x' }, 'g1'))
  quick.feed(resultEvent('g1', undefined))
  const other = quick.readState()
  assert.equal(other.memory.recoveries, 1, '换个工具做成了别的事不算跨过这道坎')
  assert.equal(other.memory.errors, 4)

  // 落盘往返：技能与记忆原样回来（v 不变，老存档缺这两个字段也读得动）。
  fireWindow('pagehide')
  const saved = JSON.parse(storage.get(STATE_KEY))
  assert.equal(saved.v, 2, '存档版本号')
  const reborn = bootFresh().readState()
  assert.deepEqual(reborn.skills, other.skills, '技能应当原样回来')
  assert.deepEqual(reborn.memory, other.memory, '记忆应当原样回来')

  // 存档里塞垃圾：逐字段洗掉，而不是崩掉或者原样信了。
  storage.delete(CONFIG_KEY)
  const junk = bootAt(T4, Object.assign({}, WORK_SAVE, {
    skills: { coding: { xp: -5, level: 99 }, ghost: { xp: 3, level: 3 }, debug: 'nope' },
    memory: {
      files: [
        { name: 'C:/a/b/' + 'x'.repeat(80) + '.js', count: -3 },
        { name: 5 }, 'junk',
        { name: 'a.js', count: 4 },
      ],
      tools: [{ name: 'bash', count: 1e30 }],
      hours: [1, 2, 3],
      bornDay: -1,
      errors: 'x',
      recoveries: 2,
    },
  }))
  const clean = junk.readState()
  assert.deepEqual(
    Object.keys(clean.skills), ['coding', 'research', 'debug', 'writing'],
    '只认技能表里那四条（假技能名会被丢掉）',
  )
  assert.equal(clean.skills.coding.level, 10, '等级夹到上限')
  assert.equal(clean.skills.coding.xp, 0, '负经验归零')
  assert.deepEqual(clean.skills.debug, { xp: 0, level: 1, mastery: 0 }, '不成形的那条退回空技能')
  assert.equal(clean.memory.files.length, 2, '不成形的行应当丢掉')
  assert.deepEqual(clean.memory.files[0], { name: 'a.js', count: 4 }, '按次数降序')
  assert.equal(clean.memory.files[1].name.length, 40, '超长文件名截到 40 字')
  assert.equal(clean.memory.files[1].count, 1, '负数次数夹回 1')
  assert.equal(clean.memory.tools[0].count, 1e9, '离谱的次数夹到上限')
  assert.equal(clean.memory.hours.length, 24, 'hours 必须补齐 24 格')
  assert.equal(clean.memory.errors, 0, '不是数字就退回 0')
  assert.equal(clean.memory.bornDay, workDay, 'bornDay 非法 → 从今天算起')

  // 记忆是**有界**的：满了就挤掉同分里最久没碰过的那个，新面孔进得来。
  const rows = []
  for (let i = 0; i < 12; i += 1) rows.push({ name: 'f' + String(i) + '.js', count: 12 - i })
  const full = bootAt(T4, Object.assign({}, WORK_SAVE, {
    // 顺手把「相处很久了」和「睡着了」也摆好，下面验动态台词要用。
    lastFeedAt: T4 - 10 * 60 * 1000,
    memory: { files: rows, tools: [], hours: [], bornDay: workDay - 9, errors: 0, recoveries: 0 },
  }))
  full.feed(callEvent('write', { file_path: 'new.js' }, 'n1'))
  const files = full.readState().memory.files
  assert.equal(files.length, 12, '文件表应当有界')
  assert.ok(files.some(r => r.name === 'new.js'), '新文件应当挤得进来（否则记忆冻在第一天）')
  assert.equal(files.some(r => r.name === 'f11.js'), false, '同分里最久没碰的那个被忘掉')
  assert.deepEqual(
    files.map(r => r.count), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], '文件表应当按次数降序',
  )

  // 记忆得说得出来才算记忆：相处够久，睡醒那句换成带天数的动态台词。
  assert.equal(full.readState().asleep, true, '10 分钟没人喂它，应当睡着了')
  clickSnack(full.component)
  const woke = full.readState()
  assert.equal(woke.asleep, false)
  assert.equal(woke.bubble.text, '又见面了，这是第 10 天…（打哈欠）', '睡醒那句应当带上相处的天数')

  // 三个开关各自关掉：不记账、不提示、面板退回原来的三段。
  storage.set(CONFIG_KEY, JSON.stringify({
    skillsEnabled: false, memoryEnabled: false, adviceEnabled: false,
  }))
  const off = bootAt(T4, WORK_SAVE)
  for (const id of ['o1', 'o2', 'o3', 'o4']) {
    off.feed(callEvent('edit', { file_path: 'client.js' }, id))
  }
  const offState = off.readState()
  assert.deepEqual(offState.skills.coding, { xp: 0, level: 1, mastery: 0 }, '关了技能就不该记账')
  assert.deepEqual(offState.memory.files, [], '关了记忆就不该记文件')
  assert.deepEqual(offState.memory.tools, [], '关了记忆就不该记工具')
  assert.equal(offState.bubble, null, '关了提示就一句都不说')
  findNode(off.component({}), n => n.props?.className === 'dshpet-badge-btn')
    .props.onClick({ stopPropagation: () => {} })
  assert.deepEqual(
    findAll(
      findNode(off.component({}), n => n.props?.className === 'dshpet-panel'),
      n => n.props?.className === 'dshpet-panel-title',
    ).map(n => n.children.join('')),
    ['状态', '今日任务 · 连续到访 1 天', '成就 2/14'],
    '全关了面板应当退回原来的三段',
  )

  assert.ok(CSS_TEXT.includes('.dshpet-skill{'), '技能行没有对应样式')
  assert.ok(CSS_TEXT.includes('.dshpet-skill-n{'), '技能等级没有对应样式')
  assert.ok(CSS_TEXT.includes('.dshpet-bar-skill'), '技能条没有对应样式')
  assert.ok(CSS_TEXT.includes('.dshpet-bubble[data-kind=advice]'), '提示气泡没有对应样式')
  assert.ok(CSS_TEXT.includes('max-height:min(70vh,520px)'), '面板长到五段了，得能滚')

  storage.delete(CONFIG_KEY)
  storage.delete(STATE_KEY)
} finally {
  Date.now = workClock
}

// ---- 台词：更多场合与确定性伪随机 ----------------------------------------

const lineClock = Date.now
try {
  const T5 = T + 9 * 86400000
  const day5 = dayIndexOf(T5)
  /** 本地时区里 T5 是几点 —— 「深夜」按本地小时判定，所以时段得跟着算出来。 */
  const hour5 = new Date(T5).getHours()
  /** 和当下差得够远的一个小时数，用来构造「现在**不是**深夜」。 */
  const notHour5 = (hour5 + 6) % 24

  /**
   * 一份「养了一阵子」的存档：成就 / 今日任务先标成拿过了 —— 这一节看的是
   * 台词挑得对不对，别让成就与任务那些**强制**台词把气泡抢走。
   * @param extra - 要盖掉的字段。
   */
  const lineSave = extra => Object.assign({
    pet: { hunger: 40, exp: 0, level: 3, mood: 80, energy: 80 },
    totalFeeds: 30, totalTokens: 40000, snacks: SNACK_MAX,
    tokensBySource: { user_input: 10000, generation: 20000, tool_result: 10000 },
    achievements: ['first_feed', 'gourmet', 'combo_full', 'feast'],
    daily: { day: day5, feeds: 0, tools: 0, bestCombo: 0, done: ['feeds', 'tools', 'combo', 'feeds20', 'feeds5', 'pats5', 'pats15', 'tok10k', 'tok50k', 'tools15', 'snacks3', 'combo10'] },
    streakDay: day5, streakCount: 1,
    lastFeedAt: T5,
  }, extra)

  // 池子得够深：确定性伪随机是「看起来随机」，一档只有两句照样一眼看穿。
  // 日常那几档（每一轮工具循环都在说）要求更深。
  const DEEP = ['user_input', 'generation', 'tool_result', 'pat', 'snack', 'hungry', 'wake', 'sleep']
  for (const kind of DEEP) {
    assert.ok(linesOf(kind).length >= 6, `${kind} 天天在说，只有 ${linesOf(kind).length} 句不够`)
  }
  for (const kind of ['feast', 'favorite', 'bored', 'frenzy', 'evolve', 'achieve', 'quest',
    'skill', 'levelup', 'combo', 'full', 'tired', 'sad', 'night', 'marathon']) {
    assert.ok(linesOf(kind).length >= 3, `${kind} 的台词池只有 ${linesOf(kind).length} 句，太浅`)
  }

  // ---- 状态派生的四句：升级 / 连击升档 / 吃饱 / 困了 ----
  // 关怀关掉：它排在日常台词前面（半小时才够格一次），会把这几句顶掉。
  storage.set(CONFIG_KEY, JSON.stringify({ careEnabled: false, bubbleMinGapMs: 0 }))

  // 普通升级（没跨形态门槛）：不飘彩虹字，但得说一句 —— 而且要**强插**，
  // 因为这一口的日常台词早就先说了。
  const up = bootAt(T5, lineSave({ pet: { hunger: 40, exp: 399, level: 4, mood: 80, energy: 80 } }))
  up.feed(userEvent('字'.repeat(400)))
  const upped = up.readState()
  assert.equal(upped.pet.level, 5, '399/400 经验再喂一口应当升级')
  assert.equal(upped.bubble.kind, 'levelup', '普通升级也该说一句: ' + upped.bubble.kind)
  assert.ok(linesOf('levelup').includes(upped.bubble.text), '升级台词应当出自池子')
  assert.equal(
    upped.effects.filter(e => e.source === 'evolve').length, 0,
    '没跨形态门槛就不该飘进阶特效',
  )

  // 连击升档（第 4 口进金字档）：升档本来有彩虹字 + 震动 + 徽标，这句是补的。
  const cmb = bootAt(T5, lineSave())
  for (let i = 0; i < 4; i += 1) cmb.feed(userEvent('字'.repeat(400)))
  const combod = cmb.readState()
  assert.equal(combod.comboTier, 'gold', '第 4 口应当进金字档')
  assert.equal(combod.bubble.kind, 'combo', '连击升档应当说一句: ' + combod.bubble.kind)

  // 吃饱（饱食度这一口被喂到 0）。
  const ful = bootAt(T5, lineSave({ pet: { hunger: 3, exp: 0, level: 3, mood: 80, energy: 80 } }))
  ful.feed(userEvent('字'.repeat(400)))
  const filled = ful.readState()
  assert.equal(filled.pet.hunger, 0, '4 点食物应当把剩下的 3 点饱食度填满')
  assert.equal(filled.bubble.kind, 'full', '刚吃饱应当说一句: ' + filled.bubble.kind)

  // 困了：精力只在**喂食**时掉（空闲时只回不掉），所以判定在 feed 里而不在 tick 里。
  const tir = bootAt(T5, lineSave({ pet: { hunger: 40, exp: 0, level: 3, mood: 80, energy: 26 } }))
  tir.feed(userEvent('字'.repeat(400)))
  const tired = tir.readState()
  assert.equal(tired.pet.energy, 23, '一口饭扣 3 点精力')
  assert.equal(tired.bubble.kind, 'tired', '精力刚跌破线应当说一句: ' + tired.bubble.kind)
  // 再喂一口不再重复：只在**跨线**那一次说。
  Date.now = () => T5 + 1000
  tir.feed(userEvent('字'.repeat(400)))
  assert.notEqual(tir.readState().bubble.kind, 'tired', '跌破线之后不该每口都喊困')

  // 心情跌破线：这条**是**空闲跌出来的（心情一直在掉），所以判定在 tick 里。
  // 把心情的掉速调快（默认 0.4/min 得空闲 5 分钟才掉得动 2 点，那时它已经睡了）。
  storage.set(CONFIG_KEY, JSON.stringify({ careEnabled: false, bubbleMinGapMs: 0, moodDecayPerMin: 2 }))
  const sadCase = bootAt(T5, lineSave({ pet: { hunger: 40, exp: 0, level: 3, mood: 31, energy: 90 } }))
  const sadTick = tickerOf(sadCase.component)
  Date.now = () => T5 + 60000
  sadTick()
  const sadState = sadCase.readState()
  assert.ok(sadState.pet.mood < 30, `空闲一分钟应当把心情掉破 30，实际 ${sadState.pet.mood}`)
  assert.equal(sadState.asleep, false, '一分钟还没到睡眠门槛')
  assert.equal(sadState.bubble.kind, 'sad', '心情跌破线应当说一句: ' + sadState.bubble.kind)

  // ---- 关怀：深夜 / 久坐 / 好久不见 ----

  // 深夜：把「深夜」时段钉在测试时钟所在的那一个小时，免得跟着机器的时区变红。
  storage.set(CONFIG_KEY, JSON.stringify({ careNightFrom: hour5, careNightTo: hour5 }))
  const night = bootAt(T5, lineSave())
  night.feed(userEvent('还在写'))
  const late = night.readState()
  assert.equal(late.bubble.kind, 'night', '深夜第一口应当关心一句: ' + late.bubble.kind)
  assert.ok(linesOf('night').includes(late.bubble.text), '深夜台词应当出自池子')
  // 半小时冷却：关怀没有信息量，稀有才不烦人。冷却里退回日常台词。
  Date.now = () => T5 + 10000
  night.feed(userEvent('接着写'))
  const soon = night.readState()
  assert.equal(soon.bubble.kind, 'user_input', '冷却里应当退回日常台词: ' + soon.bubble.kind)

  // 不在时段里就一句不说。
  storage.set(CONFIG_KEY, JSON.stringify({ careNightFrom: notHour5, careNightTo: notHour5 }))
  const day = bootAt(T5, lineSave())
  day.feed(userEvent('白天好'))
  assert.equal(day.readState().bubble.kind, 'user_input', '不是深夜就别念')

  // 久坐：一段不间断的活儿干到 careMarathonMs 就劝一句，同一段只劝一次。
  storage.set(CONFIG_KEY, JSON.stringify({
    careMarathonMs: 60000, careCooldownMs: 1000,
    careNightFrom: notHour5, careNightTo: notHour5,
  }))
  const sit = bootAt(T5, lineSave())
  sit.feed(userEvent('开工'))
  assert.notEqual(sit.readState().bubble.kind, 'marathon', '刚坐下不该劝歇')
  Date.now = () => T5 + 70000
  sit.feed(userEvent('还在干'))
  const long = sit.readState()
  assert.equal(long.bubble.kind, 'marathon', '坐了一分钟（配置里的门槛）应当劝一句')
  assert.ok(linesOf('marathon').includes(long.bubble.text), '久坐台词应当出自池子')
  Date.now = () => T5 + 140000
  sit.feed(userEvent('继续'))
  assert.notEqual(sit.readState().bubble.kind, 'marathon', '同一段只该劝一次')
  // 中间断了一觉（超过 sleepAfterMs 没动静）就重新起算 —— 「你坐了很久」得是真的很久。
  Date.now = () => T5 + 600000
  sit.feed(userEvent('回来了'))
  assert.notEqual(sit.readState().bubble.kind, 'marathon', '歇过之后应当从零起算')
  Date.now = () => T5 + 700000
  sit.feed(userEvent('又坐久了'))
  assert.equal(sit.readState().bubble.kind, 'marathon', '新的一段坐够了还是要劝')

  // 好久不见：按**没被截断**的离开时长算（饥饿封在 24h 是为了不饿死它，
  // 可离开了这么久这件事本身值得念一句）。bootAt 的 savedAt 就是当下，
  // 所以这里手摆一份「9 小时前存的」档。
  storage.delete(CONFIG_KEY)
  const awayMs = 9 * 3600000
  storage.set(STATE_KEY, JSON.stringify(Object.assign(
    { v: 1, savedAt: T5 - awayMs }, lineSave({ lastFeedAt: T5 - awayMs }),
  )))
  Date.now = () => T5
  const back = bootFresh()
  assert.equal(back.readState().asleep, true, '离开 9 小时它早睡了')
  back.feed(userEvent('我回来了'))
  const hello = back.readState()
  assert.equal(hello.bubble.kind, 'comeback', '回来第一口应当念一句: ' + hello.bubble.kind)
  assert.ok(hello.bubble.text.includes('9 小时'), '应当说得出离开了多久: ' + hello.bubble.text)
  assert.equal(hello.asleep, false, '喂一口照样把它叫醒（只是哈欠让给了这句）')
  Date.now = () => T5 + 10000
  back.feed(userEvent('继续干活'))
  assert.notEqual(back.readState().bubble.kind, 'comeback', '「好久不见」只念一次')

  // ---- 记忆闲聊：把它记住的东西说出来 ----

  // 常改的那个文件（第 5 次以后）。
  const favFile = bootAt(T5, lineSave({
    memory: { files: [{ name: 'client.js', count: 9 }], tools: [], hours: new Array(24).fill(0), bornDay: day5 - 12, errors: 0, recoveries: 0 },
  }))
  favFile.feed(callEvent('edit', { file_path: 'C:\\code\\lib\\client.js' }, 'm1'))
  const nagFile = favFile.readState()
  assert.equal(nagFile.bubble.kind, 'chat', '常改的文件应当被搭话: ' + nagFile.bubble.kind)
  assert.equal(nagFile.bubble.text, '又是 client.js 啊')

  // 常用的那个工具（每满十次念一次）。
  const favTool = bootAt(T5, lineSave({
    memory: { files: [], tools: [{ name: 'grep', count: 19 }], hours: new Array(24).fill(0), bornDay: day5 - 12, errors: 0, recoveries: 0 },
  }))
  favTool.feed(callEvent('grep', { pattern: 'x' }, 'm2'))
  assert.equal(favTool.readState().bubble.text, '你已经用了 20 次 grep 了')
  // 第 21 次不再念（只在整十那次）。
  Date.now = () => T5 + 10000
  favTool.feed(callEvent('grep', { pattern: 'y' }, 'm3'))
  assert.notEqual(favTool.readState().bubble.text, '你已经用了 21 次 grep 了', '整十才念一次')

  // 常干活的那个时段。文件与工具都还没到门槛，于是轮到它。
  const busy = new Array(24).fill(0)
  busy[hour5] = 5
  const favHour = bootAt(T5, lineSave({
    memory: { files: [], tools: [], hours: busy, bornDay: day5 - 12, errors: 0, recoveries: 0 },
  }))
  favHour.feed(callEvent('read', { file_path: 'a.ts' }, 'm4'))
  const habit = favHour.readState()
  assert.equal(habit.bubble.kind, 'chat', '常干活的时段应当被搭话: ' + habit.bubble.kind)
  assert.ok(habit.bubble.text.startsWith('又到你干活的点了'), '文案不对: ' + habit.bubble.text)

  // careEnabled: false 就一句关怀 / 闲聊都不说（深夜时段仍然钉在当下）。
  storage.set(CONFIG_KEY, JSON.stringify({ careEnabled: false, careNightFrom: hour5, careNightTo: hour5 }))
  const quiet = bootAt(T5, lineSave({
    memory: { files: [{ name: 'client.js', count: 9 }], tools: [], hours: busy, bornDay: day5 - 12, errors: 0, recoveries: 0 },
  }))
  quiet.feed(userEvent('晚上好'))
  assert.equal(quiet.readState().bubble.kind, 'user_input', '关了关怀，深夜也只说日常台词')
  Date.now = () => T5 + 10000
  quiet.feed(callEvent('edit', { file_path: 'client.js' }, 'q1'))
  assert.equal(quiet.readState().bubble.kind, 'user_input', '关了关怀就不该搭话')

  // ---- 新增的三条提示 ----
  // 冷却设成 0（这一节要连着看好几条），但 bubbleMinGapMs 留着默认的 4 秒 ——
  // 提示正是靠它挡住紧跟着来的日常台词（tool/result 既喂食又报成败）。
  storage.set(CONFIG_KEY, JSON.stringify({ careEnabled: false, adviceCooldownMs: 0 }))
  const dbg = bootAt(T5, lineSave({
    skills: { coding: { xp: 0, level: 3 }, debug: { xp: 0, level: 3 } },
  }))
  let at = T5
  /** 走一趟「调用 → 结果」，每步往后拨 5 秒（越过 bubbleMinGapMs）。 */
  const runTool = (name, args, id, error) => {
    at += 5000
    Date.now = () => at
    dbg.feed(callEvent(name, args, id))
    at += 5000
    Date.now = () => at
    dbg.feed(resultEvent(id, error))
  }
  const FAIL = { name: 'ToolError', code: 'x' }
  runTool('bash', { command: 'a' }, 'e1', FAIL)
  assert.notEqual(
    dbg.readState().bubble.kind, 'advice',
    '第一次挂不用提什么（谁都会挂一次），照旧说这一口的日常台词',
  )
  runTool('bash', { command: 'b' }, 'e2', FAIL)
  const flaky = dbg.readState()
  assert.equal(flaky.bubble.kind, 'advice', '同一个工具连着挂应当提一句')
  assert.equal(flaky.bubble.text, 'bash 连着挂了 2 次，换个思路试试？')
  // 跨过这道坎的时候夸一句 —— 这一整套里唯一一句正面的提示。
  runTool('bash', { command: 'c' }, 'e3', undefined)
  const cured = dbg.readState()
  assert.equal(cured.bubble.text, 'bash 终于成了！这道坎跨过去了')
  assert.equal(cured.memory.recoveries, 1, '「跨过一道坎」应当记进记忆')

  // 同一个文件反复改：第 3 / 6 / 9 次的措辞逐级加重。
  const nag = bootAt(T5, lineSave({ skills: { coding: { xp: 0, level: 3 } } }))
  const said = []
  for (let i = 1; i <= 9; i += 1) {
    Date.now = () => T5 + i * 5000
    nag.feed(callEvent('edit', { file_path: 'C:\\code\\lib\\client.js' }, 'r' + i))
    const shown = nag.readState().bubble
    if (i % 3 === 0) said.push(shown.text)
  }
  assert.deepEqual(said, [
    'client.js 改到第 3 次了，跑个测试？',
    'client.js 改了 6 次还没好，是不是卡住了？',
    'client.js 已经第 9 次了…要不先想清楚再动手？',
  ], '反复改同一个文件，措辞应当逐级加重')

  // 挑句子的**质量**：光断言「说的话在池子里」挡不住散列退化 —— 第一版用
  // xorshift 打散，在 3 句的池子上排出了「0,2,0,2,0,2…」（中间那句 6000 次里
  // 只说了 187 次），而这一节别的断言全绿。所以这里量三件事：每一句都轮到过、
  // 没有哪一句被偏爱到两倍、任意相邻两次不重复。
  storage.set(CONFIG_KEY, JSON.stringify({
    careEnabled: false, bubbleMinGapMs: 0, pickyEnabled: false, hungerRegenPerMin: 0,
    dynamicLinesEvery: 0,
  }))
  const spread = bootAt(T5, lineSave())
  const pool = linesOf('user_input')
  const tally = new Map()
  let prev = null
  for (let i = 0; i < 420; i += 1) {
    Date.now = () => T5 + i * 1000
    spread.feed(userEvent('字'.repeat(400)))
    const shown = spread.readState().bubble
    // 升级 / 吃饱 / 连击升档那几句会插进来，插了就断一次链（那一次的日常台词
    // 确实抽了，只是没露面，所以和它相邻的两次之间没有「不重复」的保证）。
    if (shown.kind !== 'user_input') { prev = null; continue }
    assert.ok(pool.includes(shown.text), '说的话应当出自池子: ' + shown.text)
    assert.notEqual(shown.text, prev, '同一句不该连着说两遍: ' + shown.text)
    prev = shown.text
    tally.set(shown.text, (tally.get(shown.text) ?? 0) + 1)
  }
  assert.equal(
    tally.size, pool.length,
    `池子里 ${pool.length} 句应当都轮到过，实际只说出来 ${tally.size} 句`,
  )
  const spoken = [...tally.values()]
  assert.ok(
    Math.max(...spoken) <= Math.min(...spoken) * 2,
    `挑得太偏（最多的说了 ${Math.max(...spoken)} 次、最少的 ${Math.min(...spoken)} 次）—— 散列退化了`,
  )

  // 关怀那几句有自己的一道冷色边框：「它在关心你」和「它在告诉你一件事」
  // （提示那道暖色）得能一眼分开。
  assert.ok(CSS_TEXT.includes('.dshpet-bubble[data-kind=night]'), '关怀气泡没有对应样式')
  assert.ok(CSS_TEXT.includes('.dshpet-bubble[data-kind=chat]'), '闲聊气泡没有对应样式')
  assert.ok(CSS_TEXT.includes('#6cc7e8'), '关怀那道冷色边框没了')

  storage.delete(CONFIG_KEY)
  storage.delete(STATE_KEY)
} finally {
  Date.now = lineClock
}

// ---- 情绪三维 + 空闲微交互 ----------------------------------------------

const dimClock = Date.now
try {
  anchors = ANCHORS
  const T6 = T + 14 * 86400000
  const day6 = dayIndexOf(T6)

  /**
   * 一份「养了一阵子」的存档。成就 / 任务先标成拿过了（同 lineSave 的理由：
   * 那些**强制**台词会把三维那几句挤掉），关怀也在下面用配置关掉。
   * @param extra - 要盖掉的字段。
   */
  const dimSave = extra => Object.assign({
    pet: { hunger: 40, exp: 0, level: 3, mood: 80, energy: 80 },
    totalFeeds: 30, totalTokens: 40000, snacks: SNACK_MAX,
    tokensBySource: { user_input: 10000, generation: 20000, tool_result: 10000 },
    achievements: ['first_feed', 'gourmet', 'combo_full', 'feast', 'streak_3', 'tokens_100k'],
    daily: { day: day6, feeds: 0, tools: 0, bestCombo: 0, done: ['feeds', 'tools', 'combo', 'feeds20', 'feeds5', 'pats5', 'pats15', 'tok10k', 'tok50k', 'tools15', 'snacks3', 'combo10'] },
    streakDay: day6, streakCount: 1,
    lastFeedAt: T6,
  }, extra)

  storage.set(CONFIG_KEY, JSON.stringify({ careEnabled: false }))

  // 刚认识的时候三维都是 0，脸上什么都不写。
  const dims = bootAt(T6, dimSave())
  const zero = dims.readState().pet
  assert.deepEqual(
    [zero.curiosity, zero.pride, zero.concern], [0, 0, 0],
    '三维应当从 0 起（没什么可好奇、可得意、可担忧的）',
  )
  assert.equal(cardOf(dims.component).props['data-dim'], undefined, '都没过线就不该写在脸上')

  // 好奇：没见过的工具 +15、没见过的文件 +15。
  dims.feed(callEvent('edit', { file_path: 'C:\\x\\a.js' }, 'd1'))
  assert.equal(dims.readState().pet.curiosity, 30, '新工具 + 新文件应当各给一份好奇')
  // 同一个工具改同一个文件就不新鲜了。「新面孔」是拿记忆表比的，所以这条
  // 也顺带钉住了「先比对、后记账」的顺序。
  Date.now = () => T6 + 5000
  dims.feed(callEvent('edit', { file_path: 'C:\\x\\a.js' }, 'd2'))
  assert.equal(dims.readState().pet.curiosity, 30, '见过的东西不该再涨好奇')
  // 搜索抓网页本身就算一点好奇（+6），外加这个工具第一次见（+15）。
  Date.now = () => T6 + 10000
  dims.feed(callEvent('web_search', {}, 'd3'))
  assert.equal(dims.readState().pet.curiosity, 51, '探索类工具本身也该给一点好奇')

  // 越过 moodDimAt（55）那一刻说一句，并写到脸上。
  Date.now = () => T6 + 15000
  dims.feed(callEvent('glob', { pattern: 'x' }, 'd4'))
  const curious = dims.readState()
  assert.equal(curious.pet.curiosity, 72)
  assert.equal(curious.bubble.kind, 'curious', '跨过门槛应当说一句: ' + curious.bubble.kind)
  assert.ok(linesOf('curious').includes(curious.bubble.text), '好奇的台词不在池子里')
  assert.equal(cardOf(dims.component).props['data-dim'], 'curiosity', '过线了应当写在脸上')
  assert.match(
    cardOf(dims.component).props.title, /好奇 72/,
    'tooltip 应当写着是哪一维: ' + cardOf(dims.component).props.title,
  )

  // 只在**跨线那一次**说：再涨也不该复读（一轮工具循环能推好几次好奇心）。
  Date.now = () => T6 + 20000
  dims.feed(callEvent('read_image', { file_path: 'b.png' }, 'd5'))
  assert.ok(dims.readState().pet.curiosity > 72, '还该继续涨')
  assert.notEqual(dims.readState().bubble.kind, 'curious', '过了线就别复读了')

  // 有情绪才长眉毛，而且那四种脸色（星星眼 / 睡着 / 饿脱相 / 委屈）排在三维
  // 之前 —— 睡着的鲸鱼不该睁着一双好奇的眼。
  const curiousWhale = findNode(cardOf(dims.component), n => typeof n.type === 'function')
  assert.equal(curiousWhale.props.dim.key, 'curiosity', '三维应当传给鲸鱼')
  // APNG 精灵版没有眉毛/嘴形部件：三维不改变底座动图（素材只有 7 态，无三维专属
  // 表情），但优先级不变 —— 睡着时仍切睡眠态，而不是被三维盖掉。
  const curiousImg = srcOf(curiousWhale.type(curiousWhale.props))
  const calmImg = srcOf(curiousWhale.type(Object.assign({}, curiousWhale.props, { tier: 'normal' })))
  assert.equal(curiousImg, calmImg, '三维不改变底座动图（素材无三维专属表情）')
  assert.ok(
    srcOf(curiousWhale.type(Object.assign({}, curiousWhale.props, { asleep: true }))).indexOf('-sleep.apng') !== -1,
    '睡着的时候三维不该上脸（切睡眠态动图）',
  )

  // 面板里那一行：三维只报数字，刻意不给进度条（它们不驱动任何数值）。
  const dimsBadge = findNode(dims.component({}), n => n.props?.className === 'dshpet-badge-btn')
  dimsBadge.props.onClick({ stopPropagation: () => {} })
  const dimsPanel = findNode(dims.component({}), n => n.props?.className === 'dshpet-panel')
  const dimsLine = findNode(dimsPanel, n => n.props?.className === 'dshpet-sub dshpet-dims')
  assert.ok(dimsLine !== null, '面板的状态段应当有三维那一行')
  const dimsText = dimsLine.children.join('')
  assert.match(dimsText, /😤 得意 \d+ · 🤔 好奇 \d+ · 😟 担忧 0/, '三维那一行不对: ' + dimsText)
  assert.match(dimsText, /写在脸上：好奇/, '应当点出此刻是哪一维: ' + dimsText)
  assert.equal(
    findNode(dimsPanel, n => typeof n.props?.className === 'string'
      && n.props.className.includes('dshpet-bar-curiosity')), null,
    '三维不该有进度条 —— 那会让人以为它们也在驱动数值',
  )

  // 担忧：工具报错 +20，攒到过线时说一句。这一条的台词得**顶得住**紧跟着来的
  // 日常台词（tool/result 既报成败又喂食，两件事落在同一毫秒）。
  const FAIL = { name: 'ToolError', code: 'x' }
  const worry = bootAt(T6, dimSave())
  let wat = T6
  const runTool = (name, args, id, error) => {
    wat += 5000
    Date.now = () => wat
    worry.feed(callEvent(name, args, id))
    wat += 5000
    Date.now = () => wat
    worry.feed(resultEvent(id, error))
  }
  runTool('bash', { command: 'a' }, 'x1', FAIL)
  assert.equal(worry.readState().pet.concern, 20, '报错应当涨担忧')
  runTool('bash', { command: 'b' }, 'x2', FAIL)
  runTool('pwsh', { command: 'c' }, 'x3', FAIL)
  // 第四次才过 moodDimAt（70）—— 三次 60 分还没到写在脸上的那条线。
  assert.equal(worry.readState().bubble.kind !== 'worried', true, '60 分还不该上脸')
  // 仍旧挂在 pwsh 上：下面那条「跨过报错」要的就是这个工具刚挂过。
  runTool('pwsh', { command: 'd' }, 'x4', FAIL)
  const worried = worry.readState()
  assert.equal(worried.pet.concern, 80)
  assert.equal(worried.bubble.kind, 'worried', '担忧过线应当说一句: ' + worried.bubble.kind)
  assert.ok(linesOf('worried').includes(worried.bubble.text), '担忧的台词不在池子里')
  assert.equal(cardOf(worry.component).props['data-dim'], 'concern', '担忧过线应当写在脸上')

  // 得意：从一道坎里走出来（同一个工具刚挂过、这次成了）。
  runTool('pwsh', { command: 'c' }, 'x5', undefined)
  assert.equal(worry.readState().pet.pride, 20, '跨过报错应当涨得意')
  assert.equal(worry.readState().memory.recoveries, 1)

  // 提示比三维那几句值钱：两者落在同一毫秒时，提示得赢。
  const both = bootAt(T6, dimSave({ skills: { coding: { xp: 0, level: 3 } } }))
  for (let i = 1; i <= 3; i += 1) {
    Date.now = () => T6 + i * 5000
    both.feed(callEvent('edit', { file_path: 'C:\\x\\hot.js' }, 'p' + i))
  }
  const advised2 = both.readState()
  assert.ok(advised2.pet.curiosity > 0, '这一串里好奇心确实涨过')
  assert.equal(advised2.bubble.kind, 'advice', '一句「这是什么？」不该按下一条真有用的提示')

  // 同分时靠前的那一维赢下这张脸（脸只有一张，规则得是定的而不是碰运气）。
  const tie = bootAt(T6, dimSave({
    pet: { hunger: 40, exp: 0, level: 3, mood: 80, energy: 80, curiosity: 70, pride: 70, concern: 0 },
  }))
  assert.equal(cardOf(tie.component).props['data-dim'], 'pride', '同分应当是得意赢')

  // 衰减：没事发生就慢慢没情绪，1.2/分钟，走「取整 + 留余额」。
  const fade = bootAt(T6, dimSave({
    pet: { hunger: 40, exp: 0, level: 3, mood: 80, energy: 80, curiosity: 82, pride: 30, concern: 0 },
  }))
  const born6 = fade.readState().pet
  assert.equal(born6.curiosity, 82, '存档里的三维应当原样回来')
  assert.equal(born6.pride, 30)
  const fadeTick = tickerOf(fade.component)
  Date.now = () => T6 + 10 * 60000
  fadeTick()
  const faded = fade.readState().pet
  assert.equal(faded.curiosity, 70, `空闲 10 分钟应当掉 12 点，实际 ${faded.curiosity}`)
  assert.equal(faded.pride, 18)
  assert.equal(faded.concern, 0, '已经是 0 的那一维不该被减成负数')
  assert.equal(cardOf(fade.component).props['data-dim'], 'curiosity', '70 正好还在线上')

  // 存档里塞垃圾：夹回范围而不是崩。
  const dirty = bootAt(T6, dimSave({
    pet: { hunger: 40, exp: 0, level: 3, mood: 80, energy: 80, curiosity: -5, pride: 'x', concern: 999 },
  }))
  const cleaned = dirty.readState().pet
  assert.equal(cleaned.curiosity, 0, '负数应当夹回 0')
  assert.equal(cleaned.pride, 0, '不是数字就当没有')
  assert.equal(cleaned.concern, 100, '超上限应当夹到 100')

  // 四条新成就：都只看存档里的数字，不看钟点。
  const trophy = bootAt(T6, dimSave({
    streakDay: day6, streakCount: 7,
    skills: { coding: { xp: 0, level: 10 } },
    memory: {
      files: [], tools: [], hours: new Array(24).fill(0),
      bornDay: day6 - 20, errors: 60, recoveries: 50,
    },
    pet: { hunger: 40, exp: 0, level: 3, mood: 80, energy: 80, curiosity: 100 },
  }))
  trophy.feed(userEvent('看看成就'))
  const owned6 = trophy.readState().achievements
  for (const id of ['streak_7', 'skill_master', 'recover_50', 'curious']) {
    assert.ok(owned6.includes(id), `新成就 ${id} 应当解锁：` + owned6.join(','))
  }
  assert.equal(trophy.readState().pet.pride, 80, '一次解锁四条应当给四份得意')

  // ---- 空闲微交互 ----

  // 闲下来的小动作：离上一次互动得够久，挑哪个是**算**出来的。
  const IDLE_ACT_NAMES = ['yawn', 'wag', 'roll', 'peek']
  const idle = bootAt(T6, dimSave())
  const idleTick = tickerOf(idle.component)
  Date.now = () => T6 + 11000
  idleTick()
  assert.equal(idle.readState().idleAct, null, '刚互动过 11 秒还不该自己演')
  Date.now = () => T6 + 13000
  idleTick()
  const acted = idle.readState().idleAct
  assert.ok(IDLE_ACT_NAMES.includes(acted), '小动作应当出自那几个: ' + acted)
  assert.equal(cardOf(idle.component).props['data-idle'], acted, '小动作应当挂在卡片上')
  Date.now = () => T6 + 20000
  idleTick()
  assert.equal(idle.readState().idleAct, acted, '一个还没演完就不该换下一个')

  // 吃饭那一下必须把它撤了：data-idle 那几条选择器比 .dshpet-eating 更具体，
  // 留着一个打哈欠的嘴会直接盖掉咀嚼。
  Date.now = () => T6 + 25000
  idle.feed(userEvent('喂一口'))
  assert.equal(idle.readState().idleAct, null, '吃饭得把小动作撤了')
  assert.equal(idle.readState().lastAct, 'eat')
  assert.ok(
    findNode(cardOf(idle.component), n => n.props?.className === 'dshpet-eating') !== null,
    '吃饭那一下应当给头像挂 .dshpet-eating',
  )

  // 同一串输入应当演出同一个小动作（pickLineIndex，不是 Math.random）。
  const idle2 = bootAt(T6, dimSave())
  const idleTick2 = tickerOf(idle2.component)
  Date.now = () => T6 + 13000
  idleTick2()
  assert.equal(idle2.readState().idleAct, acted, '同一串输入应当演出同一个小动作')

  // 摸头的手感：单独一个 patKey + lastAct（进食和摸头都在动 transform，
  // 一个元素只有一个 transform，所以是二选一而不是叠着挂）。
  const petting = bootAt(T6, dimSave({ pats: 10 }))
  const patTwice = () => {
    const av = findNode(petting.component({}), n => n.props?.className === 'dshpet-avatar')
    av.props.onClick({ stopPropagation: () => {} })
  }
  patTwice()
  const p1 = petting.readState()
  assert.equal(p1.lastAct, 'pat')
  assert.equal(p1.patKey, 1)
  assert.ok(linesOf('pat').includes(p1.bubble.text), '第一下应当说日常那套摸头台词')
  assert.ok(
    findNode(cardOf(petting.component), n => n.props?.className === 'dshpet-patted') !== null,
    '摸头那一下应当把头像按扁',
  )
  // 连着摸换一套「还要吗」的台词。
  Date.now = () => T6 + 2000
  patTwice()
  Date.now = () => T6 + 4000
  patTwice()
  const p3 = petting.readState()
  assert.equal(p3.patKey, 3, '每一下都该换 key，否则第二下的动画不重播')
  assert.ok(linesOf('pat_more').includes(p3.bubble.text), '连着摸应当换一套台词: ' + p3.bubble.text)

  // 眼睛跟鼠标：全程不进 React 状态，偏移直接写在 .dshpet-root 的自定义属性上。
  /** 现在挂着几个 pointermove 监听（拖动那套也在里面，所以只看增量）。 */
  const moveListeners = () => windowListeners.get('pointermove')?.size ?? 0
  /** 跑一遍某份实例的 useEffect（桩件只收集不执行）。 */
  const runEffects = (component) => {
    const from = effects.length
    component({})
    const realSetInterval = globalThis.setInterval
    globalThis.setInterval = () => 0
    try {
      for (const fn of effects.slice(from)) fn()
    } finally {
      globalThis.setInterval = realSetInterval
    }
  }
  const eyes = bootAt(T6, dimSave())
  const beforeEyes = moveListeners()
  runEffects(eyes.component)
  assert.ok(moveListeners() > beforeEyes, '应当挂一个 pointermove 监听')
  // 头像中心 = (1320+15, 800+15)；指针在它右下 (300, 400) 处，距离 500，
  // 幅度封在 1.6px → (0.96, 1.28)。归一化过，所以偏移只表示「往哪儿看」。
  eyeVars.clear()
  const realSetTimeout = globalThis.setTimeout
  const recenters = []
  globalThis.setTimeout = (fn) => { recenters.push(fn); return 0 }
  try {
    fireWindow('pointermove', { clientX: 1635, clientY: 1215 })
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  assert.equal(eyeVars.get('--dshpet-eye-x'), '0.96px', '横向偏移不对')
  assert.equal(eyeVars.get('--dshpet-eye-y'), '1.28px', '纵向偏移不对')
  assert.ok(recenters.length > 0, '停下来之后应当安排一次回正')
  for (const fn of recenters) fn()
  assert.equal(eyeVars.get('--dshpet-eye-x'), '0.00px', '鼠标停一会儿眼睛该回正')
  assert.equal(eyeVars.get('--dshpet-eye-y'), '0.00px')
  assert.ok(CSS_TEXT.includes('--dshpet-eye-x'), '瞳孔得真的读到这个变量')

  // 关了就不挂监听（不是挂上再判断）。
  storage.set(CONFIG_KEY, JSON.stringify({ careEnabled: false, eyeTrackEnabled: false }))
  const noEyes = bootAt(T6, dimSave())
  const beforeOff = moveListeners()
  runEffects(noEyes.component)
  assert.equal(moveListeners(), beforeOff, '关了 eyeTrackEnabled 就不该挂监听')

  // 开了「减少动效」同理：监听不挂、小动作也不排。CSS 里那条 @media 只管把
  // 动画关掉，白跑一趟的回调得靠这里挡住。
  storage.set(CONFIG_KEY, JSON.stringify({ careEnabled: false }))
  globalThis.window.matchMedia = () => ({ matches: true })
  try {
    const calm = bootAt(T6, dimSave())
    const beforeCalm = moveListeners()
    const calmTick = tickerOf(calm.component)
    assert.equal(moveListeners(), beforeCalm, '开了减少动效就根本不该挂监听')
    Date.now = () => T6 + 13000
    calmTick()
    assert.equal(calm.readState().idleAct, null, '开了减少动效就不该演小动作')
  } finally {
    delete globalThis.window.matchMedia
  }

  // moodDimsEnabled: false 退回没有这条玩法的样子。
  storage.set(CONFIG_KEY, JSON.stringify({ careEnabled: false, moodDimsEnabled: false }))
  const off = bootAt(T6, dimSave({
    pet: { hunger: 40, exp: 0, level: 3, mood: 80, energy: 80, curiosity: 90 },
  }))
  off.feed(callEvent('web_fetch', { url: 'x' }, 'z1'))
  assert.equal(off.readState().pet.curiosity, 90, '关了就不该再涨')
  assert.equal(cardOf(off.component).props['data-dim'], undefined, '关了脸上就不该写情绪')
  const offBadge = findNode(off.component({}), n => n.props?.className === 'dshpet-badge-btn')
  offBadge.props.onClick({ stopPropagation: () => {} })
  assert.equal(
    findNode(
      findNode(off.component({}), n => n.props?.className === 'dshpet-panel'),
      n => n.props?.className === 'dshpet-sub dshpet-dims',
    ), null,
    '关了面板里也不该有那一行',
  )

  // 落盘往返：三维原样回来，存档版本号不动（和 0.2.0 / 0.3.0 加字段同一条约定）。
  storage.set(CONFIG_KEY, JSON.stringify({ careEnabled: false }))
  const trip = bootAt(T6, dimSave({
    pet: { hunger: 40, exp: 0, level: 3, mood: 80, energy: 80, curiosity: 61, pride: 12, concern: 3 },
  }))
  fireWindow('pagehide')
  const tripSaved = JSON.parse(storage.get(STATE_KEY))
  assert.equal(tripSaved.v, 2, '存档版本号')
  assert.equal(tripSaved.pets[tripSaved.activePetId].pet.curiosity, 61, '三维要落盘')
  const tripBack = bootFresh().readState().pet
  assert.deepEqual(
    [tripBack.curiosity, tripBack.pride, tripBack.concern], [61, 12, 3],
    '三维应当原样回来',
  )
  void trip

  // 新部件都得有样式，而且「减少动效」时也在关掉的名单里。
  for (const cls of ['.dshpet-whale-pupil', '.dshpet-whale-brow', '.dshpet-patted']) {
    assert.ok(CSS_TEXT.includes(cls), cls + ' 没有对应样式')
  }
  for (const act of IDLE_ACT_NAMES) {
    assert.ok(CSS_TEXT.includes('[data-idle=' + act + ']'), act + ' 没有对应样式')
  }
  for (const kf of ['dshpet-brow-in', 'dshpet-pat-squish', 'dshpet-idle-yawn', 'dshpet-idle-roll']) {
    assert.ok(CSS_TEXT.includes('@keyframes ' + kf), kf + ' 没有 keyframes')
  }
  const calmBlock = CSS_TEXT.slice(CSS_TEXT.indexOf('prefers-reduced-motion'))
  for (const cls of ['.dshpet-whale-brow', '.dshpet-patted', '[data-idle=yawn]', '.dshpet-whale-pupil']) {
    assert.ok(calmBlock.includes(cls), '减少动效时应当也关掉 ' + cls)
  }
  assert.ok(
    calmBlock.includes('.dshpet-whale-brow{opacity:1}'),
    '眉毛的动画是 both，关掉动画得显式写回可见，否则它会停在透明态',
  )

  storage.delete(CONFIG_KEY)
  storage.delete(STATE_KEY)
} finally {
  Date.now = dimClock
}

// ---- 进化系统：Lv.10 按主技能分化 ----------------------------------------

// 和「等级形态」一节同一个理由排在后面：这一节要靠存档摆等级与技能，而重启出来
// 的实例会跟着 pagehide 抢着落盘。
const morphClock = Date.now
try {
  const T6 = T + 6 * 86400000
  const MORPH_DAY = dayIndexOf(T6)

  /**
   * 一份「养到位了」的存档：等级 / 技能等级 / 已有形态按用例给，其余摆成不碍事
   * 的样子 —— 成就与今日任务先标成拿过了，免得它们的强制台词抢走变身那一句。
   * @param level - 宠物等级。
   * @param levels - 要抬的技能等级（没写的那几门就是 Lv.1）。
   * @param pet - 覆盖到 pet 上的字段（塞脏 form 的用例要用）。
   */
  function morphSave(level, levels, pet) {
    const skills = {}
    for (const key of ['coding', 'research', 'writing', 'debug']) {
      skills[key] = { xp: 0, level: levels[key] === undefined ? 1 : levels[key] }
    }
    return {
      pet: Object.assign({ hunger: 20, exp: 0, level, mood: 80, energy: 75 }, pet),
      totalFeeds: 30, totalTokens: 40000, snacks: SNACK_MAX,
      tokensBySource: { user_input: 10000, generation: 20000, tool_result: 10000 },
      achievements: ['first_feed', 'gourmet'],
      daily: {
        day: MORPH_DAY, feeds: 0, tools: 0, bestCombo: 0, pats: 0, tokens: 0, snacks: 0, done: ['feeds', 'tools', 'combo', 'feeds20', 'feeds5', 'pats5', 'pats15', 'tok10k', 'tok50k', 'tools15', 'snacks3', 'combo10'],
      },
      streakDay: MORPH_DAY, streakCount: 1, lastFeedAt: T6,
      skills,
    }
  }

  /** 卡片 / 头像 / 名字行 / tooltip 一次掏齐（头像照旧是第一个函数类型的节点）。 */
  function viewOf(boot) {
    const card = cardOf(boot.component)
    const node = findNode(card, n => typeof n.type === 'function')
    return {
      card,
      node,
      whale: node.type(node.props),
      name: findNode(card, n => n.props?.className === 'dshpet-name')
        .children.filter(c => typeof c === 'string').join(''),
      stage: card.props['data-stage'],
      title: card.props.title,
    }
  }

  /** 四类活各来一个代表工具（技能那条路是 tool/call 推的，不是喂食）。 */
  const TOOL_ARGS = {
    edit: { file_path: 'C:\\code\\deepseek-pet\\lib\\client.js' },
    grep: { pattern: 'whale' },
    todo_write: {},
    bash: { command: 'ls' },
  }
  let callSeq = 0
  /**
   * 起一份实例，再调一次工具 —— 分化的两个条件分头由喂食（等级）与工具（技能）
   * 推动，这一节走的是工具那条路。
   */
  function morphRun(level, levels, tool = 'edit', pet = undefined) {
    const boot = bootAt(T6, morphSave(level, levels, pet))
    callSeq += 1
    boot.feed(callEvent(tool, TOOL_ARGS[tool], 'mf' + callSeq))
    return boot
  }
  const morphFxOf = boot => boot.readState().effects.filter(e => e.source === 'morph')

  // 老存档（根本没有 form 这个字段）读进来就是「还没分化」，等级 / 技能一个不丢。
  const legacy = bootAt(T6, morphSave(10, { coding: 5 }))
  assert.equal(legacy.readState().pet.form, '', '老存档应当兜底成没进化')
  assert.equal(legacy.readState().skills.coding.level, 5, '技能等级不该被顺手洗掉')
  assert.equal(cardOf(legacy.component).props['data-stage'], 'legend', '没事件推动时先按等级长')

  // 门槛两道：等级到 evolveMinLevel，且有**唯一**一门技能到 evolveMinSkillLevel。
  const GATE = [
    { why: 'Lv.9 还差一级', level: 9, levels: { coding: 6 }, stage: 'adult' },
    { why: '四门都平（新宠物就是四门 Lv.1）', level: 10, levels: {}, stage: 'legend' },
    { why: '两门并列第一', level: 10, levels: { coding: 6, debug: 6 }, stage: 'legend' },
    { why: '唯一最高但没到 Lv.5', level: 10, levels: { coding: 4 }, stage: 'legend' },
    { why: '唯一最高且到了 Lv.5', level: 10, levels: { coding: 5 }, stage: 'cat' },
  ]
  for (const row of GATE) {
    const boot = morphRun(row.level, row.levels)
    const got = viewOf(boot)
    assert.equal(got.stage, row.stage, `${row.why}：形态应当是 ${row.stage}，实际 ${got.stage}`)
    assert.equal(
      boot.readState().pet.form, row.stage === 'cat' ? 'cat' : '',
      `${row.why}：pet.form 不对`,
    )
    assert.equal(
      morphFxOf(boot).length, row.stage === 'cat' ? 1 : 0,
      `${row.why}：变身特效的条数不对`,
    )
  }

  // 四门技能各对一种形态，一例都不能串。
  const FORM_ROWS = [
    { skill: 'coding', tool: 'edit', key: 'cat', label: '代码猫', icon: '🐱' },
    { skill: 'research', tool: 'grep', key: 'fox', label: '探索狐', icon: '🦊' },
    { skill: 'writing', tool: 'todo_write', key: 'bird', label: '文鸟', icon: '🐦' },
    { skill: 'debug', tool: 'bash', key: 'bug', label: '调试虫', icon: '🪲' },
  ]
  // 进化形态没有专属 APNG 素材：图面回退到传说档鲸鱼，尺寸与名称仍按形态。
  let catBoot = null
  let avatarOf = null
  for (const row of FORM_ROWS) {
    const boot = morphRun(10, { [row.skill]: 5 }, row.tool)
    const got = viewOf(boot)
    if (row.key === 'cat') { catBoot = boot; avatarOf = got.node.type }
    assert.equal(got.stage, row.key, `${row.skill} 领先应当分化成 ${row.key}，实际 ${got.stage}`)
    assert.equal(boot.readState().pet.form, row.key, `${row.key}：pet.form 应当写上`)
    assert.equal(
      got.name, `大肥鱼 · Lv.10 ${row.label}`, `${row.key} 的名字行不对: ${got.name}`,
    )
    assert.match(
      ariaOf(got.whale), new RegExp(row.label),
      `${row.key} 的 aria-label 应当写着形态名`,
    )
    // 进化是终点：tooltip 写着当前形态，但不再指下一档。
    assert.match(got.title, new RegExp('形态 ' + row.label), 'tooltip 应当写着形态: ' + got.title)
    assert.doesNotMatch(got.title, /→ Lv\./, '进化过就没有下一档了: ' + got.title)
    // 变身那一条特效：彩虹大字 + 形态图标 + 就地飘（不从会话区飞）。
    const fx = morphFxOf(boot)
    assert.equal(fx.length, 1, `${row.key} 应当只飘一条变身特效`)
    assert.equal(fx[0].text, '进化 · ' + row.label, `${row.key} 的变身文案不对: ${fx[0].text}`)
    assert.equal(fx[0].tier, 'epic', '变身蹭进阶那套彩虹大字')
    assert.equal(fx[0].icon, row.icon, `${row.key} 的图标不对: ${fx[0].icon}`)
    assert.equal(fx[0].flight.across, false, '变身特效就地飘')
    assert.equal(boot.readState().bubble.kind, 'morph', '变身应当强插一句台词')
    // 进化形态共用传说档精灵：三层 img 都在，且图面回退到 legend 档。
    for (const cls of ['dshpet-whale-sprite', 'dshpet-sprite-eat', 'dshpet-sprite-pat']) {
      assert.ok(
        findNode(got.whale, n => typeof n.props?.className === 'string' && n.props.className.includes(cls)) !== null,
        `${row.label} 缺精灵层: ${cls}`,
      )
      assert.ok(CSS_TEXT.includes('.' + cls), `${cls} 没有对应样式`)
    }
    assert.ok(
      srcOf(got.whale).indexOf('-legend-') !== -1,
      `${row.label} 的图面应当回退到传说档鲸鱼`,
    )
  }

  // 状态切换在进化形态上同样生效：兴奋 / 睡 / 饿 / 平时是四张不同的动图。
  for (const row of FORM_ROWS) {
    const props = { level: 10, form: row.key, dim: null }
    const frames = [
      { tier: 'epic' }, { tier: 'normal', asleep: true },
      { tier: 'normal', hungry: true }, { tier: 'normal' },
    ].map(extra => srcOf(avatarOf(Object.assign({}, props, extra))))
    assert.equal(
      new Set(frames).size, 4,
      `${row.label} 的兴奋 / 睡 / 饿 / 平时应当是四张不同的动图，实际 ${new Set(frames).size} 张`,
    )
    // 睡着时底座切睡眠态动图。
    const asleep = avatarOf(Object.assign({}, props, { tier: 'normal', asleep: true }))
    assert.ok(
      srcOf(asleep).indexOf('-sleep.apng') !== -1,
      `${row.label} 睡着时应当用睡眠态动图`,
    )
  }

  // 变身动画：白光那一层跟着 source==="morph" 的特效来，整只宠物同时缩放一下。
  const catCard = viewOf(catBoot).card
  assert.ok(
    findNode(catCard, n => n.props?.className === 'dshpet-morph') !== null,
    '变身时头像上应当有一层白光',
  )
  assert.ok(
    findNode(catCard, n => n.props?.className === 'dshpet-morphing') !== null,
    '变身时整只宠物应当跟着缩放一下',
  )
  assert.ok(CSS_TEXT.includes('.dshpet-morph{'), '.dshpet-morph 没有对应样式')
  assert.ok(CSS_TEXT.includes('@keyframes dshpet-morph{'), '白光没有 keyframes')
  assert.ok(CSS_TEXT.includes('@keyframes dshpet-morph-pop{'), '缩放没有 keyframes')
  const morphCalm = CSS_TEXT.slice(CSS_TEXT.indexOf('prefers-reduced-motion'))
  for (const cls of ['.dshpet-morph', '.dshpet-morphing']) {
    assert.ok(morphCalm.includes(cls), '减少动效时应当也关掉 ' + cls)
  }
  assert.ok(
    morphCalm.includes('.dshpet-morph{opacity:0}'),
    '白光的动画是 both，关掉动画得显式收进透明态，否则它会留一块白盖住宠物',
  )

  // 一次定终身：变身之后主技能被别人超过去，形态也不再动。
  storage.set(CONFIG_KEY, JSON.stringify({ skillXpPerLevel: 1 }))
  const settled = bootAt(T6, morphSave(10, { coding: 5, debug: 4 }))
  settled.feed(callEvent('edit', TOOL_ARGS.edit, 'ms1'))
  assert.equal(settled.readState().pet.form, 'cat', '这一次工具调用就该当场变身')
  for (let i = 0; i < 12; i += 1) settled.feed(callEvent('bash', TOOL_ARGS.bash, 'ms' + (i + 2)))
  const settledState = settled.readState()
  assert.ok(
    settledState.skills.debug.level > settledState.skills.coding.level,
    `这一串调试应当把 debug 顶到唯一最高，实际 debug ${settledState.skills.debug.level}`
    + ` / coding ${settledState.skills.coding.level}`,
  )
  assert.equal(settledState.pet.form, 'cat', '进化只有一次，不该跟着技能榜换来换去')
  assert.equal(morphFxOf(settled).length, 1, '不该再飘第二条变身特效')
  assert.equal(cardOf(settled.component).props['data-stage'], 'cat', '卡片上也该还是猫')
  storage.delete(CONFIG_KEY)

  // 喂食那条路：pet 是逐字段重建的，升级也不该把 form 弄丢。
  const fed = morphRun(10, { coding: 5 }, 'edit', { exp: 999 })
  assert.equal(fed.readState().pet.form, 'cat')
  clickSnack(fed.component)
  const fedState = fed.readState()
  assert.equal(fedState.pet.level, 11, '这一口零食应当把等级顶到 11')
  assert.equal(fedState.pet.form, 'cat', 'feedPet 重建 pet 时不该把 form 清成空')
  assert.equal(cardOf(fed.component).props['data-stage'], 'cat', 'Lv.11 也还是猫，不是传说金鲸')

  // 落盘往返：form 要进存档，而且加这个字段不该动版本号。
  const trip = morphRun(10, { research: 5 }, 'grep')
  assert.equal(trip.readState().pet.form, 'fox')
  fireWindow('pagehide')
  const tripDoc = JSON.parse(fakeLocalStorage.getItem(STATE_KEY))
  assert.equal(tripDoc.v, 2, '存档版本号')
  assert.equal(tripDoc.pets[tripDoc.activePetId].pet.form, 'fox', 'form 应当落盘')
  assert.equal(bootFresh().readState().pet.form, 'fox', '重启回来还是狐狸')

  // 存档里的 form 是外来数据：认不出来的一概当成没进化，而不是拿去渲染。
  for (const bad of ['dragon', 'constructor', 5, null, { key: 'cat' }]) {
    const dirty = bootAt(T6, morphSave(10, {}, { form: bad }))
    assert.equal(
      dirty.readState().pet.form, '', `脏 form ${JSON.stringify(bad)} 应当被洗成没进化`,
    )
    assert.equal(
      cardOf(dirty.component).props['data-stage'], 'legend',
      `脏 form ${JSON.stringify(bad)} 不该被拿去渲染`,
    )
  }

  // 开关：关了就停在传说金鲸，一条特效不飘、form 也不写。
  storage.set(CONFIG_KEY, JSON.stringify({ evolveEnabled: false }))
  const off = morphRun(10, { coding: 5 })
  assert.equal(off.readState().pet.form, '', 'evolveEnabled:false 时不该写 form')
  assert.equal(morphFxOf(off).length, 0, '关了就不该飘变身特效')
  assert.equal(cardOf(off.component).props['data-stage'], 'legend', '关了就停在传说金鲸')
  storage.delete(CONFIG_KEY)
  storage.delete(STATE_KEY)
} finally {
  Date.now = morphClock
}

console.log('smoke: OK —', live.totalFeeds, '次喂食, Lv.' + live.pet.level,
  '累计', live.totalTokens, 'token, 饱食', 100 - live.pet.hunger,
  '/ 存档', savedRaw.length, '字节')

// 断言跑完就收工：产物里那些面向浏览器的定时器（BUFF 收尾、气泡消失、合并写）
// 在 node 里会把事件循环吊住十几秒，等它们自然到点纯属浪费。
process.exit(0)
