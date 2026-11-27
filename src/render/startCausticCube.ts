/**
 * 开始页轻量真实 3D 速拧魔方 + 斜射光学焦散（Three.js + 自定义轻量光栅 GLSL）：
 * 架构与视觉特点：
 * - 零 Raymarching：全部 26 个内挖球腔块体 + 54 片外露倒角贴片 + 真实 6 轴十字轴芯均由真实 3D 几何体
 *   合并为 4 个静态分区（全场景仅 ~14 次 Draw Call），启用原生硬件 MSAA，核显省电模式轻松稳跑 60fps；
 * - 1.B 外露独立贴片（Exposed Cap）+ 3.B 半透果冻/亚克力薄片：
 *   54 片 Florian 不等圆角薄贴片带真实 3D 倒角厚边，色块轻薄通透、彻底告别厚重闷灰，块缝为真实物理 3D 缝隙；
 * - 2.B 浅冰透/微雾面 26 块壳体 + 精确内挖球面空腔（R = 0.645）+ 真实 6 轴十字轴芯：
 *   壳体无色微雾面不染浑浊杂色，球腔空缺轮廓与 6 轴机械透视 100% 物理准确，U/R 交替 36° 呼吸微拧时零错位；
 * - 地面保留柔和中性接触影 + 38° 斜射单主导色光学焦散光环。
 */
import {
  BackSide,
  DoubleSide,
  FrontSide,
  Group,
  Matrix3,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { buildStartCubeGeometries, type ChunkKey } from "./startCubeGeo";

export type StartCubeTheme = "light" | "dark";

export type StartCausticCubeOptions = {
  /** 读取外部视差 CSS 变量 (--par-u / --par-v) 的宿主元素 */
  parallaxHost?: HTMLElement | null;
  /** 初始主题 */
  theme?: StartCubeTheme;
  /** 是否降低动态效果（静止渲染优雅微拧首帧、跳过入场扫光与轮转） */
  reducedMotion?: boolean;
};

/* ============================================================================
 * 1) 真实 6 轴十字轴芯着色器（不透明金属球毂 + 轴柱 + 弹簧环 + 面色调松帽）
 * ========================================================================== */
const CORE_VERTEX_SHADER = /* glsl */ `
  attribute float aMetal;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vColor;
  varying float vMetal;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vColor = color;
    vMetal = aMetal;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CORE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uLightDir;
  uniform float uDarkMode;
  uniform float uPolish;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vColor;
  varying float vMetal;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uLightDir);
    vec3 L_rim = normalize(vec3(-0.78, 0.42, 0.46));
    vec3 L_fill = normalize(vec3(0.65, -0.35, 0.68));

    float ndl = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    float rimDiff = clamp(dot(N, L_rim) * 0.5 + 0.5, 0.0, 1.0);
    float fillDiff = clamp(dot(N, L_fill) * 0.5 + 0.5, 0.0, 1.0);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.4);

    vec3 H = normalize(L + V);
    float specSharp = pow(max(dot(N, H), 0.0), mix(26.0, 56.0, vMetal));
    float specRim = pow(max(dot(N, normalize(L_rim + V)), 0.0), 18.0);

    vec3 baseCol = mix(vColor * 0.92, vColor * 1.04, uDarkMode);
    vec3 lit = baseCol * (0.36 + 0.56 * ndl + 0.16 * rimDiff + 0.12 * fillDiff);
    vec3 specCol = mix(vec3(0.95, 0.98, 1.0), vec3(0.86, 0.94, 1.0), vMetal);
    lit += specCol * (specSharp * mix(0.45, 0.88, vMetal) + specRim * 0.24 + fres * mix(0.18, 0.36, vMetal));

    float alpha = mix(0.85, 1.0, uPolish);
    gl_FragColor = vec4(clamp(lit, 0.0, 1.0), alpha);
  }
`;

/* ============================================================================
 * 2) 26 块本体着色器（2.B 浅冰透 / 微雾面壳体 + 真实内挖球面空腔轨迹高光）
 * ========================================================================== */
const SHELL_VERTEX_SHADER = /* glsl */ `
  attribute float aCavity;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vCavity;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vCavity = aCavity;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SHELL_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uLightDir;
  uniform float uDarkMode;
  uniform float uIsBackFace;
  uniform float uPolish;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vCavity;

  void main() {
    vec3 N = normalize(vWorldNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uLightDir);
    vec3 L_rim = normalize(vec3(-0.74, 0.52, 0.42));

    float ndl = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.2);
    float cavityFlag = smoothstep(0.35, 0.75, vCavity);

    // 浅冰透微雾面基底：深色用清冷亮冰白、浅色用摄影棚冷银玻璃边对比，杜绝在浅色背景隐身
    vec3 frostLight = mix(vec3(0.56, 0.65, 0.78), vec3(0.84, 0.90, 0.96), ndl);
    vec3 frostDark = mix(vec3(0.68, 0.79, 0.94), vec3(0.92, 0.97, 1.00), ndl);
    vec3 baseCol = mix(frostLight, frostDark, uDarkMode);

    // 微雾面柔光高光（宽磨砂 + 细棱清光）
    float specBroad = pow(max(dot(N, normalize(L + V)), 0.0), 14.0);
    float specCrisp = pow(max(dot(N, normalize(L + V)), 0.0), 52.0);
    float rimSpec = pow(max(dot(N, normalize(L_rim + V)), 0.0), 16.0);

    // 内挖球面空腔壁：呈现清透平凹球面弧光，优雅清晰地交代内部球形空缺结构
    vec3 cavTint = mix(vec3(0.48, 0.66, 0.86), vec3(0.66, 0.88, 1.00), uDarkMode);
    vec3 col = mix(baseCol, cavTint, cavityFlag * 0.48);
    col += vec3(0.94, 0.98, 1.00) * (specBroad * 0.24 + specCrisp * 0.44 + rimSpec * 0.16);

    // 菲涅尔边缘：深色主题泛亮冰白边，浅色主题呈精致冷灰蓝玻璃折光轮廓
    vec3 fresCol = mix(vec3(0.46, 0.58, 0.74), vec3(0.94, 0.98, 1.00), uDarkMode);
    col = mix(col, fresCol, fres * (0.44 + cavityFlag * 0.26));

    float alpha;
    if (uIsBackFace > 0.5) {
      // 远侧内壁：轻薄通透，用清晰的球腔内弧托住 6 轴核心而不厚重
      alpha = mix(0.08, 0.24, fres) + cavityFlag * (0.14 + fres * 0.28);
      alpha *= mix(1.04, 0.92, uDarkMode);
    } else {
      // 近侧壳体肩部、块间物理细缝与拧开剖面：细腻微雾面质感
      alpha = mix(0.18, 0.48, fres) + specBroad * 0.10 + specCrisp * 0.14;
      alpha += cavityFlag * (0.16 + fres * 0.22);
      alpha *= mix(1.12, 0.96, uDarkMode);
    }

    alpha = clamp(alpha * mix(0.55, 1.0, uPolish), 0.04, 0.68);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;

/* ============================================================================
 * 3) 54 片外露独立贴片着色器（1.B 外露卡盖 + 3.B 半透果冻 / 亚克力薄片）
 * ========================================================================== */
const CAP_VERTEX_SHADER = /* glsl */ `
  attribute float aEdge;
  attribute vec3 aFaceNormal;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vFaceNormalW;
  varying vec3 vLocalPos;
  varying vec3 vColor;
  varying float vEdge;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    mat3 m3 = mat3(modelMatrix);
    vWorldNormal = normalize(m3 * normal);
    vFaceNormalW = normalize(m3 * aFaceNormal);
    vLocalPos = position;
    vColor = color;
    vEdge = aEdge;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CAP_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uLightDir;
  uniform float uDarkMode;
  uniform float uPolish;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vFaceNormalW;
  varying vec3 vLocalPos;
  varying vec3 vColor;
  varying float vEdge;

  void main() {
    vec3 V = normalize(cameraPosition - vWorldPos);
    // 精准剔除背面所属贴片的倒角裙边，彻底杜绝远侧贴片细线穿透干扰
    float faceFacing = dot(normalize(vFaceNormalW), V);
    if (faceFacing <= -0.02) discard;
    float facingFade = smoothstep(-0.02, 0.08, faceFacing);

    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uLightDir);
    vec3 L_rim = normalize(vec3(-0.76, 0.48, 0.44));
    vec3 L_bounce = normalize(vec3(0.45, -0.75, 0.48));

    // 明快半透亚克力受光：暗部保色通透（拒绝脏灰厚重阴影）
    float ndlRaw = dot(N, L);
    float ndl = clamp(ndlRaw * 0.52 + 0.48, 0.0, 1.0);
    float rimLight = clamp(dot(N, L_rim) * 0.5 + 0.5, 0.0, 1.0);
    float bounce = clamp(dot(N, L_bounce) * 0.5 + 0.5, 0.0, 1.0);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.3);

    vec3 H = normalize(L + V);
    float specTight = pow(max(dot(N, H), 0.0), 64.0);
    float specSoft = pow(max(dot(N, H), 0.0), 16.0);
    float specRim = pow(max(dot(N, normalize(L_rim + V)), 0.0), 28.0);

    // 白面在浅色主题自带精致冷银陶瓷立体边，绝不与浅色背景融成一团
    float isWhite = smoothstep(0.84, 0.95, min(vColor.r, min(vColor.g, vColor.b)));
    vec3 whiteShadow = mix(vec3(0.72, 0.80, 0.90), vec3(0.78, 0.86, 0.96), uDarkMode);
    vec3 whiteBright = mix(vec3(0.95, 0.97, 1.00), vec3(1.00, 1.00, 1.00), uDarkMode);
    vec3 shadowTint = mix(vColor * vec3(0.76, 0.78, 0.84), whiteShadow, isWhite);
    vec3 brightTint = mix(clamp(vColor * 1.09, 0.0, 1.0), whiteBright, isWhite);

    vec3 col = mix(shadowTint, brightTint, smoothstep(0.12, 0.92, ndl * 0.78 + rimLight * 0.16 + bounce * 0.10));

    // 3D 倒角裙边微增光学厚度与清脆高光，强化「真实外露独立贴片」工艺感
    float bevelMask = smoothstep(0.35, 0.95, vEdge);
    vec3 whiteBevel = mix(vec3(0.68, 0.77, 0.88), vec3(0.96, 0.98, 1.00), uDarkMode);
    vec3 bevelHighlight = mix(mix(vColor, vec3(1.0), 0.48), whiteBevel, isWhite);
    col = mix(col, bevelHighlight, bevelMask * mix(0.24 + 0.22 * ndl, 0.42, isWhite * (1.0 - uDarkMode)));

    // 果冻亚克力表面镜面清光 + 菲涅尔掠射光泽
    col = mix(col, vec3(1.0), specTight * 0.68 + specSoft * 0.12 + specRim * 0.14);
    vec3 capFresCol = mix(mix(vColor, vec3(0.95, 0.98, 1.0), 0.68), mix(vec3(0.66, 0.76, 0.88), vec3(1.0), uDarkMode), isWhite);
    col = mix(col, capFresCol, fres * 0.24);

    // 入场 0.85s 丝滑扫光
    float sweep = clamp((vLocalPos.y - vLocalPos.x * 0.35) * 0.46 + 0.5, 0.0, 1.0);
    if (uPolish > 0.001 && uPolish < 0.999) {
      float band = 1.0 - smoothstep(0.0, 0.09, abs(sweep - uPolish));
      col = mix(col, vec3(1.0), band * 0.55);
    }

    // 3.B 半透果冻/亚克力薄片透明度：正视轻薄透亮 (~0.78)，倒角边缘与掠射角凝实 (~0.93)
    float baseAlpha = mix(0.77, 0.81, isWhite);
    float alpha = baseAlpha
      + bevelMask * 0.11
      + fres * 0.12
      + specTight * 0.12;
    alpha = clamp(alpha * mix(1.04, 0.98, uDarkMode), 0.72, 0.94) * facingFade;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;

/* ============================================================================
 * 4) 斜射光学焦散 + 柔和中性接触影地面着色器（保留既有风格）
 * ========================================================================== */
const CAUSTIC_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CAUSTIC_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform mat3 uModelRot;
  uniform vec3 uCubeCenter;
  uniform float uGemScale;
  uniform float uIntensity;
  uniform float uDarkMode;
  uniform float uTwistPulse;

  varying vec3 vWorldPos;

  vec3 harmonicAccentColor(int idx) {
    if (idx == 0) return vec3(0.68, 0.88, 1.00); // 冰蓝白
    if (idx == 1) return vec3(1.00, 0.86, 0.42); // 柔金
    if (idx == 2) return vec3(0.28, 0.92, 0.68); // 翡翠青
    if (idx == 3) return vec3(0.36, 0.74, 1.00); // 蔚蓝
    if (idx == 4) return vec3(1.00, 0.48, 0.64); // 柔玫
    return vec3(1.00, 0.68, 0.36);               // 暖琥珀
  }

  vec3 computeDominantCausticHue(vec3 lightDir) {
    vec3 axes[6];
    axes[0] = uModelRot * vec3( 0.0,  1.0,  0.0);
    axes[1] = uModelRot * vec3( 0.0, -1.0,  0.0);
    axes[2] = uModelRot * vec3( 0.0,  0.0,  1.0);
    axes[3] = uModelRot * vec3( 0.0,  0.0, -1.0);
    axes[4] = uModelRot * vec3( 1.0,  0.0,  0.0);
    axes[5] = uModelRot * vec3(-1.0,  0.0,  0.0);

    vec3 acc = vec3(0.0);
    float wSum = 0.0001;
    for (int i = 0; i < 6; i++) {
      float w = pow(max(dot(axes[i], lightDir), 0.0), 4.0);
      acc += harmonicAccentColor(i) * w;
      wSum += w;
    }
    vec3 dom = acc / wSum;
    return mix(dom, vec3(0.56, 0.84, 1.00), 0.30);
  }

  void main() {
    vec2 rel = vWorldPos.xz - uCubeCenter.xz;
    float s = max(uGemScale, 0.01);

    // 1) 正下方极克制的柔和中性悬浮影
    vec2 shadowP = rel / (s * vec2(1.22, 0.98));
    float shadowR = length(shadowP);
    float shadowMask = exp(-shadowR * shadowR * 2.35);
    vec3 shadowCol = mix(vec3(0.52, 0.58, 0.70), vec3(0.02, 0.04, 0.08), uDarkMode);
    float shadowA = shadowMask * mix(0.20, 0.42, uDarkMode);

    // 2) 斜射 38° 分离式焦散光环
    vec2 causticCenter = vec2(0.58 * s, -0.36 * s);
    vec2 cp = (rel - causticCenter) / (s * 1.15);
    float rotA = -0.45;
    float cs = cos(rotA), sn = sin(rotA);
    vec2 rcp = vec2(cp.x * cs - cp.y * sn, cp.x * sn + cp.y * cs) * vec2(0.86, 1.24);
    float r = length(rcp);
    float ang = atan(rcp.y, rcp.x);

    float arcRipple = 0.08 * cos(ang * 2.0 + 0.6) + 0.04 * sin(ang * 4.0 - 0.8);
    float ringD = abs(r - (0.52 + arcRipple));
    float outerArc = exp(-ringD * ringD * 22.0) * smoothstep(1.15, 0.25, r);
    float innerPool = exp(-r * r * 3.4);
    float focusCore = exp(-dot(rcp - vec2(0.06, -0.03), rcp - vec2(0.06, -0.03)) * 18.0);

    float prismShift = clamp(rcp.x * 0.9 + 0.5, 0.0, 1.0);
    vec3 domHue = computeDominantCausticHue(normalize(vec3(-0.46, 0.82, 0.34)));
    vec3 wingLeft = mix(domHue, vec3(0.42, 0.88, 1.00), 0.45);
    vec3 wingRight = mix(domHue, vec3(0.76, 0.62, 1.00), 0.42);
    vec3 causticHue = mix(wingLeft, wingRight, prismShift);

    float twistBoost = 1.0 + uTwistPulse * 0.28;
    float causticEnergy = clamp((innerPool * 0.55 + outerArc * 0.72 + focusCore * 0.95) * uIntensity * twistBoost, 0.0, 1.0);
    vec3 causticCol = mix(causticHue, vec3(1.0), clamp(focusCore * 0.78 + outerArc * 0.25, 0.0, 1.0));
    float causticA = causticEnergy * mix(0.42, 0.52, uDarkMode);

    float totalA = clamp(shadowA + causticA * (1.0 - shadowA * 0.35), 0.0, 0.92);
    if (totalA < 0.003) discard;
    vec3 finalCol = (shadowCol * shadowA * (1.0 - causticEnergy * 0.6) + causticCol * causticA) / max(totalA, 0.001);

    gl_FragColor = vec4(clamp(finalCol, 0.0, 1.0), totalA);
  }
`;

export class StartCausticCubeView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly cubeGroup = new Group();
  private readonly chunkGroups: Record<ChunkKey, Group>;
  private readonly coreMat: ShaderMaterial;
  private readonly shellBackMat: ShaderMaterial;
  private readonly shellFrontMat: ShaderMaterial;
  private readonly capMat: ShaderMaterial;
  private readonly causticMat: ShaderMaterial;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly parallaxHost: HTMLElement | null;
  private reducedMotion: boolean;
  private raf = 0;
  private disposed = false;
  private startedAt = 0;
  private lastT = 0;
  private spinAngle = -2.24; // 首帧呈现经典「左红 / 右蓝 / 上白」，与新版应用图标视觉呼应
  private parSmooth = new Vector2(0, 0);

  constructor(
    private readonly container: HTMLElement,
    opts: StartCausticCubeOptions = {},
  ) {
    this.parallaxHost = opts.parallaxHost ?? null;
    this.reducedMotion = opts.reducedMotion ?? false;
    const theme: StartCubeTheme = opts.theme ?? "dark";
    const isDark = theme === "dark" ? 1 : 0;
    const initPolish = this.reducedMotion ? 1.0 : 0.0;
    const lightDir = new Vector3(-0.46, 0.82, 0.34).normalize();

    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    this.camera = new PerspectiveCamera(33, 1, 0.1, 30);
    this.camera.position.set(0, 1.65, 8.2);
    this.camera.lookAt(0, -0.12, 0);

    const gemScale = 1.0;

    // 1) 斜射高清光学焦散 + 柔和接触影地面（renderOrder = 0）
    const causticGeo = new PlaneGeometry(5.6, 5.6);
    this.causticMat = new ShaderMaterial({
      vertexShader: CAUSTIC_VERTEX_SHADER,
      fragmentShader: CAUSTIC_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uModelRot: { value: new Matrix3() },
        uCubeCenter: { value: new Vector3(0, 0.34, 0) },
        uGemScale: { value: gemScale },
        uIntensity: { value: initPolish },
        uDarkMode: { value: isDark },
        uTwistPulse: { value: this.reducedMotion ? 0.45 : 0.0 },
      },
    });
    const causticMesh = new Mesh(causticGeo, this.causticMat);
    causticMesh.rotation.x = -Math.PI / 2;
    causticMesh.position.set(0, -1.72, 0);
    causticMesh.renderOrder = 0;
    this.scene.add(causticMesh);

    // 2) 构建 4 分区真实 3D 几何体 + 6 轴十字轴芯
    const geos = buildStartCubeGeometries();

    // 2.1) 6 轴核心（不透明，renderOrder = 1）
    this.coreMat = new ShaderMaterial({
      vertexShader: CORE_VERTEX_SHADER,
      fragmentShader: CORE_FRAGMENT_SHADER,
      vertexColors: true,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      uniforms: {
        uLightDir: { value: lightDir.clone() },
        uDarkMode: { value: isDark },
        uPolish: { value: initPolish },
      },
    });
    const coreMesh = new Mesh(geos.core, this.coreMat);
    coreMesh.renderOrder = 1;
    this.cubeGroup.add(coreMesh);

    // 2.2) 26 块浅冰透微雾面壳体（BackSide renderOrder = 2，FrontSide renderOrder = 3）
    this.shellBackMat = new ShaderMaterial({
      vertexShader: SHELL_VERTEX_SHADER,
      fragmentShader: SHELL_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: BackSide,
      uniforms: {
        uLightDir: { value: lightDir.clone() },
        uDarkMode: { value: isDark },
        uIsBackFace: { value: 1.0 },
        uPolish: { value: initPolish },
      },
    });

    this.shellFrontMat = new ShaderMaterial({
      vertexShader: SHELL_VERTEX_SHADER,
      fragmentShader: SHELL_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: FrontSide,
      uniforms: {
        uLightDir: { value: lightDir.clone() },
        uDarkMode: { value: isDark },
        uIsBackFace: { value: 0.0 },
        uPolish: { value: initPolish },
      },
    });

    // 2.3) 54 片外露半透果冻/亚克力独立贴片（FrontSide renderOrder = 4，depthWrite=true 杜绝拧转叠层穿帮）
    this.capMat = new ShaderMaterial({
      vertexShader: CAP_VERTEX_SHADER,
      fragmentShader: CAP_FRAGMENT_SHADER,
      vertexColors: true,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: FrontSide,
      uniforms: {
        uLightDir: { value: lightDir.clone() },
        uDarkMode: { value: isDark },
        uPolish: { value: initPolish },
      },
    });

    const keys: ChunkKey[] = ["ur", "uOnly", "rOnly", "rest"];
    this.chunkGroups = {} as Record<ChunkKey, Group>;
    for (const k of keys) {
      const grp = new Group();
      const shellBack = new Mesh(geos.chunks[k].shell, this.shellBackMat);
      shellBack.renderOrder = 2;
      const shellFront = new Mesh(geos.chunks[k].shell, this.shellFrontMat);
      shellFront.renderOrder = 3;
      const caps = new Mesh(geos.chunks[k].caps, this.capMat);
      caps.renderOrder = 4;

      grp.add(shellBack, shellFront, caps);
      this.cubeGroup.add(grp);
      this.chunkGroups[k] = grp;

      this.disposables.push(geos.chunks[k].shell, geos.chunks[k].caps);
    }

    this.cubeGroup.position.set(0, 0.36, 0);
    this.scene.add(this.cubeGroup);

    this.disposables.push(
      causticGeo,
      this.causticMat,
      geos.core,
      this.coreMat,
      this.shellBackMat,
      this.shellFrontMat,
      this.capMat,
    );

    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(container);
    this.fit();
    this.applyLayerTwist(0, this.reducedMotion ? 0.38 : 0);
    this.applyFrame(0, 0);
    if (!this.reducedMotion) this.start();
  }

  setTheme(theme: StartCubeTheme): void {
    if (this.disposed) return;
    const isDark = theme === "dark" ? 1 : 0;
    this.coreMat.uniforms.uDarkMode.value = isDark;
    this.shellBackMat.uniforms.uDarkMode.value = isDark;
    this.shellFrontMat.uniforms.uDarkMode.value = isDark;
    this.capMat.uniforms.uDarkMode.value = isDark;
    this.causticMat.uniforms.uDarkMode.value = isDark;
    this.render();
  }

  setReducedMotion(reduced: boolean): void {
    if (this.disposed || this.reducedMotion === reduced) return;
    this.reducedMotion = reduced;
    if (reduced) {
      this.stop();
      this.setPolish(1.0);
      this.applyLayerTwist(0, 0.38);
      this.causticMat.uniforms.uIntensity.value = 1.0;
      this.causticMat.uniforms.uTwistPulse.value = 0.45;
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

  private setPolish(val: number): void {
    this.coreMat.uniforms.uPolish.value = val;
    this.shellBackMat.uniforms.uPolish.value = val;
    this.shellFrontMat.uniforms.uPolish.value = val;
    this.capMat.uniforms.uPolish.value = val;
  }

  private applyLayerTwist(axis: number, angle: number): void {
    if (axis === 0) {
      // U 层（+Y 顶层）拧转
      this.chunkGroups.ur.rotation.set(0, angle, 0);
      this.chunkGroups.uOnly.rotation.set(0, angle, 0);
      this.chunkGroups.rOnly.rotation.set(0, 0, 0);
    } else {
      // R 层（+X 右层）拧转
      this.chunkGroups.ur.rotation.set(angle, 0, 0);
      this.chunkGroups.rOnly.rotation.set(angle, 0, 0);
      this.chunkGroups.uOnly.rotation.set(0, 0, 0);
    }
  }

  private readParallax(): { u: number; v: number } {
    const host = this.parallaxHost;
    if (!host) return { u: 0, v: 0 };
    const u = Number.parseFloat(host.style.getPropertyValue("--par-u")) || 0;
    const v = Number.parseFloat(host.style.getPropertyValue("--par-v")) || 0;
    return { u, v };
  }

  private syncCausticUniforms(): void {
    this.cubeGroup.updateMatrixWorld(true);
    const m = this.cubeGroup.matrixWorld.elements;
    const causticRot = this.causticMat.uniforms.uModelRot.value as Matrix3;
    causticRot.set(m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]);
    this.causticMat.uniforms.uCubeCenter.value.copy(this.cubeGroup.position);
  }

  /**
   * 周期性单层呼吸微拧（每 6.4s 一个周期）：
   * 奇数周期拧顶层 U，偶数周期拧右层 R，最大约 36.7° 展露内挖球面空腔与真实 6 轴结构。
   */
  private evalMotionTwist(elapsedSec: number): { axis: number; angle: number; pulse: number } {
    const cycleDur = 6.4;
    const cycleIdx = Math.floor(elapsedSec / cycleDur);
    const localT = elapsedSec - cycleIdx * cycleDur;
    const axis = cycleIdx % 2;

    const startT = 1.1;
    const activeDur = 3.2;
    if (localT < startT || localT > startT + activeDur) {
      return { axis, angle: 0, pulse: 0 };
    }
    const u = (localT - startT) / activeDur;
    const s = Math.sin(u * Math.PI);
    const bell = Math.pow(s, 0.72);
    const maxAngle = 0.64; // ~36.7°
    return { axis, angle: bell * maxAngle, pulse: bell };
  }

  private applyFrame(dtSec: number, elapsedSec: number): void {
    const spinSpeed = (Math.PI * 2) / 48;
    if (!this.reducedMotion) {
      this.spinAngle += spinSpeed * dtSec;
    }

    const par = this.readParallax();
    const alpha = dtSec > 0 ? 1 - Math.exp(-8 * dtSec) : 1;
    this.parSmooth.x += (par.u - this.parSmooth.x) * alpha;
    this.parSmooth.y += (par.v - this.parSmooth.y) * alpha;

    const bob = this.reducedMotion ? 0 : Math.sin(elapsedSec * 1.05) * 0.045;
    this.cubeGroup.position.y = 0.36 + bob;

    const basePitch = 0.36;
    const baseRoll = 0.10;
    this.cubeGroup.rotation.set(
      basePitch - this.parSmooth.y * 0.14,
      this.spinAngle + this.parSmooth.x * 0.24,
      baseRoll + this.parSmooth.x * 0.05,
    );

    if (!this.reducedMotion) {
      const p = Math.min(1, elapsedSec / 0.85);
      const eased = 1 - Math.pow(1 - p, 3);
      this.setPolish(eased);
      this.causticMat.uniforms.uIntensity.value = eased;

      const tw = this.evalMotionTwist(elapsedSec);
      this.applyLayerTwist(tw.axis, tw.angle);
      this.causticMat.uniforms.uTwistPulse.value = tw.pulse;
    }

    this.syncCausticUniforms();
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
    const w = this.container.clientWidth || 380;
    const h = this.container.clientHeight || 410;
    const aspect = w / h;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    if (this.disposed) return;
    this.renderer.clear();
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
      // 忽略不支持 forceContextLoss 的环境
    }
    this.renderer.domElement.remove();
  }
}
