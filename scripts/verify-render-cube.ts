/**
 * verify-render-cube.ts — R1 阶段 1 自建渲染核心的纯逻辑自检（node 原生 TS strip-types 运行：
 *   node scripts/verify-render-cube.ts，勿用 tsx；同 verify-zbll-coverage.ts 记法）。
 *
 * 校验项：
 *  A. axisAngleMat(axis, 90°) 与 engine.rot(v, axis, 1) 等价（方向约定一致）
 *  B. quarterMat(axis, amount) 与 engine.rot 对全部 MOVE_NAMES 的 amount 等价
 *  C. pose↔54 贴纸 state 槽位对偶：随机 alg（face/slice/whole 混合）后，每个槽位 idx 的
 *     state 颜色 == 位于该槽位的块其贴纸（法线像 == 槽位法线）的 home 面颜色；
 *     且 pose.state 与 engine.applyAlg(solved, A) 全等
 *  D. 动画中断语义：playMove(R) 播一半 → playMove(U) 中断丢弃 R → 完成后 state == applyAlg("U")
 *  E. 连续两步完成：R 完成后 U，state == applyAlg("R U")
 *  F. applyMoveNow + undo 历史栈：R U → undo 回 R → undo 回 solved
 *  G. setState(state) 重涂：committed 几何保持不变，每张贴纸 stateMaterial hex ==
 *     FACE_COLORS[state[stickerIndex(块 pos, 贴纸法线像)]]
 */

import { applyAlg, CUBIES, MOVE_NAMES, MOVES, rot, solvedState, stickerIndex } from "../src/cube/solver/engine.ts";
import type { Vec3 } from "../src/cube/solver/engine.ts";
import { applyAlgPose, axisAngleMat, m3Apply, quarterMat, type PoseState } from "../src/cube/render/pose.ts";
import { FACE_COLORS, RenderCube } from "../src/cube/render/RenderCube.ts";

const PASS: string[] = [];
const FAIL: string[] = [];
const veq = (a: Vec3, b: Vec3, eps = 1e-9) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;
const stateEq = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
function check(name: string, ok: boolean, detail = ""): void {
  (ok ? PASS : FAIL).push(`${name}${detail ? " — " + detail : ""}`);
}
const RNG = (() => {
  let s = 0x2f6e2b1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
})();
const randV3 = (): Vec3 => [RNG() * 2 - 1, RNG() * 2 - 1, RNG() * 2 - 1];

// ---- A/B：轴角矩阵（右手正角）↔ rot（从 +axis 看顺时针 = 负角）----
{
  // A：axisAngleMat 本身的语义 = 绕 +axis 右手正角；engine.rot 的「顺时针从 +axis 看」
  // = 绕 −axis 右手 = axisAngleMat(axis, −90°)。此处验证该方向关系。
  let okA = true;
  for (const axis of [0, 1, 2]) {
    for (let k = 0; k < 40; k++) {
      const v = randV3();
      if (!veq(m3Apply(axisAngleMat(axis, -Math.PI / 2), v), rot(v, axis, 1))) okA = false;
    }
  }
  check("A axisAngleMat(axis,-90°) == rot(v,axis,1)（顺时针=负角）", okA);
  let okB = true;
  for (const name of MOVE_NAMES) {
    const m = MOVES[name];
    for (let k = 0; k < 20; k++) {
      const v = randV3();
      if (!veq(m3Apply(quarterMat(m.axis, m.amount), v), rot(v, m.axis, (m.amount + 4) % 4))) okB = false;
    }
  }
  check("B quarterMat == rot 全 MOVE_NAMES", okB);
}

// ---- C：pose↔state 槽位对偶（300 随机算法，mixed face/slice/whole）----
{
  let ok = true;
  const base = ["R", "L", "F", "B", "U", "D", "r", "l", "f", "b", "u", "d", "M", "E", "S", "x", "y", "z"];
  for (let it = 0; it < 300; it++) {
    const len = 4 + ((RNG() * 20) | 0);
    const alg: string[] = [];
    for (let k = 0; k < len; k++) alg.push(base[(RNG() * base.length) | 0]);
    const p = applyAlgPose({ pieces: solvedPieces(), state: solvedState() }, alg);
    const ref = applyAlg(solvedState(), alg);
    if (!stateEq(p.state, ref)) {
      ok = false;
      check(`C#${it} pose.state == engine.applyAlg`, false, alg.join(" "));
      break;
    }
    for (let bi = 0; bi < CUBIES.length; bi++) {
      for (const s of CUBIES[bi].stickers) {
        // 贴纸当前槽位 = stickerIndex(块 pos, home 法线经 rot 之像)；state[槽位]
        // 应 = 该贴纸的 home 面（物理模型：贴纸颜色随块走）
        const n = m3Apply(p.pieces[bi].rot, s.normal);
        const idx = stickerIndex(p.pieces[bi].pos, n);
        if (p.state[idx] !== s.face) {
          ok = false;
          check(`C#${it} 贴纸 ${bi}#${s.face} 槽位 ${idx} 色不一致`, false, `state=${p.state[idx]} want=${s.face} @ ${alg.join(" ")}`);
          break;
        }
      }
      if (!ok) break;
    }
    if (!ok) break;
  }
  check("C pose↔state 槽位对偶（300 随机算法）", ok);
}

// ---- D/E/F：动画语义（three 对象可在 Node 无 GPU 构造）----
{
  // D 中断：R 播一半被 U 替代；最终 = 仅 U
  const rcD = new RenderCube({ internalRaf: false });
  rcD.playMove("R");
  rcD.step(0.15); // t=150 < dur=300 → R 动画中
  rcD.playMove("U");
  rcD.step(0.4); // U 完成
  check("D 动画中断（R 丢弃）state == applyAlg(U)", stateEq(rcD.committedPose.state, applyAlg(solvedState(), "U")));
  // E 连续完成
  const rcE = new RenderCube({ internalRaf: false });
  rcE.playMove("R");
  rcE.step(0.4);
  rcE.playMove("U");
  rcE.step(0.4);
  check("E 连续两步 state == applyAlg(R U)", stateEq(rcE.committedPose.state, applyAlg(solvedState(), "R U")));
  // F undo 历史
  const rcF = new RenderCube({ internalRaf: false });
  rcF.applyMoveNow("R");
  rcF.applyMoveNow("U");
  const after2 = rcF.committedPose.state;
  check("F applyMoveNow x2 state == applyAlg(R U)", stateEq(after2, applyAlg(solvedState(), "R U")));
  rcF.undo();
  check("F1 undo → applyAlg(R)", stateEq(rcF.committedPose.state, applyAlg(solvedState(), "R")));
  rcF.undo();
  check("F2 undo → solved", stateEq(rcF.committedPose.state, solvedState()));
}

// ---- G：setState 重涂（几何不变、贴纸色 = 槽位色）----
{
  const rcG = new RenderCube({ internalRaf: false });
  const target = applyAlg(solvedState(), "R U R' F L'");
  const before = rcG.committedPose;
  rcG.setState(target);
  let ok = true;
  const pcOf = (rcG as unknown as { committedPose: PoseState }).committedPose.pieces;
  for (let i = 0; i < CUBIES.length; i++) {
    const pc = pcOf[i];
    // 几何不变
    if (!veq(pc.pos, before.pieces[i].pos, 1e-9)) ok = false;
    for (let j = 0; j < CUBIES[i].stickers.length; j++) {
      const st = rcG.debugSticker(i, j);
      const n = m3Apply(pc.rot, st.dir);
      const idx = stickerIndex(pc.pos, n);
      const want = FACE_COLORS[target[idx]] & 0xffffff;
      const got = parseInt(st.hex, 16);
      if (got !== want) ok = false;
    }
  }
  check("G setState 重涂（几何不变 + 贴纸色=槽位色）", ok);
  check("G1 setState 后 committedPose.state == target", stateEq((rcG as unknown as { committedPose: { state: Uint8Array } }).committedPose.state, target));
}

// ---- H/I/J/K：拖转逻辑（B1：setLayerVisual 视觉层、dragMove 净零/提交、吸附 from）----
{
  // H setLayerVisual 是视觉层：只变换 geometry，不触碰 committed state
  const rcH = new RenderCube({ internalRaf: false });
  const before = rcH.committedPose.state;
  rcH.setLayerVisual(0, [1], -Math.PI / 2);
  check("H setLayerVisual 视觉旋转不改 committed state", stateEq(rcH.committedPose.state, before));
  // H1 setLayerVisual 在动画中时被忽略（U 正常完成）
  rcH.playMove("U");
  rcH.setLayerVisual(1, [1], 1.5);
  rcH.step(0.4);
  check("H1 动画中 setLayerVisual 被忽略（U 正常完成）", stateEq(rcH.committedPose.state, applyAlg(solvedState(), "U")));
  // I dragMove 净零：from=0.6 → to=0、mi=null：完成后回 committed、不提交不压栈
  const rcI = new RenderCube({ internalRaf: false });
  rcI.dragMove(0, [1], 0.6, 0, 200, null);
  check("I0 dragMove 后 isAnimating=true", rcI.isAnimating);
  rcI.step(0.25);
  check("I1 净零拖转完成后 isAnimating=false", !rcI.isAnimating);
  check("I2 净零拖转完成后 state 仍 solved", stateEq(rcI.committedPose.state, solvedState()));
  check("I3 净零拖转不压栈（undo 返回 false）", rcI.undo() === false);
  // J dragMove 提交：axis0 layers[1] from0→-π/2 mi=R
  const rcJ = new RenderCube({ internalRaf: false });
  rcJ.dragMove(0, [1], 0, -Math.PI / 2, 200, "R");
  rcJ.step(0.25);
  check("J0 提交拖转完成 state == applyAlg(R)", stateEq(rcJ.committedPose.state, applyAlg(solvedState(), "R")));
  rcJ.undo();
  check("J1 提交拖转已压栈（undo → solved）", stateEq(rcJ.committedPose.state, solvedState()));
  // K 吸附动画带 from≠0 起点
  const rcK = new RenderCube({ internalRaf: false });
  rcK.dragMove(0, [1], 0.4, Math.PI / 2, 200, "R'");
  rcK.step(0.25);
  check("K 吸附动画（from=0.4→π/2）完成 state == applyAlg(R')", stateEq(rcK.committedPose.state, applyAlg(solvedState(), "R'")));
}


// ---- 汇总 ----
for (const f of FAIL) console.log("FAIL:", f);
console.log(`\nrender-cube 自检：PASS ${PASS.length} / FAIL ${FAIL.length}`);
for (const p of PASS) console.log("  pass:", p);
if (FAIL.length) process.exit(1);

function solvedPieces(): { pos: Vec3; rot: Vec3[] }[] {
  return CUBIES.map((c) => ({ pos: c.pos.slice() as Vec3, rot: [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => v.slice() as Vec3) }));
}