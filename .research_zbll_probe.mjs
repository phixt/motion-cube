import { cube3x3x3 } from "cubing/puzzles";
const kp = await cube3x3x3.kpuzzle();
console.log("moves:", Object.keys(kp.definition.moves).join(","));
const solved = kp.defaultPattern();
for (const m of ["y", "y2", "x", "z"]) {
  try { const p = solved.applyMove(m); console.log("applyMove ok:", m, "changed:", !p.isIdentical(solved)); }
  catch (e) { console.log("applyMove FAIL:", m, e.message.slice(0, 60)); }
}
