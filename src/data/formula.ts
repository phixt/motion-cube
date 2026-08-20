/**
 * 公式库模型。
 * 只存公式本身（标准 R L 记法），不存速度/手法；与手法库通过 formulaId 弱关联。
 */
import { normalizeMoves, validateFormulaMoves } from "../notation/alg";

export type Formula = {
  id: string;
  name: string;
  /** 标准 WCA/SiGN 记法（规范化后） */
  moves: string;
  tags: string[];
  /** 所属分类 id（单选；null = 未分类）。分类是客观可区分的归类，大流派用 tags */
  categoryId: string | null;
};

export type FormulaLibrary = {
  version: 1;
  formulas: Formula[];
};

export class FormulaError extends Error {}

/** 名称/标签长度上限：防止导入的超长字符串撑爆 UI */
export const MAX_FORMULA_NAME_LENGTH = 64;
export const MAX_TAG_LENGTH = 32;

export type NewFormula = {
  name: string;
  moves: string;
  tags?: string[];
  categoryId?: string | null;
  id?: string;
};

/** 创建公式：校验记法合法性并规范化；非法时抛 FormulaError */
export function createFormula(input: NewFormula): Formula {
  const err = validateFormulaMoves(input.moves);
  if (err) throw new FormulaError(err);
  const name = input.name.trim();
  if (name.length > MAX_FORMULA_NAME_LENGTH) {
    throw new FormulaError(`公式名称过长（最多 ${MAX_FORMULA_NAME_LENGTH} 字符）`);
  }
  for (const tag of input.tags ?? []) {
    if (tag.length > MAX_TAG_LENGTH) throw new FormulaError(`标签过长（最多 ${MAX_TAG_LENGTH} 字符）：${tag}`);
  }
  return {
    id: input.id ?? crypto.randomUUID(),
    name,
    moves: normalizeMoves(input.moves),
    tags: [...(input.tags ?? [])],
    categoryId: input.categoryId ?? null,
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

/** 导出为 JSON 字符串（存储格式，存储/导出可与标准记法不一致） */
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
  return { version: 1, formulas: parseFormulaEntries(obj.formulas) };
}

/** 校验任意结构的公式条目数组（供导入/合并复用） */
export function parseFormulaEntries(items: unknown[]): Formula[] {
  const formulas: Formula[] = [];
  for (const item of items) {
    const f = item as Record<string, unknown> | null;
    if (!f || typeof f !== "object") throw new FormulaError("公式条目非法");
    const { id, name, moves, tags, categoryId, categoryIds } = f;
    if (typeof id !== "string" || typeof name !== "string" || typeof moves !== "string") {
      throw new FormulaError("公式字段缺失：id/name/moves 必须为字符串");
    }
    if (name.length > MAX_FORMULA_NAME_LENGTH) {
      throw new FormulaError(`公式名称过长（最多 ${MAX_FORMULA_NAME_LENGTH} 字符）：${name.slice(0, 32)}…`);
    }
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
      throw new FormulaError(`公式 ${name}：tags 必须为字符串数组`);
    }
    if (tags.some((t) => t.length > MAX_TAG_LENGTH)) {
      throw new FormulaError(`公式 ${name}：单个标签过长（最多 ${MAX_TAG_LENGTH} 字符）`);
    }
    if (categoryIds !== undefined && (!Array.isArray(categoryIds) || !categoryIds.every((c) => typeof c === "string"))) {
      throw new FormulaError(`公式 ${name}：categoryIds 必须为字符串数组`);
    }
    if (categoryId !== undefined && categoryId !== null && typeof categoryId !== "string") {
      throw new FormulaError(`公式 ${name}：categoryId 必须为字符串或 null`);
    }
    const err = validateFormulaMoves(moves);
    if (err) throw new FormulaError(`公式 ${name}：${err}`);
    // 单选迁移：新字段 categoryId 优先；旧格式 categoryIds 数组取第一个
    let catId: string | null = null;
    if (typeof categoryId === "string") catId = categoryId;
    else if (Array.isArray(categoryIds) && typeof categoryIds[0] === "string") catId = categoryIds[0];
    formulas.push({
      id,
      name,
      moves: normalizeMoves(moves),
      tags,
      categoryId: catId,
    });
  }
  return formulas;
}
