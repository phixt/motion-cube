/**
 * 生成 motion-cube 全套低饱和硬朗光影 3×3 Tauri 应用图标（方案 B）：
 * - 视觉减负：保留三阶 3×3 秩序与顶层 23° 拧转，彻底隐藏内部结构与缝内细节（深邃阴影收束块缝与层间）；
 * - 标准西洋配色：左红 / 右蓝 / 上白，无星芒；
 * - 硬朗虚拟摄影棚打光：左上方明确斜射主光 + 2048px 真实层间投影 + 贴片 45° 切面硬朗高光 + 右后冷色轮廓补光；
 * - 低调深灰靛 WinUI 圆角底板（左上受光微亮、右下顺光落影、左上高光内描边）；
 * - 自动导出全套 15 张 PNG（30..512px）与多分辨率 icon.ico / uninstaller.ico。
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
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
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
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

/** 用 esbuild 在内存中打包 Three.js 离线硬朗光影 3×3 实底渲染器 */
async function buildIconRendererBundle() {
  const entrySource = /* ts */ `
    import {
      ACESFilmicToneMapping,
      BoxGeometry,
      BufferAttribute,
      BufferGeometry,
      Color,
      CylinderGeometry,
      DirectionalLight,
      Group,
      HemisphereLight,
      Mesh,
      MeshBasicMaterial,
      MeshStandardMaterial,
      PCFShadowMap,
      PerspectiveCamera,
      Scene,
      SRGBColorSpace,
      WebGLRenderer,
    } from "three";

    // 标准西洋克制亚克力色板（0:+Y 冰白, 1:-Y 黄, 2:+Z 绿, 3:-Z 蔚蓝, 4:+X 竞速红, 5:-X 橙）
    const FACE_HEX = [
      0xf8fbff, // U 白（迎光纯净冰白）
      0xe6bd38, // D 黄
      0x27b575, // F 绿
      0x2d86f6, // B 蓝（右侧背光沉稳钴蓝，暗部不糊成黑）
      0xe63d4d, // R 红（左侧迎光饱满克制红）
      0xe87b2e, // L 橙
    ];

    type OuterFaceSpec = {
      faceIdx: number;
      n: [number, number, number];
      u: [number, number, number];
      v: [number, number, number];
      matchAxis: 0 | 1 | 2;
      matchVal: -1 | 1;
    };

    const OUTER_FACES: OuterFaceSpec[] = [
      { faceIdx: 0, n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], matchAxis: 1, matchVal: 1 },
      { faceIdx: 1, n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], matchAxis: 1, matchVal: -1 },
      { faceIdx: 2, n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], matchAxis: 2, matchVal: 1 },
      { faceIdx: 3, n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], matchAxis: 2, matchVal: -1 },
      { faceIdx: 4, n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], matchAxis: 0, matchVal: 1 },
      { faceIdx: 5, n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], matchAxis: 0, matchVal: -1 },
    ];

    function axisSpan(i: -1 | 0 | 1): [number, number] {
      const innerHalf = 0.324;
      const innerStart = 0.342;
      const outerBody = 0.968;
      if (i === -1) return [-outerBody, -innerStart];
      if (i === 1) return [innerStart, outerBody];
      return [-innerHalf, innerHalf];
    }

    function sampleRoundedRect(
      u0: number,
      u1: number,
      v0: number,
      v1: number,
      r: number,
      arcSteps = 4,
    ): Array<[number, number, number, number]> {
      const pts: Array<[number, number, number, number]> = [];
      const defs = [
        { cx: u1 - r, cy: v1 - r, a0: 0, a1: Math.PI * 0.5 },
        { cx: u0 + r, cy: v1 - r, a0: Math.PI * 0.5, a1: Math.PI },
        { cx: u0 + r, cy: v0 + r, a0: Math.PI, a1: Math.PI * 1.5 },
        { cx: u1 - r, cy: v0 + r, a0: Math.PI * 1.5, a1: Math.PI * 2.0 },
      ];
      for (const d of defs) {
        for (let s = 0; s <= arcSteps; s++) {
          const ang = d.a0 + ((d.a1 - d.a0) * s) / arcSteps;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          pts.push([d.cx + ca * r, d.cy + sa * r, ca, sa]);
        }
      }
      return pts;
    }

    /** 构建单个带 45° 硬朗倒角切面的外露贴片（顶面与倒角裙边分离法线，光暗切面极利落） */
    function buildCrispCapGeo(
      spec: OuterFaceSpec,
      ix: -1 | 0 | 1,
      iy: -1 | 0 | 1,
      iz: -1 | 0 | 1,
    ): BufferGeometry {
      const coord: [number, number, number] = [ix, iy, iz];
      const cu = (coord[0] * spec.u[0] + coord[1] * spec.u[1] + coord[2] * spec.u[2]) as -1 | 0 | 1;
      const cv = (coord[0] * spec.v[0] + coord[1] * spec.v[1] + coord[2] * spec.v[2]) as -1 | 0 | 1;

      function tileSpan(c: -1 | 0 | 1): [number, number] {
        const [a0, a1] = axisSpan(c);
        // 紧实饱满的 3×3 贴片占比，32px 缩略依然干脆清晰
        const insetLo = c === -1 ? 0.015 : 0.012;
        const insetHi = c === 1 ? 0.015 : 0.012;
        return [a0 + insetLo, a1 - insetHi];
      }

      const [u0, u1] = tileSpan(cu);
      const [v0, v1] = tileSpan(cv);

      // 统一干脆圆角（减少花哨细节，突出 3×3 秩序）
      const rOuter = 0.064;
      const bevelIn = 0.022;
      const outerRing = sampleRoundedRect(u0, u1, v0, v1, rOuter, 4);
      const innerRing = sampleRoundedRect(
        u0 + bevelIn,
        u1 - bevelIn,
        v0 + bevelIn,
        v1 - bevelIn,
        Math.max(0.022, rOuter - bevelIn),
        4,
      );

      const M = outerRing.length;
      const [nx, ny, nz] = spec.n;
      const [ux, uy, uz] = spec.u;
      const [vx, vy, vz] = spec.v;
      const hBase = 0.962;
      const hTop = 1.000;

      const toW = (u: number, v: number, h: number): [number, number, number] => [
        nx * h + ux * u + vx * v,
        ny * h + uy * u + vy * v,
        nz * h + uz * u + vz * v,
      ];

      const pos: number[] = [];
      const norm: number[] = [];
      const idx: number[] = [];

      // 1) 硬朗 45° 倒角切面裙边（独立法线，迎光棱拉出利落高光线、背光棱收深）
      const slope = 0.7071;
      const up = 0.7071;
      for (let i = 0; i < M; i++) {
        const [ou, ov, dux, dvy] = outerRing[i];
        const [iu, iv] = innerRing[i];
        const bnx = nx * up + (ux * dux + vx * dvy) * slope;
        const bny = ny * up + (uy * dux + vy * dvy) * slope;
        const bnz = nz * up + (uz * dux + vz * dvy) * slope;

        const pOut = toW(ou, ov, hBase);
        const pIn = toW(iu, iv, hTop);
        pos.push(pOut[0], pOut[1], pOut[2], pIn[0], pIn[1], pIn[2]);
        norm.push(bnx, bny, bnz, bnx, bny, bnz);
      }
      for (let i = 0; i < M; i++) {
        const j = (i + 1) % M;
        const o0 = i * 2;
        const i0 = o0 + 1;
        const o1 = j * 2;
        const i1 = o1 + 1;
        idx.push(o0, o1, i1, o0, i1, i0);
      }

      // 2) 平整硬朗顶面（纯平法线，让每一片在主光下形成干净切面）
      const topBase = pos.length / 3;
      const pMid = toW((u0 + u1) * 0.5, (v0 + v1) * 0.5, hTop);
      pos.push(pMid[0], pMid[1], pMid[2]);
      norm.push(nx, ny, nz);
      for (let i = 0; i < M; i++) {
        const [iu, iv] = innerRing[i];
        const p = toW(iu, iv, hTop);
        pos.push(p[0], p[1], p[2]);
        norm.push(nx, ny, nz);
      }
      for (let i = 0; i < M; i++) {
        const j = (i + 1) % M;
        idx.push(topBase, topBase + 1 + i, topBase + 1 + j);
      }

      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute("normal", new BufferAttribute(new Float32Array(norm), 3));
      geo.setIndex(idx);
      return geo;
    }

    /** 构建一个微倒角实心小块体（深雾冰炭壳，彻底隐藏缝内细节） */
    function buildSolidCubieGeo(ix: -1 | 0 | 1, iy: -1 | 0 | 1, iz: -1 | 0 | 1): BufferGeometry {
      const [x0, x1] = axisSpan(ix);
      const [y0, y1] = axisSpan(iy);
      const [z0, z1] = axisSpan(iz);
      const geo = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      geo.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5);
      return geo;
    }

    /** 对标准材质注入轻量硬朗光暗阶梯与受光提纯（保持真实 PCF 投影，但光暗切面更干脆利落） */
    function createCrispTileMaterial(hex: number, isWhite: boolean): MeshStandardMaterial {
      const mat = new MeshStandardMaterial({
        color: new Color(hex),
        roughness: isWhite ? 0.34 : 0.30,
        metalness: 0.04,
      });
      mat.onBeforeCompile = (shader) => {
        // 将主光漫反射略微向硬朗阶梯拉拢，同时压实背光暗面层次，让三面切面更干脆
        shader.fragmentShader = shader.fragmentShader.replace(
          "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );",
          "float rawNL = dot( geometryNormal, directLight.direction ); float dotNL = mix(saturate(rawNL), smoothstep(0.02, 0.72, rawNL), 0.58);",
        );
      };
      return mat;
    }

    (window as any).renderCube3DLayer = (size: number): HTMLCanvasElement => {
      const glCanvas = document.createElement("canvas");
      glCanvas.width = size;
      glCanvas.height = size;
      const renderer = new WebGLRenderer({
        canvas: glCanvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFShadowMap;

      const scene = new Scene();
      const camera = new PerspectiveCamera(26, 1, 0.1, 30);
      camera.position.set(0, 2.02, 8.55);
      camera.lookAt(0, -0.04, 0);

      // === 明确虚拟摄影棚硬朗布光（左上斜射主光 + 真实层间投影 + 右侧克制冷补光） ===
      // 1) 左上方主光源：照亮白顶面与左红面，对右蓝面形成硬朗背光切面，并在层间投下干脆阴影
      const keyLight = new DirectionalLight(0xfffcf7, 2.75);
      keyLight.position.set(-5.4, 7.6, 3.8);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(2048, 2048);
      keyLight.shadow.camera.near = 2.0;
      keyLight.shadow.camera.far = 18.0;
      keyLight.shadow.camera.left = -2.2;
      keyLight.shadow.camera.right = 2.2;
      keyLight.shadow.camera.top = 2.2;
      keyLight.shadow.camera.bottom = -2.2;
      keyLight.shadow.bias = -0.00035;
      keyLight.shadow.normalBias = 0.012;
      keyLight.shadow.radius = 1.4; // 偏硬朗的干净投影边缘
      scene.add(keyLight);

      // 2) 右前侧极克制冷色副补光：托住右蓝暗面层次（明显暗于主光，既保持硬朗背光切面，又在 32px 不发黑）
      const fillLight = new DirectionalLight(0x90c6ff, 0.78);
      fillLight.position.set(4.6, 2.0, 4.4);
      scene.add(fillLight);

      // 3) 右后极弱轮廓光：勾勒右蓝面最外缘倒角棱线
      const rimLight = new DirectionalLight(0xa8d4ff, 0.55);
      rimLight.position.set(5.4, 1.8, -3.4);
      scene.add(rimLight);

      // 4) 克制环境半球光：保持高光暗比（暗部沉稳、块缝深邃）
      const hemi = new HemisphereLight(0xd2e2ff, 0x0d121d, 0.44);
      scene.add(hemi);

      // === 方案 B：3×3 实底深雾壳体 + 阴影遮挡缝内 + 54 片硬朗倒角贴片 ===
      const bodyMat = new MeshStandardMaterial({
        color: 0x1b2230, // 深冷雾灰实体壳，克制不抢色
        roughness: 0.68,
        metalness: 0.08,
      });

      // 缝隙深处与层间错缝纯暗影遮挡芯：彻底藏起缝内细节、不漏光、不露内部构件
      const voidShadowMat = new MeshBasicMaterial({ color: 0x090c12 });

      const capMats = FACE_HEX.map((hex, i) => createCrispTileMaterial(hex, i === 0));

      const cubeGroup = new Group();
      const lowerGroup = new Group();
      const upperGroup = new Group();
      cubeGroup.add(lowerGroup, upperGroup);

      // 底层 2 层内部暗影阻光块（完全填实块缝深处）
      const lowerCore = new Mesh(new BoxGeometry(1.88, 1.24, 1.88), voidShadowMat);
      lowerCore.position.set(0, -0.32, 0);
      lowerGroup.add(lowerCore);

      // 顶层内部暗影阻光块
      const upperCore = new Mesh(new BoxGeometry(1.88, 0.58, 1.88), voidShadowMat);
      upperCore.position.set(0, 0.65, 0);
      upperGroup.add(upperCore);

      // 层间旋转暗影衔接柱（藏于拧开层缝内，纯深影过渡，绝不显露杂乱轴体）
      const seamBridge = new Mesh(new CylinderGeometry(0.84, 0.84, 0.14, 32), voidShadowMat);
      seamBridge.position.set(0, 0.34, 0);
      cubeGroup.add(seamBridge);

      const coords: Array<-1 | 0 | 1> = [-1, 0, 1];
      for (const ix of coords) {
        for (const iy of coords) {
          for (const iz of coords) {
            if (ix === 0 && iy === 0 && iz === 0) continue;
            const target = iy === 1 ? upperGroup : lowerGroup;

            const bodyMesh = new Mesh(buildSolidCubieGeo(ix, iy, iz), bodyMat);
            bodyMesh.castShadow = true;
            bodyMesh.receiveShadow = true;
            target.add(bodyMesh);

            const c = [ix, iy, iz];
            for (const spec of OUTER_FACES) {
              if (c[spec.matchAxis] === spec.matchVal) {
                const capMesh = new Mesh(buildCrispCapGeo(spec, ix, iy, iz), capMats[spec.faceIdx]);
                capMesh.castShadow = true;
                capMesh.receiveShadow = true;
                target.add(capMesh);
              }
            }
          }
        }
      }

      // 顶层 U 顺势拧转 21°（悬空角在下层投出干脆利落的硬朗阴影，且完全不露背面杂色边缘）
      upperGroup.rotation.set(0, 0.36, 0);

      // 标准「左红 (+X) / 右蓝 (-Z) / 上白 (+Y)」均衡三面视角
      cubeGroup.rotation.set(0.18, -2.38, 0.0);
      cubeGroup.position.set(0, 0.10, 0);
      scene.add(cubeGroup);

      renderer.clear();
      renderer.render(scene, camera);
      return glCanvas;
    };
  `;

  const result = await build({
    stdin: {
      contents: entrySource,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
    platform: "browser",
  });

  return result.outputFiles[0].text;
}

const bundleJs = await buildIconRendererBundle();

const ICON_HTML = /* html */ `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  canvas { display: block; }
</style></head>
<body>
<canvas id="master" width="1024" height="1024"></canvas>
<script>${bundleJs}</script>
<script>
const master = document.getElementById("master");
const ctx = master.getContext("2d");

function traceSquircle(c, x, y, ww, hh, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + ww - r, y);
  c.quadraticCurveTo(x + ww, y, x + ww, y + r);
  c.lineTo(x + ww, y + hh - r);
  c.quadraticCurveTo(x + ww, y + hh, x + ww - r, y + hh);
  c.lineTo(x + r, y + hh);
  c.quadraticCurveTo(x, y + hh, x, y + hh - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

function buildMaster1024() {
  const S = 1024;
  ctx.clearRect(0, 0, S, S);

  const pad = 28;
  const w = S - pad * 2;
  const rad = 224;

  // 1) 低调深灰靛 WinUI 圆角底板（顺应左上方虚拟主光方向形成明暗斜坡）
  traceSquircle(ctx, pad, pad, w, w, rad);
  const bgGrad = ctx.createLinearGradient(90, 70, 920, 950);
  bgGrad.addColorStop(0.0, "#2A3240");
  bgGrad.addColorStop(0.45, "#191E28");
  bgGrad.addColorStop(1.0, "#0E121A");
  ctx.fillStyle = bgGrad;
  ctx.fill();

  ctx.save();
  traceSquircle(ctx, pad, pad, w, w, rad);
  ctx.clip();

  // 2) 左上方虚拟主光源斜射光场（明确交代光从左上打过来，克制不抢主体）
  const keyGlow = ctx.createRadialGradient(170, 140, 20, 220, 200, 620);
  keyGlow.addColorStop(0.0, "rgba(220, 232, 255, 0.16)");
  keyGlow.addColorStop(0.42, "rgba(154, 182, 226, 0.06)");
  keyGlow.addColorStop(1.0, "rgba(14, 18, 26, 0)");
  ctx.fillStyle = keyGlow;
  ctx.fillRect(0, 0, S, S);

  // 3) 顺着左上主光方向往右下方投出的干净偏硬落地影（零花哨彩虹光圈）
  ctx.save();
  ctx.translate(566, 804);
  ctx.rotate(0.10);
  ctx.scale(1.0, 0.33);
  const castGrad = ctx.createRadialGradient(0, 0, 35, 0, 0, 295);
  castGrad.addColorStop(0.0, "rgba(3, 5, 10, 0.72)");
  castGrad.addColorStop(0.55, "rgba(4, 7, 13, 0.34)");
  castGrad.addColorStop(1.0, "rgba(4, 7, 13, 0)");
  ctx.fillStyle = castGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 295, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 魔方正下方紧贴的短接触影
  ctx.save();
  ctx.translate(514, 796);
  ctx.scale(1.0, 0.28);
  const contactGrad = ctx.createRadialGradient(0, 0, 12, 0, 0, 195);
  contactGrad.addColorStop(0.0, "rgba(2, 4, 8, 0.78)");
  contactGrad.addColorStop(1.0, "rgba(2, 4, 8, 0)");
  ctx.fillStyle = contactGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 195, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 4) 叠加真实 3D 硬朗光影方案 B 魔方
  const cubeCanvas = window.renderCube3DLayer(1024);
  ctx.drawImage(cubeCanvas, 0, -10, 1024, 1024);

  ctx.restore(); // end clip

  // 5) 响应左上主光的极细冷银玻璃内描边（左上迎光亮、右下背光沉）
  traceSquircle(ctx, pad + 1.5, pad + 1.5, w - 3, w - 3, rad - 1.5);
  const rimGrad = ctx.createLinearGradient(80, 60, 940, 960);
  rimGrad.addColorStop(0.0, "rgba(232, 240, 255, 0.34)");
  rimGrad.addColorStop(0.40, "rgba(168, 186, 218, 0.12)");
  rimGrad.addColorStop(1.0, "rgba(110, 128, 160, 0.08)");
  ctx.strokeStyle = rimGrad;
  ctx.lineWidth = 3.5;
  ctx.stroke();
}

buildMaster1024();

// 逐级 0.5x 渐进缩采样，保证 16px/32px 小尺寸图标也保持硬朗清晰
window.exportSizedPng = (size) => {
  let src = master;
  let cur = 1024;
  while (cur * 0.5 >= size && cur > size) {
    const next = Math.max(size, Math.floor(cur * 0.5));
    const tmp = document.createElement("canvas");
    tmp.width = next;
    tmp.height = next;
    const tc = tmp.getContext("2d");
    tc.imageSmoothingEnabled = true;
    tc.imageSmoothingQuality = "high";
    tc.drawImage(src, 0, 0, next, next);
    src = tmp;
    cur = next;
  }
  if (cur !== size) {
    const out = document.createElement("canvas");
    out.width = size;
    out.height = size;
    const oc = out.getContext("2d");
    oc.imageSmoothingEnabled = true;
    oc.imageSmoothingQuality = "high";
    oc.drawImage(src, 0, 0, size, size);
    src = out;
  }
  return src.toDataURL("image/png");
};
</script>
</body>
</html>`;

const browser = await launchBrowser({ prefix: "mc-icon-", width: 1024, height: 1024 });
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text());
  });
  await page.setContent(ICON_HTML, { waitUntil: "load" });
  if (errs.length) throw new Error("Icon render errors: " + errs.join("; "));

  const cache = new Map();
  async function getPng(size) {
    if (cache.has(size)) return cache.get(size);
    const dataUrl = await page.evaluate((s) => window.exportSizedPng(s), size);
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
