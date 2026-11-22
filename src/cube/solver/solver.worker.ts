/**
 * solver.worker.ts — 求解器 Web Worker（Step 1）：
 * 把 560ms 表预热与多底搜索移出主线程，避免游戏页卡顿，并使「求解中」遮罩与取消按钮真正生效。
 */
import type { Face } from "../stickering.ts";
import { prepareSolvers, solve, type SolveMethodKey, type SolveResult } from "./solve.ts";

export type SolverWorkerRequest =
  | { id: number; type: "prepare"; method?: SolveMethodKey }
  | { id: number; type: "solve"; state: Uint8Array; method: SolveMethodKey; bases: Face[] };

export type SolverWorkerResponse =
  | { id: number; ok: true; kind: "prepare" }
  | { id: number; ok: true; kind: "solve"; result: SolveResult }
  | { id: number; ok: false; error: string };

self.addEventListener("message", (ev: MessageEvent<SolverWorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === "prepare") {
      prepareSolvers(req.method);
      const res: SolverWorkerResponse = { id: req.id, ok: true, kind: "prepare" };
      self.postMessage(res);
      return;
    }
    let best: SolveResult | null = null;
    for (const b of req.bases) {
      const r = solve(req.state, req.method, b);
      if (!best || r.moves.length < best.moves.length) best = r;
    }
    if (!best) throw new Error("no solve base provided");
    const res: SolverWorkerResponse = { id: req.id, ok: true, kind: "solve", result: best };
    self.postMessage(res);
  } catch (e) {
    const res: SolverWorkerResponse = {
      id: req.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    self.postMessage(res);
  }
});
