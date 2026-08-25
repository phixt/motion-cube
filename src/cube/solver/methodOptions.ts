/**
 * methodOptions.ts — 求解方法二级选项框架（配置驱动、可拓展）。
 *
 * 设计意图（用户要求）：高级解法**不常驻**——普通方法是常驻入口（CFOP / Roux 按钮），
 * 高级是「点击方法后在右侧弹出的可勾选项」。后续填充更多选项（如 cfop 的快速十字/F2L
 * 技巧、roux 的 NM-CMLL 等）只需在此表加条目 + i18n key，UI 自动渲染；无需改组件。
 *
 * 选项状态模型：
 *   - 每方法一个选项组（SolverOptionGroup），组内若干 SolverMethodOption；
 *   - 勾选集合 = Record<optionId, boolean>，默认全关（普通=默认，高级需显式勾选）；
 *   - 持久化独立 localStorage key（motion-cube.solveOptions），与全量选项归一化
 *     （未知 id 丢弃、缺省 false），未知选项自动忽略不报错——向后兼容。
 *
 * 方法解析（当前映射）：选项粒度细分后此函数再细化（roux 高级调研进行中）。
 *   - cfop + cfop.zbll → 'cfop-adv'，否则 'cfop'
 *   - roux + (roux.eolr | roux.merge4b4c) → 'roux-adv'，否则 'roux'
 *     （现 roux-adv = EOLR 一步表 + 6E2C 合一；「仅合并 4b4c 不 EOLR」的独立粒度
 *       待 docs/research-roux-adv.md 调研结论后再拆。）
 *
 * 解法底（多色底 / 6 色底）：独立 localStorage key（motion-cube.solveBase），
 * 取值为**多选面集合** Face[]（多色底）；空数组 = 跟随全局底色设置（默认）。
 * 「跟随原始底」已去掉：默认放全局底颜色上（GamePage 初始化
 * [loadSettings().baseFace]），可加选其它色（多选）、再点取消（最少保留一个）、
 * 重置回归全局底。消费方 = GamePage 求解时对集合中每底分别
 * solver.solve(state, method, base) 并取最短。
 */
import { FACES, type Face } from "../stickering.ts";

export type SolverBase = "cfop" | "roux";

export interface SolverMethodOption {
  /** 稳定 id（持久化键），命名 `<method>.<feature>` */
  id: string;
  /** i18n 标签 key（如 solve.opt.zbll） */
  labelKey: string;
  /** i18n 提示 key（可省略） */
  hintKey?: string;
  /** 依赖：勾选此选项所需的其它选项 id（预留，当前无依赖项） */
  dependsOn?: string[];
}

export interface SolverOptionGroup {
  /** 所属方法基 */
  method: SolverBase;
  /** 组标题 i18n key */
  groupKey: string;
  options: SolverMethodOption[];
}

/** 全量选项表（唯一事实源）。新增选项 = 在此加条目 + locales 文案。 */
export const METHOD_OPTION_GROUPS: SolverOptionGroup[] = [
  {
    method: "cfop",
    groupKey: "solve.optGroup.cfop",
    options: [
      {
        id: "cfop.zbll",
        labelKey: "solve.opt.zbll",
        hintKey: "solve.opt.zbllHint",
      },
    ],
  },
  {
    method: "roux",
    groupKey: "solve.optGroup.roux",
    options: [
      { id: "roux.eolr", labelKey: "solve.opt.rouxEolr", hintKey: "solve.opt.rouxEolrHint" },
      { id: "roux.merge4b4c", labelKey: "solve.opt.rouxMerge", hintKey: "solve.opt.rouxMergeHint" },
    ],
  },
];

export const ALL_OPTION_IDS: string[] = METHOD_OPTION_GROUPS.flatMap((g) => g.options.map((o) => o.id));

/** 默认勾选：高级项全关（普通=默认，高级不常驻），但 roux.merge4b4c 默认开——
 *  合并 4b+4c 仍是人类式分步（4a + 4b+4c 两段），调研实测净省 ~2.46 步且 0 例变长。 */
export const DEFAULT_SOLVER_OPTIONS: Readonly<Record<string, boolean>> = {
  ...Object.fromEntries(ALL_OPTION_IDS.map((id) => [id, false])),
  "roux.merge4b4c": true,
};

export type SolverOptions = Record<string, boolean>;

const SOLVE_OPTIONS_KEY = "motion-cube.solveOptions";

/** 读取勾选集合（与全量选项归一化：未知 id 丢弃、缺省 false）。 */
export function loadSolverOptions(): SolverOptions {
  const out: SolverOptions = { ...DEFAULT_SOLVER_OPTIONS };
  try {
    const raw = localStorage.getItem(SOLVE_OPTIONS_KEY);
    if (!raw) return out;
    const obj = JSON.parse(raw) as Record<string, unknown> | null;
    if (!obj || typeof obj !== "object") return out;
    for (const id of ALL_OPTION_IDS) {
      if (typeof obj[id] === "boolean") out[id] = obj[id] as boolean;
    }
  } catch {
    /* 忽略解析失败，用默认 */
  }
  return out;
}

export function saveSolverOptions(opts: SolverOptions): void {
  try {
    localStorage.setItem(SOLVE_OPTIONS_KEY, JSON.stringify(opts));
  } catch {
    /* 忽略写入失败 */
  }
}

// ---------- 解法底（多色底 / 6 色底，多选面集合） ----------

/** 解法底选择：多选面集合（多色底），空数组 = 跟随全局底色设置（默认） */
export type SolveBaseChoice = Face[];

const SOLVE_BASE_KEY = "motion-cube.solveBase";

export const DEFAULT_SOLVE_BASE: SolveBaseChoice = [];

/** 读取解法底（多选集合；与合法面全集归一化：数组内未知项丢弃、空数组 = 跟随全局底） */
export function loadSolveBases(): SolveBaseChoice {
  try {
    const raw = localStorage.getItem(SOLVE_BASE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const faces = parsed.filter((v): v is Face => (FACES as readonly string[]).includes(v as string));
    return faces;
  } catch {
    return [];
  }
}

export function saveSolveBases(bases: SolveBaseChoice): void {
  try {
    localStorage.setItem(SOLVE_BASE_KEY, JSON.stringify(bases));
  } catch {
    /* 忽略写入失败 */
  }
}

/**
 * 方法基 + 勾选集合 → 实际求解方法（现映射到 SOLVER_METHODS 四个键）。
 * 选项粒度细化时以此处为准扩展。
 */
export function resolveSolverMethod(
  base: SolverBase,
  opts: SolverOptions,
): "cfop" | "cfop-adv" | "roux" | "roux-merge" | "roux-adv" {
  if (base === "cfop") return opts["cfop.zbll"] ? "cfop-adv" : "cfop";
  if (opts["roux.eolr"]) return "roux-adv"; // EOLR 一步 + 合并（高级）
  if (opts["roux.merge4b4c"]) return "roux-merge"; // 仅合并 4b+4c（4a 分步 + 4c 一步，默认）
  return "roux"; // 纯分步 4a/4b/4c
}