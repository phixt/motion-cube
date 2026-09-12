# 项目记忆（motion-cube）

## 环境偏好

- **端口**：5173 是用户日常预览端口（用户自己占用），本项目的自动化、dev server、
  playtest 一律使用其他端口（如 5174），避免与用户预览冲突。
- **tauri 桌面版**：dev/build 走 5174（tauri.conf 已设）；命令
  `npm run tauri dev` / `npm run tauri build`；产物在 src-tauri/target/release
  （exe + bundle/nsis 安装器）；打包后启动验证用 Start-Process + 截图确认渲染
- **版本号**：package.json 与 src-tauri/tauri.conf.json 的 version 必须同步
  （tauri 打包以 conf 为准）；功能/修复提交时评估 bump
- **自动化（GitHub Actions）**：已配置；已加 .github/workflows（CI:
  typecheck/build/verify/playtest；发布: tag 触发 tauri 打包上传 Releases）
- **Windows**：优先 PowerShell 7（pwsh）；中文输出前设置 UTF-8
  （PowerShell `[Console]::OutputEncoding`、Python `sys.stdout.reconfigure`）；
  沙箱受限进程无法启动 WindowsApps 目录下的别名程序时，用完整路径或提权通道。

## 项目速览

- Vite 8 + Vue 3.5 + TypeScript + cubing.js（3D 魔方）+ three.js（手模型）+ WinUIonWeb 壳。
- 数据持久化全在 localStorage（settings/keymap/editorKeymap/library/handRig）。
- 编辑器以 3D 视图为中心 + 左侧 PS 风格侧边栏；页面不滚动（详情区内部滚动）。
- **目录与文档**：README 有「项目结构」速查树；`docs/todo.md` 是唯一进度/待办总账
  （每轮落地后更新台账）；`docs/hand-api-usage.md` / `docs/hand-api-spec.md` 是注入
  API 用法与硬约束规格。
- **手部（three.js low-poly，src/hand/）**：`handMesh.ts` 截面放样几何（超椭圆剖面 +
  掌前缘斜坡 frontFaceZ + 根窝/填充棱/掌侧肌凸/大鱼际纵脊）；`HandRig.ts`（双手默认位
  ±1.95 贴面拇指上 + `mirrorPose` 镜像纯函数）；`handRigStore`（v4 shape 参数，
  handScale 默认 1.85，fingerWidth 仅乘四指）；`HandOrbitView`（标定页可交互视图）。
  **双手显示**：编辑器 handLeft/handRight 双实例，关键帧显式 left/right 双轨
  （`TechniqueKeyframe {frame,left,right}`，旧档 {pose,mirror?} 解析迁移，默认不镜像
  关联）；**主位手规则**——双手=右手主位（公式右撇子基准，默认编辑右手），单手=默认
  左手且左手即主位（面板可换，换后即主位）。
- **外部注入 API**：`window.motionCubeHand`（DEV 限定，`src/hand/handApi.ts`）——
  setPose/playFrames 对称驱动双手（左=右镜像），setHandType=单手显示切换、
  setVisible(true) 恢复双手；实现方硬约束（禁改 handMesh/HandRig 类型/HandRigView
  签名/playtest 断言）见 docs/hand-api-spec.md；真机验证已通过。
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
- **验证套件**：`npm run typecheck` / `npm run build` / `npx tsx scripts/verify-data.ts`
  （手法数据契约+迁移）/ `npx tsx scripts/verify-hand-mesh.ts`（手部几何自检：镜像/
  绕向/极值）+ playtest（下行）。渲染类改动必须真机验证后再提交。
- playtest：`node scripts/playtest-ui.mjs`（先起 dev server，SPIKE_URL 指向非 5173 端口）。
- **reference/（gitignore，全程不入库，仅本地参考）**：`3-style-v5/三盲三循环818-魔方根.xlsx`
  （3-Style V5 盲拧三循环 818 条，中文版，已替旧彳亍法档）、`mihlefeld-alg-trainers/`
  （Alg-Trainers 仓库原始 JSON：3x3-ZBLL 472 条 / 3x3-ZBLS 302 条，含 a[] 算法+s 打乱）、
  `new-refs/notes-new-refs.md`（参考说明）。旧彳亍参考（1943/chichu/This.exe/_work）已删。
