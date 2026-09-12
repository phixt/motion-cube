# 项目 TODO 与进度（motion-cube）

> 更新：2026-09-12　✅ 已完成 ｜ 🚧 进行中 ｜ ⬜ 待办
> 唯一进度/待办文档；已完成内容只留版本级摘要，轮次明细看 git log（提交信息承载）。

## 当前状态

- 版本 **0.4.1**（package.json 与 src-tauri/tauri.conf.json 同步；2026-09-12 发布
  bump 7f43162——内容=手部 low-poly 细化十二~十六轮 + 双手显示/独立编辑/主位手规则
  十七~十九轮 + 外部注入 API A 期与文档；本地编译已交付，发布由用户执行）
- 求解器：CFOP / CFOP+（一步 ZBLL+回退）/ Roux（LSE 4a+6E2C）三方法全绿；一步
  ZBLL 库完整 **493/493**（case 级覆盖 100%；52.5%/926 为已废弃轨道级错口径，实际
  问题在命中率口径）；ZBLS 有效全集 **302**（O 组 3 条全槽已解已决议剔除——剔除与
  端到端验证在 feat/zbll-import-verify 分支，main 数据仍为 305）；解法底多选
  （整块旋转 + 中心 relabel，逐底求解取最短，34/34 验证）
- 技术栈：Vite 8 + Vue 3.5 + cubing.js（TwistyPlayer + cubing/alg）+ three.js（手模型）

## 活跃待办

### 手部
- ⬜ 用户**真机定版**十二~十六轮手部观感（feat/hand-lowpoly 分支保留至定版后删）。
- ⬜ **碰撞箱**：手-魔方简化相交判断（段级 AABB/胶囊代理），供接触可行性校验 /
  自动姿态 / 穿透检测。

### 编辑器批
- ⬜ **自定义开始态批**（下一轮开工项）：标灰页小魔方默认转动了 U 的 bug +
  正放/倒放起始态统一 + 自定义开始状态 UI（公式页适配；缺省回退正放=公式逆序态、
  倒放=还原态已实现）。
- ⬜ **搜索优化**：模糊搜索（子串/编辑距离/拼音）、标签/分类过滤。
- ⬜ **拍扩展**：接触轨道按拍编辑；关键帧箭头拖动吸附拍网格；拍网格吸附开关。

### 渲染线（重点）
- ⚠ **兼容注意**：R1 渲染替换处于半替换状态（游戏页已回退 cubing，
  RenderCubeHost/RenderDemo 库内休眠）——手部经 `CubePlayer.onThreeScene` 挂载
  自愈；渲染线推进必须回归验证手部挂载/显隐/接触点，且**渲染类改动必须真机验证
  后再提交**。
- ⬜ **速度滑条统一 + 高可中断队列重构**（重点；含遗留：播放中改速「停顿补满」、
  打乱中改速无效）。
- ⬜ **R1 接驳余项**：CubePlayer 默认切 RenderCube 后端 / EditorPage 自建宿主
  （最大工程）/ 最终视觉对比（有点难，缓）。
- ⬜ R8/R10/R3 交互演示增强（可考虑）；R2 视觉层并行后置。

### 公式 / 盲拧线（整体后移；远期优先级：桥式高级 > cfop 高级 > 盲拧）
- 方向：**自建推导**——盲拧以 8+18 基础公式推导拓展至全 818 条（3-Style V5 xlsx
  仅参照不做数据源，reference/ 已入库）；zbll 问题在命中率口径非库完整性（493/493）；
  桥式高级推导相对容易。
- ⬜ 3-Style V5 深度解析 + 公式库重新形式化接入。
- ⬜ **公式线分支并回+重启**：`feat/zbll-import-verify`（已封存）内含——口径冻结
  （主口径=库完整性 493/493；verify-zbll-coverage 重写、删 coverage-zbll.mts、新增
  find-zbls-diff-3）+ ZBLS 剔 O 组（305→302，留档 docs/archived/）+ 轮样本验证
  `verify-zbls-rounds.ts` A–E 全绿（D：493 端到端全解回）+ **Y_TO_FR 回滚**（已证实
  局限：非 FR 缺槽时 ZBLS 查表脱靶、静默回退 = 0.3.8 生产行为；F 段转报告型）+
  32 条「棱 home 角乱」建表局限。重启 = 并回 main（main 仍跑旧 926/1944 工具与
  305 数据）→ 修建表-查表口径（命中率为真实收益问题；路线图优先级：桥式高级 >
  cfop 高级 > 盲拧）。
- ⬜ EOLR 一步表命中率 ~0（lse-eolr 46 case 仅收全 EO 22 条，需改 EO 分类匹配）。
- ⬜ cfop-adv 剩余（「补全 ZBLL 库/双源并集闭包」议题已被口径冻结终结——库完整
  493/493，真实问题在建表-查表命中率，见上「分支并回+重启」项 / EO 预置
  并入首步；深工程暂缓）；CFOP 进阶集（快速十字+高级 F2L）；Roux 进阶集（4b+4c
  合并一步、EOLR 之上）；降群/ZZ。
- ⬜ 新集合爬取：复用 `scripts/gen-cuberoot-algs.mjs` 管线，加进 SETS 即自动清洗校验。
- 🗄 **封存分支**（不并入，随时 cherry-pick 找回）：feat/hand-thumb-normalize＝
  盲拧彳亍法档案（编码立方体建库 6b716d7 + 说明页 3D 展示 e1b4ace，**未入 main**；
  公式表接入未完成，待接完再评估合入）；research/solver-advanced＝求解器进阶研究
  档案（EOLR 实证 / 降群 ZZ 参考，结论参考价值有限）。
- ⬜ **回退意向·暂缓**：方法面板移除 cfop-adv / roux-adv 选项（底层公式库休眠
  保留），等基座确认后执行。
- ⬜ README 致谢声明：参考实现采用后添加（措辞/指向待用户确认）。

### 桌面版（tauri）
- ⬜ 双标题栏（decorations:false + 自绘标题栏）；对象级显隐与点选/命中交互规则统一；
  playtest 并入 CI（networkidle0 卡点解决后）。
- ⬜ **MCP 预览服务**：截图/状态查询，方便 AI 写作时实时查看渲染与页面状态；与
  注入 API（A 期已实现+真机验证通过，B 期帧流暂缓）共用底层能力。

### 技术债 / 长期
- ⬜ CSP；动画抽搐/真实卡顿感（连击冷却基础版 120ms）；圆弧等函数路径。
- ⬜ 发布三件套、求解器进阶集：再议。

## 已完成批次（摘要）

- **0.4.1**（09-12）：发布准备——bump + README/AGENTS/todo 三文档同步（README
  项目结构树）+ tauri 本地编译（MotionCube_0.4.1_x64-setup.exe，启动截图验证）。
- **0.4.0**（09-12）：① 手部 low-poly 重构（handMesh 截面放样生成器 + v4 shape
  数据层 + 标定页造型面板，feat/hand-lowpoly 合并入 main）+ 真机细化十二~十六轮
  （指蹼双凹/自发光口径/四指加粗 fingerWidth/根窝下压 ROOT_EMBED/填充棱+掌侧肌凸/
  掌前缘斜坡 frontFaceZ/标定页 HandOrbitView 交互视图）；② 双手显示与独立编辑
  十七~十九轮（left/right 显式双轨 keyframes 旧档迁移、默认不镜像关联、主位手规则
  （双手右手主位/单手默认左手可换）、默认手位 ±1.95 贴面拇指上、handScale 1.85、
  B 键双手切换）；③ 外部注入 API A 期（window.motionCubeHand，DEV 限定）+ 文档
  三件套 + 真机验证通过。
- **0.3.8**（09-06）：拇指 CMC 三轴重校 + 新应用图标（icon-lab 工具入库）。
- **0.3.7**（08-22）：速度体系统一（s/步单基准）+ 单色底真正生效（setupAlg 旋转 +
  中心 relabel）+ 多色底多选；解法底动态 setup/endAlg 修复（34/34 + 情景矩阵 22/22）。
- **0.3.2–0.3.6**（08-19~08-21）：求解器移植（CFOP/Roux 全绿）、内置公式库 241 case、
  GamePage 求解面板、ZBLL/ZBLS 全覆盖、Roux LSE 改造（4a→6E2C）、解法底选择 v1。
- **更早**（08-06~08-13）：Vue/WinUI 迁移、动画编辑器全量迭代、首页视差、tauri
  基座等，见 git log。
- **参考决议（渲染线已采用）**：R1 三件套（26 块模型+拖转+高可中断队列）、R2 动漫
  卡线两遍渲染、R3 快照重放分步演示、R5 覆盖率回归工具、R6 mirrorAlg/mirrorState
  （engine.ts，354/354 校验）、R8/R10 交互增强；未采用项（R4/R7/R9）明细见 git
  历史版本的本文件。

## 工程约定

- 端口 **5173** 为用户日常预览；本项目 dev/playtest 用 **5174** 或其它非 5173 端口
- 版本号 package.json 与 src-tauri/tauri.conf.json 必须同步（tauri 打包以 conf 为准）
- 提交：不 amend、不擅自 push、不打 tag（tag 触发 Release CI）；功能/修复提交时
  评估 bump
- 验证命令：`npm run typecheck` / `npm run build` / `npx tsx scripts/verify-data.ts` /
  `npx tsx scripts/verify-hand-mesh.ts` / `node scripts/smoke-solver.ts` /
  `node scripts/smoke-solver-edge.ts` / `node scripts/playtest-ui.mjs`
  （SPIKE_URL 指向非 5173）
