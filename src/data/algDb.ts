/**
 * 内置公式库：由 scripts/gen-cuberoot-algs.mjs 生成的 cuberoot-algs.json 驱动。
 * 数据已做解析/语义校验；这里转成 FormulaLibrary 结构（分类 + 公式）供“加载内置公式库”合并。
 * 原始数据（setup、备选公式、sticker 识别信息）保留在 JSON 中，供后续练习/求解功能消费。
 */
import cuberootJson from "../../data/samples/cuberoot-algs.json";
import { normalizeMoves, splitMoveTokens, validateFormulaMoves } from "../notation/alg";
import type { Category } from "./category";
import type { Formula } from "./formula";
import type { LibraryData } from "./libraryStore";

type CuberootCase = {
  id: number; name: string; subgroup: string | null; setup: string | null;
  alg?: string; alts?: string[]; mirrorCaseId?: number;
  /** ZBLS 专用：4 组槽位方向候选（求解器消费，不进用户公式库） */
  algs?: string[][];
};
type CuberootSet = { label: string; group: "cfop" | "roux"; cases: CuberootCase[] };
type CuberootLibrary = { version: 1; source: string; fetchedAt: string; sets: Record<string, CuberootSet> };

const RAW = cuberootJson as CuberootLibrary;

const GROUP_TAG: Record<string, string> = { cfop: "CFOP", roux: "Roux" };

/**
 * 集合 → 分类（复用示例库已有分类 id：cat-oll/cat-pll/cat-cmll/cat-zbll）。
 * zbll ⊆ 1LLL（示例库口径：cat-zbll 的父分类是 cat-1lll）——父分类必须随之内置，
 * 否则悬空 parentId 会让 validateCategoryTree 抛错、整库加载失败。
 */
const CAT_MAP: Record<string, { id: string; name: string; parentId?: string }> = {
  "2-look-oll": { id: "cat-2look-oll", name: "2-Look OLL" },
  oll: { id: "cat-oll", name: "OLL" },
  "2-look-pll": { id: "cat-2look-pll", name: "2-Look PLL" },
  pll: { id: "cat-pll", name: "PLL" },
  f2l: { id: "cat-f2l", name: "F2L" },
  zbll: { id: "cat-zbll", name: "ZBLL", parentId: "cat-1lll" },
  "2-look-cmll": { id: "cat-2look-cmll", name: "2-Look CMLL" },
  cmll: { id: "cat-cmll", name: "CMLL" },
  eo4a: { id: "cat-lse", name: "LSE" },
  "lse-eolr": { id: "cat-lse", name: "LSE" },
};

/** CAT_MAP 里被引用为父分类的节点（保证内置库自身分类树完整） */
const CAT_PARENTS: Record<string, { id: string; name: string }> = {
  "cat-1lll": { id: "cat-1lll", name: "1LLL" },
};

/** 内置库里被拒绝的条目（记法非法）——供 UI 提示，不静默丢弃 */
export type BuiltinRejected = { id: number; name: string; alg: string; error: string };
const REJECTED: BuiltinRejected[] = [];

function buildCategories(): Category[] {
  const seen = new Map<string, Category>();
  const add = (id: string, name: string, parentId: string | null): void => {
    if (seen.has(id)) return;
    const parent = parentId ? CAT_PARENTS[parentId] : undefined;
    if (parent) add(parent.id, parent.name, null);
    seen.set(id, { id, name, parentId });
  };
  for (const slug of Object.keys(RAW.sets)) {
    const cat = CAT_MAP[slug];
    if (!cat) continue;
    add(cat.id, cat.name, cat.parentId ?? null);
  }
  return [...seen.values()];
}

/**
 * 内置库单条公式的记法解析。
 * 优先严格解析；失败时容错拆分「连写缺空格」（cuberoot 抓取数据的已知格式问题，
 * 如 "R'L' B RL"、"R2'u'"）——容错结果仍须通过 cubing 的严格校验才接受。
 * 注意：这里必须校验**最终要存的那一份串**（历史上校验的是原始串、存的是规范化串，
 * 导致 713 条里 50 条被静默丢弃）。
 */
function parseBuiltinAlg(raw: string): { moves: string } | { error: string } {
  const strictErr = validateFormulaMoves(raw);
  if (!strictErr) return { moves: normalizeMoves(raw) };
  const tolerant = splitMoveTokens(raw);
  if (tolerant) {
    const err = validateFormulaMoves(tolerant);
    if (!err) return { moves: normalizeMoves(tolerant) };
    return { error: err };
  }
  return { error: strictErr };
}

function buildFormulas(): Formula[] {
  const formulas: Formula[] = [];
  REJECTED.length = 0;
  for (const [slug, set] of Object.entries(RAW.sets)) {
    const cat = CAT_MAP[slug];
    const tag = GROUP_TAG[set.group];
    for (const c of set.cases) {
      if (!c.alg) continue; // zbls 等求解器专用 set 不进用户公式库
      const parsed = parseBuiltinAlg(c.alg);
      if ("error" in parsed) {
        REJECTED.push({ id: c.id, name: c.name, alg: c.alg, error: parsed.error });
        continue;
      }
      formulas.push({
        id: `cr-${c.id}`,
        name: c.name,
        moves: parsed.moves,
        tags: tag ? [tag] : [],
        categoryId: cat?.id ?? null,
      });
    }
  }
  return formulas;
}

export const BUILTIN_LIBRARY: LibraryData = {
  version: 1,
  categories: buildCategories(),
  formulas: buildFormulas(),
  techniques: [],
};

/** 被拒绝的条目（记法非法）——UI 应显式提示跳过数，不静默丢弃 */
export const BUILTIN_LIBRARY_REJECTED: readonly BuiltinRejected[] = REJECTED;

export const BUILTIN_LIBRARY_STATS = {
  formulas: BUILTIN_LIBRARY.formulas.length,
  categories: BUILTIN_LIBRARY.categories.length,
  sets: Object.keys(RAW.sets).length,
  rejected: REJECTED.length,
  fetchedAt: RAW.fetchedAt,
  source: RAW.source,
};
