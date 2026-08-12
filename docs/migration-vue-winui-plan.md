# motion-cube 迁移评估与实施计划：Vue 3 + WinUIonWeb

> 来源：agent-bridge 任务 `84bd26ed78fa45719aa4739adc233da9`（迁移评估与实施：Vue 3 + WinUIonWeb）
> 状态：评估完成；阶段 1、2、3 已完成；阶段 4 进行中（4/7 页已迁移：start/help/keymap/game），剩余 library/editor/handCalib
> 日期：2026-08-11（初稿）/ 2026-08-12（决策与阶段 1-2 + 阶段 3 准备）

## 0.1 已确认决策（2026-08-12）

1. **接受 GPL-3.0**：允许 vendor WinUIonWeb 源码，公开分发时整体以 GPL-3.0 授权。
2. **整目录复制**：vendor 采用全量复制（components / styles / utils / 字体 / LICENSE）。
3. **外壳全换**：最终壳含 WinTitleBar + 主题切换（明暗 / Mica / Acrylic）与页面过渡；本轮只做准备工作。
4. 实施节奏：先阶段 1、2，准备 3；阶段 4+（逐页迁移）后续进行。

## 0.2 已完成的进展（2026-08-12，分支 codex/vue-winui-migration）

- **阶段 1（工具链）✅**
  - 安装：vue 3.5.41、vue-router 4.6.4、@vitejs/plugin-vue 6.0.8、vue-tsc 3.3.9。
  - **TypeScript 7.0.2 → 6.0.3**：vue-tsc 依赖 `typescript/lib/tsc`（JS 编译器），TS 7 原生编译器不再导出该子路径，运行时直接报错；与 WinUIonWeb 官方组合对齐（TS ~6.0 + vue-tsc 3.x）。现有代码在 TS 6 下 typecheck 通过。
  - vite.config.ts 挂载 vue 插件；`*.vue` shim（src/shims-vue.d.ts）；typecheck/build 脚本改用 vue-tsc。
- **阶段 2（vendor WinUIonWeb）✅**
  - 上游 commit 锁定：`a61bf49365d1048c4a7b8d799e3cb925f47d479f`（2026-08-11）。
  - 全量复制到 `src/vendor/winui-on-web/`：components（91 个控件 + i18n + Strings）、styles（theme.css / animations.css）、utils（navigationTransitionInfo / pageState，WinSemanticZoom 依赖）、SEGOEICONS.TTF、LICENSE。
  - 所有 vendored .vue/.ts/.js 自动注入 `// @ts-nocheck`（.vue 注入在 <script> 块首行，顶部注释 vue-tsc 不认）+ 来源头注释；`VENDOR.json` 记录清单；根目录新增 `THIRD_PARTY_NOTICES.md`。
  - 同步脚本 `scripts/sync-winui.mjs`（支持 --source / --ref）可复现整个 vendor 流程。
- **阶段 3（准备）✅ 壳预览验证通过**
  - `src/vue/i18n.ts`：motion-cube 业务文案并入 WinUIonWeb i18n（en → en-US；en 空目录回退 zh-CN，保持现有行为）。
  - `src/vue/styles/global.css`：从上游 gallery App.vue 提取 @font-face + 图标字体规则（theme.css 不含字体规则）。
  - 预览页 `preview.html` + `src/preview/`（App.vue 壳 + vue-router + 占位页）：WinNavigationView 7 项导航、路由切换、WinButton/WinToggleSwitch 控件演示；已加入生产构建入口。
  - 验证：typecheck ✅、build ✅、dev server + puppeteer 截图（spike-shots/preview-*.png）确认深色 WinUI 主题渲染、导航点击路由正常、i18n 文案生效、无渲染错误。重复"设置"项已通过 `:IsSettingsVisible="false"` 修复。
  - 遗留小项：preview 页加载时 favicon 404（无害，未配置 favicon）。
- **阶段 3（正式实施）✅ 功能等价验证通过（2026-08-12）**
  - `src/main.ts` 切换为 Vue 入口（createApp + vue-router + i18n provide + 主题/材质初始化）。
  - 正式壳 `src/vue/App.vue`：WinToolTipService + WinTitleBar（标题 + 主题/材质切换按钮）+ WinNavigationView（7 项导航）+ router-view（淡入过渡）。
  - `src/vue/theme.ts`：主题 system/light/dark（html.theme-light/theme-dark，theme.css 原生支持）+ 材质 mica/acrylic（壳自建 CSS，acrylic 为半透明磨砂；旧页面不透明背景覆盖时效果受限，页面迁移后完全显现），均持久化到 localStorage。
  - `src/vue/LegacyPage.vue`：旧 7 页经宿主组件挂载（onMounted 渲染 / watch 路由 / onBeforeUnmount 清理）；旧导航条在过渡期隐藏。
  - `src/vue/router.ts`：7 条 hash 路由全部指向 LegacyPage（props.route），逐页迁移时替换为真实组件。
  - 回归验证：
    - typecheck（vue-tsc）✅、build ✅
    - 7 路由关键元素全在（game 页 twisty-player/#hud、library .lib-form/#lib-status、editor #editor-view、hand #hand-calib-view 等）
    - `scripts/playtest-ui.mjs`（完整 UI 流程：改键/冷却/标灰/伪 3D/编辑器关键帧/公式库增删改/分类级联/手法级联/手部标定固化）**全量通过**；`verify-notation.mjs` 全 PASS
    - 主题/材质切换实测生效（html class 正确、浅色主题标题栏/导航变浅、截图见 spike-shots/shell-*.png）
  - `scripts/shot-shell.mjs`：新增壳回归截图脚本（7 路由 + 主题/材质切换）。
- **阶段 4（逐页迁移）🚧 4/7 完成（2026-08-12）**
  - 已迁移（`src/vue/pages/`，路由替换为真实组件）：
    - **StartPage.vue**：WinTextBlock 标题 + 6 个 WinButton（主按钮 AccentButtonStyle），保留 `.start-actions [data-route]` 结构（playtest 兼容）。
    - **HelpPage.vue**：WinTextBlock 分节排版（项目/操作/编辑器说明），主题变量配色。
    - **KeymapPage.vue**：Vue 响应式重写（cfg/settings refs）；保留 `[data-action] .rebind/.binding` 表格结构与 `.base-swatch` 色块（playtest 兼容）；改键捕获/冲突检测/WinSlider 冷却/WinInfoBar 冲突提示/随机底色均迁移；监听器在 unmount 时清理。
    - **GamePage.vue**：WinUI 标题壳 + 保留 `mountGamePage` 会话逻辑（CubePlayer/KeymapController/GrayOverlay/HUD 原样挂载，onMounted/onBeforeUnmount 管理生命周期）；旧内嵌标题栏隐藏。
  - 已删除旧模块：`src/pages/start.ts`、`help.ts`、`keymap.ts`；LegacyPage 仅剩 library/editor/hand。
  - playtest-ui.mjs 选择器同步：start/help 断言改到新页锚点（`.start-page`/`.start-title`/`.help-page`），其余断言未动。
  - App.vue 路由视图加 `.mc-page-view` 定位包装（旧 .page absolute 与新页 flow 布局共存）。
  - 验证：typecheck/build ✅；playtest-ui 全量通过（改键/冷却/标灰/伪 3D/编辑器/公式库/分类/手部标定）；视觉抽查 start/keymap/game/help 无渲染问题（spike-shots/ui-*.png）。
  - 剩余：library（457 行 CRUD）、editor（536 行时间线/关键帧）、handCalib（244 行标定）——下一轮迁移。

## 0. 结论摘要

- **迁移可行**。motion-cube 的 UI 层是薄命令式 DOM（约 1.6k 行页面代码），核心逻辑（cubing 渲染 / 数据模型 / 时间线 / 输入 / 手法几何）与 DOM 解耦良好，可直接保留。
- **两个关键约束**决定实施方式：
  1. WinUIonWeb **不是 npm 包**（`private: true`），只能以源码形式集成（vendor 复制或子模块）。
  2. WinUIonWeb 采用 **GPL-3.0 许可证**（copyleft）——一旦把控件源码并入本项目，**对外分发（公开 GitHub / 公开托管）时整个项目必须以 GPL-3.0 授权**；仅私有使用不受影响。
- **推荐策略**：增量迁移——先搭 Vue 壳（vue-router + WinNavigationView + i18n 桥接），旧页面经 `LegacyPage` 宿主组件继续渲染，然后按复杂度从低到高逐页迁移；cube/data/timeline/input 等纯逻辑零改动。

---

## 1. 现状：motion-cube（v0.1.0，D:\P_rojects\motion-cube）

- 技术栈：vanilla TypeScript + Vite 8 + TS 7；依赖 `cubing ^0.63.3`（TwistyPlayer 3D 渲染）；无 Tauri，纯 Web。
- 路由：手写 hash 路由（`#/start | /game | /library | /editor | /hand | /keymap | /help`，`src/router.ts`）。
- UI：命令式 DOM——`main.ts` 按路由 switch，各 `src/pages/*.ts` 导出 render 函数，`root.innerHTML = ""` 后手工 createElement / innerHTML + addEventListener。
- 辅助层：`ui/dom.ts`（el 工厂）、`ui/nav.ts`（导航条）、`i18n/index.ts`（zh-CN/en 双语文案，`{param}` 占位，模块级 locale）。
- 纯逻辑层（无 DOM，可原样保留）：
  - `cube/CubePlayer.ts`：封装 TwistyPlayer，构造时接收 HTMLElement 容器 → 框架无关，可直接挂进 Vue 组件。
  - `data/`：分类 / 公式 / 手法库 / 示例 / libraryStore（含 localStorage 序列化）。
  - `timeline/`、`input/`（keymap/pointer）、`notation/alg.ts`、`hand/handGeometry.ts` + `handRigStore.ts`。
  - 视图类：`hand/HandCalibView.ts`、`hand/HandRigView.ts`、`cube/GrayOverlay.ts`、`ui/grayPanel.ts`、`ui/hud.ts`（DOM 绑定，需逐个体检是否值得保留原样或改写）。
- 页面代码量（迁移工作量参考）：editor 536 行、library 457、handCalib 244、keymap 214、game 118、start 26、help 25。
- 工程状态：git 工作区干净（6 个 commit，main 分支）；已有 puppeteer-core + `spike-shots/` 截图验证工作流；`docs/` 有需求文档（base/formula/params/start/todo）；**无 LICENSE 文件**。

## 2. 目标框架：WinUIonWeb（github.com/Furry-Xiyi/WinUIonWeb）

- Vue 3.5 + vue-router 4（hash history）+ Vite 8 + TS 6；`private: true`，未发布 npm。
- `src/components/`：91 个 `Win*` Vue 控件（WinButton / WinTextBox / WinComboBox / WinNavigationView / WinContentDialog / WinFlyout / WinMenuFlyout / WinListView / WinGridView / WinToggleSwitch / WinSlider / WinNumberBox / WinInfoBar / WinExpander / WinTitleBar / WinThemeWrapper / WinToolTipService 等），源码约 1.24 MB。
- 控件采用 **XAML 风格 API**：PascalCase props（`IsEnabled`、`Style="AccentButtonStyle"`…）与事件（`@Click`、`@ItemInvoked`…），v-model 形如 `v-model:Text` / `v-model:IsOpen`。
- 主题：`src/styles/theme.css`（42.8 KB，CSS 变量 + `@property`，明/暗/高对比）与 `animations.css`（17.3 KB）；图标用内置 `SEGOEICONS.TTF`（字符引用 `&#xE721;` 等）。
- i18n：注入式（`Symbol.for('WinUIonWeb.i18n')` + `createI18n` / `useI18n`），内置 en-US / zh-CN 控件文案，`{param}` 占位格式与 motion-cube 一致。
- 依赖面（已核实）：控件只依赖 `vue` + 相互引用 + i18n Strings + theme.css；不依赖 vue-router。宿主应用**只需提供 i18n**，其余注入（`winuiTheme` 等）均有默认回退。
- 控件间依赖最密集：WinTextBlock（被 27 处引用）、WinScrollViewer（18）、WinButton（14）、WinMenuFlyout（9）、WinTextBox（6）；大控件 WinNavigationView 139 KB、WinScrollViewer 54 KB、WinMenuFlyout 43.5 KB、WinComboBox 38 KB。
- 仓库还含 .NET 打包工程（`WinUIonWeb.slnx` / `.esproj`，面向 Windows 应用打包）；纯 Web 场景**不需要**。
- 控件源码为 **JS `<script setup>`（无 TS）**：vue-tsc 会把它们当 any，模板里 PascalCase 属性写错不会在类型层暴露。

## 3. 可行性分析

### 3.1 模块映射

| motion-cube 现有 | 迁移去向 |
|---|---|
| `src/main.ts`（路由 switch + 挂载） | Vue 入口：`createApp(App).use(router)` + `app.provide(i18nKey, createI18n(...))` |
| `src/router.ts` | vue-router（保留 hash history，与现状一致） |
| `src/ui/nav.ts` | WinNavigationView（`MenuItems`，Top / Left 模式）或 WinPivot |
| `src/i18n/*` | 并入 WinUIonWeb i18n：`en` → `en-US` 映射 + 合并业务文案目录 |
| `src/ui/dom.ts` | 删除（Vue 模板取代） |
| `src/pages/*.ts` | 7 个 `.vue` SFC，按页面选用 Win* 控件 |
| `src/cube/CubePlayer.ts` 等纯逻辑 | 原样保留，SFC 直接 import；CubePlayer 包一层 `CubePlayerView.vue`（`onMounted` 挂容器） |
| `src/styles/*.css` | 仅保留应用专属布局样式；UI 样式交给 WinUIonWeb 主题 |
| `src/hand/*View.ts`、`ui/hud.ts` 等 DOM 视图 | 逐个评估：重写为 SFC 或保留原类挂载进容器 ref |

### 3.2 各页面可用的 Win* 控件

| 页面 | 建议控件 |
|---|---|
| start | WinTextBlock、WinButton（AccentButtonStyle / SubtleButtonStyle）、布局面板 |
| game | CubePlayerView、WinTextBlock、WinButton、WinSlider、WinToggleSwitch、WinInfoBar（计时/状态） |
| library | WinTextBox、WinComboBox、WinListView / WinGridView（列表）、WinButton、WinContentDialog（删除确认）、WinInfoBar（保存状态）、WinToggleSwitch、tag chips 可自定义或 WinSelectorBar |
| editor | WinTextBox（alg 输入）、WinSlider（时间轴）、WinNumberBox、WinToggleSwitch、WinButton、WinExpander（参数分组）、WinListView（关键帧）、WinPivot（页签）、WinContentDialog |
| hand | WinSlider（关节角）、WinNumberBox、WinToggleSwitch、WinComboBox（手指/接触目标）、WinButton、WinContentDialog |
| keymap | WinListView / WinExpander 分组、WinButton、WinContentDialog（冲突提示）、WinToggleSwitch |
| help | WinTextBlock、WinExpander（分节）、WinInfoBar、WinNavigationView 可作二级导航 |

### 3.3 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| **GPL-3.0 传染** | 公开分发时整个项目须 GPL-3.0 | 先与用户确认授权策略（见 §6 决策项）；至少保留上游版权声明与许可证副本 |
| 非 npm 包，上游迭代快 | vendor 后无法自动升级 | 锁定上游 commit（记录 hash），写 `scripts/sync-winui.mjs` 同步脚本 + 差异记录 |
| 控件为 JS 无类型 | 模板属性拼写错误运行时才发现 | 迁移每个页面后跑 dev + puppeteer 截图回归（沿用 spike-shots 工作流） |
| 体积：大控件源码 1.24 MB | 构建产物增大 | 只 vendor 依赖闭包子集（见 §4）；构建后检查产物大小 |
| i18n 双轨 | 文案 key 冲突/丢失 | `en` → `en-US` 归一；业务文案合并进 WinUIonWeb ResourceMap；占位符格式一致（`{param}`） |
| 游戏/编辑器交互复杂（键盘连击、时间线、手指动画） | 迁移引入回归 | 这两页最后迁移；逻辑抽成 composable（纯 TS）后仅换渲染层；CubePlayer/HandRig 先以原类挂载 |
| 主题变量缺失导致控件裸奔 | 视觉崩坏 | 全局引入 theme.css + animations.css，字体资源随 vendor 一并复制 |

## 4. 集成（vendor）方式

WinUIonWeb 无 npm 包，可选项：

- **A. 整目录复制**（简单）：`src/components`（含 `i18n`、`Strings`、`winTitleBarDragRegion.ts` 等附属）+ `src/styles` + `src/assets/Fonts/SEGOEICONS.TTF` 复制进 motion-cube。后续升级靠同步脚本整体覆盖。
- **B. 依赖闭包子集**（省体积）：按实际用到的控件做可达性分析，只复制被引用到的 Win* 组件 + 主题 + 字体。省体积但同步脚本要维护依赖图。
- **C. git submodule**（保同步）：`WinUIonWeb` 作为子模块，import 指向子模块源码；可 `git submodule update` 升级。代价：构建配置/编辑器需容忍跨仓库源码引用，motion-cube 作为单仓库的简洁性受损。

> 建议：先用 **A（整目录复制）** 起步保证可运行，再视构建体积决定是否切到 B；不推荐 C（本项目是单仓小项目，子模块收益低于复杂度）。

## 5. 实施计划（分阶段）

> 每阶段结束 = dev 可跑 + `npm run typecheck` 绿 + 关键页面截图对比。阶段 1–3 可在同一分支推进；阶段 4 逐页提交，便于回滚。

### 阶段 0：决策（需要用户拍板，见 §6）

### 阶段 1：工具链
- 安装 `vue`、`vue-router`、`@vitejs/plugin-vue`、`vue-tsc`（兼容 Vite 8 / TS 7）。
- vite.config.ts 增加 vue 插件；tsconfig 增加 `*.vue` shim。
- 冒烟：空 Vue 组件挂载到 `#app`，typecheck + build 通过。

### 阶段 2：vendor WinUIonWeb
- 按 §4 选定方式复制控件源码（记录上游 commit hash 与日期）。
- 复制 `theme.css` / `animations.css` / 字体；新增 `THIRD_PARTY_NOTICES.md`（GPL-3.0 版权声明）与许可证副本。
- 建 `scripts/sync-winui.mjs`：拉取上游指定 commit、复制、生成差异摘要。

### 阶段 3：Vue 壳（应用外壳）
- 新 `src/app-vue/`（或 `src/vue/`）：`main.ts` 改为 createApp；`App.vue` 组装 WinNavigationView（7 个导航项）+ `router-view` + 可选 WinTitleBar。
- vue-router 7 条路由（hash history）；`LegacyPage.vue` 宿主组件：`onMounted` 时调用旧 render 函数挂进容器 div，`onBeforeUnmount` 调旧 cleanup——未迁移页面继续可用。
- i18n 桥接：`createI18n` 合并 motion-cube 业务文案与控件文案；`en` → `en-US`。
- 该阶段结束时：功能与现状完全等价，仅外壳换成 WinUI 风格。

### 阶段 4：逐页迁移（按复杂度升序）

建议顺序：**start → help → keymap → game → library → handCalib → editor**（简单页先打通模式，游戏/编辑器最后）。

每页流程：
1. 逻辑抽离：把页面内纯逻辑（若有）抽成 composable 或复用现有纯模块。
2. 写 `.vue` SFC：用 Win* 控件重建模板与交互。
3. 行为对拍：旧页面截图 vs 新页面截图（沿用 puppeteer + spike-shots）；键盘/计时等行为手测。
4. 删除旧 render 函数（或保留到全部迁移完再删）。

### 阶段 5：收尾
- 删除 `ui/dom.ts`、`ui/nav.ts`、旧 `i18n/`（若已并入）、旧 `styles/*.css` 中已被主题取代的部分。
- 移除 LegacyPage 宿主与旧 main.ts 渲染分支。
- `npm run build` 产物大小检查；更新 `docs/todo.md` 与 README。
- 可选：接入 WinTitleBar + 主题切换（light/dark/Mica/Acrylic）、页面过渡动画（gallery 已有范式可抄）。

## 6. 待决策项

1. **授权策略（必须确认）**：接受 GPL-3.0 传染？
   - 仅本地/私有使用：无影响。
   - 公开 GitHub / 公开部署：整个项目须 GPL-3.0（并附上游版权声明）。
   - 若不能接受：需先与上游作者沟通换许可证（MIT/Apache 等），或放弃控件复用、仅参照其视觉实现。
2. **vendor 方式**：整目录复制（推荐起步）还是依赖闭包子集。
3. **外壳范围**：只要 WinNavigationView 导航，还是连 WinTitleBar + 主题切换一起做（阶段 5 可选）。
4. **迁移节奏**：是否接受"先增量后全量"（阶段 3 保留旧页面运行）的过渡形态。

---

## 附：已核实的事实清单（评估依据）

- WinUIonWeb 仓库默认分支 master；README 声明独立实现、未使用微软 WinUI 源码；LICENSE 为 GPL-3.0。
- 仓库结构与依赖：`WinUIonWeb/package.json`（vue ^3.5.32、vue-router ^4.6.4、vite ^8.0.8、typescript ~6.0.0、`private: true`）。
- 控件注入面：宿主只需 provide `i18nKey`；`winuiTheme` 由 WinThemeWrapper 提供（可选）；`win-switch-presenter` / `radioButtonsGroupKey` 均为控件内部自足。
- motion-cube 工作树干净；Node v24.18.0 满足 WinUIonWeb 引擎要求（>=22.12.0）。
