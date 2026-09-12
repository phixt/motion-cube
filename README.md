# Motion Cube

魔方动作播放 / 编辑 / 查看工具：3D 魔方操控（cubing.js）、公式库 / 手法库管理、手法动画编辑器（双手同屏，左右手独立编辑）、手部模型标定、内置求解器（CFOP / CFOP+ / Roux 分步演示与解法底选择）。

> **许可证**：本项目以 [GNU GPL v3](LICENSE) 授权（因包含 GPL-3.0 的 WinUIonWeb 控件源码）。

## 技术栈

- Vite 8 + TypeScript + Vue 3.5（vue-router 4，hash 路由）
- UI：WinUI 风格控件（[WinUIonWeb](https://github.com/Furry-Xiyi/WinUIonWeb) vendored，GPL-3.0，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）
- 3D：cubing.js（TwistyPlayer 魔方）+ three.js（low-poly 手部模型，双手显示）
- 桌面版：Tauri 2（NSIS 打包，tag 触发 Release CI）

## 项目结构

```
motion-cube/
├─ src/
│  ├─ app/                 # 应用装配（App.ts：路由表 / 壳布局 / 启动引导）
│  ├─ preview/             # WinUI 控件预览入口（preview.html）
│  ├─ vue/pages/           # 页面：Start / Game（求解+演示）/ Library / Editor（手法编辑器）
│  │                       #   HandCalib（手部标定）/ HandLab / Keymap / Help / RenderDemo
│  ├─ vue/components/ composables/ styles/
│  ├─ cube/                # CubePlayer（cubing.js 封装）+ render/（自建 three 渲染层）
│  │                       #   + solver/（纯 TS 求解器：engine / search / algs / f2lTable / cfop / roux）
│  ├─ hand/                # three.js 手部：handMesh（low-poly 截面放样几何）/ HandRig /
│  │                       #   HandRigView / HandOrbitView / handRigStore / handApi（注入 API）
│  ├─ data/                # technique.ts（手法 / 关键帧数据契约）+ 公式库 algDb / libraryStore
│  ├─ timeline/ input/ notation/ game/ i18n/ ui/ styles/
│  └─ vendor/winui-on-web  # WinUIonWeb 控件源码（vendored）
├─ data/samples/           # 内置公式库 cuberoot-algs.json + 示例手法库 library.json
├─ docs/                   # todo.md（进度 / 待办总账）+ hand-api-usage / hand-api-spec / params 等
├─ scripts/                # 验证与截图工具（verify-* / smoke-* / playtest-* / shot-* / gen-*）
├─ tools/icon-lab/         # 应用图标生成工具
├─ src-tauri/              # Tauri 桌面壳（Rust；NSIS 打包；应用图标）
└─ .github/workflows/      # CI（typecheck / build / verify / playtest）+ Release（tag 触发）
```

数据持久化全在 localStorage（settings / keymap / editorKeymap / library / handRig 等）；进度与待办以 [docs/todo.md](docs/todo.md) 为唯一总账。

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # vue-tsc 严格检查
npm run build      # vue-tsc + vite build
npm run preview
```

WinUI 控件预览页（壳与控件的独立验证载体）：`npm run dev` 后访问 `/preview.html`。

## 外部注入 API（DEV）

开发构建的动画编辑器页（`#/editor`）暴露 `window.motionCubeHand`，可用脚本直接驱动手部姿态与帧播放（`setPose` / `playFrames` / `stop` / `clear` / `setHandType` / `setVisible` / `getState`）。双手同屏为默认：`setPose` / `playFrames` 同时驱动左右手（左手为右手镜像）；`setHandType("left" | "right")` 切换单手显示，`setVisible(true)` 恢复双手。生产构建不暴露。用法示例见 [docs/hand-api-usage.md](docs/hand-api-usage.md)，规格与实现约束见 [docs/hand-api-spec.md](docs/hand-api-spec.md)。

## UI 设置（标题栏按钮）

- **主题**：系统 / 浅色 / 深色（`html.theme-light` / `html.theme-dark`）
- **材质**：Mica（实色）/ Acrylic（磨砂半透明）
- **缩放**：100% – 200%（默认 150%，高 DPI 适配；全局 `zoom` 缩放，文本/图标/3D 画布统一放大）
- **视差**：关 / 弱 / 中 / 强（默认中；首页鼠标视差强度，由显式设置控制，不受系统"减少动画"影响）

设置持久化在 localStorage（`motion-cube.theme` / `motion-cube.material` / `motion-cube.uiScale` / `motion-cube.parallax`）。

## 首页视差界面

- 左右布局：左侧标题/副标题/进入游戏，右侧伪 3D 魔方（CSS 3D，6 face × 3×3 格、极细格线分块、低饱和色板明暗各一套）
- 鼠标视差：远景几何层（圆环/菱形/三角，慢漂移 + 视差）+ 魔方微旋转，由 `useParallax`（单一输入源，rAF + 帧率无关 lerp）输出 `--par-u/--par-v` 到页面根节点
- 窄窗口（<900px）卸载魔方，标题居中；背景视差减弱
- 可访问性：装饰层 `aria-hidden` + `pointer-events: none`；视差/自转/漂移强度由显式设置控制（不依赖系统 reduced-motion，可选择"视差: 关"停用）

## 测试与 QA

```bash
node scripts/verify-notation.mjs    # 记法解析/序列化自检（纯 Node）
node scripts/playtest-ui.mjs        # 完整 UI 流程回归（需先起 dev server，可用 SPIKE_URL 指定地址）
node scripts/shot-shell.mjs         # 壳回归截图（7 路由 + 主题/材质切换）
node scripts/shot-preview.mjs       # WinUI 预览页截图
```

截图输出到 `spike-shots/`（已 gitignore）。

## 迁移状态

原 vanilla TS 命令式 DOM 版已整体迁移到 Vue 3 + WinUIonWeb（7 个页面全部迁移，playtest 全量通过）。
