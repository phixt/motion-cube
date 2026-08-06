// 层 B 记法验证（Node 端）：直接使用 cubing/alg 做解析/序列化/展开/求逆自检。
// 运行：node scripts/verify-notation.mjs
import { Alg } from "cubing/alg";

let failures = 0;
function check(name, fn) {
  try {
    const msg = fn();
    console.log(`PASS ${name}${msg ? "  →  " + msg : ""}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}  →  ${e.message}`);
  }
}

// 覆盖 docs/base.md 与 docs/forumlaExample.md 的代表性记法
const cases = [
  "R U R' U R U2' R'",
  "M2 E S'",
  "r U2 x r U2 r U2 r' U2 l U2 r' U2 r U2 r' U2 r'",
  "x y' z2",
  "[R, U]",
  "[R: U]",
  "(R' U R' U') (R D' R' D) R' UD' (R2 U' R2' D R2)",
  "(R' U R' U') (R D' R' D) R' U' D' (R2 U' R2' D R2)",
  "y x' // inspection\nU R2 U' F' L F' U' L' // XX-Cross",
  "U M' U' R' U' R U M2' U' R' U r",
];

for (const s of cases) {
  check(`parse: ${JSON.stringify(s).replace(/\\n/g, "\\n")}`, () => {
    const str = Alg.fromString(s).toString();
    if (!str) throw new Error("empty toString");
    return str;
  });
}

check("round-trip 幂等", () => {
  for (const s of cases) {
    const a = Alg.fromString(s).toString();
    const b = Alg.fromString(a).toString();
    if (a !== b) throw new Error(`不幂等: ${a} != ${b}`);
  }
  return "ok";
});

check("invert∘invert == 原公式", () => {
  for (const s of cases) {
    const a = Alg.fromString(s);
    if (!a.invert().invert().isIdentical(a)) throw new Error(`双重求逆不还原: ${s}`);
  }
  return "ok";
});

check("交换子展开 [R,U] == R U R' U'", () => {
  const e = Alg.fromString("[R, U]").expand().toString();
  if (e !== "R U R' U'") throw new Error(e);
  return e;
});

check("共轭展开 [R: U] == R U R'", () => {
  const e = Alg.fromString("[R: U]").expand().toString();
  if (e !== "R U R'") throw new Error(e);
  return e;
});

check("非法输入抛错", () => {
  let threw = false;
  try {
    Alg.fromString("R U ???");
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("未抛错");
  return "ok";
});

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
