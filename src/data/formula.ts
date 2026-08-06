/**
 * 公式库模型（docs/formula.md、docs/params.md）。
 * 只存公式本身（标准 R L 记法），不存速度/手法；与手法库通过 formulaId 弱关联。
 */
import { normalizeMoves, validateFormulaMoves } from "../notation/alg";

export type Formula = {
  id: string;
  name: string;
  /** 标准 WCA/SiGN 记法（规范化后） */
  moves: string;
  tags: string[];
};

export type FormulaLibrary = {
  version: 1;
  formulas: Formula[];
};

export class FormulaError extends Error {}

export type NewFormula = {
  name: string;
  moves: string;
  tags?: string[];
  id?: string;
};

/** 创建公式：校验记法合法性并规范化；非法时抛 FormulaError */
export function createFormula(input: NewFormula): Formula {
  const err = validateFormulaMoves(input.moves);
  if (err) throw new FormulaError(err);
  return {
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim(),
    moves: normalizeMoves(input.moves),
    tags: [...(input.tags ?? [])],
  };
}

export function createLibrary(formulas: Formula[] = []): FormulaLibrary {
  return { version: 1, formulas: [...formulas] };
}

export function upsertFormula(lib: FormulaLibrary, formula: Formula): FormulaLibrary {
  const idx = lib.formulas.findIndex((f) => f.id === formula.id);
  const formulas = [...lib.formulas];
  if (idx >= 0) formulas[idx] = formula;
  else formulas.push(formula);
  return { ...lib, formulas };
}

export function removeFormula(lib: FormulaLibrary, id: string): FormulaLibrary {
  return { ...lib, formulas: lib.formulas.filter((f) => f.id !== id) };
}

/** 导出为 JSON 字符串（存储格式，docs/formula.md：存储/导出可与标准记法不一致） */
export function serializeFormula(lib: FormulaLibrary): string {
  return JSON.stringify(lib, null, 2);
}

/** 从 JSON 字符串导入：逐条校验记法合法性，非法抛 FormulaError */
export function deserializeFormula(text: string): FormulaLibrary {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FormulaError("JSON 解析失败");
  }
  const obj = raw as { formulas?: unknown } | null;
  if (!obj || !Array.isArray(obj.formulas)) {
    throw new FormulaError("结构非法：缺少 formulas 数组");
  }
  const formulas: Formula[] = [];
  for (const item of obj.formulas) {
    const f = item as Record<string, unknown> | null;
    if (!f || typeof f !== "object") throw new FormulaError("公式条目非法");
    const { id, name, moves, tags } = f;
    if (typeof id !== "string" || typeof name !== "string" || typeof moves !== "string") {
      throw new FormulaError("公式字段缺失：id/name/moves 必须为字符串");
    }
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
      throw new FormulaError(`公式 ${name}：tags 必须为字符串数组`);
    }
    const err = validateFormulaMoves(moves);
    if (err) throw new FormulaError(`公式 ${name}：${err}`);
    formulas.push({ id, name, moves: normalizeMoves(moves), tags });
  }
  return { version: 1, formulas };
}
