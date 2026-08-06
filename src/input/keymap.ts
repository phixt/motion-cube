import type { CubePlayer } from "../cube/CubePlayer";

/**
 * 层 C'：自定义键盘映射（docs/base.md 第 2、3 条）。
 * 使用 e.code（物理键位），与键盘布局无关。默认映射为草稿，可配置：
 *
 *   面（顺时针）    U D L R F B
 *   中层           M E S
 *   整体旋转       X Y Z
 *   反转           Shift + 上述键
 *   双层 wide      Space 按住 + 面键（u d l r f b）
 *   撤销           Backspace
 *   重置           Escape
 *   播放/暂停      P
 */

type Rule = {
  code: string;
  move: string;
  needsShift?: boolean;
  needsSpace?: boolean;
};

const FACE_CODES = {
  KeyU: "U",
  KeyD: "D",
  KeyL: "L",
  KeyR: "R",
  KeyF: "F",
  KeyB: "B",
} as const;

const WIDE_BY_FACE: Record<string, string> = {
  U: "u",
  D: "d",
  L: "l",
  R: "r",
  F: "f",
  B: "b",
};

function buildRules(): Rule[] {
  const rules: Rule[] = [];
  for (const [code, face] of Object.entries(FACE_CODES)) {
    rules.push({ code, move: face });
    rules.push({ code, move: `${face}'`, needsShift: true });
    const wide = WIDE_BY_FACE[face];
    rules.push({ code, move: wide, needsSpace: true });
    rules.push({ code, move: `${wide}'`, needsShift: true, needsSpace: true });
  }
  for (const [code, move] of [
    ["KeyM", "M"],
    ["KeyE", "E"],
    ["KeyS", "S"],
    ["KeyX", "x"],
    ["KeyY", "y"],
    ["KeyZ", "z"],
  ] as const) {
    rules.push({ code, move });
    rules.push({ code, move: `${move}'`, needsShift: true });
  }
  return rules;
}

const RULES = buildRules();

export type SpecialAction = "undo" | "reset" | "toggle-play";

export class KeymapController {
  private spaceHeld = false;

  constructor(
    private readonly player: CubePlayer,
    private readonly hooks: {
      onMove: (move: string) => void;
      onSpecial: (action: SpecialAction) => void;
    },
  ) {}

  attach(target: EventTarget = window): void {
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
  }

  detach(target: EventTarget = window): void {
    target.removeEventListener("keydown", this.onKeyDown);
    target.removeEventListener("keyup", this.onKeyUp);
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

    if (ev.code === "Backspace") {
      e.preventDefault();
      this.hooks.onSpecial("undo");
      return;
    }
    if (ev.code === "Escape") {
      e.preventDefault();
      this.hooks.onSpecial("reset");
      return;
    }
    if (ev.code === "KeyP") {
      e.preventDefault();
      this.hooks.onSpecial("toggle-play");
      return;
    }

    const rule = RULES.find(
      (r) => r.code === ev.code && !!r.needsShift === ev.shiftKey && !!r.needsSpace === this.spaceHeld,
    );
    if (!rule) return;
    e.preventDefault();
    this.player.applyMove(rule.move);
    this.hooks.onMove(rule.move);
  };

  private onKeyUp = (e: Event): void => {
    if ((e as KeyboardEvent).code === "Space") this.spaceHeld = false;
  };
}
