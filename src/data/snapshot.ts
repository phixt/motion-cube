/**
 * 游戏/编辑器进度快照（参考 gomoku 存档逻辑，大幅简化）：
 * 只存「达成步骤」与「最终状态」——alg 同时表达两者（步骤序列 = 魔方状态），
 * 不存每步时间等细节。cubeType 预留魔方种类以支持后续拓展（如 2x2/4x4）。
 * 存储用 localStorage（tauri WebView2 亦持久），可复用于动画编辑器。
 */
const SNAPSHOT_KEY = "motion-cube.snapshot";

export type CubeSnapshot = {
  version: 1;
  savedAt: number;
  /** 预留：魔方种类（默认 "3x3x3"） */
  cubeType: string;
  /** 达成步骤（即当前魔方状态） */
  alg: string;
};

export function loadSnapshot(): CubeSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<CubeSnapshot> | null;
    if (!s || typeof s.alg !== "string" || !s.alg) return null;
    return {
      version: 1,
      savedAt: typeof s.savedAt === "number" ? s.savedAt : 0,
      cubeType: typeof s.cubeType === "string" && s.cubeType ? s.cubeType : "3x3x3",
      alg: s.alg,
    };
  } catch {
    return null;
  }
}

export function saveSnapshot(alg: string): void {
  if (!alg) return;
  const snap: CubeSnapshot = { version: 1, savedAt: Date.now(), cubeType: "3x3x3", alg };
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
}

export function clearSnapshot(): void {
  localStorage.removeItem(SNAPSHOT_KEY);
}
