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
let anchors = {
  '[data-conversation-scroll]': fakeElement({ left: 260, top: 60, right: 1160, bottom: 860, width: 900, height: 800 }),
  '.dshpet-avatar': fakeElement({ left: 1320, top: 800, right: 1350, bottom: 830, width: 30, height: 30 }),
}
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
globalThis.window = {
  __ModuleLoader__: { load: entry => { loaded.push(entry) } },
  localStorage: { getItem: () => null },
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

/** 造一条 tool/result 事件。 */
const toolEvent = size => ({
  type: 'tool/result', seq: ++seq, time: now(),
  data: {
    turn: 1, step: 1,
    message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'x'.repeat(size) }] }] },
  },
})

/** 把一条事件送进 Definition，模拟引擎的 match → start。 */
function dispatch(event) {
  const match = registered.match(event)
  if (match === null) return null
  assert.equal(match.role, 'start')
  const state = registered.start({ state: undefined, matches: [] }, { event, view: undefined }, {})
  assert.deepEqual(state, { seq: event.seq })
  return match
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

// combo 1：用户输入 400 字 ≈ 100 tokens → food = clamp(100/100*1.2+0.5)=1，exp = 1*1.2+0.5 → 1
const first = userEvent('字'.repeat(400))
dispatch(first)

// combo 2：generation 1000 output tokens → food = 1000/100*1.4+0.5 = 14.5 → 14
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

/** 从 overlay 组件里把 store 的当前状态读出来（组件的第一个 useState 初值就是快照）。 */
function overlayState() {
  let captured
  const original = react.useState
  react.useState = (initial) => {
    if (captured === undefined) captured = initial
    return [initial, () => {}]
  }
  try {
    overlay.component({})
  } finally {
    react.useState = original
  }
  return captured
}

const state = overlayState()
assert.equal(state.comboCount, 10, 'combo 应当在第 10 次封顶')
assert.equal(Number(state.comboMultiplier.toFixed(1)), 3, '倍率上限 3.0x')
assert.equal(state.comboTier, 'epic')
assert.equal(state.totalFeeds, 10)
assert.ok(state.pet.hunger < 60, 'hunger 应当被喂下来')
assert.ok(state.pet.level >= 1)
assert.ok(state.effects.length > 0, '应当有活跃特效')
for (const effect of state.effects) {
  assert.ok(effect.foodAmount >= 1 && effect.foodAmount <= 15, `食物量越界: ${effect.foodAmount}`)
  assert.ok(effect.expAmount >= 1)
  assert.ok(['🥕', '🐟', '🍖'].includes(effect.icon))
}

// ---- 食物的飞行轨迹 ------------------------------------------------------

// 起点应当量到会话区里、终点是宠物头像；上面的假矩形里会话区在宠物左上方。
// fromX ∈ [260+900×0.34, 260+900×0.66] = [566, 854]，头像中心 x = 1335 → dx < 0
// fromY = 860 - min(120, 800×0.22) = 740，头像中心 y = 815 → dy = -75
for (const effect of state.effects) {
  assert.equal(effect.flight.across, true, '应当量到会话锚点')
  assert.equal(effect.flight.dy, -75, `dy 应当是 -75，实际 ${effect.flight.dy}`)
  assert.ok(effect.flight.dx <= -481 && effect.flight.dx >= -769, `dx 越界: ${effect.flight.dx}`)
}
assert.ok(
  new Set(state.effects.map(e => e.flight.dx)).size > 1,
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
const fx = findNode(tree, n => n.props?.className === 'dshpet-fx')
assert.ok(fx !== null, '特效层应当在渲染树里')
const feedEl = findNode(fx, n => typeof n.type === 'function')
assert.ok(feedEl !== null, '应当渲染出 FeedEffect')
const food = findNode(feedEl.type(feedEl.props), n => n.props?.className === 'dshpet-food')
assert.ok(food !== null, '应当渲染出食物元素')
assert.equal(food.props['data-flight'], 'across')
assert.match(food.props.style['--dshpet-dx'], /^-\d+px$/)
assert.equal(food.props.style['--dshpet-dy'], '-75px')

// 没有会话打开（量不到锚点）时退回策划原本的就地飞入，而不是飞到屏幕外。
anchors = null
dispatch(userEvent('之后'))
const fallback = overlayState().effects.at(-1)
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

console.log('smoke: OK —', state.totalFeeds, '次喂食, Lv.' + state.pet.level,
  '饱食', 100 - state.pet.hunger, '活跃特效', state.effects.length)
