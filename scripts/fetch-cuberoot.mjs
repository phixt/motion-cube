// 从 cuberoot.me 拉取复盘参考数据（公开 API，来源 https://cuberoot.me/zh/recon）。
// 沙箱内 TLS 受限时用提权通道运行：
//   node scripts/fetch-cuberoot.mjs
// 产物：data/samples/cuberoot-recons.json（精选 3x3 复盘，含分步解法）
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "data/samples";
mkdirSync(OUT_DIR, { recursive: true });

const API = "https://api.cuberoot.me/v1";

function fetchJson(url) {
  const raw = execFileSync("curl.exe", ["-sS", "-L", url, "--connect-timeout", "15"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

// 精选样例：3 条 CFOP + 2 条 Roux + 1 条 ZB（均为高亮/代表性复盘）
const CURATED = [
  { id: 2542, why: "CFOP PR（sub-10 首进）" },
  { id: 2540, why: "CFOP 7.08s，41STM" },
  { id: 2538, why: "CFOP LL Skip，34STM" },
  { id: 1542, why: "Roux 5.01s，49STM（Villanueva）" },
  { id: 1541, why: "Roux 5.81s，51STM" },
  { id: 2469, why: "ZB（ZZ+ZBLL）5.02s" },
];

const list = fetchJson(`${API}/recon/list`);
const metaById = new Map(list.filter((r) => r.event === "3x3").map((r) => [r.id, r]));

const recons = [];
for (const { id, why } of CURATED) {
  const d = fetchJson(`${API}/recon/${id}`);
  const meta = metaById.get(id);
  recons.push({
    id: d.id,
    source: `https://cuberoot.me/zh/recon/${d.id}`,
    event: d.event,
    method: d.method,
    person: d.person,
    date: d.date,
    comp: d.comp,
    rawTime: d.rawTime,
    average: d.average,
    stm: d.stm,
    tps: d.tps,
    scramble: d.optimalScramble ?? meta?.optimalScramble ?? null,
    oll: d.oll ?? null,
    pll: d.pll ?? null,
    note: d.note ?? null,
    why,
    solution: d.solution,
  });
}

const payload = {
  version: 1,
  source: "https://cuberoot.me/zh/recon（api.cuberoot.me/v1/recon/list 与 /v1/recon/{id}）",
  fetchedAt: new Date().toISOString().slice(0, 10),
  recons,
};
const out = join(OUT_DIR, "cuberoot-recons.json");
writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
console.log(`written: ${out}（${recons.length} 条复盘）`);
