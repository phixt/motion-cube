// 生成示例数据 data/samples/library.json（分类 + 公式 + 手法，用数据层 API 构建保证合法）。
// 运行：npx tsx scripts/gen-samples.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { Euler, Quaternion } from "three";
import { join } from "node:path";
import { createCategory, type Category } from "../src/data/category.ts";
import { createFormula } from "../src/data/formula.ts";
import { serializeLibraryData, type LibraryData } from "../src/data/libraryStore.ts";
import { createTechnique, type TechniqueKeyframe } from "../src/data/technique.ts";
import { defaultHandPose, mirrorPose, type Contact, type Pose } from "../src/hand/HandRig.ts";
import { parseMoves, splitCompoundMove } from "../src/notation/alg.ts";

const OUT = "data/samples";
mkdirSync(OUT, { recursive: true });

// 分类树（最多 4 层）；大流派（CFOP/Roux/ZZ）用标签，不建分类节点
const categories: Category[] = [];
const oll = createCategory({ id: "cat-oll", name: "OLL", parentId: null }, categories);
categories.push(oll);
const pll = createCategory({ id: "cat-pll", name: "PLL", parentId: null }, categories);
categories.push(pll);
const oneLookLL = createCategory({ id: "cat-1lll", name: "1LLL", parentId: null }, categories);
categories.push(oneLookLL);
const cmll = createCategory({ id: "cat-cmll", name: "CMLL", parentId: null }, categories);
categories.push(cmll);
// ZBLL ⊆ 1LLL（分类单选：ZBLL 公式归到最小集合 ZBLL）
const zbll = createCategory({ id: "cat-zbll", name: "ZBLL", parentId: oneLookLL.id }, categories);
categories.push(zbll);

const flickFormula = createFormula({ name: "单拨 U", moves: "U", tags: ["手法示例"] });
const zbllDemoFormula = createFormula({
  name: "ZBLL（示例）",
  moves: "R U R' U R U2 R'",
  tags: ["CFOP", "单手"],
  categoryId: zbll.id, // 单选：分到最小集合（ZBLL ⊆ 1LLL）
});
const formulas = [
  createFormula({
    name: "V Perm",
    moves: "(R' U R' U') (R D' R' D) R' UD' (R2 U' R2' D R2)",
    tags: ["CFOP"],
    categoryId: pll.id,
  }),
  createFormula({
    name: "OLL 21",
    moves: "R U2 R' U' R U' R'",
    tags: ["CFOP"],
    categoryId: oll.id,
  }),
  createFormula({
    name: "H Perm",
    moves: "M2 U M2 U2 M2 U M2",
    tags: ["CFOP"],
    categoryId: pll.id,
  }),
  zbllDemoFormula,
  // 以下为 cuberoot.me 公式库（数据源 speedcubedb）真实公式样例，
  // 见 https://cuberoot.me/zh/alg/3x3；setup 解法请查 speedcubedb。
  createFormula({
    name: "OLL 1（速拧参考）",
    moves: "R U2 R2 F R F' U2 R' F R F'",
    tags: ["CFOP", "速拧参考"],
    categoryId: oll.id,
  }),
  createFormula({
    name: "PLL Aa（速拧参考）",
    moves: "x (R' U R' D2) (R U' R' D2) R2 x'",
    tags: ["CFOP", "速拧参考"],
    categoryId: pll.id,
  }),
  createFormula({
    name: "CMLL O Adjacent（速拧参考）",
    moves: "R U R' F' R U R' U' R' F R2 U' R'",
    tags: ["Roux", "速拧参考"],
    categoryId: cmll.id,
  }),
  createFormula({
    name: "ZBLL U 1（速拧参考）",
    moves: "(R' U' R U' R' U2' R2) (U' L' U R' U' L)",
    tags: ["CFOP", "速拧参考"],
    categoryId: zbll.id,
  }),
  createFormula({
    name: "1LLL 1 1（速拧参考）",
    moves: "U' (F' U' L' U L F) (L' U' L U' L' U B' U B L)",
    tags: ["CFOP", "速拧参考"],
    categoryId: oneLookLL.id,
  }),
  flickFormula,
];

// 手法示例：单拨 U（docs_old.md 手法一），左手食指，60fps，三关键帧
const contactAtUL: Contact[] = [
  { finger: "index", segmentIndex: 2, side: "pad", t: 0.67, target: "UL 边" },
];
const contactOnL: Contact[] = [
  { finger: "index", segmentIndex: 0, side: "back", t: 0.45, target: "L 面" },
];
/** 右手创作姿态 → 显式双轨关键帧（左手 = 镜像，十八轮） */
function dual(frame: number, pose: Pose): TechniqueKeyframe {
  return { frame, left: mirrorPose(pose), right: pose };
}

function pose(pip: number, dip: number) {
  const p = defaultHandPose("right");
  p.bends.index[1] = pip;
  p.bends.index[2] = dip;
  return p;
}
const technique = createTechnique({
  name: "单拨 U（示例）",
  formulaId: flickFormula.id,
  frameRate: 60,
  keyframes: [
    dual(0, pose(135, 175)),
    dual(30, pose(90, 155)),
    dual(60, pose(45, 135)),
  ],
  stepMapping: [{ stepIndex: 0, startFrame: 0, endFrame: 60 }],
  // 接触轨道（精确起止帧）：起始触 UL 边（0–30），结束触 L 面（60）
  contactTracks: [
    { startFrame: 0, endFrame: 30, contact: contactAtUL[0] },
    { startFrame: 60, endFrame: 60, contact: contactOnL[0] },
  ],
});

// 复杂运动演示（0.4.0 low-poly 手部查看用）：接近→握持→7 步腕部摆动+逐指拨动→释放，
// 11 关键帧覆盖纵移/偏航/拇指对掌变化；绑定 ZBLL 示例公式（7 步）
const DEG = Math.PI / 180;
const demoBaseQ = (() => {
  const q = defaultHandPose("right").palm.transform.quaternion;
  return new Quaternion(q.w, q.x, q.y, q.z);
})();
type DemoPoseOpts = {
  z?: number;
  yaw?: number;
  thumb?: [number, number, number];
  cmc?: { abduction: number; elevation?: number; rotation: number };
  mcp?: [number, number, number, number];
  pip?: [number, number, number, number];
  dip?: [number, number, number, number];
};
function demoPose(o: DemoPoseOpts): Pose {
  const p = defaultHandPose("right");
  const t = p.palm.transform;
  t.position.z = o.z ?? t.position.z;
  if (o.yaw !== undefined) {
    const dq = new Quaternion().setFromEuler(new Euler(0, o.yaw * DEG, 0));
    const r = dq.multiply(demoBaseQ);
    t.quaternion = { w: r.w, x: r.x, y: r.y, z: r.z };
  }
  const F = ["index", "middle", "ring", "pinky"] as const;
  F.forEach((n, i) => {
    if (o.mcp) p.bends[n][0] = o.mcp[i];
    if (o.pip) p.bends[n][1] = o.pip[i];
    if (o.dip) p.bends[n][2] = o.dip[i];
  });
  if (o.thumb) p.bends.thumb = [...o.thumb];
  if (o.cmc) p.thumbCMC = { abduction: o.cmc.abduction, elevation: o.cmc.elevation ?? 0, rotation: o.cmc.rotation };
  return p;
}
const handDemoTechnique = createTechnique({
  name: "复杂运动演示（示例）",
  formulaId: zbllDemoFormula.id,
  frameRate: 60,
  keyframes: [
    dual(0, demoPose({ z: -2.7,  mcp: [175,175,175,175], pip: [175,175,175,175], dip: [175,175,175,175], thumb: [175,172,174], cmc: { abduction: 0, rotation: 25 } })),
    dual(55, demoPose({ z: -2.12, mcp: [170,170,170,170], pip: [150,150,150,150], dip: [165,165,165,165], thumb: [172,168,170], cmc: { abduction: 0, rotation: 40 } })),
    dual(95, demoPose({ z: -2.05, yaw: -7,  pip: [95,150,150,150],  dip: [150,160,160,160], thumb: [168,160,165], cmc: { abduction: 5, rotation: 45 } })),
    dual(155, demoPose({ z: -2.08, yaw: 6,   pip: [160,100,150,150], dip: [165,148,160,160], thumb: [170,164,168], cmc: { abduction: -5, rotation: 45 } })),
    dual(215, demoPose({ z: -2.1,  yaw: -8,  pip: [150,150,100,150], dip: [160,160,148,160], thumb: [172,166,170], cmc: { abduction: 5, rotation: 45 } })),
    dual(275, demoPose({ z: -2.06, yaw: 7,   pip: [150,150,150,105], dip: [160,160,160,150], thumb: [170,162,166], cmc: { abduction: -5, rotation: 50 } })),
    dual(335, demoPose({ z: -2.0,  yaw: -10, pip: [115,115,150,150], dip: [150,150,160,160], thumb: [166,158,164], cmc: { abduction: 8, rotation: 50 } })),
    dual(385, demoPose({ z: -2.06, yaw: 12,  pip: [150,150,112,112], dip: [160,160,150,150], thumb: [168,160,166], cmc: { abduction: -8, rotation: 55 } })),
    dual(425, demoPose({ z: -2.04, yaw: -6,  pip: [100,100,100,100], dip: [148,148,148,148], thumb: [164,156,162], cmc: { abduction: 8, rotation: 55 } })),
    dual(465, demoPose({ z: -2.15, mcp: [170,170,170,170], pip: [150,150,150,150], dip: [165,165,165,165], thumb: [170,165,168], cmc: { abduction: 0, rotation: 45 } })),
    dual(520, demoPose({ z: -2.7,  mcp: [175,175,175,175], pip: [175,175,175,175], dip: [175,175,175,175], thumb: [175,172,174], cmc: { abduction: 0, rotation: 25 } })),
  ],
  stepMapping: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
    stepIndex: i,
    startFrame: 70 + i * 60,
    endFrame: 130 + i * 60,
  })),
});

// 其余公式各配一个基础手法：自动动作刻度（每步 18 帧 = 0.3 秒，与 cubing 单步动画匹配），
// 无关键帧（播放时手用默认姿态、魔方按公式逐步骤驱动）——保证示例都能正常播放
const STEP_FRAMES = 18;
const formulaTechniques = formulas
  .filter((f) => f.id !== flickFormula.id)
  .map((f) => {
    const parsed = parseMoves(f.moves);
    const moves = parsed.ok
      ? parsed.normalized
          .split(/\s+/)
          .filter(Boolean)
          .map((s) => s.replace(/[()]/g, ""))
          .flatMap(splitCompoundMove)
      : [];
    return createTechnique({
      name: `${f.name}（手法）`,
      formulaId: f.id,
      frameRate: 60,
      keyframes: [],
      stepMapping: moves.map((_, i) => ({
        stepIndex: i,
        startFrame: i * STEP_FRAMES,
        endFrame: (i + 1) * STEP_FRAMES,
      })),
    });
  });

const lib: LibraryData = {
  version: 1,
  categories,
  formulas,
  techniques: [technique, handDemoTechnique, ...formulaTechniques],
};
writeFileSync(join(OUT, "library.json"), serializeLibraryData(lib));
// 旧的两文件格式废弃，清理
rmSync(join(OUT, "formulas.json"), { force: true });
rmSync(join(OUT, "techniques.json"), { force: true });
console.log("samples written:", join(OUT, "library.json"));
