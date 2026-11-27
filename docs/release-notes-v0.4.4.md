# Motion Cube v0.4.4 Release Notes

> 发布日期：2026-11-27　｜　桌面安装包：`MotionCube_0.4.4_x64-setup.exe`（Windows NSIS，当前未 Authenticode 签名，首次运行如遇 SmartScreen 提示请选择「仍要运行」）

本版本是自 `v0.4.1` 以来的首个正式桌面发布，重点完成**官方音频系统与音乐浏览中心**、**开始页 3D 外露贴片魔方与性能重构**、**新版硬朗光影应用图标**，同时汇总交付此前在 `0.4.2` / `0.4.3` 阶段落地的高级求解器、手部结构与编辑器重磅升级。

---

## 本次核心新增（v0.4.4）

### 1. 官方原声带、极简提示音效与「音乐与音效」浏览中心
- **双轨无缝循环 BGM（统一 A Major / F#m9 折光玻璃声景）**：
  - 开始页专属 `Start · 折光启程`（80 BPM · 1:12），工作区共享 `Workspace · 专注律动`（88 BPM · 1:27，在游戏 / 公式库 / 动画编辑器 / 手部 / 设置间切换**不中断、不重播**）；
  - 跨区切换自动 `0.40s` 淡入 / `0.45s` 淡出并记忆播放断点；页面切后台自动暂停、切回平滑恢复；内置 `.ogg` 优先 + `.mp3` 回退与首屏手势自动解锁。
- **极简 3 节点克制 SFX**：
  - 仅在 **还原完成 / 算出解法（`sfx_solved`）**、**点击打乱瞬间（`sfx_scramble`）**、**保存手法或公式 / 复制解法成功（`sfx_save`）** 轻响提示；
  - 常规魔方转动与时间线拖动严格保持静音，避免高速连拧或倍速播放听觉干扰。
- **音乐与音效浏览中心（侧栏「音乐」 `#/audio`）**：
  - 支持 **全局静音（`M` 键）**、**背景音乐独立开关**、**提示音效独立开关** 三路正交控制，以及独立 BGM / SFX 音量滑条（默认轻背景 `35%` / `65%`）；
  - 支持切换 **切页策略（随页面切换 / 锁定当前曲目）**、专辑封面与实时播放进度拖动跳转、曲目卡片点击交叉淡化试听、一键恢复当前场景曲与 3 音效现场试听；
  - 标题栏新增快捷声音开关；全局按 `M` 一键静音（文本框输入与改键捕获期不抢键；游戏页默认 `M` 绑中层转时自动让行，可用 `Alt+M` 随时静音）。

### 2. 开始页 3D 魔方性能与外观重构 + 新版应用图标
- **开始页轻量真实 3D 速拧魔方**：
  - 全面淘汰每像素 68 步 Raymarching，改为 4 分区预合并真实 3D 网格（仅 ~14 次 Draw Call + 原生硬件 MSAA），核显低功耗模式轻松稳跑 60fps；
  - 26 块 **浅冰透微雾面壳体**（精确内挖 `R = 0.645` 球面空腔 + 真实 3D 物理块缝）+ 54 片 **外露半透果冻/亚克力 Florian 倒角贴片** + **真实 6 轴十字轴芯**，彻底消除厚重感、假缝断头与层拧转错位；
  - 保留 U/R 交替约 `36°` 慢速呼吸微拧、柔和接触影与斜射单主导色焦散光环，以及空间运动几何视差背景（支持深/浅双主题与弱动效模式）。
- **新版 Tauri 桌面图标（方案 B 硬朗光影 3×3）**：
  - 修正为标准西洋配色（**左红 / 右蓝 / 上白**），移除星芒与繁杂内部透视，以深影收束块缝并配左上虚拟主光 + 2048px 真实层间硬朗投影，在 16px–512px 全尺寸下清晰锐利。

---

## 汇总包含（自 v0.4.1 以来的重要升级）

- **高级求解器全面收口与 Web Worker 后台化**
  - 求解计算迁入 Web Worker 后台预热与执行（支持中途取消），彻底消除界面卡顿；
  - **ZBLL 100% 全空间覆盖**（493/493 完整库 + post-AUF × y 共轭精确覆盖 7776/7776 态）；
  - **ZBLS 四槽统一**（302/302 全收录，真实 3-F2L 态 100% 命中，CFOP+ 平均省约 12 步）；
  - **Roux EOLR 真实生效**（3 伪位 `<M,U>` 求解器 + 修复命名表）；支持 6 色底多选求解与 24×6=144 组合端到端底色校验。
- **3D 手部模型精修与大鱼际联动**
  - 重写低模手部几何（平滑法线柔光、饱满指型圆顶、无缝掌指过渡）；
  - 移除怪异虎口斜桥，将大鱼际肌群与拇指装入单轴 `thenarPivot` 联动下沉（`0°..90°`），同步接入标定页、编辑器关键帧与时间线插值；新增内置双手同步运动展示手法。
- **动画编辑器与游戏体验优化**
  - 编辑器新增自定义正放/倒放起始态输入、未保存 `.dirty` 提示与 `Ctrl+S` 保存、标灰面板 `canonicalView` 标准朝向锁定；
  - 修复游戏页连打丢键（`isTextEntryTarget` 统一焦点判据）、统一 `500ms` 动画基准与播放中调速即时生效、库加载逐条容错且整包损坏时拒绝覆写空库。
- **桌面端与工程基建**
  - 新增 Tauri 无边框自绘 WinUI 标题栏（含最小化/最大化/关闭、拖拽、主题/材质/缩放/视差/声音切换）与严格 CSP；
  - 完善 GitHub Actions CI（类型/构建/版本四处同步/数据与求解器全套门禁/`cargo check`/无头浏览器 UI+Solver Playtest）与 Windows NSIS 自动发版流水线。

---

## English Summary

**Motion Cube v0.4.4** ships the first desktop installer since `v0.4.1`, introducing:
- **Official Soundtrack & Music Hub (`#/audio`)**: Seamless looping BGM for Start & Workspace (workspace route switches never restart playback), 3 understated SFX cues (solved, scramble start, save/copy; cube turns stay silent), orthogonal Master (`M` / `Alt+M` on Game page) + BGM + SFX switches, independent volume sliders, page-switch lock mode, album-art player with seek bar, and SFX audition pad.
- **Start Page 3D Cube Overhaul & Crisp 3×3 App Icons**: Replaced per-pixel raymarching with a lightweight 4-chunk real 3D mesh (~14 draw calls, native MSAA) featuring 26 frosted-ice spherical-cavity cubies, 54 exposed semi-translucent Florian beveled caps, and an authentic 6-axis core; updated desktop icons to a crisp, studio-lit standard-color (Red/Blue/White) 3×3 design.
- **Consolidated `0.4.2–0.4.3` Upgrades**: Web Worker solver with 100% ZBLL / 4-slot ZBLS / Roux EOLR, refined 3D hand rig with single-axis thenar fold, editor custom start states & reliability fixes, and frameless WinUI Tauri titlebar.
