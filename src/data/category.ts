/**
 * 分类系统（docs/todo.md）：树形嵌套（最多 4 层）+ 公式多归属（交叉分类）。
 * 大流派（CFOP/Roux/ZZ 等）建议用公式的 tags，而非分类节点。
 */

export type Category = {
  id: string;
  name: string;
  parentId: string | null;
};

/** 最大嵌套层数（根算第 1 层，最深第 4 层） */
export const MAX_CATEGORY_DEPTH = 4;

export class CategoryError extends Error {}

/** 返回祖先数（根 = 0）；父链缺失或成环时抛错 */
export function categoryDepth(category: Category, categories: readonly Category[]): number {
  let depth = 0;
  let cur = category;
  const seen = new Set<string>([category.id]);
  while (cur.parentId) {
    const parent = categories.find((c) => c.id === cur.parentId);
    if (!parent) throw new CategoryError(`父分类不存在：${cur.parentId}`);
    if (seen.has(parent.id)) throw new CategoryError("分类存在环");
    seen.add(parent.id);
    cur = parent;
    depth++;
  }
  return depth;
}

/** 校验整棵树：父链完整且不超过最大深度 */
export function validateCategoryTree(categories: readonly Category[]): void {
  for (const c of categories) {
    if (categoryDepth(c, categories) >= MAX_CATEGORY_DEPTH) {
      throw new CategoryError(`超出最大嵌套深度（${MAX_CATEGORY_DEPTH} 层）：${c.name}`);
    }
  }
}

export function createCategory(
  input: { id?: string; name: string; parentId?: string | null },
  categories: readonly Category[],
): Category {
  const name = input.name.trim();
  if (!name) throw new CategoryError("分类名不能为空");
  const parentId = input.parentId ?? null;
  if (parentId !== null && !categories.some((c) => c.id === parentId)) {
    throw new CategoryError("父分类不存在");
  }
  const cat: Category = { id: input.id ?? crypto.randomUUID(), name, parentId };
  if (categoryDepth(cat, [...categories, cat]) >= MAX_CATEGORY_DEPTH) {
    throw new CategoryError(`超出最大嵌套深度（${MAX_CATEGORY_DEPTH} 层）：${name}`);
  }
  return cat;
}

/** 删除分类：子分类上提一层（挂到被删分类的父级），避免级联丢失 */
export function removeCategory(categoryId: string, categories: readonly Category[]): Category[] {
  const target = categories.find((c) => c.id === categoryId);
  if (!target) return [...categories];
  return categories
    .filter((c) => c.id !== categoryId)
    .map((c) => (c.parentId === categoryId ? { ...c, parentId: target.parentId } : c));
}

/** 分类的完整路径名，如 "1LLL / ZBLL" */
export function categoryLabelPath(category: Category, categories: readonly Category[]): string {
  const parts: string[] = [category.name];
  let cur = category;
  const seen = new Set<string>([category.id]);
  while (cur.parentId) {
    const parent = categories.find((c) => c.id === cur.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    parts.unshift(parent.name);
    cur = parent;
  }
  return parts.join(" / ");
}

/** 深度优先排序（父在前、子紧随），便于树形展示 */
export function sortCategories(categories: readonly Category[]): Category[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  const result: Category[] = [];
  const visit = (parentId: string | null) => {
    for (const c of (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
      result.push(c);
      visit(c.id);
    }
  };
  visit(null);
  return result;
}

/** 分类 id → 祖先链（根→自身），用于级联选择回显 */
export function categoryPath(categoryId: string, categories: readonly Category[]): string[] {
  const path: string[] = [];
  let cur = categories.find((c) => c.id === categoryId) ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur.id);
    cur = cur.parentId ? (categories.find((c) => c.id === cur?.parentId) ?? null) : null;
  }
  return path;
}
