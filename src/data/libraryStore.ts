/** 公式库/手法库的持久化与导入导出（localStorage + JSON）。 */
import { Category, CategoryError, MAX_CATEGORY_NAME_LENGTH, removeCategory as removeCategoryNode, validateCategoryTree } from "./category";
import { deserializeFormula, parseFormulaEntries, type Formula } from "./formula";
import { deserializeTechnique, type Technique } from "./technique";

export type LibraryData = {
  version: 1;
  categories: Category[];
  formulas: Formula[];
  techniques: Technique[];
};

export const EMPTY_LIBRARY: LibraryData = { version: 1, categories: [], formulas: [], techniques: [] };

const KEY = "motion-cube.library";

export function loadLibrary(): LibraryData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY_LIBRARY;
    return deserializeLibraryData(raw);
  } catch {
    return EMPTY_LIBRARY;
  }
}

export function saveLibrary(data: LibraryData): void {
  localStorage.setItem(KEY, serializeLibraryData(data));
}

export function serializeLibraryData(data: LibraryData): string {
  return JSON.stringify(data, null, 2);
}

/** 解析库 JSON：{ version, formulas?, techniques? }；任一条目非法则抛错 */
export function deserializeLibraryData(text: string): LibraryData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("JSON 解析失败");
  }
  const obj = raw as { categories?: unknown; formulas?: unknown; techniques?: unknown } | null;
  if (!obj || typeof obj !== "object") throw new Error("结构非法");
  const categories: Category[] = [];
  if (obj.categories !== undefined) {
    if (!Array.isArray(obj.categories)) throw new Error("categories 必须为数组");
    for (const item of obj.categories) {
      const c = item as Record<string, unknown> | null;
      if (!c || typeof c !== "object" || typeof c.id !== "string" || typeof c.name !== "string") {
        throw new Error("分类条目非法");
      }
      if (c.name.length > MAX_CATEGORY_NAME_LENGTH) {
        throw new Error(`分类名过长（最多 ${MAX_CATEGORY_NAME_LENGTH} 字符）：${c.name.slice(0, 32)}…`);
      }
      if (c.parentId !== null && typeof c.parentId !== "string") throw new Error("分类 parentId 非法");
      categories.push({ id: c.id, name: c.name, parentId: (c.parentId as string | null) ?? null });
    }
    try {
      validateCategoryTree(categories);
    } catch (e) {
      throw new Error(e instanceof CategoryError ? e.message : String(e));
    }
  }
  const formulas = parseFormulaEntries(Array.isArray(obj.formulas) ? obj.formulas : []);
  const techniques: Technique[] = [];
  if (obj.techniques !== undefined) {
    if (!Array.isArray(obj.techniques)) throw new Error("techniques 必须为数组");
    for (const item of obj.techniques) {
      techniques.push(deserializeTechnique(JSON.stringify(item)));
    }
  }
  return { version: 1, categories, formulas, techniques };
}

/** 兼容旧的"仅公式"格式：{ formulas: [...] } */
export function deserializeFormulasOnly(text: string): LibraryData {
  const lib = deserializeFormula(text);
  return { version: 1, categories: [], formulas: lib.formulas, techniques: [] };
}

/** 按 id 合并（incoming 覆盖同名条目） */
export function mergeLibrary(base: LibraryData, incoming: LibraryData): LibraryData {
  const cById = new Map(base.categories.map((c) => [c.id, c]));
  for (const c of incoming.categories) cById.set(c.id, c);
  const fById = new Map(base.formulas.map((f) => [f.id, f]));
  for (const f of incoming.formulas) fById.set(f.id, f);
  const tById = new Map(base.techniques.map((t) => [t.id, t]));
  for (const t of incoming.techniques) tById.set(t.id, t);
  return {
    version: 1,
    categories: [...cById.values()],
    formulas: [...fById.values()],
    techniques: [...tById.values()],
  };
}

export function upsertFormulaInLib(data: LibraryData, formula: Formula): LibraryData {
  const idx = data.formulas.findIndex((f) => f.id === formula.id);
  const formulas = [...data.formulas];
  if (idx >= 0) formulas[idx] = formula;
  else formulas.push(formula);
  return { ...data, formulas };
}

export function removeFormulaFromLib(data: LibraryData, id: string): LibraryData {
  // 手法不能单独存在：删除公式连带删除其手法
  return {
    ...data,
    formulas: data.formulas.filter((f) => f.id !== id),
    techniques: data.techniques.filter((t) => t.formulaId !== id),
  };
}

export function removeTechniqueFromLib(data: LibraryData, id: string): LibraryData {
  return { ...data, techniques: data.techniques.filter((t) => t.id !== id) };
}

export function upsertTechniqueInLib(data: LibraryData, technique: Technique): LibraryData {
  const idx = data.techniques.findIndex((t) => t.id === technique.id);
  const techniques = [...data.techniques];
  if (idx >= 0) techniques[idx] = technique;
  else techniques.push(technique);
  return { ...data, techniques };
}

/** 删除分类：子分类上提一层，并从所有公式的 categoryIds 中移除 */
export function removeCategoryFromLib(data: LibraryData, categoryId: string): LibraryData {
  const categories = removeCategoryNode(categoryId, data.categories);
  const formulas = data.formulas.map((f) =>
    f.categoryId === categoryId ? { ...f, categoryId: null } : f,
  );
  return { ...data, categories, formulas };
}
