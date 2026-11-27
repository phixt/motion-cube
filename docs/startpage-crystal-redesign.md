# Track C · 开始页折光魔方、空间背景与图标重构简明交接

> 状态：首版完整落地并过构建与实机 WebGL 0 报错验证（2026-11-27）· 后续可在 `motion-cube` 内直接精修参数与构图。

## 已落地改动

| 文件 | 说明 |
| :--- | :--- |
| `src/render/startCausticCube.ts` | **高清折光魔方 + 斜射焦散**：取消 216px 低像素放大与粗 Bayer 麻点，改为原生 DPR + 抗锯齿细缝；采用 **45° 倒角外棱 + 26 块内挖球面空腔（`R = 0.62`，平凹透镜折射/曲面全内反射弧光）+ 空腔正中真实 6 轴十字轴芯（轴毂 + 6 轴柱 + 面色调松帽）+ U/R 交替约 36° 呼吸微拧**；地面重构为柔和中性接触影 + `38°` 斜射单色系光学焦散光环 |
| `src/vue/pages/StartPage.vue` | **空间运动几何背景**（纯 SVG/CSS，零额外 WebGL 开销）：环境漫射融合层 + 远景旋转轨道弧与方向微标 + 中景 5 组差异化解构构件（三层薄片、内挖球腔棱晶、错位 L 角块、6 轴十字轴标、倒角棱片）配独立相位慢速呼吸 + 近景四角星芒与微环；深/浅主题均已校准 |
| `scripts/gen-app-icons.mjs` | **新版 Tauri 图标生成器**：深邃午夜靛蓝圆角底 + 顶层 `28°` 拧转 3×3 折光魔方（冰白/蔚蓝/翡翠绿 + 层间内腔棱镜光弧 + 四角星芒），一键输出 `src-tauri/icons/` 全套 15 张 PNG 及多尺寸 `icon.ico` / `uninstaller.ico` |

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
