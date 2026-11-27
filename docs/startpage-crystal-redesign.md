# Track C · 开始页折光魔方、空间背景与图标重构简明交接

> 状态：首版完整落地并过构建与实机 WebGL 0 报错验证（2026-11-27）· 后续可在 `motion-cube` 内直接精修参数与构图。

## 已落地改动

| 文件 | 说明 |
| :--- | :--- |
| `src/render/startCausticCube.ts` + `src/render/startCubeGeo.ts` | **轻量真实 3D 外露贴片速拧魔方 + 斜射焦散**：全面淘汰每像素 68 步 Raymarching，改为 4 分区预合并真实 3D 网格（仅 ~14 次 Draw Call + 原生硬件 MSAA）；结构为 **26 块浅冰透微雾面壳体（精确内挖 `R = 0.645` 球面空腔 + 真实 3D 物理块缝）+ 54 片外露独立半透果冻/亚克力 Florian 倒角贴片 + 空腔中心真实 6 轴十字轴芯（球毂/直插轴柱/弹簧环/面色调松帽）+ U/R 交替约 36° 呼吸微拧**；地面保留柔和中性接触影 + `38°` 斜射单色系光学焦散光环 |
| `src/vue/pages/StartPage.vue` | **空间运动几何背景**（纯 SVG/CSS，零额外 WebGL 开销）：环境漫射融合层 + 远景旋转轨道弧与方向微标 + 中景 5 组差异化解构构件（三层薄片、内挖球腔棱晶、错位 L 角块、6 轴十字轴标、倒角棱片）配独立相位慢速呼吸 + 近景四角星芒与微环；深/浅主题均已校准 |
| `scripts/gen-app-icons.mjs` | **方案 B 硬朗光影 3×3 Tauri 图标生成器**：保留三阶秩序与顶层 `21°` 拧转，移除透明内构并用深影藏匿块缝/层间细节实现视觉减负；采用左上斜射虚拟主光 + 2048px 真实硬朗层间投影 + 贴片 45° 切面高光 + 右侧克制冷补光，配低饱和深灰靛 WinUI 圆角底板（标准左红/右蓝/上白，无星芒），一键输出 `src-tauri/icons/` 全套 15 张 PNG 及 `icon.ico` / `uninstaller.ico` |

## 常用验证与重出命令

```powershell
# 类型检查与前端构建
npm run build

# 重新生成全套 Tauri 图标（修改 scripts/gen-app-icons.mjs 配色/倾角/星芒后执行）
node scripts/gen-app-icons.mjs

# 启动预览并截屏核验开始页（含深/浅主题）
npm run preview -- --port 5174 --strictPort
node scripts/shot-shell.mjs
```

## 后续精修入口

1. **魔方透明度 / 内腔折光强度 / 6 轴可见度**：在 `src/render/startCausticCube.ts` 调 `cavR`（`0.62`）、`innerBlend`、`alpha`（`0.70..0.96`）、`isBevelFacet` 及 `evalMotionTwist()` 的周期（`6.4s`）与最大拧转角（`0.64 rad`）。
2. **斜射焦散位置与亮度**：在 `CAUSTIC_FRAGMENT_SHADER` 调 `causticCenter`、`causticA` 与 `domHue` 混合权重。
3. **背景构件疏密与浅色对比度**：在 `src/vue/pages/StartPage.vue` 调 `.bg-orbit-main`、`.tint-*` 及悬浮动画周期。
4. **应用图标微调**：在 `scripts/gen-app-icons.mjs` 调 `yaw / pitch`、顶层拧角（`0.49 rad`）、三面渐变色板与层间发光强度后重跑即可。
