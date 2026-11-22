/**
 * solverClient.ts — 求解器 Worker 客户端（支持后台预热、异步求解、真实取消、卸载回收）。
 * 在不支持 Web Worker 的环境下自动回退同步求解，保证单测与特殊宿主可用。
 */
import type { Face } from "../stickering.ts";
import { prepareSolvers, solve, type SolveMethodKey, type SolveResult } from "./solve.ts";
import type { SolverWorkerRequest, SolverWorkerResponse } from "./solver.worker.ts";

export class SolveCancelledError extends Error {
  constructor() {
    super("solve cancelled");
    this.name = "SolveCancelledError";
  }
}

type PendingEntry = {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingEntry>();

function rejectAllPending(err: Error): void {
  for (const [, p] of pending) p.reject(err);
  pending.clear();
}

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  const w = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
  w.addEventListener("message", (ev: MessageEvent<SolverWorkerResponse>) => {
    const msg = ev.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) {
      entry.resolve(msg.kind === "solve" ? msg.result : undefined);
    } else {
      entry.reject(new Error(msg.error));
    }
  });
  w.addEventListener("error", (ev) => {
    const err = new Error(ev.message || "solver worker error");
    worker = null;
    w.terminate();
    rejectAllPending(err);
  });
  worker = w;
  return w;
}

/** 后台预热求解表（不阻塞主线程） */
export function warmupSolvers(method?: SolveMethodKey): void {
  const w = getWorker();
  if (!w) {
    try {
      prepareSolvers(method);
    } catch {
      // 忽略预热失败
    }
    return;
  }
  const id = nextId++;
  const req: SolverWorkerRequest = { id, type: "prepare", method };
  pending.set(id, { resolve: () => {}, reject: () => {} });
  w.postMessage(req);
}

/** 异步求解（支持 cancel：直接 terminate 正在运行的 Worker 并立即中止） */
export function solveAsync(
  state: Uint8Array,
  method: SolveMethodKey,
  bases: Face[],
): { promise: Promise<SolveResult>; cancel: () => void } {
  const w = getWorker();
  if (!w) {
    let cancelled = false;
    const promise = new Promise<SolveResult>((resolve, reject) => {
      setTimeout(() => {
        if (cancelled) {
          reject(new SolveCancelledError());
          return;
        }
        try {
          let best: SolveResult | null = null;
          for (const b of bases) {
            const r = solve(state, method, b);
            if (!best || r.moves.length < best.moves.length) best = r;
          }
          if (!best) throw new Error("no solve base provided");
          resolve(best);
        } catch (e) {
          reject(e);
        }
      }, 0);
    });
    return {
      promise,
      cancel: () => {
        cancelled = true;
      },
    };
  }

  const id = nextId++;
  let settled = false;
  const promise = new Promise<SolveResult>((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => {
        settled = true;
        resolve(v as SolveResult);
      },
      reject: (e) => {
        settled = true;
        reject(e);
      },
    });
  });

  const req: SolverWorkerRequest = { id, type: "solve", state: state.slice(), method, bases: [...bases] };
  w.postMessage(req);

  const cancel = (): void => {
    if (settled) return;
    settled = true;
    const entry = pending.get(id);
    pending.delete(id);
    // 终止当前计算中的 Worker（下次求解/预热时按需重建）
    if (worker === w) {
      worker.terminate();
      worker = null;
      rejectAllPending(new SolveCancelledError());
    }
    entry?.reject(new SolveCancelledError());
  };

  return { promise, cancel };
}

/** 卸载释放求解 Worker */
export function disposeSolverWorker(): void {
  if (!worker) return;
  worker.terminate();
  worker = null;
  rejectAllPending(new SolveCancelledError());
}
