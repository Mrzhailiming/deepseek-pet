/**
 * 把 `docs/demo.svg` 逐帧截图，拼成一张 APNG 动图。
 *
 *   node docs/make-apng.mjs                 # 输出 docs/demo.png（APNG）
 *   node docs/make-apng.mjs --fps 10        # 改帧率（默认 5，越高越流畅越大）
 *   node docs/make-apng.mjs --out demo.apng # 改输出文件名
 *   node docs/make-apng.mjs --browser <exe> # 指定浏览器（也可用 DEMO_BROWSER）
 *
 * 原理：把 SVG 的 CSS 动画按在某一刻（注入 animation-delay + paused），用
 * Edge/Chrome 无头截一张 PNG，逐帧重复，最后拼成 APNG（Animated PNG）。
 *
 * APNG 比 GIF 好在哪：真彩（不需要 256 色量化）、文件更小、所有主流浏览器都支持。
 * GitHub 的 <img> 也跑 APNG。
 *
 * 零依赖，只需要 node + 一个 Chromium 内核浏览器。
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32 } from "./apng-crc.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = join(here, "demo.svg");

const args = process.argv.slice(2);
const fps = Number(flag("--fps") ?? 5);
const outFile = resolve(flag("--out") ?? join(here, "demo.png"));
const browserExe = flag("--browser") ?? process.env.DEMO_BROWSER ?? findBrowser();

if (!browserExe) { console.error("找不到浏览器（Edge / Chrome），用 --browser 指定"); process.exit(1); }
if (!existsSync(svgPath)) { console.error("先跑 node docs/make-demo.mjs 生成 demo.svg"); process.exit(1); }

const svg = readFileSync(svgPath, "utf8");
const cycleMatch = svg.match(/animation:\S+ (\d+)ms/);
const CYCLE = cycleMatch ? Number(cycleMatch[1]) : 18000;
const step = Math.round(1000 / fps);
const numFrames = Math.ceil(CYCLE / step);

console.log(`${numFrames} 帧 @ ${fps}fps, 一圈 ${CYCLE}ms, 浏览器: ${browserExe}`);

const work = mkdtempSync(join(tmpdir(), "apng-"));
const frames = [];

try {
  for (let i = 0; i < numFrames; i++) {
    const t = i * step;
    const frozen = svg.replace(
      /\n?\s*<\/style>/,
      `\n    *{animation-delay:-${t}ms!important;animation-play-state:paused!important}\n    </style>`
    );
    const svgFile = join(work, `f${i}.svg`);
    const pngFile = join(work, `f${i}.png`);
    writeFileSync(svgFile, frozen, "utf8");

    const wMatch = svg.match(/width="(\d+)"/);
    const hMatch = svg.match(/height="(\d+)"/);
    const W = wMatch ? Number(wMatch[1]) : 900;
    const H = hMatch ? Number(hMatch[1]) : 420;

    const run = spawnSync(browserExe, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${W},${H}`,
      `--screenshot=${pngFile.replace(/\\/g, "/")}`,
      pathToFileURL(svgFile).href
    ], { timeout: 60000 });

    if (!existsSync(pngFile)) {
      console.error(`第 ${i} 帧截图失败（t=${t}ms）：\n${run.stderr || run.error?.message || ""}`);
      process.exit(1);
    }
    frames.push(readFileSync(pngFile));
    if ((i + 1) % 10 === 0 || i === numFrames - 1) {
      process.stdout.write(`\r  截图 ${i + 1}/${numFrames}`);
    }
  }
  console.log("");

  const apng = assembleApng(frames, step);
  writeFileSync(outFile, apng);
  const kib = (apng.length / 1024).toFixed(1);
  console.log(`✓ 写好了 ${outFile}（${kib} KiB, ${numFrames} 帧, ${fps}fps, ${(CYCLE / 1000).toFixed(1)}s 一圈）`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

/**
 * 把一组 PNG 帧拼成 APNG。
 * APNG = 标准 PNG + acTL 动画头 + 每帧 fcTL + IDAT/fdAT。
 */
function assembleApng(pngs, delayMs) {
  const parts = [];
  let seq = 0;

  // 解析第一帧拿 IHDR 和画布尺寸
  const first = parsePng(pngs[0]);

  // PNG signature
  parts.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  // IHDR
  parts.push(makeChunk("IHDR", first.ihdr));
  // acTL (animation control)
  parts.push(makeChunk("acTL", acTL(pngs.length, 0)));

  for (let i = 0; i < pngs.length; i++) {
    const frame = parsePng(pngs[i]);
    const w = frame.ihdr.readUInt32BE(0);
    const h = frame.ihdr.readUInt32BE(4);

    // fcTL
    parts.push(makeChunk("fcTL", fcTL(seq++, w, h, 0, 0, delayMs, 1000, 0, 0)));

    if (i === 0) {
      // 第一帧用 IDAT
      for (const chunk of frame.idat) parts.push(makeChunk("IDAT", chunk));
    } else {
      // 后续帧用 fdAT（= seq + IDAT data）
      for (const chunk of frame.idat) {
        const buf = Buffer.alloc(4 + chunk.length);
        buf.writeUInt32BE(seq++, 0);
        chunk.copy(buf, 4);
        parts.push(makeChunk("fdAT", buf));
      }
    }
  }

  parts.push(makeChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function parsePng(buf) {
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") ihdr = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  return { ihdr, idat };
}

function makeChunk(type, data) {
  const buf = Buffer.alloc(12 + data.length);
  buf.writeUInt32BE(data.length, 0);
  buf.write(type, 4, 4, "ascii");
  data.copy(buf, 8);
  const crcData = Buffer.alloc(4 + data.length);
  crcData.write(type, 0, 4, "ascii");
  data.copy(crcData, 4);
  buf.writeUInt32BE(crc32(crcData) >>> 0, 8 + data.length);
  return buf;
}

function acTL(numFrames, numPlays) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(numFrames, 0);
  buf.writeUInt32BE(numPlays, 4);
  return buf;
}

function fcTL(seq, w, h, x, y, delayNum, delayDen, disposeOp, blendOp) {
  const buf = Buffer.alloc(26);
  buf.writeUInt32BE(seq, 0);
  buf.writeUInt32BE(w, 4);
  buf.writeUInt32BE(h, 8);
  buf.writeUInt32BE(x, 12);
  buf.writeUInt32BE(y, 16);
  buf.writeUInt16BE(delayNum, 20);
  buf.writeUInt16BE(delayDen, 22);
  buf[24] = disposeOp;
  buf[25] = blendOp;
  return buf;
}

function findBrowser() {
  const candidates = process.platform === "win32"
    ? [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe"
    ]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"];
  for (const exe of candidates) if (existsSync(exe)) return exe;
  return null;
}

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : null;
}
