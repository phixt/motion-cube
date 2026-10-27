/**
 * 焦点上下文判定：区分「用户正在文本框里输入」与「焦点落在非可编辑控件上」。
 *
 * 背景（游戏页快速连打丢步）：旧实现只看 tagName —— 任何落在 INPUT/TEXTAREA 上的按键
 * 一律被忽略。于是「焦点落在非文本输入控件上」（cubing twisty 内部 input、hidden /
 * readonly / range 之类）时游戏按键被整段吞掉：协调者实测 45ms 间隔连按 30 次只记到
 * 23 步（丢 7 键）。本模块把判据从「是不是 INPUT/TEXTAREA」换成「用户是不是真的在
 * 文本框里输入」。
 *
 * 口径（只保护「用户真的在打字」）：
 *   · 保护（键入不触发游戏动作）：可见且未 readonly/disabled 的文本框、多行文本框，
 *     以及 contenteditable 可编辑区域。
 *   · 不保护（**不得**吞掉游戏按键）：
 *       - cubing（twisty-player）内部控件；
 *       - type=hidden / readonly / disabled 的 input；
 *       - 非文本类型 input（range/checkbox/radio/button/color/file/...）；
 *       - 不可见（display:none / visibility:hidden / 零尺寸）的控件；
 *       - contenteditable=false 与普通容器（div 等）。
 */

/** INPUT 的「文本输入」类型：其余类型（hidden/range/checkbox/radio/button/...）都不是打字面 */
const TEXT_ENTRY_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "", // 未写 type 时默认就是 text
]);

/** cubing 组件宿主：其内部控件由组件自己管理，不属于用户的打字面 */
const CUBING_HOST_SELECTOR = "twisty-player";

function isDisabledElement(el: HTMLElement): boolean {
  return (el as HTMLInputElement).disabled === true || el.getAttribute("aria-disabled") === "true";
}

/** 控件是否在布局中不可见（隐藏 input / 零尺寸占位控件 / 全透明控件） */
function isInvisibleElement(el: HTMLElement): boolean {
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return true;
  if (style.opacity === "0") return true;
  const rect = el.getBoundingClientRect();
  return rect.width <= 0 || rect.height <= 0;
}

/**
 * 判断一次按键事件的目标是否处于「用户正在文本框里输入」的上下文。
 *
 * true  → 应当忽略该按键（保护打字：键入不触发游戏动作/导航）
 * false → 不属于打字上下文（按键照常走游戏通道，不得被吞）
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== "object" || typeof el.tagName !== "string") return false;

  // cubing 组件内部控件（twisty-player 自身或其后代）不是用户的打字面
  if (typeof el.closest === "function" && el.closest(CUBING_HOST_SELECTOR)) return false;

  const tag = el.tagName;
  if (tag === "TEXTAREA") {
    const ta = el as HTMLTextAreaElement;
    if (ta.readOnly || isDisabledElement(ta)) return false;
    return !isInvisibleElement(ta);
  }
  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    if (input.readOnly || isDisabledElement(input)) return false;
    const type = (input.getAttribute("type") || "text").toLowerCase();
    if (!TEXT_ENTRY_INPUT_TYPES.has(type)) return false;
    return !isInvisibleElement(input);
  }

  // contenteditable：可编辑区域（用户在编辑文本）→ 保护；contenteditable=false → 不保护
  return el.isContentEditable === true;
}
