// 生成示例数据 data/samples/{formulas,techniques}.json（用数据层 API 构建，保证合法）。
// 运行：npx tsx scripts/gen-samples.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFormula, createLibrary } from "../src/data/formula.ts";
import { createTechnique } from "../src/data/technique.ts";
import { createDefaultPose, createDefaultRig, type Contact } from "../src/hand/HandRig.ts";

const OUT = "data/samples";
mkdirSync(OUT, { recursive: true });

const flickFormula = createFormula({ name: "单拨 U", moves: "U", tags: ["手法示例"] });
const formulas = createLibrary([
  createFormula({
    name: "V Perm",
    moves: "(R' U R' U') (R D' R' D) R' UD' (R2 U' R2' D R2)",
    tags: ["PLL"],
  }),
  createFormula({ name: "OLL 21", moves: "R U2 R' U' R U' R'", tags: ["OLL"] }),
  createFormula({ name: "H Perm", moves: "M2 U M2 U2 M2 U M2", tags: ["PLL"] }),
  flickFormula,
]);
writeFileSync(join(OUT, "formulas.json"), JSON.stringify(formulas, null, 2));

// 手法示例：单拨 U（docs_old.md 手法一），左手食指，60fps，三关键帧（初始/中间/终态）
const rig = createDefaultRig("left");
const contactAtUL: Contact[] = [
  { finger: "index", segmentIndex: 2, side: "pad", t: 0.67, target: "UL 边" },
];
const contactOnL: Contact[] = [
  { finger: "index", segmentIndex: 0, side: "back", t: 0.45, target: "L 面" },
];

function pose(pip: number, dip: number, contacts: Contact[] = []) {
  const p = createDefaultPose(rig);
  p.bends.index[1] = pip;
  p.bends.index[2] = dip;
  p.contacts = contacts;
  return p;
}

const technique = createTechnique({
  name: "单拨 U（示例）",
  formulaId: flickFormula.id,
  frameRate: 60,
  keyframes: [
    { frame: 0, pose: pose(135, 175, contactAtUL) },
    { frame: 30, pose: pose(90, 155) },
    { frame: 60, pose: pose(45, 135, contactOnL) },
  ],
  stepMapping: [{ stepIndex: 0, startFrame: 0, endFrame: 60 }],
});
writeFileSync(join(OUT, "techniques.json"), JSON.stringify([technique], null, 2));

console.log("samples written:", join(OUT, "formulas.json"), join(OUT, "techniques.json"));
