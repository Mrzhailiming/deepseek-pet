# dsh-pet-plugin — 插件详解

这份文档写插件**内部是怎么实现的**：接入方式、事件来源、全部可调的配置项、计算规则、宠物形象、打包校验、以及偏离策划的地方。只想知道怎么装、怎么打包、怎么玩，看 [`../README.md`](../README.md)。

策划原文：[`../pet-auto-feed-plugin-design.md`](../pet-auto-feed-plugin-design.md)。

```
deepseek-pet/
├── dsh-pet-plugin/                  插件包本体（这一整个目录就是分发单位）
│   ├── index.js                     host 半：空实现，只为成为一条活着的 Loader entry
│   ├── lib/client.js                浏览器半：手写产物，宠物 / Combo / 特效 / 鲸鱼 SVG 都在这里
│   ├── cordis.patch.yml             配置层：往 profile 里插一行 Loader 记录
│   ├── scripts/pack.mjs             打包 + 校验（零依赖）
│   ├── test/smoke.mjs               零依赖冒烟测试
│   └── plugin.md                    这份文档
├── pet-auto-feed-plugin-design.md   策划原文
└── docs/                            README 用的效果图 / 录屏
```

`lib/client.js` 是唯一有逻辑的文件（约 1700 行，含 `//#region` 分区：配置 / 样式 / 计算 / store / 视图 / 插件体）。

---

## 它是怎么接上去的

```
package.json
├── dsh.bundle  ──→ cordis.patch.yml  插入一行 Loader 记录 (id: pet-feed)
└── dsh.client  ──→ exports["./client"] = lib/client.js
                    client-modules 在启动时扫描活着的 Loader entry，
                    发现 platform: "web" 的包就把产物挂到
                    /plugins/dsh-pet-plugin/client.js 并写进 window.__DSH_BOOT__
```

- `index.js` 是 host 半，**空实现**。它存在的唯一理由是让这个包成为一条活着的 Loader entry —— `client-modules` 的扫描以此为前提。
- `lib/client.js` 是浏览器半，**手写产物**（`window.__ModuleLoader__.load({ id, factory })` 的 CJS factory 格式，与 `tsdown.client.ts` 生成的 banner/footer/intro 逐字一致）。因此这个包**没有构建步骤**：`dsh plugin add` 装完即用，不需要 tsdown、不需要联网、不需要 pnpm 的 `allowBuilds` 授权。
- 浏览器半只 `require('react')`，其余全是自带代码；样式用一个 `<style data-plugin="dsh-pet-plugin">` 标签在 factory 里注入一次。

### 事件从哪来

策划里画的「host → 前端 WebSocket Push」这条路走不通：转发白名单 `API_REMOTE_FORWARDED_EVENTS`（`packages/api/remotes/src/remote-events.ts`）是一个编译期常量数组，往里加 `pet/feed` 就必须改仓库。所以喂食桥接器整体下沉到浏览器：

插件用 `ctx.conversationEvents.register()` 注册一个 **state-only 的 Conversation Definition**（不声明 `target`，`publication` 恒为 `"none"`，不产出任何视图节点）。它的 `match(event)` 拿到的是**原始 SessionEvent**，于是三个喂食源直接可读：

| 事件 | 触发源 | token 消耗量 | 基础经验 |
|---|---|---|---|
| `user/message`（且 `source.kind === "user"`） | `user_input` | 可见文本字符数 / 4（估算） | 1 |
| `assistant/message`（且带 `usage`） | `generation` | `usage.inputTokens + usage.outputTokens`（真实） | 2 |
| `tool/result` | `tool_result` | 结果 content 的 UTF-8 字节数 / 4，最少 1（估算） | 3 |

`user/message` 只认 `source.kind === "user"`：插件注入的上下文也是 `user/message`，那不是用户输入。`assistant/message` 只在 adapter 报了 `outputTokens` 时才算一次 generation，取 **input + output** 的全量消耗——上下文越长，这一步喂出去的分量越大。另外两个源没有 `usage`，只能按长度粗估。

### 为什么不会被历史刷屏

Conversation 引擎会在打开会话、翻历史、边界解析、插件集变化时**重新折叠**同一批事件，`start` 因此会对同一条事件被反复调用。插件用一道幂等闸门兜住：

1. **新鲜度**：`Date.now() - event.time > 30s` 的事件一律不喂。打开一个旧会话时整段日志会被折叠一次，这一条挡掉了它。
2. **去重**：键取 `seq + time + type` 复合（`seq` 只在会话内单调，跨会话不可比），只保留新鲜度窗口内的键。

---

## 调参：浏览器侧配置

宠物名字、连击窗口、食物量、要不要特效……都能改。配置走 `localStorage`，在页面控制台执行后**刷新生效**：

```js
localStorage.setItem('dsh-pet-plugin/config', JSON.stringify({
  comboWindowMs: 3000,   // Combo 窗口（默认 5000）
  maxCombo: 20,          // 最大连击（默认 10，注意会抬高经验倍率上限）
  maxFood: 25,           // 单次最大食物量（默认 30）
  tokensPerFood: 30,     // 曲线起点：约等于第一份食物的 token 量（默认 60，越小吃得越多）
  foodPerDouble: 4,      // token 每翻一倍多给几份食物（默认 2.5）
  hungerRegenPerMin: 0,  // 每分钟回升的饥饿度（默认 2；0 = 只降不升）
  manualFeedEnabled: false,   // 关掉主动喂食，卡片上不再有 🍬（默认 true）
  manualFeedFood: 25,    // 一口零食顶多少饱食（默认 15）
  manualFeedExp: 0,      // 一口零食给多少经验（默认 1；0 = 不给）
  manualSnackMax: 10,    // 零食格数上限（默认 5）
  manualSnackRegenMs: 10000,  // 多久回一格零食（默认 45000；<= 0 = 永远满格）
  hungryAt: 60,          // 饥饿到多少就开始报警（默认 80，即饱食度只剩 20 以内）
  persist: false,        // 关掉进度落盘，回到刷新即重来（默认 true）
  saveDebounceMs: 3000,  // 落盘的合并写窗口（默认 1500）
  offlineRegenCapMs: 3600000, // 离线饥饿最多按多久结算（默认 86400000，即 24h）
  effectsEnabled: false, // 只留宠物卡片，关掉飞行特效（默认 true）
  effectTtlMs: 1500,     // 单条特效时长（默认 2200）
  flyFromConversation: false, // 食物就地飞入，不从会话区飞过来（默认 true）
  freshnessMs: 60000,    // 多久之内的事件才喂（默认 30000）
  petName: '球球',        // 宠物名（默认 '深深'）
  petSpecies: '史莱姆',   // 副标题的种族（默认 '深海小鲸'）
  petAvatar: 'emoji',    // 'whale'（默认）= 二次元鲸鱼；'emoji' = 用下面这个字形
  petIcon: '🐙',         // petAvatar 为 'emoji' 时的头像（默认 🐳）
}))
```

- 只写想改的字段，其余用默认值（`DEFAULTS`）。`resolveConfig` 只接受**同类型标量**覆盖：类型不匹配的字段静默忽略，非法 JSON 警告一次并整体回退默认值。所以数组 / 对象形态的配置（比如等级形态门槛）刻意没有提供，见「已知限制」。
- `enabled: false` 直接关掉整个插件（既不观察事件也不显示浮层）。
- **为什么配置不走 profile 的 yml**：`cordis.patch.yml` 里那行 Loader 记录的 `config` 是 **host 侧** entry 的配置，而这些参数是浏览器半在用的；`client-modules` 把产物挂上去时不带 entry 配置过来，浏览器半读不到。`localStorage` 是插件与浏览器之间已有的那条缝（进度落盘走的是同一条），所以配置也走它。

---

## 计算规则

```
combo.tick():  now - last > 5000ms → count = 0;  count = min(count + 1, 10);  last = now
multiplier  =  1 + 0.2 × count                          （count 已封顶 10 ⇒ 上限 3.0x）
food        =  clamp(floor(2.5 × log2(1 + tokens / 60) + 0.5) + floor(count / 2), 1, 30)
                 ↑ 主项：token 量级                        ↑ 连击加成 0..+5
exp         =  max(1, floor(baseExp × m + 0.5))
pet.feed:      hunger = max(0, hunger - food);  exp += exp;  exp ≥ level×100 时升级
             （喂之前先结算空闲期的饥饿回升：hunger += 空闲分钟数 × 2，封顶 100）
```

**食物量走对数曲线**，不是策划的线性式。线性 `tokens / 100` 配上 `[1, 15]` 的夹取等于把 token 量级抹平：1450 token 就顶格，之后 6KB 和 60KB 的工具结果一样大；反过来 20 token 和 300 token 都保底 1。改成「token 每翻一倍多给 2.5 份」之后，从几十 token 到几十万 token 全程都分得出大小：

```
tokens     20   60   120   200   500   800  2000  5000  20k   60k   200k
food        1    3     4     5     8    10    13    16   21    25     29
```

**连击对食物量改成加法**（`+floor(count/2)`，即 0..+5）：乘法的 `×3.0` 会盖过 token 量级本身的差别，让「连击密度」而不是「消耗量」成为主导项。连击**倍率仍然乘在经验上**，所以连击的存在感转移到升级速度和特效上。

Combo 视觉等级：`1-3 → normal`（白字）、`4-6 → gold`（金字 + 轻微震动 + 金色光晕）、`7-10 → epic`（彩虹渐变 + 强震 + 光环脉冲 + 大字号）。

### 食物档位：吃的东西本身体现消耗量

除了份数，**食物的图标和字号也随 token 量级变**（`foodTierOf`）。阈值取曲线上 4 / 10 / 16 份的断点：

| 档位 | tokens | 字号 | `user_input` | `generation` | `tool_result` |
|---|---|---|---|---|---|
| `tiny` | < 120 | 16px | 🌱 | 🍤 | 🍢 |
| `small` | 120 ~ 800 | 22px | 🥕 | 🐟 | 🍖 |
| `large` | 800 ~ 5000 | 30px | 🌽 | 🐠 | 🍗 |
| `feast` | ≥ 5000 | 38px + 暖色光晕 | 🍉 | 🐋 | 🍲 |

`small` 档保留三个触发源原本的 🥕/🐟/🍖，所以「看图标认触发源」这个特征没丢；档位走食物元素的 `data-size`，与管轨迹的 `data-flight` 正交（一个改字号、一个改动画名）。

### token 数直接显示

- **飘字**：`+13 🐠 · 2.0k tok  +3 ⭐`；
- **卡片**（展开时）：`消耗 12.3k tok · 🥕2.1k 🐟8.0k 🍖2.2k` —— 总量 + 三个源各自的累计；
- **tooltip**：累计喂食次数后面跟累计 token。

数字统一走 `formatTokens`（`999` / `1.2k` / `12.3k` / `1.2M`，整千不留 `.0`）。

### 饥饿回升

`hungerRegenPerMin`（默认 2）让 hunger 按空闲时长回升，封顶 100。实现是**惰性结算**：`store.feed` 在算这一口之前先把上次结算到现在的量补上，不用常驻定时器；overlay 另挂一个 10 秒的 `setInterval` 只为让空闲时的进度条也会动（挂在组件上，卸载即停）。`hunger` 始终是整数，小数部分存在 `hungerCarry` 里攒着。

设成 0 就退回策划原本的「只降不升」。

三阶段动画沿用策划给的 keyframes（仅加 `dshpet-` 前缀）：食物飞入 600ms → 宠物 `eat-bounce` 400ms → 飘字 `float-up` 1200ms（延迟 600ms 起），总时长 2200ms = 特效 TTL。策划只写了「轻微震动 / 强震」没给 keyframes，`shake-light` / `shake-strong` 是本实现补的。系统开了「减少动效」时全部动画关闭。

### 主动喂食：零食

饥饿回升开着的时候，宠物空闲久了会一路饿到 100，而**原本唯一的喂食途径是 Agent 干活** —— 不跑任务就只能看着进度条见底。所以卡片上加了一个 🍬 按钮，`store.snack()`：

```
snack():  pet = 结算饥饿回升(now);  snacks = 结算零食回格(now)
          snacks <= 0 → 落回结算结果，返回 false（按钮此时本来就是禁用的）
          pet.feed(food = 15, exp = 1);  snacks -= 1;  totalFeeds += 1
```

| 键 | 默认 | 含义 |
|---|---|---|
| `manualFeedEnabled` | `true` | 关掉就不渲染按钮，`store.snack()` 直接返回 false |
| `manualFeedFood` | `15` | 一口零食顶多少饥饿（固定值，不走 token 曲线） |
| `manualFeedExp` | `1` | 一口零食给多少经验（`0` = 不给） |
| `manualSnackMax` | `5` | 零食格数上限 |
| `manualSnackRegenMs` | `45000` | 多久回一格（`<= 0` 视为「永远满格」） |
| `hungryAt` | `80` | `hunger ≥` 这个值就算「饿了」，触发下面那组警告表现 |

- **零食库存限流**，不是冷却。格数攒在 `state.snacks` 里，`manualSnackRegenMs` 回一格，**离线期间照攒**（和饥饿回升同一套惰性结算，上限就是格数上限，不需要另设 cap）。这样出门一天回来能连点 5 口、一次 75 点把饿惨的宠物救回来，而点着不放的持续速率只有 1 exp / 45s —— 一级要 100 exp，刷不出什么。
- **不进 combo**：`snack()` 不碰 `combo.tick`。否则手点五下就能把连击顶到 ×2.0，让后面 Agent 真喂的那一口白拿倍率。手喂的飘字因此固定是 `normal` 档。
- **不进 token 统计**：`totalTokens` / `tokensBySource` 一个字节不加 —— 零食不是 Agent 的消耗，混进去会污染「消耗 xx tok」那块面板。飘字也因此不写 token 段，是 `+15 🍬  +1 ⭐` 而不是 `… · 0 tok`。
- **食物档位固定 `small`**：`foodTierOf` 那张表按 token 量级分档，而零食没有 token 可言，所以图标永远是 🍬、字号永远是 22px，也不走会话区飞行（`LOCAL_FLIGHT`，就地飞入）。
- **按钮是卡片的第三个子节点**（`[头像][meta][🍬]`），所以**折叠状态下也在、也能点**（折叠只藏 `.dshpet-meta`）。卡片本身的 `onClick` 是折叠/展开，按钮的 `onClick` 里 `stopPropagation()` 拦住冒泡，否则喂一口顺手把卡片折了。`.dshpet-snack` 要单独写 `pointer-events:auto`（`.dshpet-root` 整体是穿透的）和 `font:inherit`（`<button>` 不继承宿主字体）。
- **饿了的警告是纯表现层的**，三处 + 一个表情：`.dshpet-card[data-hungry]` 边框转红、`.dshpet-bar-full[data-low]` 把橙色换成红色、按钮 `data-urge` 上一条 1.4s 的缩放脉冲、鲸鱼把嘴型换成向下的弧且腮红变淡（`excited` 优先 —— 正被猛喂的时候不摆脸）。`dshpet-snack-urge` 也在「减少动效」的关闭名单里。

`effectsEnabled: false` 现在只关飞行特效，**宠物卡片（以及上面的喂食入口）仍然注册**。之前是把整个 overlay 的注册包在这个开关里的，和文档写的「只留宠物卡片」不一致，也会让新按钮在关特效时点不到，一并修了；飞行特效由 `feed` / `snack` 里各自那层守卫关掉。

### 进度落盘：localStorage

宠物的进度写在浏览器的 `localStorage` 里，键 `dsh-pet-plugin/state`，刷新页面不丢：

```json
{
  "v": 1,
  "savedAt": 1755400000000,
  "pet": { "hunger": 42, "exp": 137, "level": 3, "mood": 80, "energy": 75 },
  "totalFeeds": 128,
  "totalTokens": 482913,
  "tokensBySource": { "user_input": 2104, "generation": 401200, "tool_result": 79609 },
  "snacks": 3
}
```

为什么是 `localStorage`：策划把宠物状态放在后端，但**不改目标仓库**的前提下没有宿主侧的持久化接缝 —— 浏览器模块白名单里没有任何存储服务，host → 浏览器的推送通道也加不了新事件（见上文）。`localStorage` 是插件已经在用的同一条缝（配置覆盖走的就是 `dsh-pet-plugin/config`）。

几个要点：

- **只存进度，不存瞬时态**：`effects` / `comboCount` / 飞行位移都不落盘（刷新后连击本就该断），`pet.name` / `species` / 头像跟配置走，也不进存档 —— 改了 `petName` 立刻生效，不会被旧存档按住。
- **写入是合并的**：一轮工具循环里连续十几次喂食只写一次。`createPersistence` 用 `saveDebounceMs`（默认 1500）攒一下，并且比对序列化后的指纹，内容没变就不写。`pagehide` 与 `visibilitychange`（切后台时 `pagehide` 不一定来）时立刻 flush，`dispose()` 也 flush 一次，所以关标签页不会吞掉最后几口。写不进去（配额满 / 隐私模式）就静默放过，宠物照样能玩。
- **读入永远消毒**：`sanitizeSaved` 对每个字段单独做类型 + 范围检查（`hunger` 夹到 `0..100`、`level` 至少 1、`exp` 不超过 `level × 100`、计数不为负），越界的夹回来、类型不对的用默认值。同域下的别的东西（或手改控制台的人）写了同名键，最坏结果是宠物看起来奇怪，而不是插件崩掉。
- **版本号是逃生门**：`v` 与 `STATE_VERSION` 不一致就整份丢弃、当作新宠物。以后改状态结构时把版本号 +1 即可，不需要写迁移。JSON 坏了同理，只 `console.warn` 一次。**加字段不动版本号**：`snacks` 就是后加的，老存档缺这个字段走消毒时的兜底（给满格），没必要为了「多存一个数」让所有人从 Lv.1 重来。
- **离线也会饿**：启动时按 `savedAt → 现在` 的时长补一次饥饿回升（和在线时同一套惰性结算），所以出门一天回来鲸鱼是饿的。上限 `offlineRegenCapMs`（默认 24h），顺手兜住系统时钟往前跳的情况。零食格数用**同一个锚点**结算，所以离线期间饿了多少、攒了几格零食，是一起算出来的。
- **跨标签页跟随**：监听 `storage` 事件，别的标签页存了新进度就采纳（后写为准），两个标签页不会各养一只。采纳时 `lastRegenAt` 一起重置，免得把对方已经结算过的时间再算一遍。

关掉与重置：

```js
// 关掉持久化（回到纯内存态，每次刷新从 Lv.1 重来）
localStorage.setItem('dsh-pet-plugin/config', JSON.stringify({ persist: false }))
// 重新养一只
localStorage.removeItem('dsh-pet-plugin/state')
```

### 食物从会话区飞向宠物

食物不是在宠物脚边冒出来的，而是**从会话里事件实际发生的位置飞过去**：

```
喂食那一刻量两个矩形（都是 getBoundingClientRect 的视口坐标）
  起点  [data-conversation-scroll] 的底部区域   ← 新消息 / 新工具结果冒出来的地方
  终点  .dshpet-avatar 的中心
相减得到纯位移 → 写进食物元素的 --dshpet-dx / --dshpet-dy
  → keyframe dshpet-fly-across 从该位移飞回 translate(0,0)
```

- `[data-conversation-scroll]` 是 `ui-conversation` 的 `ConversationRoot` 挂的锚点，`ChatView`、`StatsLine`、`InputBar` 三处都在 `closest()` 它，也有测试覆盖，算是稳定契约。
- 位移量走 CSS 自定义属性，所以整段轨迹仍然只是**一条 CSS 动画**，没有逐帧 JS。
- 起点横向按 `(effectSeq % 5) / 4` 在会话区中段散开，连击时不会叠成一条线。
- 因为两个坐标都是视口坐标、只取差值，中间隔了几层定位上下文都不影响（`shell.overlay` 的 `.overlayLayer` 是 `position:absolute; inset:0`，既不裁剪也没有 transform，所以食物可以横穿整个界面）。
- **量不到锚点时**（没打开会话、布局宽高为 0、宿主改了这个属性名）自动退回策划原本的就地飞入 `fly-in`，而不是飞到屏幕外。这两条路径冒烟测试都覆盖了。
- `flyFromConversation: false` 可以整体关掉，退回就地飞入。

---

## 宠物形象：DeepSeek 二次元小鲸

默认宠物是 DeepSeek 的鲸鱼（`深深 / 深海小鲸`），**一整只都是内联 SVG**，画在 `lib/client.js` 的 `WhaleAvatar` 里（viewBox 恒为 `0 0 64 64`，展示边长按等级形态从 34 长到 64）。不用外链图片：插件产物是单文件 JS 塞不了资源，而 SVG 还能跟着 Combo 换表情、跟着等级换形态。

| 部件 | 做法 |
| --- | --- |
| 身体 | 圆胖椭圆 + `#8fabff → #4d6bfe → #2f4bd8` 竖向渐变（主色即 DeepSeek 品牌蓝 `#4d6bfe`），外加一圈 `#2b3f9e` 描边，赛璐璐线稿感 |
| 白肚皮 | 上沿是向上鼓的分界线、下沿沿身体轮廓的弧走（弧半径比身体小 0.7，免得盖掉下沿描边），所以是「贴在身上的肚皮」而不是浮着的白椭圆 |
| 眼睛 | 大瞳 + 两点白高光；**epic 连击时换成星星眼**（金色四芒星）并在身侧冒闪光 |
| 表情 | 平时弯嘴微笑，epic 时张成 O 型嘴 |
| 腮红 | 两坨半透明粉，进食时会「烧」一下 |
| 尾鳍 / 胸鳍 | 画在身体之下（被身体盖住接缝），各自绕自己的根部转 |
| 喷水柱 | 头顶一道细流 + 三颗水珠，循环冒出（幼崽 / 传说档没有，见下文形态表） |
| 背鳍 / 王冠 | 按等级形态出现的静态部件（成年 / 传说），见下文形态表 |

动画（全部是 CSS，没有逐帧 JS）：

| class | 动作 | 周期 |
| --- | --- | --- |
| `dshpet-whale-body` | 浮沉 + 轻微摇摆 | 3.2s 循环 |
| `dshpet-whale-tail` | 摆尾 | 1.6s 循环 |
| `dshpet-whale-fin` | 划水 | 2.4s 循环 |
| `dshpet-whale-eyes` | 眨眼（`scaleY` 压扁一瞬） | 5.2s 循环 |
| `dshpet-whale-spout` | 喷水 | 2.6s 循环 |
| `dshpet-whale-sparkle` | 闪光（仅 epic） | 1.1s 循环 |
| `dshpet-whale-mouth` / `-blush` | 张嘴 / 脸红，挂在 `.dshpet-eating` 的后代选择器上，随每次喂食重播 | 400ms / 620ms |

两个实现细节：

- SVG 里一律加 `transform-box: fill-box; transform-origin: center`（`.dshpet-whale *`），否则 `transform` 的原点是 viewBox 原点而不是部件自己，尾巴会绕着整张图转。
- 头像外层 `<span>` 的 key 跟着 `eatKey` 变，每次喂食都重挂载，所以 `eat-bounce` 和张嘴动画能重播。
- 所有鲸鱼动画都进了 `prefers-reduced-motion: reduce` 的关闭名单；喷水柱靠动画才可见，关掉动画时另给它一个静态可见态。

换回 emoji 宠物：`petAvatar: 'emoji'`，此时显示 `petIcon`（默认 🐳）。

### 按等级变形态

等级是这个插件里唯一的长期积累（`level × 100` 经验一级，越养越慢），所以让长相跟着它走：4 档形态，**每档换一处剪影**，一眼认得出养到哪一档。形态表在 `WHALE_STAGES`（常量区），`whaleStageOf(level)` 从后往前找第一个够得上的门槛。

| 档位 | 等级 | 体型（边长） | 眼睛 | 皮肤（渐变上→下） | 剪影 |
| --- | --- | --- | --- | --- | --- |
| `baby` 幼崽 | 1-2 | 34px | ×1.4 | `#e2ecff → #b3c9ff → #8aa4f0` 近乎白的淡蓝 | 还不会喷水 |
| `young` 少年 | 3-5 | 44px（原来那只） | ×1 | `#8fabff → #4d6bfe → #2f4bd8` 品牌蓝 | 喷水柱 |
| `adult` 成年 | 6-9 | 54px | ×.92 | `#6f8cff → #2740c9 → #16226e` 深蓝 | 喷水柱 + 大背鳍 |
| `legend` 传说 | 10+ | 64px | ×.92 | `#5f7cff → #1b2a8f → #0b1240` 近乎海军蓝 | 金色加粗描边 + 王冠（占了喷水口）+ 大背鳍 |

- **纯表现层**：不改经验曲线、不改食物量、不改任何数值，也**不进存档** —— 等级本来就在存档里，形态是当场算出来的。改存档里的 `pet.level` 再刷新就能直接看任一档。
- **`young` 那档就是原来那只**：老用户升到 Lv.3 之前会看到一只小一号的幼崽，之后回到熟悉的样子，不会觉得「我的鲸鱼被换了」。
- **体型直接改头像边长**（`stage.size` 写成 svg 的内联 `width/height`，覆盖 `.dshpet-whale` 的 44px），viewBox 四档都是 `0 0 64 64`，所以一个路径坐标都不用动，卡片跟着头像一起长高。第一版是缩 viewBox（`-5 -5 74 74` ~ `3 3 58 58`），四档只差 13%，摆在一起根本看不出来 —— **区分度这件事上，几个像素等于没变**。也不能走 `transform`：`.dshpet-whale-body` 上挂着浮沉动画，往同一个节点写 `transform` 会被动画覆盖。
- **配色跨度拉到底**：从「近乎白」到「近乎海军蓝」，连胸鳍的填充也跟着走 `skin[2]`。只在四种蓝里挪色相是分不出来的，得靠明度。
- **王冠占了喷水口**：三尖冠的底边正好落在头顶喷水的位置，所以传说档 `spout: false` —— 两个都画会糊成一团。背鳍插在身体椭圆**之前**（和尾鳍 / 胸鳍一样），根部被身体盖住才像从背上长出来的；它和王冠都刻意做得大（背鳍约占半个身高），小一号就等于没加。
- **进阶只在跨档时飘**：`appendEvolve` 比较喂食前后的形态，跨了才走一遍现成的特效管道 —— 一条 `source: 'evolve'` 的特效（`epic` 档的彩虹大字，文案「进阶 · 成年」）+ 头像外面一圈 1.4s 的金环 `.dshpet-evolve`。普通升级（Lv.6→7）不飘，否则前期每喂几口就来一次，很快就成噪音。手喂的那一口也算数（`snack()` 同样调 `appendEvolve`）。
- **金环不占状态**：它是从 `state.effects` 里那条进阶特效算出来的，特效被 `dropEffect` 撤掉环就跟着消失，动画 `both` 收在透明态所以不会闪回。它也在「减少动效」的关闭名单里。
- **通知类飘字**：`FeedEffect` 见到 `effect.text` 就直接飘这整句，不拼 `+N 食物 · X tok +M ⭐`（进阶没有食物量可报）。这也是给以后别的通知类特效留的口子。
- 形态名进**名字行**（`深深 · Lv.6 成年`）、**tooltip**（`形态 成年 → Lv.10 传说`，最高档没有箭头那段）、**卡片的 `data-stage`**（留给 CSS 的钩子）与鲸鱼的 `aria-label`。
- **`petAvatar: 'emoji'` 不受影响**：图标是用户自己配的字形，插件不擅自按等级换。形态名 / tooltip / `data-stage` / 进阶特效仍然有效。

---

## 冒烟测试覆盖什么

```sh
node test/smoke.mjs
```

用桩件（假 React、假 `__ModuleLoader__`、假 `ctx`、能量矩形的假 DOM）把产物跑起来，喂一串假的 `SessionEvent`，断言：

- Combo 封顶在 10、倍率上限 3.0x、食物量落在 `[1, 30]`；
- **食物模型体现 token 消耗量**：20 / 200 / 2000 / 20000 token 的食物量与曲线逐个对得上、严格递增、档位分别是 `tiny/small/large/feast` 且四个图标互不相同；`1800 + 200` 与纯 `2000` output 等价（证明 input 计入）；累计 token 等于三个源之和；食物元素带上了 `data-size`、飘字里有 token 数、累计面板那一行在渲染树里；
- **饥饿回升**：把 `Date.now` 前推 30 分钟后 hunger 从 0 回升，且不超过 `30 × 2` 减掉这一口；
- **主动喂食**：点一下按钮正好顶 15 点饥饿、`totalFeeds` +1、库存 -1、给 1 点经验，而 `totalTokens` / `tokensBySource` / `comboCount` **一个都没变**（这三条最容易写错）；特效是 🍬 + `tokens: 0` + `small` 档 + 就地飞入，飘字里**不含** `tok`；连点到 0 后按钮 `disabled` 且再点也喂不进去，前推 45 秒又能点一次；前推 60 分钟饿到 80 以上时卡片 `data-hungry`、饱食条 `data-low`、按钮 `data-urge` 与耷脸嘴型都在（且都有对应 CSS），喂回去之后三个标记一起消失；`manualFeedEnabled: false` 时按钮不渲染而卡片还在，`effectsEnabled: false` 时按钮和卡片都还在；
- **持久化**（localStorage 桩是真存东西的 Map）：`pagehide` 时落盘且存档内容与内存状态逐字段一致、瞬时态没进存档；用同一份 localStorage 重启一个实例后进度回来、并按 `savedAt` 补了离线饥饿（10 分钟 → +20，离线 30 天 → 封顶 100）与离线攒的零食（10 分钟 → 攒满，`savedAt` 就是当下 → 格数原样保留，缺 `snacks` 字段的老存档 → 兜底满格且等级不丢）；坏 JSON / 版本对不上当作新宠物且只警告一次；越界与类型不对的字段被逐个夹回来；`storage` 事件能跨标签页采纳，无关键与坏数据被忽略；`persist: false` 时存档摆在那儿也不读；
- **等级形态**（靠改存档 + 重启实例摆等级）：Lv.1/3/6/10 的 `data-stage` 分别是 `baby/young/adult/legend`、名字行与 `aria-label` 写着形态名、viewBox 四档都没变而**头像边长一档比一档大且最高档至少是最低档的 1.8 倍**（挡住「差几个像素等于没变」）、四档皮肤色互不相同、喷水柱只在 `young/adult`、背鳍只在 `adult/legend`、王冠只在 `legend`、金色描边只在 `legend`，且每一档恒在的部件都不缺；门槛边界 Lv.2/5/9/50 各自落对档（挡差一错误）；tooltip 写着「形态 幼崽 → Lv.3 少年」而最高档没有箭头那段；**进阶**：`level: 2, exp: 199` 时点一口零食 → 升到 Lv.3、多出一条 `source: 'evolve'` / `tier: 'epic'` 的特效、飘字就是「进阶 · 少年」这整句（不拼 `+0`）、`data-stage` 换成 `young`、渲染树里有 `.dshpet-evolve` 且它与金环动画都有对应 CSS；主实例整场只升到 Lv.2（没跨档），断言它**从来没飘过**进阶特效；
- 非喂食源被忽略、重复折叠不重复喂食、陈旧事件不喂食；
- 飞行位移落在预期区间且真的写进了食物元素的自定义属性，量不到锚点时退回就地飞入；
- 头像渲染出鲸鱼 SVG、各部件齐全且都有对应 CSS 规则、epic 时有星星眼闪光与不同嘴型。

---

## 打包校验做了什么

```sh
node scripts/pack.mjs          # 或 npm run pack
```

产物落在 `dist/dsh-pet-plugin-<version>.tgz`，别人拿到后一条命令装完即用——**tarball 里是现成的产物，没有 `prepare` / `postinstall`，所以不需要 pnpm 的 `allowBuilds` 授权**（从 git 装才需要）。

脚本按顺序做六件事，任何一步不过就退出并列出全部问题：

1. **清单**：`type: "module"`、`main`、semver、`dsh.bundle.patch` 存在且指向真实文件、`dsh.client.platform === "web"`、`exports` 的三条（`.` / `./client` / `./package.json`）齐备、`files` 覆盖 `index.js` + `lib/client.js` + `cordis.patch.yml` 且没混进开发件。
2. **配置层**：`cordis.patch.yml` 里有 `- insert:`，且有一行的 `name` 等于包名——`client-modules` 的扫描以「一条活着的 entry，其 `options.name` 等于包名」为前提，名字写错插件就只是静默地不出现。
3. **产物格式**：`node --check` 过语法；`window.__ModuleLoader__.load(` / `var module = { exports: {} }` / `return module.exports` / `exports.apply =` 四件套齐备；产物里的 `id` 等于包名。
4. **产物纯净度**：扫出所有 `require("…")` 的目标，逐个比对 `PLATFORM_MODULES` 白名单。浏览器模块表里只有那十来个平台模块，require 到别的东西必然在运行时 resolve 失败——这一条是最容易在开发时不小心破坏的。
5. **冒烟测试**：跑一遍 `test/smoke.mjs`。
6. **复核 tarball**：脚本自己解开 `.tgz`（`zlib` + 手写 tar 头解析，零依赖），确认里面正好是 `files` 允许的那四个文件（`package.json` / `index.js` / `lib/client.js` / `cordis.patch.yml`——文档不在包根，不进 tarball）、没有 `test/` `scripts/` `dist/` `node_modules/`、`lib/client.js` 与本地校验过的那份逐字节相同、解压出来的 `package.json` 仍带着两个 `dsh` manifest。

其他用法：

```sh
node scripts/pack.mjs --check       # 只跑 1-5 步，不打包
node scripts/pack.mjs --out build   # 换输出目录
node scripts/pack.mjs --packer npm  # 强制 npm pack（默认 pnpm，失败自动退回 npm）
```

---

## 已知限制与偏离策划之处

- **宠物状态存在浏览器本地，而不是策划设想的后端**（见上文「进度落盘」）。因此它**按浏览器 + 域名分家**：换浏览器、换设备、无痕窗口、清站点数据都是一只新宠物，同一台机器上不同项目的 dsh 只要域名端口相同就共用一只。要做到跨设备的账号级进度就得改目标仓库（往 `API_REMOTE_FORWARDED_EVENTS` 里加一个事件 + 一个 host 侧 Service），本实现明确不走这条路。
- **`player_id` / `pet_id` / 多宠物没有实现**。单浏览器单宠物，`AutoFeedEvent` 的这两个字段在这个形态下没有承载对象。
- **补了饥饿回升**：策划的 `feed` 只写了 `hunger = max(0, hunger - amount)`，没有回升规则，喂几次饱食度就顶满并停住 —— 食物量的大小随即失去意义。本实现按策划「扩展点」的方向补了 `hungerRegenPerMin`（默认每分钟 +2，封顶 100，惰性结算），设成 0 可退回策划行为。
- **宠物不会饿死**：`hunger` 封顶 100 就停住，不掉等级、不掉经验、不重置 —— 这是刻意的。策划没写任何惩罚规则，本实现不发明；饿了只有表现层的提醒（红条 + 耷脸 + 按钮脉冲，见上文「主动喂食」），`hungryAt` 只决定这组提醒从哪个饥饿度开始，不带任何数值后果。
- **补了主动喂食**：策划里宠物只被 Agent 的活动喂。加上饥饿回升之后空闲期没有任何补救途径，所以补了零食按钮（`manualFeed*` / `manualSnack*`），`manualFeedEnabled: false` 可退回策划行为。它刻意不进 combo、不进 token 统计。
- **食物量是对数曲线而不是策划的线性式**，且**连击对食物量走加法**、**食物按 token 量级分四档**、**界面直接显示 token 数**。策划只写了 `tokens / tokensPerFood × multiplier` 加 `[1, 15]` 夹取，那条式子在真实用量下几乎分辨不出消耗量（见上文「计算规则」）。相关配置 `tokensPerFood` 的含义随之从「多少 token 换 1 份」变成曲线的起点尺度，默认值也从 100 改成 60。
- **`mood` / `energy` 是静态展示值**：策划给了字段和 0-100 的范围，但没给任何变化规则，所以插件不发明规则，只把它们显示在 tooltip 里。
- **升级采用扣减制**：策划只说「exp 达到 level×100 后升级」，本实现在升级时扣掉 `level×100` 并允许一次喂食连升多级。
- **饱食度 = 100 - hunger**：策划的 `hunger` 是饥饿度（越低越好），界面上显示成饱食度更直观，这是纯展示层的换算。
- **宠物形象是本实现定的**：策划没规定长相，只规定了 `eat-bounce`。DeepSeek 二次元小鲸的造型、待机动作、星星眼都是本实现补的，`petAvatar: 'emoji'` 可以退回单字形头像。
- **等级形态是本实现补的，且门槛不走配置**：策划里等级只是个数字。4 档形态（见上文「按等级变形态」）是纯表现层的补充；`WHALE_STAGES` 是常量而不是配置项 —— `resolveConfig` 只做「同类型标量覆盖」的校验，塞一张数组表进去等于没有校验，而收益只是「能自己改门槛」，不值这个复杂度。想关掉按等级变形，用 `petAvatar: 'emoji'`。
- **每条喂食事件各自成一个 Conversation Context**（`id = "seq-<seq>"`，`role` 恒为 `start`）。这样引擎对每条事件最多调一次 `start`，代价是长会话里 Context 数量与可喂事件数同阶。这些 Context 是 state-only 且 `publication: "none"`，不参与任何视图构建。
- **多了一条 keyframe，并且依赖一个宿主 DOM 属性**：`dshpet-fly-across`（食物从会话区飞来）是本实现加的，策划的 `fly-in` 原样保留作为退路。它读 `[data-conversation-scroll]` 的位置——这是插件唯一一处对宿主 DOM 的耦合。宿主要是改了这个属性名，效果会**静默降级**成就地飞入（不报错、不飞到屏幕外），把 `flyFromConversation` 设成 `false` 是同样的效果。
- **插件集变化需要重启**：`client-modules` 会永久缓存「这个包不是 web 插件」的否定判定，所以装完 / 卸完必须重启 `dsh`。
- **子 Agent 会话也会喂食**：Definition 注册在所有会话上，subagent 的事件同样计入 Combo。这是有意的（工具循环本来就是高 Combo 的主要来源）。
