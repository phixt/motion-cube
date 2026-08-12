# Third-Party Notices

## motion-cube

- 许可证：GNU GPL v3（见 [LICENSE](LICENSE)）
- 说明：项目整体以 GPL-3.0 授权（因其包含 GPL-3.0 的 WinUIonWeb 控件源码，copyleft 传染）。

## WinUIonWeb (Vue WinUI 控件库)

- 项目：https://github.com/Furry-Xiyi/WinUIonWeb
- 许可证：GNU GPL v3（见 [src/vendor/winui-on-web/LICENSE](src/vendor/winui-on-web/LICENSE)）
- 上游 commit：`a61bf49365d1048c4a7b8d799e3cb925f47d479f`（2026-08-11T09:18:33+08:00，Merge branch 'master' of https://github.com/Furry-Xiyi/WinUIonWeb）
- 用途：motion-cube 的 WinUI 风格 UI 控件（Vue 组件 + 主题样式 + 图标字体）
- 同步方式：`node scripts/sync-winui.mjs`（清单见 src/vendor/winui-on-web/VENDOR.json）
- 本地修改：仅自动注入 `// @ts-nocheck` 与来源头注释，未改动业务逻辑。

> 依据 GPL-3.0，motion-cube 若对外分发（如公开托管 / 发布），整体须以 GPL-3.0 授权。
