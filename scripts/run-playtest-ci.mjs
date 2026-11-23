// run-playtest-ci.mjs — 无依赖 CI / 本地 Playtest 编排器。
//
// 流程：
//   1. 启动 vite preview（端口 4174，避开用户 5173 与 dev 5174），服务 dist/ 生产产物
//      （彻底消除 Vite dev 冷启动优化 reload 竞态）；
//   2. 轮询等待 http://localhost:4174/ 就绪；
//   3. 依次运行 playtest-ui.mjs 与 playtest-solver.mjs；
//   4. 无论成败均清理 preview 进程并透传退出码。
//
// 前置：已执行 `npm run build`（dist/ 存在）。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const PORT = Number(process.env.PLAYTEST_PORT || 4174);
const BASE_URL = `http://localhost:${PORT}/`;
const VITE_BIN = resolve("node_modules/vite/bin/vite.js");

if (!existsSync("dist/index.html")) {
  console.error("缺少 dist/index.html，请先执行 npm run build。");
  process.exit(1);
}
if (!existsSync(VITE_BIN)) {
  console.error("缺少 node_modules/vite/bin/vite.js，请先执行 npm ci。");
  process.exit(1);
}

const server = spawn(
  process.execPath,
  [VITE_BIN, "preview", "--port", String(PORT), "--strictPort", "--host", "localhost"],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let serverLogs = "";
server.stdout.on("data", (d) => { serverLogs += d.toString(); });
server.stderr.on("data", (d) => { serverLogs += d.toString(); });

function stopServer() {
  if (!server.killed) {
    try { server.kill(); } catch { /* ignore */ }
  }
}

async function waitForReady(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (server.exitCode !== null) {
      throw new Error(`vite preview 提前退出 (code=${server.exitCode}):\n${serverLogs}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* 尚未监听 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`等待 ${url} 超时 (${timeoutMs}ms):\n${serverLogs}`);
}

function runScript(scriptPath) {
  return new Promise((resolveRun, rejectRun) => {
    console.log(`\n========== running ${scriptPath} (${BASE_URL}) ==========`);
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      env: { ...process.env, SPIKE_URL: BASE_URL },
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

try {
  await waitForReady(BASE_URL);
  console.log(`[playtest-ci] preview ready at ${BASE_URL}`);
  await runScript("scripts/playtest-ui.mjs");
  await runScript("scripts/playtest-solver.mjs");
  console.log("\n[playtest-ci] ALL PLAYTESTS PASSED ✓");
} catch (err) {
  console.error("\n[playtest-ci] FAILED:", err && err.message ? err.message : err);
  process.exitCode = 1;
} finally {
  stopServer();
}
