// 数据层验证（tsx 运行）：公式库 / 手法库 / 手骨架 / 时间线帧工具。
// 运行：npx tsx scripts/verify-data.ts
import {
  createFormula,
  createLibrary,
  deserializeFormula,
  FormulaError,
  removeFormula,
  serializeFormula,
  upsertFormula,
} from "../src/data/formula.ts";
import {
  CategoryError,
  categoryDepth,
  createCategory,
  removeCategory,
  validateCategoryTree,
} from "../src/data/category.ts";
import {
  allStickerIds,
  baseFaceSetupAlg,
  clearGray,
  createGrayState,
  graySet,
  presetGrayState,
  presetGrayStickers,
  stickerIdFromWorld,
  stickerWorldPos,
  toggleSticker,
  type Face,
} from "../src/cube/stickering.ts";
import { parseMoves, splitCompoundMove } from "../src/notation/alg.ts";
import {
  buildAutoPathKeyframes,
  buildSinePathKeyframes,
  expandFormulaMoves,
  insertTechniquePauseAfter,
  rebuildTechniqueWithDurations,
  rescaleTechniqueFrames,
} from "../src/editor/timelineOps.ts";
import { eulerDegToQuat, poseRotationDeg, trackPoseAtFrame } from "../src/editor/poseHelpers.ts";
import {
  EMPTY_LIBRARY,
  loadLibrary,
  mergeLibrary,
  parseLibraryDataTolerant,
  saveLibrary,
  serializeLibraryData,
  deserializeLibraryData,
  removeCategoryFromLib,
  removeFormulaFromLib,
  type LibraryData,
} from "../src/data/libraryStore.ts";
import { externalDrive, frameAtElapsed, pickFrameIndex, releaseExternalDrive } from "../src/hand/handApi.ts";
import { SAMPLE_FORMULAS, SAMPLE_LIBRARY, SAMPLE_TECHNIQUES } from "../src/data/samples.ts";
import {
  createTechnique,
  deserializeTechnique,
  serializeTechnique,
  TechniqueError,
  upsertKeyframe,
  type Technique,
} from "../src/data/technique.ts";
import {
  clampBend,
  createDefaultPose,
  createDefaultRig,
  defaultHandPose,
  FINGER_ORDER,
  mirrorPose,
  type FingerName,
} from "../src/hand/HandRig.ts";
import {
  DEFAULT_HAND_CONFIG,
  createRigFromConfig,
  normalizeHandRigConfig,
} from "../src/hand/handRigStore.ts";
import {
  applyEasing,
  DEFAULT_FRAME_RATE,
  frameToSecond,
  interpolatePose,
  secondToFrame,
  validateKeyframes,
} from "../src/timeline/Timeline.ts";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}  →  ${e instanceof Error ? e.message : String(e)}`);
  }
}
function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ---------- 公式库 ----------
check("formula: 创建并规范化", () => {
  const f = createFormula({ name: "V Perm", moves: "(R' U R' U') (R D' R' D) R' UD' (R2 U' R2' D R2)" });
  expect(f.moves.includes("UD'"), `规范化失败：${f.moves}`);
  expect(f.tags.length === 0, "默认 tags 应为空");
});

check("formula: 非法记法抛错", () => {
  let threw = false;
  try {
    createFormula({ name: "bad", moves: "R U ???" });
  } catch (e) {
    threw = e instanceof FormulaError;
  }
  expect(threw, "应抛 FormulaError");
});

check("formula: 库 JSON 往返", () => {
  const f1 = createFormula({ name: "OLL 21", moves: "R U2 R' U' R U' R'" });
  const f2 = createFormula({ name: "PLL", moves: "M2 U M2 U2 M2 U M2", tags: ["pll", "h-perm"] });
  const lib = upsertFormula(upsertFormula(createLibrary(), f1), f2);
  const back = deserializeFormula(serializeFormula(lib));
  expect(back.formulas.length === 2, "往返后数量应一致");
  expect(back.formulas[1].moves === "M2 U M2 U2 M2 U M2", "往返后 moves 应一致");
  const removed = removeFormula(back, f1.id);
  expect(removed.formulas.length === 1, "删除后应剩 1 条");
});

// ---------- 手法库 ----------
check("technique: 默认 60fps、关键帧排序", () => {
  const rig = createDefaultRig();
  const p0 = createDefaultPose(rig);
  const p1 = createDefaultPose(rig);
  p1.bends.index[1] = 45;
  const t = createTechnique({
    name: "单拨 U",
    formulaId: "f-u",
    keyframes: [
      { frame: 60, left: mirrorPose(p1), right: p1 },
      { frame: 0, left: mirrorPose(p0), right: p0 },
    ],
  });
  expect(t.frameRate === DEFAULT_FRAME_RATE, "frameRate 应默认 60");
  expect(t.keyframes[0].frame === 0 && t.keyframes[1].frame === 60, "关键帧应升序");
});

check("technique: 重复帧号抛错", () => {
  const rig = createDefaultRig();
  const p = createDefaultPose(rig);
  let threw = false;
  try {
    createTechnique({ name: "bad", formulaId: "f-1", keyframes: [{ frame: 10, left: p, right: p }, { frame: 10, left: p, right: p }] });
  } catch (e) {
    threw = e instanceof TechniqueError;
  }
  expect(threw, "应抛 TechniqueError");
});

check("technique: stepMapping 区间非法抛错", () => {
  let threw = false;
  try {
    createTechnique({ name: "bad", formulaId: "f-1", stepMapping: [{ stepIndex: 0, startFrame: 30, endFrame: 20 }] });
  } catch (e) {
    threw = e instanceof TechniqueError;
  }
  expect(threw, "应抛 TechniqueError");
});

check("technique: JSON 往返 + upsertKeyframe", () => {
  const rig = createDefaultRig();
  const t = createTechnique({
    name: "双指连拨",
    formulaId: "f-2",
    keyframes: [
      { frame: 0, left: createDefaultPose(rig), right: createDefaultPose(rig) },
      { frame: 30, left: createDefaultPose(rig), right: createDefaultPose(rig) },
    ],
    stepMapping: [{ stepIndex: 0, startFrame: 0, endFrame: 30 }],
  });
  const mid = createDefaultPose(rig);
  mid.thumbCMC.abduction = 20;
  const withMid = upsertKeyframe(t, {
    frame: 15,
    left: mid,
    right: createDefaultPose(rig),
  });
  expect(withMid.keyframes.length === 3, "插入后应有 3 个关键帧");
  const back = deserializeTechnique(serializeTechnique(withMid));
  expect(back.keyframes.length === 3 && back.stepMapping.length === 1, "往返后结构应一致");
  expect(back.keyframes[1].frame === 15, "关键帧应保持升序");
});

// ---------- 手骨架 ----------
check("rig: 拇指特例（2 段 / CMC,MCP,IP）", () => {
  const rig = createDefaultRig("left");
  const thumb = rig.fingers.thumb;
  expect(thumb.segments.length === 2, "拇指应为 2 段");
  expect(thumb.joints.map((j) => j.name).join() === "CMC,MCP,IP", `拇指关节表错误：${thumb.joints.map((j) => j.name)}`);
  const index = rig.fingers.index;
  expect(index.segments.length === 3, "食指应为 3 段");
  expect(index.joints.map((j) => j.name).join() === "MCP,PIP,DIP", "食指关节表错误");
});

check("rig: clampBend 范围", () => {
  const rig = createDefaultRig();
  const pip = rig.fingers.index.joints[1];
  expect(clampBend(pip, 200) === 180, "上限应 180");
  expect(clampBend(pip, 30) === 90, "下限应 90");
  const cmc = rig.fingers.thumb.joints[0];
  expect(clampBend(cmc, 50) === 60, "拇指 CMC 下限应为其自定义 60");
});

check("rig: 指节比例按人体测量数据（小指 1.33 锚点）", () => {
  const rig = createDefaultRig();
  const total = (n: FingerName) => rig.fingers[n].segments.reduce((s, seg) => s + seg.length, 0);
  expect(Math.abs(total("pinky") - 1.33) < 1e-9, "小指总长应为锚点 1.33");
  // 各指总长比（以中指为 1，指节之和）：acbjournal 2024 → 0.700 / 0.904 / 0.926 / 0.754
  const m = total("middle");
  const expLen = { thumb: 0.700, index: 0.904, ring: 0.926, pinky: 0.754 } as const;
  for (const [n, r] of Object.entries(expLen)) {
    const got = total(n as FingerName) / m;
    expect(Math.abs(got - r) < 0.012, `${n} 总长比 ${got.toFixed(3)} 应≈${r}`);
  }
  // 指节长度占比（JSSM 久坐男性）：中指近节 48.5%、拇指近节 57.3%
  const mid = rig.fingers.middle.segments;
  expect(Math.abs(mid[0].length / m - 0.485) < 0.01, "中指近节占比应≈48.5%");
  const th = rig.fingers.thumb.segments;
  expect(Math.abs(th[0].length / total("thumb") - 0.573) < 0.01, "拇指近节占比应≈57.3%");
  // 手指粗细相对小指（儿童指径 16/15/15/14/13 → 1.23/1.15/1.15/1.08/1.00）
  const w = (n: FingerName) => rig.fingers[n].segments[0].width;
  const pw = w("pinky");
  const expW = { thumb: 1.23, index: 1.15, middle: 1.15, ring: 1.08 } as const;
  for (const [n, r] of Object.entries(expW)) {
    const got = w(n as FingerName) / pw;
    expect(Math.abs(got - r) < 0.03, `${n} 粗细比 ${got.toFixed(3)} 应≈${r}`);
  }
});

check("handRigStore: 默认配置与骨架一致、覆盖生效", () => {
  const def = createDefaultRig("left");
  const fromCfg = createRigFromConfig(DEFAULT_HAND_CONFIG, "left");
  for (const name of FINGER_ORDER) {
    const a = def.fingers[name].segments;
    const b = fromCfg.fingers[name].segments;
    expect(a.length === b.length, `${name} 段数应一致`);
    for (let i = 0; i < a.length; i++) {
      // 十三轮起四指段宽 × shape.fingerWidth（骨架层加粗），拇指保持原宽
      const wantW = name === "thumb" ? a[i].width : a[i].width * DEFAULT_HAND_CONFIG.shape.fingerWidth;
      expect(
        a[i].length === b[i].length && Math.abs(b[i].width - wantW) < 1e-9,
        `${name}[${i}] 默认段应与骨架一致（四指含加粗乘子）`,
      );
    }
  }
  const cfg = structuredClone(DEFAULT_HAND_CONFIG);
  cfg.fingers.index[0].length = 1.2;
  const rig2 = createRigFromConfig(cfg);
  expect(rig2.fingers.index.segments[0].length === 1.2, "覆盖段长应生效");
  expect(
    rig2.fingers.middle.segments[0].length === def.fingers.middle.segments[0].length,
    "未覆盖指应保持默认",
  );
});

check("handRigStore: 非法配置拒绝 / 越界截断", () => {
  expect(normalizeHandRigConfig(null) === null, "null 应拒绝");
  expect(normalizeHandRigConfig({ version: 1, fingers: {} }) === null, "缺指段应拒绝");
  const badVer = structuredClone(DEFAULT_HAND_CONFIG) as { version: number; fingers: unknown };
  badVer.version = 5; // 当前合法版本为 1–4，5 为未知版本
  expect(normalizeHandRigConfig(badVer) === null, "版本不符应拒绝");
  const bad = structuredClone(DEFAULT_HAND_CONFIG);
  bad.fingers.pinky[0].length = 999;
  bad.handScale = -3;
  const n = normalizeHandRigConfig(bad);
  expect(n !== null, "越界值应规范化而非拒绝");
  expect(n!.fingers.pinky[0].length <= 5, "超长段应截断到上限");
  expect(n!.handScale >= 0.3, "负放大系数应截断到下限");
});

check("handRigStore: v3 旧档迁移 v4（shape 缺省回默认，无破坏）", () => {
  const v3 = structuredClone(DEFAULT_HAND_CONFIG) as Record<string, unknown>;
  v3.version = 3;
  delete v3.shape; // v3 档无 shape 字段
  const n = normalizeHandRigConfig(v3);
  expect(n !== null, "v3 档应被接受");
  expect(n!.version === 4, "v3 档应迁移为 v4");
  expect(
    n!.shape.facets === 15 && n!.shape.knuckleBulge === 1.1 && n!.shape.web === 0.5,
    "shape 缺省应回 DEFAULT_SHAPE",
  );
  // v3 数值字段原样保留
  expect(
    JSON.stringify(n!.fingers) === JSON.stringify(DEFAULT_HAND_CONFIG.fingers),
    "v3 指段数值迁移应无损",
  );
  // shape 越界截断
  const over = structuredClone(DEFAULT_HAND_CONFIG);
  over.shape.knuckleBulge = 99;
  over.shape.facets = 3.7;
  const n2 = normalizeHandRigConfig(over);
  expect(n2!.shape.knuckleBulge <= 1.6, "隆起系数应截断到上限");
  expect(n2!.shape.facets === 4, "截面边数应截断到下限并取整");
});

check("handRigStore: fingerWidth 旧档补默认 + 越界截断 + 乘子仅四指（十三轮）", () => {
  // 旧 v4 档 shape 缺 fingerWidth 字段 → 补默认
  const v4old = structuredClone(DEFAULT_HAND_CONFIG) as Record<string, unknown>;
  delete (v4old.shape as Record<string, unknown>).fingerWidth;
  const n = normalizeHandRigConfig(v4old);
  expect(n !== null, "缺 fingerWidth 的旧 v4 档应被接受");
  expect(n!.shape.fingerWidth === 1.15, "旧档缺 fingerWidth 应补默认 1.15");
  // 越界截断
  const over = structuredClone(DEFAULT_HAND_CONFIG);
  over.shape.fingerWidth = 9;
  const n2 = normalizeHandRigConfig(over);
  expect(n2!.shape.fingerWidth === 1.45, "加粗乘子应截断到上限 1.45");
  over.shape.fingerWidth = 0.1;
  const n3 = normalizeHandRigConfig(over);
  expect(n3!.shape.fingerWidth === 0.9, "加粗乘子应截断到下限 0.9");
  // 骨架层乘子：四指段宽 × fingerWidth，拇指保持原宽（与大鱼际截面配平）
  const rig = createRigFromConfig(n!);
  for (const name of FINGER_ORDER) {
    for (let i = 0; i < rig.fingers[name].segments.length; i++) {
      const base = DEFAULT_HAND_CONFIG.fingers[name][i].width;
      const got = rig.fingers[name].segments[i].width;
      const want = name === "thumb" ? base : base * 1.15;
      expect(Math.abs(got - want) < 1e-9, `${name}[${i}] 段宽乘子应${name === "thumb" ? "不生效" : "生效"}`);
    }
  }
});

// ---------- 时间线 ----------
check("timeline: 帧↔秒换算", () => {
  expect(frameToSecond(30) === 0.5, "30 帧应为 0.5s");
  expect(secondToFrame(0.5) === 30, "0.5s 应为 30 帧");
});

check("timeline: 关键帧校验", () => {
  expect(validateKeyframes([{ frame: 0 }, { frame: 10 }]) === null, "升序应通过");
  expect(validateKeyframes([{ frame: 10 }, { frame: 5 }]) !== null, "倒序应报错");
  expect(validateKeyframes([{ frame: -1 }]) !== null, "负帧号应报错");
});

check("HandRig: mirrorPose 镜像语义（双手显示，十七轮）", () => {
  const pose = defaultHandPose("right");
  // 赋非对称位姿便于验证（四元数存储序 w,x,y,z）
  pose.palm.transform.position = { x: 0.4, y: 0.2, z: 0.3 };
  pose.palm.transform.quaternion = { w: 0.9, x: 0.1, y: 0.3, z: 0.27 };
  pose.thumbCMC = { abduction: 20, elevation: 10, rotation: 30 };
  const m = mirrorPose(pose);
  expect(m.palm.transform.position.x === -0.4 && m.palm.transform.position.y === 0.2 && m.palm.transform.position.z === 0.3, "镜像位置仅 x 取反");
  expect(
    m.palm.transform.quaternion.w === 0.9 && m.palm.transform.quaternion.x === 0.1 &&
    m.palm.transform.quaternion.y === -0.3 && m.palm.transform.quaternion.z === -0.27,
    "镜像四元数 y/z 分量取反（M·R·M，M=diag(−1,1,1)）",
  );
  // 审计 P0-7：CMC **不**在此取反——HandRigView.applyPose 已按手型 sideSign 镜像
  // （abduction×sideSign、−rotation×sideSign），此处再取反即双重取反，镜像拇指朝向错；
  // 抬离（elevation）本就是 Y 轴镜像不变量。
  expect(
    m.thumbCMC.abduction === 20 && m.thumbCMC.elevation === 10 && m.thumbCMC.rotation === 30,
    "CMC 展收/对掌/抬离均不取反（手性由渲染侧 sideSign 负责，P0-7）",
  );
  expect(JSON.stringify(m.bends) === JSON.stringify(pose.bends), "bends 对称照搬");
  const back = mirrorPose(m);
  expect(back.palm.transform.position.x === 0.4 && back.thumbCMC.abduction === 20, "双次镜像应还原");
});

check("technique: left/right 双轨关键帧 + 旧档迁移（十八轮）", () => {
  const left = defaultHandPose("left");
  const right = defaultHandPose("right");
  const t = createTechnique({
    name: "双手测试",
    formulaId: "f-test",
    keyframes: [{ frame: 0, left, right }],
  });
  const back = deserializeTechnique(serializeTechnique(t));
  expect(
    back.keyframes[0].left.palm.transform.position.x === left.palm.transform.position.x &&
    back.keyframes[0].right.palm.transform.position.x === right.palm.transform.position.x,
    "left/right 双轨序列化往返无损",
  );
  // 旧档 { pose, mirror? } 迁移：pose → 右手轨道；mirror 缺省时左手 = 镜像(右手)
  const legacyPose = defaultHandPose("right");
  legacyPose.palm.transform.position = { x: 0.5, y: 0, z: 0 };
  const legacy = deserializeTechnique(
    serializeTechnique({ ...t, keyframes: [{ frame: 0, pose: legacyPose }] } as unknown as Technique),
  );
  expect(legacy.keyframes[0].right.palm.transform.position.x === 0.5, "旧 pose 应迁移到右手轨道");
  expect(
    legacy.keyframes[0].left.palm.transform.position.x === -0.5,
    "旧档缺 mirror 时左手 = 镜像(右手)",
  );
  const legacyWithMirror = deserializeTechnique(
    serializeTechnique({
      ...t,
      keyframes: [{ frame: 0, pose: legacyPose, mirror: legacyPose }],
    } as unknown as Technique),
  );
  expect(legacyWithMirror.keyframes[0].left.palm.transform.position.x === 0.5, "旧档带 mirror 时左手取 mirror");
});

check("timeline: 缓动与姿态插值", () => {
  expect(applyEasing("linear", 0.5) === 0.5, "linear");
  expect(Math.abs(applyEasing("easeIn", 0.5) - 0.25) < 1e-9, "easeIn");
  const rig = createDefaultRig();
  const a = createDefaultPose(rig);
  const b = createDefaultPose(rig);
  a.bends.index[1] = 90;
  b.bends.index[1] = 180;
  const mid = interpolatePose(a, b, 0.5);
  expect(mid.bends.index[1] === 135, `中点 bend 应为 135：${mid.bends.index[1]}`);
  const q = mid.palm.transform.quaternion;
  const len = Math.hypot(q.w, q.x, q.y, q.z);
  expect(Math.abs(len - 1) < 1e-9, `四元数应单位化：${len}`);
});

// ---------- 示例数据与库 ----------
check("samples: 示例公式库可加载", () => {
  expect(SAMPLE_FORMULAS.formulas.length >= 3, `示例公式数量异常：${SAMPLE_FORMULAS.formulas.length}`);
  expect(SAMPLE_FORMULAS.formulas.some((f) => f.name === "V Perm"), "缺少 V Perm");
});

check("samples: 示例手法可加载（60fps/三关键帧/终态 PIP 45）", () => {
  expect(SAMPLE_TECHNIQUES.length >= 1, "示例手法应至少 1 条");
  const tec = SAMPLE_TECHNIQUES[0];
  expect(tec.frameRate === 60, "frameRate 应为 60");
  expect(tec.keyframes.length === 3, "关键帧应为 3");
  expect(tec.keyframes[2].right.bends.index[1] === 45, "终态 PIP 应为 45");
  expect(tec.stepMapping.length === 1, "stepMapping 应为 1");
  expect(tec.formulaId.length > 0, "手法应关联公式");
  // 自动动作刻度补全：其余公式手法 stepMapping 与公式步数一致（每步 1 秒）
  const auto = SAMPLE_TECHNIQUES.filter((x) => x.keyframes.length === 0);
  expect(
    auto.every((x) => x.stepMapping.length > 0 && x.stepMapping.every((m) => m.endFrame > m.startFrame)),
    "无关键帧手法应含合法 stepMapping",
  );
  // 双手运动展示内置手法：关联已有公式、远离魔方、左右手非镜像同步独立运动
  const showcase = SAMPLE_TECHNIQUES.find((x) => x.name === "双手运动展示（示例）");
  expect(!!showcase, "应内置「双手运动展示（示例）」手法");
  expect(
    SAMPLE_FORMULAS.formulas.some((f) => f.id === showcase!.formulaId),
    "双手运动展示手法应关联已有公式",
  );
  expect(showcase!.keyframes.length >= 10, `双手运动展示关键帧数不足：${showcase!.keyframes.length}`);
  expect(
    showcase!.keyframes.every(
      (k) =>
        Math.abs(k.left.palm.transform.position.x) >= 2.5 &&
        Math.abs(k.right.palm.transform.position.x) >= 2.5,
    ),
    "双手运动展示应将双手拉远魔方（|x| >= 2.5）",
  );
  // 至少有若干帧左右手关节弯屈不同（体现双手独立同步运动，而非单纯镜像）
  const hasAsymmetric = showcase!.keyframes.some(
    (k) => Math.abs(k.left.bends.index[1] - k.right.bends.index[1]) >= 20,
  );
  expect(hasAsymmetric, "双手运动展示应包含左右手非镜像独立同步动作");
});

check("library: 合并与序列化往返", () => {
  const merged = mergeLibrary(EMPTY_LIBRARY, SAMPLE_LIBRARY);
  const back = deserializeLibraryData(serializeLibraryData(merged));
  expect(
    back.formulas.length === merged.formulas.length && back.techniques.length === merged.techniques.length,
    "往返数量不一致",
  );
});

// ---------- 分类系统 ----------
check("category: 深度限制（最多 4 层）", () => {
  let cats = [createCategory({ id: "a", name: "A" }, [])];
  cats.push(createCategory({ id: "b", name: "B", parentId: "a" }, cats));
  cats.push(createCategory({ id: "c", name: "C", parentId: "b" }, cats));
  cats.push(createCategory({ id: "d", name: "D", parentId: "c" }, cats));
  expect(categoryDepth(cats[3], cats) === 3, "第 4 层深度应为 3");
  validateCategoryTree(cats);
  let threw = false;
  try {
    createCategory({ id: "e", name: "E", parentId: "d" }, cats);
  } catch (e) {
    threw = e instanceof CategoryError;
  }
  expect(threw, "第 5 层应被拒绝");
});

check("category: 缺父与环检测", () => {
  let threw = false;
  try {
    categoryDepth({ id: "x", name: "X", parentId: "missing" }, [
      { id: "x", name: "X", parentId: "missing" },
    ]);
  } catch (e) {
    threw = e instanceof CategoryError;
  }
  expect(threw, "缺父应抛错");
  const cyclic = [
    { id: "a", name: "A", parentId: "b" },
    { id: "b", name: "B", parentId: "a" },
  ];
  threw = false;
  try {
    categoryDepth(cyclic[0], cyclic);
  } catch (e) {
    threw = e instanceof CategoryError;
  }
  expect(threw, "环应抛错");
});

check("category: 删除上提子分类", () => {
  const cats = [
    { id: "a", name: "A", parentId: null },
    { id: "b", name: "B", parentId: "a" },
    { id: "c", name: "C", parentId: "b" },
  ];
  const after = removeCategory("b", cats);
  expect(after.length === 2, "删除后应剩 2 个");
  expect(after.find((x) => x.id === "c")?.parentId === "a", "C 应上提到 A 下");
});

check("library: 分类随库往返、删分类清理公式", () => {
  const cat = createCategory({ id: "c1", name: "OLL" }, []);
  const f = createFormula({ name: "O", moves: "R U R'", categoryId: "c1", tags: ["CFOP"] });
  expect(f.categoryId === "c1", "公式应带分类");
  const lib: LibraryData = { version: 1, categories: [cat], formulas: [f], techniques: [] };
  const back = deserializeLibraryData(serializeLibraryData(lib));
  expect(back.categories.length === 1 && back.formulas[0].categoryId === "c1", "往返后分类应保留");
  const cleaned = removeCategoryFromLib(lib, "c1");
  expect(cleaned.categories.length === 0 && cleaned.formulas[0].categoryId === null, "删分类后公式应清理");
});

check("formula: 旧 categoryIds 数组迁移为单选", () => {
  const back = deserializeFormula(
    JSON.stringify({
      formulas: [{ id: "m1", name: "M", moves: "R U R'", tags: [], categoryIds: ["a", "b"] }],
    }),
  );
  expect(back.formulas[0].categoryId === "a", "迁移应取第一个分类");
});

check("technique: formulaId 必填", () => {
  let threw = false;
  try {
    createTechnique({ name: "x", formulaId: "" });
  } catch (e) {
    threw = e instanceof TechniqueError;
  }
  expect(threw, "缺少 formulaId 应抛错");
});

check("library: 删除公式连带删除手法", () => {
  const f = createFormula({ name: "F", moves: "R U R'" });
  const tec = createTechnique({ name: "T", formulaId: f.id });
  const lib: LibraryData = { version: 1, categories: [], formulas: [f], techniques: [tec] };
  const after = removeFormulaFromLib(lib, f.id);
  expect(after.formulas.length === 0 && after.techniques.length === 0, "删除公式应连带删除手法");
});

// ---------- 标灰系统 ----------
check("stickering: 54 个小面与坐标往返", () => {
  const ids = allStickerIds();
  expect(ids.length === 54, `应为 54：${ids.length}`);
  expect(new Set(ids).size === 54, "小面 id 应唯一");
  for (const id of ids) {
    const p = stickerWorldPos(id);
    expect(stickerIdFromWorld(p.x, p.y, p.z) === id, `坐标往返失败：${id}`);
  }
});

check("stickering: 状态操作", () => {
  let s = createGrayState();
  s = toggleSticker(s, "U0", "mutable");
  expect(graySet(s).has("U0"), "U0 应被灰选");
  s = toggleSticker(s, "U0", "mutable");
  expect(graySet(s).size === 0, "再点应取消");
  s = toggleSticker(s, "F4", "immutable");
  expect(s.immutable.length === 1, "不可变灰");
  const c = clearGray(s);
  expect(c.mutable.length === 0 && c.immutable.length === 0, "清除应清空");
});

check("stickering: 初始十字预设（六色底统一展示帧 P1-6）", () => {
  // 展示帧已由 baseFaceSetupAlg(base) 把所选底色转到 D 面位，故六色底预设保留集统一落在展示帧底面（D 十字）
  const expectCross = ["D4", "D3", "D1", "D5", "D7", "L7", "F7", "R7", "B7"];
  for (const face of ["D", "U", "F", "B", "L", "R"] as Face[]) {
    expect(presetGrayStickers("cross", face).length === 45, `十字(${face}) stickers 应灰 45`);
    const s = presetGrayState("cross", face);
    expect(s.mutable.length === 45, `十字(${face}) 应灰 45：${s.mutable.length}`);
    const keep = new Set(allStickerIds().filter((id) => !graySet(s).has(id)));
    for (const id of expectCross) {
      expect(keep.has(id as never), `十字(${face}) 展示帧应保留 ${id}`);
    }
  }
});

check("stickering: 桥式左右桥预设（六色底统一展示帧 P1-6）", () => {
  const expectLeft = ["L3", "L4", "L5", "L6", "L7", "L8", "F3", "F6", "B5", "B8", "D3", "D0", "D6"];
  const expectRight = ["R3", "R4", "R5", "R6", "R7", "R8", "F5", "F8", "B3", "B6", "D5", "D2", "D8"];
  for (const face of ["D", "U", "F", "B", "L", "R"] as Face[]) {
    const left = presetGrayState("roux-left", face);
    expect(left.mutable.length === 41, `左桥(${face}) 应灰 41：${left.mutable.length}`);
    const keepL = new Set(allStickerIds().filter((id) => !graySet(left).has(id)));
    for (const id of expectLeft) {
      expect(keepL.has(id as never), `左桥(${face}) 展示帧应保留 ${id}`);
    }
    const right = presetGrayState("roux-right", face);
    expect(right.mutable.length === 41, `右桥(${face}) 应灰 41：${right.mutable.length}`);
    const keepR = new Set(allStickerIds().filter((id) => !graySet(right).has(id)));
    for (const id of expectRight) {
      expect(keepR.has(id as never), `右桥(${face}) 展示帧应保留 ${id}`);
    }
  }
});

check("stickering: 底色旋转设置均为合法记法", () => {
  for (const face of ["D", "U", "F", "B", "R", "L"] as Face[]) {
    const alg = baseFaceSetupAlg(face);
    expect(parseMoves(alg || "U U'").ok, `底色 ${face} 的旋转 ${alg} 应合法`);
  }
});

// ---------- 库加载容错（P0-8）与注入 API 循环/所有权（P1-2 / P1-1） ----------
// 最小 localStorage stub（libraryStore 只在调用期访问 localStorage）
const LIB_KEY = "motion-cube.library";
const mem = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string): string | null => (mem.has(k) ? mem.get(k) ?? null : null),
  setItem: (k: string, v: string): void => {
    mem.set(k, String(v));
  },
  removeItem: (k: string): void => {
    mem.delete(k);
  },
  clear: (): void => {
    mem.clear();
  },
  key: (i: number): string | null => [...mem.keys()][i] ?? null,
  get length(): number {
    return mem.size;
  },
};
(globalThis as unknown as { localStorage: typeof memoryStorage }).localStorage = memoryStorage;

const BAD_TECHNIQUE = { id: "bad-tech", name: "坏手法", formulaId: "x", frameRate: 60, keyframes: "not-an-array" };

check("library: loadLibrary 正常库与旧口径逐字段一致（回归）", () => {
  const raw = serializeLibraryData(SAMPLE_LIBRARY);
  mem.set(LIB_KEY, raw);
  const r = loadLibrary();
  expect(r.error === null && r.rejected.length === 0, `正常库不应报错：${String(r.error)} / ${r.rejected.length}`);
  expect(
    JSON.stringify(r.data) === JSON.stringify(deserializeLibraryData(raw)),
    "loadLibrary 结果应与 deserializeLibraryData 逐字段一致",
  );
  expect(
    r.data.formulas.length === SAMPLE_LIBRARY.formulas.length &&
      r.data.techniques.length === SAMPLE_LIBRARY.techniques.length &&
      r.data.categories.length === SAMPLE_LIBRARY.categories.length,
    "正常库条目数应保持不变",
  );
});

check("library: 一条坏手法只跳过该条，其余条目全保留（P0-8）", () => {
  const raw = JSON.stringify({
    version: 1,
    categories: SAMPLE_LIBRARY.categories,
    formulas: SAMPLE_LIBRARY.formulas,
    techniques: [...SAMPLE_LIBRARY.techniques, BAD_TECHNIQUE],
  });
  mem.set(LIB_KEY, raw);
  const r = loadLibrary();
  expect(r.error === null, `坏单条不应升级为整包错误：${String(r.error)}`);
  expect(r.rejected.length === 1, `应只跳过 1 条：${r.rejected.length}`);
  expect(r.rejected[0].index === SAMPLE_LIBRARY.techniques.length, `坏条目下标应为末位：${r.rejected[0].index}`);
  expect(r.rejected[0].reason.length > 0, "被拒条目应带原因");
  // 关键：绝不整库清空
  expect(r.data.techniques.length === SAMPLE_LIBRARY.techniques.length, `好手法应全部保留：${r.data.techniques.length}`);
  expect(r.data.formulas.length === SAMPLE_LIBRARY.formulas.length, "公式应全部保留");
  expect(r.data.categories.length === SAMPLE_LIBRARY.categories.length, "分类应全部保留");
  expect(JSON.stringify(r.data.techniques) === JSON.stringify(SAMPLE_LIBRARY.techniques), "保留的手法内容应与原件一致");
  expect(r.data.techniques.length > 0, "坏数据不得导致整库清空");
});

check("library: 坏公式同样只跳过该条", () => {
  const raw = JSON.stringify({
    version: 1,
    categories: [],
    formulas: [...SAMPLE_LIBRARY.formulas, { id: "bad-formula", name: "坏公式", moves: "R U ???", tags: [] }],
    techniques: [],
  });
  mem.set(LIB_KEY, raw);
  const r = loadLibrary();
  expect(r.error === null, `坏单条不应升级为整包错误：${String(r.error)}`);
  expect(r.rejected.length === 1, `应只跳过 1 条公式：${r.rejected.length}`);
  expect(r.data.formulas.length === SAMPLE_LIBRARY.formulas.length, "好公式应全部保留");
});

check("library: 整包 JSON 损坏 → error 非 null 且不静默（P0-8）", () => {
  mem.set(LIB_KEY, "{ this is not json");
  const r = loadLibrary();
  expect(r.error !== null, "JSON 损坏必须返回 error（禁止静默返回空库）");
  expect(parseLibraryDataTolerant("{ this is not json").error !== null, "容错入口对坏 JSON 也应返回 error");
  expect(r.data.formulas.length === 0 && r.data.techniques.length === 0, "整包不可读时 data 为空库");
  expect(r.data !== EMPTY_LIBRARY, "空库应为新对象，不得复用 EMPTY_LIBRARY 单例");
  // 严格口径仍抛错（导入/合并路径不受影响）
  let threw = false;
  try {
    deserializeLibraryData("{ this is not json");
  } catch {
    threw = true;
  }
  expect(threw, "deserializeLibraryData 应保持严格口径（坏包抛错）");
});

check("library: 空存储 → 空库且无错误", () => {
  mem.clear();
  const r = loadLibrary();
  expect(r.error === null && r.rejected.length === 0, "空存储不应报错");
  expect(r.data.formulas.length === 0 && r.data.techniques.length === 0, "空存储应得到空库");
  // saveLibrary 往返（正常路径不变）
  saveLibrary(SAMPLE_LIBRARY);
  const back = loadLibrary();
  expect(back.error === null && back.data.formulas.length === SAMPLE_LIBRARY.formulas.length, "saveLibrary 后应可正常读回");
});

check("handApi: frameAtElapsed 循环按跨度取模（P1-2）", () => {
  const at = (sec: number, loop: boolean) => frameAtElapsed(0, 24, sec, 24, loop);
  // 第 1 周期内线性推进（绝对帧号语义不变）
  expect([0, 0.25, 0.5, 0.75].map((s) => at(s, true)).join(",") === "0,6,12,18", "循环第 1 周期推进异常");
  // 跨周期回绕：旧实现会永久停在 24
  expect(at(1, true) === 0, `1 周期末应回绕到首帧：${at(1, true)}`);
  expect(at(2, true) === 0, `2 周期末应回绕到首帧：${at(2, true)}`);
  expect(at(1.25, true) === 6 && at(2.5, true) === 12, "第 2/3 周期推进异常");
  // 非 loop：到达即停语义不变（夹到末帧）
  expect(at(0.5, false) === 12, "非 loop 中段应线性推进");
  expect(at(0.999, false) < 24, "非 loop 未到末帧前不应停下");
  expect(at(5, false) === 24, "非 loop 应夹到末帧");
  // 单帧片段（span===0）：恒为始帧，不除零
  expect(frameAtElapsed(100, 100, 3.7, 24, true) === 100, "单帧片段（loop）应恒为始帧");
  expect(frameAtElapsed(100, 100, 3.7, 24, false) === 100, "单帧片段（非 loop）应恒为始帧");
});

check("handApi: pickFrameIndex 末帧占周期末 1 帧（P1-2 loop 末帧可见）", () => {
  const f = [0, 15, 30];
  // 常规：取「帧号 ≤ target 的最后一帧」
  expect(pickFrameIndex(f, 0, true) === 0, "target=0 应取首帧");
  expect(pickFrameIndex(f, 14.9, true) === 0, "target<15 应取首帧");
  expect(pickFrameIndex(f, 15, true) === 1, "target=15 应取第 2 帧");
  expect(pickFrameIndex(f, 20, true) === 1, "target=20 应取第 2 帧");
  // loop：取模区间 [first,last) 会吃掉末帧 → 周期最后 1 帧必须留给末帧
  expect(pickFrameIndex(f, 29, true) === 2, "loop 下周期末 1 帧应取末帧（否则末帧永远不显示）");
  expect(pickFrameIndex(f, 29.99, true) === 2, "loop 下接近周期末应取末帧");
  expect(pickFrameIndex(f, 0.5, true) === 0, "回绕后应回到首帧");
  // 非 loop：末帧由「到末帧即停」分支负责，这里不得抢
  expect(pickFrameIndex(f, 29, false) === 1, "非 loop 下不应抢末帧");
  expect(pickFrameIndex(f, 30, false) === 2, "非 loop 下 target=末帧应取末帧");
  // 单帧片段
  expect(pickFrameIndex([7], 7, true) === 0, "单帧片段应取唯一帧");
  expect(pickFrameIndex([], 0, true) === 0, "空数组应安全返回 0");
});

check("handApi: externalDrive 契约 + releaseExternalDrive（P1-1）", () => {
  expect(typeof externalDrive === "object" && externalDrive.active === false, "externalDrive 初始应为 { active: false }");
  externalDrive.active = true;
  releaseExternalDrive();
  expect(!externalDrive.active, "releaseExternalDrive 应置 active=false");
});

// ---------- Step 3A：记法展开 / 时间线纯逻辑 / 校验加固 / mirrorPose 深拷贝 ----------
check("notation: splitCompoundMove 保留 w 宽层修饰", () => {
  expect(splitCompoundMove("UD'").join(",") === "U,D'", "UD' 应拆成 U,D'");
  expect(splitCompoundMove("RwUw").join(",") === "Rw,Uw", `RwUw 应拆成 Rw,Uw（实得 ${splitCompoundMove("RwUw").join(",")}）`);
  expect(splitCompoundMove("Rw2'Uw'").join(",") === "Rw2',Uw'", `Rw2'Uw' 应保留宽层与修饰（实得 ${splitCompoundMove("Rw2'Uw'").join(",")}）`);
});

check("timelineOps: expandFormulaMoves 展开交换子/共轭/分组/宽层", () => {
  expect(expandFormulaMoves("[R, U]").join(" ") === "R U R' U'", `[R, U] 展开异常：${expandFormulaMoves("[R, U]").join(" ")}`);
  expect(expandFormulaMoves("[F: [R, U]]").join(" ") === "F R U R' U' F'", `[F: [R, U]] 展开异常：${expandFormulaMoves("[F: [R, U]]").join(" ")}`);
  expect(expandFormulaMoves("(R U)2 RwUw").join(" ") === "R U R U Rw Uw", `(R U)2 RwUw 展开异常：${expandFormulaMoves("(R U)2 RwUw").join(" ")}`);
});

check("timelineOps: 重映射（帧率/时长/空拍）正常与冲突拒绝", () => {
  const p = defaultHandPose("right");
  const t = createTechnique({
    name: "remap",
    formulaId: "f-r",
    frameRate: 60,
    keyframes: [
      { frame: 0, left: mirrorPose(p), right: p },
      { frame: 18, left: mirrorPose(p), right: p },
    ],
    stepMapping: [
      { stepIndex: 0, startFrame: 0, endFrame: 18 },
      { stepIndex: 1, startFrame: 18, endFrame: 36 },
    ],
  });
  const scaled = rescaleTechniqueFrames(t, 60, 120, (a, b, f) => `collide ${a}/${b}->${f}`);
  expect(scaled.frameRate === 120 && scaled.keyframes[1].frame === 36 && scaled.stepMapping[1].endFrame === 72, "帧率翻倍应等比翻倍");
  const paused = insertTechniquePauseAfter(t, 0, 0.3, (a, b, f) => `collide ${a}/${b}->${f}`);
  expect(paused.stepMapping.length === 3 && paused.stepMapping[1].kind === "pause", "应插入空拍步");
  const rebuilt = rebuildTechniqueWithDurations(t, () => 0.5, (a, b, f) => `collide ${a}/${b}->${f}`);
  expect(rebuilt.stepMapping[0].endFrame === 30 && rebuilt.keyframes[1].frame === 30, "改时长应同步重映射关键帧");
  // 冲突拒绝：1000fps 下帧 0/1 缩到 24fps 塌陷到 0
  const t1000 = createTechnique({
    name: "t1000",
    formulaId: "f-r",
    frameRate: 1000,
    keyframes: [
      { frame: 0, left: mirrorPose(p), right: p },
      { frame: 1, left: mirrorPose(p), right: p },
    ],
  });
  let collided = false;
  try {
    rescaleTechniqueFrames(t1000, 1000, 24, (a, b, f) => `collide ${a}/${b}->${f}`);
  } catch (e) {
    collided = e instanceof TechniqueError && e.message.includes("collide");
  }
  expect(collided, "帧号塌陷应抛 TechniqueError");
});

check("timelineOps: 自动/正弦路径 O(n log n) 批量生成", () => {
  const a = defaultHandPose("right");
  const b = defaultHandPose("right");
  b.bends.index[1] = 90;
  const kfs = [
    { frame: 0, left: mirrorPose(a), right: a },
    { frame: 600, left: mirrorPose(b), right: b },
  ];
  const auto = buildAutoPathKeyframes(kfs, 15);
  expect(auto !== null && auto.length === 41, `自动路径帧数应为 41（实得 ${auto?.length}）`);
  const sine = buildSinePathKeyframes(kfs, 15);
  expect(sine !== null && sine.length === 41, `正弦路径帧数应为 41（实得 ${sine?.length}）`);
  // 正弦路径在 1/4 处（150 帧）sin²(π/8) ≈ 0.1464 ≠ 0.25
  const autoQ = auto!.find((k) => k.frame === 150)!.right.bends.index[1];
  const sineQ = sine!.find((k) => k.frame === 150)!.right.bends.index[1];
  expect(Math.abs(autoQ - sineQ) > 1, `正弦路径与线性路径弯屈值应不同：${autoQ} vs ${sineQ}`);
});

check("poseHelpers: 欧拉↔四元数往返与单轨插值", () => {
  const q = eulerDegToQuat(30, -45, 60);
  const p = defaultHandPose("right");
  p.palm.transform.quaternion = q;
  const deg = poseRotationDeg(p);
  expect(
    Math.abs(deg.x - 30) < 1e-4 && Math.abs(deg.y + 45) < 1e-4 && Math.abs(deg.z - 60) < 1e-4,
    `欧拉往返偏差过大：${JSON.stringify(deg)}`,
  );
  const r = trackPoseAtFrame([{ frame: 0, left: mirrorPose(p), right: p }], 10, "right");
  expect(!r.broken && r.pose !== null, "单帧应返回可用姿态");
});

check("technique: 帧率上限/导入帧上限/四元数归一化与零四元数拒绝", () => {
  let threw = false;
  try {
    createTechnique({ name: "hi-fr", formulaId: "f-1", frameRate: 1e9 });
  } catch (e) {
    threw = e instanceof TechniqueError;
  }
  expect(threw, "frameRate=1e9 应被拒绝");
  threw = false;
  try {
    deserializeTechnique(
      JSON.stringify({
        id: "t-huge",
        name: "huge",
        formulaId: "f-1",
        frameRate: 60,
        keyframes: [],
        stepMapping: [{ stepIndex: 0, startFrame: 0, endFrame: 1e8 }],
        contactTracks: [],
      }),
    );
  } catch (e) {
    threw = e instanceof TechniqueError;
  }
  expect(threw, "stepMapping endFrame=1e8 导入应被拒绝");

  const p = defaultHandPose("right");
  const nonUnit = structuredClone(p);
  nonUnit.palm.transform.quaternion = { w: 2, x: 0, y: 0, z: 0 };
  const parsed = deserializeTechnique(
    JSON.stringify({
      id: "t-q",
      name: "q",
      formulaId: "f-1",
      frameRate: 60,
      keyframes: [{ frame: 0, left: nonUnit, right: nonUnit }],
      stepMapping: [],
      contactTracks: [],
    }),
  );
  const qNorm = parsed.keyframes[0].right.palm.transform.quaternion;
  expect(Math.abs(Math.hypot(qNorm.w, qNorm.x, qNorm.y, qNorm.z) - 1) < 1e-9, "非单位四元数应自动归一化");

  const zeroQ = structuredClone(p);
  zeroQ.palm.transform.quaternion = { w: 0, x: 0, y: 0, z: 0 };
  threw = false;
  try {
    deserializeTechnique(
      JSON.stringify({
        id: "t-zq",
        name: "zq",
        formulaId: "f-1",
        frameRate: 60,
        keyframes: [{ frame: 0, left: zeroQ, right: zeroQ }],
        stepMapping: [],
        contactTracks: [],
      }),
    );
  } catch (e) {
    threw = e instanceof TechniqueError;
  }
  expect(threw, "零四元数应被拒绝");
});

check("HandRig: mirrorPose 深拷贝 bends 与 contacts（不共享引用）", () => {
  const src = defaultHandPose("right");
  src.contacts.push({ finger: "index", segmentIndex: 2, side: "pad", t: 0.7, target: "U2" });
  const m = mirrorPose(src);
  m.bends.index[1] = 100;
  m.contacts[0].target = "F0";
  expect(src.bends.index[1] !== 100, "修改镜像 bends 不得污染源姿态");
  expect(src.contacts[0].target === "U2", "修改镜像 contacts 不得污染源姿态");
});

if (failures) {
  throw new Error(`${failures} FAILURE(S)`);
}
console.log("\nALL PASS");
