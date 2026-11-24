/**
 * 开始页风格化细腻像素圆角速拧魔方 + 像素硬边焦散地面（Three.js + 自定义 GLSL）。
 * 设计特点：
 * - 低开销细腻像素渲染：固定逻辑高度 216px、关闭 MSAA、image-rendering: pixelated 锐利放大，
 *   片元负载较全分辨率下降 ~15×；
 * - 现代速拧圆角外形：精确 Rounded Box SDF（1/4 圆柱棱 + 1/8 球角），每面 9 小面采用标准
 *   Florian 圆角（中心 4 大 R、棱块近中 2 大 R / 外 2 小 R、角块近中 1 大 R / 外 3 小 R）；
 * - 26 块清晰分隔：表层块缝 + 内部 6 张窄带低透光隔板（|x|,|y|,|z|=1/3），清晰呈现块间分界
 *   而不把整块色彩拉灰拉暗；
 * - 鲜亮克制像素美学：高饱和明快大色块 + 仅在明暗交界窄带出现的克制 Bayer 4×4 抖动 +
 *   柔和顺滑的折光与微虹彩（旋转全程平稳无突跳闪烁、无星芒抢视线）+ 1px 外描边 + 像素焦散盘。
 */
import {
  BackSide,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
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

/** 细腻像素风格逻辑高度（216 逻辑像素，低 GPU 开销且圆角与小面清晰） */
const LOGICAL_HEIGHT = 216;

const CUBE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vLocalPos;

  void main() {
    vLocalPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 鲜亮克制像素风圆角速拧魔方片元着色器：
 * - 整块以干净明艳的大色块为主，仅在色阶交界窄带使用 Bayer 4×4 抖动（告别密集噪点）；
 * - 暗部采用高饱和保色降明策略（拒绝混入深灰泥泞色），使白/橙/绿/红/蓝/黄六面始终清亮通透；
 * - 折射与环境亮度全程平滑连续（移除会突跳闪烁的硬阈值火彩/全内反射阶跃），旋转优雅不抢视线。
 */
const CUBE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float uGemScale;
  uniform vec3 uLocalCam;
  uniform mat3 uModelRot;
  uniform vec3 uLightDir;
  uniform float uPolish;
  uniform float uDarkMode;

  varying vec3 vLocalPos;

  // 纯算术 Bayer 4×4 有序抖动矩阵（零数组/零位运算，全 WebGL1/2 兼容）
  float bayer4x4(vec2 p) {
    vec2 c = mod(floor(p), 4.0);
    float x0 = mod(c.x, 2.0);
    float y0 = mod(c.y, 2.0);
    float x1 = floor(c.x * 0.5);
    float y1 = floor(c.y * 0.5);
    float d0 = abs(x0 - y0) * 2.0 + y0;
    float d1 = abs(x1 - y1) * 2.0 + y1;
    return (d0 * 4.0 + d1 + 0.5) / 16.0;
  }

  vec3 ditherMix(vec3 a, vec3 b, float t, float bayer) {
    return (t > bayer) ? b : a;
  }

  // 鲜亮明快的魔方六面风格化基色（0:U 澄澈冰白, 1:D 鲜明向日黄, 2:F 明翠祖母绿, 3:B 亮蔚蓝, 4:R 鲜红宝石, 5:L 亮柑橘橙）
  vec3 faceVibrantColor(int idx) {
    if (idx == 0) return mix(vec3(0.90, 0.95, 1.00), vec3(0.95, 0.98, 1.00), uDarkMode);
    if (idx == 1) return vec3(1.00, 0.87, 0.16);
    if (idx == 2) return vec3(0.14, 0.90, 0.52);
    if (idx == 3) return vec3(0.20, 0.64, 1.00);
    if (idx == 4) return vec3(1.00, 0.28, 0.42);
    return vec3(1.00, 0.58, 0.14);
  }

  // 每面独立的高饱和明快 4 阶色板（暗阶也保持明澈彩度，绝不发灰发褐）
  vec3 sampleVibrantRamp(int faceIdx, vec3 baseCol, float val, float bayer) {
    vec3 c0;
    if (faceIdx == 0) {
      // 白面暗阶走清澈浅天蓝（告别灰黑脏感）
      c0 = mix(vec3(0.66, 0.78, 0.94), vec3(0.62, 0.74, 0.92), uDarkMode);
    } else if (faceIdx == 5) {
      // 橙面暗阶偏向暖红橘（告别暗棕泥感）
      c0 = vec3(0.86, 0.34, 0.10);
    } else if (faceIdx == 2) {
      // 绿面暗阶偏向清脆孔雀绿
      c0 = vec3(0.06, 0.60, 0.38);
    } else if (faceIdx == 1) {
      // 黄面暗阶偏向暖金琥珀
      c0 = vec3(0.88, 0.62, 0.08);
    } else if (faceIdx == 4) {
      // 红面暗阶偏向明艳莓红
      c0 = vec3(0.76, 0.12, 0.30);
    } else {
      // 蓝面暗阶偏向澄澈钴蓝
      c0 = vec3(0.12, 0.38, 0.82);
    }

    vec3 c1 = mix(c0, baseCol, 0.58);
    vec3 c2 = clamp(baseCol * 1.04, 0.0, 1.0);
    vec3 c3 = mix(baseCol, vec3(1.0), 0.48);

    // 窄带 Bayer 抖动（仅在阶梯交界约 22% 窄带过渡，其余 ~78% 为干净纯粹的大色块）
    float v = clamp(val, 0.0, 1.0) * 3.0;
    int seg = int(floor(v));
    float f = fract(v);
    float dt = smoothstep(0.39, 0.61, f);

    if (seg <= 0) return ditherMix(c0, c1, dt, bayer);
    if (seg == 1) return ditherMix(c1, c2, dt, bayer);
    if (seg == 2) return ditherMix(c2, c3, dt, bayer);
    return c3;
  }

  // 精确圆角立方体 SDF（边缘为 1/4 圆柱，顶角为 1/8 球面）
  float sdRoundBox(vec3 p, float halfSize, float radius) {
    vec3 q = abs(p) - vec3(halfSize - radius);
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - radius;
  }

  // 精确解析法线（零额外 SDF 采样）
  vec3 roundBoxNormal(vec3 p, float halfSize, float radius) {
    vec3 q = abs(p) - vec3(halfSize - radius);
    vec3 g = max(q, 0.0);
    if (length(g) > 1e-5) return normalize(sign(p) * g);
    vec3 a = abs(p);
    if (a.x >= a.y && a.x >= a.z) return vec3(sign(p.x), 0.0, 0.0);
    if (a.y >= a.x && a.y >= a.z) return vec3(0.0, sign(p.y), 0.0);
    return vec3(0.0, 0.0, sign(p.z));
  }

  vec2 intersectBox(vec3 ro, vec3 rd, float halfSize) {
    vec3 inv = 1.0 / (rd + vec3(1e-7));
    vec3 t0 = (-vec3(halfSize) - ro) * inv;
    vec3 t1 = (vec3(halfSize) - ro) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tn = max(max(tmin.x, tmin.y), tmin.z);
    float tf = min(min(tmax.x, tmax.y), tmax.z);
    return vec2(tn, tf);
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

  // 四角独立 R 角圆角矩形 2D SDF（r = vec4(右上, 右下, 左上, 左下)）
  float sdRoundedBox4(vec2 p, vec2 b, vec4 r) {
    vec2 rx = (p.x > 0.0) ? r.xy : r.zw;
    float rad = (p.y > 0.0) ? rx.x : rx.y;
    vec2 q = abs(p) - b + vec2(rad);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rad;
  }

  /**
   * 标准速拧 Florian 圆角小面 SDF 与 26 块外缝：
   * - 中心小面：4 大 R；
   * - 4 个棱块：近中 2 大 R + 外侧 2 小 R；
   * - 4 个角块：近中 1 大 R + 其余 3 小 R。
   */
  vec2 evalFlorianFacelet(vec3 pNorm, int faceIdx) {
    vec2 uv = facePlaneUV(pNorm, faceIdx);
    int ix = (uv.x > 0.3333) ? 1 : ((uv.x < -0.3333) ? -1 : 0);
    int iy = (uv.y > 0.3333) ? 1 : ((uv.y < -0.3333) ? -1 : 0);

    float cx = float(ix) * 0.625;
    float cy = float(iy) * 0.625;
    vec2 halfExt = vec2((ix == 0) ? 0.285 : 0.272, (iy == 0) ? 0.285 : 0.272);

    float rBig = 0.132;
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

  // 平滑柔和摄影棚受光（去掉暗挡板骤暗，旋转时明暗过渡丝滑温和）
  float smoothStudioLum(vec3 d) {
    vec3 L_key = normalize(uLightDir);
    vec3 L_fill = normalize(vec3(-0.68, 0.56, 0.48));
    float keyT = (dot(d, L_key) * 0.5 + 0.5) * 0.56;
    float fillT = (dot(d, L_fill) * 0.5 + 0.5) * 0.28;
    float sky = clamp(d.y * 0.24 + 0.56, 0.30, 0.84) * 0.28;
    return clamp(keyT + fillT + sky, 0.18, 1.0);
  }

  /**
   * 评估内部 26 块低透光隔离墙（x/y/z = ±1/3）：
   * 聚焦在清晰可见的隔板壁面与交线（不向整面弥漫灰暗），既能明确分辨 26 块，
   * 又让每块主体保持鲜亮通透。
   */
  vec2 evalInternalDividers(vec3 ro, vec3 rd, float segLen) {
    float c = 0.3333 * uGemScale;
    float lim = 0.96 * uGemScale;
    float wallMask = 0.0;
    float edgeHighlight = 0.0;

    // X = ±1/3
    if (abs(rd.x) > 1e-4) {
      for (int s = 0; s < 2; s++) {
        float px = (s == 0) ? -c : c;
        float t = (px - ro.x) / rd.x;
        if (t > 0.03 && t < segLen - 0.03) {
          vec3 q = ro + rd * t;
          if (abs(q.y) < lim && abs(q.z) < lim) {
            float graze = pow(1.0 - abs(rd.x), 1.8);
            float seamDist = min(abs(abs(q.y) - c), abs(abs(q.z) - c));
            float nearRib = 1.0 - smoothstep(0.0, 0.055 * uGemScale, seamDist);
            float depthFade = exp(-t * 0.52);
            wallMask += (0.20 + 0.36 * graze + 0.30 * nearRib) * depthFade;
            edgeHighlight += nearRib * depthFade * 0.35;
          }
        }
      }
    }
    // Y = ±1/3
    if (abs(rd.y) > 1e-4) {
      for (int s = 0; s < 2; s++) {
        float py = (s == 0) ? -c : c;
        float t = (py - ro.y) / rd.y;
        if (t > 0.03 && t < segLen - 0.03) {
          vec3 q = ro + rd * t;
          if (abs(q.x) < lim && abs(q.z) < lim) {
            float graze = pow(1.0 - abs(rd.y), 1.8);
            float seamDist = min(abs(abs(q.x) - c), abs(abs(q.z) - c));
            float nearRib = 1.0 - smoothstep(0.0, 0.055 * uGemScale, seamDist);
            float depthFade = exp(-t * 0.52);
            wallMask += (0.20 + 0.36 * graze + 0.30 * nearRib) * depthFade;
            edgeHighlight += nearRib * depthFade * 0.35;
          }
        }
      }
    }
    // Z = ±1/3
    if (abs(rd.z) > 1e-4) {
      for (int s = 0; s < 2; s++) {
        float pz = (s == 0) ? -c : c;
        float t = (pz - ro.z) / rd.z;
        if (t > 0.03 && t < segLen - 0.03) {
          vec3 q = ro + rd * t;
          if (abs(q.x) < lim && abs(q.y) < lim) {
            float graze = pow(1.0 - abs(rd.z), 1.8);
            float seamDist = min(abs(abs(q.x) - c), abs(abs(q.y) - c));
            float nearRib = 1.0 - smoothstep(0.0, 0.055 * uGemScale, seamDist);
            float depthFade = exp(-t * 0.52);
            wallMask += (0.20 + 0.36 * graze + 0.30 * nearRib) * depthFade;
            edgeHighlight += nearRib * depthFade * 0.35;
          }
        }
      }
    }

    return vec2(clamp(wallMask, 0.0, 0.82), clamp(edgeHighlight, 0.0, 0.6));
  }

  void main() {
    vec3 ro = uLocalCam;
    vec3 rd = normalize(vLocalPos - uLocalCam);
    float bayer = bayer4x4(gl_FragCoord.xy);
    float halfS = uGemScale;
    float cornerR = 0.16 * uGemScale;

    // 1) 球追踪命中精确圆角立方体（≤14 步）
    vec2 boxT = intersectBox(ro, rd, halfS + 0.002);
    if (boxT.x > boxT.y || boxT.y < 0.0) discard;

    float t = max(boxT.x, 0.0);
    bool hit = false;
    for (int i = 0; i < 14; i++) {
      vec3 p = ro + rd * t;
      float d = sdRoundBox(p, halfS, cornerR);
      if (d < 0.0012 * uGemScale) {
        hit = true;
        break;
      }
      t += d;
      if (t > boxT.y + 0.01) break;
    }
    if (!hit) discard;

    vec3 hitPos = ro + rd * t;
    vec3 nLocal = roundBoxNormal(hitPos, halfS, cornerR);
    vec3 nW = normalize(uModelRot * nLocal);
    vec3 rdW = normalize(uModelRot * rd);
    vec3 V_w = -rdW;
    vec3 L_w = normalize(uLightDir);

    vec3 pNorm = hitPos / max(halfS, 0.001);
    int enterFace = dominantFace(pNorm);
    vec3 enterCol = faceVibrantColor(enterFace);

    vec2 fl = evalFlorianFacelet(pNorm, enterFace);
    float tileSdf = fl.x;
    float cutDist = fl.y;
    bool inTile = tileSdf <= 0.0;
    bool inCutSeam = cutDist < 0.027;
    vec3 flatMargin = abs(pNorm) - vec3(1.0 - 0.16);
    float isRoundEdge = step(0.002, length(max(flatMargin, 0.0)));

    float ndl = clamp(dot(nW, L_w) * 0.5 + 0.5, 0.0, 1.0);
    float ndv = clamp(dot(nW, V_w), 0.0, 1.0);
    float fresnel = pow(1.0 - ndv, 2.4);

    // 0.85s 入场扫光
    float sweep = clamp((hitPos.y - hitPos.x * 0.35) / max(halfS * 2.1, 0.01) + 0.5, 0.0, 1.0);
    bool polished = (uPolish >= 0.999) || (uPolish > 0.001 && sweep <= uPolish);
    if (!polished) {
      vec3 col = sampleVibrantRamp(enterFace, enterCol, ndl * 0.65 + 0.2, bayer);
      if (uPolish > 0.001 && abs(sweep - uPolish) < 0.09) col = vec3(1.0);
      gl_FragColor = vec4(col, 0.90);
      return;
    }

    // 2) 平滑单次内部折射穿透（无全内反射突跳，旋转时画面稳定顺滑）
    vec3 rDir = normalize(refract(rd, nLocal, 1.0 / 1.44));
    vec3 inStart = hitPos - nLocal * (0.015 * uGemScale);

    vec2 outBox = intersectBox(inStart, rDir, halfS);
    float tExit = max(outBox.y, 0.05 * uGemScale);
    vec3 exitPos = inStart + rDir * tExit;
    for (int j = 0; j < 2; j++) {
      float dOut = sdRoundBox(exitPos, halfS, cornerR);
      tExit -= dOut;
      exitPos = inStart + rDir * max(tExit, 0.05 * uGemScale);
    }

    // 柔和混合内部出射与表面反射方向，避免出射临界角处亮度跳变
    vec3 smoothOptDirW = normalize(uModelRot * normalize(mix(rDir, reflect(rd, nLocal), 0.28)));
    float envLum = smoothStudioLum(smoothOptDirW);

    int exitFace = dominantFace(exitPos / max(halfS, 0.001));
    vec3 exitCol = faceVibrantColor(exitFace);

    // 内部 26 块低透光隔板
    vec2 divInfo = evalInternalDividers(inStart, rDir, tExit);
    float wallMask = divInfo.x;
    float ribGlow = divInfo.y;

    // 3) 鲜亮大色块 + 克制窄带抖动着色（全程仅一次阶梯抖动，告别密集麻点）
    // 块间外缝使用清冷深靛蓝（不发灰发脏），清晰勾勒 26 块边界
    vec3 seamDark = mix(vec3(0.24, 0.29, 0.42), vec3(0.16, 0.20, 0.30), uDarkMode);
    vec3 col;
    float alpha;

    if (inCutSeam) {
      // 26 块主分隔切缝：清晰、低透光、干净利落
      col = mix(seamDark, enterCol * 0.48, 0.28 + 0.18 * ndl);
      alpha = 0.93;
    } else if (!inTile) {
      // Florian 大圆角凹口与圆角块体外框：明快保色半透明框架，清晰衬出小面 R 角
      float rimBlend = smoothstep(0.0, 0.06, tileSdf);
      vec3 frameCol = mix(enterCol * 0.84, mix(enterCol * 0.56, seamDark, 0.38), rimBlend);
      float frameVal = clamp(ndl * 0.58 + envLum * 0.34 + isRoundEdge * 0.16, 0.15, 0.96);
      col = sampleVibrantRamp(enterFace, frameCol, frameVal, bayer);
      // 1/4 圆柱外棱柔和亮边（平稳连贯，不闪跳）
      if (isRoundEdge > 0.5) {
        col = mix(col, mix(enterCol, vec3(1.0), 0.62), fresnel * 0.42);
      }
      alpha = 0.80 + 0.10 * rimBlend;
    } else {
      // === 明艳半透明彩色 Florian 贴面 ===
      // 仅轻度融入背面折光色（0.16 权重），主体保持清澈高饱和本色
      float clearThrough = 1.0 - wallMask * 0.72;
      vec3 vividHue = mix(enterCol, exitCol, 0.16 * clearThrough);

      // 将内部 26 块隔板与柔和受光合入同一亮度标量，让整面保持干净平滑的大色块 + 窄带抖动
      float shadeVal = clamp(
        ndl * 0.52 + envLum * 0.42 + fresnel * 0.14 - wallMask * 0.24 + ribGlow * 0.06,
        0.04,
        0.98
      );
      col = sampleVibrantRamp(enterFace, vividHue, shadeVal, bayer);

      // 当射线正面穿过较近的内部隔板时，轻微叠一层清冷磨砂色以凸显 26 块内部结构层次
      if (wallMask > 0.34) {
        vec3 frostedWall = mix(enterCol * 0.74, vec3(0.76, 0.84, 0.96), 0.32);
        float wStrength = smoothstep(0.34, 0.78, wallMask) * 0.36;
        col = mix(col, frostedWall, wStrength);
      }

      // 贴面极细微亮缘（凸显中心 4 大 R / 棱 2 大 2 小 / 角 1 大 3 小 Florian 造型）
      if (tileSdf > -0.022) {
        col = mix(col, mix(enterCol, vec3(1.0), 0.58), 0.36);
      }

      // 极柔和连续的棱角微虹彩光泽（随角度缓慢渐变，绝不闪烁抢眼）
      float spec = pow(max(dot(nW, normalize(L_w + V_w)), 0.0), 36.0);
      if (spec > 0.22) {
        col = mix(col, vec3(1.0), smoothstep(0.22, 0.72, spec) * 0.55);
      }

      // 通透半透明感：清晰块体约 0.68，遇内部隔板/掠射角变凝实约 0.90
      alpha = mix(0.68, 0.65, uDarkMode)
        + wallMask * 0.20
        + fresnel * 0.20
        + smoothstep(0.3, 0.8, spec) * 0.15;
      alpha = clamp(alpha, 0.60, 0.94);
    }

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
 * 物理驱动的风格化像素焦散地面：
 * - 前/后双端精确球追踪（纯 t += d / t -= d，无跳步）求取圆角魔方连续入射/出射弦厚 thickness，
 *   外影边缘由弦厚连续归零门控，彻底根除边缘色块突然出现/消失的跳变；
 * - 强风格化像素美学：纯色大色块 + 丰富 Bayer 4×4 有序抖动 + 克制少色（仅外影 / 旋转侧大色块 /
 *   亮色内环 / 晶亮核心四阶），相邻旋转面之间以纯 Bayer 棋盘抖动衔接，绝不混出灰浊过渡色。
 */
const CAUSTIC_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform mat4 uInvModel;
  uniform vec3 uCausticLightDir;
  uniform float uGemScale;
  uniform float uIntensity;
  uniform float uDarkMode;
  uniform vec3 uShadowColor;
  uniform vec3 uCoreColor;
  uniform float uShadowAlpha;
  uniform float uCausticAlpha;

  varying vec3 vWorldPos;

  // 纯算术 Bayer 4×4 有序抖动（与魔方保持统一像素网点语言）
  float bayer4x4(vec2 p) {
    vec2 c = mod(floor(p), 4.0);
    float x0 = mod(c.x, 2.0);
    float y0 = mod(c.y, 2.0);
    float x1 = floor(c.x * 0.5);
    float y1 = floor(c.y * 0.5);
    float d0 = abs(x0 - y0) * 2.0 + y0;
    float d1 = abs(x1 - y1) * 2.0 + y1;
    return (d0 * 4.0 + d1 + 0.5) / 16.0;
  }

  // 与魔方一致的明艳四侧旋转主色（0:+X 红, 1:-X 橙, 2:+Z 绿, 3:-Z 蓝）
  vec3 sideFaceColor(int idx) {
    if (idx == 0) return vec3(1.00, 0.34, 0.52); // R 珊瑚玫红
    if (idx == 1) return vec3(1.00, 0.58, 0.16); // L 亮柑橘橙
    if (idx == 2) return vec3(0.16, 0.90, 0.56); // F 鲜翠绿
    return vec3(0.26, 0.64, 1.00);               // B 亮天蓝
  }

  float sdRoundBox(vec3 p, float halfSize, float radius) {
    vec3 q = abs(p) - vec3(halfSize - radius);
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - radius;
  }

  vec2 intersectBox(vec3 ro, vec3 rd, float halfSize) {
    vec3 inv = 1.0 / (rd + vec3(1e-7));
    vec3 t0 = (-vec3(halfSize) - ro) * inv;
    vec3 t1 = (vec3(halfSize) - ro) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
  }

  void main() {
    float halfS = uGemScale;
    float cornerR = 0.16 * uGemScale;
    float bayer = bayer4x4(gl_FragCoord.xy);

    // 地面世界点 → 魔方局部空间逆向光线
    vec3 roL = (uInvModel * vec4(vWorldPos, 1.0)).xyz;
    vec3 rdL = normalize((uInvModel * vec4(normalize(uCausticLightDir), 0.0)).xyz);

    // 放宽外盒包络做精确球追踪（零跳步，确保外影边缘全程平滑连续）
    float shadowScale = halfS * 1.12;
    vec2 boxT = intersectBox(roL, rdL, shadowScale + 0.02);
    if (boxT.x > boxT.y || boxT.y < 0.0) discard;

    // 1) 正向精确球追踪入射点（纯 t += d，绝不跨过掠射圆角棱）
    float tEnter = max(boxT.x, 0.0);
    float minD = 1e9;
    bool hitEnter = false;
    for (int i = 0; i < 14; i++) {
      vec3 p = roL + rdL * tEnter;
      float d = sdRoundBox(p, halfS, cornerR);
      if (d < minD) minD = d;
      if (d < 0.002 * halfS) {
        hitEnter = true;
        break;
      }
      tEnter += d;
      if (tEnter > boxT.y) break;
    }

    // 紧贴圆角魔方外轮廓的干净底影（随魔方三维旋转 100% 连续转动）
    float outerMargin = 0.11 * halfS;
    if (!hitEnter && minD > outerMargin) discard;

    // 底影最外圈窄带轻微抖动收边（像素风利落过渡）
    if (!hitEnter) {
      float rimMask = 1.0 - smoothstep(0.02 * halfS, outerMargin, minD);
      if (rimMask <= bayer * 0.45) discard;
      gl_FragColor = vec4(uShadowColor, uShadowAlpha);
      return;
    }

    // 2) 反向精确球追踪出射点，求取连续无跳变的实体弦厚 thickness
    float tExit = boxT.y;
    for (int i = 0; i < 10; i++) {
      vec3 p = roL + rdL * tExit;
      float d = sdRoundBox(p, halfS, cornerR);
      if (d < 0.002 * halfS) break;
      tExit -= d;
      if (tExit <= tEnter) break;
    }

    float thickness = max(0.0, tExit - tEnter);
    vec3 col = uShadowColor;
    float alpha = uShadowAlpha;

    // 弦厚连续门控：贴近剪影最外缘 thickness→0 时能量自然归零，绝不突然弹出或消失！
    float depthFactor = smoothstep(0.18 * halfS, 0.88 * halfS, thickness);
    if (uIntensity > 0.01 && depthFactor > 0.001) {
      vec3 pMid = roL + rdL * (0.5 * (tEnter + tExit));
      float bloom = mix(0.35, 1.0, smoothstep(0.0, 1.0, uIntensity));
      float radial = length(cross(roL, rdL)) / max(halfS * bloom, 0.001);

      // 3) 少色大色块选择：仅取所在象限相邻两个旋转侧面色，用丰富 Bayer 4×4 棋盘抖动衔接（零浑浊混色）
      vec3 colX = (pMid.x >= 0.0) ? sideFaceColor(0) : sideFaceColor(1);
      vec3 colZ = (pMid.z >= 0.0) ? sideFaceColor(2) : sideFaceColor(3);
      float ax = abs(pMid.x);
      float az = abs(pMid.z);
      float diagT = smoothstep(-0.32, 0.32, (ax - az) / max(ax + az, 0.001));
      vec3 pureLobe = (diagT > bayer) ? colX : colZ;

      // 4) 精简四阶风格化色块：底影 → 旋转纯色大瓣 → 明亮内色块 → 晶白亮核（全阶大范围 Bayer 抖动）
      vec3 brightInner = mix(pureLobe, uCoreColor, 0.52);
      vec3 coreCol = mix(vec3(1.00, 0.96, 0.80), uCoreColor, 0.65);

      // 连续平滑的能量场（由弦厚 + 中心聚光共同驱动，无任何阈值突跳）
      float energy = depthFactor * (1.0 - smoothstep(0.15, 1.18, radial)) * uIntensity;

      // 阶梯 1：底影 ↔ 旋转纯色大瓣（大范围抖动过渡，外缘丝滑出现/隐退）
      float tLobe = smoothstep(0.10, 0.34, energy);
      // 阶梯 2：旋转纯色大瓣 ↔ 明亮内色块
      float tInner = smoothstep(0.42, 0.66, energy);
      // 阶梯 3：明亮内色块 ↔ 中心晶亮核
      float tCore = smoothstep(0.70, 0.88, energy);

      bool isLobe = tLobe > bayer;
      bool isInner = tInner > bayer;
      bool isCore = tCore > bayer;

      if (isCore) {
        col = coreCol;
        alpha = uCausticAlpha;
      } else if (isInner) {
        col = brightInner;
        alpha = uCausticAlpha;
      } else if (isLobe) {
        col = pureLobe;
        alpha = mix(uShadowAlpha, uCausticAlpha, 0.88);
      }
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
  }
`;

const COMP_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * 像素合成通道：保留魔方半透明着色像素，并在外剪影 4 邻域生成利落 1 逻辑像素暗色外描边（已移除星芒）。
 */
const COMP_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uCubeTex;
  uniform vec2 uLogicalSize;
  uniform vec3 uOutlineColor;

  varying vec2 vUv;

  void main() {
    vec2 pxCoord = floor(vUv * uLogicalSize);
    vec2 snappedUv = (pxCoord + vec2(0.5)) / uLogicalSize;
    vec2 texel = vec2(1.0) / uLogicalSize;

    vec4 cubeC = texture2D(uCubeTex, snappedUv);
    if (cubeC.a > 0.02) {
      gl_FragColor = cubeC;
      return;
    }

    float nU = texture2D(uCubeTex, snappedUv + vec2(0.0, texel.y)).a;
    float nD = texture2D(uCubeTex, snappedUv - vec2(0.0, texel.y)).a;
    float nL = texture2D(uCubeTex, snappedUv - vec2(texel.x, 0.0)).a;
    float nR = texture2D(uCubeTex, snappedUv + vec2(texel.x, 0.0)).a;
    if (max(max(nU, nD), max(nL, nR)) > 0.02) {
      gl_FragColor = vec4(uOutlineColor, 0.86);
      return;
    }
    discard;
  }
`;

function themePalette(theme: StartCubeTheme) {
  if (theme === "dark") {
    return {
      shadow: new Color(0x131622),
      core: new Color(0xf5f9ff),
      shadowAlpha: 0.36,
      causticAlpha: 0.68,
      outline: new Color(0x1a1d2e),
    };
  }
  return {
    shadow: new Color(0xa9b3c6),
    core: new Color(0xffffff),
    shadowAlpha: 0.24,
    causticAlpha: 0.74,
    outline: new Color(0x2d324a),
  };
}

export class StartCausticCubeView {
  private readonly renderer: WebGLRenderer;
  private readonly causticScene = new Scene();
  private readonly cubeScene = new Scene();
  private readonly compScene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly compCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly cubeGroup = new Group();
  private readonly cubeMesh: Mesh;
  private readonly cubeMat: ShaderMaterial;
  private readonly causticMat: ShaderMaterial;
  private readonly compMat: ShaderMaterial;
  private cubeRT: WebGLRenderTarget;
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
  private spinAngle = 0.58;
  private parSmooth = new Vector2(0, 0);
  private logicalW = 200;
  private logicalH = LOGICAL_HEIGHT;

  constructor(
    private readonly container: HTMLElement,
    opts: StartCausticCubeOptions = {},
  ) {
    this.parallaxHost = opts.parallaxHost ?? null;
    this.reducedMotion = opts.reducedMotion ?? false;
    const theme: StartCubeTheme = opts.theme ?? "dark";

    this.renderer = new WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "low-power",
      preserveDrawingBuffer: true,
    });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.imageRendering = "pixelated";
    container.appendChild(canvas);

    this.camera = new PerspectiveCamera(35, 1, 0.1, 30);
    this.camera.position.set(0, 1.55, 7.65);
    this.camera.lookAt(0, -0.1, 0);

    const pal = themePalette(theme);

    // 1) 底部物理驱动像素焦散平面（宽幅平面避免旋转投影被边缘裁切）
    const gemScale = 1.0;
    const causticGeo = new PlaneGeometry(4.8, 4.8);
    this.causticMat = new ShaderMaterial({
      vertexShader: CAUSTIC_VERTEX_SHADER,
      fragmentShader: CAUSTIC_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uInvModel: { value: new Matrix4() },
        uCausticLightDir: { value: new Vector3(0.08, 1.0, 0.06).normalize() },
        uGemScale: { value: gemScale },
        uIntensity: { value: this.reducedMotion ? 1.0 : 0.0 },
        uDarkMode: { value: theme === "dark" ? 1 : 0 },
        uShadowColor: { value: pal.shadow },
        uCoreColor: { value: pal.core },
        uShadowAlpha: { value: pal.shadowAlpha },
        uCausticAlpha: { value: pal.causticAlpha },
      },
    });
    const causticMesh = new Mesh(causticGeo, this.causticMat);
    causticMesh.rotation.x = -Math.PI / 2;
    causticMesh.position.set(0, -1.78, 0);
    this.causticScene.add(causticMesh);

    // 2) 圆角速拧像素魔方（离屏低分辨率 RT）
    const boxGeo = new BoxGeometry(gemScale * 2.15, gemScale * 2.15, gemScale * 2.15);
    this.cubeMat = new ShaderMaterial({
      vertexShader: CUBE_VERTEX_SHADER,
      fragmentShader: CUBE_FRAGMENT_SHADER,
      side: BackSide,
      transparent: false,
      depthWrite: false,
      uniforms: {
        uGemScale: { value: gemScale },
        uLocalCam: { value: new Vector3(0, 2, 7) },
        uModelRot: { value: new Matrix3() },
        uLightDir: { value: new Vector3(0.46, 0.82, 0.42).normalize() },
        uPolish: { value: this.reducedMotion ? 1.0 : 0.0 },
        uDarkMode: { value: theme === "dark" ? 1 : 0 },
      },
    });
    this.cubeMesh = new Mesh(boxGeo, this.cubeMat);
    this.cubeGroup.add(this.cubeMesh);
    this.cubeGroup.position.set(0, 0.34, 0);
    this.cubeScene.add(this.cubeGroup);

    this.cubeRT = new WebGLRenderTarget(this.logicalW, this.logicalH, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    // 3) 像素合成通道（1 逻辑像素暗色外描边）
    const compGeo = new PlaneGeometry(2, 2);
    this.compMat = new ShaderMaterial({
      vertexShader: COMP_VERTEX_SHADER,
      fragmentShader: COMP_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCubeTex: { value: this.cubeRT.texture },
        uLogicalSize: { value: new Vector2(this.logicalW, this.logicalH) },
        uOutlineColor: { value: pal.outline },
      },
    });
    const compMesh = new Mesh(compGeo, this.compMat);
    this.compScene.add(compMesh);

    this.disposables.push(
      causticGeo,
      this.causticMat,
      boxGeo,
      this.cubeMat,
      compGeo,
      this.compMat,
    );

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
    const pal = themePalette(theme);
    this.causticMat.uniforms.uShadowColor.value.copy(pal.shadow);
    this.causticMat.uniforms.uCoreColor.value.copy(pal.core);
    this.causticMat.uniforms.uShadowAlpha.value = pal.shadowAlpha;
    this.causticMat.uniforms.uCausticAlpha.value = pal.causticAlpha;
    this.compMat.uniforms.uOutlineColor.value.copy(pal.outline);
    this.render();
  }

  setReducedMotion(reduced: boolean): void {
    if (this.disposed || this.reducedMotion === reduced) return;
    this.reducedMotion = reduced;
    if (reduced) {
      this.stop();
      this.cubeMat.uniforms.uPolish.value = 1.0;
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

  private syncRaytraceUniforms(): void {
    this.cubeGroup.updateMatrixWorld(true);
    this.invModel.copy(this.cubeMesh.matrixWorld).invert();
    this.tmpLocalCam.copy(this.camera.position).applyMatrix4(this.invModel);
    this.cubeMat.uniforms.uLocalCam.value.copy(this.tmpLocalCam);
    this.causticMat.uniforms.uInvModel.value.copy(this.invModel);
    const m = this.cubeMesh.matrixWorld.elements;
    const rot = this.cubeMat.uniforms.uModelRot.value as Matrix3;
    rot.set(m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]);
  }

  private applyFrame(dtSec: number, elapsedSec: number): void {
    // 54s 一圈舒缓匀速自转，沉静优雅不抢主视线
    const spinSpeed = (Math.PI * 2) / 54;
    if (!this.reducedMotion) {
      this.spinAngle += spinSpeed * dtSec;
    }

    const par = this.readParallax();
    const alpha = dtSec > 0 ? 1 - Math.exp(-8 * dtSec) : 1;
    this.parSmooth.x += (par.u - this.parSmooth.x) * alpha;
    this.parSmooth.y += (par.v - this.parSmooth.y) * alpha;

    const bob = this.reducedMotion ? 0 : Math.sin(elapsedSec * 0.95) * 0.04;
    this.cubeGroup.position.y = 0.34 + bob;

    const basePitch = 0.34;
    const baseRoll = 0.12;
    this.cubeGroup.rotation.set(
      basePitch - this.parSmooth.y * 0.14,
      this.spinAngle + this.parSmooth.x * 0.22,
      baseRoll + this.parSmooth.x * 0.05,
    );

    if (!this.reducedMotion) {
      const p = Math.min(1, elapsedSec / 0.85);
      const eased = 1 - Math.pow(1 - p, 3);
      this.cubeMat.uniforms.uPolish.value = eased;
      this.causticMat.uniforms.uIntensity.value = eased;
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
    const w = this.container.clientWidth || 360;
    const h = this.container.clientHeight || 390;
    const aspect = w / h;
    this.logicalH = LOGICAL_HEIGHT;
    this.logicalW = Math.max(120, Math.round(LOGICAL_HEIGHT * aspect));

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.logicalW, this.logicalH, false);
    this.cubeRT.setSize(this.logicalW, this.logicalH);
    this.compMat.uniforms.uLogicalSize.value.set(this.logicalW, this.logicalH);

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    if (this.disposed) return;
    this.renderer.setRenderTarget(this.cubeRT);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.cubeScene, this.camera);

    this.renderer.setRenderTarget(null);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.causticScene, this.camera);

    this.renderer.render(this.compScene, this.compCamera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    this.cubeRT.dispose();
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
