/**
 * 内置公式库：由 scripts/gen-cuberoot-algs.mjs 生成的 cuberoot-algs.json 驱动。
 * 数据已做解析/语义校验；这里转成 FormulaLibrary 结构（分类 + 公式）供“加载内置公式库”合并。
 * 原始数据（setup、备选公式、sticker 识别信息）保留在 JSON 中，供后续练习/求解功能消费。
 */
import cuberootJson from "../../data/samples/cuberoot-algs.json";
import { normalizeMoves, validateFormulaMoves } from "../notation/alg";
import type { Category } from "./category";
import type { Formula } from "./formula";
import type { LibraryData } from "./libraryStore";

type CuberootCase = { id: number; name: string; subgroup: string | null; setup: string | null; alg: string; alts: string[] };
type CuberootSet = { label: string; group: "cfop" | "roux"; cases: CuberootCase[] };
type CuberootLibrary = { version: 1; source: string; fetchedAt: string; sets: Record<string, CuberootSet> };

const RAW = cuberootJson as CuberootLibrary;

const GROUP_TAG: Record<string, string> = { cfop: "CFOP", roux: "Roux" };

/** 集合 → 分类（复用示例库已有分类 id：cat-oll/cat-pll/cat-cmll） */
const CAT_MAP: Record<string, { id: string; name: string }> = {
  "2-look-oll": { id: "cat-2look-oll", name: "2-Look OLL" },
  oll: { id: "cat-oll", name: "OLL" },
  "2-look-pll": { id: "cat-2look-pll", name: "2-Look PLL" },
  pll: { id: "cat-pll", name: "PLL" },
  f2l: { id: "cat-f2l", name: "F2L" },
  "2-look-cmll": { id: "cat-2look-cmll", name: "2-Look CMLL" },
  cmll: { id: "cat-cmll", name: "CMLL" },
  eo4a: { id: "cat-lse", name: "LSE" },
  "lse-eolr": { id: "cat-lse", name: "LSE" },
};

function buildCategories(): Category[] {
  const seen = new Map<string, Category>();
  for (const slug of Object.keys(RAW.sets)) {
    const cat = CAT_MAP[slug];
    if (!cat || seen.has(cat.id)) continue;
    seen.set(cat.id, { id: cat.id, name: cat.name, parentId: null });
  }
  return [...seen.values()];
}

function buildFormulas(): Formula[] {
  const formulas: Formula[] = [];
  for (const [slug, set] of Object.entries(RAW.sets)) {
    const cat = CAT_MAP[slug];
    const tag = GROUP_TAG[set.group];
    for (const c of set.cases) {
      if (validateFormulaMoves(c.alg)) continue; // 生成脚本已校验，这里仅防御
      formulas.push({
        id: `cr-${c.id}`,
        name: c.name,
        moves: normalizeMoves(c.alg),
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

export const BUILTIN_LIBRARY_STATS = {
  formulas: BUILTIN_LIBRARY.formulas.length,
  categories: BUILTIN_LIBRARY.categories.length,
  sets: Object.keys(RAW.sets).length,
  fetchedAt: RAW.fetchedAt,
  source: RAW.source,
};