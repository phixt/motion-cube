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
import { parseMoves } from "../src/notation/alg.ts";
import {
  EMPTY_LIBRARY,
  mergeLibrary,
  serializeLibraryData,
  deserializeLibraryData,
  removeCategoryFromLib,
  removeFormulaFromLib,
  type LibraryData,
} from "../src/data/libraryStore.ts";
import { SAMPLE_FORMULAS, SAMPLE_LIBRARY, SAMPLE_TECHNIQUES } from "../src/data/samples.ts";
import {
  createTechnique,
  deserializeTechnique,
  serializeTechnique,
  TechniqueError,
  upsertKeyframe,
} from "../src/data/technique.ts";
import {
  FINGER_ORDER,
  clampBend,
  createDefaultPose,
  createDefaultRig,
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
      { frame: 60, pose: p1 },
      { frame: 0, pose: p0 },
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
    createTechnique({ name: "bad", formulaId: "f-1", keyframes: [{ frame: 10, pose: p }, { frame: 10, pose: p }] });
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
      { frame: 0, pose: createDefaultPose(rig) },
      { frame: 30, pose: createDefaultPose(rig) },
    ],
    stepMapping: [{ stepIndex: 0, startFrame: 0, endFrame: 30 }],
  });
  const mid = createDefaultPose(rig);
  mid.thumbCMC.abduction = 20;
  const withMid = upsertKeyframe(t, { frame: 15, pose: mid });
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
      expect(
        a[i].length === b[i].length && a[i].width === b[i].width,
        `${name}[${i}] 默认段应与骨架一致`,
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
    n!.shape.facets === 15 && n!.shape.knuckleBulge === 1.22 && n!.shape.web === 0.5,
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
  expect(tec.keyframes[2].pose.bends.index[1] === 45, "终态 PIP 应为 45");
  expect(tec.stepMapping.length === 1, "stepMapping 应为 1");
  expect(tec.formulaId.length > 0, "手法应关联公式");
  // 自动动作刻度补全：其余公式手法 stepMapping 与公式步数一致（每步 1 秒）
  const auto = SAMPLE_TECHNIQUES.filter((x) => x.keyframes.length === 0);
  expect(
    auto.every((x) => x.stepMapping.length > 0 && x.stepMapping.every((m) => m.endFrame > m.startFrame)),
    "无关键帧手法应含合法 stepMapping",
  );
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

check("stickering: 初始十字预设（六色底）", () => {
  const d = presetGrayState("cross", "D");
  expect(d.mutable.length === 45, `十字(D) 应灰 45：${d.mutable.length}`);
  const keepD = new Set(allStickerIds().filter((id) => !graySet(d).has(id)));
  for (const id of ["D4", "D3", "D1", "D5", "D7", "L7", "F7", "R7", "B7"]) {
    expect(keepD.has(id as never), `十字(D) 应保留 ${id}`);
  }
  const u = presetGrayState("cross", "U");
  expect(u.mutable.length === 45, `十字(U) 应灰 45：${u.mutable.length}`);
  const keepU = new Set(allStickerIds().filter((id) => !graySet(u).has(id)));
  for (const id of ["U4", "U3", "U1", "U5", "U7", "L1", "F1", "R1", "B1"]) {
    expect(keepU.has(id as never), `十字(U) 应保留 ${id}`);
  }
  for (const face of ["D", "U", "F", "B", "L", "R"] as Face[]) {
    expect(presetGrayStickers("cross", face).length === 45, `十字(${face}) 应灰 45`);
  }
});

check("stickering: 桥式左右桥预设", () => {
  const left = presetGrayState("roux-left", "D");
  expect(left.mutable.length === 41, `左桥(D) 应灰 41：${left.mutable.length}`);
  const keepL = new Set(allStickerIds().filter((id) => !graySet(left).has(id)));
  for (const id of ["L3", "L4", "L5", "L6", "L7", "L8", "F3", "F6", "B5", "B8", "D3", "D0", "D6"]) {
    expect(keepL.has(id as never), `左桥(D) 应保留 ${id}`);
  }
  const right = presetGrayState("roux-right", "D");
  expect(right.mutable.length === 41, `右桥(D) 应灰 41：${right.mutable.length}`);
  const keepR = new Set(allStickerIds().filter((id) => !graySet(right).has(id)));
  for (const id of ["R3", "R4", "R5", "R6", "R7", "R8", "F5", "F8", "B3", "B6", "D5", "D2", "D8"]) {
    expect(keepR.has(id as never), `右桥(D) 应保留 ${id}`);
  }
  for (const face of ["D", "U", "F", "B", "L", "R"] as Face[]) {
    expect(presetGrayStickers("roux-left", face).length === 41, `左桥(${face}) 应灰 41`);
    expect(presetGrayStickers("roux-right", face).length === 41, `右桥(${face}) 应灰 41`);
  }
});

check("stickering: 底色旋转设置均为合法记法", () => {
  for (const face of ["D", "U", "F", "B", "R", "L"] as Face[]) {
    const alg = baseFaceSetupAlg(face);
    expect(parseMoves(alg || "U U'").ok, `底色 ${face} 的旋转 ${alg} 应合法`);
  }
});

if (failures) {
  throw new Error(`${failures} FAILURE(S)`);
}
console.log("\nALL PASS");
