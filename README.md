# dsh-pet-plugin — 宠物自动喂食插件

给 DeepSeek Harness (`dsh`) 的 Web 界面挂一只**桌宠**：宠物是 DeepSeek 的鲸鱼，二次元 Q 版画法——圆身子、大高光眼、腮红、头顶喷水柱，平时浮沉摆尾，你干活它就吃东西。

你和 Agent 交互的每一步都会喂它一次：**你发消息**（🥕）、**模型回一次**（🐟）、**工具跑完一次**（🍖）。事件越密（尤其是工具循环），Combo 越高、倍率越大、特效越夸张——1~3 级白字，4~6 级金字加震动，7~10 级彩虹渐变加光环脉冲，这时候鲸鱼会变星星眼。

**这是一个 out-of-tree 插件包：安装它不需要修改 dsh 仓库的任何一个字节，也不需要重新构建 Web 前端。**

> 插件内部怎么实现的（接入方式、事件来源、计算规则、鲸鱼画法、打包校验、已知限制）看 [`dsh-pet-plugin/plugin.md`](dsh-pet-plugin/plugin.md)；策划原文是 [`pet-auto-feed-plugin-design.md`](pet-auto-feed-plugin-design.md)。

---

## 安装

从 dsh 源码仓库运行，所有命令都走 `pnpm dsh`。把 `dsh-pet-plugin` 目录放在 **dsh 仓库根目录**下，在仓库根执行：

```sh
pnpm dsh plugin --profile web add ./dsh-pet-plugin
```

`web` profile 首次使用会自动从模板初始化（base + web-app）。也可以装一个 tarball（别人分发给你的，见 [打包分发](#打包分发)）：

```sh
pnpm dsh plugin --profile web add ./dsh-pet-plugin-0.1.0.tgz
```

确认这一层进来了（应当能看到 `# == dsh-pet-plugin` 这一层和 `pet-feed` 这一行）：

```sh
pnpm dsh --profile web --dump-config
```

然后启动 Web：

```sh
pnpm dsh web
```

装完 / 卸完都要**重启 dsh** 才生效。

卸载：

```sh
pnpm dsh plugin --profile web remove dsh-pet-plugin
```

> 如果你用的是全局安装的 `dsh`，把上面每条命令的 `pnpm dsh` 换成 `dsh` 即可，参数完全一样。

---

## 用起来

打开页面，随便说句话——鲸鱼应该在右下角开始吃东西。

- 食物会**从会话里事件实际发生的位置飞过来**落到鲸鱼嘴边，跟着冒 `+N 🐟 +N ⭐` 的飘字。
- 连续动作会攒 Combo：徽标从白字 → 金字（震动）→ 彩虹（强震 + 光环），鲸鱼在最高档换星星眼。
- 卡片上两条进度条：橙色是饱食度，蓝色是当前等级的经验。
- **点一下卡片**折叠成只剩头像，再点展开。鼠标悬停能看到心情 / 精力 / 累计喂食次数。
- 系统开了「减少动效」时所有动画自动关闭。

---

## 调参

浏览器侧的配置走 `localStorage`（profile 的 `cordis.patch.yml` 改不到这一半，原因见 [`plugin.md`](dsh-pet-plugin/plugin.md)）。在页面控制台里执行，**刷新生效**：

```js
localStorage.setItem('dsh-pet-plugin/config', JSON.stringify({
  comboWindowMs: 3000,   // Combo 窗口（默认 5000）
  maxCombo: 20,          // 最大连击（默认 10，注意会抬高倍率上限）
  maxFood: 25,           // 单次最大食物量（默认 15）
  tokensPerFood: 50,     // 多少 token 换 1 食物（默认 100）
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

- 只写想改的字段就行，其余用默认值。
- 类型不匹配的字段会被静默忽略；非法 JSON 会在 console 警告一次并整体回退默认值。
- `enabled: false` 直接关掉整个插件（既不观察事件也不显示浮层）。

---

## 打包分发

```sh
cd dsh-pet-plugin
node scripts/pack.mjs          # 或 npm run pack
```

产物落在 `dist/dsh-pet-plugin-<version>.tgz`，发给别人一条 `pnpm dsh plugin add` 装完即用，不需要构建、不需要联网。打包前会自动跑一遍清单校验、产物校验和冒烟测试，校验项细节见 [`plugin.md`](dsh-pet-plugin/plugin.md)。

自测（不需要装任何依赖）：

```sh
cd dsh-pet-plugin
node test/smoke.mjs
```
