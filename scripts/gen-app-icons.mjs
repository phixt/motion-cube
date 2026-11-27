/**
 * 生成 motion-cube 全套高质感 Tauri 应用图标（暗底折光拧转 3×3 速拧魔方）：
 * - 严格三维等轴投影 + 顶层 28° 优雅拧转（呼应 Motion 主题）
 * - 层间错缝透出内挖球面空腔弧光与清透棱镜色散光带（与开始页新魔方视觉同源）
 * - 自动导出全套 PNG（32..512 + Windows Store 磁贴）与多分辨率 icon.ico / uninstaller.ico
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchBrowser } from "./_browser.mjs";

const ICON_DIR = resolve("src-tauri/icons");

const PNG_TARGETS = [
  { file: "icon.png", size: 512 },
  { file: "128x128@2x.png", size: 256 },
  { file: "128x128.png", size: 128 },
  { file: "64x64.png", size: 64 },
  { file: "32x32.png", size: 32 },
  { file: "StoreLogo.png", size: 50 },
  { file: "Square30x30Logo.png", size: 30 },
  { file: "Square44x44Logo.png", size: 44 },
  { file: "Square71x71Logo.png", size: 71 },
  { file: "Square89x89Logo.png", size: 89 },
  { file: "Square107x107Logo.png", size: 107 },
  { file: "Square142x142Logo.png", size: 142 },
  { file: "Square150x150Logo.png", size: 150 },
  { file: "Square284x284Logo.png", size: 284 },
  { file: "Square310x310Logo.png", size: 310 },
];

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** 将多张 PNG Buffer 打包为标准 Windows PNG-in-ICO 二进制文件 */
function packIco(entries) {
  const headerSize = 6 + entries.length * 16;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = ICO
  header.writeUInt16LE(entries.length, 4);

  for (let i = 0; i < entries.length; i++) {
    const { size, png } = entries[i];
    const base = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, base);
    header.writeUInt8(size >= 256 ? 0 : size, base + 1);
    header.writeUInt8(0, base + 2);
    header.writeUInt8(0, base + 3);
    header.writeUInt16LE(1, base + 4);
    header.writeUInt16LE(32, base + 6);
    header.writeUInt32LE(png.length, base + 8);
    header.writeUInt32LE(offset, base + 12);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

const ICON_HTML = /* html */ `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  canvas { display: block; }
</style></head>
<body>
<canvas id="c" width="1024" height="1024"></canvas>
<script>
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

function renderMaster(size) {
  canvas.width = size;
  canvas.height = size;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  const S = size / 1024;
  ctx.scale(S, S);

  // 1) 深邃午夜靛蓝圆角底板（Squircle，16px~512px 全尺寸高对比辨识）
  const pad = 28;
  const w = 1024 - pad * 2;
  const rad = 224;
  function traceSquircle(x, y, ww, hh, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + ww - r, y);
    ctx.quadraticCurveTo(x + ww, y, x + ww, y + r);
    ctx.lineTo(x + ww, y + hh - r);
    ctx.quadraticCurveTo(x + ww, y + hh, x + ww - r, y + hh);
    ctx.lineTo(x + r, y + hh);
    ctx.quadraticCurveTo(x, y + hh, x, y + hh - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  traceSquircle(pad, pad, w, w, rad);
  const bgGrad = ctx.createLinearGradient(120, 60, 900, 960);
  bgGrad.addColorStop(0.0, "#17233D");
  bgGrad.addColorStop(0.52, "#0E1629");
  bgGrad.addColorStop(1.0, "#080D1A");
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // 裁剪在底板内绘制环境微光与折光魔方
  ctx.save();
  traceSquircle(pad, pad, w, w, rad);
  ctx.clip();

  // 魔方背后克制的棱镜微光场
  const glowA = ctx.createRadialGradient(520, 490, 40, 520, 490, 430);
  glowA.addColorStop(0.0, "rgba(72, 186, 255, 0.28)");
  glowA.addColorStop(0.45, "rgba(92, 128, 255, 0.11)");
  glowA.addColorStop(1.0, "rgba(10, 16, 30, 0)");
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, 1024, 1024);

  // 右下暖金/青紫微弱焦散光弧
  const glowB = ctx.createRadialGradient(640, 770, 16, 620, 770, 220);
  glowB.addColorStop(0.0, "rgba(128, 232, 255, 0.34)");
  glowB.addColorStop(0.5, "rgba(130, 114, 255, 0.12)");
  glowB.addColorStop(1.0, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, 1024, 1024);

  // 底部柔影
  ctx.save();
  ctx.translate(512, 816);
  ctx.scale(1.0, 0.34);
  const shGrad = ctx.createRadialGradient(0, 0, 24, 0, 0, 290);
  shGrad.addColorStop(0.0, "rgba(2, 5, 12, 0.65)");
  shGrad.addColorStop(1.0, "rgba(2, 5, 12, 0)");
  ctx.fillStyle = shGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 290, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // === 严格 3D 透视投影引擎（绘制真实 28° 拧转倒角魔方） ===
  const yaw = 0.64;    // 36.7°
  const pitch = 0.44;  // 25.2°
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);

  function rotY(p, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
  }
  function toCam(p) {
    const x1 = p[0] * cy - p[2] * sy;
    const z1 = p[0] * sy + p[2] * cy;
    const y2 = p[1] * cp - z1 * sp;
    const z2 = p[1] * sp + z1 * cp;
    return [x1, y2, z2];
  }
  function project(p) {
    const c = toCam(p);
    const camZ = 9.0;
    const f = 1720 / (camZ - c[2]);
    return [512 + c[0] * f, 506 - c[1] * f, c[2]];
  }

  // 绘制带圆角的 3D 投影四边形（用于每个立体小面贴片）
  function drawQuad3D(pts3, fillStyle, strokeStyle, lineWidth, cornerShrink = 0.14) {
    const pts = pts3.map(project);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const prev = pts[(i + 3) % 4];
      const cur = pts[i];
      const next = pts[(i + 1) % 4];
      const ax = cur[0] + (prev[0] - cur[0]) * cornerShrink;
      const ay = cur[1] + (prev[1] - cur[1]) * cornerShrink;
      const bx = cur[0] + (next[0] - cur[0]) * cornerShrink;
      const by = cur[1] + (next[1] - cur[1]) * cornerShrink;
      if (i === 0) ctx.moveTo(ax, ay);
      else ctx.lineTo(ax, ay);
      ctx.quadraticCurveTo(cur[0], cur[1], bx, by);
    }
    ctx.closePath();
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  // 生成单层（y0..y1）的 3D 块体与全部可见贴片
  function buildLayerFaces(y0, y1, twistRad, isTopLayer) {
    const S1 = 1.18;
    const faces = [];

    function pushBox(x0, x1, yy0, yy1, z0, z1, isTile, colA, colB, strokeCol, rim) {
      const quads = [
        { n: [0, 1, 0], pts: [[x0, yy1, z0], [x1, yy1, z0], [x1, yy1, z1], [x0, yy1, z1]], f: "U" },
        { n: [0, -1, 0], pts: [[x0, yy0, z1], [x1, yy0, z1], [x1, yy0, z0], [x0, yy0, z0]], f: "D" },
        { n: [0, 0, 1], pts: [[x0, yy0, z1], [x1, yy0, z1], [x1, yy1, z1], [x0, yy1, z1]], f: "F" },
        { n: [0, 0, -1], pts: [[x1, yy0, z0], [x0, yy0, z0], [x0, yy1, z0], [x1, yy1, z0]], f: "B" },
        { n: [1, 0, 0], pts: [[x1, yy0, z1], [x1, yy0, z0], [x1, yy1, z0], [x1, yy1, z1]], f: "R" },
        { n: [-1, 0, 0], pts: [[x0, yy0, z0], [x0, yy0, z1], [x0, yy1, z1], [x0, yy1, z0]], f: "L" },
      ];
      for (const q of quads) {
        const nr = rotY(q.n, twistRad);
        const nc = toCam(nr);
        if (nc[2] <= -0.02) continue; // 背面剔除
        const rPts = q.pts.map((p) => rotY(p, twistRad));
        const depth = rPts.reduce((acc, p) => acc + toCam(p)[2], 0) / 4;
        faces.push({
          pts: rPts,
          depth,
          face: q.f,
          isTile,
          colA,
          colB,
          strokeCol,
          rim,
          nCam: nc,
          isTopLayer,
        });
      }
    }

    // 层内暗靛色骨架盒（衬托 3×3 块缝）
    pushBox(-S1, S1, y0, y1, -S1, S1, false, "#111C34", "#0A1224", "rgba(148, 206, 255, 0.28)", 0.08);

    // 9 列网格贴片（根据层高划分 1 行或 2 行）
    const rows = isTopLayer ? [0] : [0, 1];
    const rowH = (y1 - y0) / rows.length;
    const cellW = (S1 * 2) / 3;
    const padT = 0.058;
    const lift = 0.014;

    const palette = {
      U: ["#F8FCFF", "#C4E2FF", "rgba(255,255,255,0.85)"],
      F: ["#38B0FF", "#1662E0", "rgba(170,230,255,0.55)"],
      R: ["#32E4A4", "#0C966C", "rgba(176,255,228,0.52)"],
      L: ["#FFB046", "#E85B32", "rgba(255,228,176,0.58)"],
      B: ["#6E78FF", "#3A3EC8", "rgba(198,204,255,0.48)"],
      D: ["#FFD84D", "#E09A18", "rgba(255,242,186,0.45)"],
    };

    // 侧壁 4 面小块贴片
    for (const r of rows) {
      const ry0 = y0 + r * rowH + padT;
      const ry1 = y0 + (r + 1) * rowH - padT;
      for (let c = 0; c < 3; c++) {
        const c0 = -S1 + c * cellW + padT;
        const c1 = -S1 + (c + 1) * cellW - padT;
        const sideDefs = [
          { f: "F", n: [0, 0, 1], pts: [[c0, ry0, S1 + lift], [c1, ry0, S1 + lift], [c1, ry1, S1 + lift], [c0, ry1, S1 + lift]] },
          { f: "B", n: [0, 0, -1], pts: [[c1, ry0, -S1 - lift], [c0, ry0, -S1 - lift], [c0, ry1, -S1 - lift], [c1, ry1, -S1 - lift]] },
          { f: "R", n: [1, 0, 0], pts: [[S1 + lift, ry0, c1], [S1 + lift, ry0, c0], [S1 + lift, ry1, c0], [S1 + lift, ry1, c1]] },
          { f: "L", n: [-1, 0, 0], pts: [[-S1 - lift, ry0, c0], [-S1 - lift, ry0, c1], [-S1 - lift, ry1, c1], [-S1 - lift, ry1, c0]] },
        ];
        for (const sd of sideDefs) {
          const nr = rotY(sd.n, twistRad);
          const nc = toCam(nr);
          if (nc[2] <= 0.02) continue;
          const rPts = sd.pts.map((p) => rotY(p, twistRad));
          const depth = rPts.reduce((acc, p) => acc + toCam(p)[2], 0) / 4 + 0.03;
          const [ca, cb, st] = palette[sd.f];
          faces.push({ pts: rPts, depth, face: sd.f, isTile: true, colA: ca, colB: cb, strokeCol: st, rim: 0.22, nCam: nc, isTopLayer });
        }
      }
    }

    // 顶面 3×3 冰白晶格贴片（仅顶层可见）
    if (isTopLayer) {
      for (let ix = 0; ix < 3; ix++) {
        for (let iz = 0; iz < 3; iz++) {
          const x0 = -S1 + ix * cellW + padT;
          const x1 = -S1 + (ix + 1) * cellW - padT;
          const z0 = -S1 + iz * cellW + padT;
          const z1 = -S1 + (iz + 1) * cellW - padT;
          const rPts = [[x0, y1 + lift, z0], [x1, y1 + lift, z0], [x1, y1 + lift, z1], [x0, y1 + lift, z1]].map((p) => rotY(p, twistRad));
          const depth = rPts.reduce((acc, p) => acc + toCam(p)[2], 0) / 4 + 0.04;
          const [ca, cb, st] = palette.U;
          faces.push({
            pts: rPts,
            depth,
            face: "U",
            isTile: true,
            colA: ca,
            colB: cb,
            strokeCol: st,
            rim: (ix === 1 && iz === 1) ? 0.30 : 0.21,
            nCam: toCam([0, 1, 0]),
            isTopLayer,
          });
        }
      }
    }
    return faces;
  }

  function paintFaceList(faces) {
    // 先绘深靛色层体骨架，再按深度从远到近绘制全部 3×3 彩色圆角贴片（杜绝骨架遮挡后排贴片）
    const bodyFaces = faces.filter((f) => !f.isTile).sort((a, b) => a.depth - b.depth);
    const tileFaces = faces.filter((f) => f.isTile).sort((a, b) => a.depth - b.depth);
    for (const f of [...bodyFaces, ...tileFaces]) {
      const p2 = f.pts.map(project);
      const grad = ctx.createLinearGradient(p2[0][0], p2[0][1], p2[2][0], p2[2][1]);
      grad.addColorStop(0.0, f.colA);
      grad.addColorStop(1.0, f.colB);
      drawQuad3D(f.pts, grad, f.strokeCol, f.isTile ? 3.2 : 3.6, f.rim);
    }
  }

  // 先绘下两层（未拧转）
  const bottomFaces = buildLayerFaces(-1.18, 0.36, 0.0, false);
  paintFaceList(bottomFaces);

  // 层间错缝中露出【内挖球面空腔辉光 + 棱镜色散光带】！
  ctx.save();
  const gapCenter = project([0.0, 0.39, 0.0]);
  const cavGlow = ctx.createRadialGradient(gapCenter[0], gapCenter[1], 14, gapCenter[0], gapCenter[1], 210);
  cavGlow.addColorStop(0.0, "rgba(235, 252, 255, 0.92)");
  cavGlow.addColorStop(0.32, "rgba(92, 224, 255, 0.62)");
  cavGlow.addColorStop(0.65, "rgba(148, 122, 255, 0.26)");
  cavGlow.addColorStop(1.0, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = cavGlow;
  ctx.beginPath();
  ctx.ellipse(gapCenter[0], gapCenter[1], 235, 118, -0.06, 0, Math.PI * 2);
  ctx.fill();

  // 精致旋转轨迹微弧（点题 Motion）
  ctx.strokeStyle = "rgba(180, 238, 255, 0.52)";
  ctx.lineWidth = 4.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(gapCenter[0], gapCenter[1] - 4, 295, 138, 0, 0.16 * Math.PI, 0.44 * Math.PI);
  ctx.stroke();
  ctx.restore();

  // 再绘顶层（顺势拧转 28°！）
  const topFaces = buildLayerFaces(0.42, 1.18, 0.49, true);
  paintFaceList(topFaces);

  // 顶层与主棱边的一缕高光星芒（干净点睛，不杂乱）
  const glintPt = project(rotY([1.14, 1.16, 1.14], 0.49));
  ctx.save();
  ctx.translate(glintPt[0], glintPt[1]);
  const starG = ctx.createRadialGradient(0, 0, 2, 0, 0, 56);
  starG.addColorStop(0.0, "rgba(255, 255, 255, 0.96)");
  starG.addColorStop(0.35, "rgba(166, 234, 255, 0.45)");
  starG.addColorStop(1.0, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = starG;
  ctx.beginPath();
  ctx.arc(0, 0, 56, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.moveTo(0, -34); ctx.lineTo(5.5, -5.5); ctx.lineTo(34, 0); ctx.lineTo(5.5, 5.5);
  ctx.lineTo(0, 34); ctx.lineTo(-5.5, 5.5); ctx.lineTo(-34, 0); ctx.lineTo(-5.5, -5.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore(); // end clip

  // 外缘极细玻璃高光边框
  traceSquircle(pad + 1.5, pad + 1.5, w - 3, w - 3, rad - 1.5);
  const rimGrad = ctx.createLinearGradient(0, pad, 1024, 1024 - pad);
  rimGrad.addColorStop(0.0, "rgba(176, 222, 255, 0.36)");
  rimGrad.addColorStop(0.5, "rgba(110, 152, 224, 0.14)");
  rimGrad.addColorStop(1.0, "rgba(148, 220, 255, 0.24)");
  ctx.strokeStyle = rimGrad;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.restore();
}

window.renderIconDataUrl = (size) => {
  renderMaster(size);
  return canvas.toDataURL("image/png");
};
</script>
</body>
</html>`;

const browser = await launchBrowser({ prefix: "mc-icon-", width: 1024, height: 1024 });
try {
  const page = await browser.newPage();
  await page.setContent(ICON_HTML, { waitUntil: "load" });

  const cache = new Map();
  async function getPng(size) {
    if (cache.has(size)) return cache.get(size);
    const dataUrl = await page.evaluate((s) => window.renderIconDataUrl(s), size);
    const buf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
    cache.set(size, buf);
    return buf;
  }

  for (const t of PNG_TARGETS) {
    const png = await getPng(t.size);
    writeFileSync(resolve(ICON_DIR, t.file), png);
    console.log(`ICON_SAVED: ${t.file} (${t.size}x${t.size}, ${png.length} B)`);
  }

  const icoEntries = [];
  for (const s of ICO_SIZES) {
    icoEntries.push({ size: s, png: await getPng(s) });
  }
  const icoBuf = packIco(icoEntries);
  writeFileSync(resolve(ICON_DIR, "icon.ico"), icoBuf);
  writeFileSync(resolve(ICON_DIR, "uninstaller.ico"), icoBuf);
  console.log(`ICO_SAVED: icon.ico & uninstaller.ico (${ICO_SIZES.join("/")}px, ${icoBuf.length} B)`);
} finally {
  await browser.close();
}
