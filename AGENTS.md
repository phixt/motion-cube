# 项目记忆（motion-cube）

## 环境偏好

- **端口**：5173 是用户日常预览端口（用户自己占用），本项目的自动化、dev server、
  playtest 一律使用其他端口（如 5174），避免与用户预览冲突。
- **tauri 桌面版**：dev/build 走 5174（tauri.conf 已设）；命令
  `npm run tauri dev` / `npm run tauri build`；产物在 src-tauri/target/release
  （exe + bundle/nsis 安装器）；打包后启动验证用 Start-Process + 截图确认渲染
- **版本号**：package.json 与 src-tauri/tauri.conf.json 的 version 必须同步
  （tauri 打包以 conf 为准）；功能/修复提交时评估 bump
- **自动化（GitHub Actions）**：尚未配置；可加 .github/workflows（CI:
  typecheck/build/verify/playtest；发布: tag 触发 tauri 打包上传 Releases）
- **Windows**：优先 PowerShell 7（pwsh）；中文输出前设置 UTF-8
  （PowerShell `[Console]::OutputEncoding`、Python `sys.stdout.reconfigure`）；
  沙箱受限进程无法启动 WindowsApps 目录下的别名程序时，用完整路径或提权通道。

## 项目速览

- Vite 8 + Vue 3.5 + TypeScript + cubing.js（3D 魔方）+ three.js（手模型）+ WinUIonWeb 壳。
- 数据持久化全在 localStorage（settings/keymap/editorKeymap/library/handRig）。
- 编辑器以 3D 视图为中心 + 左侧 PS 风格侧边栏；页面不滚动（详情区内部滚动）。
- **内置公式库**：`data/samples/cuberoot-algs.json`（爬自 api.cuberoot.me，241 个
  case：2-look-oll/oll/2-look-pll/pll/f2l + 2-look-cmll/cmll/eo4a/lse-eolr）由
  `scripts/gen-cuberoot-algs.mjs` 生成（含最小 54 贴纸引擎语义校验）；访问器
  `src/data/algDb.ts` 导出 `BUILTIN_LIBRARY`（公式 id `cr-<caseId>`，tags=CFOP/Roux）；
  公式库页「加载内置公式库」按钮合并落库。
- **求解器**（移植自 rubik-cube.html，纯 TS、无运行时依赖）：`src/cube/solver/`——
  engine（54 贴纸引擎+code 置换表）、search（ItemSolver PDB/IDA*/descend）、
  algs（OLL/PLL/CMLL 坐标 + 逐条核验的内置 LL 公式库 + algGraph）、f2lTable（150 case）、
  cfop/roux 阶段解、`solve.ts` 入口 `solve(state, method)`（自动处理中心漂移并映射回
  真实魔方，重放校验 isUniform）；GamePage「求解」面板（方法切换/阶段展示/演示）。
  验证：`node scripts/smoke-solver.ts` / `scripts/smoke-solver-edge.ts`（tsx）、
  `scripts/playtest-solver.mjs`。
- playtest：`node scripts/playtest-ui.mjs`（先起 dev server，SPIKE_URL 指向非 5173 端口）。
