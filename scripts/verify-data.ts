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
import { EMPTY_LIBRARY, mergeLibrary, serializeLibraryData, deserializeLibraryData } from "../src/data/libraryStore.ts";
import { SAMPLE_FORMULAS, SAMPLE_LIBRARY, SAMPLE_TECHNIQUES } from "../src/data/samples.ts";
import {
  createTechnique,
  deserializeTechnique,
  serializeTechnique,
  TechniqueError,
  upsertKeyframe,
} from "../src/data/technique.ts";
import { clampBend, createDefaultPose, createDefaultRig } from "../src/hand/HandRig.ts";
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
    createTechnique({ name: "bad", keyframes: [{ frame: 10, pose: p }, { frame: 10, pose: p }] });
  } catch (e) {
    threw = e instanceof TechniqueError;
  }
  expect(threw, "应抛 TechniqueError");
});

check("technique: stepMapping 区间非法抛错", () => {
  let threw = false;
  try {
    createTechnique({ name: "bad", stepMapping: [{ stepIndex: 0, startFrame: 30, endFrame: 20 }] });
  } catch (e) {
    threw = e instanceof TechniqueError;
  }
  expect(threw, "应抛 TechniqueError");
});

check("technique: JSON 往返 + upsertKeyframe", () => {
  const rig = createDefaultRig();
  const t = createTechnique({
    name: "双指连拨",
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
  expect(SAMPLE_TECHNIQUES.length === 1, "示例手法应为 1 条");
  const tec = SAMPLE_TECHNIQUES[0];
  expect(tec.frameRate === 60, "frameRate 应为 60");
  expect(tec.keyframes.length === 3, "关键帧应为 3");
  expect(tec.keyframes[2].pose.bends.index[1] === 45, "终态 PIP 应为 45");
  expect(tec.stepMapping.length === 1, "stepMapping 应为 1");
});

check("library: 合并与序列化往返", () => {
  const merged = mergeLibrary(EMPTY_LIBRARY, SAMPLE_LIBRARY);
  const back = deserializeLibraryData(serializeLibraryData(merged));
  expect(
    back.formulas.length === merged.formulas.length && back.techniques.length === merged.techniques.length,
    "往返数量不一致",
  );
});

if (failures) {
  throw new Error(`${failures} FAILURE(S)`);
}
console.log("\nALL PASS");
