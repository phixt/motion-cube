# 项目 TODO 与进度

> 更新：2026-08-06　✅ 已完成 ｜ 🚧 进行中 ｜ ⬜ 待办

## 技术栈迁移（2026-08-12 完成 ✅）

- vanilla TS 命令式 DOM → Vue 3.5 + WinUIonWeb（7 页全部迁移，功能等价，playtest 全量通过）
- 详见 [migration-vue-winui-plan.md](./migration-vue-winui-plan.md)
- 高 DPI 适配：标题栏「缩放」按钮 100%–200%（默认 150%），全局 zoom 缩放

## 审查与安全加固（2026-08-12）

- ✅ **首次全面审查（安全/性能）**：S1 导入 JSON 深度校验（`deserializeTechnique` 对 pose/stepMapping 逐字段校验，非法结构导入即抛错；公式名/标签/分类名长度上限）；S2 关键帧帧号上限 36_000（防超大帧号卡死时间线渲染）；补全英文包 `en.ts`（194 key 与 zh-CN 全量对齐）；`verify-data` 失效断言修复（handRigStore 合法版本已迁移到 2，改测 version 3）
- ✅ **二次审查（标尺领地补审，2026-08-12）**：`HandCalibView.dispose` 清理 window 级拖拽监听（拖拽中切页不再泄漏/空转）；标定页 `thumb-x/y/z` 负值坐标可正常输入（此前被 `v >= 0` 静默拦截，标定功能不完整）；Shift 切换标尺角度过滤 INPUT/TEXTAREA 焦点（输入框内按 Shift 不再误改写角度值）
- 低危遗留（暂不处理）：`window.__motionCube` 等调试后门未加 DEV 守卫；无 CSP；`crypto.randomUUID` 依赖安全上下文（file:// 打开会崩）；标定页每次输入全量重建 3D 几何（P1 性能，可用防抖+rAF）；`drawRuler` 全量重建 SVG（P2）

## 优先级与路线（2026-08-12 评估）

### P0（推进准备中）

- ✅ **拇指根独立建模 + 大鱼际凸块**（2026-08-12 完成：thumbCorner 改掌根锚点 v2 + thenar 椭球凸块 + v1 迁移；标定/编辑器视图验证 + 像素测试通过）
- ✅ **播放器整合：公式播放 + 手法 stepMapping 帧级同步**（2026-08-12 完成：编辑器播放时按 stepMapping 对魔方逐步骤 applyMove，tempoScale 校准步进时长；playtest 断言"播放后魔方执行公式步"通过）

### P1（紧随 P0）

- ✅ 四元数插值 nlerp → slerp（2026-08-12：Timeline.ts slerpQuat，近平行回退 nlerp；90° 插值中点恰 45°）
- ✅ contact.lifetime 精确起止帧建模（2026-08-12：接触移到手法级 contactTracks（startFrame/endFrame），插值不再离散切换；编辑器按帧显示活跃接触；示例数据迁移）
- 编辑器：坐标高度 / 吸附（手法可复现的关键交互）
- ✅ 编辑器：起终自动路径（2026-08-12：首末关键帧间 slerp 插值生成中间关键帧，15 帧间隔，playtest 断言）

### P2（打磨期）

- cubing 大 chunk 分包优化（vite build 警告；本地/桌面影响小）
- 编辑器杂项：不可变选项 / 起始底色 / 快捷键独立配置
- 键位预设（新手直觉布局）；关键帧细化（easing/中间帧）

### P3（长期/可选）

- 函数路径（正弦/圆弧等）；高速动画性能/真实卡顿感（动画抽搐长期项）
- playtest 脚本化/CI（QA 循环）

依赖链：slerp → 自动路径；contact.lifetime → 吸附；插值正确性 → 播放器整合体验。

## P0 推进准备（2026-08-12 摸底）

### P0-A 拇指根独立建模 + 大鱼际

> ✅ 已完成（2026-08-12）：锚点改掌根（0.55,-0.05,-0.45）、thenar 参数与凸块、v1 配置迁移；发现并修复双渲染器色彩空间差异（cubing 线性输出 vs HandCalibView sRGB 输出）；verify-hand-calib 像素测试与 playtest 全绿。
> ✅ 迭代（2026-08-12）：标定页新增左视图（HandCalibView view="left"，左手拇指侧 YZ 剖面 + 高/长标尺）；拇指自然外翻（CMC 默认 rotation 30° 向外展开 + abduction 42° 抬离掌面，侧视约 21°），俯视不再被手掌遮挡、与食指不重叠；左视图网格描边（EdgesGeometry）；统一正交相机缩放比例（修复窄窗口下左视图垂直拉伸）；肤色调亮（SKIN #CFC0A8 → #E4D4BD）；示例数据重新生成（thumbCMC 42/30）；编辑器默认手位同步。
> ✅ 迭代（2026-08-12）：标尺功能化——标定页「标尺」开关控制显示、Shift 切换水平/竖直（不持久化，回到设置默认值）；标尺半透明 + 大格数字（整数大格加粗数字，修复 0.5 步进浮点漂移漏标）；设置页新增「标尺默认显示 / 默认方向」；左右手命名对调（模型 +X 拇指侧的手实际渲染为右手 → handType 语义交换为 right=+X，标签随之正确，渲染不变）。
> ✅ 迭代（2026-08-12）：标尺重做——独立于网格的可拖拽标尺条（透明 16px 命中条，拖拽移动 offset），大格 1 块边长 + 十等分小格（0.1），整数格加粗数字（k/10 整数遍历避免浮点漂移）；Shift 切换水平/竖直；网格常显作为独立背景。大鱼际整体化——手掌改 RoundedBoxGeometry 圆角 + thenar 椭球加大融入掌根（不再像外挂球）。左右手拇指对称——CMC rotation 也按 sideSign 镜像（此前仅 abduction 镜像，左手拇指朝向与右手不一致）。
> ✅ 迭代（2026-08-12）：标尺 bug 修复——拖拽映射统一用画布 rect 归一（兼容全局 zoom，1:1 不跳变）+ 抓取偏移量（无极不吸附，可精确回位）；Shift 切换改为绕标尺线中点原地旋转（不再重置位置）；刻度范围改整数起点（俯视 宽 -2..2 / 长 -1..4，左视 长 -1..3 / 高 -1..1），数字含 0 且起点有标注。
> ✅ 迭代（2026-08-12）：标尺重构为真实尺子——带宽度（0.35 块边长）的尺身、任意角度旋转（Ctrl 悬停显示虚线圆 + 双向箭头弧线指示，Ctrl 拖拽连续旋转）、二维自由拖拽（水平/竖直均可）、刻度 0..L 从起点标注（0,1,2,3,4,5）；角度入标定页数值栏（ruler-angle，与其他数值一样调整，随固化保存 HandRigConfig.rulerAngle）；Shift 快速切换 0°/90°；设置页去掉方向开关（角度由数值栏管理）；修复 overlay SVG 未填满容器（300×150 默认尺寸导致标尺错位/不可命中）。

现状摸底：
- `thumbCorner`（config 级，默认 0.68,-0.14,0.5）决定拇指根相对手掌中心位置；渲染时 X 按手型取反
- 拇指链：thumbRoot → thumbDof（CMC 展收/对掌）→ 2 段 3 关节（CMC/MCP/IP）
- 姿态级 `thumbBase` 独立于几何（示例"单拨 U"三关键帧均为 identity、thumbCMC 0/0）
- 标定页已有 thumb X/Y/Z 输入；verify-hand-calib.mjs 像素断言（肤色像素居中/数量）
- 缺陷：拇指根锚在掌前缘角落，无掌根/腕侧语义，无大鱼际几何，与食指易冲突

推进步骤：
1. handRigStore：`thumbCorner` 语义改为掌根/腕侧锚点（含默认值重标定），新增大鱼际参数（宽/高/位置）；version 1→2 + normalize 迁移
2. handGeometry：拇指挂载点改掌根 + thenar 凸块几何（椭球/自定义）
3. 标定页：更新 thumb 参数区默认值与说明（WinUI 表单已就绪）
4. 示例/默认姿态重校准（defaultHandPose、"单拨 U"关键帧），避免与食指冲突
5. 回归：verify-hand-calib（像素居中）、playtest（标定/编辑器全量）

### P0-B 播放器整合（公式播放 + stepMapping 帧级同步）

> ✅ 已完成（2026-08-12）：编辑器播放循环按 stepMapping 边界对魔方 applyMove（公式 moves 与 stepIndex 对齐），tempoScale = 基准 0.3s/步进时长 校准；playtest 新增断言全量通过。

现状摸底：
- 编辑器已有 60fps 预览循环（pv-play：previewFrame++ → renderPreview → handView.setPose）
- stepMapping[{stepIndex,startFrame,endFrame}] 数据已就绪（示例 1 步）；公式 moves 可 parseMoves 解析
- CubePlayer.applyMove(move)（cancel:true）可逐层驱动魔方动画

推进步骤：
1. 编辑器预览循环扩展：previewFrame 进入 stepMapping[i] 区间时对该步公式 move 执行 applyMove
2. 公式 moves 与 stepMapping 按 stepIndex 对齐（parseMoves 规范化）
3. 步进时长 = (endFrame-startFrame)/frameRate，与 cubing 动画时长校准（调速沿用 setSpeed）
4. 播放/暂停/重置语义在游戏与编辑器间统一（session 与 editor 的 hooks 对齐）
5. 回归：playtest 编辑器用例 + 新增"播放时魔方转动与手法同步"断言

## 待办

### 体验优化（用户 2026-08-06 反馈）

1. 🚧 连续/快速按键动画抽搐
   - 现象：快速连按时 cancel 重触发，动画观感抽搐。
   - 方案：
     - ✅ 基础：连击冷却/频率限制开关（`moveCooldownMs`，默认 120ms，设置页可调；实测 6 连按 → 2 步）
     - 中期：动画调速（计划在动画编辑器阶段引入）
     - 长期：高速动画的性能限制/简化（降插值精度、批量渲染），并模拟真实"一层未拧到位、另一层卡顿"的关联感
2. ✅ 键位直觉化（基础版）
   - 现状：键位按公式符号（U/D/L/R/F/B、Shift 反转、Space 双层），符合记法但不符合直觉。
   - 完成：按键设置页（改键捕获 / localStorage 持久化 / 冲突检测 / 恢复默认）+ 说明页动态展示当前键位。
   - 待办：键位预设方案（如面向新手的直觉布局）。
   - 待办（编辑器快捷键）：与游戏键位分开配置、默认与公式保持一致（如 U 在游戏与编辑器中都录入 U）；
     提供"连带设置"开关或批量设置时提示是否同步，选取人性化路线。
3. ✅ 路由
   - 完成：hash 路由（#/start | /game | /editor | /keymap | /help）+ 页面壳；动画编辑页为占位。

### 功能

- ✅ 公式库/手法库 UI（基础版）：列表 / 增删改 / JSON 导入导出 / 加载示例；手法库暂为只读列表
- ✅ 手法 JSON 示例数据（data/samples/library.json，由 scripts/gen-samples.ts 生成并校验；含分类 + 单拨 U 三关键帧）
- ✅ cuberoot.me 参考数据（2026-08-06）：站点/复盘/公式库均可达，公开 API `api.cuberoot.me`；
   精选复盘样本 data/samples/cuberoot-recons.json（3 CFOP + 2 Roux + 1 ZB，含分步解法，
   刷新脚本 scripts/fetch-cuberoot.mjs）；公式库示例扩充 5 条 speedcubedb 真实公式
   （OLL 1 / PLL Aa / CMLL O Adjacent / ZBLL U 1 / 1LLL 1 1，verify-data 27/27）
- ⬜ 动画编辑器：坐标高度 / 吸附 / 起终自动路径 / 函数路径 / 关键帧细化（P1/P2，见上方路线）
- ⬜ 播放器整合：公式播放 + 手法 stepMapping 帧级同步（P0-B）
- ⬜ playtest QA 循环（含新页面回归）
- ⬜ 拇指根独立建模 + 手掌"大鱼际"凸块（2026-08-06 记录，用户反馈；P0-A）
  - 现状缺陷：拇指没有"根部"，从手掌前缘角落伸出、与食指冲突；真实拇指根位于掌根（腕侧），
    附着处有大鱼际隆起（thenar eminence）。
  - 方案：① 把拇指根位置从"手掌角落"单独拎出来作为独立参数（贴近掌根/腕侧，配合 CMC 位姿），
    不再与四指共用 MCP 线逻辑；② 待拇指位置确定后，在手掌对应位置加一块"大鱼际"几何，
    使拇指看起来是从掌根伸出的。
  - 相关代码：src/hand/handRigStore.ts（thumbCorner 参数）、src/hand/handGeometry.ts（拇指挂载点 / 手掌盒体）

### 技术债

- ⬜ 四元数插值 nlerp → slerp（Timeline.ts；P1）
- ⬜ contact.lifetime 精确起止帧建模（当前为相邻关键帧离散切换；P1）
- ⬜ cubing 大 chunk 分包优化（vite build 警告；P2）

## 已完成

- ✅ 开源评估（cubing.js 基底）与 Spike 三验证（记法 / 键盘 / 拖拽）
- ✅ 项目骨架（Vite 8 + TS 7 + cubing 0.63.3），分层目录
- ✅ 参数模型 docs/params.md（31 项，含拇指特例与 1/60s 帧精度）
- ✅ 旧文档清理归档 docs/docs_old.md
- ✅ 数据层：HandRig / formula / technique / Timeline（verify-data 12/12）
- ✅ 路由与页面壳：开始 / 游戏 / 动画编辑（占位）/ 按键设置 / 说明（2026-08-06）
- ✅ 自定义按键设置页：改键捕获、localStorage 持久化、冲突检测、连击冷却滑块（2026-08-06）
- ✅ 连击冷却优化基础版：`moveCooldownMs` 默认 120ms，实测 6 连按 → 2 步（2026-08-06）
- ✅ UI 流程实测：playtest-ui 8 项通过（路由切换 / 改键生效 / 冷却 / 各页渲染），修复导航被控制栏遮挡、innerHTML 清掉导航两个 bug
- ✅ i18n 基础设施：文案集中到 src/i18n（zh-CN 全量 + 语言切换与 en 占位），设置持久化语言字段（2026-08-06）
- ✅ UI 收尾（2026-08-06）：开始页居中且去掉重复导航；非开始页导航首项改为"返回"；
   游戏页移除"记法自检"（spike 时代工具，校验保留在 scripts/verify-notation.mjs）；
   说明页删除与按键设置重复的键位/冷却段落，补动画编辑器说明占位
- ✅ 公式库/手法库页（2026-08-06）：路由 /library、列表增删改、JSON 导入导出、加载示例；
   数据层新增 libraryStore（合并/持久化）与示例数据（verify-data 15/15）
- ✅ 基建（2026-08-06）：@types/node；vite optimizeDeps 预打包 cubing，修复 dev 首次加载 504；
   el() DOM 工具抽到 ui/dom.ts；i18n locales 目录与 css 按归属拆分
- ✅ 分类系统（2026-08-06）：分类树（最多 4 层、深度校验、环检测、删除子分类上提）、
   公式多归属（categoryIds，交叉分类）、大流派建议用标签（CFOP/Roux/ZZ 快捷建议）；
   公式库页分类管理 + 公式行显示分类；示例数据含 OLL/PLL/1LLL/CMLL/ZBLL 与 ZBLL⊆1LLL
- ✅ 开始页增加"公式库"入口（2026-08-06）
- ✅ 排查修复：残留 dev server 占用 5173 导致 twisty 3D 动态块 404/504、游戏页黑屏
   （根因是 Stop-Job 只杀 npm 包装进程、子进程成孤儿；改用按端口清理）
- ✅ 公式表单重排（2026-08-06）：两行布局（名称+标签 / 公式+分类+确认取消）；
   标签改为"+"添加胶囊（支持 ,/; 分隔、去重、最多 4 个、计数器）；测试端口改为 5174 避免与用户预览冲突
- ✅ 分类改单选（2026-08-06）：Formula.categoryId（旧 categoryIds 数组自动迁移取首项）；
   分类区说明文本（客观分类、选最小集合）；标签区说明（主观流派、,/; 分隔、首尾空格去除）
- ✅ 手法模型约束（2026-08-06）：Technique.formulaId 必填、一个公式可绑定多个手法、
   删除公式级联删除其手法；库页手法区加说明文本与公式行"手法 n"计数
- ✅ 标灰系统（2026-08-06，游戏侧）：54 小面模型（src/cube/stickering.ts，坐标往返验证）；
   3D 标灰用 three.js mesh 材质实现（绝对坐标绑定、随转动移动，scheduleRender 强制重绘）；
   两类灰 mutable（浅灰，可随时改）/ immutable（深灰，固定）
- ✅ 标灰面板（游戏页右上角）：预设 初始十字/左桥/右桥/清除 + 六面展开图点击/拖选 + 可变/不可变切换
- ✅ 六色底适配：设置页全局底色（六色色块 + 随机底，localStorage 持久化）；
   预设按底旋转适配（verify：六底色 45/41 灰一致）；测试端口 5174
- ✅ 实测：标灰面板十字 45 灰/点选 46/清除 0；3D 即时显示且 R 转后灰格跟随移动
- ✅ 反馈迭代（2026-08-06）：全局底色作用于游戏起始朝向（旋转使底色面朝下，baseFaceSetupAlg）；
   游戏面板移除可变/不可变切换（留数据层，编辑器阶段再用）；
   标灰小视图改为伪 3D（等轴测角对角 + 左/右/下三面半透明外投影，点击/拖选）；
   公式表单分类改为级联胶囊下拉（按树逐层展开，最深选中项为分类，回显路径）
- ✅ 伪3D 视图二次迭代（2026-08-06）：实心主体（无面间空隙、背面不外露）；隐藏三面投影拉远（2.0）全部可点选；
   拖拽换面仅在按住时生效（悬停不换面，改用 clientX/Y 差值，适配真实浏览器与自动化）；
   X/Y/Z 换面仅焦点在视图上时执行（不触发主魔方转动）；视图跟随魔方实时状态（读 mesh 位置，底面与真实魔方一致）；
   viewBox 统计全部多边形 + SVG 自适应面板宽度（不再裁剪）
- ✅ 分类级联下拉修复（2026-08-06）：change 监听闭包捕获循环结束后的 `level`，导致改选时切错链、
   下拉回弹无法更改；改为按层捕获（`const lv = level`），改选首级时清空深层选择；playtest 回归通过
- ✅ 时间线编辑器骨架（2026-08-06）：手法选择/新建（关联公式必填）、时间线轨道（60fps 标尺、
   关键帧标记、步骤区间带）、选中关键帧（帧号移动/缓动/删除）、添加关键帧（复制选中或前序姿态）、
   60fps 补帧预览（滑杆播放 + 插值姿态读数 + 每 15 帧采样表）、保存回库；playtest 15 项通过
- ✅ 手/手掌 3D 模型（2026-08-06）：简化圆柱段 + 手掌盒体，拇指特例（2 段 3 关节、CMC 展收/对掌），
   每段指腹（绿）/指背（橙）方向标记、接触点白球；注入 cubing 场景与魔方同视角（GrayOverlay 同款模式），
   姿态跟随预览帧/选中关键帧；左右手切换（镜像）；默认手位放魔方前方（defaultHandPose，避免埋在魔方里）；
   手材质用 MeshBasicMaterial（cubing 场景无灯光，Standard 材质会渲染成黑色）；playtest 16 项通过
- ✅ 手部比例与初始位校准（2026-08-06）：几何在构建时放大、group 只做坐标映射（位置保持魔方单位语义）；
   默认手位改魔方左前方（palm -3,0.5,9，手指伸向前表面，拉开距离减少遮挡）；像素实测魔方块边长≈67px
- ✅ 手部比例按人体测量数据校准（2026-08-06）：各指总长比 acbjournal 2024（thumb 0.70 / index 0.90 /
   middle 1.00 / ring 0.93 / little 0.75，中指=1）+ 指节长度占比 JSSM（中指近节 48.5% 等）+
   指粗比（16/15/15/14/13 → 相对小指 1.23/1.15/1.15/1.08/1.00）；修复食指≈无名指等长、近节偏短、
   手指粘连等问题；verify-data 新增比例断言（docs/params.md §手部比例）
- ✅ 手部目测回调（2026-08-06）：小指锚点 3.1 → 2.1 块边长（HAND_SCALE 2.1/1.33，中指 ≈2.8 恰好横跨
   一个魔方面）；手掌从 2.09×2.83 回调到 1.35×0.45×1.55（避免"过大长方体"）；
   拇指根移到掌前缘下侧（0.68,-0.14,0.5）避免与食指重叠
- ✅ 手部标定页（2026-08-06）：独立路由 #/hand、平铺手掌正交视图（无透视失真）+ 块边长标尺
   （SVG 网格/宽长轴刻度，1 格 = 1 块边长）；参数面板（各指段长/段粗、手掌宽厚长、指根间距、
   拇指根 X/Y/Z、整体放大系数）实时预览；「固化保存」写入 localStorage（motion-cube.handRig），
   编辑器/游戏构造 HandRigView 时自动读取同一配置（handRigStore，含规范化/越界截断）；
   几何构建抽到 handGeometry 供视图与标定共用（防漂移）；playtest 新增标定页用例（标尺/编辑/固化）全绿
- ✅ 标定页显示修复（2026-08-06）：① 单位换算 bug——标尺刻度误用场景单位（1 格=3 块边长）、
   视野过大，手被缩成角落小图；改为按 CUBE_UNIT_WORLD 换算并重设视野 ② 高分屏 dpr>1 下
   setSize(w,h,false) 不更新 canvas CSS，缓冲区 2× 容器被 overflow:hidden 裁掉左上部分，
   居中的手落在可见框右下角；改为 updateStyle=true ③ 镜头改为自动对准手包围盒中心
   （视野仍覆盖手+标尺），手始终居中；新增 scripts/verify-hand-calib.mjs 像素级验证
   （dpr=2 下中心 0.499/0.499）④ 编辑器无手法时也显示默认手位（不再空视口）
- ✅ 调试心得（2026-08-06）：编辑器视口"空白"系 puppeteer 点击页面底部控件自动滚动页面、
   裁剪截图区域在屏幕外所致，非渲染 bug；截图前需 scrollIntoView。cubing 的 TwistyPlayer 用
   IntersectionObserver 懒初始化 + 闭式 shadow root（DOM 探查无效），渲染检查应以像素/识图为准
- ⬜ 待编辑器阶段：动画编辑器"不可变选项"（默认可变、演示中随时切换、高频请求截断）、
   编辑器起始底色设定；伪 3D 视图后续只加 x/y/z 整面翻转动画；immutable 在 3D 中与 mutable 同灰（面板中深灰+描边区分）
