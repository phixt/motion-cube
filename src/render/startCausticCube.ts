/**
 * 开始页高清折光速拧魔方 + 斜射光学焦散（Three.js + 自定义 GLSL）：
 * 设计特点：
 * - 原生高分锐利渲染：取消 216px 低分像素放大与大面积 Bayer 麻点，以原生 DPR + 解析边缘抗锯齿
 *   呈现现代 WinUI 3 协调的风格化高清大色块晶体质感；
 * - 真实高端速拧机械结构 × 物理光学破局：
 *   1) 外壳 26 块带 45° 锐利倒角切棱 + 标准 Florian 圆角小面，自带清脆棱光与微色散；
 *   2) 块体内侧真实「内挖球面空腔」（Carved Spherical Cavity，而非实心内嵌核）：光线经平凹球面壁
 *      自然形成平凹透镜折射与曲面全内反射弧光，彻底解决平行立方体折不出光的物理难题；
 *   3) 球面空腔正中架设「真实 6 轴十字轴芯」（中心多面轴毂 + ±X/±Y/±Z 六根精密轴柱与调松帽），
 *      透过球面空腔产生真实折射视差与机械层次感；
 *   4) 动态层间微拧（Motion 呼吸）：周期性轻柔拧开顶层/右层约 36° 展露内挖球腔弧壁与 6 轴结构再磁吸回正；
 * - 克制斜射焦散地面：柔和中性接触影与斜射光学焦散丝带分离，同一时刻仅收敛投射当前受光主导面主色，
 *   彻底告别杂乱的四色马赛克底垫。
 */
import {
  BackSide,
  BoxGeometry,
  DoubleSide,
  Group,
  Matrix3,
  Matrix4,
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
  /** 是否降低动态效果（静止渲染优雅微拧首帧、跳过扫光与轮转） */
  reducedMotion?: boolean;
};

const CUBE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vLocalPos;

  void main() {
    vLocalPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 高清折光速拧魔方片元着色器（45° 倒角外棱 + 内挖球面空腔 + 真实 6 轴十字轴芯 + 动态层间微拧）：
 */
const CUBE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float uGemScale;
  uniform vec3 uLocalCam;
  uniform mat3 uModelRot;
  uniform vec3 uLightDir;
  uniform float uPolish;
  uniform float uDarkMode;
  uniform int uTwistAxis;     // 0 = +Y (U层), 1 = +X (R层)
  uniform float uTwistAngle;  // 当前层拧转角（弧度）

  varying vec3 vLocalPos;

  // 鲜亮克制的现代速拧六面基色（0:U 冰白, 1:D 向日黄, 2:F 翡翠绿, 3:B 蔚蓝, 4:R 珊瑚红, 5:L 琥珀橙）
  vec3 faceVibrantColor(int idx) {
    if (idx == 0) return mix(vec3(0.92, 0.96, 1.00), vec3(0.95, 0.98, 1.00), uDarkMode);
    if (idx == 1) return vec3(1.00, 0.85, 0.20);
    if (idx == 2) return vec3(0.12, 0.86, 0.56);
    if (idx == 3) return vec3(0.18, 0.62, 1.00);
    if (idx == 4) return vec3(0.98, 0.30, 0.44);
    return vec3(1.00, 0.56, 0.16);
  }

  // 保色高阶风格化色阶（平滑清晰的大色块过渡，零麻点脏灰）
  vec3 sampleCrystalRamp(int faceIdx, vec3 baseCol, float val) {
    vec3 c0;
    if (faceIdx == 0) c0 = mix(vec3(0.68, 0.80, 0.95), vec3(0.56, 0.70, 0.90), uDarkMode);
    else if (faceIdx == 5) c0 = vec3(0.84, 0.32, 0.08);
    else if (faceIdx == 2) c0 = vec3(0.05, 0.56, 0.38);
    else if (faceIdx == 1) c0 = vec3(0.86, 0.58, 0.06);
    else if (faceIdx == 4) c0 = vec3(0.74, 0.12, 0.30);
    else c0 = vec3(0.10, 0.36, 0.84);

    vec3 c1 = mix(c0, baseCol, 0.62);
    vec3 c2 = clamp(baseCol * 1.05, 0.0, 1.0);
    vec3 c3 = mix(baseCol, vec3(1.0), 0.54);

    float v = clamp(val, 0.0, 1.0) * 3.0;
    // 软化风格化阶梯：保留大色块明快感，但完全消除像素锯齿跳变
    float t0 = smoothstep(0.18, 0.82, clamp(v, 0.0, 1.0));
    float t1 = smoothstep(0.18, 0.82, clamp(v - 1.0, 0.0, 1.0));
    float t2 = smoothstep(0.18, 0.82, clamp(v - 2.0, 0.0, 1.0));
    vec3 col = mix(c0, c1, t0);
    col = mix(col, c2, t1);
    col = mix(col, c3, t2);
    return col;
  }

  // 绕主轴旋转点/方向
  vec3 rotTwist(vec3 p, float ang) {
    float c = cos(ang);
    float s = sin(ang);
    if (uTwistAxis == 0) {
      return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
    }
    return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
  }

  // 45° 锐利倒角速拧立方体 SDF（带微圆角收边 + 12 棱 45° 光学斜切倒角）
  float sdBeveledCube(vec3 p, float halfS) {
    float r = 0.085 * halfS;
    vec3 q = abs(p) - vec3(halfS - r);
    float dBox = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;

    // 12 棱 45° 斜切平面（打破纯正方体单调，提供真实 45° 折光棱面）
    vec3 a = abs(p);
    float bevelDist = halfS * 1.335; // 控制倒角宽度约 0.115 * halfS
    float dEdgeXY = (a.x + a.y) * 0.70710678 - bevelDist;
    float dEdgeYZ = (a.y + a.z) * 0.70710678 - bevelDist;
    float dEdgeZX = (a.z + a.x) * 0.70710678 - bevelDist;
    float dEdge = max(dEdgeXY, max(dEdgeYZ, dEdgeZX));

    // 8 顶角轻微八面体斜切
    float dCorner = (a.x + a.y + a.z) * 0.57735027 - halfS * 1.54;

    return max(dBox, max(dEdge, dCorner));
  }

  // 现代速拧魔方带动态单层拧转 + 内挖球面空腔（布尔减球！）的组合外壳 SDF
  // 返回 vec2(sdf, layerId: 0=静止主躯干, 1=拧转活动层)
  vec2 mapShell(vec3 p, float halfS) {
    float splitC = 0.3333 * halfS;
    float gapHalf = 0.008 * halfS;
    float coord = (uTwistAxis == 0) ? p.y : p.x;

    // 静止 2 层躯干（coord <= splitC - gapHalf）
    float dStaticBox = sdBeveledCube(p, halfS);
    float dStatic = max(dStaticBox, coord - (splitC - gapHalf));

    // 活动 1 层（coord >= splitC + gapHalf，逆旋转采样）
    vec3 pRot = rotTwist(p, -uTwistAngle);
    float dActiveBox = sdBeveledCube(pRot, halfS);
    float dActive = max(dActiveBox, (splitC + gapHalf) - coord);

    float dOuter = min(dStatic, dActive);
    float layerId = (dActive < dStatic) ? 1.0 : 0.0;

    // 关键真实结构：26 块内侧共同挖出半径 R_cav = 0.62 * halfS 的球面空腔！
    float cavR = 0.62 * halfS;
    float dHollow = max(dOuter, cavR - length(p));
    return vec2(dHollow, layerId);
  }

  vec3 calcShellNormal(vec3 p, float halfS) {
    float e = 0.0018 * halfS;
    vec2 k = vec2(1.0, -1.0);
    return normalize(
      k.xyy * mapShell(p + k.xyy * e, halfS).x +
      k.yyx * mapShell(p + k.yyx * e, halfS).x +
      k.yxy * mapShell(p + k.yxy * e, halfS).x +
      k.xxx * mapShell(p + k.xxx * e, halfS).x
    );
  }

  // 真实 6 轴十字轴芯 SDF（位于内挖球面空腔正中：多面体中心毂 + ±X/±Y/±Z 6 根轴柱 + 弹力调节帽）
  float sdCylinderAxis(vec2 q, float h, float halfLen, float r) {
    vec2 d = abs(vec2(length(q), h)) - vec2(r, halfLen);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }

  // 返回 vec2(sdf, partId: 0=中心轴毂, 1=6 轴杆, 2=轴端调松帽)
  vec2 mapSixAxisCore(vec3 p, float halfS) {
    // 1) 中心多面体小轴毂（截角八面体造型）
    vec3 a = abs(p);
    float dHubOct = (a.x + a.y + a.z) * 0.57735027 - 0.165 * halfS;
    float dHubBox = max(a.x, max(a.y, a.z)) - 0.135 * halfS;
    float dHub = max(dHubOct, dHubBox);

    // 2) 6 根沿 ±X, ±Y, ±Z 伸出的精密轴柱
    float stalkLen = 0.54 * halfS;
    float stalkR = 0.054 * halfS;
    float dX = sdCylinderAxis(p.yz, p.x, stalkLen, stalkR);
    float dY = sdCylinderAxis(p.xz, p.y, stalkLen, stalkR);
    float dZ = sdCylinderAxis(p.xy, p.z, stalkLen, stalkR);
    float dStalks = min(dX, min(dY, dZ));

    // 3) 6 个轴端阶梯帽/中心底座环（位于距心 0.44..0.57 处，紧贴球腔内壁）
    float capOff = 0.48 * halfS;
    float capLen = 0.062 * halfS;
    float capR = 0.115 * halfS;
    float cX = sdCylinderAxis(p.yz, abs(p.x) - capOff, capLen, capR);
    float cY = sdCylinderAxis(p.xz, abs(p.y) - capOff, capLen, capR);
    float cZ = sdCylinderAxis(p.xy, abs(p.z) - capOff, capLen, capR);
    float dCaps = min(cX, min(cY, cZ));

    float d = dHub;
    float part = 0.0;
    if (dStalks < d) { d = dStalks; part = 1.0; }
    if (dCaps < d) { d = dCaps; part = 2.0; }
    return vec2(d, part);
  }

  vec3 calcCoreNormal(vec3 p, float halfS) {
    float e = 0.0016 * halfS;
    vec2 k = vec2(1.0, -1.0);
    return normalize(
      k.xyy * mapSixAxisCore(p + k.xyy * e, halfS).x +
      k.yyx * mapSixAxisCore(p + k.yyx * e, halfS).x +
      k.yxy * mapSixAxisCore(p + k.yxy * e, halfS).x +
      k.xxx * mapSixAxisCore(p + k.xxx * e, halfS).x
    );
  }

  vec2 intersectSphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float h = b * b - c;
    if (h < 0.0) return vec2(1.0, -1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }

  vec2 intersectBox(vec3 ro, vec3 rd, float halfSize) {
    vec3 inv = 1.0 / (rd + vec3(1e-7));
    vec3 t0 = (-vec3(halfSize) - ro) * inv;
    vec3 t1 = (vec3(halfSize) - ro) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
  }

  int dominantFace(vec3 p) {
    vec3 a = abs(p);
    if (a.y >= a.x && a.y >= a.z) return (p.y >= 0.0) ? 0 : 1;
    if (a.z >= a.x && a.z >= a.y) return (p.z >= 0.0) ? 2 : 3;
    return (p.x >= 0.0) ? 4 : 5;
  }

  vec2 facePlaneUV(vec3 pNorm, int faceIdx) {
    if (faceIdx == 0 || faceIdx == 1) return pNorm.xz;
    if (faceIdx == 2 || faceIdx == 3) return pNorm.xy;
    return pNorm.zy;
  }

  float sdRoundedBox4(vec2 p, vec2 b, vec4 r) {
    vec2 rx = (p.x > 0.0) ? r.xy : r.zw;
    float rad = (p.y > 0.0) ? rx.x : rx.y;
    vec2 q = abs(p) - b + vec2(rad);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rad;
  }

  // 标准速拧 Florian 圆角小面 SDF + 26 块主切缝
  vec2 evalFlorianFacelet(vec3 pNorm, int faceIdx) {
    vec2 uv = facePlaneUV(pNorm, faceIdx);
    int ix = (uv.x > 0.3333) ? 1 : ((uv.x < -0.3333) ? -1 : 0);
    int iy = (uv.y > 0.3333) ? 1 : ((uv.y < -0.3333) ? -1 : 0);

    float cx = float(ix) * 0.628;
    float cy = float(iy) * 0.628;
    vec2 halfExt = vec2((ix == 0) ? 0.282 : 0.268, (iy == 0) ? 0.282 : 0.268);

    float rBig = 0.130;
    float rSmall = 0.046;

    vec4 r4 = vec4(rSmall);
    if (ix == 0 && iy == 0) {
      r4 = vec4(rBig, rBig, rBig, rBig);
    } else if (ix == 0) {
      r4 = (iy > 0) ? vec4(rSmall, rBig, rSmall, rBig) : vec4(rBig, rSmall, rBig, rSmall);
    } else if (iy == 0) {
      r4 = (ix > 0) ? vec4(rSmall, rSmall, rBig, rBig) : vec4(rBig, rBig, rSmall, rSmall);
    } else {
      if (ix > 0 && iy > 0) r4 = vec4(rSmall, rSmall, rSmall, rBig);
      else if (ix < 0 && iy > 0) r4 = vec4(rSmall, rBig, rSmall, rSmall);
      else if (ix > 0 && iy < 0) r4 = vec4(rSmall, rSmall, rBig, rSmall);
      else r4 = vec4(rBig, rSmall, rSmall, rSmall);
    }

    float tileSdf = sdRoundedBox4(uv - vec2(cx, cy), halfExt, r4);
    float dCut = min(abs(abs(uv.x) - 0.3333), abs(abs(uv.y) - 0.3333));
    return vec2(tileSdf, dCut);
  }

  // 摄影棚平滑高反差受光（含柔和双侧补光，让 45° 倒角与凹球面折光呈现清脆星彩）
  float studioEnvLum(vec3 d) {
    vec3 L_key = normalize(uLightDir);
    vec3 L_rim = normalize(vec3(-0.74, 0.54, 0.40));
    vec3 L_top = normalize(vec3(0.12, 0.96, -0.24));
    float keyT = pow(clamp(dot(d, L_key) * 0.5 + 0.5, 0.0, 1.0), 1.6) * 0.58;
    float rimT = pow(clamp(dot(d, L_rim) * 0.5 + 0.5, 0.0, 1.0), 2.0) * 0.32;
    float topT = pow(clamp(dot(d, L_top) * 0.5 + 0.5, 0.0, 1.0), 1.8) * 0.24;
    return clamp(keyT + rimT + topT + 0.14, 0.14, 1.0);
  }

  // 精细棱镜色散光色（随折射角连续过渡，绝不突跳闪烁）
  vec3 prismDispersionColor(float phase) {
    vec3 a = vec3(0.46, 0.90, 1.00); // 冰青
    vec3 b = vec3(0.68, 0.62, 1.00); // 紫罗兰
    vec3 c = vec3(1.00, 0.80, 0.44); // 暖金
    float u = fract(phase);
    if (u < 0.333) return mix(a, b, u * 3.0);
    if (u < 0.666) return mix(b, c, (u - 0.333) * 3.0);
    return mix(c, a, (u - 0.666) * 3.0);
  }

  // 评估真实 6 轴十字轴芯（在球面空腔空气中步进）
  vec4 traceSixAxisCore(vec3 ro, vec3 rd, float maxT, float halfS, vec3 L_w, vec3 V_w) {
    float t = 0.0;
    for (int i = 0; i < 20; i++) {
      vec3 p = ro + rd * t;
      vec2 res = mapSixAxisCore(p, halfS);
      if (res.x < 0.002 * halfS) {
        vec3 nL = calcCoreNormal(p, halfS);
        vec3 nW = normalize(uModelRot * nL);
        float ndl = clamp(dot(nW, L_w) * 0.5 + 0.5, 0.0, 1.0);
        float ndv = clamp(abs(dot(nW, V_w)), 0.0, 1.0);
        float fres = pow(1.0 - ndv, 2.2);
        float spec = pow(max(dot(nW, normalize(L_w + V_w)), 0.0), 32.0);

        // 中心轴毂：清冷钛银晶毂；6 根轴柱：拉丝冷钢银；轴端调松帽：对应面色微染晶帽！
        vec3 baseCore;
        if (res.y < 0.5) {
          baseCore = mix(vec3(0.70, 0.80, 0.94), vec3(0.82, 0.90, 1.00), uDarkMode);
        } else if (res.y < 1.5) {
          baseCore = mix(vec3(0.54, 0.64, 0.78), vec3(0.64, 0.74, 0.88), uDarkMode);
        } else {
          int axisFace = dominantFace(p);
          baseCore = mix(faceVibrantColor(axisFace), vec3(0.88, 0.94, 1.00), 0.45);
        }

        vec3 coreCol = baseCore * (0.42 + 0.68 * ndl) + vec3(0.88, 0.95, 1.0) * (spec * 0.75 + fres * 0.34);
        return vec4(clamp(coreCol, 0.0, 1.0), 1.0);
      }
      t += res.x;
      if (t > maxT) break;
    }
    return vec4(0.0);
  }

  // 仅在实心块体壳层内（r > cavR）评估 26 块内部隔板（空腔内彻底留空，符合真实魔方！）
  float evalShellDividers(vec3 ro, vec3 rd, float segLen, float halfS, float cavR) {
    float c = 0.3333 * halfS;
    float lim = 0.97 * halfS;
    float mask = 0.0;
    for (int axis = 0; axis < 3; axis++) {
      float dAxis = (axis == 0) ? rd.x : ((axis == 1) ? rd.y : rd.z);
      float oAxis = (axis == 0) ? ro.x : ((axis == 1) ? ro.y : ro.z);
      if (abs(dAxis) > 1e-4) {
        for (int s = 0; s < 2; s++) {
          float planeC = (s == 0) ? -c : c;
          float t = (planeC - oAxis) / dAxis;
          if (t > 0.025 && t < segLen - 0.025) {
            vec3 q = ro + rd * t;
            if (max(abs(q.x), max(abs(q.y), abs(q.z))) < lim && length(q) > cavR * 1.01) {
              float graze = pow(1.0 - abs(dAxis), 2.0);
              float depthFade = exp(-t * 0.75);
              mask += (0.14 + 0.28 * graze) * depthFade;
            }
          }
        }
      }
    }
    return clamp(mask, 0.0, 0.65);
  }

  void main() {
    vec3 ro = uLocalCam;
    vec3 rd = normalize(vLocalPos - uLocalCam);
    float halfS = uGemScale;
    float cavR = 0.62 * halfS;

    // 放宽包围盒以容纳活动层拧转时的对角突角（sqrt(2) * halfS）
    vec2 boxT = intersectBox(ro, rd, halfS * 1.46);
    if (boxT.x > boxT.y || boxT.y < 0.0) discard;

    // 1) 主光线步进：同时检测【带内挖球腔的 26 块外壳】与【暴露在空腔里的 6 轴轴芯】
    float t = max(boxT.x, 0.0);
    bool hitShell = false;
    bool hitCoreDirect = false;
    float hitLayer = 0.0;
    float minEdgeD = 1e9;

    for (int i = 0; i < 48; i++) {
      vec3 p = ro + rd * t;
      vec2 sh = mapShell(p, halfS);
      vec2 cr = mapSixAxisCore(p, halfS);
      float d = min(sh.x, cr.x);
      if (d < minEdgeD) minEdgeD = d;
      if (d < 0.0008 * halfS) {
        if (sh.x <= cr.x) {
          hitShell = true;
          hitLayer = sh.y;
        } else {
          hitCoreDirect = true;
        }
        break;
      }
      t += max(d * 0.88, 0.0008 * halfS);
      if (t > boxT.y + 0.02) break;
    }

    vec3 L_w = normalize(uLightDir);
    vec3 rdW = normalize(uModelRot * rd);
    vec3 V_w = -rdW;

    // 情况 A：光线直接穿过拧开后的层缝，直击内部的真实 6 轴十字轴芯！
    if (hitCoreDirect) {
      vec3 p = ro + rd * t;
      vec4 directCore = traceSixAxisCore(p - rd * 0.01 * halfS, rd, 0.08 * halfS, halfS, L_w, V_w);
      vec3 col = (directCore.a > 0.5) ? directCore.rgb : vec3(0.75, 0.85, 0.98);
      gl_FragColor = vec4(col, 0.98);
      return;
    }

    if (!hitShell) discard;

    vec3 hitPos = ro + rd * t;
    vec3 nLocal = calcShellNormal(hitPos, halfS);
    vec3 nW = normalize(uModelRot * nLocal);
    float ndl = clamp(dot(nW, L_w) * 0.5 + 0.5, 0.0, 1.0);
    float ndv = clamp(dot(nW, V_w), 0.0, 1.0);
    float fresnel = pow(1.0 - ndv, 2.5);

    // 判断当前命中点是外表面、拧开露出的层间剖面、还是内挖球面空腔壁！
    float rHit = length(hitPos);
    bool onCavityWall = abs(rHit - cavR) < 0.026 * halfS;
    vec3 pLayer = (hitLayer > 0.5) ? rotTwist(hitPos, -uTwistAngle) : hitPos;
    vec3 pNorm = pLayer / max(halfS, 0.001);
    float maxAbs = max(abs(pNorm.x), max(abs(pNorm.y), abs(pNorm.z)));
    bool onSplitCutWall = !onCavityWall && (maxAbs < 0.86);

    // 0.85s 优雅入场扫光
    float sweep = clamp((hitPos.y - hitPos.x * 0.35) / max(halfS * 2.2, 0.01) + 0.5, 0.0, 1.0);
    bool polished = (uPolish >= 0.999) || (uPolish > 0.001 && sweep <= uPolish);

    // 情况 B：光线直接看到拧开后裸露的【内挖球面空腔内壁】或【层间机械剖面】
    if (onCavityWall || onSplitCutWall) {
      int nearFace = dominantFace(pNorm);
      vec3 fCol = faceVibrantColor(nearFace);
      float spec = pow(max(dot(nW, normalize(L_w + V_w)), 0.0), 40.0);
      vec3 wallBase = onCavityWall
        ? mix(vec3(0.74, 0.88, 1.00), fCol, 0.30)   // 抛光内挖球面轨道：晶莹微透带面色反光
        : mix(fCol * 0.82, vec3(0.84, 0.92, 1.00), 0.36);
      vec3 col = wallBase * (0.48 + 0.58 * ndl) + vec3(1.0) * (spec * 0.72 + fresnel * 0.30);
      // 内挖球面壁边缘带一抹精致棱镜折光
      if (onCavityWall) {
        vec3 disp = prismDispersionColor(dot(nW, L_w) * 0.8 + fresnel * 0.6);
        col = mix(col, disp, fresnel * 0.38);
      }
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 0.90);
      return;
    }

    int enterFace = dominantFace(pNorm);
    vec3 enterCol = faceVibrantColor(enterFace);

    // 检测是否位于 45° 锐利倒角折光棱面上
    vec3 absP = abs(pNorm);
    float edgeSum = max(absP.x + absP.y, max(absP.y + absP.z, absP.z + absP.x));
    float isBevelFacet = smoothstep(1.81, 1.87, edgeSum);

    vec2 fl = evalFlorianFacelet(pNorm, enterFace);
    float tileSdf = fl.x;
    float cutDist = fl.y;
    // 平滑抗锯齿 26 块主分隔缝（告别粗糙锯齿暗线）
    float seamMask = (1.0 - smoothstep(0.010, 0.022, cutDist)) * (1.0 - smoothstep(0.15, 0.55, isBevelFacet));
    float tileMask = 1.0 - smoothstep(-0.012, 0.012, tileSdf);

    if (!polished) {
      vec3 col = sampleCrystalRamp(enterFace, enterCol, ndl * 0.65 + 0.22);
      if (uPolish > 0.001 && abs(sweep - uPolish) < 0.07) col = mix(col, vec3(1.0), 0.85);
      gl_FragColor = vec4(col, 0.92);
      return;
    }

    // 2) 核心物理光学追踪：外壳折射 → 命中【内挖球面空腔】形成平凹透镜折射/全内反射 → 穿透空腔看【6 轴轴芯】！
    float ior = 1.54;
    vec3 rDir = normalize(refract(rd, nLocal, 1.0 / ior));
    vec3 inStart = hitPos - nLocal * (0.012 * halfS);

    // 精确解析求交：折射光线是否撞上内部挖出的球面空腔（R = 0.62 * halfS）
    vec2 cavHit = intersectSphere(inStart, rDir, cavR);
    bool hitsCavity = (cavHit.x > 0.005 * halfS && cavHit.x < cavHit.y);

    vec3 internalCol = enterCol;
    float prismEnergy = 0.0;
    float coreVis = 0.0;
    float dividerMask = 0.0;

    if (hitsCavity) {
      vec3 cavEnterP = inStart + rDir * cavHit.x;
      // 内挖球面壁外法线（指向壳内）= +normalize(cavEnterP)，光线从壳内射向球心，所以入空气界面法线为 +normalize(cavEnterP)
      vec3 nCavOut = normalize(cavEnterP);
      // Snell 从高折射率壳(1.54) → 空气球腔(1.0)
      vec3 airDir = refract(rDir, nCavOut, ior);
      float cavGrazing = pow(1.0 - clamp(abs(dot(rDir, nCavOut)), 0.0, 1.0), 1.8);

      dividerMask = evalShellDividers(inStart, rDir, cavHit.x, halfS, cavR);

      if (length(airDir) < 0.001) {
        // === 真实曲面全内反射（TIR）！平凹球面壁像曲面棱镜把光线折回，产生宝石般璀璨弧光与色散！ ===
        vec3 tirDir = normalize(reflect(rDir, nCavOut));
        vec3 tirW = normalize(uModelRot * tirDir);
        float tirLum = studioEnvLum(tirW);
        vec3 dispCol = prismDispersionColor(dot(tirW, L_w) * 0.65 + cavHit.x * 0.45);
        internalCol = mix(enterCol, mix(dispCol, vec3(1.0), 0.45), 0.55 + 0.35 * tirLum);
        prismEnergy = clamp(0.45 + 0.55 * tirLum, 0.0, 1.0);
      } else {
        // === 光线折射进入球面空腔（平凹透镜偏折！）→ 追踪真实的 6 轴十字轴芯！ ===
        airDir = normalize(airDir);
        vec2 cavExit = intersectSphere(cavEnterP + airDir * 0.004 * halfS, airDir, cavR);
        float cavSpan = max(cavExit.y, 0.05 * halfS);
        vec4 coreHit = traceSixAxisCore(cavEnterP + airDir * 0.004 * halfS, airDir, cavSpan, halfS, L_w, V_w);

        // 同时计算球面色散边缘（靠近临界角时的真实 RGB 折射率分离感）
        float nearCrit = smoothstep(0.42, 0.96, cavGrazing);
        vec3 dispRim = prismDispersionColor(dot(uModelRot * airDir, L_w) * 0.7 + cavGrazing * 0.8);

        if (coreHit.a > 0.5) {
          // 清晰透见真实的 6 轴轴芯与中心毂！
          internalCol = mix(enterCol, coreHit.rgb, 0.64);
          coreVis = 0.75;
        } else {
          // 穿过空腔望见对侧球腔壁与远端面色
          vec3 cavFarP = cavEnterP + airDir * cavSpan;
          vec3 nFar = normalize(cavFarP);
          vec3 farRefr = normalize(refract(airDir, -nFar, 1.0 / ior));
          int farFace = dominantFace(cavFarP + farRefr * 0.35 * halfS);
          vec3 farCol = faceVibrantColor(farFace);
          float farLum = studioEnvLum(normalize(uModelRot * farRefr));
          internalCol = mix(enterCol, mix(farCol, vec3(0.92, 0.97, 1.0), farLum * 0.32), 0.42);
        }

        // 球面壁近临界角的柔和彩虹折光弧带
        internalCol = mix(internalCol, dispRim, nearCrit * 0.48);
        prismEnergy = nearCrit * 0.72;
      }
    } else {
      // 未穿过中央球腔（掠过魔方外围角块/棱块）→ 45° 斜切外棱 + 背面折光
      vec2 outBox = intersectBox(inStart, rDir, halfS * 1.02);
      float tExit = max(outBox.y, 0.06 * halfS);
      vec3 exitPos = inStart + rDir * tExit;
      int exitFace = dominantFace(exitPos / max(halfS, 0.001));
      vec3 exitCol = faceVibrantColor(exitFace);
      dividerMask = evalShellDividers(inStart, rDir, tExit, halfS, cavR);
      float optLum = studioEnvLum(normalize(uModelRot * rDir));
      internalCol = mix(enterCol, exitCol, 0.24 * (1.0 - dividerMask * 0.6));
      if (isBevelFacet > 0.15) {
        vec3 bevelDisp = prismDispersionColor(dot(nW, L_w) * 0.85 + dot(rDir, vec3(0.6, 0.5, -0.6)));
        internalCol = mix(internalCol, mix(bevelDisp, vec3(1.0), 0.42), isBevelFacet * (0.38 + 0.32 * optLum));
        prismEnergy = isBevelFacet * 0.62;
      }
    }

    // 3) 最终高清风格化晶体合成（干净大色块 + 45° 棱晶莹高光 + 球腔折光弧 + 透视 6 轴）
    vec3 seamDark = mix(vec3(0.32, 0.39, 0.52), vec3(0.16, 0.21, 0.32), uDarkMode);
    float envLum = studioEnvLum(normalize(uModelRot * normalize(mix(rDir, reflect(rd, nLocal), 0.32))));
    float spec = pow(max(dot(nW, normalize(L_w + V_w)), 0.0), 54.0);
    float specBroad = pow(max(dot(nW, normalize(L_w + V_w)), 0.0), 14.0);

    // 小面明快风格化着色，保留通透玻璃感以展现内部球腔折光与 6 轴结构
    float shadeVal = clamp(
      ndl * 0.44 + envLum * 0.38 + fresnel * 0.16 + prismEnergy * 0.22 - dividerMask * 0.16,
      0.04,
      0.98
    );
    vec3 styledTile = sampleCrystalRamp(enterFace, enterCol, shadeVal);

    // 内部光学层融合（球面空腔全内反射弧光 & 6 轴轴芯清晰透出！）
    float innerBlend = mix(0.28, 0.64, clamp(coreVis + prismEnergy * 0.72, 0.0, 1.0)) * tileMask;
    vec3 col = mix(styledTile, internalCol, innerBlend);

    // Florian 外框架略偏凝实以突出每个圆角小面与 45° 外切棱
    if (tileMask < 0.98) {
      vec3 frameTint = mix(enterCol * 0.80, seamDark, 0.18);
      vec3 frameStyled = sampleCrystalRamp(enterFace, frameTint, clamp(ndl * 0.55 + envLum * 0.35 + isBevelFacet * 0.20, 0.12, 0.96));
      col = mix(frameStyled, col, tileMask);
    }

    // 45° 倒角外棱锐利晶莹折光（向冰白棱镜微色散收敛，消除跨面硬跳色边）
    if (isBevelFacet > 0.04) {
      vec3 bevelPure = mix(vec3(0.92, 0.97, 1.0), prismDispersionColor(ndl * 1.1 + fresnel), 0.42);
      col = mix(col, bevelPure, isBevelFacet * (0.52 + 0.38 * fresnel + 0.30 * specBroad));
    }

    // Florian 小面极细晶莹亮缘
    float rimLine = smoothstep(-0.026, -0.004, tileSdf) * tileMask;
    col = mix(col, mix(enterCol, vec3(1.0), 0.66), rimLine * 0.30);

    // 锐利镜面高光 + 菲涅尔掠射光泽
    col = mix(col, vec3(1.0), smoothstep(0.14, 0.76, spec) * 0.82);
    col = mix(col, mix(enterCol, vec3(0.92, 0.97, 1.0), 0.72), fresnel * 0.28);

    // 抗锯齿 26 块主分隔细缝柔和融合
    vec3 seamCol = mix(seamDark, enterCol * 0.58, 0.30 + 0.18 * ndl);
    col = mix(col, seamCol, seamMask * 0.86);

    float alpha = mix(0.76, 0.74, uDarkMode)
      + dividerMask * 0.14
      + fresnel * 0.18
      + coreVis * 0.12
      + smoothstep(0.20, 0.75, spec) * 0.14
      + (1.0 - tileMask) * 0.08
      + seamMask * 0.16;
    alpha = clamp(alpha, 0.70, 0.96);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;

const CAUSTIC_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/**
 * 重构后的高清斜射光学焦散地面（彻底消除丑陋四色马赛克底垫）：
 * 1. 正下方：极柔和、干净的中性接触影（交代悬浮高度，无锯齿、无脏点）；
 * 2. 右后方斜射：模拟魔方 45° 倒角 + 内挖球面空腔聚焦出的「单色系优雅焦散光带 + 细微棱镜边」，
 *    随魔方旋转只取当前面向光源的 1 个主导色（与相邻面微调和），清透轻盈、绝不四色打架。
 */
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

  // 根据魔方当前朝向，平滑提取面向主光源的单一主导色（避免红绿橙蓝四色同时在地面堆叠）
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
    // 与清冷冰青基底轻度调和，保证全旋转周期内焦散色相始终清雅高级
    return mix(dom, vec3(0.56, 0.84, 1.00), 0.30);
  }

  void main() {
    vec2 rel = vWorldPos.xz - uCubeCenter.xz;
    float s = max(uGemScale, 0.01);

    // 1) 正下方极克制的柔和中性悬浮影（零硬边、零杂色）
    vec2 shadowP = rel / (s * vec2(1.22, 0.98));
    float shadowR = length(shadowP);
    float shadowMask = exp(-shadowR * shadowR * 2.35);
    vec3 shadowCol = mix(vec3(0.52, 0.58, 0.70), vec3(0.02, 0.04, 0.08), uDarkMode);
    float shadowA = shadowMask * mix(0.20, 0.42, uDarkMode);

    // 2) 斜射 38° 分离式焦散光斑（落于右后方地面，与正下方底影自然拉开空气感）
    vec2 causticCenter = vec2(0.58 * s, -0.36 * s);
    vec2 cp = (rel - causticCenter) / (s * 1.15);
    // 沿入射光方向轻微拉长
    float rotA = -0.45;
    float cs = cos(rotA), sn = sin(rotA);
    vec2 rcp = vec2(cp.x * cs - cp.y * sn, cp.x * sn + cp.y * cs) * vec2(0.86, 1.24);
    float r = length(rcp);
    float ang = atan(rcp.y, rcp.x);

    // 模拟内挖球面空腔（平凹透镜）+ 45° 外棱聚焦出的双层弧形焦散丝带
    float arcRipple = 0.08 * cos(ang * 2.0 + 0.6) + 0.04 * sin(ang * 4.0 - 0.8);
    float ringD = abs(r - (0.52 + arcRipple));
    float outerArc = exp(-ringD * ringD * 22.0) * smoothstep(1.15, 0.25, r);
    float innerPool = exp(-r * r * 3.4);
    float focusCore = exp(-dot(rcp - vec2(0.06, -0.03), rcp - vec2(0.06, -0.03)) * 18.0);

    // 微弱棱镜色散翼边（左偏冰青、右偏柔紫/暖金，克制且通透）
    float prismShift = clamp(rcp.x * 0.9 + 0.5, 0.0, 1.0);
    vec3 domHue = computeDominantCausticHue(normalize(vec3(-0.46, 0.82, 0.34)));
    vec3 wingLeft = mix(domHue, vec3(0.42, 0.88, 1.00), 0.45);
    vec3 wingRight = mix(domHue, vec3(0.76, 0.62, 1.00), 0.42);
    vec3 causticHue = mix(wingLeft, wingRight, prismShift);

    float twistBoost = 1.0 + uTwistPulse * 0.28;
    float causticEnergy = clamp((innerPool * 0.55 + outerArc * 0.72 + focusCore * 0.95) * uIntensity * twistBoost, 0.0, 1.0);
    vec3 causticCol = mix(causticHue, vec3(1.0), clamp(focusCore * 0.78 + outerArc * 0.25, 0.0, 1.0));
    float causticA = causticEnergy * mix(0.42, 0.52, uDarkMode);

    // 柔和叠加接触影与斜射焦散（焦散高亮区自然冲淡阴影）
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
  private readonly cubeMesh: Mesh;
  private readonly cubeMat: ShaderMaterial;
  private readonly causticMat: ShaderMaterial;
  private readonly invModel = new Matrix4();
  private readonly tmpLocalCam = new Vector3();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly parallaxHost: HTMLElement | null;
  private reducedMotion: boolean;
  private raf = 0;
  private disposed = false;
  private startedAt = 0;
  private lastT = 0;
  private spinAngle = 0.62;
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
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    this.camera = new PerspectiveCamera(33, 1, 0.1, 30);
    this.camera.position.set(0, 1.65, 8.2);
    this.camera.lookAt(0, -0.12, 0);

    const gemScale = 1.0;

    // 1) 斜射高清光学焦散 + 柔和接触影地面
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
        uIntensity: { value: this.reducedMotion ? 1.0 : 0.0 },
        uDarkMode: { value: theme === "dark" ? 1 : 0 },
        uTwistPulse: { value: this.reducedMotion ? 0.45 : 0.0 },
      },
    });
    const causticMesh = new Mesh(causticGeo, this.causticMat);
    causticMesh.rotation.x = -Math.PI / 2;
    causticMesh.position.set(0, -1.72, 0);
    causticMesh.renderOrder = 0;
    this.scene.add(causticMesh);

    // 2) 高清 45° 倒角 + 内挖球面空腔 + 真实 6 轴十字轴芯速拧魔方
    // 外包围盒扩大至 3.0 以完整容纳活动层拧转时的对角突角
    const boxGeo = new BoxGeometry(gemScale * 3.0, gemScale * 3.0, gemScale * 3.0);
    this.cubeMat = new ShaderMaterial({
      vertexShader: CUBE_VERTEX_SHADER,
      fragmentShader: CUBE_FRAGMENT_SHADER,
      side: BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uGemScale: { value: gemScale },
        uLocalCam: { value: new Vector3(0, 2, 8) },
        uModelRot: { value: new Matrix3() },
        uLightDir: { value: new Vector3(-0.46, 0.82, 0.34).normalize() },
        uPolish: { value: this.reducedMotion ? 1.0 : 0.0 },
        uDarkMode: { value: theme === "dark" ? 1 : 0 },
        uTwistAxis: { value: 0 },
        uTwistAngle: { value: this.reducedMotion ? 0.38 : 0.0 },
      },
    });
    this.cubeMesh = new Mesh(boxGeo, this.cubeMat);
    this.cubeMesh.renderOrder = 1;
    this.cubeGroup.add(this.cubeMesh);
    this.cubeGroup.position.set(0, 0.36, 0);
    this.scene.add(this.cubeGroup);

    this.disposables.push(causticGeo, this.causticMat, boxGeo, this.cubeMat);

    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(container);
    this.fit();
    this.applyFrame(0, 0);
    if (!this.reducedMotion) this.start();
  }

  setTheme(theme: StartCubeTheme): void {
    if (this.disposed) return;
    const isDark = theme === "dark" ? 1 : 0;
    this.cubeMat.uniforms.uDarkMode.value = isDark;
    this.causticMat.uniforms.uDarkMode.value = isDark;
    this.render();
  }

  setReducedMotion(reduced: boolean): void {
    if (this.disposed || this.reducedMotion === reduced) return;
    this.reducedMotion = reduced;
    if (reduced) {
      this.stop();
      this.cubeMat.uniforms.uPolish.value = 1.0;
      this.cubeMat.uniforms.uTwistAxis.value = 0;
      this.cubeMat.uniforms.uTwistAngle.value = 0.38;
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

  private readParallax(): { u: number; v: number } {
    const host = this.parallaxHost;
    if (!host) return { u: 0, v: 0 };
    const u = Number.parseFloat(host.style.getPropertyValue("--par-u")) || 0;
    const v = Number.parseFloat(host.style.getPropertyValue("--par-v")) || 0;
    return { u, v };
  }

  private syncRaytraceUniforms(): void {
    this.cubeGroup.updateMatrixWorld(true);
    this.invModel.copy(this.cubeMesh.matrixWorld).invert();
    this.tmpLocalCam.copy(this.camera.position).applyMatrix4(this.invModel);
    this.cubeMat.uniforms.uLocalCam.value.copy(this.tmpLocalCam);
    const m = this.cubeMesh.matrixWorld.elements;
    const cubeRot = this.cubeMat.uniforms.uModelRot.value as Matrix3;
    cubeRot.set(m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]);
    const causticRot = this.causticMat.uniforms.uModelRot.value as Matrix3;
    causticRot.copy(cubeRot);
    this.causticMat.uniforms.uCubeCenter.value.copy(this.cubeGroup.position);
  }

  /**
   * 优雅的周期性单层呼吸微拧（Motion 主题点睛）：
   * 每 6.4s 一个周期：稳态还原 → 丝滑拧开约 36° 展露内挖球面空腔与 6 轴结构 → 磁吸回正，
   * 奇数周期拧顶层 U，偶数周期拧右层 R。
   */
  private evalMotionTwist(elapsedSec: number): { axis: number; angle: number; pulse: number } {
    const cycleDur = 6.4;
    const cycleIdx = Math.floor(elapsedSec / cycleDur);
    const localT = elapsedSec - cycleIdx * cycleDur;
    const axis = cycleIdx % 2;

    // 首帧入场后约 1.1s 开始优雅微拧，便于用户直观看到内挖球腔与 6 轴结构
    const startT = 1.1;
    const activeDur = 3.2;
    if (localT < startT || localT > startT + activeDur) {
      return { axis, angle: 0, pulse: 0 };
    }
    const u = (localT - startT) / activeDur; // 0..1
    // 平滑钟形包络（带顶部短暂舒展悬停）
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
      this.cubeMat.uniforms.uPolish.value = eased;
      this.causticMat.uniforms.uIntensity.value = eased;

      const tw = this.evalMotionTwist(elapsedSec);
      this.cubeMat.uniforms.uTwistAxis.value = tw.axis;
      this.cubeMat.uniforms.uTwistAngle.value = tw.angle;
      this.causticMat.uniforms.uTwistPulse.value = tw.pulse;
    }

    this.syncRaytraceUniforms();
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
