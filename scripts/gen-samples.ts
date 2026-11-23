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
const oll21Formula = createFormula({
  name: "OLL 21",
  moves: "R U2 R' U' R U' R'",
  tags: ["CFOP"],
  categoryId: oll.id,
});
const formulas = [
  createFormula({
    name: "V Perm",
    moves: "(R' U R' U') (R D' R' D) R' UD' (R2 U' R2' D R2)",
    tags: ["CFOP"],
    categoryId: pll.id,
  }),
  oll21Formula,
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
  return new Quaternion(q.x, q.y, q.z, q.w);
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

// 双手运动展示（示例）：关联已有 OLL 21 公式，将双手拉远魔方两侧（|x| ≈ 4.1–4.7）并竖立面向视角，
// 左右手完全独立编排并同步运动（非单纯镜像），集中展示掌心/掌背翻转、腕部三轴摆动、
// 阶梯波浪、握拳/摊掌、异相逐指弹奏、拇指 CMC 三轴+IP 捏合/对掌与虎爪，
// 末帧闭环回首帧，适合直接开「循环」观赏双手关节与外观。
type ShowcasePoseOpts = {
  pos: [number, number, number];
  /** 叠加在「竖立掌心朝镜头」基准上的欧拉角（度：pitch=前后倾, yaw=转向掌背/掌心, roll=左右摆） */
  rot?: [number, number, number];
  thumb?: [number, number, number];
  cmc?: { abduction: number; elevation: number; rotation: number };
  mcp?: [number, number, number, number];
  pip?: [number, number, number, number];
  dip?: [number, number, number, number];
};

// 基准朝向：绕 X 转 -90° → 指尖朝 +Y（上）、掌心朝 +Z（面向观众）、拇指在外侧
const UPRIGHT_BASE_Q = new Quaternion().setFromEuler(new Euler(-90 * DEG, 0, 0, "XYZ"));

function showcasePose(side: "left" | "right", o: ShowcasePoseOpts): Pose {
  const p = defaultHandPose(side);
  const t = p.palm.transform;
  t.position = { x: o.pos[0], y: o.pos[1], z: o.pos[2] };
  const [rx, ry, rz] = o.rot ?? [0, 0, 0];
  const dq = new Quaternion().setFromEuler(new Euler(rx * DEG, ry * DEG, rz * DEG, "XYZ"));
  const r = dq.multiply(UPRIGHT_BASE_Q).normalize();
  t.quaternion = { w: r.w, x: r.x, y: r.y, z: r.z };
  const F = ["index", "middle", "ring", "pinky"] as const;
  F.forEach((n, i) => {
    if (o.mcp) p.bends[n][0] = o.mcp[i];
    if (o.pip) p.bends[n][1] = o.pip[i];
    if (o.dip) p.bends[n][2] = o.dip[i];
  });
  if (o.thumb) p.bends.thumb = [...o.thumb];
  if (o.cmc) p.thumbCMC = { ...o.cmc };
  return p;
}

const showcaseStartLeft = showcasePose("left", {
  pos: [-4.3, -0.7, 0.2],
  rot: [8, 22, 8],
  mcp: [176, 176, 176, 176],
  pip: [174, 174, 174, 174],
  dip: [176, 176, 176, 176],
  thumb: [175, 174, 175],
  cmc: { abduction: 18, elevation: 0, rotation: 18 },
});
const showcaseStartRight = showcasePose("right", {
  pos: [4.3, -0.7, 0.2],
  rot: [8, -22, -8],
  mcp: [176, 176, 176, 176],
  pip: [174, 174, 174, 174],
  dip: [176, 176, 176, 176],
  thumb: [175, 174, 175],
  cmc: { abduction: 18, elevation: 0, rotation: 18 },
});

const dualHandShowcaseTechnique = createTechnique({
  name: "双手运动展示（示例）",
  formulaId: oll21Formula.id,
  frameRate: 60,
  keyframes: [
    // 0s：双手拉远魔方两侧竖立舒展
    { frame: 0, left: showcaseStartLeft, right: showcaseStartRight, easing: "easeInOut" },
    // 1s：左手亮掌心+大展拇指 ｜ 右手翻向掌背 3/4 + 四指阶梯波浪
    {
      frame: 60,
      left: showcasePose("left", {
        pos: [-4.4, -0.5, 0.4],
        rot: [12, 12, 14],
        mcp: [178, 178, 178, 178],
        pip: [178, 178, 178, 178],
        dip: [178, 178, 178, 178],
        thumb: [176, 176, 176],
        cmc: { abduction: 44, elevation: -12, rotation: 22 },
      }),
      right: showcasePose("right", {
        pos: [4.4, -0.8, 0.3],
        rot: [18, -142, -10],
        mcp: [130, 146, 160, 172],
        pip: [104, 126, 148, 168],
        dip: [122, 140, 158, 172],
        thumb: [166, 156, 124],
        cmc: { abduction: 12, elevation: -8, rotation: 38 },
      }),
      easing: "easeInOut",
    },
    // 2s：角色互换——左手上抬握拳（拇指对掌横搭）｜ 右手翻回掌心前倾摊掌
    {
      frame: 120,
      left: showcasePose("left", {
        pos: [-4.3, -0.1, 0.25],
        rot: [20, 40, -10],
        mcp: [104, 100, 102, 106],
        pip: [92, 90, 92, 94],
        dip: [110, 108, 110, 114],
        thumb: [148, 142, 116],
        cmc: { abduction: 18, elevation: -24, rotation: 76 },
      }),
      right: showcasePose("right", {
        pos: [4.5, -0.95, 0.45],
        rot: [-18, -16, -24],
        mcp: [180, 180, 180, 180],
        pip: [180, 180, 180, 180],
        dip: [180, 180, 180, 180],
        thumb: [178, 178, 178],
        cmc: { abduction: 38, elevation: 24, rotation: 10 },
      }),
      easing: "easeInOut",
    },
    // 3s：异相逐指弹奏——左手食+无名指深弯 ｜ 右手中+小指深弯
    {
      frame: 180,
      left: showcasePose("left", {
        pos: [-4.15, -0.45, 0.55],
        rot: [24, 28, 10],
        mcp: [118, 172, 120, 172],
        pip: [94, 174, 96, 174],
        dip: [116, 176, 118, 176],
        thumb: [168, 162, 150],
        cmc: { abduction: 28, elevation: 6, rotation: 32 },
      }),
      right: showcasePose("right", {
        pos: [4.15, -0.85, 0.55],
        rot: [24, -28, -10],
        mcp: [172, 116, 172, 118],
        pip: [174, 94, 174, 96],
        dip: [176, 116, 176, 118],
        thumb: [164, 156, 142],
        cmc: { abduction: 24, elevation: -10, rotation: 48 },
      }),
      easing: "easeInOut",
    },
    // 4s：拇指三轴与 IP 专项展示——左手 OK 捏合（斜侧亮轮廓）｜ 右手拇指跨掌对小指
    {
      frame: 240,
      left: showcasePose("left", {
        pos: [-4.25, -0.65, 0.5],
        rot: [10, 52, 6],
        mcp: [122, 172, 174, 176],
        pip: [98, 170, 172, 174],
        dip: [116, 172, 174, 176],
        thumb: [148, 142, 110],
        cmc: { abduction: 28, elevation: -28, rotation: 84 },
      }),
      right: showcasePose("right", {
        pos: [4.25, -0.55, 0.5],
        rot: [12, -20, -12],
        mcp: [174, 172, 168, 114],
        pip: [174, 172, 166, 96],
        dip: [176, 174, 170, 116],
        thumb: [138, 134, 108],
        cmc: { abduction: -14, elevation: -34, rotation: 102 },
      }),
      easing: "easeInOut",
    },
    // 5s：高低错位大翻腕（左手高扬展背 ｜ 右手下沉侧倾展掌）
    {
      frame: 300,
      left: showcasePose("left", {
        pos: [-4.65, 0.15, -0.15],
        rot: [28, 145, 24],
        mcp: [148, 144, 140, 136],
        pip: [128, 124, 120, 116],
        dip: [142, 138, 136, 134],
        thumb: [166, 160, 152],
        cmc: { abduction: 24, elevation: 12, rotation: 28 },
      }),
      right: showcasePose("right", {
        pos: [4.6, -1.15, 0.6],
        rot: [-16, -42, -32],
        mcp: [168, 166, 164, 162],
        pip: [158, 156, 154, 152],
        dip: [165, 164, 162, 160],
        thumb: [172, 168, 164],
        cmc: { abduction: 36, elevation: -8, rotation: 22 },
      }),
      easing: "easeInOut",
    },
    // 6s：高低互换——左手下沉亮弯曲手背关节 ｜ 右手上扬反向递增波浪
    {
      frame: 360,
      left: showcasePose("left", {
        pos: [-4.45, -1.05, 0.55],
        rot: [32, 138, -14],
        mcp: [114, 110, 112, 116],
        pip: [98, 96, 98, 102],
        dip: [114, 112, 114, 118],
        thumb: [156, 148, 120],
        cmc: { abduction: 14, elevation: -16, rotation: 54 },
      }),
      right: showcasePose("right", {
        pos: [4.45, 0.05, 0.0],
        rot: [10, -24, 16],
        mcp: [174, 156, 136, 116],
        pip: [172, 148, 122, 98],
        dip: [174, 156, 134, 114],
        thumb: [170, 162, 146],
        cmc: { abduction: 32, elevation: 8, rotation: 30 },
      }),
      easing: "easeInOut",
    },
    // 7s：双手同步「虎爪」深钩（左右手相反斜角，一展掌一展背）
    {
      frame: 420,
      left: showcasePose("left", {
        pos: [-4.2, -0.6, 0.45],
        rot: [18, 36, -8],
        mcp: [166, 166, 166, 166],
        pip: [96, 94, 96, 98],
        dip: [104, 102, 104, 108],
        thumb: [168, 154, 100],
        cmc: { abduction: 40, elevation: -14, rotation: 46 },
      }),
      right: showcasePose("right", {
        pos: [4.2, -0.6, 0.45],
        rot: [18, -136, 8],
        mcp: [166, 166, 166, 166],
        pip: [96, 94, 96, 98],
        dip: [104, 102, 104, 108],
        thumb: [168, 154, 100],
        cmc: { abduction: 40, elevation: -14, rotation: 46 },
      }),
      easing: "easeInOut",
    },
    // 8s：反向舒展波浪（左手外倾抬拇指 ｜ 右手回转亮掌心对掌）
    {
      frame: 480,
      left: showcasePose("left", {
        pos: [-4.5, -0.35, 0.25],
        rot: [4, 24, 24],
        mcp: [148, 162, 174, 178],
        pip: [136, 154, 170, 178],
        dip: [150, 162, 174, 178],
        thumb: [176, 174, 174],
        cmc: { abduction: 38, elevation: 28, rotation: 12 },
      }),
      right: showcasePose("right", {
        pos: [4.5, -0.8, 0.4],
        rot: [16, -24, -22],
        mcp: [178, 174, 160, 146],
        pip: [178, 168, 150, 134],
        dip: [178, 172, 158, 146],
        thumb: [152, 146, 126],
        cmc: { abduction: 12, elevation: -20, rotation: 68 },
      }),
      easing: "easeInOut",
    },
    // 9s：平缓收拢自然微曲
    {
      frame: 540,
      left: showcasePose("left", {
        pos: [-4.3, -0.65, 0.3],
        rot: [10, 26, 6],
        mcp: [166, 164, 164, 166],
        pip: [158, 154, 154, 158],
        dip: [166, 164, 164, 166],
        thumb: [172, 168, 168],
        cmc: { abduction: 20, elevation: 2, rotation: 22 },
      }),
      right: showcasePose("right", {
        pos: [4.3, -0.65, 0.3],
        rot: [10, -26, -6],
        mcp: [166, 164, 164, 166],
        pip: [158, 154, 154, 158],
        dip: [166, 164, 164, 166],
        thumb: [172, 168, 168],
        cmc: { abduction: 20, elevation: 2, rotation: 22 },
      }),
      easing: "easeInOut",
    },
    // 10s：无缝闭环回首帧
    { frame: 600, left: showcaseStartLeft, right: showcaseStartRight, easing: "easeInOut" },
  ],
  stepMapping: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
    stepIndex: i,
    startFrame: i * 85,
    endFrame: i === 6 ? 600 : (i + 1) * 85,
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
  techniques: [technique, handDemoTechnique, dualHandShowcaseTechnique, ...formulaTechniques],
};
writeFileSync(join(OUT, "library.json"), serializeLibraryData(lib));
// 旧的两文件格式废弃，清理
rmSync(join(OUT, "formulas.json"), { force: true });
rmSync(join(OUT, "techniques.json"), { force: true });
console.log("samples written:", join(OUT, "library.json"));
