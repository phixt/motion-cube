# 项目 TODO 与进度（motion-cube）

> 更新：2026-08-20　✅ 已完成 ｜ 🚧 进行中 ｜ ⬜ 待办
> 唯一进度/待办文档（合并自 progress.md、rubik-anime-lab-migration.md；旧文档
> base/start/formula/docs_old/migration-vue-winui-plan 已归档删除；params.md 保留）。

## 当前状态

- 版本 **0.3.5**（package.json 与 src-tauri/tauri.conf.json 同步）
- 求解器：CFOP / CFOP+（一步 ZBLL + 回退）/ Roux（LSE 4a+6E2C）三方法全绿
  （typecheck + smoke-solver + smoke-solver-edge + verify-data）
- 一步 ZBLL 覆盖 52.5%（M2 变体闭包，1944 轨道，prepare 0.5s）；未覆盖回退 OLL+PLL
- ZBLS 305 条落库接入 solve 链（F2L×3→ZBLS→一步 ZBLL，显示排除 F2L）
- 技术栈：Vite 8 + Vue 3.5 + cubing.js（TwistyPlayer + cubing/alg）+ three.js（手模型）

## 活跃待办

### 求解器 / 公式库
- ⬜ **EOLR 一步表命中率 ~0**：lse-eolr 46 case 建表仅收全 EO 22 条；精确指纹匹配
  命中率 ~0，需改 EO 分类匹配（见「Roux LSE 改造」进度）
- ⬜ **cfop-adv 微优化**：一步 ZBLL 命中 12/24（50%），命中均步 59.4 ≈ CFOP，
  miss 均步 68.4（多 ~9）；ZBLS miss 时先探测 4 种 AUF 的 zblCode 再决定是否付
  zbl-eo（EO 预置是额外开支）
- ⬜ **CFOP 进阶集**：快速十字（预判）+ 高级 F2L（双向/多槽 multislot）
- ⬜ **Roux 进阶集**：LSE 4b+4c 合并一步、EOLR 之上更优解法
- ⬜ **高级方法**：降群（Thistlethwaite/Kociemba）、ZZ（EO-Line → 桥 → 顶层）；
  ZBLL 需改前置公式与棱定向预置配合；Roux EOLR 爬取 cuberoot + 4b 伪 UL/UR 带入
  6E2C（L10P/4E2C 子状态）
- ⬜ 新集合爬取：复用 `scripts/gen-cuberoot-algs.mjs` 管线，加进 SETS 即自动清洗/校验

### 动画编辑器
- ⬜ **搜索优化**：模糊搜索（子串/编辑距离/拼音）、标签过滤、分类过滤
- ⬜ **左右手同时显示**：数据层大改（Pose 手型维度/双实例 + HandRigView 双实例 +
  标定/示例适配），最后做
- ⬜ **自定义开始状态 UI**：正放/倒放均可自定义起始态（公式页适配）；缺省回退
  正放=公式逆序状态、倒放=还原态（已实现）
- ⬜ **拍扩展**：接触轨道按拍编辑；关键帧箭头拖动吸附拍网格；拍网格吸附开关

### 桌面版（tauri）
- ⬜ **双标题栏**：decorations:false + 自绘标题栏（data-tauri-drag-region + 窗口按钮）
- ⬜ **icons 占位替换**：现复制自 gomoku，发布前替换
- ⬜ **严格隐藏逻辑**：对象级显隐（魔方/左右手）与点选/命中交互规则统一
- ⬜ **playtest 并入 CI**：networkidle0 卡点解决后再并入 ci.yml

### 技术债 / 长期
- ⬜ 调试后门 `window.__motionCube` 加 DEV 守卫；无 CSP
- ⬜ 标定页每次输入全量重建 3D 几何（P1，防抖+rAF）；drawRuler 全量重建（P2）
- ⬜ 动画抽搐/真实卡顿感（连击冷却已基础版 120ms）；圆弧等函数路径

## rubik-anime-lab 迁移/合成计划（2026-08-20 新建，未动工）

> 参考文件已入库 `reference/`（分析用，不入 3D 渲染依赖）：
> - `reference/rubik-anime-lab.html`：上一参考实现（原
>   `rubik-anime-lab-0b0c6984.zip`，已分析）
> - `reference/rubik-cube.html`：求解器移植来源（可读源，48xx 行）
> - `reference/rubik-v4promax.html`：v4 增强版单文件 build（minified，含
>   Three.js；动漫卡线渲染 + 表面拖转 + CFOP/Roux 分步演示）

### LSE 部分
- ⬜ 保留我方 **4a→6E2C 阶段结构**，不照搬「整体最优+事后切里程碑」（该文件 4b/4c
  常近空：全局最优把定向/归位穿插省步，EO 里程碑在序列末尾才首次满足）
- ⬜ 可选借鉴「两条路线取短」：整体最优 vs 阶段化，仅当显著更短且阶段非空时采用；
  注意步数不单调递减（演示可能先变乱再收）需评估
- ⬜ 校验口径：切里程碑用与求解同源的坐标判定（对齐 lse-eolr 指纹/U 中心判定）

### 交互部分（CubePlayer / GamePage）
- ⬜ **操作层高亮**：three.js 侧当前转动层加 emissive/tint；拖拽与播放移动都触发；
  以片当前 pos 判层（对齐我方 CUBIES pos）
- ⬜ **高可中断**：单一动画状态 + 队列，所有入口（拖转/跳步/打乱/复原/演示）先清
  再接管；播放被打断时状态机直接落位（无 Promise）
- ⬜ **任意角度拖拽**：Raycaster 拾面 → 拖向定轴（叉积）→ 连续角度跟随（±1.05π）
  → 松手最近 90° 取整 + 吸附动画；px90 换算保证缩放无关手感

### 重建思路：替换 cubing.js 渲染层
- ⬜ **阶段 0 接口收敛（先做，低风险纯重构）**：CubePlayer 抽象接口隐藏 cubing
  专属泄漏（`onThreeScene` 替代 `experimentalCurrentThreeJSPuzzleObject`、
  `requestRender` 替代 `experimentalCurrentVantages/scheduleRender`）；
  GrayOverlay/HandRigView/EditorPage 只依赖接口 → 之后替换只重写 CubePlayer
- ⬜ **阶段 1 渲染替换**：three.js 自建 26 块+贴纸（数据复用 solver/engine 54 贴纸 +
  stickering 坐标）+ rubik-anime-lab 交互特性
- ⬜ **阶段 2 语法层**：默认保留 `cubing/alg`（纯 TS 无 DOM，唯一消费方
  `src/notation/alg.ts`）；solver 与 3D 显示已解耦（engine 零 cubing 依赖）
- 风险：GrayOverlay/HandRigView 靠 cubing 场景重建回调自愈 + 按需渲染；坐标/色彩
  魔法数字（stickering ±1.5、CUBE_UNIT_WORLD=0.33、linearSRGB 管线）全要重推；
  懒渲染兜底（kickRender/kickTimers）可删但要保证快照恢复不丢帧；动画语义
  （experimentalAddMove cancel / jumpToEnd / timeRange）要重写保证等价

### v4pro max 参考分析（2026-08-20，只读）

> 来源 `reference/rubik-v4promax.html`（minified，5066 行，含 Three.js 单文件）。
> 基于它作阶段 1/2 的可借鉴特性，非照搬清单。

- ⬜ **动漫卡线渲染（零后处理）**：反转壳体描边（hull=黑底 BackSide 材质 + 1.02 放大
  盒体）+ MeshToonMaterial + gradientMap（0.28/0.55/0.8/1 色阶）+ 贴纸微 emissive +
  圆角贴纸几何；三光源 + shadowMap + 地面径向渐变紫光；背景旋转光芒/透视网格为纯
  CSS 可忽略
- ⬜ **表面拖转交互模型**：射线拾面 → 切向得分选轴 → 先锁轴 → 拖角带增益
  （1.8×，clamp ±π）→ 松手按最近 90° 吸附（可出 0/1/2/3 圈，0.32rad 死区）；
  5px 死区防误触；视角 orbit 带惯性 + 双指 pinch（5.6–17 clamp）+ 空闲自动旋转
- ⬜ **双解法 + 中心校正**：CFOP（十字搜索→贪心 F2L→OLL/PLL 表）与 Roux
  （FB/SB 块搜索→CMLL→LSE 4a/4b/4c）双路线，total/ms/verified 重放自检；
  「centre」阶段归位中心（与 solver 中心漂移处理一致，UI 化展示）
- ⬜ **Worker 求解**：求解器作为字符串经 Blob URL 跑 Web Worker，8s 超时降级
  inline，UI 不阻塞
- ⬜ **分步演示 UI**：底部播放条分阶段彩色进度段 + 标签、当前步大字 + 阶段名 +
  计数、首/上/播/下/尾 + 进度条点击 seek（pendingSeek 合并 + 直接 apply 快进）；
  右侧步骤按阶段分组、每步 chip 可点击跳转、当前 chip 自动滚动进视口；
  播放完 COMPLETE! 庆祝 + solved-badge；手动转动即失效旧解法并 toast
- ⬜ 工程韧性：boot try/catch + 非 WebGL 优雅降级；analysePixels 渲染帧采样贴纸
  颜色自检；单一动画队列 + isLocked() 门禁（与「高可中断」一致）

### 参考文件全面审查（2026-08-21，只读审查 + 用户采用决议）

> 子代理审查：`.research_zbll/` 全部 28 脚本 + 5 JSON；`reference/` 三份 HTML。
> 核心结论：rubik-anime-lab.html = 零依赖纯 WebGL 自建魔方，正是「阶段 0/1/2
> 渲染替换」的现成范本；52.5% 覆盖（926/1944）是 cuberoot 单源 family 闭包天花板。

**✅ 已确认采用（用户选定）**
- **R1 渲染替换三件套**（阶段 1 地基）：CubeCore 26 块模型
  （`newGeo`/`geoApply`，rubik-anime-lab L552-585）+ 拖转交互
  （L1868-1946：拾面→屏幕方向→角度累进→动量吸附最近 90°，含中间层）
  + 高可中断动画队列（L1764-1849：单状态+每帧 step+`anim=null` 即打断）
  —— B/C 逻辑可近乎直接照搬，几何/渲染按 three.js 翻译
- **R2 动漫卡线两遍渲染**（L1413-1459/1590-1654）：反向外壳（FRONT+expand）
  + SDF 圆角贴纸裁切 + 三段色调；three 侧用 ShaderMaterial 翻译
- **R3 快照重放分步演示 + LSE 里程碑切段**：`solGeo` 快照 + `jumpTo(k)` 重放前 k 步
  （L1966-2050）进 GamePage 演示；D2 按 predEO/predULUR 切 4a/4b/4c 演示边界（思路）
- **R5 coverage 回归工具**：`orbit_count`+`per_set_coverage` 逻辑（family
  并集 4 变体 canon）提取为 `scripts/verify-zbll-coverage.ts`（Node 原生
  TS strip-types 运行，勿用 tsx——WSL/沙箱 esbuild 平台不匹配）。当前报
  **926/1944（49.5% of 1872）**，各 set 断言：T148/U152/L226/Pi148/S232/AS234/H87，
  与 .research 全对齐。（实现为 .ts 而非原决议 .mjs：直接复用主引擎，先做
  贴纸一致性校验，避免双引擎重复）
- **R6 实现 mirrorAlg + mirrorState**：落地 `engine.ts`（与 invertAlg 同级）——
  MIR 表（analysis.mjs）+ x/z 面贴纸反射（sticker_analysis.mjs）+ R↔L/F↔B 重标。
  **重大语义修正**：绕镜像法线轴（x）的步 M/M'/M2、x/x'/x2 **方向保持不翻转**
  （贴纸反射下与 x 轴转动对易，探针实证；其余照 M2 表）。恒等式校验内置于
  R5 工具（单步+300 随机序列 mirrorAlg∘apply == mirrorState∘apply，354/354，
  mirror 对合 200/200）——决议要求的「贴纸引擎与主 engine.ts 一致性校验」即此。
- **R8 v4pro 交互增强**：undo（逆向）、键盘（space 暂停/Z 撤销/方向键单步/
  键入 UDRLFBMS/Alt+S 打乱）、复制解法到剪贴板、COMPLETE 庆祝+solved-badge+toast
- **R10 oc 阶段摘要 HTML**：解法分阶段摘要视图（phases 列表+各阶段步数），
  与现有 solve panel 阶段展示合并参考

**⬜ 暂缓 / 未采用**
- R4 记谱宽层展开+化简（parse/simplify）：cubing.js 已覆盖大部分，仅 simplify 可能有用
- R7 zbll_map 双源并集闭包：唯一可突破 52.5% 的路径，但需先量化 union 再决定
  （风险中高，暂缓）
- R9 Dx 中心校正 + verified 重放自检：主项目已覆盖中心漂移处理，印证为主
- 明确不复用：`debug_*`、空 `roman_canons.json`、cubing.js 依赖脚本

**README 引用声明（待办）**
- ⬜ 采用参考实现后，在 README 添加致谢：「部分实现思路（具体写出）参考或者
  直接采用了灰测群群友跑出来的魔方」——待用户确认最终措辞/指向后再写入

## 已完成批次（摘要）

- **0.3.2 求解器移植**（08-19）：54 贴纸引擎 + search（PDB/IDA*）+ OLL/PLL/CMLL
  图库 + F2L 表 + CFOP/Roux + solve 入口 + GamePage 求解 UI；smoke + puppeteer 全绿
- **0.3.2 内置公式库**（08-19）：cuberoot.me 爬取 9 集合 241 case + 54 贴纸语义
  校验 + BUILTIN_LIBRARY + 公式库页加载按钮
- **0.3.3 游戏页+演示**（08-20，d58ad5c）：求解面板（方法/阶段/演示/复制）、打乱
  按钮、恢复进度/打乱后 3D 显示修复、求解表空闲预热
- **0.3.4 ZBLL/ZBLS 全覆盖**（08-20，8f75a5c）：解析器 `[2345]'` 记法；zbll 466→472；
  全阶段禁 tidyAlg 不消步；ZBLS 305 落库接入；GamePage cfop-adv；一步 ZBLL 查表
  （52.5% 覆盖 + 回退 OLL+PLL，prepare 0.5s）
- **0.3.5 本轮**（08-20）：打乱 3 倍速播放；Roux LSE 改造（4a→6E2C、EOLR 一步表）；
  6 色底双模式（跟随设置底/固定 D）；cfop-adv 中性发现（反例入
  `data/samples/cfop-adv-zbll-case.json`）
- **更早（08-06~08-13，归档）**：Vue/WinUI 迁移、动画编辑器全量迭代、拍概念、
  标灰面板、首页视差、tauri 桌面版、安全审查等，详见 git log

## 工程约定

- 端口 **5173** 为用户日常预览；本项目 dev/playtest 用 **5174** 或其它非 5173 端口
- 版本号 package.json 与 src-tauri/tauri.conf.json 必须同步（tauri 打包以 conf 为准）
- 提交：不 amend、不擅自 push；功能/修复提交时评估 bump
- 验证命令：`npm run typecheck` / `npm run build` / `node scripts/smoke-solver.ts` /
  `node scripts/smoke-solver-edge.ts` / `node scripts/playtest-ui.mjs`（SPIKE_URL 指向非 5173）