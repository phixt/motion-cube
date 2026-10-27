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

/** 被跳过的坏条目：index 为所在数组下标（categories / formulas / techniques 各自计） */
export type LibraryRejectedEntry = { index: number; reason: string };

/** 库加载结果：error 非 null 表示整包不可读（此时 data 为空库，调用方必须提示并禁止写回） */
export type LibraryLoadResult = {
  data: LibraryData;
  error: string | null;
  rejected: LibraryRejectedEntry[];
};

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const emptyLibrary = (): LibraryData => ({ version: 1, categories: [], formulas: [], techniques: [] });

/** 读取本地库：坏条目逐条跳过（记入 rejected），整包不可读才返回 error —— 绝不静默清库。
 * 调用方拿到 error 非 null 时必须显式提示，并且【禁止】把该 data 写回（否则永久丢数据）。 */
export function loadLibrary(): LibraryLoadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    return { data: emptyLibrary(), error: `读取本地存储失败：${reasonOf(e)}`, rejected: [] };
  }
  if (!raw) return { data: emptyLibrary(), error: null, rejected: [] };
  return parseLibraryDataTolerant(raw);
}

export function saveLibrary(data: LibraryData): void {
  localStorage.setItem(KEY, serializeLibraryData(data));
}

export function serializeLibraryData(data: LibraryData): string {
  return JSON.stringify(data, null, 2);
}

/** 解析库 JSON：{ version, categories?, formulas?, techniques? }；任一条目非法则抛错（严格口径，导入/合并用） */
export function deserializeLibraryData(text: string): LibraryData {
  const r = parseLibraryDataTolerant(text);
  if (r.error) throw new Error(r.error);
  if (r.rejected.length > 0) {
    const { index, reason } = r.rejected[0];
    const more = r.rejected.length > 1 ? `（共 ${r.rejected.length} 条）` : "";
    throw new Error(`库中存在非法条目${more}：第 ${index + 1} 条 ${reason}`);
  }
  return r.data;
}

function parseCategoryEntry(item: unknown): Category {
  const c = item as Record<string, unknown> | null;
  if (!c || typeof c !== "object" || typeof c.id !== "string" || typeof c.name !== "string") {
    throw new Error("分类条目非法");
  }
  if (c.name.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new Error(`分类名过长（最多 ${MAX_CATEGORY_NAME_LENGTH} 字符）：${c.name.slice(0, 32)}…`);
  }
  if (c.parentId !== null && typeof c.parentId !== "string") throw new Error("分类 parentId 非法");
  return { id: c.id, name: c.name, parentId: (c.parentId as string | null) ?? null };
}

/** 容错解析（P0-8）：逐条 try/catch，坏的跳过并记入 rejected，好的保留；
 * error 仅在【整包不可读】时非 null（JSON 损坏 / 顶层结构非法 / 数组字段类型非法 /
 * 分类树校验失败），此时 data 为空库——调用方必须提示，禁止把空库写回。 */
export function parseLibraryDataTolerant(text: string): LibraryLoadResult {
  const failed = (message: string, rejected: LibraryRejectedEntry[] = []): LibraryLoadResult => ({
    data: emptyLibrary(),
    error: message,
    rejected,
  });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return failed(`JSON 解析失败：${reasonOf(e)}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return failed("结构非法：库必须为对象");
  const obj = raw as { categories?: unknown; formulas?: unknown; techniques?: unknown };
  const rejected: LibraryRejectedEntry[] = [];

  const categories: Category[] = [];
  if (obj.categories !== undefined) {
    if (!Array.isArray(obj.categories)) return failed("categories 必须为数组");
    obj.categories.forEach((item, index) => {
      try {
        categories.push(parseCategoryEntry(item));
      } catch (e) {
        rejected.push({ index, reason: `分类：${reasonOf(e)}` });
      }
    });
    try {
      validateCategoryTree(categories);
    } catch (e) {
      // 分类树坏了保留会出孤儿/环：整包按不可读处理（调用方必须提示）
      return failed(`分类树非法：${e instanceof CategoryError ? e.message : reasonOf(e)}`, rejected);
    }
  }

  const formulas: Formula[] = [];
  if (obj.formulas !== undefined) {
    if (!Array.isArray(obj.formulas)) return failed("formulas 必须为数组");
    obj.formulas.forEach((item, index) => {
      try {
        formulas.push(...parseFormulaEntries([item]));
      } catch (e) {
        rejected.push({ index, reason: `公式：${reasonOf(e)}` });
      }
    });
  }

  const techniques: Technique[] = [];
  if (obj.techniques !== undefined) {
    if (!Array.isArray(obj.techniques)) return failed("techniques 必须为数组");
    obj.techniques.forEach((item, index) => {
      try {
        techniques.push(deserializeTechnique(JSON.stringify(item)));
      } catch (e) {
        rejected.push({ index, reason: `手法：${reasonOf(e)}` });
      }
    });
  }
  return { data: { version: 1, categories, formulas, techniques }, error: null, rejected };
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
