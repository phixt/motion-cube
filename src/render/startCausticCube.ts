/**
 * 开始页风格化晶体折光魔方 + 硬边分层焦散地面（Three.js + 自定义 GLSL）。
 * 视觉灵感源自 caustic-gem（gem_raytrace.gdshader + caustic_ground.gdshader）：
 * - 3×3 魔方 54 个外露贴面均带真实 45° 切角棱面（单次 DrawCall），
 *   片元着色器采用 5 阶平涂明度色板 + 离散彩虹火彩切面 + 清晰棱边描线 + 入场抛光扫光；
 * - 底部平面完整移植硬边分层焦散光斑（椭圆↔菱形底影 + 左右双色瓣 + 交叠色边 + 内环 + 亮核），
 *   随魔方自转与鼠标视差实时律动；
 * - 完整适配明/暗主题、prefers-reduced-motion、页面切后台暂停与卸载 dispose()。
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

export type StartCubeTheme = "light" | "dark";

export type StartCausticCubeOptions = {
  /** 读取外部视差 CSS 变量 (--par-u / --par-v) 的宿主元素 */
  parallaxHost?: HTMLElement | null;
  /** 初始主题 */
  theme?: StartCubeTheme;
  /** 是否降低动态效果（静止渲染首帧、跳过扫光） */
  reducedMotion?: boolean;
};

/** 魔方六面基色：保持高辨识度并微调至宝石晶莹质感（白面微带冰蓝在浅色主题下依然清晰） */
const FACE_BASE_COLORS: Record<string, [number, number, number]> = {
  U: [0.91, 0.94, 0.99], // 冰晶白
  D: [1.0, 0.82, 0.2],   // 琥珀黄
  F: [0.16, 0.77, 0.45], // 祖母绿
  B: [0.2, 0.52, 0.96],  // 蓝宝蓝
  R: [0.92, 0.25, 0.34], // 红宝红
  L: [0.98, 0.54, 0.18], // 橘晶橙
};

type FaceSpec = {
  key: keyof typeof FACE_BASE_COLORS;
  normal: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
};

const FACES: FaceSpec[] = [
  { key: "F", normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { key: "B", normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
  { key: "R", normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  { key: "L", normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  { key: "U", normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  { key: "D", normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
];

/**
 * 构建 54 块带 45° 宝石切角的 3×3 魔方外露贴面网格（合并为 1 个 BufferGeometry）：
 * 每块贴面 = 中心平面（2 三角）+ 4 条斜切棱面（8 三角）+ 4 个角切面（4 三角），
 * 每片切面保持独立平直法线，转动时自然产生利落的切面折光跳动。
 */
function buildFacetedStickersGeometry(): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const faceIds: number[] = [];
  const stickerUvs: number[] = [];

  const spacing = 0.64; // 3×3 单元步距 → 总边长约 1.92
  const halfCube = spacing * 1.5;
  const outer = spacing * 0.455; // 贴面底边半宽
  const inner = spacing * 0.355; // 顶面平台半宽
  const bevelH = spacing * 0.088; // 切角凸起高度

  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const tmpC = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const nrm = new Vector3();

  const pushTri = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    uv0: [number, number],
    uv1: [number, number],
    uv2: [number, number],
    col: [number, number, number],
    id: number,
  ) => {
    tmpA.set(p0[0], p0[1], p0[2]);
    tmpB.set(p1[0], p1[1], p1[2]);
    tmpC.set(p2[0], p2[1], p2[2]);
    e1.subVectors(tmpB, tmpA);
    e2.subVectors(tmpC, tmpA);
    nrm.crossVectors(e1, e2).normalize();
    const pts = [p0, p1, p2];
    const uvs = [uv0, uv1, uv2];
    for (let i = 0; i < 3; i++) {
      positions.push(pts[i][0], pts[i][1], pts[i][2]);
      normals.push(nrm.x, nrm.y, nrm.z);
      colors.push(col[0], col[1], col[2]);
      faceIds.push(id);
      stickerUvs.push(uvs[i][0], uvs[i][1]);
    }
  };

  let stickerIdx = 0;
  for (const f of FACES) {
    const col = FACE_BASE_COLORS[f.key];
    const [nx, ny, nz] = f.normal;
    const [rx, ry, rz] = f.right;
    const [ux, uy, uz] = f.up;

    for (let row = -1; row <= 1; row++) {
      for (let colIdx = -1; colIdx <= 1; colIdx++) {
        const cx = nx * halfCube + rx * (colIdx * spacing) + ux * (row * spacing);
        const cy = ny * halfCube + ry * (colIdx * spacing) + uy * (row * spacing);
        const cz = nz * halfCube + rz * (colIdx * spacing) + uz * (row * spacing);

        const toWorld = (lx: number, ly: number, lz: number): [number, number, number] => [
          cx + rx * lx + ux * ly + nx * lz,
          cy + ry * lx + uy * ly + ny * lz,
          cz + rz * lx + uz * ly + nz * lz,
        ];

        // 顶面四角（逆时针：左下、右下、右上、左上）
        const t0 = toWorld(-inner, -inner, bevelH);
        const t1 = toWorld(inner, -inner, bevelH);
        const t2 = toWorld(inner, inner, bevelH);
        const t3 = toWorld(-inner, inner, bevelH);

        // 底面八角切角环（每侧收角形成清晰晶体倒角）
        const cornerCut = outer * 0.84;
        const b0a = toWorld(-cornerCut, -outer, 0);
        const b1a = toWorld(cornerCut, -outer, 0);
        const b1b = toWorld(outer, -cornerCut, 0);
        const b2a = toWorld(outer, cornerCut, 0);
        const b2b = toWorld(cornerCut, outer, 0);
        const b3a = toWorld(-cornerCut, outer, 0);
        const b3b = toWorld(-outer, cornerCut, 0);
        const b0b = toWorld(-outer, -cornerCut, 0);

        const id = stickerIdx++;
        // 顶面平台（UV 落在 [-0.72, 0.72]²，边缘高光带落在 |uv| ≈ 0.72..1.0）
        pushTri(t0, t1, t2, [-0.72, -0.72], [0.72, -0.72], [0.72, 0.72], col, id);
        pushTri(t0, t2, t3, [-0.72, -0.72], [0.72, 0.72], [-0.72, 0.72], col, id);

        // 四条 45° 斜切边棱
        pushTri(b0a, b1a, t1, [-0.88, -1], [0.88, -1], [0.72, -0.72], col, id + 0.15);
        pushTri(b0a, t1, t0, [-0.88, -1], [0.72, -0.72], [-0.72, -0.72], col, id + 0.15);

        pushTri(b1b, b2a, t2, [1, -0.88], [1, 0.88], [0.72, 0.72], col, id + 0.35);
        pushTri(b1b, t2, t1, [1, -0.88], [0.72, 0.72], [0.72, -0.72], col, id + 0.35);

        pushTri(b2b, b3a, t3, [0.88, 1], [-0.88, 1], [-0.72, 0.72], col, id + 0.55);
        pushTri(b2b, t3, t2, [0.88, 1], [-0.72, 0.72], [0.72, 0.72], col, id + 0.55);

        pushTri(b3b, b0b, t0, [-1, 0.88], [-1, -0.88], [-0.72, -0.72], col, id + 0.75);
        pushTri(b3b, t0, t3, [-1, 0.88], [-0.72, -0.72], [-0.72, 0.72], col, id + 0.75);

        // 四个角切面三角
        pushTri(b0b, b0a, t0, [-1, -0.88], [-0.88, -1], [-0.72, -0.72], col, id + 0.9);
        pushTri(b1a, b1b, t1, [0.88, -1], [1, -0.88], [0.72, -0.72], col, id + 0.9);
        pushTri(b2a, b2b, t2, [1, 0.88], [0.88, 1], [0.72, 0.72], col, id + 0.9);
        pushTri(b3a, b3b, t3, [-0.88, 1], [-1, 0.88], [-0.72, 0.72], col, id + 0.9);
      }
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute("aColor", new BufferAttribute(new Float32Array(colors), 3));
  geo.setAttribute("aFaceId", new BufferAttribute(new Float32Array(faceIds), 1));
  geo.setAttribute("aStickerUv", new BufferAttribute(new Float32Array(stickerUvs), 2));
  return geo;
}

/** 内部晶体核（切角大立方体，封住贴面间隙并呈现深邃折光内核） */
function buildCrystalCoreGeometry(size: number): BufferGeometry {
  const h = size * 0.5;
  const c = h * 0.88;
  const pos: number[] = [];
  const nrm: number[] = [];

  const pushQuad = (a: number[], b: number[], d: number[], e: number[], n: number[]) => {
    const verts = [a, b, d, a, d, e];
    for (const v of verts) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(n[0], n[1], n[2]);
    }
  };
  // 六个主面（简洁收角盒体）
  pushQuad([-c, -c, h], [c, -c, h], [c, c, h], [-c, c, h], [0, 0, 1]);
  pushQuad([c, -c, -h], [-c, -c, -h], [-c, c, -h], [c, c, -h], [0, 0, -1]);
  pushQuad([h, -c, c], [h, -c, -c], [h, c, -c], [h, c, c], [1, 0, 0]);
  pushQuad([-h, -c, -c], [-h, -c, c], [-h, c, c], [-h, c, -c], [-1, 0, 0]);
  pushQuad([-c, h, c], [c, h, c], [c, h, -c], [-c, h, -c], [0, 1, 0]);
  pushQuad([-c, -h, -c], [c, -h, -c], [c, -h, c], [-c, -h, c], [0, -1, 0]);

  // 12 条大棱倒角带（确保任何角度间隙都不露空洞）
  const addBevel = (a: number[], b: number[], d: number[], e: number[]) => {
    const va = new Vector3(a[0], a[1], a[2]);
    const vb = new Vector3(b[0], b[1], b[2]);
    const vd = new Vector3(d[0], d[1], d[2]);
    const n = new Vector3().subVectors(vb, va).cross(new Vector3().subVectors(vd, va)).normalize();
    pushQuad(a, b, d, e, [n.x, n.y, n.z]);
  };
  // 顶 4 棱
  addBevel([-c, c, h], [c, c, h], [c, h, c], [-c, h, c]);
  addBevel([c, c, -h], [-c, c, -h], [-c, h, -c], [c, h, -c]);
  addBevel([h, c, c], [h, c, -c], [c, h, -c], [c, h, c]);
  addBevel([-h, c, -c], [-h, c, c], [-c, h, c], [-c, h, -c]);
  // 底 4 棱
  addBevel([-c, -h, c], [c, -h, c], [c, -c, h], [-c, -c, h]);
  addBevel([c, -h, -c], [-c, -h, -c], [-c, -c, -h], [c, -c, -h]);
  addBevel([c, -h, c], [c, -h, -c], [h, -c, -c], [h, -c, c]);
  addBevel([-c, -h, -c], [-c, -h, c], [-h, -c, c], [-h, -c, -c]);
  // 竖 4 棱
  addBevel([c, -c, h], [h, -c, c], [h, c, c], [c, c, h]);
  addBevel([h, -c, -c], [c, -c, -h], [c, c, -h], [h, c, -c]);
  addBevel([-c, -c, -h], [-h, -c, -c], [-h, c, -c], [-c, c, -h]);
  addBevel([-h, -c, c], [-c, -c, h], [-c, c, h], [-h, c, c]);

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  return geo;
}

const FACET_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aColor;
  attribute float aFaceId;
  attribute vec2 aStickerUv;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocalPos;
  varying vec3 vBaseColor;
  varying float vFaceId;
  varying vec2 vStickerUv;

  void main() {
    vBaseColor = aColor;
    vFaceId = aFaceId;
    vStickerUv = aStickerUv;
    vLocalPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FACET_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uLightDir;
  uniform float uPolish;
  uniform float uDarkMode;
  uniform float uTime;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocalPos;
  varying vec3 vBaseColor;
  varying float vFaceId;
  varying vec2 vStickerUv;

  // caustic-gem 风格的 6 色离散火彩调色板
  vec3 getFireColor(int idx) {
    int m = idx - (idx / 6) * 6;
    if (m < 0) m += 6;
    if (m == 0) return vec3(1.000, 0.624, 0.220);
    if (m == 1) return vec3(1.000, 0.941, 0.400);
    if (m == 2) return vec3(0.384, 0.949, 0.675);
    if (m == 3) return vec3(0.431, 0.898, 1.000);
    if (m == 4) return vec3(0.769, 0.510, 1.000);
    return vec3(1.000, 0.431, 0.761);
  }

  // 参考 gem_raytrace.gdshader：多光源摄影棚亮度采样
  float studioLuminance(vec3 d, vec3 toCam) {
    vec3 L_key = normalize(uLightDir);
    vec3 L_rim = normalize(vec3(-0.74, 0.52, 0.44));
    vec3 L_top = normalize(vec3(0.10, 0.94, -0.30));
    float keyTerm = pow(max(dot(d, L_key), 0.0), 2.2) * 0.72;
    float rimTerm = pow(max(dot(d, L_rim), 0.0), 2.8) * 0.48;
    float topTerm = pow(max(dot(d, L_top), 0.0), 2.0) * 0.36;
    float baseSky = clamp(d.y * 0.34 + 0.50, 0.16, 0.82);
    float lum = clamp(baseSky * 0.54 + keyTerm + rimTerm + topTerm, 0.0, 1.0);
    // 轻微相机暗挡板增强明暗对比（gem_raytrace dark_baffle）
    float camAlign = dot(d, toCam);
    float baffle = smoothstep(0.84, 0.96, camAlign);
    lum *= (1.0 - baffle * 0.45);
    return clamp(lum, 0.0, 1.0);
  }

  // 5 阶平涂明度量化（暗影 → 中暗 → 本色 → 晶亮 → 镜面高光）
  vec3 sampleFacetRamp(vec3 baseCol, float val) {
    vec3 c0 = baseCol * mix(0.48, 0.38, uDarkMode) + vec3(0.03, 0.02, 0.07);
    vec3 c1 = baseCol * mix(0.76, 0.68, uDarkMode);
    vec3 c2 = baseCol;
    vec3 c3 = mix(baseCol, vec3(1.0), 0.38);
    vec3 c4 = mix(baseCol, vec3(1.0), 0.86);
    if (val < 0.22) return c0;
    if (val < 0.44) return c1;
    if (val < 0.68) return c2;
    if (val < 0.88) return c3;
    return c4;
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uLightDir);

    // 模拟双次晶体折射出口向量与色散偏角
    vec3 refr1 = refract(-V, N, 1.0 / 1.62);
    vec3 refrDisp = refract(-V, N, 1.0 / 1.82);
    vec3 refl = reflect(-V, N);
    vec3 optDir = normalize(mix(refl, -refr1, 0.55));
    float dispAmt = length(refr1 - refrDisp);

    float lum = studioLuminance(optDir, V);
    float ndl = dot(N, L) * 0.5 + 0.5;
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.4);

    // 切角棱面与顶面区分
    float maxUv = max(abs(vStickerUv.x), abs(vStickerUv.y));
    float isBevel = step(0.73, maxUv);

    // 抛光入场扫光坐标（从下到上斜向扫过）
    float sweep = clamp((vLocalPos.y - vLocalPos.x * 0.35) / 2.2 + 0.5, 0.0, 1.0);
    bool polished = (uPolish >= 0.999) || (uPolish > 0.001 && sweep <= uPolish);

    // 贴面编号驱动的确定性小块亮度微差 + 离散火彩门控
    float fid = floor(vFaceId);
    float subFacet = fract(vFaceId);
    float hash = fract(sin(fid * 19.37 + subFacet * 73.13) * 43758.5453);

    vec3 col;
    if (!polished) {
      // 未抛光原石切面（3 阶哑光）
      float rawVal = ndl * 0.82 + 0.14;
      vec3 matteBase = mix(vec3(0.55, 0.58, 0.66), vBaseColor, 0.38);
      col = (rawVal < 0.36) ? matteBase * 0.62 : ((rawVal < 0.68) ? matteBase * 0.88 : matteBase * 1.08);
      if (uPolish > 0.001 && abs(sweep - uPolish) < 0.11) {
        col = vec3(1.0);
      }
    } else {
      // 抛光后晶体折光：5 阶平涂色阶 + 贯穿整面的斜向折光切分（gem_raytrace 平涂大色块风格）
      float facetBand = dot(vLocalPos, normalize(vec3(0.58, 0.66, -0.48))) * 0.18;
      float val = clamp(lum * 0.62 + ndl * 0.28 + facetBand + (hash - 0.5) * 0.08 + isBevel * 0.16, 0.0, 1.0);
      col = sampleFacetRamp(vBaseColor, val);

      // 离散彩虹火彩：由折射方向与切面编号稳定驱动（转动时整片切面干脆点亮，无闪烁噪点）
      int fireIdx = int(floor(fid * 3.0 + subFacet * 6.0));
      float fireAlign = dot(optDir, normalize(vec3(-0.55, 0.62, 0.56)));
      bool bevelFire = (isBevel > 0.5 && fresnel > 0.34 && fireAlign > 0.22 && hash < 0.48);
      bool facetFire = (isBevel < 0.5 && dispAmt > 0.06 && fireAlign > 0.58 && val > 0.55 && val < 0.86 && hash < 0.26);
      if (bevelFire || facetFire) {
        vec3 fireCol = getFireColor(fireIdx);
        col = mix(col, fireCol, bevelFire ? 0.52 : 0.28);
      }

      // 顶面镜面锐利高光片
      vec3 H = normalize(L + V);
      float spec = dot(N, H);
      if (spec > 0.945) {
        col = mix(col, vec3(1.0), 0.76);
      }
    }

    // 清晰棱边描线：顶面与 45° 切角交界线（maxUv ≈ 0.72）+ 贴面外缘细线
    float innerCrease = 1.0 - smoothstep(0.0, 0.032, abs(maxUv - 0.72));
    float outerEdge = smoothstep(0.94, 1.0, maxUv);
    vec3 borderCol = mix(vec3(0.84, 0.89, 0.98), vec3(0.96, 0.98, 1.0), uDarkMode);
    col = mix(col, borderCol, innerCrease * mix(0.46, 0.56, uDarkMode));
    col = mix(col, mix(vec3(0.24, 0.28, 0.36), vec3(0.05, 0.06, 0.10), uDarkMode), outerEdge * 0.52);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const CORE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CORE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uDarkMode;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    vec3 deepCol = mix(vec3(0.14, 0.16, 0.22), vec3(0.05, 0.06, 0.10), uDarkMode);
    vec3 rimCol = mix(vec3(0.45, 0.56, 0.78), vec3(0.32, 0.46, 0.74), uDarkMode);
    vec3 col = mix(deepCol, rimCol, step(0.42, rim) * 0.55);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const CAUSTIC_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 简化移植自 caustic-gem/shaders/caustic_ground.gdshader：
 * 硬边分层焦散光斑（椭圆↔旋转菱形底影 + 左右双色瓣 + 交叠暖色边 + 内环 + 亮核），
 * 使用平滑极窄抗锯齿边缘避免缩放锯齿，并带柔和外沿透明以干净融入 WinUI 背景。
 */
const CAUSTIC_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uShadowColor;
  uniform vec3 uLobeLeftColor;
  uniform vec3 uLobeRightColor;
  uniform vec3 uAccentRimColor;
  uniform vec3 uInnerRingColor;
  uniform vec3 uCoreColor;
  uniform float uShadowAlpha;
  uniform float uCausticAlpha;
  uniform float uIntensity;
  uniform float uGemRotation;
  uniform vec2 uParallax;

  varying vec2 vUv;

  float organicRadius(vec2 p, float angleOffset, float amp) {
    float a = atan(p.y, p.x);
    float r = length(p);
    float ripple = sin(a * 4.0 + uGemRotation * 2.0 + angleOffset) * amp
                 + cos(a * 3.0 - uGemRotation * 1.4 + angleOffset * 1.7) * (amp * 0.55);
    return r + ripple;
  }

  void main() {
    vec2 uv = (vUv - vec2(0.5)) * 2.0;
    uv += uParallax * vec2(-0.08, 0.05);
    uv /= vec2(1.0, 0.78);

    // 椭圆与随旋转偏转的菱形混合（呼应立方体投影）
    float rEllipse = length(uv);
    float cr = cos(uGemRotation * 0.55 + 0.45);
    float sr = sin(uGemRotation * 0.55 + 0.45);
    vec2 ruv = vec2(uv.x * cr - uv.y * sr, uv.x * sr + uv.y * cr);
    float rRhombus = (abs(ruv.x) + abs(ruv.y)) * 0.80;
    float baseR = mix(rEllipse, rRhombus, 0.34);

    if (baseR > 0.98) discard;

    // 极窄硬边抗锯齿（保留爽利硬边切割感）
    float outerMask = 1.0 - smoothstep(0.935, 0.975, baseR);
    vec3 col = uShadowColor;
    float alpha = uShadowAlpha * outerMask;

    if (uIntensity > 0.01) {
      float bloom = mix(0.28, 1.0, smoothstep(0.0, 1.0, uIntensity));
      vec2 cuv = uv / bloom;

      vec2 shiftDir = normalize(vec2(0.92, -0.20));
      vec2 pLeft = cuv + shiftDir * 0.23;
      vec2 pRight = cuv - shiftDir * 0.23;
      vec2 pMid = cuv + vec2(0.0, 0.03);

      float rLeft = organicRadius(pLeft * vec2(1.16, 1.10), 0.3, 0.042);
      float rRight = organicRadius(pRight * vec2(1.16, 1.10), 2.1, 0.042);
      float rInner = organicRadius(pMid * vec2(1.44, 1.38), 1.1, 0.056);
      float rCore = organicRadius((pMid - vec2(0.03, 0.02)) * vec2(2.65, 2.30), -0.8, 0.082);

      float aa = 0.018;
      float inLeft = 1.0 - smoothstep(0.78 - aa, 0.78 + aa, rLeft);
      float inRight = 1.0 - smoothstep(0.78 - aa, 0.78 + aa, rRight);
      float inInner = 1.0 - smoothstep(0.75 - aa, 0.75 + aa, rInner);
      float inCore = 1.0 - smoothstep(0.66 - aa, 0.66 + aa, rCore);

      float anyLobe = max(inLeft, inRight);
      col = mix(col, uLobeLeftColor, inLeft);
      col = mix(col, uLobeRightColor, inRight);
      float overlap = inLeft * inRight * (1.0 - inInner);
      col = mix(col, uAccentRimColor, overlap);
      col = mix(col, uInnerRingColor, inInner);
      col = mix(col, uCoreColor, inCore);

      float causticMask = max(anyLobe, max(inInner, inCore));
      alpha = mix(alpha, uCausticAlpha * outerMask, causticMask * uIntensity);
    }

    gl_FragColor = vec4(col, alpha);
  }
`;

function causticPalette(theme: StartCubeTheme) {
  if (theme === "dark") {
    return {
      shadow: new Color(0x131622),
      lobeLeft: new Color(0x7c5cff),
      lobeRight: new Color(0xe8488a),
      accentRim: new Color(0x4fd8ff),
      innerRing: new Color(0xb8d4ff),
      core: new Color(0xf4f8ff),
      shadowAlpha: 0.42,
      causticAlpha: 0.66,
    };
  }
  return {
    shadow: new Color(0xa9b3c6),
    lobeLeft: new Color(0xb580e8),
    lobeRight: new Color(0xf26b9d),
    accentRim: new Color(0xffa857),
    innerRing: new Color(0xdbe6f7),
    core: new Color(0xffffff),
    shadowAlpha: 0.28,
    causticAlpha: 0.78,
  };
}

export class StartCausticCubeView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly cubeGroup = new Group();
  private readonly facetMat: ShaderMaterial;
  private readonly coreMat: ShaderMaterial;
  private readonly causticMat: ShaderMaterial;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly parallaxHost: HTMLElement | null;
  private reducedMotion: boolean;
  private raf = 0;
  private disposed = false;
  private startedAt = 0;
  private lastT = 0;
  private spinAngle = 0.55; // 初始 3/4 优雅角度
  private parSmooth = new Vector2(0, 0);

  constructor(
    private readonly container: HTMLElement,
    opts: StartCausticCubeOptions = {},
  ) {
    this.parallaxHost = opts.parallaxHost ?? null;
    this.reducedMotion = opts.reducedMotion ?? false;
    const theme: StartCubeTheme = opts.theme ?? "dark";

    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(31, 1, 0.1, 30);
    this.camera.position.set(0, 1.65, 6.85);
    this.camera.lookAt(0, -0.22, 0);

    // 1) 内部晶体核 + 54 块 45° 倒角贴面
    const coreGeo = buildCrystalCoreGeometry(1.9);
    this.coreMat = new ShaderMaterial({
      vertexShader: CORE_VERTEX_SHADER,
      fragmentShader: CORE_FRAGMENT_SHADER,
      uniforms: {
        uDarkMode: { value: theme === "dark" ? 1 : 0 },
      },
    });
    const coreMesh = new Mesh(coreGeo, this.coreMat);
    this.cubeGroup.add(coreMesh);

    const stickersGeo = buildFacetedStickersGeometry();
    this.facetMat = new ShaderMaterial({
      vertexShader: FACET_VERTEX_SHADER,
      fragmentShader: FACET_FRAGMENT_SHADER,
      uniforms: {
        uLightDir: { value: new Vector3(0.46, 0.82, 0.42).normalize() },
        uPolish: { value: this.reducedMotion ? 1.0 : 0.0 },
        uDarkMode: { value: theme === "dark" ? 1 : 0 },
        uTime: { value: 0 },
      },
    });
    const stickersMesh = new Mesh(stickersGeo, this.facetMat);
    this.cubeGroup.add(stickersMesh);

    this.cubeGroup.position.set(0, 0.44, 0);
    this.scene.add(this.cubeGroup);

    // 2) 底部硬边分层焦散光斑平面
    const pal = causticPalette(theme);
    const causticGeo = new PlaneGeometry(3.25, 3.25);
    this.causticMat = new ShaderMaterial({
      vertexShader: CAUSTIC_VERTEX_SHADER,
      fragmentShader: CAUSTIC_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uShadowColor: { value: pal.shadow },
        uLobeLeftColor: { value: pal.lobeLeft },
        uLobeRightColor: { value: pal.lobeRight },
        uAccentRimColor: { value: pal.accentRim },
        uInnerRingColor: { value: pal.innerRing },
        uCoreColor: { value: pal.core },
        uShadowAlpha: { value: pal.shadowAlpha },
        uCausticAlpha: { value: pal.causticAlpha },
        uIntensity: { value: this.reducedMotion ? 1.0 : 0.0 },
        uGemRotation: { value: this.spinAngle },
        uParallax: { value: new Vector2(0, 0) },
      },
    });
    const causticMesh = new Mesh(causticGeo, this.causticMat);
    causticMesh.rotation.x = -Math.PI / 2;
    causticMesh.position.set(0, -1.64, 0);
    this.scene.add(causticMesh);

    this.disposables.push(coreGeo, this.coreMat, stickersGeo, this.facetMat, causticGeo, this.causticMat);

    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(container);
    this.fit();
    this.applyFrame(0, 0);
    if (!this.reducedMotion) this.start();
  }

  setTheme(theme: StartCubeTheme): void {
    if (this.disposed) return;
    const isDark = theme === "dark" ? 1 : 0;
    this.facetMat.uniforms.uDarkMode.value = isDark;
    this.coreMat.uniforms.uDarkMode.value = isDark;
    const pal = causticPalette(theme);
    this.causticMat.uniforms.uShadowColor.value.copy(pal.shadow);
    this.causticMat.uniforms.uLobeLeftColor.value.copy(pal.lobeLeft);
    this.causticMat.uniforms.uLobeRightColor.value.copy(pal.lobeRight);
    this.causticMat.uniforms.uAccentRimColor.value.copy(pal.accentRim);
    this.causticMat.uniforms.uInnerRingColor.value.copy(pal.innerRing);
    this.causticMat.uniforms.uCoreColor.value.copy(pal.core);
    this.causticMat.uniforms.uShadowAlpha.value = pal.shadowAlpha;
    this.causticMat.uniforms.uCausticAlpha.value = pal.causticAlpha;
    this.render();
  }

  setReducedMotion(reduced: boolean): void {
    if (this.disposed || this.reducedMotion === reduced) return;
    this.reducedMotion = reduced;
    if (reduced) {
      this.stop();
      this.facetMat.uniforms.uPolish.value = 1.0;
      this.causticMat.uniforms.uIntensity.value = 1.0;
      this.applyFrame(0, 0);
    } else {
      this.start();
    }
  }

  pause(): void {
    this.stop();
  }

  resume(): void {
    if (!this.disposed && !this.reducedMotion) this.start();
  }

  private readParallax(): { u: number; v: number } {
    const host = this.parallaxHost;
    if (!host) return { u: 0, v: 0 };
    const u = Number.parseFloat(host.style.getPropertyValue("--par-u")) || 0;
    const v = Number.parseFloat(host.style.getPropertyValue("--par-v")) || 0;
    return { u, v };
  }

  private applyFrame(dtSec: number, elapsedSec: number): void {
    // 40s 一圈优雅自转（与旧 PseudoCube3D 一致）
    const spinSpeed = (Math.PI * 2) / 40;
    if (!this.reducedMotion) {
      this.spinAngle += spinSpeed * dtSec;
    }

    const par = this.readParallax();
    const alpha = dtSec > 0 ? 1 - Math.exp(-8 * dtSec) : 1;
    this.parSmooth.x += (par.u - this.parSmooth.x) * alpha;
    this.parSmooth.y += (par.v - this.parSmooth.y) * alpha;

    // 轻柔悬浮呼吸
    const bob = this.reducedMotion ? 0 : Math.sin(elapsedSec * 1.15) * 0.05;
    this.cubeGroup.position.y = 0.44 + bob;

    // 静态优雅俯仰角 + 鼠标视差微倾 + 自转
    const basePitch = 0.36; // ~20.6°
    const baseRoll = 0.14;
    this.cubeGroup.rotation.set(
      basePitch - this.parSmooth.y * 0.16,
      this.spinAngle + this.parSmooth.x * 0.24,
      baseRoll + this.parSmooth.x * 0.06,
    );

    // 0.85s 短促入场「切面→抛光点亮」过渡
    if (!this.reducedMotion) {
      const p = Math.min(1, elapsedSec / 0.85);
      const eased = 1 - Math.pow(1 - p, 3);
      this.facetMat.uniforms.uPolish.value = eased;
      this.causticMat.uniforms.uIntensity.value = eased;
      this.facetMat.uniforms.uTime.value = elapsedSec;
    }

    this.causticMat.uniforms.uGemRotation.value = this.spinAngle;
    this.causticMat.uniforms.uParallax.value.copy(this.parSmooth);
    this.render();
  }

  private tick = (now: number): void => {
    if (this.disposed || this.reducedMotion) return;
    this.raf = requestAnimationFrame(this.tick);
    if (!this.startedAt) {
      this.startedAt = now;
      this.lastT = now;
    }
    const dt = Math.min((now - this.lastT) / 1000, 0.05);
    this.lastT = now;
    this.applyFrame(dt, (now - this.startedAt) / 1000);
  };

  private start(): void {
    if (this.raf || this.disposed) return;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private fit(): void {
    if (this.disposed) return;
    const w = this.container.clientWidth || 300;
    const h = this.container.clientHeight || 320;
    // 适配应用在 <html> 上的 CSS zoom（默认 1.5x），避免低分辨率放大产生锯齿
    const zoom = Number.parseFloat(document.documentElement.style.zoom) || 1;
    this.renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * Math.max(1, zoom), 3));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.renderer.dispose();
    try {
      this.renderer.forceContextLoss?.();
    } catch {
      // 某些 WebGL 实现不支持 forceContextLoss，忽略
    }
    this.renderer.domElement.remove();
  }
}
