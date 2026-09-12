/**
 * verify-hand-mesh.ts — low-poly 手部网格生成器自检（npx tsx 运行，无 DOM）。
 * 检查：双手构建无 NaN、包围盒合理、左右镜像对称、接触锚点结构、
 * 绕向（掌前缘/指尖外法线朝 +Z）、顶点色存在且合法、极值造型参数不炸。
 */
import { Box3 } from "three";
import { createDefaultRig, FINGER_ORDER } from "../src/hand/HandRig.ts";
import { createRigFromConfig, DEFAULT_HAND_CONFIG } from "../src/hand/handRigStore.ts";
import { buildHandMesh, type HandMeshResult } from "../src/hand/handMesh.ts";

let failed = 0;
function expect(cond: boolean, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function noNaN(res: HandMeshResult, label: string): void {
  res.root.traverse((o) => {
    const mesh = o as unknown as { isMesh?: boolean; geometry?: { getAttribute(n: string): { array: ArrayLike<number> } | undefined } };
    if (!mesh.isMesh || !mesh.geometry) return;
    const arr = mesh.geometry.getAttribute("position")?.array;
    expect(arr !== undefined, `${label}: 网格应有 position`);
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      expect(Number.isFinite(arr[i]), `${label}: position 含非有限值 (idx ${i})`);
      if (!Number.isFinite(arr[i])) break;
    }
  });
}

function bbox(res: HandMeshResult): Box3 {
  return new Box3().setFromObject(res.root);
}

function checkWindingZ(res: HandMeshResult, part: string, label: string, minNz: number): void {
  let found = false;
  res.root.traverse((o) => {
    const mesh = o as unknown as {
      isMesh?: boolean; userData?: { part?: string };
      geometry?: { getAttribute(n: string): { array: ArrayLike<number> } | undefined };
    };
    if (!mesh.isMesh || mesh.userData?.part !== part) return;
    const arr = mesh.geometry?.getAttribute("position")?.array;
    if (!arr) return;
    let bestZ = -Infinity;
    let bestNz = 0;
    for (let t = 0; t + 2 < arr.length / 3; t += 3) {
      const ax = arr[t * 3], ay = arr[t * 3 + 1], az = arr[t * 3 + 2];
      const bx = arr[t * 3 + 3], by = arr[t * 3 + 4], bz = arr[t * 3 + 5];
      const cx = arr[t * 3 + 6], cy = arr[t * 3 + 7], cz = arr[t * 3 + 8];
      const czCent = (az + bz + cz) / 3;
      if (czCent > bestZ) {
        bestZ = czCent;
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        const len = Math.hypot(nx, ny, nz) || 1;
        bestNz = nz / len;
      }
    }
    found = true;
    // 掌前缘平面帽 nz≈1；指尖圆头扇帽为斜锥面（nz≈0.4–0.6），只验证绕向朝外不翻转
    expect(bestNz > minNz, `${label}: ${part} 最前三角形外法线应朝 +Z（实际 ${bestNz.toFixed(3)}）`);
  });
  expect(found, `${label}: 应存在 part=${part} 网格`);
}

function checkColors(res: HandMeshResult, label: string): void {
  res.root.traverse((o) => {
    const mesh = o as unknown as {
      isMesh?: boolean; userData?: { part?: string };
      geometry?: { getAttribute(n: string): { array: ArrayLike<number> } | undefined };
    };
    if (!mesh.isMesh) return;
    expect(mesh.userData?.part !== undefined, `${label}: 网格应带 part 标记`);
    const col = mesh.geometry?.getAttribute("color")?.array;
    expect(col !== undefined, `${label}: ${String(mesh.userData?.part)} 应有顶点色`);
    if (!col) return;
    for (let i = 0; i < col.length; i++) {
      expect(col[i] > 0 && col[i] <= 1, `${label}: 顶点色越界 (idx ${i})`);
      if (!(col[i] > 0 && col[i] <= 1)) break;
    }
  });
}

// ---- 1) 默认参数双手构建 ----
for (const side of [1, -1] as const) {
  const label = side === 1 ? "右手" : "左手";
  const res = buildHandMesh(DEFAULT_HAND_CONFIG, createDefaultRig(side === 1 ? "right" : "left"), side);
  noNaN(res, label);
  const b = bbox(res);
  const H = DEFAULT_HAND_CONFIG.handScale;
  expect(b.min.x > -6 * H && b.max.x < 6 * H, `${label}: 包围盒 X 越界`);
  expect(b.min.y > -4 * H && b.max.y < 4 * H, `${label}: 包围盒 Y 越界`);
  expect(b.min.z > -6 * H && b.max.z < 8 * H, `${label}: 包围盒 Z 越界`);
  checkColors(res, label);
  // 接触锚点结构
  for (const name of FINGER_ORDER) {
    const segs = res.fingers[name].segments;
    expect(segs.length === (name === "thumb" ? 2 : 3), `${label}: ${name} 段数`);
    for (const s of segs) {
      expect(s.len > 0 && s.radius > 0 && s.thickness > 0, `${label}: ${name} 段尺寸应为正`);
    }
  }
  // 拇指根镜像
  if (side === -1) {
    const r = buildHandMesh(DEFAULT_HAND_CONFIG, createDefaultRig("right"), 1);
    const br = bbox(r);
    expect(Math.abs(br.min.x + b.max.x) < 1e-4, "左右手 X 包围盒应镜像");
    expect(
      Math.abs(r.thumbRoot.position.x + res.thumbRoot.position.x) < 1e-6,
      "拇指根 X 应镜像",
    );
  }
  // 绕向（掌前缘平面帽 / 中指尖端斜锥面）
  checkWindingZ(res, "palm", label, 0.5);
  checkWindingZ(res, "middle-seg2", label, 0.1);
}

// ---- 2) 极值造型参数不炸 ----
const extremes: Array<{ name: string; shape: Record<string, number> }> = [
  { name: "粗刻面+大隆起", shape: { facets: 4, knuckleBulge: 1.6 } },
  { name: "细刻面+平腹", shape: { facets: 16, padFlat: 1 } },
  { name: "尖指+深弓", shape: { tipTaper: 0.3, arch: 0.2, palmCup: 0.12 } },
  { name: "满蹼+无收窄", shape: { web: 1, shaftTaper: 1.05, palmTaper: 1 } },
  { name: "极粗指+大隆起", shape: { fingerWidth: 1.45, knuckleBulge: 1.6 } },
];
for (const e of extremes) {
  // 走 createRigFromConfig：fingerWidth 乘子在骨架层生效（与运行时同路径），
  // 因此先把 shape 覆盖合入 cfg 再建骨架与网格
  const cfg = { ...DEFAULT_HAND_CONFIG, shape: { ...DEFAULT_HAND_CONFIG.shape, ...e.shape } };
  const res = buildHandMesh(cfg, createRigFromConfig(cfg, "right"), 1);
  noNaN(res, `极值[${e.name}]`);
}

// ---- 3) 指根掌侧组件存在（领圈/填充棱/肌凸，十三~十五轮） ----
{
  const res = buildHandMesh(DEFAULT_HAND_CONFIG, createRigFromConfig(DEFAULT_HAND_CONFIG, "right"), 1);
  const counts: Record<string, number> = { "knuckle-collar": 0, "knuckle-filler": 0, "palmar-pad": 0 };
  res.root.traverse((o) => {
    const m = o as unknown as { isMesh?: boolean; userData?: { part?: string } };
    if (m.isMesh && m.userData?.part && m.userData.part in counts) counts[m.userData.part]++;
  });
  expect(counts["knuckle-collar"] === 4, `四指根领圈应为 4（实得 ${counts["knuckle-collar"]}）`);
  expect(counts["knuckle-filler"] === 3, `指根间填充棱应为 3（实得 ${counts["knuckle-filler"]}）`);
  expect(counts["palmar-pad"] === 4, `指根掌侧肌凸应为 4（实得 ${counts["palmar-pad"]}）`);
  // 绕向：填充棱/肌凸最 +z 的三角面外法线应朝 +z（掌面外侧）
  checkWindingZ(res, "knuckle-filler", "default", 0.3);
  checkWindingZ(res, "palmar-pad", "default", 0.3);
}

console.log(failed === 0 ? "verify-hand-mesh: ALL PASS ✓" : `verify-hand-mesh: ${failed} FAIL`);
if (failed > 0) process.exit(1);
