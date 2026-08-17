<div align="center">

<img src="docs/whale.png" width="150" alt="深深">

# deepseek-pet

**在 DeepSeek Harness 的 Web 界面里，养一只二次元小鲸鱼。**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)
![build](https://img.shields.io/badge/build-none-lightgrey.svg)

你和 Agent 干活的每一步，它都在右下角吃东西 —— 你发消息喂 🥕、模型回一句喂 🐟、工具跑完一次喂 🍖。
工具循环越密，Combo 越高，特效越夸张，鲸鱼会变**星星眼**。

<img src="docs/demo.gif" width="720" alt="Agent 干活时，食物从会话区飞向鲸鱼，Combo 一路涨到彩虹">

<sub>真实录屏：一轮工具循环把 Combo 从 ×1 推到 ×10，鲸鱼吃到星星眼。</sub>

装它不用改 dsh 仓库的一个字节，也不用重新构建前端。

</div>

---

## 30 秒装上

把 `dsh-pet-plugin` 目录放到 **dsh 仓库根目录**下，在仓库根执行：

```sh
pnpm dsh plugin --profile web add ./dsh-pet-plugin   # 装
pnpm dsh --profile web --dump-config                 # 确认（应看到 "# == dsh-pet-plugin" 和 pet-feed）
pnpm dsh web                                         # 起 Web
```

打开页面随便说句话 —— 鲸鱼就在右下角开始吃东西了。

装别人给你的 tarball 也一样（见 [打包分发](#打包分发)）：

```sh
pnpm dsh plugin --profile web add ./dsh-pet-plugin-0.1.0.tgz
```

卸载：

```sh
pnpm dsh plugin --profile web remove dsh-pet-plugin
```

> - 装完 / 卸完都要**重启 dsh** 才生效。
> - `web` profile 首次使用会自动从模板初始化（base + web-app）。
> - 用全局安装的 `dsh` 的话，把每条命令的 `pnpm dsh` 换成 `dsh`，参数完全一样。

---

## 打包分发

```sh
node pack.mjs                        # 在本目录执行
# 等价写法（实现就在包里）：
cd dsh-pet-plugin && node scripts/pack.mjs
```

产物落在 `dist/dsh-pet-plugin-<version>.tgz`，发给别人一条 `pnpm dsh plugin add` 装完即用，不需要构建、不需要联网。打包前会自动跑一遍清单校验、产物校验和冒烟测试。

自测（不需要装任何依赖）：

```sh
cd dsh-pet-plugin
node test/smoke.mjs
```

---

## 玩法

<img src="docs/preview.png" width="700" alt="三档连击表现：平时 / 连击 / 星星眼">

- **Agent 干活就是在喂它**：你发消息 🥕、模型回一句 🐟、工具跑完一次 🍖，食物从会话里**事件发生的位置**飞过来落到鲸鱼嘴边，跟着冒 `+13 🐠 · 2.0k tok  +3 ⭐` 的飘字。
- **这一口有多大，看 token 消耗量**：小到一株 🌱，大到一整锅 🍲，字号跟着长，飘字里直接写着这一口烧了多少 token。
- **连续动作攒 Combo**：白字 → 金字（震动）→ 彩虹（强震 + 光环），最高档鲸鱼换**星星眼 + O 型嘴**，经验倍率最高 3.0x。
- **两条进度条**：橙色是饱食度，蓝色是当前等级的经验；攒够 `等级 × 100` 经验升一级。**空闲时会慢慢饿**，所以食物量的大小一直有意义。
- **越养越大只**：等级带来 4 档形态 —— 幼崽（小、大眼、还不会喷水）→ 少年（喷水柱）→ 成年（大背鳍）→ 传说（金色描边 + 王冠）。体型差了将近两倍，颜色从近乎白的淡蓝沉到海军蓝。跨档那一刻飘一条「进阶 · 成年」，头像外面炸开一圈金环；名字行写着 `深深 · Lv.6 成年`，鼠标悬停看得到还差几级到下一档。
- **饿了你可以亲自喂**：卡片上那颗 🍬 点一下就喂一口。零食是有库存的（5 格、45 秒回一格、离线也在攒），所以点不出等级，也**永远不会饿死**。手喂不算连击、不进 token 统计，刷不出等级也不会污染消耗面板。
- **饿了会提醒**：饱食度只剩 20 以内时饱食条变红、鲸鱼耷脸、糖果按钮开始跳。饥饿封顶就停住，不掉等级也不重置，红条纯粹是催你喂它。
- **点一下卡片**折叠成只剩头像，再点展开；展开时有一行 `消耗 12.3k tok · 🥕2.1k 🐟8.0k 🍖2.2k`，鼠标悬停看心情 / 精力 / 累计喂食次数。折叠状态下 🍬 还在，随时能喂。
- **进度不会因为刷新归零**：等级、经验、累计消耗都存在浏览器本地，关标签页也在；离开的这段时间它会慢慢饿，回来先喂一口。多开标签页养的是同一只。想重新养一只：控制台执行 `localStorage.removeItem('dsh-pet-plugin/state')`。
- 系统开了「减少动效」时，所有动画自动关闭。

---

想改宠物名字 / 连击窗口 / 食物量 / 关掉特效，或者想知道它是怎么在不改宿主仓库的前提下接上去的、事件从哪来、Combo 怎么算、鲸鱼怎么画的 —— 都在 [`dsh-pet-plugin/plugin.md`](dsh-pet-plugin/plugin.md)。

---

## License

[MIT](LICENSE) © zhailiming
