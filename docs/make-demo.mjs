/**
 * 生成 README 里的演示动图 `docs/demo.svg`。
 *
 *   node docs/make-demo.mjs            # 在仓库根执行
 *
 * 为什么是 SVG 而不是 GIF：录屏要一台跑着 dsh 的浏览器，脚本里没有；而这只鲸鱼
 * 从头到尾都是内联 SVG + CSS keyframes，直接把它搬进一张自带动画的 SVG 里，比
 * 逐帧截图再编码成 GIF 更清楚（30KB 上下 vs 1MB）、还能改。GitHub 的 <img> 会
 * 跑 SVG 里的 CSS 动画（JS 不跑，所以这里一行脚本都不能有）。
 *
 * 路径 / 配色 / keyframes 全部照抄 `dsh-pet-plugin/lib/client.js`，所以这张图
 * 里的鲸鱼和真跑起来的那只是同一只。时间轴（下面的 SCENES）是手排的：一轮工具
 * 循环把连击顶到满、开暴食、解锁成就、摸摸头、然后它睡了。
 *
 * 零依赖，输出确定（同样的输入逐字节一样，方便 diff）。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

//#region 时间轴

/** 一圈多久（ms）。所有 keyframe 的百分比都是拿它除出来的。 */
const CYCLE = 18000;

/** 画布尺寸：宽屏一点，左边放会话区，右下角放宠物卡片。 */
const W = 900;
const H = 420;

/**
 * 六口饭：时刻、来源、这一口的 token 量与食物图标。
 * 前两口是「你说了句话 / 模型回了一段」，后面四口是工具循环 —— 和真实的
 * 一轮 Agent 干活一个节奏（也正好演示了「换着口味吃不会腻」）。
 */
const FEEDS = [
  { at: 400, from: [436, 87], icon: "🥕", size: 22, text: "+8 🥕 · 240 tok", exp: "+2 ⭐", tier: "normal", combo: "×1.2" },
  { at: 1000, from: [250, 133], icon: "🐟", size: 22, text: "+11 🐟 · 1.8k tok", exp: "+4 ⭐", tier: "normal", combo: "×1.4" },
  { at: 1600, from: [240, 190], icon: "🍖", size: 22, text: "+17 🍖 · 1.2k tok", exp: "+6 ⭐", tier: "gold", combo: "×2.0" },
  { at: 2200, from: [230, 238], icon: "🍗", size: 30, text: "+21 🍗 · 4.4k tok", exp: "+9 ⭐", tier: "gold", combo: "×2.4" },
  { at: 2800, from: [250, 286], icon: "🍲", size: 38, text: "+26 🍲 · 12.6k tok", exp: "+11 ⭐", tier: "epic", combo: "×3.0" },
  { at: 3400, from: [236, 334], icon: "🍖", size: 30, text: "+21 🍖 · 3.1k tok", exp: "+24 ⭐", tier: "epic", combo: "×3.0  🔥×2" }
];

/** 暴食 BUFF 那一段（顶到满连击开的，15s —— 这里按一圈的节奏压到 6.2s）。 */
const FRENZY = [3400, 9600];

/**
 * 变身那一段：升到 Lv.10、编码技能又是唯一最高的那一门 → 分化成 🐱 代码猫。
 * 1.6s，和产物的 `dshpet-morph` 一样：白光糊住 → 弹一下 → 新形态露出来。
 * 头像在 +250ms 那一刻硬切（那时候白光是满的，切换看不见 —— 产物里也是
 * 同一个 patch 里换掉 `pet.form`，没有淡入淡出这回事）。
 */
const MORPH = [10500, 12100];
const SWAP = MORPH[0] + 250;

/** 睡着那一段：最后一次互动之后没动静，闭眼、飘 Zzz、精力回得快。 */
const SLEEP = [14200, CYCLE];

/**
 * 几条通知类飘字：成就 / 任务 / 摸头 / 进阶 / 进化，都走和喂食同一条特效管道。
 * 「进阶 · 传说金鲸」紧接着「进化 · 代码猫」是产物的真实顺序：两件事落在同一个
 * patch 里，所以传说金鲸那身金皮一帧都不会露出来 —— 直接就是猫。
 */
const NOTICES = [
  { at: 5400, text: "成就 · 满连击", tier: "epic" },
  { at: 6900, text: "任务达成 · 今日喂食 10 次", tier: "gold" },
  { at: 8300, text: "💗 摸摸头", tier: "normal" },
  { at: 10000, text: "进阶 · 传说金鲸", tier: "gold" },
  { at: MORPH[0], text: "进化 · 代码猫", tier: "epic" }
];

/** 台词气泡：`[进, 出, 文案]`。普通场合之间隔着 4s 以上，和限流规则一致。 */
const BUBBLES = [
  [3500, 5200, "唔…这一口有点大！"],
  [5500, 7000, "解锁新徽章啦！"],
  [7100, 8200, "今天的活干完了～"],
  [8400, 9800, "还要摸"],
  [MORPH[0] + 600, 13000, "我变样了！"],
  [SLEEP[0] + 400, CYCLE - 200, "Zzz…"]
];

/** 卡片上那行心情 / 精力：跟着剧情换几次。 */
const VITALS = [
  [0, 3400, "😐 68 · ⚡ 91"],
  [3400, 8300, "😊 78 · ⚡ 74"],
  [8300, MORPH[0], "😄 90 · ⚡ 66"],
  [MORPH[0], SLEEP[0], "🤩 96 · ⚡ 61"],
  [SLEEP[0], CYCLE, "😴 86 · ⚡ 98"]
];

/** 名字行：变身前后各一版（形态名就写在这儿）。 */
const NAMES = [
  [0, SWAP, "深深 · Lv.9 成年"],
  [SWAP, CYCLE, "深深 · Lv.10 代码猫"]
];

/** 会话区里逐条冒出来的东西：食物就是从这些块上飞过来的。 */
const MESSAGES = [
  { at: 200, kind: "user", y: 74, w: 168 },
  { at: 800, kind: "assistant", y: 124, w: 300 },
  { at: 1400, kind: "tool", y: 174, w: 262 },
  { at: 2000, kind: "tool", y: 222, w: 236 },
  { at: 2600, kind: "tool", y: 270, w: 274 },
  { at: 3200, kind: "tool", y: 318, w: 248 }
];

//#endregion

//#region 卡片几何

/** 会话列的左右边界：左边贴着侧栏，右边给卡片留出地方。 */
const COL = { x: 112, right: 520 };

/** 宠物卡片的左上角与内部留白（照抄 CSS：padding 8/12，gap 10）。 */
const CARD = { x: 512, y: 264, w: 372, h: 96, pad: 12, padY: 8, gap: 10 };
/** 头像边长：成年档 54px（`WHALE_STAGES` 里那张表）。 */
const AVATAR = 54;
/** 头像左上角 —— 食物飞行的落点就是它的中心。 */
const AVATAR_XY = [CARD.x + CARD.pad, CARD.y + CARD.padY + 8];
/** 落点（鲸鱼身体中心偏嘴那一侧）。 */
const TARGET = [AVATAR_XY[0] + AVATAR / 2, AVATAR_XY[1] + AVATAR / 2 + 4];
/** meta 那一列的左边与宽度。 */
const META_X = AVATAR_XY[0] + AVATAR + CARD.gap;
const META_W = 190;

//#endregion

//#region 小工具

/** 把毫秒折成 keyframe 的百分比（夹在一圈之内，去掉尾零好 diff）。 */
function pct(ms) {
  const v = (Math.max(0, Math.min(CYCLE, ms)) / CYCLE) * 100;
  return `${v.toFixed(3).replace(/\.?0+$/, "")}%`;
}

/**
 * 拼一条 `@keyframes`。
 * @param name - 动画名。
 * @param stops - `[毫秒, 声明]` 的数组，乱序也行；同一时刻后写的赢。
 */
function keyframes(name, stops) {
  const byMs = new Map();
  for (const [ms, decl] of stops) byMs.set(Math.max(0, Math.min(CYCLE, ms)), decl);
  const body = [...byMs.keys()]
    .sort((a, b) => a - b)
    .map((ms) => `${pct(ms)}{${byMs.get(ms)}}`)
    .join("");
  return `@keyframes ${name}{${body}}`;
}

/** 一段「淡入 → 挂着 → 淡出」的可见窗口。默认 180ms 的淡入淡出。 */
function window_(name, start, end, fade = 180) {
  return keyframes(name, [
    [0, "opacity:0"],
    [Math.max(0, start - 1), "opacity:0"],
    [start + fade, "opacity:1"],
    [Math.max(start + fade + 1, end - fade), "opacity:1"],
    [end, "opacity:0"],
    [CYCLE, "opacity:0"]
  ]);
}

/** 估一段文字多宽（CJK 按整字宽，emoji 略宽，拉丁按 .56）。 */
function textWidth(text, size) {
  let w = 0;
  for (const ch of text) {
    if (/[　-鿿＀-￯]/.test(ch)) w += size;
    else if (/[\u{1f000}-\u{1faff}←-➿️]/u.test(ch)) w += size * 1.15;
    else w += size * 0.56;
  }
  return w;
}

/** XML 转义（文案里出现 & < > 时不至于毁掉整张图）。 */
function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `<text>` 一行。`cls` 里塞可见性动画的类名。 */
function text(x, y, content, opts = {}) {
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    opts.cls ? `class="${opts.cls}"` : "",
    `font-size="${opts.size ?? 11}"`,
    opts.weight ? `font-weight="${opts.weight}"` : "",
    `fill="${opts.fill ?? "#eaeaea"}"`,
    opts.anchor ? `text-anchor="${opts.anchor}"` : "",
    opts.extra ?? ""
  ].filter(Boolean);
  return `<text ${attrs.join(" ")}>${esc(content)}</text>`;
}

/** 圆角矩形。 */
function rect(x, y, w, h, opts = {}) {
  const attrs = [
    `x="${round(x)}"`,
    `y="${round(y)}"`,
    `width="${round(w)}"`,
    `height="${round(h)}"`,
    `rx="${opts.rx ?? 6}"`,
    opts.cls ? `class="${opts.cls}"` : "",
    `fill="${opts.fill ?? "none"}"`,
    opts.stroke ? `stroke="${opts.stroke}"` : "",
    opts.strokeWidth ? `stroke-width="${opts.strokeWidth}"` : "",
    opts.extra ?? ""
  ].filter(Boolean);
  return `<rect ${attrs.join(" ")}/>`;
}

/** 数字收敛到 3 位小数，免得浮点误差进产物。 */
function round(n) {
  return typeof n === "number" ? Number(n.toFixed(3)) : n;
}

//#endregion

//#region 精灵图

/**
 * 新版宠物形象：用 v2-transparent/ 目录下的 PNG 精灵图替代旧的 SVG 矢量路径。
 * 五张图按时间轴切换：adult-normal → adult-excited → legend-normal → legend-sleep。
 */
const SPRITE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "dsh-pet-plugin", "assets", "deepseek", "v2-transparent");

function spriteDataUri(filename) {
  const buf = readFileSync(join(SPRITE_DIR, filename));
  return `data:image/png;base64,${buf.toString("base64")}`;
}

const SPRITE_ADULT_NORMAL = spriteDataUri("deepseek-adult-normal.png");
const SPRITE_ADULT_EXCITED = spriteDataUri("deepseek-adult-excited.png");
const SPRITE_LEGEND_NORMAL = spriteDataUri("deepseek-legend-normal.png");
const SPRITE_LEGEND_SLEEP = spriteDataUri("deepseek-legend-sleep.png");

/**
 * 宠物头像：四张精灵图叠在一起，靠 CSS 可见性动画按时间轴切换。
 * - adult-normal: 开场 + 暴食结束后的过渡
 * - adult-excited: epic 连击（星星眼）
 * - legend-normal: 变身后
 * - legend-sleep: 睡着
 */
function sprites() {
  const imgs = [
    ["v-sprite-adult-normal", SPRITE_ADULT_NORMAL],
    ["v-sprite-adult-excited", SPRITE_ADULT_EXCITED],
    ["v-sprite-legend-normal", SPRITE_LEGEND_NORMAL],
    ["v-sprite-legend-sleep", SPRITE_LEGEND_SLEEP]
  ];
  return imgs.map(([cls, uri]) =>
    `<image class="v ${cls}" x="${AVATAR_XY[0]}" y="${AVATAR_XY[1]}" width="${AVATAR}" height="${AVATAR}" href="${uri}" preserveAspectRatio="xMidYMid meet"/>`
  ).join("\n  ");
}

//#endregion

//#region 组装

/** 会话区那一列：逐条冒出来的消息 / 工具结果块。 */
function conversation() {
  const out = [];
  for (const [i, m] of MESSAGES.entries()) {
    const cls = `v v-msg${i}`;
    if (m.kind === "user") {
      // 自己说的话靠右，和 dsh 里一样是蓝底的那一条。
      const x = COL.right - m.w;
      out.push(`<g class="${cls}">`);
      out.push(rect(x, m.y, m.w, 26, { rx: 9, fill: "rgba(77,107,254,.22)", stroke: "rgba(77,107,254,.5)" }));
      out.push(text(x + 11, m.y + 17, "丰富一下 pet 的玩法", { size: 11, fill: "#cfd6ff" }));
      out.push(`</g>`);
    } else if (m.kind === "assistant") {
      out.push(`<g class="${cls}">`);
      out.push(rect(COL.x, m.y, m.w, 8, { rx: 4, fill: "rgba(255,255,255,.16)" }));
      out.push(rect(COL.x, m.y + 14, m.w - 74, 8, { rx: 4, fill: "rgba(255,255,255,.1)" }));
      out.push(`</g>`);
    } else {
      out.push(`<g class="${cls}">`);
      out.push(rect(COL.x, m.y, m.w, 32, { rx: 8, fill: "rgba(255,255,255,.05)", stroke: "rgba(255,255,255,.1)" }));
      out.push(rect(COL.x, m.y, 3, 32, { rx: 1.5, fill: "#47e6b1" }));
      out.push(text(COL.x + 12, m.y + 14, "🛠 tool_result", { size: 10, fill: "#9fb0c9" }));
      out.push(rect(COL.x + 12, m.y + 20, m.w - 60, 6, { rx: 3, fill: "rgba(255,255,255,.12)" }));
      out.push(`</g>`);
    }
  }
  return out.join("\n  ");
}

/** 宠物卡片：连击徽标 + 气泡 + 卡片本体（头像 / 名字 / 面板 / 两条进度条 / 徽章 / 按钮）。 */
function petCard() {
  const out = [];
  const nameY = CARD.y + CARD.padY + 12;
  const subY = nameY + 17;
  const vitalsY = subY + 15;
  const barY = vitalsY + 8;
  const barY2 = barY + 9;
  const badgeY = barY2 + 20;

  // 连击徽标：六个档位各自一个可见窗口（白字 → 金字 → 彩虹 + 🔥×2）。
  for (const [i, f] of FEEDS.entries()) {
    const isEpic = f.tier === "epic";
    const size = isEpic ? 16 : 13;
    const w = textWidth(f.combo, size) + 20;
    const x = CARD.x + CARD.w - w;
    const y = CARD.y - 62;
    const fill = f.tier === "normal" ? "rgba(22,22,26,.72)" : f.tier === "gold" ? "rgba(255,196,0,.16)" : "rgba(22,22,26,.72)";
    out.push(`<g class="v v-combo${i}">`);
    out.push(rect(x, y, w, 22, { rx: 11, fill }));
    out.push(text(x + w / 2, y + 16, f.combo, {
      size,
      weight: 700,
      anchor: "middle",
      fill: f.tier === "normal" ? "#eaeaea" : f.tier === "gold" ? "#ffd34d" : "url(#rainbow)"
    }));
    out.push(`</g>`);
  }

  // 台词气泡：贴在卡片上方，尖角朝下指着宠物。
  for (const [i, [, , line]] of BUBBLES.entries()) {
    const w = textWidth(line, 11) + 20;
    const x = CARD.x + CARD.w - 8 - w;
    const y = CARD.y - 34;
    out.push(`<g class="v v-bub${i}">`);
    out.push(rect(x, y, w, 24, { rx: 12, fill: "rgba(38,38,44,.94)", stroke: "rgba(255,255,255,.12)" }));
    out.push(`<path d="M${round(x + w - 26)} ${y + 24}h10l-5 6Z" fill="rgba(38,38,44,.94)"/>`);
    out.push(text(x + 10, y + 16, line, { size: 11 }));
    out.push(`</g>`);
  }

  // 卡片本体。睡着那一段整张压暗一档（照抄 `[data-asleep] {opacity:.72}`）。
  out.push(`<g class="card-dim">`);
  out.push(rect(CARD.x, CARD.y, CARD.w, CARD.h, {
    rx: 14, fill: "rgba(22,22,26,.9)", stroke: "rgba(255,255,255,.12)"
  }));
  // 暴食那一段：外面再描一圈暖橙（和「饿了」的红警示区分得开）。
  out.push(rect(CARD.x, CARD.y, CARD.w, CARD.h, {
    rx: 14, stroke: "rgba(255,159,67,.75)", strokeWidth: 1.6, cls: "v v-frenzy",
    extra: 'filter="url(#warmglow)"'
  }));
  // 头像：四张精灵图叠在一起，按时间轴切换状态。
  out.push(`<g class="avatar">${sprites()}</g>`);
  // 变身那一下的白光 + 光环（照抄 `.dshpet-morph`：inset -16px 的一圈）。
  const mc = [TARGET[0], AVATAR_XY[1] + AVATAR / 2];
  out.push(`<g class="v v-morph">`);
  out.push(`<circle class="morph-flash" cx="${mc[0]}" cy="${mc[1]}" r="${AVATAR / 2 + 16}" fill="url(#flash)"/>`);
  out.push(`<circle class="morph-ring" cx="${mc[0]}" cy="${mc[1]}" r="${AVATAR / 2 + 16}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="2"/>`);
  out.push(`</g>`);
  out.push(`<g class="v v-zzz-wrap"><text class="zzz" x="${AVATAR_XY[0] + AVATAR - 6}" y="${AVATAR_XY[1] + 2}" font-size="14">💤</text></g>`);

  for (const [i, [, , line]] of NAMES.entries()) {
    out.push(text(META_X, nameY, line, { size: 12, weight: 600, cls: `v v-name${i}` }));
  }
  out.push(text(META_X, subY, "消耗 22.6k · 🥕2.1k 🐟8.0k 🍖12.5k", { size: 10, fill: "#a9a9b2" }));
  for (const [i, [, , line]] of VITALS.entries()) {
    out.push(text(META_X, vitalsY, line, { size: 11, fill: "#a9a9b2", cls: `v v-vit${i}` }));
  }

  // 两条进度条：橙色饱食度、蓝色经验。喂食时各自往前跳一段。
  out.push(rect(META_X, barY, META_W, 4, { rx: 2, fill: "rgba(255,255,255,.14)" }));
  out.push(`<g class="grow g-full"><rect x="${META_X}" y="${barY}" width="${META_W}" height="4" rx="2" fill="#ff9f43"/></g>`);
  out.push(rect(META_X, barY2, META_W, 4, { rx: 2, fill: "rgba(255,255,255,.14)" }));
  out.push(`<g class="grow g-exp"><rect x="${META_X}" y="${barY2}" width="${META_W}" height="4" rx="2" fill="#4d6bfe"/></g>`);

  // 徽章行：三枚已解锁的，第四枚（满连击 🔥）在成就解锁那一刻亮起来。
  out.push(text(META_X, badgeY, "🍼 🍱 🍚", { size: 11 }));
  out.push(text(META_X + 58, badgeY, "🔥", { size: 11, cls: "v v-badge-new" }));

  // 右边两颗按钮：🍬 喂一口零食、🏅 看成就与今日任务。
  const btnY = CARD.y + CARD.padY + 18;
  out.push(rect(CARD.x + CARD.w - 88, btnY, 40, 26, { rx: 10, fill: "rgba(255,255,255,.08)", stroke: "rgba(255,255,255,.12)" }));
  out.push(text(CARD.x + CARD.w - 82, btnY + 19, "🍬", { size: 15 }));
  out.push(text(CARD.x + CARD.w - 60, btnY + 18, "5", { size: 10, weight: 700, fill: "#a9a9b2" }));
  out.push(rect(CARD.x + CARD.w - 42, btnY, 30, 26, { rx: 10, fill: "rgba(255,255,255,.08)", stroke: "rgba(255,255,255,.12)" }));
  out.push(text(CARD.x + CARD.w - 36, btnY + 19, "🏅", { size: 15 }));
  out.push(`</g>`);
  return out.join("\n  ");
}

/** 特效层：食物从会话区飞过来 + 飘字。 */
function effects() {
  const out = [];
  for (const [i, f] of FEEDS.entries()) {
    out.push(`<text class="food f${i}" x="${TARGET[0]}" y="${TARGET[1]}" font-size="${f.size}" text-anchor="middle">${f.icon}</text>`);
    const fill = f.tier === "normal" ? "#fff" : f.tier === "gold" ? "#ffd34d" : "url(#rainbow)";
    const size = f.tier === "epic" ? 18 : f.tier === "gold" ? 15 : 13;
    out.push(`<text class="float fl${i}" x="${CARD.x + 6}" y="${CARD.y - 4}" font-size="${size}" font-weight="700" fill="${fill}">${esc(f.text)}  ${esc(f.exp)}</text>`);
  }
  for (const [i, n] of NOTICES.entries()) {
    const fill = n.tier === "normal" ? "#fff" : n.tier === "gold" ? "#ffd34d" : "url(#rainbow)";
    const size = n.tier === "epic" ? 18 : n.tier === "gold" ? 15 : 13;
    out.push(`<text class="float nt${i}" x="${CARD.x + 6}" y="${CARD.y - 4}" font-size="${size}" font-weight="700" fill="${fill}">${esc(n.text)}</text>`);
  }
  return out.join("\n  ");
}

/** 整张图的 CSS：可见性窗口 + 照抄产物的那些 keyframes。 */
function css() {
  const parts = [];
  parts.push(`text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC","PingFang SC","Microsoft YaHei",Roboto,sans-serif;dominant-baseline:auto}`);
  parts.push(`.v{opacity:0}`);
  // SVG 元素默认拿 viewBox 当变换原点，缩放会把东西甩到画布中心去；
  // 凡是要 scale 的都得先把原点框改成自身包围盒。
  parts.push(`.food,.avatar{transform-box:fill-box;transform-origin:center}`);
  parts.push(`.float{transform-box:fill-box;transform-origin:left center}`);

  // ---- 会话区：一条条冒出来，冒出来之后就留在那儿（到下一圈才清空）。
  for (const [i, m] of MESSAGES.entries()) {
    parts.push(keyframes(`k-msg${i}`, [
      [0, "opacity:0;transform:translateY(6px)"],
      [Math.max(0, m.at - 1), "opacity:0;transform:translateY(6px)"],
      [m.at + 260, "opacity:1;transform:translateY(0)"],
      [CYCLE - 400, "opacity:1;transform:translateY(0)"],
      [CYCLE, "opacity:0;transform:translateY(0)"]
    ]));
    parts.push(`.v-msg${i}{animation:k-msg${i} ${CYCLE}ms linear infinite}`);
  }

  // ---- 食物飞行：起点是会话区里那一块，落点是鲸鱼（照抄 fly-across 的时序）。
  for (const [i, f] of FEEDS.entries()) {
    const dx = round(f.from[0] - TARGET[0]);
    const dy = round(f.from[1] - TARGET[1]);
    parts.push(keyframes(`k-food${i}`, [
      [0, `opacity:0;transform:translate(${dx}px,${dy}px) scale(.35)`],
      [Math.max(0, f.at - 1), `opacity:0;transform:translate(${dx}px,${dy}px) scale(.35)`],
      [f.at + 72, "opacity:1"],
      [f.at + 420, "transform:translate(0,-5px) scale(1.2)"],
      [f.at + 600, "opacity:1;transform:translate(0,0) scale(1)"],
      [f.at + 900, "opacity:0;transform:translate(0,0) scale(1)"],
      [CYCLE, "opacity:0"]
    ]));
    parts.push(`.f${i}{opacity:0;animation:k-food${i} ${CYCLE}ms linear infinite;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))}`);
    // 飘字：延迟 600ms 起，1200ms 往上飘完（和产物的 float-up 一致）。
    parts.push(floatKeyframes(`k-float${i}`, f.at + 600));
    parts.push(`.fl${i}{opacity:0;animation:k-float${i} ${CYCLE}ms linear infinite}`);
  }
  for (const [i, n] of NOTICES.entries()) {
    parts.push(floatKeyframes(`k-note${i}`, n.at));
    parts.push(`.nt${i}{opacity:0;animation:k-note${i} ${CYCLE}ms linear infinite}`);
  }

  // ---- 连击徽标：一档接一档，最后那档（暴食）挂到 BUFF 结束。
  for (const [i, f] of FEEDS.entries()) {
    const end = i === FEEDS.length - 1 ? FRENZY[1] : FEEDS[i + 1].at;
    parts.push(window_(`k-combo${i}`, f.at, end, 120));
    parts.push(`.v-combo${i}{animation:k-combo${i} ${CYCLE}ms linear infinite}`);
  }

  // ---- 气泡 / 心情行 / 暴食边框 / 新徽章。
  for (const [i, [from, to]] of BUBBLES.entries()) {
    parts.push(window_(`k-bub${i}`, from, to, 200));
    parts.push(`.v-bub${i}{animation:k-bub${i} ${CYCLE}ms linear infinite}`);
  }
  for (const [i, [from, to]] of VITALS.entries()) {
    parts.push(window_(`k-vit${i}`, from, to, 140));
    parts.push(`.v-vit${i}{animation:k-vit${i} ${CYCLE}ms linear infinite}`);
  }
  // 名字行：形态名跟着头像一起换，所以是硬切（fade 1ms），不然两行字会糊在一起。
  for (const [i, [from, to]] of NAMES.entries()) {
    parts.push(window_(`k-name${i}`, from, to, 1));
    parts.push(`.v-name${i}{animation:k-name${i} ${CYCLE}ms linear infinite}`);
  }
  parts.push(window_("k-frenzy", FRENZY[0], FRENZY[1], 220));
  parts.push(`.v-frenzy{animation:k-frenzy ${CYCLE}ms linear infinite}`);
  parts.push(window_("k-badge-new", NOTICES[0].at + 200, CYCLE, 240));
  parts.push(`.v-badge-new{animation:k-badge-new ${CYCLE}ms linear infinite}`);

  // ---- 精灵图切换：四张按时间轴显示对应的一张。
  const epicFrom = FEEDS[4].at;
  // adult-normal: 开场 → epic 之前，以及 frenzy 结束 → 变身之前
  parts.push(keyframes("k-sprite-adult-normal", [
    [0, "opacity:1"],
    [epicFrom - 160, "opacity:1"],
    [epicFrom, "opacity:0"],
    [FRENZY[1], "opacity:0"],
    [FRENZY[1] + 200, "opacity:1"],
    [SWAP - 1, "opacity:1"],
    [SWAP, "opacity:0"],
    [CYCLE, "opacity:0"]
  ]));
  parts.push(`.v-sprite-adult-normal{animation:k-sprite-adult-normal ${CYCLE}ms linear infinite}`);
  // adult-excited: epic 连击那一段（星星眼）
  parts.push(window_("k-sprite-adult-excited", epicFrom, FRENZY[1], 160));
  parts.push(`.v-sprite-adult-excited{animation:k-sprite-adult-excited ${CYCLE}ms linear infinite}`);
  // legend-normal: 变身后 → 睡着之前
  parts.push(window_("k-sprite-legend-normal", SWAP, SLEEP[0], 1));
  parts.push(`.v-sprite-legend-normal{animation:k-sprite-legend-normal ${CYCLE}ms linear infinite}`);
  // legend-sleep: 睡着那一段
  parts.push(window_("k-sprite-legend-sleep", SLEEP[0], CYCLE, 200));
  parts.push(`.v-sprite-legend-sleep{animation:k-sprite-legend-sleep ${CYCLE}ms linear infinite}`);

  // Zzz：睡着的时候才飘。
  parts.push(window_("k-zzz", SLEEP[0] + 200, CYCLE, 240));
  parts.push(`.v-zzz-wrap{animation:k-zzz ${CYCLE}ms linear infinite}`);
  parts.push(`.zzz{animation:k-zzz-drift 2.6s ease-in-out infinite}`);
  parts.push(`@keyframes k-zzz-drift{0%{opacity:0;transform:translate(0,2px) scale(.8)}30%{opacity:1}100%{opacity:0;transform:translate(4px,-10px) scale(1.1)}}`);

  // ---- 变身白光 + 光环。
  parts.push(window_("k-morph", MORPH[0], MORPH[1], 1));
  parts.push(`.v-morph{animation:k-morph ${CYCLE}ms linear infinite}`);
  parts.push(keyframes("k-flash", [
    [0, "opacity:0;transform:scale(.85)"],
    [MORPH[0], "opacity:1;transform:scale(.85)"],
    [MORPH[0] + 400, "opacity:1;transform:scale(1.15)"],
    [MORPH[0] + 800, "opacity:0;transform:scale(1.25)"],
    [CYCLE, "opacity:0"]
  ]));
  parts.push(`.morph-flash{transform-box:fill-box;transform-origin:center;animation:k-flash ${CYCLE}ms linear infinite}`);
  parts.push(keyframes("k-ring", [
    [0, "opacity:0;transform:scale(.85)"],
    [MORPH[0], "opacity:1;transform:scale(.85)"],
    [MORPH[0] + 400, "opacity:1;transform:scale(1.15)"],
    [MORPH[1], "opacity:0;transform:scale(1.7)"],
    [CYCLE, "opacity:0"]
  ]));
  parts.push(`.morph-ring{transform-box:fill-box;transform-origin:center;animation:k-ring ${CYCLE}ms linear infinite}`);

  // ---- 卡片压暗（睡着）。
  parts.push(keyframes("k-dim", [
    [0, "opacity:1"],
    [SLEEP[0], "opacity:1"],
    [SLEEP[0] + 600, "opacity:.72"],
    [CYCLE - 200, "opacity:.72"],
    [CYCLE, "opacity:1"]
  ]));
  parts.push(`.card-dim{animation:k-dim ${CYCLE}ms linear infinite}`);

  // ---- 头像每吃一口弹一下（eat-bounce，逐字取自产物）。
  const bounce = [[0, "transform:scale(1)"]];
  for (const f of FEEDS) {
    bounce.push([f.at + 560, "transform:scale(1)"]);
    bounce.push([f.at + 680, "transform:scale(1.15) rotate(-3deg)"]);
    bounce.push([f.at + 800, "transform:scale(.95) rotate(2deg)"]);
    bounce.push([f.at + 960, "transform:scale(1)"]);
  }
  bounce.push([NOTICES[2].at + 120, "transform:scale(1)"]);
  bounce.push([NOTICES[2].at + 240, "transform:scale(1.12) rotate(2deg)"]);
  bounce.push([NOTICES[2].at + 400, "transform:scale(1)"]);
  // 变身那一下的缩放（`dshpet-morph-pop`：.85 → 1.15 → 1）。产物里它和进食的
  // 弹跳挂在同一个元素上，所以这里也是同一条 keyframes —— 变身赢。
  bounce.push([MORPH[0], "transform:scale(.85)"]);
  bounce.push([MORPH[0] + 400, "transform:scale(1.15)"]);
  bounce.push([MORPH[0] + 800, "transform:scale(1)"]);
  bounce.push([CYCLE, "transform:scale(1)"]);
  parts.push(keyframes("k-bounce", bounce));
  parts.push(`.avatar{animation:k-bounce ${CYCLE}ms linear infinite}`);

  // ---- 两条进度条：喂食时往前跳，睡着时饱食度慢慢退回去。
  parts.push(barKeyframes("k-full", [
    [0, 0.52],
    ...FEEDS.map((f, i) => [f.at + 600, 0.58 + i * 0.07]),
    [SLEEP[0], 0.98],
    [CYCLE, 0.82]
  ]));
  parts.push(`.g-full{transform-box:fill-box;transform-origin:left center;animation:k-full ${CYCLE}ms linear infinite}`);
  // 经验条在 Lv.10 那一下满上去，然后清零重新开始（升级就是这么算的）。
  parts.push(barKeyframes("k-exp", [
    [0, 0.18],
    ...FEEDS.map((f, i) => [f.at + 600, 0.24 + i * 0.09]),
    [NOTICES[1].at, 0.86],
    [NOTICES[3].at, 1],
    [NOTICES[3].at + 60, 0.05],
    [CYCLE, 0.12]
  ]));
  parts.push(`.g-exp{transform-box:fill-box;transform-origin:left center;animation:k-exp ${CYCLE}ms linear infinite}`);

  // ---- 尊重「减少动效」：停在第一帧，图还看得懂。
  const still = [".v-combo5", ".v-sprite-adult-excited", ".v-frenzy", ".v-vit1", ".v-bub0", ".v-name0"]
    .concat(MESSAGES.map((_, i) => `.v-msg${i}`))
    .join(",");
  parts.push(
    `@media (prefers-reduced-motion:reduce){*{animation:none!important}.v{opacity:0}` +
      `${still}{opacity:1}.f4,.fl4{opacity:1}.g-full{transform:scaleX(.9)}.g-exp{transform:scaleX(.66)}}`
  );
  return parts.join("\n    ");
}

/** 飘字：600ms 之后往上飘 1200ms（照抄 float-up）。 */
function floatKeyframes(name, at) {
  return keyframes(name, [
    [0, "opacity:0;transform:translateY(0)"],
    [Math.max(0, at - 1), "opacity:0;transform:translateY(0)"],
    [at + 360, "opacity:1;transform:translateY(-8px)"],
    [at + 1200, "opacity:0;transform:translateY(-30px)"],
    [CYCLE, "opacity:0"]
  ]);
}

/** 进度条：拿 scaleX 表示百分比（改 width 在某些渲染器里不动画）。 */
function barKeyframes(name, points) {
  return keyframes(name, points.map(([ms, ratio]) => [ms, `transform:scaleX(${round(ratio)})`]));
}

/** 拼出整张 SVG。 */
function build() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="deepseek-pet 演示：Agent 干活喂鲸鱼，连击顶格开暴食，解锁成就，摸摸头，升到 Lv.10 分化成代码猫，然后它睡了">
  <title>deepseek-pet — Agent 干活就是在喂它</title>
  <defs>
    <radialGradient id="flash">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".95"/>
      <stop offset=".72" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rainbow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff5f6d"/><stop offset=".25" stop-color="#ffc371"/>
      <stop offset=".5" stop-color="#47e6b1"/><stop offset=".75" stop-color="#5b8cff"/>
      <stop offset="1" stop-color="#c86dd7"/>
    </linearGradient>
    <filter id="warmglow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#ff9f43" flood-opacity=".55"/>
    </filter>
    <style>
    ${css()}
    </style>
  </defs>

  <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#0c0c10"/>
  <rect x="0" y="0" width="72" height="${H}" rx="12" fill="#131318"/>
  <rect x="72" y="0" width="${W - 72}" height="36" fill="#131318"/>
  <rect x="0" y="36" width="${W}" height="1" fill="rgba(255,255,255,.07)"/>
  ${[0, 1, 2].map((i) => rect(16, 56 + i * 26, 40, 14, { rx: 5, fill: "rgba(255,255,255,.08)" })).join("\n  ")}
  <circle cx="36" cy="18" r="7" fill="#4d6bfe"/>
  ${text(90, 22, "dsh · web — 深深在右下角吃东西", { size: 11, fill: "#8b8b95" })}

  ${conversation()}
  ${petCard()}
  ${effects()}
</svg>
`;
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "demo.svg");
const svg = build();
writeFileSync(out, svg, "utf8");
process.stdout.write(`写好了 ${out}（${svg.length} 字节，一圈 ${CYCLE / 1000}s）\n`);
