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
const ANCHORS = {
  '[data-conversation-scroll]': fakeElement({ left: 260, top: 60, right: 1160, bottom: 860, width: 900, height: 800 }),
  '.dshpet-avatar': fakeElement({ left: 1320, top: 800, right: 1350, bottom: 830, width: 30, height: 30 }),
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
  const freshMod = loaded[0].factory(specifier => {
    if (specifier === 'react') return react
    throw new Error(`产物 require 了非平台模块: ${specifier}`)
  })
  freshMod.apply({
    effect: (fn) => { fn() },
    conversationEvents: { register: () => () => {} },
    slots: {
      inject: (name, callback) => { callback() },
      register: (options, component) => { freshOverlay = { options, component }; return () => {} },
    },
  })
  assert.ok(freshOverlay !== null, '重启的实例也应当注册 overlay')
  return {
    component: freshOverlay.component,
    readState: () => stateOf(freshOverlay.component),
  }
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
  assert.ok(effect.foodAmount >= 1 && effect.foodAmount <= 30, `食物量越界: ${effect.foodAmount}`)
  assert.ok(effect.expAmount >= 1)
  assert.ok(['tiny', 'small', 'large', 'feast'].includes(effect.foodTier), `档位非法: ${effect.foodTier}`)
  assert.equal(typeof effect.tokens, 'number')
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

// 头像是内联 SVG 的二次元鲸鱼；epic 连击时换星星眼 + 闪光。
const avatar = findNode(tree, n => n.props?.className === 'dshpet-avatar')
assert.ok(avatar !== null, '头像应当在渲染树里')
const whaleEl = findNode(avatar, n => typeof n.type === 'function')
assert.ok(whaleEl !== null, 'petAvatar=whale 时头像里应当是组件而不是 emoji')
assert.equal(whaleEl.props.tier, 'epic', '此刻应当是 epic 连击')
const whale = whaleEl.type(whaleEl.props)
assert.equal(whale.type, 'svg')
assert.equal(whale.props.className, 'dshpet-whale')
// 喷水柱 / 背鳍 / 王冠是按等级形态开关的（此刻是 Lv.1~2 幼崽，还不会喷水），
// 所以不在这个"恒在"清单里 —— 它们在文末的「等级形态」小节逐档断言。
for (const cls of ['dshpet-whale-body', 'dshpet-whale-tail', 'dshpet-whale-fin',
  'dshpet-whale-eyes', 'dshpet-whale-mouth', 'dshpet-whale-blush']) {
  assert.ok(findNode(whale, n => n.props?.className === cls) !== null, `缺部件: ${cls}`)
  assert.ok(CSS_TEXT.includes('.' + cls), `${cls} 没有对应样式`)
}
assert.ok(
  findNode(whale, n => n.props?.className === 'dshpet-whale-sparkle') !== null,
  'epic 时应当有闪光',
)
const calmWhale = whaleEl.type({ tier: 'normal' })
assert.equal(
  findNode(calmWhale, n => n.props?.className === 'dshpet-whale-sparkle'), null,
  'normal 时不应当有闪光',
)
assert.notEqual(
  findNode(calmWhale, n => n.props?.className === 'dshpet-whale-mouth').props.d,
  findNode(whale, n => n.props?.className === 'dshpet-whale-mouth').props.d,
  'epic 的嘴型应当和平时不同',
)

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

// ---- 食物模型体现 token 消耗量 -------------------------------------------

/** 喂一条 generation 事件，返回它产生的那条特效 + 当时的连击数。 */
function feedTokens(tokens) {
  dispatch(assistantEvent(tokens))
  const snapshot = overlayState()
  return { effect: snapshot.effects.at(-1), combo: snapshot.comboCount }
}

/** 产物里的食物量公式，照抄一份用来核对曲线本身。 */
const expectFood = (tokens, combo) => Math.min(30, Math.max(1,
  Math.floor(2.5 * Math.log2(1 + tokens / 60) + 0.5) + Math.floor(combo / 2)))

// 四个量级：曲线值对得上、严格递增、档位分别是 tiny/small/large/feast。
const LADDER = [20, 200, 2000, 20000]
const TIERS = ['tiny', 'small', 'large', 'feast']
const rungs = LADDER.map(feedTokens)
rungs.forEach((rung, i) => {
  assert.equal(rung.effect.tokens, LADDER[i], `token 数应当原样带到特效上`)
  assert.equal(
    rung.effect.foodAmount, expectFood(LADDER[i], rung.combo),
    `${LADDER[i]} token 的食物量应当是 ${expectFood(LADDER[i], rung.combo)}，实际 ${rung.effect.foodAmount}`,
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
const splitEffect = splitState.effects.at(-1)
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
const mouthOf = whale => findNode(whale, n => n.props?.className === 'dshpet-whale-mouth').props.d

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
const snackEffect = afterSnack.effects.at(-1)
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
    mouthOf(hungryWhaleEl.type(hungryWhaleEl.props)), mouthOf(calmWhale),
    '饿脸的嘴型应当和平时不同',
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
assert.equal(savedDoc.v, 1, '存档应当带版本号')
assert.equal(typeof savedDoc.savedAt, 'number', '存档应当带时间戳')
assert.equal(savedDoc.pet.level, live.pet.level)
assert.equal(savedDoc.pet.hunger, live.pet.hunger)
assert.equal(savedDoc.pet.exp, live.pet.exp)
assert.equal(savedDoc.totalFeeds, live.totalFeeds)
assert.equal(savedDoc.totalTokens, live.totalTokens)
assert.deepEqual(savedDoc.tokensBySource, live.tokensBySource)
assert.equal(savedDoc.snacks, live.snacks, '零食格数也要落盘，否则刷新就是白送 5 格')
// 转瞬即逝的东西不该进存档，形象也不该（那是配置说了算）。
assert.equal(savedDoc.effects, undefined, 'effects 不该进存档')
assert.equal(savedDoc.comboCount, undefined, 'combo 不该进存档')
assert.equal(savedDoc.pet.name, undefined, '名字跟配置走，不进存档')

// 别的标签页写了新存档 → 本标签页跟着走（同一个 localStorage，后写为准）。
fireWindow('storage', {
  key: STATE_KEY,
  newValue: JSON.stringify({
    v: 1, savedAt: Date.now(),
    pet: { hunger: 42, exp: 7, level: 9, mood: 80, energy: 75 },
    totalFeeds: 99, totalTokens: 88888, snacks: 2,
    tokensBySource: { user_input: 1, generation: 2, tool_result: 3 },
  }),
})
const synced = overlayState()
assert.equal(synced.pet.level, 9, '应当采纳别的标签页的存档')
assert.equal(synced.totalTokens, 88888)
assert.equal(synced.snacks, 2, '零食格数也跟着别的标签页走')
assert.equal(synced.pet.name, '深深', '名字仍然来自配置，不被存档覆盖')
// 无关的键、坏数据、removeItem（newValue = null）都不该动状态。
fireWindow('storage', { key: 'unrelated', newValue: '{"v":1}' })
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
assert.equal(restored.pet.mood, 66)
assert.equal(restored.totalFeeds, 7)
assert.equal(restored.totalTokens, 1234)
assert.deepEqual(restored.tokensBySource, { user_input: 4, generation: 1200, tool_result: 30 })
assert.equal(restored.pet.hunger, 30, `离线 10 分钟应当回升 20 点饥饿，实际 ${restored.pet.hunger}`)
assert.equal(restored.pet.name, '深深', '名字来自配置而不是存档')
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
    name: findNode(card, n => n.props?.className === 'dshpet-name').children.join(''),
  }
}

/** 皮肤渐变的第一个 stop —— 四档配色互不相同，拿它当指纹。 */
const skinOf = whale => findNode(whale, n => n.props?.id === 'dshpet-whale-skin')
  .children[0].props.stopColor
/** 身体椭圆的描边：只有传说档是金色。 */
const bodyStrokeOf = whale => findNode(whale, n => n.type === 'ellipse' && n.props?.cx === 29)
  .props.stroke
const partOf = (whale, cls) => findNode(whale, n => n.props?.className === cls)

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
    got.name, `深深 · Lv.${stage.level} ${stage.label}`,
    `Lv.${stage.level} 的名字行不对: ${got.name}`,
  )
  assert.match(
    got.whale.props['aria-label'], new RegExp(stage.label),
    `Lv.${stage.level} 的 aria-label 应当写着形态名`,
  )
  // 体型走头像边长（路径坐标一个不动），viewBox 四档都一样。
  assert.equal(got.whale.props.viewBox, '0 0 64 64', 'viewBox 不该跟着形态变')
  assert.equal(
    got.whale.props.style.height, got.whale.props.style.width, '头像应当是正方形',
  )
  sizes.push(Number.parseInt(got.whale.props.style.width, 10))
  seenSkin.add(skinOf(got.whale))
  assert.equal(
    partOf(got.whale, 'dshpet-whale-spout') !== null, stage.spout,
    `${stage.label} 的喷水柱该有/该没有`,
  )
  assert.equal(
    partOf(got.whale, 'dshpet-whale-dorsal') !== null, stage.dorsal,
    `${stage.label} 的背鳍该有/该没有`,
  )
  assert.equal(
    partOf(got.whale, 'dshpet-whale-crown') !== null, stage.crown,
    `${stage.label} 的王冠该有/该没有`,
  )
  assert.equal(
    bodyStrokeOf(got.whale) === '#2b3f9e', !stage.crown,
    `只有传说档的描边该是金色（${stage.label}）`,
  )
  // 恒在的部件一档也不能少（前面那个清单只跑了幼崽这一档）。
  for (const cls of ['dshpet-whale-body', 'dshpet-whale-tail', 'dshpet-whale-fin',
    'dshpet-whale-eyes', 'dshpet-whale-mouth', 'dshpet-whale-blush']) {
    assert.ok(partOf(got.whale, cls) !== null, `${stage.label} 缺部件: ${cls}`)
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

console.log('smoke: OK —', live.totalFeeds, '次喂食, Lv.' + live.pet.level,
  '累计', live.totalTokens, 'token, 饱食', 100 - live.pet.hunger,
  '/ 存档', savedRaw.length, '字节')
