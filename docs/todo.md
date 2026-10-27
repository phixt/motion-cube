# 项目 TODO 与进度（motion-cube）

> 更新：2026-10-27　✅ 已完成 ｜ 🚧 进行中 ｜ ⬜ 待办
> 唯一进度/待办文档；已完成内容只留版本级摘要，轮次明细看 git log（提交信息承载）。
> 2026-10-27 新增「代码审计轮」一节（全面代码审查结论，详见 docs/audit/REVIEW-2026-10.md）。

## 当前状态

- 版本 **0.4.1**（package.json 与 src-tauri/tauri.conf.json 同步；2026-09-12 发布
  bump 7f43162——内容=手部 low-poly 细化十二~十六轮 + 双手显示/独立编辑/主位手规则
  十七~十九轮 + 外部注入 API A 期与文档；本地编译已交付，发布由用户执行）
- 求解器：CFOP / CFOP+（一步 ZBLL+回退）/ Roux（LSE 4a+6E2C）三方法全绿；一步
  ZBLL 库完整 **493/493**（case 级覆盖 100%；52.5%/926 为已废弃轨道级错口径，实际
  问题在命中率口径）；ZBLS 有效全集 **302**（O 组 3 条全槽已解已决议剔除并留档
  docs/archived/，剔除随 feat/zbll-import-verify 并回 main 生效）；解法底多选
  （整块旋转 + 中心 relabel，逐底求解取最短，34/34 验证）
- 技术栈：Vite 8 + Vue 3.5 + cubing.js（TwistyPlayer + cubing/alg）+ three.js（手模型）
- **2026-10-27 代码审查**：typecheck / build / CI 六脚本本地全绿；i18n 中英 346 键零缺失；
  求解器引擎核心零缺陷。但查出 **23 条 P0/P1「静默失效」型缺陷**（内置库丢 50 条、
  ZBLL 分类缺失、ZBLS 命中率 0、roux-adv≡roux-merge、整块旋转表只覆盖 16/24 朝向、
  左手填充棱几何内翻、mirrorPose 拇指二次取反、整库清空数据丢失等），
  以及 125 条 P2 技术债 —— 详见下方「代码审计轮」。

## 活跃待办

### 代码审计轮（2026-10-27 新增）
> 全面代码审查结论：**docs/audit/REVIEW-2026-10.md**（含逐条证据与复现方式）
> 分区明细：docs/audit/{editor,solver,hand,render,pages,infra}.md（第二轮 125 条）
> 性质多为「静默失效」——不报错、只是不工作，优先于新增功能。
>
> **第一批（零风险高收益，6 项）已修完**（2026-10-27）：内置库 663→**713 条**（找回 50）、
> ZBLL 472 条全部归入 `1LLL / ZBLL`、整块旋转表 16→**24 朝向**、three 显式声明、
> 版本号四处统一 0.4.1、dev 端口 5173→5174。回归全绿（typecheck/build/CI 六脚本/
> verify-solve-base 34/34/verify-zbls-rounds 2603 轮/i18n 对齐）。
>
> **第二批（8 项，1–2 天档）已修完**（2026-10-27）：手部配置单例（深冻结 + 返回副本）/
> 填充棱左右手绕向 / mirrorPose 拇指二次取反 / 手法库加载容错（坏条目跳过 + 禁止写回空库）/
> 帧重映射走校验（帧号重合拒绝写入）/ 单步时长与帧号上限 / 注入 API 外部驱动所有权 +
> playFrames 真循环 / 关键帧面板单一真相源 / 快照用完整序列 + 复制解法补 endAlg。
> 回归全绿（typecheck/build/CI 七脚本/verify-hand-store 9 断言/新增
> `scripts/verify-batch2-browser.mjs` 浏览器矩阵 8/8 PASS/playtest-ui 全流程 exit 0）。

**P0 静默失效（数据正确性）**
- ✅ **内置库丢 50 条**（已修）：生成脚本校验重新序列化串、入库存原始串 → 713 条只装进 663 条
  （zbll 47 / pll 3，缺空格）。修法落地：① 生成脚本改存 `parseAlg(key).join(" ")`
  （= 被校验的那一份），并把被跳过的字符改为**显式上报**（不再静默）；② 运行时
  `algDb` 改「先归一再校验」（`src/notation/alg.ts` 新增 `splitMoveTokens` 容错拆分
  连写缺空格 / 裸数字残留，语义与求解器引擎 `parseAlg` 一致）；③ 被拒条目计数并在
  公式库页显式提示「跳过 N 条格式非法」。**结果：713/713 全部装入、被拒 0 条，
  且与求解器引擎 parseAlg 语义 713/713 逐条一致**。〔algDb.ts / gen-cuberoot-algs.mjs〕
- ✅ **ZBLL 无分类映射**（已修）：426/673（63%）落进「未分类」。修：`CAT_MAP` 补
  `"zbll": { id: "cat-zbll", name: "ZBLL", parentId: "cat-1lll" }`，并把父分类
  `cat-1lll` 一并内置（悬空 parentId 会让 validateCategoryTree 抛错→整库加载失败）。
  **结果：ZBLL 472 条全部归入 `1LLL / ZBLL`，内置库未分类 0 条**。〔algDb.ts:26-36,61〕
- ⬜ **ZBLS 一步真实命中率 0**（实测 400 次求解 0 次；缺槽=FR 的 79 个也 0 命中）：
  建表键编码完整 LL 构型，与文件头「LL 任意」契约矛盾。修：按公式真正依赖的量重键
  （丢角置换/角朝向/棱置换）+ 恢复 `cfop.ts:166` 硬断言/命中计数。〔zbls.ts:40-44,71-85〕
- ⬜ **roux-adv ≡ roux-merge**（60/60 样本逐字节相同，EOLR 阶段从未出现）：
  EOLR 表建表用 `fp` 做键丢了 `um`，查表却用当前态的 `um` 还原前置旋转 → 键值口径不一致。
  修：键含 `um`；修好前方法面板合并或标注「等同」。〔roux.ts:61-70,114-124,163-188〕
- ✅ **整块旋转收尾表只覆盖 16/24 朝向**（已修）：`WHOLE_ROT24` 用 `z`（F 轴）当 D 轴自转，
  应为 `y`；实测 63 个终点朝向中 24 个不可达 → endAlg 返回 ""、演示收尾底色错。
  修法落地：spin 改 `y/y2/y'`；`finishRotBetween` 导出并加**回归断言**
  （`scripts/smoke-solver-edge.ts`：24 种朝向必须两两可达——用旧表跑该断言报
  「不可达 8」，新表 0，确属真回归守卫）。**结果：24/24 可达；verify-solve-base 34/34
  仍全绿（endAlg 现为 y/y'/y2 绕 D 轴自转）**。〔solve.ts:112-125〕
- ✅ **左手「指根间填充棱」几何内外翻转**（已修）：
  `buildKnuckleFiller` 注释写「x0<x1 由调用方保证」，调用点却是先乘 sideSign 再取 min/max。
  修法落地：调用点改为「先乘 sideSign 再取 min/max」（xs 数组 + Math.min/Math.max），左右手都满足
  x0<x1；verify-hand-mesh 新增「左右手同一部件法线外向度同号」断言（60 个部件逐一比较），
  修复前可抓红（右=+0.044 / 左=-0.044），修复后同号同量级。
  **口径校正**：审计标题「左手永远不可见」偏强——该棱是闭合实体，绕向翻转后轮廓仍在，
  真实症状是「法线内翻 + 着色反转」，由外向度变号精确刻画。〔handMesh.ts:810-814,571〕
- ✅ **mirrorPose 对拇指 CMC 二次取反** → 镜像出来的手拇指朝向错（已修）：
  `HandRigView` 已用 sideSign 做手性镜像，mirrorPose 又取反一次（实测偏差 0.960）。
  修法落地：mirrorPose 不再取反 thumbCMC.abduction/rotation（掌部世界变换 position.x 与
  四元数 y/z 仍取反）+ verify-hand-mesh 新增「左右手拇指世界方向互为 X 镜像」断言
  （three.js 复刻 applyPose 实算，误差 <1e-3，保留「CMC 三轴非零」用例才抓得到该 bug）。
  真机：编辑器「镜像到对侧」后偏差 0、qDot=1.0000004；API 路径同。〔HandRig.ts:93-115 / HandRigView.ts:154-158〕
- ✅ **一条坏手法即整库清空 + 下次保存写回空库**（永久丢失）（已修）：
  修法落地：loadLibrary 改返回 `{data,error,rejected}`——坏手法/坏公式/坏分类**逐条跳过**并计入
  rejected（其余全部保留），error 仅在**整包不可读**（JSON 损坏/分类树非法）时非 null；
  编辑器页整库损坏时**拒绝 saveLibrary 写回**并状态栏报错；**库页同源漏网路径一并堵住**
  （原先库页 persist() 会把空库写回 = 永久抹库，现整库不可读时拒绝增量写回，仅显式文件导入可替换）。
  verify-data 增 3 条断言。〔libraryStore.ts:17-25,66-72 / LibraryPage.vue〕
- ✅ **帧重映射绕过校验 → 重复帧关键帧 → 手法不可编辑并污染库**（已修）：
  修法落地：帧率切换/单步时长/插空拍三条重映射路径全走校验；重映射后帧号重合**拒绝写入**并提示
  （「帧率切换后原第 0 帧与第 1 帧重合到第 0 帧，请先调整关键帧（已拒绝写入）」），
  帧率选择框回退原值；commit() 不再只吞异常。〔EditorPage.vue:491-508,832-842〕
- ✅ **DEFAULT_HAND_CONFIG 共享可变单例** → 「重置」是空操作 + 旧档迁移出
  `palm.width=5`（应 1.35）（已修）：修法落地：DEFAULT_HAND_CONFIG/DEFAULT_SHAPE 全层深冻结，
  loadHandRigConfig 三个分支一律返回 structuredClone 副本，标定页 reset() 克隆的是**未被污染**的常量；
  新增 `scripts/verify-hand-store.ts`（9 项断言，含 v3 旧档兜底 1.35）并已登记 CI。
  〔handRigStore.ts:228-236 / HandCalibPage.vue:41,230-231〕

**P1 正确性 / 性能 / 契约**
- ✅ **注入 API 姿态被编辑器 60Hz 预览驱动覆盖**（播放中每帧被冲掉）（已修）：
  引入「外部驱动」所有权标志 `externalDrive={active}` + `releaseExternalDrive()`：setPose/playFrames
  校验通过后接管（非法调用不劫持控制权），编辑器 renderPreview 在标志置位时**跳过双轨 setPose**，
  用户编辑关键帧/切手型/卸载时归还。真机：播放中 setPose 后 500ms（≥30 个 60Hz tick）仍是被注入的姿态，
  用户点关键帧后立即归还编辑器。〔EditorPage.vue:700-709,1434-1503 / handApi.ts〕
- ✅ **playFrames({loop:true}) 根本不循环**（播一遍后永久停末帧）（已修）：
  改为按跨度取模（t % span）+ 每 tick 重新定位（可回退）+ span===0 单帧片段保护 + 非 loop 到末帧即停。
  核验时另抓到「末帧永不显示」真 bug（原判据用 1/fps 秒数去比 target 帧单位，窗口只有 0.033 帧）
  → 抽出可单测纯函数 `pickFrameIndex`，末帧占周期末 1 帧。实测周期 = span/fps，走过 ≥3 周期回到起点。
  〔handApi.ts:106-124〕
- ✅ **单步时长/帧号无上限 → 总帧数十亿 → 刻度生成上亿 DOM 节点**（已修）：
  validateTechnique 给 stepMapping/接触轨道帧号加上限（36000），单步时长上限 600s（超限拒绝并提示
  「总帧数会超出 36000 帧上限」）；灌 1e8 实测耗时 3ms、页面不卡死。〔technique.ts:68-77 / EditorPage.vue:427-459,1137-1150〕
- ✅ **关键帧面板双真相**（selectedFrame vs previewFrame）（已修）：
  面板统一到单一真相源：帧号移动后输入框不再回弹（60→30 读回 30），缓动改到面板显示帧
  （帧0=linear / 帧30=easeIn / 帧120=linear），无关键帧的帧改缓动显式提示「第 N 帧没有关键帧，缓动未生效」。
  **残余双真相已收口**：`seekFromEvent()` 原先只写 `previewFrame` 不刷新面板输入框（三个输入框无
  v-model，值只由 `renderSelected()` 写）→ 手动拖标尺后面板仍显示上一个关键帧的帧号；现已在
  seek 路径补 `renderSelected()`。〔EditorPage.vue:863-895,588-590,237-248〕
- ⬜ **灰面板隐藏时仍每帧全量重建**（54 贴纸材质 + 54 SVG 多边形 + 回读 DOM 求包围盒）
  → 修：onRecreate 改名 onRenderScheduled + dirty 标志 + 隐藏时跳过 + 包围盒不回读 DOM。
  〔GrayOverlay.ts:30-45 / grayPanel.ts:261-351 / session.ts:55-57〕
- ⬜ **标灰预设旋转表与展示朝向不一致**（底色≠D 时标错面；verify-data 把当前行为固化成断言）
  → 修：统一帧 + 断言改成「保持集落在持底色的那一面」。〔stickering.ts:176-226〕
- ✅ **进度快照从 24 条封顶的显示日志写** → 超 24 步后进度静默丢失（已修）：
  快照改用**不截断的完整序列**（player.currentAlg），显示日志仍封顶 24 条但只管显示；
  恢复按完整序列重放（实测 30 步重载后逐 token 相同，引擎级比对 54 贴纸逐格相等；
  旧口径「只恢复最后 24 步」会错 42/54 格）。〔GamePage.vue:108-114,167-171〕
- ✅ **复制解法漏 endAlg** → 复制出的公式终点朝向与屏幕演示不同（已修）：
  复制内容 = setupAlg + moves + endAlg；求解面板新增「收尾旋转」行，使屏幕展示 = 实际执行序列。
  实测复制串 56 步以收尾旋转结尾，演示跑完后实际施加序列尾部与复制内容逐 token 相同
  （引擎级比对：旧复制串终点 centers≠演示终点，新串一致）。〔GamePage.vue:88-94,292-295〕
- ✅ **`three` / `@types/three` 未在 package.json 声明**（已修）：12 处 import 跨 10 文件，仅靠 cubing 传递依赖
  提升。修：`npm i three@0.170.0` + `-D @types/three@0.169.0`（用 `^` 范围与项目约定一致；
  three 的 0.x caret 语义 = 只吃 patch，不会被上游 minor 变更打到）。〔package.json〕
- ⬜ **CI 与文档严重不符**：全仓只有 ci.yml（单 job），**无 Release workflow / 无 playtest job /
  无 Rust 任务**，而 README:12,36 与 AGENTS.md:12-13 都声称有 tag 触发发布流水线；
  6 个已存在且本地全绿的确定性 gate 不在 CI（verify-solve-base / verify-zbls-rounds /
  find-zbls-diff-3 / probe-locale-keys / verify-notation / record-solver-baseline）。
  修：补 release.yml（或先改三份文档）+ 把 6 个 gate 加进 CI + 加 cargo check job +
  CI 补 permissions/concurrency + 去掉重复的 vue-tsc。
- ⬜ **版本号三份副本漂移**：package.json / tauri.conf.json = 0.4.1，Cargo.toml = 0.1.0，
  package-lock root = 0.1.0 → 修：把 Cargo.toml/lock 纳入同步规则或加 CI 一致性断言。
- ✅ **vite dev 端口 5173 占用用户端口**（已修）：项目约定 5174；tauri 侧已用
  `--port 5174 --strictPort` 绕过，vite 侧没有。修：vite.config.ts 改 **5174**
  （附注释说明 5173 留给用户预览）+ README 开发段端口同步。〔vite.config.ts:8 / README.md:45〕
- ⬜ **多标签页互相覆盖**：全仓无 `storage` 事件监听（仅 vendored 收藏夹有），编辑器会把
  过期的整库快照写回 → 修：library/settings/keymap 加 storage 监听。
- ⬜ **「加载内置公式库」静默覆盖用户对内置行的修改**（mergeLibrary incoming-wins，id 固定
  `cr-<caseId>`）→ 修：脏标记或只读标记 + UI 明示。

**P2 技术债（按主题，完整逐条证据见 docs/audit/*.md）**
- ⬜ 求解全程主线程同步（预热 560ms、搜索尾 346ms），「求解中」遮罩结构上画不出来、无进度无取消
  → 迁 Web Worker。
- ⬜ `zbl.ts` 头注释「任意棱已定向顶层态都恰有一条 ZBLL 一步解」实测假（命中率 50%）。
- ⬜ `cfop.solveSlot` 的 EJECT[4] 兜底不可达（0/2436）且语义写错（弹的是角不是棱）。
- ⬜ verify-zbls-rounds F 段无硬断言（712/726 脱靶被容忍）、B 段自证式循环。
- ⬜ smoke 只覆盖 3/5 方法；roux-merge / roux-adv 无任何 CI 覆盖。
- ⬜ solver-baseline.json 是金标准但生成脚本直接覆写、无 --check、无校验。
- ⬜ `CubePlayer.dispose()` 全仓无调用点；灰面板 window 级 pointerup 不移除；GrayOverlay.init 无重试。
- ⬜ 套用公式后 history 未清 → 撤销从公式里删一步，日志与魔方不一致。
- ⬜ render 后端（休眠）尚有 5 处会坏：setMoves 重上色 22/54 错色、播中改速瞬移/倒退、
  300ms/步 与 1000ms 基准冲突、setState 永久切 state 材质、play() 在当前态上重播；
  RenderCubeHost 自动自转慢 1000 倍；pose.ts 死代码 + 误导注释。
- ⬜ HandRigView 无 dispose()（挂载/卸载/rebuild 全泄漏）；applyPose 每帧新建
  SphereGeometry+Material 从不 dispose；HandCalibView.dispose() 调 rebuild() 而非 rebuild(null)。
- ⬜ `shape.web` 是死参数（被规范化/持久化/有滑条但几何从不消费）；拇指 IP 关节组为空
  → 编辑器 IP 弯曲滑条完全无视觉效果。
- ⬜ normalizeHandRigConfig 接受退化指根基准 → NaN 顶点 → 手部包围盒 NaN → 相机拟合失效。
- ⬜ shape.facets=15（奇数）使环采样不对称，左右手非严格镜像（差 0.0087）。
- ⬜ clampBend / JointDef.range 从未在渲染时应用；parsePose 不校验四元数归一化；
  mirrorPose 与输入共享 bends/contacts 引用。
- ⬜ EditorPage.vue 2536 行：3 套帧重映射 / 4 处姿态输入 / 2 套面板回写并存 → 拆 4 个 composable；
  播放热路径每帧 18 次 getElementById；commit() 不重置 moveCursor → 播放中改姿态执行错位动作。
- ⬜ 复杂记法（交换子/共轭/宽层）未展开 → 播放时 applyMove 抛异常；splitCompoundMove 丢 w。
- ⬜ 主位手规则三处越界（双手态允许左手主位 / 双手开关覆盖用户选择 / API 主手固定左手）；
  无「未保存」状态；时间线打开编辑面板不刷新数值；自动路径 O(n² log n) 长手法可卡数秒；
  src/input/pointer.ts 整个文件未被引用。
- ⬜ 无错误边界（WebGL 失败 → 静默白屏）；KeymapPage 写回过期 settings 快照回滚语言切换；
  KeymapPage 按键捕获吞掉全部键盘输入（Tab 被绑成动作、F5/Ctrl+C/Ctrl+V 失效、无键盘逃逸）；
  捕获中途切作用域会写错键位并误报冲突；求解面板与灰面板 z-index 完全相同 → 求解面板盖住灰面板。
- ⬜ document.lang 切英文后不更新；页面层几乎无可访问名称与 aria-live；路由切换无焦点管理；
  视差「关」开关停不掉背景漂移与魔方自转；项目 CSS 无 prefers-reduced-motion。
- ⬜ 硬编码中文绕过 i18n（GamePage:137,321,325 / LibraryPage:42 / RenderDemoPage / HandLabPage /
  数据层报错文案）；t("solve.fail") 缺 {error} 占位符吞掉报错细节；loadSettings() 在模板渲染路径里读
  localStorage；8 个 i18n 孤儿键；侧栏在调试路由高亮错项；RenderDemoPage 用 fixed 逃出布局。
- ⬜ 内置数据集不可复现（重跑生成器得 528,866 vs 入库 553,969 字节，199 条载荷变化；上游缓存被
  gitignore 且不在库）；fetchedAt 被覆盖成最后一个集合的 scrapedAt，不能作漂移信号；
  公式库搜索结果落在默认折叠分组里 → 搜得到看不见；无标签/分类过滤。
- ⬜ 完全没有单元测试运行器、无统一 npm test 入口（事实套件 = 40+ 一次性脚本）
  → 建议零依赖 node:test 最小骨架。
- ⬜ 20 个浏览器脚本硬编码 Windows 浏览器路径；networkidle0 卡点根因实为 Vite 依赖预打包 reload
  竞态；无人起 dev server → headless CI 目前不可行。
- ⬜ extract-solver-data.mjs 用仓库外绝对路径静默覆写两个已跟踪的求解器源码文件；
  probe-solver-methods.ts 无扩展名 import 必崩；playtest-spike.mjs 断言已不存在的 #alg-input；
  3 个脚本默认落到 5173；measure-hand.mjs 什么都没测。
- ⬜ Tauri：csp=null 无 CSP；NSIS 包无 Authenticode 签名与时间戳；bundle 仅 Windows；
  Rust 侧 serde/serde_json 无用依赖。
- ⬜ package.json 无 engines / 无 .node-version；CI 用浮动 node-version: 22。
- ⬜ 文档漂移：todo.md:45 称 reference/「已入库」（实际被 gitignore）；hand-api-spec.md:61 禁改清单
  含已删除的 handGeometry.ts 且端口写成 5175（标准 5174）；AGENTS.md 对同一验证命令同时写 node 与 tsx。
- ⬜ 死代码清理：根目录 .research_zbll_probe.mjs、cuberoot-recons.json、cfop-adv-zbll-case.json、
  src/app/App.ts、src/router.ts 导出、src/preview 占位壳。

**已证伪 / 降级**
- ✅ **Roux block-2 深度上限 14（首轮报为 CRITICAL，实测不成立）**：合计 38000+ 次求解
  （纯面步 7500 + 项目自身 randomScramble 7500 + 直接 block2 子问题 23000）**零失败**；
  深度 14 搜索最大用 1614 节点（预算 8e6），深度上限不是约束。降级为低：仅建议
  深度 14→16 加固（实测零额外开销）+ smoke 补 ≥2000 随机打乱回归样本。
  详见 REVIEW-2026-10.md 第五节。

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
- ✅ **公式线分支已并回 main（aacdeff，全套验证复绿）**：`feat/zbll-import-verify`
  含——口径冻结（主口径=库完整性 493/493；verify-zbll-coverage 重写、删
  coverage-zbll.mts，新增 find-zbls-diff-3 + verify-zbls-rounds）+ ZBLS 剔 O 组
  （305→302，留档 docs/archived/）+ 轮样本验证 2603 轮全绿（A 域 302/302、B 命中
  1080/1080、C 表基线 268/1696 不变、D 端到端 493/493、E 完整性）+ **Y_TO_FR
  回滚**（非 FR 缺槽维持静默回退 = 0.3.8 生产行为；F 段转报告型）。main 现跑
  新工具与 302 数据基座，两线矛盾消除。
- ⬜ **公式线重启=命中率轮**：修 ZBLS 建表-查表口径（非 FR 缺槽 F 段 14/726 已证实
  局限，嫌疑在组↔槽对应/整转残差，起点注释已写入 zbls.ts；修法落地恢复 F 段硬
  断言）+ 32 条「棱 home 角乱」建表局限；cfop-adv 真实收益取决于命中率（库已完整）
  / EO 预置并入首步。路线图优先级：桥式高级 > cfop 高级 > 盲拧。
- ⬜ EOLR 一步表命中率 ~0（lse-eolr 46 case 仅收全 EO 22 条，需改 EO 分类匹配）。
- ⬜ cfop-adv 剩余（「补全 ZBLL 库/双源并集闭包」议题已被口径冻结终结——库完整
  493/493，真实问题在建表-查表命中率，见上「命中率轮」项 / EO 预置
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
