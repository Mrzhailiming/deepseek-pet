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

import { writeFileSync } from "node:fs";
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

//#region 鲸鱼

const INK = "#16224d";
const LINE = "#2b3f9e";
/** 成年档（Lv.6）的皮肤渐变，取自 `WHALE_STAGES`。 */
const SKIN = ["#6f8cff", "#2740c9", "#16226e"];
/** 眼睛缩放：成年档 .92。 */
const EYE = 0.92;

/** 一只眼睛（正常态：大瞳 + 两点高光）。 */
function eye(cx, cy) {
  const k = EYE;
  return [
    `<ellipse cx="${cx}" cy="${cy}" rx="${round(4.2 * k)}" ry="${round(5.2 * k)}" fill="${INK}"/>`,
    `<circle cx="${round(cx - 1.3 * k)}" cy="${round(cy - 2 * k)}" r="${round(1.7 * k)}" fill="#fff"/>`,
    `<circle cx="${round(cx + 1.2 * k)}" cy="${round(cy + 2.2 * k)}" r="${round(0.85 * k)}" fill="#fff" opacity=".75"/>`
  ].join("");
}

/** 星星眼（epic 连击那档）。 */
function starEye(cx, cy) {
  return [
    `<path d="M0-6C.7-2 2-.7 6 0 2 .7 .7 2 0 6-.7 2-2 .7-6 0-2-.7-.7-2 0-6Z"`,
    ` transform="translate(${cx} ${cy}) scale(${EYE})" fill="#ffe066"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${round(1.5 * EYE)}" fill="#fff8d6"/>`
  ].join("");
}

/**
 * 整只鲸鱼。三套表情（平时 / 星星眼 / 睡脸）都画在里面，靠各自的可见性动画换。
 * 路径全部照抄 `WhaleAvatar`，viewBox 同样是 `0 0 64 64`。
 */
function whale() {
  return `<svg class="whale" x="${AVATAR_XY[0]}" y="${AVATAR_XY[1]}" width="${AVATAR}" height="${AVATAR}" viewBox="0 0 64 64" overflow="visible">
  <g class="w-body">
    <path class="w-tail" d="M43 27C50 24.6 55 17.6 59.4 18.2 62.4 18.8 58.4 27 57.4 33C58.4 39 62.4 47.2 59.4 47.8 55 48.4 50 41.4 43 39Z" fill="url(#skin)" stroke="${LINE}" stroke-width="1.1"/>
    <path class="w-fin" d="M17.4 44.5C13 48.6 14.2 54.8 20 52.8 23.8 51.4 25 47.4 24.2 44Z" fill="${SKIN[2]}" stroke="${LINE}" stroke-width="1.1"/>
    <path d="M27 20.5C29.6 13.2 32.4 8 35.2 4.4 38.2 10 40.2 15.4 40.6 21Z" fill="url(#skin)" stroke="${LINE}" stroke-width="1.1"/>
    <ellipse cx="29" cy="33" rx="20" ry="17" fill="url(#skin)" stroke="${LINE}" stroke-width="1.2"/>
    <path d="M10.3 37C16.8 33 41.2 33 47.7 37A19.3 16.3 0 0 1 10.3 37Z" fill="url(#belly)"/>
    <ellipse cx="19.5" cy="22.5" rx="6.5" ry="3.2" fill="#fff" opacity=".3" transform="rotate(-24 19.5 22.5)"/>
    <g class="w-blush" opacity=".5">
      <ellipse cx="14.6" cy="37.6" rx="3.4" ry="2" fill="#ff86ac"/>
      <ellipse cx="43.4" cy="37.6" rx="3.4" ry="2" fill="#ff86ac"/>
    </g>
    <g class="v v-eyes-calm"><g class="w-eyes">${eye(21.5, 29.5)}${eye(35, 29.5)}</g></g>
    <g class="v v-eyes-star">${starEye(21.5, 29.5)}${starEye(35, 29.5)}</g>
    <g class="v v-eyes-shut">
      <path d="M17.6 29.5C19.4 32.6 23.6 32.6 25.4 29.5" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M31.1 29.5C32.9 32.6 37.1 32.6 38.9 29.5" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
    </g>
    <path class="v v-mouth-calm w-mouth" d="M25.6 39.4C27.2 42.2 30.4 42.2 32 39.4" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
    <path class="v v-mouth-o" d="M25 39.4C26.6 43.4 30.4 43.4 32 39.4Z" fill="${INK}" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
    <path class="v v-mouth-flat" d="M26.4 40.4C27.6 40.4 30 40.4 31.2 40.4" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
  </g>
  <g class="w-spout v v-spout">
    <path d="M20 17C18.8 13.6 21.4 11.6 20.2 8.6" fill="none" stroke="#bcd2ff" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="20.4" cy="6.6" r="1.7" fill="#dbe6ff"/>
    <circle cx="16.4" cy="9.4" r="1.2" fill="#dbe6ff" opacity=".85"/>
    <circle cx="24.2" cy="9" r="1" fill="#dbe6ff" opacity=".7"/>
  </g>
  <g class="v v-eyes-star"><g class="w-sparkle" fill="#ffe066">
    <path d="M0-3.4C.4-.9 .9-.4 3.4 0 .9 .4 .4 .9 0 3.4-.4 .9-.9 .4-3.4 0-.9-.4-.4-.9 0-3.4Z" transform="translate(6 16)"/>
    <path d="M0-2.6C.3-.7 .7-.3 2.6 0 .7 .3 .3 .7 0 2.6-.3 .7-.7 .3-2.6 0-.7-.3-.3-.7 0-2.6Z" transform="translate(54 12)"/>
  </g></g>
</svg>`;
}

//#endregion

//#region 代码猫

/** 猫的配色，取自 `FORM_SKIN.cat` / `FORM_LINE.cat`（承着鲸鱼的蓝）。 */
const CAT_SKIN = ["#b7c4ff", "#7b8cf0", "#4b58c4"];
const CAT_LINE = "#39429b";
/** 眼睛缩放：`FORMS` 里猫的 eyeGrow 是 .95。 */
const CAT_EYE = 0.95;
/** 头像边长：进化档 62（成年 54），所以比鲸鱼那会儿大一圈、也往左上挪一点。 */
const CAT_SIZE = 60;

/** 猫的一只眼睛（和鲸鱼同一套画法，只是缩放不同）。 */
function catEye(cx, cy) {
  const k = CAT_EYE;
  return [
    `<ellipse cx="${cx}" cy="${cy}" rx="${round(4.2 * k)}" ry="${round(5.2 * k)}" fill="${INK}"/>`,
    `<circle cx="${round(cx - 1.3 * k)}" cy="${round(cy - 2 * k)}" r="${round(1.7 * k)}" fill="#fff"/>`,
    `<circle cx="${round(cx + 1.2 * k)}" cy="${round(cy + 2.2 * k)}" r="${round(0.85 * k)}" fill="#fff" opacity=".75"/>`
  ].join("");
}

/**
 * 🐱 代码猫。路径逐字取自 `FORMS[0].art`（猫那一份），层序也照抄
 * `WhaleAvatar`：尾 → 爪 → 耳 → 身 → 肚皮/高光 → 鼻须 → 腮红 → 眼 → 嘴。
 * 只画得着的两张脸：平时 + 睡脸（星星眼那一段它还是鲸鱼）。
 */
function cat() {
  return `<svg class="whale" x="${AVATAR_XY[0] - 3}" y="${AVATAR_XY[1] - 3}" width="${CAT_SIZE}" height="${CAT_SIZE}" viewBox="0 0 64 64" overflow="visible">
  <g class="w-body">
    <path class="w-tail" d="M43.4 50.6C50.6 51.6 55.4 45.2 54.2 38.2C53.6 34.6 49.4 35 49.8 38.4C50.4 43.2 47.4 46.8 42.4 45.8Z" fill="url(#skin-cat)" stroke="${CAT_LINE}" stroke-width="1.1"/>
    <path class="w-fin" d="M23.6 53.6C23.6 50.4 29.4 50.4 29.4 53.6C29.4 56.4 23.6 56.4 23.6 53.6ZM34.6 53.6C34.6 50.4 40.4 50.4 40.4 53.6C40.4 56.4 34.6 56.4 34.6 53.6Z" fill="${CAT_SKIN[2]}" stroke="${CAT_LINE}" stroke-width="1.1"/>
    <path d="M17.6 20.4 16.4 5.6 30.4 13.6Z" fill="url(#skin-cat)" stroke="${CAT_LINE}" stroke-width="1.1"/>
    <path d="M46.4 20.4 47.6 5.6 33.6 13.6Z" fill="url(#skin-cat)" stroke="${CAT_LINE}" stroke-width="1.1"/>
    <path d="M20 18.6 19.2 9.8 27 14.4Z" fill="#f7c6d9" stroke="${CAT_LINE}" stroke-width=".8"/>
    <path d="M44 18.6 44.8 9.8 37 14.4Z" fill="#f7c6d9" stroke="${CAT_LINE}" stroke-width=".8"/>
    <ellipse cx="32" cy="46" rx="13" ry="11" fill="url(#skin-cat)" stroke="${CAT_LINE}" stroke-width="1.2"/>
    <ellipse cx="32" cy="28" rx="16" ry="14" fill="url(#skin-cat)" stroke="${CAT_LINE}" stroke-width="1.2"/>
    <path d="M21.4 45.6C25.6 41.6 38.4 41.6 42.6 45.6A13 11 0 0 1 21.4 45.6Z" fill="url(#belly)"/>
    <ellipse cx="24" cy="19.6" rx="6.2" ry="3" fill="#ffffff" opacity=".3" transform="rotate(-24 24 19.6)"/>
    <path d="M30.6 34.6H33.4L32 36.4Z" fill="${INK}"/>
    <path d="M14.6 32.4 22 34.2M14.8 37 22.2 36.8M49.4 32.4 42 34.2M49.2 37 41.8 36.8" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round" opacity=".55"/>
    <g class="w-blush" opacity=".5">
      <ellipse cx="20.6" cy="34.2" rx="3.4" ry="2" fill="#ff86ac"/>
      <ellipse cx="43.4" cy="34.2" rx="3.4" ry="2" fill="#ff86ac"/>
    </g>
    <g class="v v-cat-calm"><g class="w-eyes">${catEye(25, 28)}${catEye(39, 28)}</g></g>
    <g class="v v-cat-shut">
      <path d="M21.4 28C23.4 31.2 27.4 31.2 29.4 28" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M34.6 28C36.6 31.2 40.6 31.2 42.6 28" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
    </g>
    <path class="v v-cat-calm w-mouth" d="M28.2 37.2C29.6 39.6 32 39.6 32 37.6C32 39.6 34.4 39.6 35.8 37.2" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
    <path class="v v-cat-shut" d="M29.4 38C30.6 38 33.4 38 34.6 38" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
  </g>
</svg>`;
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
  // 头像：变身前是鲸鱼，变身后是猫。两只都画在里面，靠可见性硬切。
  out.push(`<g class="avatar"><g class="v v-whale">${whale()}</g><g class="v v-cat">${cat()}</g></g>`);
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
  parts.push(`.whale *,.food,.avatar{transform-box:fill-box;transform-origin:center}`);
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

  // ---- 表情：平时 / 星星眼（epic 那两口）/ 睡脸。
  const epicFrom = FEEDS[4].at;
  parts.push(window_("k-star", epicFrom, FRENZY[1], 160));
  parts.push(`.v-eyes-star{animation:k-star ${CYCLE}ms linear infinite}`);
  parts.push(`.v-mouth-o{animation:k-star ${CYCLE}ms linear infinite}`);
  parts.push(window_("k-shut", SLEEP[0], CYCLE, 200));
  parts.push(`.v-eyes-shut{animation:k-shut ${CYCLE}ms linear infinite}`);
  parts.push(`.v-mouth-flat{animation:k-shut ${CYCLE}ms linear infinite}`);
  // 平时那套：除了星星眼与睡脸的窗口之外都在。
  parts.push(keyframes("k-calm", [
    [0, "opacity:1"],
    [epicFrom - 160, "opacity:1"],
    [epicFrom, "opacity:0"],
    [FRENZY[1], "opacity:0"],
    [FRENZY[1] + 200, "opacity:1"],
    [SLEEP[0] - 200, "opacity:1"],
    [SLEEP[0], "opacity:0"],
    [CYCLE, "opacity:0"]
  ]));
  parts.push(`.v-eyes-calm,.v-mouth-calm{animation:k-calm ${CYCLE}ms linear infinite}`);
  // 喷水柱：睡着就不喷了。
  parts.push(keyframes("k-spout", [
    [0, "opacity:1"],
    [SLEEP[0] - 200, "opacity:1"],
    [SLEEP[0], "opacity:0"],
    [CYCLE, "opacity:0"]
  ]));
  parts.push(`.v-spout{animation:k-spout ${CYCLE}ms linear infinite}`);
  // Zzz：睡着的时候才飘。
  parts.push(window_("k-zzz", SLEEP[0] + 200, CYCLE, 240));
  parts.push(`.v-zzz-wrap{animation:k-zzz ${CYCLE}ms linear infinite}`);
  parts.push(`.zzz{animation:k-zzz-drift 2.6s ease-in-out infinite}`);
  parts.push(`@keyframes k-zzz-drift{0%{opacity:0;transform:translate(0,2px) scale(.8)}30%{opacity:1}100%{opacity:0;transform:translate(4px,-10px) scale(1.1)}}`);

  // ---- 变身：鲸鱼 / 猫硬切，白光 + 光环 1.6s 走一遍。
  // 切换点埋在白光最浓那一刻（SWAP），所以看不见「一只变两只」的过渡帧。
  parts.push(window_("k-whale", 0, SWAP, 1));
  parts.push(`.v-whale{animation:k-whale ${CYCLE}ms linear infinite}`);
  parts.push(window_("k-cat", SWAP, CYCLE, 1));
  parts.push(`.v-cat{animation:k-cat ${CYCLE}ms linear infinite}`);
  // 猫只有两张脸用得上：平时 + 睡脸（星星眼那一段它还是鲸鱼）。
  parts.push(window_("k-cat-calm", SWAP, SLEEP[0], 1));
  parts.push(`.v-cat-calm{animation:k-cat-calm ${CYCLE}ms linear infinite}`);
  parts.push(window_("k-cat-shut", SLEEP[0], CYCLE, 200));
  parts.push(`.v-cat-shut{animation:k-cat-shut ${CYCLE}ms linear infinite}`);
  parts.push(window_("k-morph", MORPH[0], MORPH[1], 1));
  parts.push(`.v-morph{animation:k-morph ${CYCLE}ms linear infinite}`);
  // 照抄 `@keyframes dshpet-morph`：0% 白到底 → 25% 涨过头 → 50% 白光退掉
  // （这时候露出来的已经是猫）→ 100% 光环散尽。
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

  // ---- 鲸鱼的待机动作，逐条照抄产物的 keyframes。
  parts.push(`.w-body{animation:w-bob 3.2s ease-in-out infinite}`);
  parts.push(`.w-tail{transform-origin:left center;animation:w-wag 1.6s ease-in-out infinite}`);
  parts.push(`.w-fin{transform-origin:top center;animation:w-fin 2.4s ease-in-out infinite}`);
  parts.push(`.w-eyes{animation:w-blink 5.2s ease-in-out infinite}`);
  parts.push(`.w-spout{animation:w-spout 2.6s ease-out infinite}`);
  parts.push(`.w-sparkle{animation:w-sparkle 1.1s ease-in-out infinite}`);
  parts.push(`@keyframes w-bob{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-1.6px) rotate(1deg)}}`);
  parts.push(`@keyframes w-wag{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(9deg)}}`);
  parts.push(`@keyframes w-fin{0%,100%{transform:rotate(4deg)}50%{transform:rotate(-14deg)}}`);
  parts.push(`@keyframes w-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}`);
  parts.push(`@keyframes w-spout{0%{opacity:0;transform:translateY(3px) scale(.5)}35%{opacity:1;transform:translateY(-1px) scale(1)}100%{opacity:0;transform:translateY(-6px) scale(.7)}}`);
  parts.push(`@keyframes w-sparkle{0%,100%{opacity:.35;transform:scale(.7) rotate(0)}50%{opacity:1;transform:scale(1.15) rotate(45deg)}}`);

  // ---- 尊重「减少动效」：停在第一帧，图还看得懂。
  // 停下来的时候要停在「顶格那一帧」：满连击、星星眼、暖橙边、六条消息都在。
  // `.v-whale` / `.v-name0` 也得点亮：它们现在也是可见性窗口驱动的，漏了就是
  // 一张没有宠物、也没有名字的空卡片。
  const still = [".v-combo5", ".v-eyes-star", ".v-mouth-o", ".v-frenzy", ".v-spout", ".v-vit1", ".v-bub0",
    ".v-whale", ".v-name0"]
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
    <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${SKIN[0]}"/><stop offset=".55" stop-color="${SKIN[1]}"/><stop offset="1" stop-color="${SKIN[2]}"/>
    </linearGradient>
    <linearGradient id="skin-cat" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${CAT_SKIN[0]}"/><stop offset=".55" stop-color="${CAT_SKIN[1]}"/><stop offset="1" stop-color="${CAT_SKIN[2]}"/>
    </linearGradient>
    <radialGradient id="flash">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".95"/>
      <stop offset=".72" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="belly" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".92"/><stop offset="1" stop-color="#d7e2ff" stop-opacity=".85"/>
    </linearGradient>
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
