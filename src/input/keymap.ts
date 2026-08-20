/**
 * 层 C'：自定义键盘映射（docs/todo.md 体验问题）。
 * 每个动作（SiGN 动作 / 特殊动作）绑定一个物理键组合（code + Shift + Space 修饰）。
 * Space 保留为"双层 wide 修饰键"；Shift 常作反转修饰。配置可持久化（见 settings.ts）。
 */
import type { CubePlayer } from "../cube/CubePlayer";

export type SpecialAction = "undo" | "reset" | "toggle-play";

/** 动画编辑器专属功能键（与游戏公式键分离；游戏公式键在编辑器中无实际含义，已解绑） */
export type EditorAction =
  | "play"
  | "toggle-cube"
  | "toggle-hand"
  | "step-back"
  | "step-forward"
  | "jump-prev"
  | "jump-next";

export type EditorKeymapConfig = Record<EditorAction, KeyBinding>;

export type KeyBinding = {
  code: string;
  shift?: boolean;
  space?: boolean;
};

export type KeymapConfig = {
  moves: Record<string, KeyBinding>;
  specials: Record<SpecialAction, KeyBinding>;
};

export function buildDefaultKeymap(): KeymapConfig {
  const moves: Record<string, KeyBinding> = {};
  const faces: Record<string, string> = {
    KeyU: "U",
    KeyD: "D",
    KeyL: "L",
    KeyR: "R",
    KeyF: "F",
    KeyB: "B",
  };
  for (const [code, face] of Object.entries(faces)) {
    moves[face] = { code };
    moves[`${face}'`] = { code, shift: true };
    const wide = face.toLowerCase();
    moves[wide] = { code, space: true };
    moves[`${wide}'`] = { code, shift: true, space: true };
  }
  for (const [code, move] of [
    ["KeyM", "M"],
    ["KeyE", "E"],
    ["KeyS", "S"],
    ["KeyX", "x"],
    ["KeyY", "y"],
    ["KeyZ", "z"],
  ] as const) {
    moves[move] = { code };
    moves[`${move}'`] = { code, shift: true };
  }
  return {
    moves,
    specials: {
      undo: { code: "Backspace" },
      reset: { code: "Escape" },
      "toggle-play": { code: "KeyP" },
    },
  };
}

export const DEFAULT_KEYMAP: KeymapConfig = buildDefaultKeymap();

export const DEFAULT_EDITOR_ACTIONS: EditorKeymapConfig = {
  play: { code: "Space" },
  "toggle-cube": { code: "KeyC" },
  "toggle-hand": { code: "KeyH" },
  "step-back": { code: "ArrowLeft" },
  "step-forward": { code: "ArrowRight" },
  "jump-prev": { code: "ArrowLeft", shift: true },
  "jump-next": { code: "ArrowRight", shift: true },
};

export const EDITOR_ACTION_ORDER: readonly EditorAction[] = [
  "play",
  "toggle-cube",
  "toggle-hand",
  "step-back",
  "step-forward",
  "jump-prev",
  "jump-next",
];

/**
 * 新手直觉预设：U/D/L/R 用方向键（↑↓←→ 对应上/下/左/右面），
 * F/B 保留字母助记（Front/Back），M/E/S/x/y/z 与特殊键沿用默认。
 */
export const BEGINNER_KEYMAP: KeymapConfig = (() => {
  const cfg = buildDefaultKeymap();
  const arrowMap: Record<string, string> = {
    U: "ArrowUp",
    D: "ArrowDown",
    L: "ArrowLeft",
    R: "ArrowRight",
  };
  for (const [face, code] of Object.entries(arrowMap)) {
    cfg.moves[face] = { code };
    cfg.moves[`${face}'`] = { code, shift: true };
    const wide = face.toLowerCase();
    cfg.moves[wide] = { code, space: true };
    cfg.moves[`${wide}'`] = { code, shift: true, space: true };
  }
  return cfg;
})();

export function bindingKey(b: KeyBinding): string {
  return `${b.code}|${b.shift ? 1 : 0}|${b.space ? 1 : 0}`;
}

/** 冲突检测：同一按键组合被多个动作使用 */
export function findConflicts(cfg: KeymapConfig): { binding: KeyBinding; actions: string[] }[] {
  const seen = new Map<string, { binding: KeyBinding; actions: string[] }>();
  const add = (action: string, b: KeyBinding) => {
    const k = bindingKey(b);
    const entry = seen.get(k) ?? { binding: b, actions: [] };
    entry.actions.push(action);
    seen.set(k, entry);
  };
  for (const [a, b] of Object.entries(cfg.moves)) add(a, b);
  for (const [a, b] of Object.entries(cfg.specials)) add(a, b);
  return [...seen.values()].filter((e) => e.actions.length > 1);
}

/** 从 JSON 字符串恢复配置；结构非法或缺少默认动作时返回 null */
export function deserializeKeymap(text: string): KeymapConfig | null {
  try {
    const raw = JSON.parse(text) as { moves?: unknown; specials?: unknown } | null;
    if (!raw || typeof raw !== "object") return null;
    const moves: Record<string, KeyBinding> = {};
    const specials: Partial<Record<SpecialAction, KeyBinding>> = {};
    for (const [action, b] of Object.entries(raw.moves ?? {})) {
      const kb = b as Partial<KeyBinding> | null;
      if (!kb || typeof kb !== "object" || typeof kb.code !== "string") return null;
      moves[action] = { code: kb.code, shift: !!kb.shift, space: !!kb.space };
    }
    for (const [action, b] of Object.entries(raw.specials ?? {})) {
      const kb = b as Partial<KeyBinding> | null;
      if (!kb || typeof kb !== "object" || typeof kb.code !== "string") return null;
      specials[action as SpecialAction] = { code: kb.code, shift: !!kb.shift, space: !!kb.space };
    }
    for (const action of Object.keys(DEFAULT_KEYMAP.moves)) {
      if (!(action in moves)) return null;
    }
    return {
      moves,
      specials: specials as Record<SpecialAction, KeyBinding>,
    };
  } catch {
    return null;
  }
}

/** 从 JSON 恢复编辑器功能键配置；结构非法或缺默认动作时返回 null */
export function deserializeEditorActions(text: string): EditorKeymapConfig | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return null;
    const out = {} as EditorKeymapConfig;
    for (const action of EDITOR_ACTION_ORDER) {
      const b = raw[action] as Partial<KeyBinding> | null;
      if (!b || typeof b !== "object" || typeof b.code !== "string") return null;
      out[action] = { code: b.code, shift: !!b.shift, space: !!b.space };
    }
    return out;
  } catch {
    return null;
  }
}

export class KeymapController {
  private spaceHeld = false;
  private lastMoveAt = 0;
  private moveCooldownMs = 0;
  private cfg: KeymapConfig;

  constructor(
    private readonly player: CubePlayer,
    private readonly hooks: {
      onMove: (move: string) => void;
      onSpecial: (action: SpecialAction) => void;
    },
    cfg: KeymapConfig = DEFAULT_KEYMAP,
  ) {
    this.cfg = cfg;
  }

  setConfig(cfg: KeymapConfig): void {
    this.cfg = cfg;
  }

  setMoveCooldown(ms: number): void {
    this.moveCooldownMs = Math.max(0, ms);
  }

  attach(target: EventTarget = window): void {
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
  }

  detach(target: EventTarget = window): void {
    target.removeEventListener("keydown", this.onKeyDown);
    target.removeEventListener("keyup", this.onKeyUp);
  }

  private resolve(
    ev: KeyboardEvent,
  ): { kind: "move"; move: string } | { kind: "special"; action: SpecialAction } | null {
    const k = bindingKey({ code: ev.code, shift: ev.shiftKey, space: this.spaceHeld });
    for (const [action, b] of Object.entries(this.cfg.moves)) {
      if (bindingKey(b) === k) return { kind: "move", move: action };
    }
    for (const [action, b] of Object.entries(this.cfg.specials)) {
      if (bindingKey(b) === k) return { kind: "special", action: action as SpecialAction };
    }
    return null;
  }

  private onKeyDown = (e: Event): void => {
    const ev = e as KeyboardEvent;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
    if (ev.code === "Space") {
      this.spaceHeld = true;
      e.preventDefault();
      return;
    }
    const r = this.resolve(ev);
    if (!r) return;
    e.preventDefault();
    if (r.kind === "move") {
      const now = performance.now();
      if (this.moveCooldownMs > 0 && now - this.lastMoveAt < this.moveCooldownMs) return;
      this.lastMoveAt = now;
      this.player.applyMove(r.move);
      this.hooks.onMove(r.move);
    } else {
      this.hooks.onSpecial(r.action);
    }
  };

  private onKeyUp = (e: Event): void => {
    if ((e as KeyboardEvent).code === "Space") this.spaceHeld = false;
  };
}

export function prettyCode(code: string): string {
  const special: Record<string, string> = {
    Backspace: "Backspace",
    Escape: "Esc",
    Space: "Space",
    Tab: "Tab",
    Enter: "Enter",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };
  if (special[code]) return special[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

export function prettyBinding(b: KeyBinding): string {
  const parts: string[] = [];
  if (b.space) parts.push("Space");
  if (b.shift) parts.push("Shift");
  parts.push(prettyCode(b.code));
  return parts.join("+");
}
