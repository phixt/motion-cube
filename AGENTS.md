# 项目记忆（motion-cube）

## 环境偏好

- **端口**：5173 是用户日常预览端口（用户自己占用），本项目的自动化、dev server、
  playtest 一律使用其他端口（如 5174），避免与用户预览冲突。
  `npm run dev` 自 2026-10-27 起默认 **5174**（vite.config.ts），与 tauri 侧一致。
- **tauri 桌面版**：dev/build 走 5174（tauri.conf 已设）；命令
  `npm run tauri dev` / `npm run tauri build`；产物在 src-tauri/target/release
  （exe + bundle/nsis 安装器）；打包后启动验证用 Start-Process + 截图确认渲染
- **版本号**：package.json 与 src-tauri/tauri.conf.json 的 version 必须同步
  （2026-10-27 起 Cargo.toml / Cargo.lock / package-lock.json 一并同步，四处同版）
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
  **外部驱动所有权**：`externalDrive={active}` + `releaseExternalDrive()`——setPose/
  playFrames 接管后置位，编辑器 `renderPreview` 在其置位时跳过双轨 setPose（播放中姿态
  不再被 60Hz 预览冲掉），用户编辑关键帧/切手型/卸载时归还。
  **playFrames 循环**：loop 按跨度取模（周期=span/fps，末帧占周期末 1 帧，纯函数
  `pickFrameIndex` 可单测）；帧间不插值（spec §3.3）；单帧片段 span===0 不开定时器。
- **内置公式库**：`data/samples/cuberoot-algs.json`（爬自 api.cuberoot.me，11 集合
  1015 个 case：2-look-oll/oll/2-look-pll/pll/f2l + zbll 472 + zbls 302（O 组 3 条
  全槽已解按决议剔除，留档 docs/archived/） + 2-look-cmll/cmll/eo4a/lse-eolr）由
  `scripts/gen-cuberoot-algs.mjs` 生成（含最小 54 贴纸引擎语义校验 + ZBLS「恰 1 槽
  未解」形状过滤）；访问器 `src/data/algDb.ts` 导出 `BUILTIN_LIBRARY`（公式 id
  `cr-<caseId>`，tags=CFOP/Roux）；公式库页「加载内置公式库」按钮合并落库。
  **ZBLL 覆盖口径**：主口径=库完整性 493/493=100%（52.5%/926 轨道级旧口径已废弃；
  真实局限=ZBLS 非 FR 缺槽命中率，见 zbls.ts 注释）；验证
  `node scripts/verify-zbll-coverage.ts` / `npx tsx scripts/verify-zbls-rounds.ts`。
- **焦点上下文判据**（`src/input/textEntry.ts`）：`isTextEntryTarget(el)` 区分「用户真在
  文本框打字」（→ 忽略快捷键，别抢键）与「焦点落在隐藏/只读/非文本控件或 cubing 内部
  `twisty-player`」（→ **不得**吞掉游戏键）。keymap.ts / EditorPage.vue / HandCalibPage.vue 统一
  使用；新增输入相关判据一律走它，不要再按 tagName 粗判。
- **手法库加载口径**（2026-10-27 第二批）：`loadLibrary()` 返回 `{data,error,rejected}`——
  坏条目逐条跳过并计入 rejected（其余全部保留），`error` 仅在**整包不可读**时非 null；
  整包损坏时编辑器页与库页**都拒绝把空库写回**（只允许显式文件导入替换）。
- **求解器**（移植自 rubik-cube.html，纯 TS、无运行时依赖）：`src/cube/solver/`——
  engine（54 贴纸引擎+code 置换表）、search（ItemSolver PDB/IDA*/descend）、
  algs（OLL/PLL/CMLL 坐标 + 逐条核验的内置 LL 公式库 + algGraph）、f2lTable（150 case）、
  cfop/roux 阶段解、`solve.ts` 入口 `solve(state, method)`（自动处理中心漂移并映射回
  真实魔方，重放校验 isUniform）；GamePage「求解」面板（方法切换/阶段展示/演示）。
  验证：`node scripts/smoke-solver.ts` / `scripts/smoke-solver-edge.ts`（tsx）、
  `scripts/playtest-solver.mjs`。
- **验证套件**：`npm run typecheck` / `npm run build` / `npx tsx scripts/verify-data.ts`
  （手法数据契约+迁移+库容错+API 循环单测）/ `npx tsx scripts/verify-hand-mesh.ts`
  （手部几何自检：镜像/绕向/极值）/ `npx tsx scripts/verify-hand-store.ts`
  （手部配置单例：深冻结/返回副本/旧档迁移兜底，已进 CI）+ playtest（下行）。
  渲染类改动必须真机验证后再提交。
- playtest：`node scripts/playtest-ui.mjs`（先起 dev server，SPIKE_URL 指向非 5173 端口）。
  **浏览器回归矩阵**：`node scripts/verify-batch2-browser.mjs`（A–H 八项：库加载容错/
  帧重映射/帧号上限/手部单例/绕向+镜像/API 所有权+循环/关键帧面板/快照+复制；支持
  `--only=A,B`；任一 FAIL 退出码非 0）。**dev server 只能用 localhost**（vite 监听 IPv6
  ::1，`127.0.0.1:5174` 会 ECONNREFUSED）。**写浏览器脚本时注意坐标空间**：应用在 `<html>` 上有
  全局 CSS 缩放（`motion-cube.uiScale` 默认 1.5）——`offsetLeft` 是布局 px、`clientX` 是视口 px，
  差 1.5 倍；像素↔帧标定必须用 `getBoundingClientRect()`（与产品同一坐标系），否则落点会差 1.5 倍。
- **reference/（gitignore，全程不入库，仅本地参考）**：`3-style-v5/三盲三循环818-魔方根.xlsx`
  （3-Style V5 盲拧三循环 818 条，中文版，已替旧彳亍法档）、`mihlefeld-alg-trainers/`
  （Alg-Trainers 仓库原始 JSON：3x3-ZBLL 472 条 / 3x3-ZBLS 302 条，含 a[] 算法+s 打乱）、
  `new-refs/notes-new-refs.md`（参考说明）。旧彳亍参考（1943/chichu/This.exe/_work）已删。
