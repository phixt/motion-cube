# 求解器与交互整改方案（情况整理，待确认后按小步执行）

> 状态：2026-08-20 整理稿。本轮**不执行**，仅盘点现状 + 定位问题 + 排难易先后。
> 按用户要求：优先持久化 → 每次选一个小方面执行 → 完成后询问是否继续。

## 1. 情况盘点（完成度 + 证据）

### 1.1 求解器现状（feat/solver 分支，全部已提交）
- 已有提交链：`eafa7da`(R5/R6) → `c91c531`(阶段0 接口) → `b142a37`(阶段1 渲染核心) →
  `8a69046`(阶段1 接驳宿主 + render-demo + 验证) → `0f41e37`(本轮：cfop-adv 双路线取短、
  roux 普通入口恢复、CubePlayer render 后端双轨)。
- 方法枚举 `cfop|cfop-adv|roux|roux-adv`（`src/cube/solver/solve.ts` SOLVER_METHODS）。
- **普通实现**：
  - cfop = cross → F2L×4 → OLL/PLL（`src/cube/solver/cfop.ts` solve，分步人类式，`solveOllPll` helper）。
  - roux = block1/block2 → CMLL → LSE 4a eo / 4b ulur / 4c lse4c（`roux.solveBasic`，分步）。
- **高级实现（问题所在，见 §2.1）**：
  - cfop-adv = F2L×3 → 第4槽 min(F2L, ZBLS) → LL min(EO预置+一步ZBLL, 普通)——**双路线取短**，
    实测 24 样本 0/24 变劣、均值 61.21 ≤ 61.58。
  - roux-adv = EOLR + 6E2C（`l4e` 整段搜索，含 cornerUFR 处理）——**LSE 一次算完**。
- 数据：`data/samples/cuberoot-algs.json` 241 case（zbll 472 条、zbls 305 条落库）；一步 ZBLL
  查表 M2 闭包 **52.5% 覆盖**，未覆盖回退 OLL+PLL；**EOLR 一步表命中率 ~0**（46 case 仅全 EO 22 条，指纹匹配需改）。

### 1.2 播放速度：单一滑条（证据确凿）
- `src/vue/pages/GamePage.vue`：`speed ref(1)` + WinSlider 0.1–3.0 StepFrequency0.1；
- 打乱与解法演示**共用** `delay = Math.max(60, 420 / speed.value)` 渐步播放（L160 与 L220）。
- `watch(speed)` → `session.setSpeed`。
- 结论：todo「打乱 3 倍速」实为「上限 3x」，**无独立默认 3x**；用户要求打乱默认 3x 与正常播放滑条分离。

### 1.3 可中断性：糟糕的真正根源在默认 cubing 后端
- `src/cube/CubePlayer.ts` 双轨：**cubing 轨为默认**（`element = TwistyPlayer`），
  play = `element.play()`（时间轴连续播放，**不可中途暂停/不可任意改速**）；pause = `element.pause()`。
- **render 轨已具备可中断**：`play()` 每步 `playMove`（动画可被下一动截断）、`pause()` 清「继续播放」
  标记（当前动画自然结束即停）、`undoLastMove()` = `renderCube.undo()`（弹历史）。
- GamePage 已有播放条 `btn-play` togglePlay → `session.player.play()/pause()` + `onPlaying` 回调。
- 结论：**可中断组件层已完成（render 轨），只差消费页从 cubing 切到 render**——这是本轮最关键的澄清；
  用户感知的「重建进度不行」大部分是未切换造成。
- 旧版「中途暂停」在 editor 帧系统有历史（git：45acfeb 空拍/pause 步、2393875 暂停任意、b2a416、
  e945e65）——属编辑器时间线（rubik-anime-lab 路线），不是 solver 播放条的问题。

### 1.4 cubing.js 替换程度
- 已替换：求解器（`src/cube/solver/` 纯 TS，engine/algGraph/阶段解自建）；渲染组件层
  （pose.ts + RenderCube.ts + RenderCubeHost.ts）。阶段0 接口收敛已隐藏 cubing 专属调用
  （onThreeScene/requestRender），消费方只依赖接口。
- **未替换**：消费页仍全 cubing（EditorPage/GamePage/RenderDemoPage 中前者两页未切 render）；
  阶段2「语法层 cubing/alg」未做。GrayOverlay/HandRigView 依赖 cubing 重建回调 + 按需渲染，
  场景挂载仍走 cubing。

### 1.5 技术债清单与完成度
- ⬜ 双标题栏（decorations:false + 自绘 + data-tauri-drag-region）——**未动**
- ⬜ icons 占位替换（复制自 gomoku）——**未动**
- ⬜ 严格隐藏逻辑（对象级显隐与点选/命中规则统一）——**未动**
- ⬜ playtest 并入 CI（networkidle0 卡点）——**未动**
- ⬜ 动画抽搐/真实卡顿感（连击冷却已基础 120ms）——部分
- ⬜ 标调页重建优化、`window.__motionCube` DEV 守卫——**未动**
- 结论：桌面/壳侧技术债几乎全部未动；可独立成小步逐项清。

### 1.6 版本与文档
- package.json / tauri.conf.json version 须同步（0.3.5 时代）；README 引用声明+实现点未写。

## 2. 核心诊断（对齐用户四项意见）

### 2.1 「懒解法」形态识别（用户核心意见）
用户原文：「不要参考一个参考文件中的懒解法（有一个参考文件 4a 很长，4b4c 几乎没有），
解法应该是符合人类思考的，而不是用某种算法算出 8-10 步直接完成但是伪装成某个步骤，这是核心。」

我方现有实现中**恰有两个此形态**：
- `roux-adv` 的 `l4e` 6E2C 整段搜索 =「LSE 一次算完」：EO 表很长（涵盖 4a 环节），4b/4c 并入
  一次搜索（环节几乎没有）——同参考文件「4a 很长、4b4c 几乎没有」的形态。
- `cfop-adv` 的「一步 ZBLL 伪装成 LL 阶段」= 8-10 步直接完成 LL，非人类式 OLL→PLL 分步。
整改原则：**普通解法 = 人类式分步（每阶段一个清晰目标，逐步推进）；高级只做「真进阶」
（预判/技巧/少步算法），且绝不伪装阶段**。

### 2.2 「高级解法不应常驻」
用户设想：点 cfop → 偏右侧弹出选项（如勾选 zbll）；点 roux → 弹出 eolr、合并 4b+4c 复选框。
高级是**方法面板内的可选项**，不在方法列表常驻。方向：方法面板重构（cfop 与 roux 各自二级选项）。

### 2.3 普通 = 旧版简单稳定实现
用户：「cfop 和桥式参考之前版本的完成（可以备份目前的，短暂恢复之前的实现，然后确保和之前的
简单稳定实现一致）」。
- 旧版源头：`3e30423`（0.3.2「移植 rubik-cube.html CFOP/Roux 求解器」）+ `d343ba9`（暂存）。
- 流程：当前已全提交（安全）→ 恢复旧版普通实现为默认 → 与旧版行为逐样本对比（一致性校验）→
  保留新数据/新表（zbll 472 等）仅作为高级数据，不污染普通。

### 2.4 高级须先调研、数据支撑
- zbll「表现很差」（一步表 52.5% 覆盖 + M2 闭包口径存疑）；EOLR 命中率 ~0（46 case 仅 22 全 EO）。
- 先出**调研结论文档**（zbll 真覆盖评估、roux 高级路线评估，含 cuberoot 数据核验），再决定实现。

## 3. 整改方案（分层，每层可独立成小步）
> 更新 2026-08-20（P0.5/P1 已执行，见 §6）：

- **L1 解法语义**：roux 分步（4a/4b/4c 每步独立目标，默认不合并伪装）；cfop 分步（F2L×4+OLL+PLL）。
  高级=真进阶选项（roux: eolr 勾选/合并 4b+4c 勾选；cfop: zbll 勾选——真覆盖数据支撑）。
- **L2 交互重构**：方法面板点开 cfop → 右侧二级选项区（zbll 开关）；点开 roux → eolr / 合并 4b4c
  复选框。高级选项不预展开、非常驻。
- **L3 播放速度分离**：打乱默认 3x（独立 delay），正常播放/演示走滑条 speed（0.1–3x）。
- **L4 可中断落地**：把消费页（至少 GamePage 求解演示 + 播放条）切到 render 后端；EditorPage
  需自建宿主循环（Scene+PerspectiveCamera+WebGLRenderer+rAF）后再切。
- **L5 调研先行**：zbll 覆盖评估、roux 高级路线（cuberoot eolr 表核验）→ 结论文档 → 再实现高级。
- **L6 持久化/回退**：全已提交（feat/solver）；旧版恢复用 git 恢复 + 对比脚本（两代输出 diff）。

## 4. 难易 × 先后排序（P0 → P3）

| 序 | 任务 | 难度 | 依赖 | 说明 |
|---|---|---|---|---|
| P0 | 持久化核对（git 干净、全部提交） | 低 | — | 已基本完成，含 0f41e37 |
| P0.5 | 旧版普通实现恢复 + 一致性对比 | 中低 | P0 | 立普通稳定基线，先于一切求解器改动 |
| P1 | L3 播放速度分离（打乱默认 3x） | 低 | — | 独立小改 GamePage，可先做 |
| P1 | L2 方法面板选项弹出式（cfop/roux 二级） | 中 | 求解器枚举稳定 | 交互重构，不涉及算法 |
| P1 | L4 消费页切 render 后端（GamePage 先行） | 中高 | 阶段1 组件已 ready | 可中断立即兑现；EditorPage 宿主循环后置 |
| P2 | L5 zbll / roux 高级调研 | 中高 | — | 数据驱动，先出结论文档 |
| P2 | L1 高级算法重构（依调研结论） | 高 | P2 调研 | zbll 真覆盖 / roux 分步高级 |
| P3 | 技术债逐项（桌面侧）/ 阶段2 语法层 / README+版本 bump | 中 | — | 独立小步，穿插执行 |

## 5. 执行节奏（用户已确认）
- 每次**只选一个小方面**执行并验证（typecheck + smoke-solver + verify 全绿）→ 提交 → **询问是否继续**。
- 优先持久化（每次改动即提交），不并行堆叠。

## 6. 执行记录（2026-08-20：P0.5 + P1 完成）
### P0.5 普通解法对齐旧版（已完成）
- **结论（静态逐行对照 git 3e30423 vs 当前）**：
  - cfop 普通（`CFOP.solve`）与旧版 `solve` **逐行一致**（cross→F2L×4 贪心最短→OLL(tidy)→PLL(tidy)），无需改。
  - roux 普通（`ROUX.solveBasic`）与旧版 `solve`（block1→block2→cmll→eo→ulur→l4e）
    唯一差异 = 4c 用新 `lse4c` 表（无角）。**已对齐**：roux.ts solveBasic 4c 改用
    `T.l4e`（LSE_EDGES+centerU+cornerUFR，depth16/6e6，short"4c L4E"），与旧版逐行一致。
- **基建（顺带，`优先持久化` 导向）**：`src/cube/solver/` 全部 39 处无扩展相对 import 补
  `.ts` 扩展 + 3 处 JSON import 加 `with { type: "json" }`（先例 = pose.ts 已带扩展）。
  → **solver 全链可在 Node strip-types 下直接运行**（原只能用 tsx/Windows）。
  typecheck 全绿。
- **实测基线**：`node scripts/record-solver-baseline.ts`（LCG seed 0x51a7 可复现，
  N=60×12步 + N=10×20步），4 方法 fail=0；普通方法**人类式分步契约 70/70 = 100%**：
  - cfop 阶段序列 cross→f2l1..4→oll→pll；roux 阶段序列 block1→block2→cmll→lse-eo→lse-ulur→lse-4c
  - 步数：cfop avg59.2/max72、roux 普通 avg48.3/max60、cfop-adv avg57.6、roux-adv avg45.6
  - **佐证用户判断**：roux 高级仅比普通省 ~2.7 步（48.3→45.6），cfop-adv 几乎不省
    （59.2→57.6）——高级数据收益弱，与「zbll 表现差/roux 合并一般」一致，调研方向确认。
  - 存档 `docs/solver-baseline.json`（后续回归对照）。
### P1 播放速度分离（已完成）
- GamePage `scrambleCube`（打乱播放）改为**固定 3 倍速** `delay=Math.max(60,420/3)`，
  **独立于滑条**（用户确认：打乱默认 3x）；`demoSolve`（解法演示）仍由 speed 滑条
  （0.1–3x）控制。注释已更新。
### 待办（下一轮小步候选）
- P1 方法面板二级弹出（cfop→zbll 勾选、roux→eolr/合并4b4c 勾选；高级不常驻）
- P1 GamePage 消费页切 render 后端（可中断兑现）
- P2 zbll/roux 高级调研结论文档
- P3 技术债逐项 / 阶段2 语法层 / README+版本 bump