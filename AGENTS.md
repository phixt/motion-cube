# 项目记忆（motion-cube）

## 环境偏好

- **端口**：5173 是用户日常预览端口（用户自己占用），本项目的自动化、dev server、
  playtest 一律使用其他端口（如 5174），避免与用户预览冲突。
- **tauri 桌面版**：dev/build 走 5174（tauri.conf 已设）；命令
  `npm run tauri dev` / `npm run tauri build`；产物在 src-tauri/target/release
  （exe + bundle/nsis 安装器）；打包后启动验证用 Start-Process + 截图确认渲染
- **Windows**：优先 PowerShell 7（pwsh）；中文输出前设置 UTF-8
  （PowerShell `[Console]::OutputEncoding`、Python `sys.stdout.reconfigure`）；
  沙箱受限进程无法启动 WindowsApps 目录下的别名程序时，用完整路径或提权通道。

## 项目速览

- Vite 8 + Vue 3.5 + TypeScript + cubing.js（3D 魔方）+ three.js（手模型）+ WinUIonWeb 壳。
- 数据持久化全在 localStorage（settings/keymap/editorKeymap/library/handRig）。
- 编辑器以 3D 视图为中心 + 左侧 PS 风格侧边栏；页面不滚动（详情区内部滚动）。
- playtest：`node scripts/playtest-ui.mjs`（先起 dev server，SPIKE_URL 指向非 5173 端口）。
