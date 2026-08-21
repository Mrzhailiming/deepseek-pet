/**
 * 重录 + 复核演示图 `docs/demo.svg`：重出一张 → 静态结构过一遍 → 用无头浏览器
 * 把几个关键时刻**冻帧截图**，再逐点取色，确认画面真的是那么回事。
 *
 *   node docs/check-demo.mjs                # 重出 + 全套复核（推荐）
 *   node docs/check-demo.mjs --no-build     # 只复核树里现成的那张
 *   node docs/check-demo.mjs --keep         # 留下 PNG 自己看（会打印目录）
 *   node docs/check-demo.mjs --strict       # 没有浏览器就算失败（CI 用）
 *   node docs/check-demo.mjs --browser <exe>  # 指定浏览器（也可用 DEMO_BROWSER 环境变量）
 *
 * 为什么要冻帧截图：这张图是 SVG + CSS keyframes，`--virtual-time-budget` 不推
 * CSS 动画的时钟（试过，每个时刻截出来都是同一帧），所以办法是把
 * `animation-delay:-Xms;animation-play-state:paused` 注进 SVG **自己的**
 * `<style>` 里 —— 相当于把整条时间轴按停在第 X 毫秒，然后截这一帧。
 * 注在 HTML 外壳里不管用（试过，五张图字节完全一样）。
 *
 * 为什么要取色而不是「看一眼」：肉眼过图会漏。这里断言的是配色常量本身 ——
 * 猫耳内侧那块粉、变身白光、闭上的眼睛、彩虹飘字那一带有没有东西 —— 图挪了
 * 位置、白光忘了退、海报帧糊成一片白，都会红。
 *
 * 零依赖：PNG 解码是手写的（chunk 遍历 + zlib.inflate + 逐行反滤波），只用 node 自带模块。
 */

import { spawnSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const generator = join(here, "make-demo.mjs");
const target = join(here, "demo.svg");

const args = process.argv.slice(2);
const noBuild = args.includes("--no-build");
const keep = args.includes("--keep");
const strict = args.includes("--strict");
const browserArg = flag("--browser") ?? process.env.DEMO_BROWSER ?? null;

/** 画布尺寸，和 `make-demo.mjs` 里的 W / H 一致（截图窗口就按这个开）。 */
const W = 900;
const H = 420;
/** 一圈多久，和生成器的 CYCLE 一致 —— 帧时刻都是拿它当上限的。 */
const CYCLE = 18000;

const problems = [];
const notes = [];

//#region 1. 重录

if (noBuild) {
  if (!existsSync(target)) fail(`${target} 不存在，去掉 --no-build 先出一张`);
  notes.push("跳过重出（--no-build），复核的是树里现成的那张");
} else {
  const first = generate();
  // 生成器承诺「同样的输入逐字节一样」（好 diff）。跑第二遍验一下这句话。
  const second = generate();
  expect(first === second, "两次生成的字节不一样 —— 生成器不再是确定的（掺进了时间 / 随机数？）");
  notes.push(`重出 demo.svg（${first.length} 字节，一圈 ${CYCLE / 1000}s）`);
}

const svg = readFileSync(target, "utf8");
report("重录");

//#endregion

//#region 2. 静态结构

expect(svg.startsWith("<svg xmlns="), "根元素不是 <svg>");
expect(svg.trimEnd().endsWith("</svg>"), "文件尾巴不是 </svg>（写了一半？）");
// GitHub 的 <img> 不跑 SVG 里的 JS，所以这里一行脚本都不能有；顺带把内联事件也堵上。
expect(!/<script/i.test(svg), "SVG 里出现了 <script> —— GitHub 的 <img> 不跑它，等于白写");
expect(!/\son[a-z]+\s*=/i.test(svg), "SVG 里出现了内联事件属性");
expect(svg.includes("<title>"), "缺 <title>（鼠标悬停时的说明）");
expect(/role="img"/.test(svg), "根元素缺 role=\"img\"");
expect(/aria-label="[^"]*代码猫/.test(svg), "aria-label 里没提到进化后的形态（无障碍读屏会漏掉最新玩法）");
expect(new RegExp(`viewBox="0 0 ${W} ${H}"`).test(svg), `根 viewBox 不是 0 0 ${W} ${H}`);

// 实体只允许这几个 —— 裸 & 会让整张图在严格解析器里报错。
for (const bad of svg.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)\S{0,8}/g) ?? []) {
  expect(false, `出现了没转义的实体：${bad}`);
}
expect(tagBalance(svg) === null, `标签没配平：${tagBalance(svg) ?? ""}`);

// keyframe 的百分比不许越界（越界的那条会被浏览器整段丢掉，而且不报错）。
for (const m of svg.match(/(\d+(?:\.\d+)?)%\s*\{/g) ?? []) {
  const v = Number.parseFloat(m);
  expect(v <= 100, `keyframe 里有超过 100% 的停靠点：${m.trim()}`);
}

report("结构");

//#endregion

//#region 3. 时间轴齐全

/** 每条玩法在图里的落点：class 名 → 这条玩法叫什么（红了好定位）。 */
const REQUIRED_CLASS = {
  "v-whale": "鲸鱼（变身前）",
  "v-cat": "代码猫（变身后）",
  "v-cat-calm": "猫的平常脸",
  "v-cat-shut": "猫的睡脸",
  "v-morph": "变身那一段",
  "morph-flash": "变身白光",
  "morph-ring": "变身光环",
  "v-eyes-star": "星星眼（epic 连击）",
  "v-eyes-shut": "鲸鱼睡脸",
  "v-mouth-o": "张嘴（epic）",
  "v-spout": "喷水柱",
  "v-frenzy": "暴食那圈暖橙边",
  "v-zzz-wrap": "睡着的 💤",
  "v-badge-new": "新解锁的徽章",
  "g-full": "饱食度条",
  "g-exp": "经验条",
  "w-body": "身体（承重类名）",
  "w-tail": "尾巴（承重类名）",
  "w-fin": "鳍 / 爪（承重类名）",
  "w-eyes": "眼睛（承重类名）"
};
/** 只检查「元素上有这个 class」，不要求独立 CSS 规则（它们走的是组合选择器）。 */
const REQUIRED_ELEM_ONLY = {
  "w-mouth": "嘴（承重类名）",
  "w-blush": "腮红（承重类名）"
};
for (const [cls, what] of Object.entries(REQUIRED_CLASS)) {
  expect(new RegExp(`\\.${cls}[,{ ]`).test(svg), `CSS 里没有 .${cls} 的规则 —— ${what}`);
  expect(new RegExp(`class="[^"]*\\b${cls}\\b`).test(svg), `画面里没有挂 ${cls} 的元素 —— ${what}`);
}
for (const [cls, what] of Object.entries(REQUIRED_ELEM_ONLY)) {
  expect(new RegExp(`class="[^"]*\\b${cls}\\b`).test(svg), `画面里没有挂 ${cls} 的元素 —— ${what}`);
}

/** 成组出现的那些（i 从 0 数到 n-1，缺一个就是漏了一拍）。 */
const REQUIRED_SERIES = {
  "v-msg": [6, "会话区的消息"],
  f: [6, "飞过来的食物"],
  fl: [6, "喂食飘字"],
  nt: [5, "通知飘字"],
  "v-combo": [6, "连击徽标"],
  "v-bub": [6, "台词气泡"],
  "v-vit": [5, "心情 / 精力那一行"],
  "v-name": [2, "名字行（变身前后各一版）"]
};
for (const [prefix, [n, what]] of Object.entries(REQUIRED_SERIES)) {
  for (let i = 0; i < n; i += 1) {
    expect(new RegExp(`class="[^"]*\\b${prefix}${i}\\b`).test(svg), `缺 ${prefix}${i} —— ${what} 第 ${i + 1} 个`);
  }
  expect(!new RegExp(`class="[^"]*\\b${prefix}${n}\\b`).test(svg), `多出了 ${prefix}${n} —— ${what} 的数量和这支脚本的预期不一致，对一下`);
}

/** 必须出现在画面上的文案 —— 玩法清单的「最新」就体现在这几句上。 */
const REQUIRED_TEXT = [
  "成就 · 满连击",
  "任务达成 · 今日喂食 10 次",
  "进阶 · 传说金鲸",
  "进化 · 代码猫",
  "深深 · Lv.9 成年",
  "深深 · Lv.10 代码猫",
  "我变样了！"
];
for (const line of REQUIRED_TEXT) expect(svg.includes(line), `画面里找不到这句：「${line}」`);

// 时长：可见性窗口全部跑在一圈上；只有几个「自己循环」的小动作是例外。
const EXPECTED_SHORT = new Set(["k-zzz-drift", "w-bob", "w-sparkle", "w-wag", "w-fin", "w-blink", "w-spout"]);
const shortOnes = new Set();
for (const m of svg.matchAll(/animation:([\w-]+) ([\d.]+)(ms|s)/g)) {
  const ms = m[3] === "s" ? Number.parseFloat(m[2]) * 1000 : Number.parseFloat(m[2]);
  if (ms !== CYCLE) shortOnes.add(m[1]);
}
for (const name of shortOnes) {
  expect(EXPECTED_SHORT.has(name), `${name} 的时长不是一圈（${CYCLE}ms）也不在「自己循环的小动作」名单里`);
}
for (const name of EXPECTED_SHORT) {
  expect(shortOnes.has(name), `${name} 应该是个自己循环的小动作，现在却按一圈在跑`);
}

report("时间轴");

//#endregion

//#region 4. 减少动效

const stillMatch = svg.match(/@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\}\s*(?:<\/style>|\n)/);
expect(stillMatch !== null, "没有 prefers-reduced-motion 那一段 —— 关掉动效的人会看到一张空卡片");
if (stillMatch !== null) {
  const still = stillMatch[1];
  expect(still.includes("animation:none!important"), "减少动效时没有把动画停掉");
  // 停下来那一帧要停在「顶格」：宠物、名字、满连击、星星眼、暖橙边、飘字都在。
  for (const cls of [".v-whale", ".v-name0", ".v-combo5", ".v-eyes-star", ".v-mouth-o", ".v-frenzy", ".v-spout", ".fl4"]) {
    expect(still.includes(cls), `海报帧漏了 ${cls} —— 停下来那一帧会缺这块`);
  }
  // 反过来：猫和白光**不许**点亮。变身是一瞬间的事，海报上留一块白就废了。
  expect(!/\.v-cat\b/.test(still), "海报帧点亮了 .v-cat —— 会同时看到鲸鱼和猫");
  expect(!/\.v-morph\b/.test(still), "海报帧点亮了 .v-morph —— 头像上会糊着一块白光");
}

report("减少动效");

//#endregion

//#region 5. 冻帧截图 + 取色

/**
 * 要截的几个时刻。`at: null` 表示「不冻帧，改成强制减少动效」，也就是海报帧。
 */
const FRAMES = [
  { key: "whale", at: 1800, what: "金档喂食 · 还是鲸鱼" },
  { key: "notice", at: 5800, what: "彩虹飘字 · 成就解锁" },
  { key: "flash", at: 10700, what: "变身白光最浓那一下" },
  { key: "cat", at: 13500, what: "变身完成 · 代码猫" },
  { key: "sleep", at: 16500, what: "睡着 · 猫闭着眼" },
  { key: "poster", at: null, what: "减少动效的海报帧" }
];

/**
 * 取色点（页面坐标，和 SVG 的 viewBox 1:1）。
 * 头像有个 3.2s 的呼吸位移（w-bob），所以每个点都取 5×5 的均值而不是单像素。
 */
const POINTS = {
  logo: [36, 18, "左上角那颗蓝点（对位用：色不对说明截图缩放或窗口尺寸错了）"],
  whaleBody: [534, 304, "鲸鱼身体中心（viewBox 内）"],
  catEar: [541, 289, "猫左耳内侧那块粉"],
  catEye: [545, 303, "猫的左眼瞳孔中心"],
  flashCenter: [552, 302, "白光正中"],
  cardBg: [700, 350, "卡片空白处（底色）"]
};
/** 飘字那一带：喂食 / 通知的大字就飘在这个盒子里。 */
const FLOAT_BOX = [518, 236, 650, 258];

const browser = browserArg ?? findBrowser();
if (browser === null) {
  const msg = "找不到无头浏览器（Edge / Chrome），跳过截图复核；用 --browser <exe> 或 DEMO_BROWSER 指定";
  if (strict) fail(msg);
  notes.push(msg);
  report("取色");
} else {
  notes.push(`用 ${browser} 截图`);
  const work = mkdtempSync(join(tmpdir(), "demo-check-"));
  try {
    const shots = new Map();
    for (const frame of FRAMES) {
      const png = shoot(browser, work, frame);
      shots.set(frame.key, decodePng(png));
    }

    const whale = shots.get("whale");
    const notice = shots.get("notice");
    const flash = shots.get("flash");
    const cat = shots.get("cat");
    const sleep = shots.get("sleep");
    const poster = shots.get("poster");

    // 每一帧都先对位：那颗蓝点不动、卡片底色是暗的。错了说明截图本身不对，
    // 后面的取色全都不用看了。
    for (const [key, img] of shots) {
      expect(img.w === W && img.h === H, `${key} 帧的尺寸是 ${img.w}×${img.h}，不是 ${W}×${H}`);
      expect(near(at(img, "logo"), "#4d6bfe", 26), `${key} 帧对位失败：左上角那颗点是 ${hex(at(img, "logo"))}，该是 #4d6bfe`);
      expect(bright(at(img, "cardBg")) < 70, `${key} 帧的卡片底色被照亮了（${hex(at(img, "cardBg"))}）`);
    }

    // 变身前：蓝鲸在那儿，猫耳那个位置不该有粉。
    expect(bluish(at(whale, "whaleBody")), `变身前头像不是蓝鲸的蓝：${hex(at(whale, "whaleBody"))}`);
    expect(!pinkish(at(whale, "catEar")), `变身前就看到猫耳的粉了：${hex(at(whale, "catEar"))}`);

    // 白光那一下：白光正中是纯白（>250）。
    expect(bright(at(flash, "flashCenter")) > 250, `白光那一帧头像没被糊白：${hex(at(flash, "flashCenter"))}`);

    // 变身后：猫耳的粉出来了、眼睛是睁着的（瞳孔是深色 <85）、白光退掉了（<250）。
    expect(pinkish(at(cat, "catEar")), `变身后没看到猫耳的粉：${hex(at(cat, "catEar"))}`);
    expect(bright(at(cat, "catEye")) < 85, `变身后猫的眼睛不是深色的（没睁眼？）：${hex(at(cat, "catEye"))}`);
    expect(bright(at(cat, "flashCenter")) < 250, `变身之后白光还留在头像上：${hex(at(cat, "flashCenter"))}`);

    // 睡着：还是猫（身体不是鲸鱼那种纯蓝），而且眼睛闭上了 —— 瞳孔那一格比睁着时亮。
    expect(!bluish(at(sleep, "whaleBody")), `睡着的时候变回鲸鱼了：${hex(at(sleep, "whaleBody"))}`);
    expect(bright(at(sleep, "catEye")) > bright(at(cat, "catEye")) + 20,
      `猫的眼睛没闭上：睁眼 ${hex(at(cat, "catEye"))} / 睡着 ${hex(at(sleep, "catEye"))}`);

    // 飘字：该有的时候有一大片字，该清场的时候一个像素都不剩。
    const noticeInk = coverage(notice, FLOAT_BOX);
    const cleanInk = coverage(cat, FLOAT_BOX);
    expect(noticeInk > 150, `彩虹飘字那一帧几乎没有字（亮像素 ${noticeInk} 个）`);
    expect(cleanInk < 40, `该清场的那一帧飘字还赖着（亮像素 ${cleanInk} 个）`);

    // 海报帧（减少动效）：蓝鲸在那儿（=没有变成猫）、白光没糊住、飘字都在。
    // 注意：猫耳那个像素点被成就飘字的橙色覆盖了，所以不能用它来判断「没有猫」——
    // 用鲸鱼身体是蓝的来证明（猫的身体是紫的，两者不会搞混）。
    expect(bluish(at(poster, "whaleBody")), `海报帧的头像不是蓝鲸：${hex(at(poster, "whaleBody"))}`);
    expect(bright(at(poster, "flashCenter")) < 240, `海报帧的头像上糊着一块白光：${hex(at(poster, "flashCenter"))}`);
    expect(coverage(poster, FLOAT_BOX) > 150, "海报帧上没有飘字 —— 停下来那一帧看不出在干什么");

    notes.push(`截了 ${shots.size} 帧：${FRAMES.map((f) => f.key).join(" / ")}`);
    if (keep) notes.push(`PNG 留在 ${work}`);
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
  report("取色");
}

//#endregion

const kib = (svg.length / 1024).toFixed(1);
console.log(`
✓ docs/demo.svg 复核通过（${kib} KiB，一圈 ${CYCLE / 1000}s）

  ${target}

README 里那张图就是它（<img src="docs/demo.svg">），改完玩法记得重跑这支脚本。
`);

//#region 工具

/**
 * 跑一遍生成器，返回它写出来的内容。
 * @returns demo.svg 的文本。
 */
function generate() {
  const run = spawnSync(process.execPath, [generator], { cwd: repoRoot, encoding: "utf8" });
  if (run.status !== 0) fail(`生成器跑挂了：\n${run.stderr || run.stdout}`);
  return readFileSync(target, "utf8");
}

/**
 * 把整条时间轴按停在某一刻，截一张图。
 * @param exe - 浏览器可执行文件。
 * @param work - 临时目录。
 * @param frame - FRAMES 里的一项。
 * @returns PNG 的字节。
 */
function shoot(exe, work, frame) {
  const file = join(work, `${frame.key}.svg`);
  const png = join(work, `${frame.key}.png`);
  // 注进 SVG 自己的 <style> 尾巴 —— 注在外壳里不管用。
  const frozen = frame.at === null
    ? svg
    : svg.replace(/\n?\s*<\/style>/, `\n    *{animation-delay:-${frame.at}ms!important;animation-play-state:paused!important}\n    </style>`);
  expect(frame.at === null || frozen !== svg, `${frame.key} 帧没找到 </style>，冻帧失败`);
  writeFileSync(file, frozen, "utf8");

  const argv = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${W},${H}`,
    `--screenshot=${png.replace(/\\/g, "/")}`,
    pathToFileURL(file).href
  ];
  if (frame.at === null) argv.splice(1, 0, "--force-prefers-reduced-motion");
  const run = spawnSync(exe, argv, { encoding: "utf8", timeout: 90_000 });
  if (!existsSync(png)) fail(`${frame.key} 帧没截出来（${frame.what}）：\n${run.stderr || run.stdout || run.error?.message || ""}`);
  return readFileSync(png);
}

/**
 * 找一个能用的无头浏览器。
 * @returns 可执行文件路径，找不到返回 null。
 */
function findBrowser() {
  const candidates = process.platform === "win32"
    ? [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
    ]
    : [
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ];
  for (const exe of candidates) if (existsSync(exe)) return exe;
  return null;
}

/**
 * 解 PNG（8bit / 灰度 / RGB / RGBA），只用 zlib。
 * @param buf - 文件字节。
 * @returns 宽高、通道数与逐像素的原始字节。
 */
function decodePng(buf) {
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8) fail(`PNG 不是 8bit（实际 ${depth}）`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : -1;
  if (channels < 0) fail(`不认识的 PNG colorType ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = Buffer.alloc(h * stride);
  // 逐行反滤波（PNG 的五种：None / Sub / Up / Average / Paeth）。
  for (let y = 0; y < h; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y === 0 ? null : px.subarray((y - 1) * stride, y * stride);
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev === null ? 0 : prev[x];
      const c = x >= channels && prev !== null ? prev[x - channels] : 0;
      const v = line[x];
      if (filter === 0) cur[x] = v;
      else if (filter === 1) cur[x] = (v + a) & 255;
      else if (filter === 2) cur[x] = (v + b) & 255;
      else if (filter === 3) cur[x] = (v + ((a + b) >> 1)) & 255;
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        cur[x] = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
  }
  return { w, h, channels, px };
}

/**
 * 取一个像素。
 * @param img - decodePng 的结果。
 * @param x - 横坐标。
 * @param y - 纵坐标。
 * @returns `[r, g, b]`。
 */
function pixel(img, x, y) {
  const i = y * img.w * img.channels + x * img.channels;
  return img.channels === 1
    ? [img.px[i], img.px[i], img.px[i]]
    : [img.px[i], img.px[i + 1], img.px[i + 2]];
}

/**
 * 取 POINTS 里某个点 —— 单像素，因为坐标已经校准到具体部件的中心。
 * @param img - 帧。
 * @param name - POINTS 的键。
 * @returns `[r, g, b]`。
 */
function at(img, name) {
  const [x, y] = POINTS[name];
  return pixel(img, x, y);
}

/**
 * 数一个盒子里「亮」的像素有多少 —— 用来问「这儿到底有没有字」。
 * @param img - 帧。
 * @param box - `[x1, y1, x2, y2]`。
 * @returns 亮像素个数。
 */
function coverage(img, [x1, y1, x2, y2]) {
  let n = 0;
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) if (bright(pixel(img, x, y)) > 120) n += 1;
  }
  return n;
}

/** 亮度（取最大通道，够用了）。 */
function bright(rgb) {
  return Math.max(rgb[0], rgb[1], rgb[2]);
}

/** 鲸鱼那种纯蓝（B-R > 80, B > 150）—— 和猫的紫蓝（B-R < 70）区分开。 */
function bluish(rgb) {
  return rgb[2] - rgb[0] > 80 && rgb[2] > 150;
}

/** 偏粉（猫耳内侧那块 #f7c6d9）。 */
function pinkish(rgb) {
  return rgb[0] - rgb[2] > 12 && rgb[0] > 120;
}

/** 和某个色差不多。 */
function near(rgb, want, tol) {
  const w = [1, 3, 5].map((i) => Number.parseInt(want.slice(i, i + 2), 16));
  return rgb.every((v, i) => Math.abs(v - w[i]) <= tol);
}

/** `[r,g,b]` → `#rrggbb`。 */
function hex(rgb) {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * 粗略配平一遍标签，抓「写了一半」这类事故。
 * @param source - SVG 文本。
 * @returns 出错说明，配平就返回 null。
 */
function tagBalance(source) {
  const stack = [];
  for (const m of source.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    const [, slash, name, rest] = m;
    if (rest.endsWith("/")) continue;
    if (slash === "") stack.push(name);
    else if (stack.pop() !== name) return `多了一个 </${name}>`;
  }
  return stack.length === 0 ? null : `没关掉：${stack.join(" > ")}`;
}

/**
 * 取一个 `--flag value` 参数。
 * @param name - 参数名，含前缀。
 * @returns 参数值，没给返回 null。
 */
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : null;
}

/**
 * 记一条问题。
 * @param ok - 条件。
 * @param message - 不成立时说什么。
 */
function expect(ok, message) {
  if (!ok) problems.push(message);
}

/**
 * 直接中断（连往下检查都没意义的那种）。
 * @param message - 说明。
 */
function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/**
 * 打印一个阶段的结果；有失败就整体退出。
 * @param stage - 阶段名。
 */
function report(stage) {
  if (problems.length === 0) {
    console.log(`✓ ${stage}通过`);
    for (const note of notes.splice(0)) console.log(`  · ${note}`);
    return;
  }
  console.error(`\n✗ ${stage}失败（${problems.length} 项）：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

//#endregion
