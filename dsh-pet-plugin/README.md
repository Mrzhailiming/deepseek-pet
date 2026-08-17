# dsh-pet-plugin — 宠物自动喂食插件

按 [`pet-auto-feed-plugin-design.md`](../pet-auto-feed-plugin-design.md) 实现的 DeepSeek Harness (`dsh`) 插件。

你和 Agent 交互的每一步都会喂一次宠物：**你发消息**（🥕）、**模型回一次**（🐟）、**工具跑完一次**（🍖）。事件越密（尤其是工具循环），Combo 越高，倍率越大，特效越夸张——1~3 级白字，4~6 级金字加震动，7~10 级彩虹渐变加光环脉冲。宠物挂在整个界面右下角的浮层里，点一下可以折叠成只剩头像。

**这是一个 out-of-tree 插件包：安装它不需要修改 dsh 仓库的任何一个字节，也不需要重新构建 Web 前端。**

---

## 安装

`web` profile 首次使用会自动从模板初始化（base + web-app）。装源码目录，在**包含 `dsh-pet-plugin` 目录的上级目录**里执行：

```sh
dsh plugin --profile web add ./dsh-pet-plugin
```

或者装一个 tarball（分发给别人时用这个，见 [打包分发](#打包分发)）：

```sh
dsh plugin --profile web add ./dsh-pet-plugin-0.1.0.tgz
```

确认这一层进来了（应当能看到 `# == dsh-pet-plugin` 这一层和 `pet-feed` 这一行）：

```sh
dsh --profile web --dump-config
```

然后启动 Web：

```sh
dsh web
```

打开页面，随便说句话——宠物应该在右下角开始吃东西。

卸载：

```sh
dsh plugin --profile web remove dsh-pet-plugin
```

> 从源码仓库运行时，把这个目录放在 dsh 仓库根目录下，命令写成 `pnpm dsh plugin --profile web add ./dsh-pet-plugin`。

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

| 事件 | 触发源 | token 估算 | 基础经验 |
|---|---|---|---|
| `user/message`（且 `source.kind === "user"`） | `user_input` | 可见文本字符数 / 4 | 1 |
| `assistant/message`（且带 `usage`） | `generation` | `usage.outputTokens` | 2 |
| `tool/result` | `tool_result` | 结果 content 的 UTF-8 字节数 / 4，最少 1 | 3 |

`user/message` 只认 `source.kind === "user"`：插件注入的上下文也是 `user/message`，那不是用户输入。`assistant/message` 只在 adapter 报了 `usage` 时才算一次 generation。

### 为什么不会被历史刷屏

Conversation 引擎会在打开会话、翻历史、边界解析、插件集变化时**重新折叠**同一批事件，`start` 因此会对同一条事件被反复调用。插件用一道幂等闸门兜住：

1. **新鲜度**：`Date.now() - event.time > 30s` 的事件一律不喂。打开一个旧会话时整段日志会被折叠一次，这一条挡掉了它。
2. **去重**：键取 `seq + time + type` 复合（`seq` 只在会话内单调，跨会话不可比），只保留新鲜度窗口内的键。

---

## 计算规则

```
combo.tick():  now - last > 5000ms → count = 0;  count = min(count + 1, 10);  last = now
multiplier  =  1 + 0.2 × count                          （count 已封顶 10 ⇒ 上限 3.0x）
food        =  clamp(floor(tokens / 100 × m + 0.5), 1, 15)
exp         =  max(1, floor(baseExp × m + 0.5))
pet.feed:      hunger = max(0, hunger - food);  exp += exp;  exp ≥ level×100 时升级
```

Combo 视觉等级：`1-3 → normal`（白字）、`4-6 → gold`（金字 + 轻微震动 + 金色光晕）、`7-10 → epic`（彩虹渐变 + 强震 + 光环脉冲 + 大字号）。

三阶段动画沿用策划给的 keyframes（仅加 `dshpet-` 前缀）：食物飞入 600ms → 宠物 `eat-bounce` 400ms → 飘字 `float-up` 1200ms（延迟 600ms 起），总时长 2200ms = 特效 TTL。策划只写了「轻微震动 / 强震」没给 keyframes，`shake-light` / `shake-strong` 是本实现补的。系统开了「减少动效」时全部动画关闭。

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

## 调参

浏览器 entry **不携带 cordis 的 `config`**（`WebBootEntry` 只有 `id/url/rev/inject/immediately`），所以 profile 的 `cordis.patch.yml` 改不到这一半。默认值是 `lib/client.js` 顶部的 `DEFAULTS`，运行期覆盖走 `localStorage`：

```js
localStorage.setItem('dsh-pet-plugin/config', JSON.stringify({
  comboWindowMs: 3000,   // Combo 窗口（默认 5000）
  maxCombo: 20,          // 最大连击（默认 10，注意会抬高倍率上限）
  maxFood: 25,           // 单次最大食物量（默认 15）
  tokensPerFood: 50,     // 多少 token 换 1 食物（默认 100）
  effectsEnabled: false, // 只留宠物卡片，关掉飞行特效（默认 true）
  effectTtlMs: 1500,     // 单条特效时长（默认 2200）
  flyFromConversation: false, // 食物就地飞入，不从会话区飞过来（默认 true，本实现补充项）
  freshnessMs: 60000,    // 多久之内的事件才喂（默认 30000，本实现补充项）
  petName: '球球', petSpecies: '史莱姆', petIcon: '🐙',
}))
// 刷新页面生效
```

对应策划配置表：`enabled` = `pet.auto_feed.enabled`，`comboWindowMs` = `combo_window_ms`，`maxCombo` = `max_combo`，`minFood`/`maxFood`/`tokensPerFood` 同名，`effectsEnabled` = `pet.effects.enabled`，`effectTtlMs` = `pet.effects.ttl_ms`。类型不匹配的字段会被静默忽略，非法 JSON 会在 console 里警告一次并整体回退默认值。

`enabled: false` 时插件直接返回，既不注册观察者也不注册浮层。

---

## 自测

不需要装任何依赖：

```sh
node test/smoke.mjs
```

它用桩件（假 React、假 `__ModuleLoader__`、假 `ctx`、能量矩形的假 DOM）把产物跑起来，喂一串假的 `SessionEvent`，断言 Combo 封顶在 10、倍率上限 3.0x、食物量落在 `[1, 15]`、非喂食源被忽略、重复折叠不重复喂食、陈旧事件不喂食、飞行位移落在预期区间且真的写进了食物元素的自定义属性、量不到锚点时退回就地飞入，并渲染一遍组件确认不抛。

---

## 打包分发

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
6. **复核 tarball**：脚本自己解开 `.tgz`（`zlib` + 手写 tar 头解析，零依赖），确认里面正好是 `files` 允许的那五个文件、没有 `test/` `scripts/` `dist/` `node_modules/`、`lib/client.js` 与本地校验过的那份逐字节相同、解压出来的 `package.json` 仍带着两个 `dsh` manifest。

其他用法：

```sh
node scripts/pack.mjs --check       # 只跑 1-5 步，不打包
node scripts/pack.mjs --out build   # 换输出目录
node scripts/pack.mjs --packer npm  # 强制 npm pack（默认 pnpm，失败自动退回 npm）
```

---

## 已知限制与偏离策划之处

- **宠物状态是浏览器内存态**，不落盘、不跨标签页共享、刷新即从 Lv.1 重来。策划把宠物状态放在后端，但 host → 浏览器的推送通道加不了新事件（见上），而在不改仓库的前提下也没有可用的宿主侧持久化接缝。要真正持久化就得改目标仓库（往 `API_REMOTE_FORWARDED_EVENTS` 里加一个事件 + 一个 host 侧 Service）。
- **`player_id` / `pet_id` / 多宠物没有实现**。单浏览器单宠物，`AutoFeedEvent` 的这两个字段在这个形态下没有承载对象。
- **hunger 只降不升**：策划的 `feed` 只写了 `hunger = max(0, hunger - amount)`，没有饥饿回升规则。所以喂几次之后饱食度就顶到 100 并停在那里。这是照着策划实现的结果，不是 bug；要让循环持续有意义，得补一条饥饿回升规则（策划「扩展点」里的方向之一）。
- **`mood` / `energy` 是静态展示值**：策划给了字段和 0-100 的范围，但没给任何变化规则，所以插件不发明规则，只把它们显示在 tooltip 里。
- **升级采用扣减制**：策划只说「exp 达到 level×100 后升级」，本实现在升级时扣掉 `level×100` 并允许一次喂食连升多级。
- **饱食度 = 100 - hunger**：策划的 `hunger` 是饥饿度（越低越好），界面上显示成饱食度更直观，这是纯展示层的换算。
- **每条喂食事件各自成一个 Conversation Context**（`id = "seq-<seq>"`，`role` 恒为 `start`）。这样引擎对每条事件最多调一次 `start`，代价是长会话里 Context 数量与可喂事件数同阶。这些 Context 是 state-only 且 `publication: "none"`，不参与任何视图构建。
- **多了一条 keyframe，并且依赖一个宿主 DOM 属性**：`dshpet-fly-across`（食物从会话区飞来）是本实现加的，策划的 `fly-in` 原样保留作为退路。它读 `[data-conversation-scroll]` 的位置——这是插件唯一一处对宿主 DOM 的耦合。宿主要是改了这个属性名，效果会**静默降级**成就地飞入（不报错、不飞到屏幕外），把 `flyFromConversation` 设成 `false` 是同样的效果。
- **插件集变化需要重启**：`client-modules` 会永久缓存「这个包不是 web 插件」的否定判定，所以装完 / 卸完必须重启 `dsh`。
- **子 Agent 会话也会喂食**：Definition 注册在所有会话上，subagent 的事件同样计入 Combo。这是有意的（工具循环本来就是高 Combo 的主要来源）。
