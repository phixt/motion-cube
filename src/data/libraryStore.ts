/** 公式库/手法库的持久化与导入导出（localStorage + JSON）。 */
import { deserializeFormula, parseFormulaEntries, type Formula } from "./formula";
import { deserializeTechnique, type Technique } from "./technique";

export type LibraryData = {
  version: 1;
  formulas: Formula[];
  techniques: Technique[];
};

export const EMPTY_LIBRARY: LibraryData = { version: 1, formulas: [], techniques: [] };

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
  const obj = raw as { formulas?: unknown; techniques?: unknown } | null;
  if (!obj || typeof obj !== "object") throw new Error("结构非法");
  const formulas = parseFormulaEntries(Array.isArray(obj.formulas) ? obj.formulas : []);
  const techniques: Technique[] = [];
  if (obj.techniques !== undefined) {
    if (!Array.isArray(obj.techniques)) throw new Error("techniques 必须为数组");
    for (const item of obj.techniques) {
      techniques.push(deserializeTechnique(JSON.stringify(item)));
    }
  }
  return { version: 1, formulas, techniques };
}

/** 兼容旧的"仅公式"格式：{ formulas: [...] } */
export function deserializeFormulasOnly(text: string): LibraryData {
  const lib = deserializeFormula(text);
  return { version: 1, formulas: lib.formulas, techniques: [] };
}

/** 按 id 合并（incoming 覆盖同名条目） */
export function mergeLibrary(base: LibraryData, incoming: LibraryData): LibraryData {
  const fById = new Map(base.formulas.map((f) => [f.id, f]));
  for (const f of incoming.formulas) fById.set(f.id, f);
  const tById = new Map(base.techniques.map((t) => [t.id, t]));
  for (const t of incoming.techniques) tById.set(t.id, t);
  return { version: 1, formulas: [...fById.values()], techniques: [...tById.values()] };
}

export function upsertFormulaInLib(data: LibraryData, formula: Formula): LibraryData {
  const idx = data.formulas.findIndex((f) => f.id === formula.id);
  const formulas = [...data.formulas];
  if (idx >= 0) formulas[idx] = formula;
  else formulas.push(formula);
  return { ...data, formulas };
}

export function removeFormulaFromLib(data: LibraryData, id: string): LibraryData {
  return { ...data, formulas: data.formulas.filter((f) => f.id !== id) };
}

export function removeTechniqueFromLib(data: LibraryData, id: string): LibraryData {
  return { ...data, techniques: data.techniques.filter((t) => t.id !== id) };
}
