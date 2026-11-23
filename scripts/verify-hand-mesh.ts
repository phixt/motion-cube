/**
 * verify-hand-mesh.ts — low-poly 手部网格生成器自检（npx tsx 运行，无 DOM）。
 * 检查：双手构建无 NaN、包围盒合理、左右镜像对称、接触锚点结构、
 * 绕向（掌前缘/指尖外法线朝 +Z）、顶点色存在且合法、极值造型参数不炸。
 * 第二批审计回归（REVIEW-2026-10 P0-6 / P0-7）：
 *  - 左右手**同一部件**法线外向度同号（左手放样件绕向翻转会变号）；
 *  - mirrorPose(右手姿态) 得到的左手拇指世界方向 = 右手拇指方向的 X 镜像。
 */
import { Box3, Quaternion, Vector3 } from "three";
import {
  createDefaultRig,
  defaultHandPose,
  mirrorPose,
  FINGER_ORDER,
  type HandType,
  type Pose,
} from "../src/hand/HandRig.ts";
import {
  createRigFromConfig,
  DEFAULT_HAND_CONFIG,
  normalizeHandRigConfig,
} from "../src/hand/handRigStore.ts";
import { buildHandMesh, type HandMeshResult } from "../src/hand/handMesh.ts";
import { checkHandCubeCollision, computeHandSegmentBoxes } from "../src/hand/handCollision.ts";

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

// ---- 4) 左右手同一部件「法线外向度」同号（REVIEW-2026-10 P0-6 回归） ----
/**
 * 面积加权法线外向度：O = Σ A·n̂·(面心 − 部件中心) / Σ A，部件中心取顶点均值。
 * 体积/管状件外法线朝外时 O>0；镜像手放样站序反转（x0>x1）导致绕向翻转时 O 变号，
 * 正是审计 P0-6 的症状（右手填充棱 +0.18 / 左手 −0.18）。用局部坐标即可：绕向是
 * 网格自身属性，与父节点变换无关。
 */
function partOutwardness(res: HandMeshResult, part: string): number | null {
  let found = false;
  let num = 0;
  let den = 0;
  res.root.traverse((o) => {
    const mesh = o as unknown as {
      isMesh?: boolean;
      userData?: { part?: string };
      geometry?: { getAttribute(n: string): { array: ArrayLike<number> } | undefined };
    };
    if (!mesh.isMesh || mesh.userData?.part !== part) return;
    const arr = mesh.geometry?.getAttribute("position")?.array;
    if (!arr || arr.length < 9) return;
    found = true;
    const n = arr.length / 3;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let i = 0; i < n; i++) {
      ox += arr[i * 3] / n;
      oy += arr[i * 3 + 1] / n;
      oz += arr[i * 3 + 2] / n;
    }
    for (let t = 0; t + 8 < arr.length; t += 9) {
      const ax = arr[t], ay = arr[t + 1], az = arr[t + 2];
      const bx = arr[t + 3], by = arr[t + 4], bz = arr[t + 5];
      const cx = arr[t + 6], cy = arr[t + 7], cz = arr[t + 8];
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-12) continue;
      const mx = (ax + bx + cx) / 3 - ox;
      const my = (ay + by + cy) / 3 - oy;
      const mz = (az + bz + cz) / 3 - oz;
      num += (len / 2) * ((nx * mx + ny * my + nz * mz) / len);
      den += len / 2;
    }
  });
  if (!found || den === 0) return null;
  return num / den;
}

function partsOf(res: HandMeshResult): string[] {
  const set = new Set<string>();
  res.root.traverse((o) => {
    const m = o as unknown as { isMesh?: boolean; userData?: { part?: string } };
    if (m.isMesh && m.userData?.part) set.add(m.userData.part);
  });
  return [...set].sort();
}

{
  const right = buildHandMesh(DEFAULT_HAND_CONFIG, createRigFromConfig(DEFAULT_HAND_CONFIG, "right"), 1);
  const left = buildHandMesh(DEFAULT_HAND_CONFIG, createRigFromConfig(DEFAULT_HAND_CONFIG, "left"), -1);
  const pr = partsOf(right);
  const pl = partsOf(left);
  expect(pr.join(",") === pl.join(","), `左右手部件集合应一致（右 ${pr.length} / 左 ${pl.length}）`);
  const H = DEFAULT_HAND_CONFIG.handScale;
  const detail: string[] = [];
  let compared = 0;
  for (const part of pr) {
    const or = partOutwardness(right, part);
    const ol = partOutwardness(left, part);
    expect(or !== null && ol !== null, `${part}: 应能计算法线外向度`);
    if (or === null || ol === null) continue;
    // 薄贴片（指腹/指背/指甲标记）在其自身中心两侧法线相抵，外向度≈0，不做符号判定
    if (Math.abs(or) < 0.004 * H) continue;
    compared++;
    detail.push(`${part}: 右=${or.toFixed(3)} 左=${ol.toFixed(3)}`);
    expect(
      or * ol > 0,
      `左右手同一部件法线外向度应同号（绕向一致）：${part} 右=${or.toFixed(3)} 左=${ol.toFixed(3)}`,
    );
  }
  expect(compared >= 10, `应比较到足量实体部件（实得 ${compared}）`);
  if (failed > 0) console.error(`  （外向度明细：${detail.join("；")}）`);
}

// ---- 5) mirrorPose → 左手拇指世界方向应为右手方向的 X 镜像（REVIEW-2026-10 P0-7 回归） ----
/**
 * 复刻 HandRigView.applyPose（src/hand/HandRigView.ts:132-158）的拇指变换链，用 three.js
 * 真实计算世界方向（不是只比原始参数）：
 *   root ← palm.transform 的 position/quaternion；
 *   thumbRoot ← thumbBase 的 position/quaternion，位置再加 thumbCorner×sideSign；
 *   thumbDof ← CMC 三轴：x=−elevation（Y 镜像不变）、y=+abduction×sideSign、z=−rotation×sideSign。
 * 取 thumbDof 的世界 +Z 作为拇指根方向（两侧同一算法；手掌 group 的均匀缩放不影响方向）。
 * ⚠ 与 applyPose 同步维护：上面这条顺序若改，本函数必须同步。
 */
const degToRad = (d: number) => (d * Math.PI) / 180;
function thumbWorldFrame(handType: HandType, pose: Pose): { dir: Vector3; quat: Quaternion } {
  const sideSign = handType === "right" ? 1 : -1;
  const H = DEFAULT_HAND_CONFIG.handScale;
  const res = buildHandMesh(
    DEFAULT_HAND_CONFIG,
    createRigFromConfig(DEFAULT_HAND_CONFIG, handType),
    sideSign,
    { withMarks: false, linearOutput: true },
  );
  const palm = pose.palm.transform;
  res.root.position.set(palm.position.x, palm.position.y, palm.position.z);
  res.root.quaternion.set(palm.quaternion.x, palm.quaternion.y, palm.quaternion.z, palm.quaternion.w);
  const tb = pose.palm.thumbBase;
  const tc = DEFAULT_HAND_CONFIG.thumbCorner;
  res.thumbRoot.position.set(
    tb.position.x + tc.x * H * sideSign,
    tb.position.y + tc.y * H,
    tb.position.z + tc.z * H,
  );
  res.thumbRoot.quaternion.set(tb.quaternion.x, tb.quaternion.y, tb.quaternion.z, tb.quaternion.w);
  res.thumbDof.rotation.set(
    degToRad(-pose.thumbCMC.elevation),
    degToRad(pose.thumbCMC.abduction * sideSign),
    degToRad(-pose.thumbCMC.rotation * sideSign),
  );
  res.thumbDof.updateWorldMatrix(true, false);
  return {
    dir: res.thumbDof.getWorldDirection(new Vector3()),
    quat: res.thumbDof.getWorldQuaternion(new Quaternion()),
  };
}

{
  const cmcPose = (): Pose => {
    const p = defaultHandPose("right");
    p.thumbCMC = { abduction: 25, elevation: 18, rotation: 40 };
    return p;
  };
  const cases: Array<{ name: string; pose: Pose }> = [
    { name: "编辑器默认手位", pose: defaultHandPose("right") },
    { name: "CMC 三轴非零", pose: cmcPose() },
  ];
  for (const { name, pose } of cases) {
    const rightFrame = thumbWorldFrame("right", pose);
    const leftFrame = thumbWorldFrame("left", mirrorPose(pose));
    const want = new Vector3(-rightFrame.dir.x, rightFrame.dir.y, rightFrame.dir.z);
    expect(Math.abs(rightFrame.dir.length() - 1) < 1e-9, `P0-7 ${name}: 右手拇指方向应为单位向量`);
    expect(Math.abs(leftFrame.dir.length() - 1) < 1e-9, `P0-7 ${name}: 左手拇指方向应为单位向量`);
    const dev = leftFrame.dir.distanceTo(want);
    expect(
      dev < 1e-3,
      `P0-7 ${name}: mirrorPose 后左手拇指世界方向应为右手方向的 X 镜像（偏差 ${dev.toFixed(4)}；左手 ${leftFrame.dir.toArray().map((v) => v.toFixed(3)).join(",")} vs 期望 ${want.toArray().map((v) => v.toFixed(3)).join(",")}）`,
    );
    // 整帧镜像（额外把「对掌自转」也纳入：绕自身长轴的旋转不改变 +Z 方向，单靠方向抓不到）：
    // 左手 CMC 世界朝向应 = Mx·右手朝向·Mx（Mx=diag(−1,1,1)，det=−1 → 轴取 −Mx·n，
    // 四元数即 negate y/z = mirrorPose 的取反形式），±q 同解。
    const qWant = new Quaternion(rightFrame.quat.x, -rightFrame.quat.y, -rightFrame.quat.z, rightFrame.quat.w); // 构造序 (x,y,z,w)
    const qDot = Math.abs(leftFrame.quat.dot(qWant));
    expect(
      qDot > 1 - 1e-6,
      `P0-7 ${name}: 左手 CMC 世界朝向应为右手朝向的 X 镜像（|cos 偏差|=${(1 - qDot).toExponential(2)}）`,
    );
  }
}

// ---- 6) Step 3A：shape.web 接入 / 拇指 IP 非空 / 退化 bases 防 NaN / 碰撞箱代理 ----
{
  const cfgWeb0 = { ...DEFAULT_HAND_CONFIG, shape: { ...DEFAULT_HAND_CONFIG.shape, web: 0 } };
  const cfgWeb1 = { ...DEFAULT_HAND_CONFIG, shape: { ...DEFAULT_HAND_CONFIG.shape, web: 1 } };
  const r0 = buildHandMesh(cfgWeb0, createRigFromConfig(cfgWeb0, "right"), 1);
  const r1 = buildHandMesh(cfgWeb1, createRigFromConfig(cfgWeb1, "right"), 1);
  noNaN(r0, "web=0");
  noNaN(r1, "web=1");
  const webMaxZ = (res: HandMeshResult): number => {
    let z = -Infinity;
    res.root.traverse((o) => {
      const m = o as unknown as { isMesh?: boolean; userData?: { part?: string }; geometry?: { getAttribute(n: string): { array: ArrayLike<number> } | undefined } };
      if (!m.isMesh || m.userData?.part !== "web-1") return;
      const arr = m.geometry?.getAttribute("position")?.array;
      if (!arr) return;
      for (let i = 2; i < arr.length; i += 3) if (arr[i] > z) z = arr[i];
    });
    return z;
  };
  expect(webMaxZ(r1) - webMaxZ(r0) > 0.2, `shape.web=1 应显著长于 web=0（实得 ${webMaxZ(r0).toFixed(3)} vs ${webMaxZ(r1).toFixed(3)}）`);
}

{
  // 拇指 IP 关节组非空：joints=[CMC, MCP, IP]，IP（joints[2]）挂载末节与指甲
  const res = buildHandMesh(DEFAULT_HAND_CONFIG, createRigFromConfig(DEFAULT_HAND_CONFIG, "right"), 1);
  const thumb = res.fingers.thumb;
  expect(thumb.joints.length === 3, `拇指应有 3 个关节组（实得 ${thumb.joints.length}）`);
  expect(thumb.joints[2].children.length > 0, "拇指 IP 关节组（joints[2]）不应为空");
  const ipParts: string[] = [];
  thumb.joints[2].traverse((o) => {
    const m = o as unknown as { isMesh?: boolean; userData?: { part?: string } };
    if (m.isMesh && m.userData?.part) ipParts.push(m.userData.part);
  });
  expect(ipParts.includes("thumb-seg1") && ipParts.includes("thumb-nail"), `拇指 IP 应包含末节与指甲（实得 ${ipParts.join(",")}）`);
}

{
  // 退化 bases：normalizeHandRigConfig 拦截重合并回退默认；直接喂进 buildHandMesh 也无 NaN
  const deg = structuredClone(DEFAULT_HAND_CONFIG);
  deg.bases.index.x = 0.2;
  deg.bases.middle.x = 0.2;
  const norm = normalizeHandRigConfig(deg);
  expect(norm !== null && norm.bases.index.x > norm.bases.middle.x, "退化 bases 应由 normalizeHandRigConfig 纠偏");
  const direct = buildHandMesh(deg, createRigFromConfig(deg, "right"), 1);
  noNaN(direct, "退化 bases 直接构建兜底");
}

{
  // 碰撞箱代理：默认贴面手位（x=1.95）掌体不穿透魔方；把掌心移到原点必然检出掌体穿透
  const res = buildHandMesh(DEFAULT_HAND_CONFIG, createRigFromConfig(DEFAULT_HAND_CONFIG, "right"), 1);
  const pose = defaultHandPose("right");
  const apply = (px: number, py: number, pz: number) => {
    res.root.position.set(px, py, pz);
    res.root.quaternion.set(
      pose.palm.transform.quaternion.x,
      pose.palm.transform.quaternion.y,
      pose.palm.transform.quaternion.z,
      pose.palm.transform.quaternion.w,
    );
  };
  apply(pose.palm.transform.position.x, pose.palm.transform.position.y, pose.palm.transform.position.z);
  const boxesRest = computeHandSegmentBoxes(res.root, res.fingers);
  expect(boxesRest.length === 15, `手部碰撞盒应含 1 掌 + 14 指段 = 15（实得 ${boxesRest.length}）`);
  const restPalmHit = checkHandCubeCollision(boxesRest, 1.5, 0.05).find((h) => h.part === "palm");
  expect(!restPalmHit, `默认贴面手位掌体不应穿透魔方（实得 ${JSON.stringify(restPalmHit)}）`);

  apply(0, 0, 0);
  const boxesInside = computeHandSegmentBoxes(res.root, res.fingers);
  const insideHits = checkHandCubeCollision(boxesInside, 1.5, 0);
  const insidePalm = insideHits.find((h) => h.part === "palm");
  expect(!!insidePalm && insidePalm.penetration > 0.3, `掌心在原点时应检出明显穿透（实得 ${JSON.stringify(insidePalm)}）`);
}

console.log(failed === 0 ? "verify-hand-mesh: ALL PASS ✓" : `verify-hand-mesh: ${failed} FAIL`);
if (failed > 0) process.exit(1);
