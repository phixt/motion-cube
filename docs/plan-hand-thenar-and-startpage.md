# 计划：手部大鱼际下沉与默认姿态简化 + 开始页视觉灵感（caustic-gem）

> 状态：✅ 已完成（2026-11-24 按方案 A + 中量档落地，全套单测与真机截图/Playtest 验收通过）  
> 关联交接：[handoff-2026-11-24.md](file:///D:/P_rojects/motion-cube/docs/handoff-2026-11-24.md)

---

## 一、手部默认姿态 & 大鱼际结构简化改造

### 1. 用户反馈与代码现状核对

| 现象 | 代码核对结论 |
|---|---|
| 默认初始姿态显得奇怪，疑似仍是原来与食指成 ~45° 夹角状态 | `src/hand/HandRig.ts:132` 虽将 `DEFAULT_THUMB_CMC` 设为 `{ abduction: 0, elevation: 0, rotation: 15 }`，但拇指根 `thumbCorner = { x: 0.82, y: -0.08, z: -0.33 }` 几乎与掌面平齐且外伸，无「下沉」自由度；另若浏览器 `localStorage["motion-cube.handRig"]` 存有旧标定参数也会覆盖默认值。需在执行阶段**先渲染默认姿态的俯视（掌背 +Y）与 3/4 视角截图确认**当前实际夹角与遮挡。 |
| 虎口存在奇怪连接 | `src/hand/handMesh.ts:698-733` 的 `buildThumbWeb` 是在固定 `thumbCorner` 与食指掌侧缘之间拉出的 3 站静态椭圆斜管，既不随拇指/大鱼际形变，在多视角下都显出一条突兀的斜向连接桥。 |
| 大拇指及其肌群（大鱼际）位置与手掌弧度不对 | 真实手掌横弓主要由第 1 掌骨（大鱼际 + 拇指）承担下沉与对掌活动，其余四指可简化为微弓掌面；当前 `buildThenarRidge`（`handMesh.ts:619-692`）是直接挂在 `root` 下的静态凸块，与掌体近乎齐平（`yC = -0.04*H + thenar.y*H`），无法表达放松下沉与舒展齐平的切换。 |

### 2. 目标形态与简化设计原则

用户明确指出完整解剖建模偏复杂，**必须做工程化简化**：
- **四指保持简化**：沿用现有平缓横弓掌体 + 四指链，不额外引入第 2–5 掌骨复杂骨骼。
- **单轴旋转模型（大鱼际 + 拇指整体随动）**：
  - 在 `handMesh.ts` 引入一个 `thenarPivot: Group`，旋转轴沿**手掌拇指侧缘纵向（简化起步取局部 Z 轴）**，枢轴点放在掌体拇指侧缘内侧（约 `x = sideSign * halfW * 0.72`、`y ≈ -0.04 * H`，具体数值通过真机截图微调）。
  - 将 **`buildThenarRidge`（大鱼际肌群）** 与 **`thumbRoot`（及下挂的 `thumbDof` + 拇指链）** 一并移入 `thenarPivot` 坐标系内（局部坐标相对枢轴重建）。
  - 用单一标量角度 **`thenarFold`（范围 `0°–90°`）** 驱动绕轴旋转（向掌心 `-Y` 下沉；左右手乘 `sideSign` 保证严格 X 镜像对称）：
    - **`thenarFold = 0°`（舒展态）**：大鱼际与手掌齐平，五指平摊。
    - **`thenarFold ≈ 90°`（放松默认态）**：大鱼际肌群相对掌面向掌侧下沉（绕轴约 90°，可按目测在 75°–90° 间微调）。
- **放松默认态目视验收标准**：
  1. **俯视视角（掌背 +Y 朝向镜头）下五根手指均完整可见**（拇指不得缩到食指正下方被遮挡 —— 通过枢轴 X 偏移 + 适度展收 `abduction` 保证外露轮廓自然）。
  2. **大拇指自身略有对掌旋转，约 `75°` 左右**（使指腹自然斜向食指/掌心而非僵直朝下或朝正侧）。
  3. **取消虎口怪异斜桥**：先移除静态 `buildThumbWeb`；通过大鱼际近端圆润深埋入掌缘枢轴处，在 0°（舒展）到 90°（放松）全行程下都不露破缝、不出现悬空桥管。

### 3. 数据契约与硬约束考量（开工前需敲定 1 项取舍）

遵守 `docs/hand-api-spec.md` §4 硬约束：**不得破坏既有 `HandRig` 类型、`HandRigView` 公开方法签名、`playtest-ui` 断言**。

- **方案 A（最简，推荐起步）**：
  - 将 `thenarFold`（默认 `90` 或实测自然值，范围 `0–90`）先落为 `HandRigConfig` 的标定配置项（`handRigStore.ts` v4 向后兼容字段，缺省回默认值），同时在 `Pose.thumbCMC` 上新增**可选字段** `thenarFold?: number`（不填时回落到配置默认值，完全不破坏既有 `Pose` 与 `window.motionCubeHand` 外部注入契约）。
  - 编辑器关键帧面板与标定页各补一个「大鱼际下沉 (0°–90°)」滑块，既支持默认放松态，也支持手法关键帧中舒展齐平（`0°`）。
- **方案 B（更简，仅静态结构）**：
  - 仅作为 `HandRigConfig` 参数，不在 `Pose` 中逐帧变化（无法在动画中从放松切到舒展，略逊于方案 A）。

> 建议新会话开头向用户确认是否采纳 **方案 A**。

### 4. 执行步骤清单

1. **基线复核**：用浏览器脚本截取当前 `defaultHandPose` + 标定页俯视/侧视/3/4 视现状图，确认 45° 夹角与虎口连接具体位置。
2. **几何重构（`src/hand/handMesh.ts`）**：
   - 删去 `buildThumbWeb`；
   - 增加 `thenarPivot` 节点返回（`HandMeshResult` 可扩展可选字段，保持既有字段不变）；
   - 将 `buildThenarRidge` 与 `thumbRoot` 改建在 `thenarPivot` 局部空间，确保 `thenarFold = 0°` 与 `90°` 两个极端下掌缘均无穿模/裂口、左右手严格 X 镜像对称。
3. **姿态与默认参数更新**：
   - `src/hand/handRigStore.ts`：新增 `thenarFold`（含 `DEFAULT_HAND_CONFIG` 深冻结与 `normalizeHandRigConfig` 旧档迁移）；
   - `src/hand/HandRig.ts`：校准 `DEFAULT_THUMB_CMC`（目标大拇指自转 ≈ 75° + 合理展收使俯视五指全可见）与 `thumbCorner`，更新 `mirrorPose`（`thenarFold` 左右对称不取反）；
   - `src/hand/HandRigView.ts` / `src/hand/HandCalibView.ts` / `src/hand/HandOrbitView.ts`：同步驱动 `thenarPivot.rotation.z`；
   - `src/vue/pages/HandCalibPage.vue` / `src/vue/pages/EditorPage.vue`（若选方案 A）：补充滑块与中英 i18n。
4. **示例数据与测试同步**：
   - 核对并更新 `scripts/verify-hand-mesh.ts`（特别是左右手镜像容差 `1e-5` 与 **P0-7 拇指世界方向镜像测试**，该测试在脚本内复刻了 `applyPose` 变换链，必须补入 `thenarPivot`）；
   - 核对 `scripts/verify-hand-store.ts`（旧档迁移兜底断言）；
   - 视情况重生成 `data/samples/library.json`（`scripts/gen-samples.ts`）并核查「双手运动展示（示例）」与贴面默认手位 `x=±1.95` 不穿魔方；
   - 真机浏览器渲染截图（俯视、掌心、侧视、0° 舒展态、90° 放松态、双手贴面态），确认通过后再提交。

---

## 二、开始页视觉灵感计划（参考 `D:\P_rojects\caustic-gem`）

### 1. 参考项目核心技法提炼

`D:\P_rojects\caustic-gem` 是一个 Godot 风格化宝石渲染项目（参考 `参考.md` 中的 timbercyke 风格化折光理念），其核心视觉语言来自三份着色器：
- **`shaders/gem_raytrace.gdshader`（风格化平涂切面折光）**：
  - 放弃写实平滑渐变，改用**5 阶明度色板（value ramp）+ 6 种离散「火彩（fire）」亮色块**，配合**清晰棱边描线（facet border lines）**，让旋转体在转动时呈现爽利的几何大色块跳动。
  - 支持 **粗糙原石 → 切面成型 → 抛光出彩** 的阶段式入场过渡 uniform。
- **`shaders/caustic_ground.gdshader`（硬边分层焦散地面光斑）**：
  - 地面投影不是糊状高斯阴影，而是多层**硬边彩色焦散光瓣**（左右主瓣 + 外缘色边 accent rim + 内环 + 亮核），带轻微按对称阶数起伏的有机波纹与椭圆↔菱形形态混合。
- **`shaders/pixel_composite.gdshader`（可选 Bayer 4×4 有序抖动）**：
  - 轻量复古/艺术化质感统一。

### 2. 与 `motion-cube` 开始页的结合点

当前开始页（`src/vue/pages/StartPage.vue` + `src/vue/components/PseudoCube3D.vue`）结构非常清爽：
- 左侧：WinUI 标题 + 副标题 +「进入游戏」主按钮；
- 背景：两层 CSS 视差几何图形（圆环/菱形/三角慢漂移）；
- 右侧：纯 CSS 3D 无边框 `PseudoCube3D`（`<900px` 卸载，消费 `--par-u` / `--par-v` 视差）。

可以把 `caustic-gem` 的视觉语汇迁移成**「晶体折光魔方 + 硬边焦散光斑」**，同时保持 WinUI 的克制干净（不喧宾夺主、保留低耗与 `prefers-reduced-motion` 兼容）：

### 3. 三档落地候选方案（开工前由用户选档）

| 档位 | 核心改动 | 视觉收益与成本 |
|---|---|---|
| **轻量档（CSS / SVG 焦散增强）** | 保留 `PseudoCube3D` 纯 CSS 3D 魔方；① 在魔方下方新增**硬边分层焦散光斑**（SVG/Canvas 多层色瓣 + 随旋转/视差轻微偏移与呼吸）；② 魔方面板加一层离散斜向高光色块与更利落的棱边光感；③ 背景漂移几何改为轻微彩色折光棱镜边（跟随主题明暗）。 | 零 WebGL 开销、首屏极快、与现有 WinUI 主题变量无缝兼容；风格化折光深度有限。 |
| **中量档（Canvas/GLSL 焦散 + 风格化 Three.js 魔方，推荐）** | 用轻量 Three.js（项目已内置 three.js，无新增依赖）替换/增强 `PseudoCube3D`：① 3×3 魔方采用**风格化平涂色阶 + 离散火彩高光面 + 细棱线**（保留魔方六色辨识度，同时有宝石切面质感）；② 下方配套一块简化移植自 `caustic_ground.gdshader` 的**硬边焦散平面**（随魔方自转角度实时摆动色瓣与亮核）；③ 保留 `<900px` 卸载、鼠标视差、40s 优雅自转与短促「切面→点亮」入场动画（尊重 `prefers-reduced-motion`）。 | 视觉辨识度最高、完整吸收 `caustic-gem` 精髓且不引入重型后处理；需注意卸载时完整 `dispose()` 与 Tauri/明暗主题适配。 |
| **彩蛋档（多材质切面预设）** | 在中量档基础上允许点击开始页魔方循环切换 2–3 种风格材质（如「经典哑光 / 晶体折光 / 极光火彩」），纯交互彩蛋不影响主流程。 | 趣味性强，可在中量档验收后再按需叠加。 |

### 4. 开始页改动护栏

- 不破坏 `playtest-ui.mjs` 对开始页「进入游戏」按钮与首屏加载的断言；
- 严格遵循 `<900px` 卸载动画组件与页面卸载 `dispose()` 释放 WebGL 上下文；
- 兼容明/暗主题切换与 `prefers-reduced-motion: reduce`。
