# Motion Cube

魔方动作播放 / 编辑 / 查看工具：3D 魔方操控（cubing.js）、公式库 / 手法库管理、手法动画编辑器、手部模型标定。

## 技术栈

- Vite 8 + TypeScript + Vue 3.5（vue-router 4，hash 路由）
- UI：WinUI 风格控件（[WinUIonWeb](https://github.com/Furry-Xiyi/WinUIonWeb) vendored，GPL-3.0，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）
- 3D：cubing.js（TwistyPlayer 魔方）+ three.js（手部模型）

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # vue-tsc 严格检查
npm run build      # vue-tsc + vite build
npm run preview
```

WinUI 控件预览页（壳与控件的独立验证载体）：`npm run dev` 后访问 `/preview.html`。

## UI 设置（标题栏按钮）

- **主题**：系统 / 浅色 / 深色（`html.theme-light` / `html.theme-dark`）
- **材质**：Mica（实色）/ Acrylic（磨砂半透明）
- **缩放**：100% – 200%（默认 150%，高 DPI 适配；全局 `zoom` 缩放，文本/图标/3D 画布统一放大）

设置持久化在 localStorage（`motion-cube.theme` / `motion-cube.material` / `motion-cube.uiScale`）。

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
评估与实施计划见 [docs/migration-vue-winui-plan.md](docs/migration-vue-winui-plan.md)。
