#!/usr/bin/env node
/**
 * gen-cuberoot-algs.mjs — 爬取 cuberoot.me 公式库并内置为 JSON。
 *
 * 数据源：https://api.cuberoot.me/v1/alg/sets/3x3/{set}（公开 API）
 * 集合：CFOP 的 2-look-oll/oll/2-look-pll/pll/f2l；Roux 的 2-look-cmll/cmll/eo4a/lse-eolr
 *
 * 处理流程：
 *  1. 取每 case 的候选公式（algs 组 + standard 字段），清洗 ↑/↓/· 等装饰字符
 *  2. 解析校验：cubing/alg 必须能解析（保证 TwistyPlayer 可播放）
 *  3. 语义校验：内置最小 3x3 引擎（54 贴纸 Uint8Array），对已解魔方施加
 *     setup+alg 并检查集合不变量（整块旋转无关）：
 *       - OLL / 2-look-oll  → 归一化后 U 面同色（顶面翻色完成）
 *       - PLL / 2-look-pll  → 归一化后六面同色（整块已还原）
 *       - CMLL / 2-look-cmll → 归一化后 4 个顶层角块归位
 *       - F2L               → 归一化后非顶层块全部归位
 *       - EO/LSE            → 仅解析校验（需要在部分还原语境下才有不变量）
 *  4. 主公式选择：优先 cuberoot 源、无单手(oh)标签的候选；否则任一验证通过者；
 *     再回退 standard 字段；全失败则丢弃该 case（报告）
 *  5. 输出 data/samples/cuberoot-algs.json
 *
 * 用法：node scripts/gen-cuberoot-algs.mjs [--fetch]
 *   （不带 --fetch 时读取缓存目录，便于离线迭代）
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Alg } from "cubing/alg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "samples", "cuberoot-algs.json");
const CACHE = process.env.CUBEROOT_CACHE || join(ROOT, ".cache", "cuberoot");

const SETS = [
  ["2-look-oll", "2-Look OLL", "cfop"],
  ["oll", "OLL", "cfop"],
  ["2-look-pll", "2-Look PLL", "cfop"],
  ["pll", "PLL", "cfop"],
  ["f2l", "F2L", "cfop"],
  ["zbll", "ZBLL", "cfop"],
  ["zbls", "ZBLS", "cfop"],
  ["2-look-cmll", "2-Look CMLL", "roux"],
  ["cmll", "CMLL", "roux"],
  ["eo4a", "LSE 棱朝向 (4a)", "roux"],
  ["lse-eolr", "LSE EOLR", "roux"],
];

/* ------------------------------------------------------------------ *
 *  最小 3x3 引擎（移植自 rubik-cube.html engine.js，仅状态/转动/块读取）
 * ------------------------------------------------------------------ */
const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const FACE_NORMAL = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], [-1, 0, 0], [0, 0, -1]];
const FACE_UP = [[0, 0, -1], [0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 1, 0], [0, 1, 0]];

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const veq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function faceOfNormal(n) {
  for (let f = 0; f < 6; f++) if (veq(FACE_NORMAL[f], n)) return f;
  return -1;
}
function stickerIndex(pos, n) {
  const f = faceOfNormal(n);
  const u = FACE_UP[f];
  const r = cross(u, FACE_NORMAL[f]);
  return f * 9 + (1 - dot(pos, u)) * 3 + (1 + dot(pos, r));
}
function rot(v, axis, amount) {
  let x = v[0], y = v[1], z = v[2];
  const n = ((amount % 4) + 4) % 4;
  for (let i = 0; i < n; i++) {
    if (axis === 0) { const ny = z, nz = -y; y = ny; z = nz; }
    else if (axis === 1) { const nx = -z, nz = x; x = nx; z = nz; }
    else { const nx = y, ny = -x; x = nx; y = ny; }
  }
  return [x, y, z];
}
function pos(name) {
  const p = [0, 0, 0];
  for (const ch of name) {
    const f = FACE_NAMES.indexOf(ch);
    const n = FACE_NORMAL[f];
    p[0] += n[0]; p[1] += n[1]; p[2] += n[2];
  }
  return p;
}
const posKey = (p) => (p[0] + 1) * 9 + (p[1] + 1) * 3 + (p[2] + 1);

const ALL_POS = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (x || y || z) ALL_POS.push([x, y, z]);
}
const CUBIES = ALL_POS.map((p) => {
  const stickers = [];
  for (let f = 0; f < 6; f++) {
    if (dot(p, FACE_NORMAL[f]) === 1) stickers.push({ face: f, index: stickerIndex(p, FACE_NORMAL[f]) });
  }
  const t = Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2]);
  return { p, stickers, type: t === 1 ? "center" : t === 2 ? "edge" : "corner" };
});
const STICKER_POS = new Array(54), STICKER_NORMAL = new Array(54);
for (const c of CUBIES) for (const s of c.stickers) { STICKER_POS[s.index] = c.p; STICKER_NORMAL[s.index] = FACE_NORMAL[s.face]; }

const EDGE_NAMES = ["UF", "UR", "UB", "UL", "DF", "DR", "DB", "DL", "FR", "FL", "BR", "BL"];
const CORNER_NAMES = ["UFR", "URB", "UBL", "ULF", "DRF", "DFL", "DLB", "DBR"];
const EDGE_POS = EDGE_NAMES.map(pos);
const CORNER_POS = CORNER_NAMES.map(pos);
const edgeSlot = {}; EDGE_POS.forEach((p, i) => { edgeSlot[posKey(p)] = i; });
const cornerSlot = {}; CORNER_POS.forEach((p, i) => { cornerSlot[posKey(p)] = i; });

const BASE = {
  U: { axis: 1, layers: [1], cw: 1 }, D: { axis: 1, layers: [-1], cw: -1 }, E: { axis: 1, layers: [0], cw: -1 },
  R: { axis: 0, layers: [1], cw: 1 }, L: { axis: 0, layers: [-1], cw: -1 }, M: { axis: 0, layers: [0], cw: -1 },
  F: { axis: 2, layers: [1], cw: 1 }, B: { axis: 2, layers: [-1], cw: -1 }, S: { axis: 2, layers: [0], cw: 1 },
  u: { axis: 1, layers: [0, 1], cw: 1 }, d: { axis: 1, layers: [-1, 0], cw: -1 },
  r: { axis: 0, layers: [0, 1], cw: 1 }, l: { axis: 0, layers: [-1, 0], cw: -1 },
  f: { axis: 2, layers: [0, 1], cw: 1 }, b: { axis: 2, layers: [-1, 0], cw: -1 },
  x: { axis: 0, layers: [-1, 0, 1], cw: 1 }, y: { axis: 1, layers: [-1, 0, 1], cw: 1 }, z: { axis: 2, layers: [-1, 0, 1], cw: 1 },
};
const ALIAS = { Uw: "u", Dw: "d", Rw: "r", Lw: "l", Fw: "f", Bw: "b", X: "x", Y: "y", Z: "z" };

const MOVES = {};
function buildMove(base, turns) {
  const b = BASE[base];
  const amount = ((b.cw * turns) % 4 + 4) % 4;
  const name = base + (turns === 1 ? "" : turns === 2 ? "2" : "'");
  const dest = new Uint8Array(54);
  for (let i = 0; i < 54; i++) {
    const p = STICKER_POS[i], n = STICKER_NORMAL[i];
    if (b.layers.includes(p[b.axis])) dest[i] = stickerIndex(rot(p, b.axis, amount), rot(n, b.axis, amount));
    else dest[i] = i;
  }
  const perm = new Uint8Array(54);
  for (let i = 0; i < 54; i++) perm[dest[i]] = i;
  MOVES[name] = { name, perm, inverse: base + (turns === 1 ? "'" : turns === 2 ? "2" : "") };
}
for (const base of Object.keys(BASE)) for (const t of [1, 2, 3]) buildMove(base, t);

const DECOR = /[·↑↓]/g;
// 后缀支持 [2345](')：L3 = 270° 顺 = L'、L3' = L、L4/L4' = 恒等、X5 = X（cubing 记法）
const moveRe = /([UDLRFBMESudlrfbxyzXYZ]w?|Uw|Dw|Rw|Lw|Fw|Bw)([2345])?('|’)?/g;
function cleanAlg(s) {
  return String(s ?? "")
    .replace(DECOR, "")
    .replace(/\[[^\]]*\]/g, "") // 剥 [U2] 等 AUF 标注
    .replace(/=/g, " ") // 剥 "=y' ..." 等价变体标记
    .replace(/[()]/g, " ");
}
/** 展开 cubing 重复记法 (A)N → A A ...；无数字后缀的 (A) → A。支持嵌套。 */
function expandRepeats(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/\(([^()]*)\)(\d+)?/g, (_, inner, n) => {
      const body = inner.trim();
      if (n) return Array(parseInt(n, 10)).fill(body).join(" ");
      return body;
    });
  } while (s !== prev);
  return s;
}
/** ZBLS 候选归一化：展开重复、剥标注/装饰/等价标记、压空格。保留 U2' 与 M'R' 等连写记法。 */
function normalizeZblsAlg(s) {
  return cleanAlg(expandRepeats(String(s ?? ""))).replace(/\s+/g, " ").trim();
}

// ---- ZBLL 变体生成（M2 左右镜像 + 逆；文献口径：R↔L'、L↔R'、F↔F'、B↔B'、U↔U'、D↔D'）----
const MIRROR = {
  R: "L'", "R'": "L", R2: "L2", "R2'": "L2'",
  L: "R'", "L'": "R", L2: "R2", "L2'": "R2'",
  F: "F'", "F'": "F", F2: "F2", "F2'": "F2'",
  B: "B'", "B'": "B", B2: "B2", "B2'": "B2'",
  U: "U'", "U'": "U", U2: "U2", "U2'": "U2'",
  D: "D'", "D'": "D", D2: "D2", "D2'": "D2'",
  r: "l'", "r'": "l", r2: "l2", "r2'": "l2'",
  l: "r'", "l'": "r", l2: "r2", "l2'": "r2'",
  M: "M'", "M'": "M", M2: "M2", "M2'": "M2'",
  E: "E'", "E'": "E", E2: "E2",
  S: "S'", "S'": "S", S2: "S2",
  u: "d'", "d'": "u", u2: "d2", "u2'": "d2'",
  d: "u'", "u'": "d", d2: "u2", "d2'": "u2'",
  f: "f'", "f'": "f", f2: "f2",
  b: "b'", "b'": "b", b2: "b2",
  x: "x'", "x'": "x", x2: "x2",
  y: "y'", "y'": "y", y2: "y2",
  z: "z'", "z'": "z", z2: "z2",
};
function mirrorAlg(moves) {
  return moves.map((m) => MIRROR[m] ?? m);
}
function invertAlg(moves) {
  return moves.slice().reverse().map((m) => MOVES[m].inverse);
}
/** ZBLL 变体（mirror/inverse/mir-inv）生成 + 校验（pureLL：施加到已解后非 LL 块全 home） */
function zblVariants(primary) {
  const moves = parseAlg(primary);
  const out = [];
  const seen = new Set();
  for (const [label, mv] of [
    ["mirror", mirrorAlg(moves)],
    ["inverse", invertAlg(moves)],
    ["mir-inv", mirrorAlg(invertAlg(moves))],
  ]) {
    const key = mv.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    let ok = false;
    try {
      new Alg(key);
      const st = applyAlg(solvedState(), key);
      ok = nonLLSolved(st);
    } catch { /* ignore */ }
    if (ok) out.push(key);
  }
  return out;
}
function parseAlg(s) {
  const out = [];
  const str = cleanAlg(s);
  let m;
  while ((m = moveRe.exec(str))) {
    let base = m[1];
    if (ALIAS[base]) base = ALIAS[base];
    if (base.length === 2 && base[1] === "w") base = ALIAS[base] || base[0].toLowerCase();
    if (!BASE[base]) throw new Error("unknown move: " + m[0]);
    const t = m[2] ? parseInt(m[2], 10) : 1; // 1..5 quarter turns
    const prime = !!m[3];
    const n = (((prime ? 4 - t : t) % 4) + 4) % 4; // 净 quarter turns（mod 4）
    if (n === 0) continue; // X4/X4' → 恒等，丢弃
    out.push(n === 1 ? base : n === 2 ? base + "2" : base + "'");
  }
  if (!out.length) throw new Error("empty alg: " + s);
  return out;
}
function solvedState() {
  const s = new Uint8Array(54);
  for (let i = 0; i < 54; i++) s[i] = (i / 9) | 0;
  return s;
}
function applyAlg(state, alg) {
  const moves = Array.isArray(alg) ? alg : parseAlg(alg);
  let s = state;
  for (const n of moves) {
    const p = MOVES[n].perm, out = new Uint8Array(54);
    for (let i = 0; i < 54; i++) out[i] = s[p[i]];
    s = out;
  }
  return s;
}
function cubieSolvedAt(state, p) {
  const c = CUBIES.find((c) => posKey(c.p) === posKey(p));
  for (const s of c.stickers) if (state[s.index] !== s.face) return false;
  return true;
}

// 24 种整块旋转（BFS 生成短 alg 表达）
const ROTATIONS = (() => {
  const seen = new Map(), out = [];
  const key = (s) => [0, 1, 2, 3, 4, 5].map((f) => s[f * 9 + 4]).join(",");
  let frontier = [{ alg: [], state: solvedState() }];
  seen.set(key(frontier[0].state), true);
  out.push({ alg: [], state: frontier[0].state });
  while (frontier.length && out.length < 24) {
    const next = [];
    for (const node of frontier) {
      for (const mv of ["x", "x'", "x2", "y", "y'", "y2", "z", "z'", "z2"]) {
        const st = applyAlg(node.state, mv), k = key(st);
        if (seen.has(k)) continue;
        seen.set(k, true);
        const rec = { alg: node.alg.concat([mv]), state: st };
        out.push(rec);
        next.push(rec);
      }
    }
    frontier = next;
  }
  return out;
})();

/** 把中心转回原位（整块旋转无关的归一化）；找不到返回 null */
function normalizeOrientation(state) {
  for (const r of ROTATIONS) {
    const s = applyAlg(state, r.alg);
    let ok = true;
    for (let f = 0; f < 6; f++) if (s[f * 9 + 4] !== f) { ok = false; break; }
    if (ok) return s;
  }
  return null;
}

const LL = {
  corners: ["UFR", "URB", "UBL", "ULF"],
  edges: ["UF", "UR", "UB", "UL"],
};
/** LL 棱是否已定向（U 面贴纸为 U/D 色） */
function llEdgeOriented(s, name) {
  const idx = stickerIndex(pos(name), FACE_NORMAL[0]);
  return s[idx] === 0 || s[idx] === 3;
}
function isTopUniform(s) {
  const c = s[4];
  for (let k = 0; k < 9; k++) if (s[k] !== c) return false;
  return true;
}
function isUniform(s) {
  for (let f = 0; f < 6; f++) { const c = s[f * 9 + 4]; for (let k = 0; k < 9; k++) if (s[f * 9 + k] !== c) return false; }
  return true;
}
function cornersSolved(s) {
  return LL.corners.every((n) => cubieSolvedAt(s, pos(n)));
}
function nonLLSolved(s) {
  for (const c of CUBIES) {
    const isLL = c.p[1] === 1 && c.type !== "center";
    if (!isLL && !cubieSolvedAt(s, c.p)) return false;
  }
  return true;
}

/** 对已解魔方施加 setup+alg，按集合类型检查不变量（整块旋转无关） */
const INVARIANTS = {
  "2-look-oll": (s) => isTopUniform(s),
  oll: (s) => isTopUniform(s),
  "2-look-pll": (s) => isUniform(s),
  pll: (s) => isUniform(s),
  zbll: (s) => nonLLSolved(s) && LL.edges.every((n) => llEdgeOriented(s, n)),
  zbls: (s) => nonLLSolved(s) && LL.edges.every((n) => llEdgeOriented(s, n)),
  "2-look-cmll": (s) => cornersSolved(s),
  cmll: (s) => cornersSolved(s),
  f2l: (s) => nonLLSolved(s),
  // EO/LSE 无解析后不变量（需部分还原语境），仅解析校验
};
function checkInvariant(setSlug, setup, alg) {
  const fn = INVARIANTS[setSlug];
  if (!fn) return true;
  let s = applyAlg(solvedState(), cleanAlg(setup) + " " + cleanAlg(alg));
  s = normalizeOrientation(s);
  if (!s) return false;
  return fn(s);
}

/* ------------------------------------------------------------------ *
 *  爬取 / 读取 + 清洗 + 校验
 * ------------------------------------------------------------------ */
async function fetchSet(slug) {
  const cacheFile = join(CACHE, `${slug}.json`);
  if (existsSync(cacheFile) && !process.argv.includes("--fetch")) {
    return JSON.parse(readFileSync(cacheFile, "utf8"));
  }
  const url = `https://api.cuberoot.me/v1/alg/sets/3x3/${slug}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
  const data = await res.json();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(data));
  return data;
}

function candidateAlgs(c) {
  const list = [];
  const seen = new Set();
  const push = (alg, source, tags) => {
    if (!alg) return;
    const key = cleanAlg(alg).replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    list.push({ raw: alg, key, source: source || "", oh: (tags || []).includes("oh") });
  };
  for (const group of c.algs || []) {
    for (const a of group) push(a.alg, a.source, a.tags);
  }
  if (c.standard) push(c.standard, "standard");
  return list;
}

function pick(cands, validSet) {
  const ok = cands.filter((c) => validSet.has(c.key));
  if (!ok.length) return null;
  const prio = (c) => {
    const src = c.source;
    let p = 2; // 无 source（standard 或未知）最低
    if (src === "cuberoot") p = 0;
    else if (src === "cubingapp") p = 1;
    else if (src === "speedcubedb") p = 1;
    else if (src === "standard") p = 2;
    return p * 2 + (c.oh ? 1 : 0);
  };
  ok.sort((a, b) => prio(a) - prio(b) || a.key.length - b.key.length);
  const prim = ok[0];
  const alts = ok.slice(1).filter((c) => !c.oh).slice(0, 3).map((c) => c.key);
  return { primary: prim.key, alts };
}

async function main() {
  const setsOut = {};
  const stats = { total: 0, ok: 0, dropped: 0 };
  let fetchedAt = null;

  for (const [slug, label, group] of SETS) {
    const data = await fetchSet(slug);
    fetchedAt = data.scrapedAt;
    const cases = [];
    for (const c of data.cases) {
      stats.total++;
      // ZBLS：保留 4 组（槽位方向）候选的全部有效公式；不能只取每组第一条（29 条需选 alts）
      if (slug === "zbls") {
        const groups = [];
        let anyValid = false;
        const setupKey = normalizeZblsAlg(c.setup);
        // 4 组候选 = 同一 case 的 4 个槽位方向变体（cuberoot 手动 R→F→L→B 旋转）。
        // invariant 只对「setup 匹配的槽位」（组 0 形态）闭环；其余组在求解时按槽位实时验证。
        // 因此：全部组全部候选（cubing 可播放 + 可解析）落库；anyValid 用组 0 闭环判定 case 合法。
        for (const group of c.algs || []) {
          const seen = new Set();
          const valid = [];
          for (const a of group) {
            const key = normalizeZblsAlg(a.alg);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            let cubingOk = false;
            try { new Alg(parseAlg(key).join(" ")); cubingOk = true; } catch { /* ignore */ }
            if (!cubingOk) continue;
            valid.push(key);
            try { if (checkInvariant(slug, setupKey, key)) anyValid = true; } catch { /* ignore */ }
          }
          if (valid.length) groups.push(valid);
        }
        if (!anyValid) {
          stats.dropped++;
          console.warn(`[drop] ${slug}/${c.name}: no valid alg (${setupKey || "(no setup)"})`);
          continue;
        }
        stats.ok++;
        cases.push({
          id: c.id,
          name: c.name,
          subgroup: c.subgroup || null,
          setup: setupKey || null,
          mirrorCaseId: c.mirrorCaseId || null,
          algs: groups,
        });
        continue;
      }
      const cands = candidateAlgs(c);
      // 解析校验（cubing/alg）——保证 TwistyPlayer 可播放；用 parseAlg 规范化（L3/L4/U2' 记法）
      const validSet = new Set();
      for (const cand of cands) {
        let cubingOk = false;
        try { new Alg(parseAlg(cand.key).join(" ")); cubingOk = true; } catch { /* ignore */ }
        let engineOk = false;
        try { engineOk = checkInvariant(slug, c.setup, cand.key); } catch { /* ignore */ }
        if (cubingOk && engineOk) validSet.add(cand.key);
      }
      const picked = pick(cands, validSet);
      if (!picked) {
        stats.dropped++;
        console.warn(`[drop] ${slug}/${c.name}: no valid alg (${c.setup || "(no setup)"})`);
        continue;
      }
      stats.ok++;
      cases.push({
        id: c.id,
        name: c.name,
        subgroup: c.subgroup || null,
        setup: cleanAlg(c.setup).replace(/\s+/g, " ").trim() || null,
        alg: picked.primary,
        alts: picked.alts,
        variants: zblVariants(picked.primary),
      });
    }
    setsOut[slug] = { label, group, cases };
  }

  const out = {
    version: 1,
    source: "https://cuberoot.me/zh/alg/3x3 (api.cuberoot.me/v1/alg/sets)",
    fetchedAt,
    sets: setsOut,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\nwritten ${OUT}`);
  console.log(JSON.stringify({ total: stats.total, ok: stats.ok, dropped: stats.dropped }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });