# hand 审计报告 — src/hand/*（three.js 手部模块 + 外部注入 API）

- 审计范围：`src/hand/{handMesh,HandRig,HandRigView,HandCalibView,HandOrbitView,handRigStore,handApi}.ts`、`docs/hand-api-spec.md`、`docs/hand-api-usage.md`、`scripts/verify-hand-mesh.ts`、`scripts/measure-hand.mjs`，以及直接消费方 `src/vue/pages/EditorPage.vue`、`src/vue/pages/HandCalibPage.vue`、`src/data/technique.ts`
- 排除：`node_modules/`、`dist/`、`src-tauri/target/`、`spike-shots/`、`reference/`、`.reasonix/`、`src/vendor/winui-on-web`
- 方法：逐行读完 7 个源文件 + 2 份规格 + 2 个脚本；用 `npx tsx` 在 **OS 临时目录**（`%TEMP%\mc-audit\`）跑 4 个只读探针脚本（几何朝向/NaN/镜像差/关节子树/重建耗时），不写仓库；核对生产构建产物确认 DEV 门控；核对 `dist/assets/EditorPage-*.js`（构建时间 2026-09-12 22:29 晚于全部手部源文件最新修改 21:27 与 EditorPage.vue 22:15，产物为当前源码）
- 只读保证：本次审计**仅写入本文件** `docs/audit/hand.md`。未修改/创建/删除任何其他文件；未执行 `npm install`；未启动 dev server；未 commit/branch/stash。临时探针脚本全部落在 `%TEMP%\mc-audit\`，仓库内无残留（`git status` 中 `?? _v*.ts`、`?? docs/audit/` 为审计前既有状态）。
- 运行环境：Windows，Node v24.18.0，three 0.170.0（经 cubing 传递依赖引入，见 F12）

---

## 实跑验证记录（为发现背书）

| 命令 / 探针 | 结果 |
|---|---|
| `npx tsx scripts/verify-hand-mesh.ts` | exit 0（ALL PASS ✓）——**但覆盖有盲区，见 F14** |
| 探针 A：逐部件左右手包围盒 + 朝向（%TEMP%/mc-audit/hand-check.ts） | 右手 knuckle-filler `outward=180 inward=0`；**左手 `outward=0 inward=180`** |
| 探针 B：逐部件镜像差（hand-parts.ts） | 左手 thenar 与右手非精确镜像，误差 0.00871 数据单位；`facets` 为偶数时误差 = 0 |
| 探针 C：拇指关节子树（thumb-joints.ts） | `thumb: joints=3`，其中 **`j2 children=0`**（IP 关节组为空） |
| 探针 D：退化 bases / 极值配置 NaN（nan-probe.ts） | `index.x == middle.x` 被 `normalizeHandRigConfig` 接受 → `web-0` 114 个 NaN、`knuckle-filler` 540 个 NaN |
| 探针 E：重建耗时 | `buildHandMesh` ≈ **4.9 ms / 只手**（10 次均值） |
| 生产产物核对 | `grep "window.motionCubeHand *=" dist/assets/*.js` → **无匹配**；仅剩 `delete window.motionCubeHand`（来自 `unregisterHandApi`）→ **DEV 门控真实有效** |
| i18n 键集比对（zh-CN vs en） | 344 = 344，`hand.*` 57 = 57，**无缺项、无未翻译值** → i18n 干净 |
| `HandRigView.setHandType` / `currentPose` 调用点全仓检索 | `setHandType` **零调用方**（死代码）；`currentPose` 仅 handApi.getState |

---

## 发现汇总

| # | 标题 | 严重度 | 分类 | 文件 | 行 | 工作量 | 置信度 |
|---|---|---|---|---|---|---|---|
| F1 | 左手「指根间填充棱」几何绕向整体反转 → 被背面剔除，**左手三处填充棱不可见** | high | correctness | src/hand/handMesh.ts | 806-814, 573-607 | S | high |
| F2 | 编辑器 `renderPreview()` 每次渲染都重喂姿态 → **`window.motionCubeHand` 驱动的姿态被覆盖**，playFrames 与编辑器 60Hz 互抢 | high | correctness / state contract | src/vue/pages/EditorPage.vue · src/hand/handApi.ts | 700-709, 51-54 | M | high |
| F3 | `HandRigView` 没有 `dispose()` → 手部几何/材质在每次编辑器挂载-卸载时泄漏；`buildRig()` 重建同样泄漏 | high | resource leak | src/hand/HandRigView.ts · src/vue/pages/EditorPage.vue | 187-203, 1506-1522 | M | high |
| F4 | `loadHandRigConfig()` 返回**共享可变**的 `DEFAULT_HAND_CONFIG` 单例 → 标定页就地改写模块默认值，「重置」重置不回真默认 | high | state / data contract | src/hand/handRigStore.ts · src/vue/pages/HandCalibPage.vue | 228-236, 102-125 / 41, 231 | S | high |
| F5 | `shape.web` 是**死参数**：被规范化、被持久化、在标定页有滑块，但几何从不消费 | medium | dead code | src/hand/handRigStore.ts · src/hand/handMesh.ts · HandCalibPage.vue | 50, 222 / — / 149 | S | high |
| F6 | 拇指 IP 关节组为空 → 编辑器「IP」弯屈滑块**无任何视觉效果** | medium | correctness | src/hand/handMesh.ts · src/hand/HandRigView.ts | 325-330, 160-167 | M | high |
| F7 | `normalizeHandRigConfig` 接受退化指根布局 → 产出 **NaN 顶点**，整手包围盒变 NaN → 标定页相机适配崩坏 | medium | robustness | src/hand/handRigStore.ts · src/hand/handMesh.ts | 182-187 / 249-253, 585-599 | S | high |
| F8 | API 的 `setHandType` 不转调 `handView.setHandType`（规格要求转调）；`HandRigView.setHandType` 成为**零调用死代码**；spec 与 usage 文档互相矛盾 | medium | contract violation / doc drift | src/hand/handApi.ts · src/hand/HandRigView.ts · docs | 153-167, 84-92 | S-M | high |
| F9 | `getState()` 的 `handType`/`visible` 是模块级陈旧快照，与编辑器真实状态脱节 | medium | state contract | src/hand/handApi.ts | 45-48, 176-186 | S | high |
| F10 | `HandCalibView.dispose()` 调 `rebuild()`（**重建整只手**）而非 `rebuild(null)` → 白建一次几何且新建的网格从不被释放 | medium | resource leak | src/hand/HandCalibView.ts | 196-213, 257-282 | S | high |
| F11 | `applyPose` 每次姿态变更都为每个接触点**新建 SphereGeometry + MeshBasicMaterial** → 播放时 60Hz×N 的分配抖动 | medium | perf / GC | src/hand/HandRigView.ts | 169-185 | M | high |
| F12 | `three` / `@types/three` 被手部源码直接 import，却**未在 package.json 声明**（仅经 cubing 传递依赖） | medium | dependency hygiene | package.json · src/hand/handMesh.ts | 12-28 / 18-31 | S | high |
| F13 | `window.motionCubeHand` **零自动化覆盖**：契约只靠人工真机验证，playtest 无任何断言 | medium | test coverage | scripts/playtest-ui.mjs · src/hand/handApi.ts | 418-430 | M | high |
| F14 | `verify-hand-mesh.ts` 的左右镜像断言只比内侧边、绕向只测右手 → **结构上无法发现 F1 与 F15** | medium | test coverage | scripts/verify-hand-mesh.ts | 110-121 | S | high |
| F15 | 默认 `shape.facets = 15`（奇数）导致截面采样不对称 → 左右手**不是精确镜像**（thenar 差 0.0087） | low | correctness | src/hand/handRigStore.ts · src/hand/handMesh.ts | 57 / 156-180 | S | high |
| F16 | `clampBend` / `JointDef.range` 在渲染路径**从未使用** → 越界弯屈不被夹取也不被拒绝 | low | dead code / data contract | src/hand/HandRig.ts · src/hand/HandRigView.ts | 132-135 / 165 | S | high |
| F17 | `parsePose` 不校验四元数是否归一 → 非单位四元数通过校验后把整只手**缩放畸变** | low | data contract | src/data/technique.ts · src/hand/HandRigView.ts | 151-159 / 135-140 | S | high |
| F18 | `mirrorPose` 与入参**共享** `bends`/`contacts` 引用 → 改镜像结果会污染源姿态 | low | maintainability | src/hand/HandRig.ts | 93-115 | S | high |
| F19 | `playFrames` 对 `fps` 无上限、无帧数上限 → `fps: 1e9` 生成 ~1ms 定时器高频重驱动姿态 | low | robustness | src/hand/handApi.ts | 83-124 | S | high |
| F20 | `scripts/measure-hand.mjs` **不测量任何东西**：头注释声称测手/魔方像素比，实际只打印视口矩形 + 存 PNG | low | dead code / doc drift | scripts/measure-hand.mjs | 1-6, 52-67 | S | high |
| F21 | 标定页 ResizeObserver 每事件全量重建 SVG（网格 + 51 刻度 + 数字），未做 rAF 合并（拖标尺路径却做了） | low | perf | src/hand/HandCalibView.ts | 99, 215-255, 316-429 | S | high |
| F22 | `CUBE_UNIT_WORLD` 寄居在 `HandRigView.ts` → 标定/轨道视图为拿一个常量而 import 整个 cubing 依赖链 | low | maintainability | src/hand/HandCalibView.ts · src/hand/HandOrbitView.ts | 21 / 19 | S | high |
| F23 | 计划中的「手-魔方碰撞箱」：**代理数据已具备，但缺一个公开访问口**，与 spec §4 冻结清单冲突 | medium | spec / design | src/hand/HandRigView.ts · docs/hand-api-spec.md · docs/todo.md | 36-49 / 61 / 22 | M | high |

---

# F1 — 左手「指根间填充棱」几何绕向整体反转，被背面剔除而不可见

**严重度**：high  **分类**：correctness  **文件**：src/hand/handMesh.ts:806-814（调用）、573-607（构造）、746-780（对照实现）  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/handMesh.ts:806-814`（填充棱的调用点——**先取 min/max 再乘 sideSign**）
```
  // 指根间填充棱（十五轮）：掌面侧相邻根窝之间的细化三棱柱，脊线浅凹=关节的凹陷
  for (let i = 0; i < 3; i++) {
    const a = cfg.bases[FOUR[i]];
    const b = cfg.bases[FOUR[i + 1]];
    const xL = Math.min(a.x, b.x) * cfg.fingerSpacing * H * sideSign;
    const xR = Math.max(a.x, b.x) * cfg.fingerSpacing * H * sideSign;
```
`src/hand/handMesh.ts:571`（函数签名处的**契约注释**）
```
 * 指根间填充棱（0.4.0 十五轮）：相邻指根窝之间的细化三棱柱——截面为 (y,z) 平面
 * 顶点朝 +z 的圆角三角（n=1.5），沿指行方向 x 放样 7 站；脊线在两窝之间浅凹
 * （关节的凹陷），端环没入相邻根窝锥面与关节球，掌面侧 V 缺口由此填平。
 * x0<x1 由调用方保证（镜像手取 min/max）。
```
`src/hand/handMesh.ts:746-757`（**指蹼 web 的正确写法**——先乘 sideSign 再取 min/max）
```
  const FOUR = ["index", "middle", "ring", "pinky"] as const;
  const grad = [0.8, 1, 0.7];
  for (let i = 0; i < 3; i++) {
    const a = cfg.bases[FOUR[i]];
    const b = cfg.bases[FOUR[i + 1]];
    const xa = a.x * cfg.fingerSpacing * H * sideSign;
    const xb = b.x * cfg.fingerSpacing * H * sideSign;
```
`src/hand/handMesh.ts:596-599`（放样方向随 x0→x1 翻转）
```
    const x = x0 + (x1 - x0) * t;
    const u = Math.abs(x - mid) / half;
    const crest = crestMid + (crestEnd - crestMid) * u * u;
    rings.push(ringYZ(F, x, cy - 0.02 * H, zBase, 0.045 * H, crest, 1.5));
```
`src/hand/handMesh.ts:211-213`（放样器的绕向约定）
```
 * 环间放样（环内点数一致，θ 逆时针）：quad(R0k, R0k+1, R1k+1, R1k) 外法线朝外；
 * capStart/capEnd 端面扇形封口。
```

**实测**（`%TEMP%/mc-audit/hand-check.ts`，统计每个三角形外法线与截面轴向的朝向）：
```
right/knuckle-filler: outward=180 inward=0
right/knuckle-filler: outward=180 inward=0
right/knuckle-filler: outward=180 inward=0
left/knuckle-filler:  outward=0   inward=180
left/knuckle-filler:  outward=0   inward=180
left/knuckle-filler:  outward=0   inward=180
```
（对照组：同批的 `knuckle-collar` 右手 `outward=86 inward=4`、左手 `outward=86 inward=4` —— 一致；`web-0` 两侧均为 `outward=20 inward=18` —— 一致。**只有 knuckle-filler 反了**。）

## 影响

右手 `bases.index.x=0.52 > middle.x=0.17`，于是 `min/max` 结果为正；再乘 `sideSign=-1`（左手）后 **x0 > x1**，放样方向由 +x 变成 −x，`loftGeometry` 的 `quad(R0k,R0k+1,R1k+1,R1k)` 法线随之全部翻向内侧。

材质为 `tintedMesh` → `new MeshBasicMaterial({ vertexColors: true, toneMapped: false })`，three.js `Material.side` 默认 `FrontSide`（three.module.js:9229 `this.side = FrontSide;`），而 `frontFaceCW` 只在 `object.matrixWorld.determinant() < 0` 时翻转（three.module.js:29613）——手部是**把 sideSign 烘进顶点坐标**、矩阵行列式恒为正，所以**不会**被自动补偿。

结果：左手的三条「指根间填充棱」**全部 540 个三角形被背面剔除而不可见**，右手正常。编辑器默认双手显示（`showBothHands` 默认 true），因此这是**默认可见观感缺陷**：左手四指根部之间本该有脊线填平 V 形缺口，现在直接看穿到掌面斜坡，根窝之间出现与右手不同的空洞/明暗。

修复前该缺陷不会被任何自动校验发现（见 F14）。

## 修复

按 web 的写法，在**乘完 sideSign 之后**再取 min/max（`src/hand/handMesh.ts:810-811`）：

```ts
const xa = a.x * cfg.fingerSpacing * H * sideSign;
const xb = b.x * cfg.fingerSpacing * H * sideSign;
const xL = Math.min(xa, xb);
const xR = Math.max(xa, xb);
```

这样左右手放样方向恒为 +x，绕向与右手一致；同时应把 `buildKnuckleFiller` 头注释里「x0<x1 由调用方保证（镜像手取 min/max）」改成「调用方按 sideSign 取 min/max 后传入」，避免下一个人再踩。

配套：在 `scripts/verify-hand-mesh.ts` 增加一条左右手逐部件朝向断言（见 F14 修复建议）。

---

# F2 — 编辑器每次渲染都重喂姿态，外部注入 API 的驱动被覆盖

**严重度**：high  **分类**：correctness / state contract  **文件**：src/vue/pages/EditorPage.vue:697-709、1418-1423；src/hand/handApi.ts:51-54  **工作量**：M  **置信度**：high

## 证据（逐字）

`src/vue/pages/EditorPage.vue:697-709`
```
  // 双手驱动（十八轮显式双轨）：左手走 left 轨、右手走 right 轨，互不联动；
  // 单手模式（B）只显左手（左手为主，右手为辅）。外部注入 API 驱动时由
  // handApi 以镜像方式同步双手（对称显示）。
  if (handLeft) {
    handLeft.setPose(
      showBothHands.value || focusHand.value === "left" ? previewLeftPose() ?? defaultHandPose("left") : null,
    );
  }
  if (handRight) {
    handRight.setPose(
      showBothHands.value || focusHand.value === "right" ? previewRightPose() ?? defaultHandPose("right") : null,
    );
  }
```
`src/hand/handApi.ts:50-54`
```
/** 主手 + 镜像手统一驱动（镜像手取 x 镜像姿态） */
function driveBoth(pose: Pose | null): void {
  handView?.setPose(pose);
  mirrorView?.setPose(pose ? mirrorPose(pose) : null);
}
```
`src/hand/HandRigView.ts:94-99`（**单一 `pose` 字段，后写者胜**）
```
  setPose(pose: Pose | null): void {
    this.pose = pose;
    this.dirty = true;
    this.applyPose();
    void this.requestRender();
  }
```
`src/vue/pages/EditorPage.vue:1434-1503`（播放时 60Hz 的 `setInterval` 每帧调 `renderPreview()`）
```
  timer = window.setInterval(() => {
    ...
    renderPreview();
  }, 1000 / 60);
```
`src/vue/pages/EditorPage.vue:1418-1423`（挂载后的兜底踢帧同样重喂姿态）
```
      handLeft?.setPose(
        showBothHands.value || focusHand.value === "left" ? previewLeftPose() ?? defaultHandPose("left") : null,
      );
      handRight?.setPose(
        showBothHands.value || focusHand.value === "right" ? previewRightPose() ?? defaultHandPose("right") : null,
      );
```
`src/vue/pages/EditorPage.vue:1433`（踢帧时刻表）
```
  kickTimers = [1200, 3500, 8000].map((ms) => window.setTimeout(kickRender, ms));
```

## 影响

`HandRigView` 只有一个 `pose` 槽位，编辑器和外部 API 写的是同一个槽位，**后写者胜**。编辑器在以下时机无条件重喂：任何面板改动（`renderAll`→`renderPreview`）、播放时每 16.7ms、挂载后 1.2s / 3.5s / 8s 的兜底踢帧。

- `motionCubeHand.setPose(...)` 的效果只维持到**下一次编辑器事件**；脚本若在页面加载后 1.2s 内下发姿态、1.2s 后就被踢帧覆盖。
- `playFrames` 在播放期间与编辑器 60Hz 抢同一个槽位：API 每 `1000/fps` ms 写一次、编辑器每 16.7ms 写一次 → 画面是**闪烁/抖动**，而不是文档承诺的帧流播放。
- 这直接抵消了 spec §1 的立项目标（「AI/脚本自动化查看手部形变效果」）与 usage 文档「`setPose` / `playFrames` 驱动的单条姿态会以对称方式同时作用于双手」的承诺。

注：`docs/hand-api-usage.md` 的「验证记录」称 2026-09-12 真机验证通过——那次验证只做了**单次 setPose 且此后无编辑器事件**，因此没有暴露本问题；这是典型的「验证覆盖不足导致假绿」。

## 修复

引入一个「外部接管」标志，让 API 驱动期间编辑器停止抢写：

1. `handApi.ts` 导出 `isHandApiDriving(): boolean`（或让 `registerHandApi` 接受一个回调 `onDriveStart/onDriveEnd`），并在 `driveBoth` 时置位、`stop()/clear()` 时复位；
2. `EditorPage.vue` 的 `renderPreview()` 与 `kickRender()` 在该标志为真时**跳过** `handLeft/handRight.setPose(...)`；
3. 更彻底的做法：让 API 写入编辑器自身的 left/right 关键帧轨道（`ensureAutoKfPose` 同款路径），使「外部驱动」与「内部编辑」共用一份真相，避免双写。

同时把 `playFrames` 的驱动节流与编辑器播放互斥（两者同时跑时给出明确提示），并补一条自动化断言（见 F13）。

---

# F3 — `HandRigView` 没有 `dispose()`，手部 GPU 资源在每次编辑器挂载/卸载时泄漏

**严重度**：high  **分类**：resource leak  **文件**：src/hand/HandRigView.ts:36-204（整类）、187-203（buildRig）；src/vue/pages/EditorPage.vue:1506-1522  **工作量**：M  **置信度**：high

## 证据（逐字）

`src/hand/HandRigView.ts:187-203`（重建时只「摘除」不「释放」）
```
  private buildRig(): void {
    for (const child of this.group.children) child.removeFromParent();
    this.contactPool.forEach((m) => m.removeFromParent());
    this.contactPool.length = 0;

    // 0.4.0 low-poly 重构：handMesh 截面放样生成器（API 与旧 buildHandGeometry 同构；
    // 顶点色线性编码，输出变换由各渲染器自理）
    const built = buildHandMesh(this.config, this.rig, this.sideSign, {
      withMarks: true,
      linearOutput: true,
    });
    this.root = built.root;
    this.fingers = built.fingers;
    this.thumbRoot = built.thumbRoot;
    this.thumbDof = built.thumbDof;
    this.group.add(this.root);
  }
```
`src/hand/handMesh.ts:133-137`（每部件一个独立材质 → 每只手约 40 材质 + 40 几何）
```
function tintedMesh(geo: BufferGeometry, part: string): Mesh {
  const m = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  m.userData.part = part;
  return m;
}
```
`src/hand/handMesh.ts:720-724`（描边额外产生 EdgesGeometry，共享材质）
```
  const outlineMat = opts.withOutline ? new LineBasicMaterial({ color: OUTLINE, toneMapped: false }) : null;
  const addOutline: AddOutline = (mesh) => {
    if (!outlineMat) return;
    mesh.add(new LineSegments(new EdgesGeometry(mesh.geometry, 14), outlineMat));
  };
```
`src/vue/pages/EditorPage.vue:1506-1522`（卸载时直接丢引用，**没有任何 hand 的释放调用**）
```
onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer);
  viewIo?.disconnect();
  viewIo = null;
  kickTimers.forEach((t) => window.clearTimeout(t));
  kickTimers = [];
  window.removeEventListener("keydown", onEditorKey);
  window.removeEventListener("keyup", onEditorKey);
  editorViewEl.value?.replaceChildren();
  delete (globalThis as { __motionCubeEditor?: unknown }).__motionCubeEditor;
  unregisterHandApi();
  grayOverlay?.dispose();
  grayOverlay = null;
  player = null;
  handLeft = null;
  handRight = null;
});
```
对照：`src/cube/GrayOverlay.ts:133-138` **有** `dispose()`（清 timer/listener）；`src/hand/HandCalibView.ts:542-559` **有** `disposeObject()` 工具。

## 影响

手部的几何与材质是**应用自建**（不是 cubing 拥有的），且**已被渲染过**（GPU 上传了 buffer）。three.js 只有在 `geometry.dispose()` / `material.dispose()` 时才 `gl.deleteBuffer`；对象被 GC 掉并不会归还 GL buffer（`WebGLGeometries` 用 WeakMap，条目消失但 GL 资源成为孤儿）。

- 每进出一次编辑器页 → 两只手 ≈ 80 组几何 + 80 个材质 + （左视图描边时）额外 EdgesGeometry 全部滞留；
- `buildRig()` 在 `setHandType()` 时也会再泄漏一整套；
- 卸载只 `replaceChildren()` 移走 canvas，WebGL context 要等 canvas 被 GC 才释放，因此泄漏不是「立刻归还」，而是随会话累积；
- 当前 `setHandType` 无调用方（F8），所以这条主要触发路径是**反复进出编辑器页**。

## 修复

1. 在 `HandRigView` 增加 `dispose()`：遍历 `this.root` 释放 geometry/material（可直接复用 `HandCalibView.ts:542` 的 `disposeObject`，把它提到 `src/hand/dispose.ts` 之类的中性位置以免标定页→视图的反向依赖），并释放 `contactPool` 中标记球的 geometry/material；
2. `buildRig()` 开头先释放旧 `this.root` 再重建；
3. `EditorPage.vue` 的 `onBeforeUnmount` 里 `handLeft?.dispose(); handRight?.dispose();`。

---

# F4 — `loadHandRigConfig()` 返回共享可变的 `DEFAULT_HAND_CONFIG` 单例，「重置」重置不回真默认

**严重度**：high  **分类**：state / data contract  **文件**：src/hand/handRigStore.ts:228-236、102-125；src/vue/pages/HandCalibPage.vue:41、225-235  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/handRigStore.ts:228-236`
```
export function loadHandRigConfig(): HandRigConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_HAND_CONFIG;
    return normalizeHandRigConfig(JSON.parse(raw)) ?? DEFAULT_HAND_CONFIG;
  } catch {
    return DEFAULT_HAND_CONFIG;
  }
}
```
`src/hand/handRigStore.ts:102-125`（`DEFAULT_HAND_CONFIG` 是**模块级可变对象**，非冻结、非拷贝）
```
export const DEFAULT_HAND_CONFIG: HandRigConfig = {
  version: 4,
  /** 整体放大系数：数据单位 → 渲染倍数（十八轮用户定版 1.85；旧存档需标定页重置对齐） */
  handScale: 1.85,
  ...
  shape: { ...DEFAULT_SHAPE },
};
```
`src/vue/pages/HandCalibPage.vue:41`
```
const cfg = ref<HandRigConfig>(loadHandRigConfig());
```
`src/vue/pages/HandCalibPage.vue:230-235`
```
const reset = (): void => {
  cfg.value = structuredClone(DEFAULT_HAND_CONFIG);
  syncInputs();
  refreshNow();
  setStatus(t("hand.resetOk"));
};
```
`src/vue/pages/HandCalibPage.vue:117-124`（字段是**就地写**）
```
const inlineFields: { id: string; label: string; get: () => number; set: (v: number) => void; min: number }[] = [
  { id: "palm-width", label: t("hand.palmWidth"), get: () => cfg.value.palm.width, set: (v) => (cfg.value.palm.width = v), min: 0.01 },
```

## 影响

当 localStorage **没有** `motion-cube.handRig`（全新安装 / 用户清过缓存）或**内容损坏**时，`loadHandRigConfig()` 返回的就是 `DEFAULT_HAND_CONFIG` 这个**同一个对象引用**。标定页随后对 `cfg.value.palm.width = v` 等的写入**直接改写了模块级默认常量**。

后果：
- 点「重置」→ `structuredClone(DEFAULT_HAND_CONFIG)` 克隆的是**已被自己改脏的默认值** → 「重置」无效，用户永远回不到出厂状态；
- 同会话内 `HandRigView`（编辑器/游戏）再调 `loadHandRigConfig()` 会拿到这份**未保存的脏默认**——即「没点固化，编辑器却变了」，语义不明确；
- `normalizeHandRigConfig` 内部的兜底值取自 `DEFAULT_HAND_CONFIG.fingers[name][i].length` 等（handRigStore.ts:157-158），默认值被污染后**校验兜底也随之漂移**；
- 这条路径正是**用户第一次标定**（最需要「能重置」）的场景。

## 修复

`loadHandRigConfig()` 不要返回共享单例，二选一：

```ts
// 方案 A（最小）：返回副本
if (!raw) return structuredClone(DEFAULT_HAND_CONFIG);
return normalizeHandRigConfig(JSON.parse(raw)) ?? structuredClone(DEFAULT_HAND_CONFIG);

// 方案 B（更稳）：默认值冻结 + 工厂
export const DEFAULT_HAND_CONFIG: Readonly<HandRigConfig> = deepFreeze({...});
export const defaultHandRigConfig = (): HandRigConfig => structuredClone(DEFAULT_HAND_CONFIG);
```

同时把 `HandCalibPage.reset()` 改为 `cfg.value = structuredClone(defaultHandRigConfig())`（或 `structuredClone(DEFAULT_HAND_CONFIG)` + 方案 A 的前提下即安全）。

---

# F5 — `shape.web` 是死参数：被规范化、被持久化、标定页有滑块，几何从不消费

**严重度**：medium  **分类**：dead code  **文件**：src/hand/handRigStore.ts:50、222；src/vue/pages/HandCalibPage.vue:149；src/hand/handMesh.ts（无引用）  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/handRigStore.ts:49-50`（参数声明与语义承诺）
```
  /** 指蹼量 0–1：指根间菱形填充块大小 */
  web: number;
```
`src/hand/handRigStore.ts:222`（被规范化）
```
      web: clampNum(sh.web, 0, 1, DEFAULT_SHAPE.web),
```
`src/vue/pages/HandCalibPage.vue:149`（标定页暴露为可拖滑块）
```
  { id: "shape-web", label: t("hand.shapeWeb"), get: () => cfg.value.shape.web, set: (v) => (cfg.value.shape.web = v), min: 0, fix: 2 },
```
`src/hand/handMesh.ts:747-770`（web 几何用的是**硬编码常量**，不是 `shape.web`）
```
  const grad = [0.8, 1, 0.7];
  for (let i = 0; i < 3; i++) {
    ...
        webLensGeometry(
          xL,
          xR,
          yRoot + 0.02 * H, // 背缘（低于指根球顶）
          yRoot - 0.14 * H, // 掌缘
          0.045 * H * grad[i], // 背侧凹深（中缝最深）
          0.035 * H,        // 掌侧凹深
```
全仓检索 `shape.web` / `.web` 只有 3 处命中：handRigStore.ts:222（规范化）、HandCalibPage.vue:149（滑块）、handRigStore.ts:50（声明）——**handMesh.ts 零命中**。

## 影响

标定页「指蹼量」滑块拖动毫无反应（几何用的是写死的 `grad`/`dipT`/`dipB`）。用户会以为参数没生效或软件有 bug；`shape` 组共 11 个参数，这是唯一空转的一个。同时它被写进 localStorage，跨版本迁移时还要为一个无效参数做兜底。

## 修复

二选一：
- **接线**（推荐，保住 UI 承诺）：在 `buildHandMesh` 的 web 构造里用 `shape.web` 驱动 `dipT`/`dipB`/长度，例如 `dipT = (0.02 + 0.05 * shape.web) * H * grad[i]`、`掌侧凹深 = (0.015 + 0.03 * shape.web) * H`，并补一条 `verify-hand-mesh.ts` 断言（web=0 与 web=1 的指蹼深度应不同）；
- **下线**：从 `HandShapeParams` 删除 `web`、从 `normalizeHandRigConfig` 删除该行、从 `HandCalibPage` 删除该滑块、从 `DEFAULT_SHAPE` 删除默认值，并在 `normalizeHandRigConfig` 里继续忽略旧档的 `shape.web`（多余字段本就被忽略，天然兼容）。

---

# F6 — 拇指 IP 关节组为空，编辑器「IP」弯屈滑块无任何视觉效果

**严重度**：medium  **分类**：correctness  **文件**：src/hand/handMesh.ts:325-330、408-414；src/hand/HandRigView.ts:160-167；src/vue/pages/EditorPage.vue:169  **工作量**：M  **置信度**：high

## 证据（逐字）

`src/hand/handMesh.ts:325-330`
```
  for (let j = 0; j < def.joints.length; j++) {
    const joint = new Group();
    cursor.add(joint);
    joints.push(joint);
    const seg = def.segments[j];
    if (!seg) break; // 末梢关节（拇指 IP）：无后续段，不放关节球——指尖与四指统一为收口圆头
```
`src/hand/HandRig.ts:167-180`（拇指是 **2 段 3 关节**）
```
      thumb: {
        name: "thumb",
        segments: [
          { length: 0.71, width: 0.28 },
          { length: 0.53, width: 0.21 },
        ],
        joints: [
          ...
          { name: "CMC", bend: 170, range: { min: 60, max: 180 }, ...DEFAULT_THUMB_CMC },
          { name: "MCP", bend: 165 },
          { name: "IP", bend: 168 },
        ],
      },
```
`src/hand/HandRigView.ts:160-167`（渲染时按 `nodes.joints.length` 逐个写 bend）
```
    for (const name of FINGER_ORDER) {
      const nodes = this.fingers[name];
      const bends = pose.bends[name];
      for (let j = 0; j < nodes.joints.length; j++) {
        // bend = 指腹侧夹角（180 伸直）；绕 X 旋转使段向指腹（-Y）弯
        nodes.joints[j].rotation.x = degToRad(180 - (bends[j] ?? 180));
      }
    }
```
`src/vue/pages/EditorPage.vue:167-181`（面板把三个拇指关节都做成可编辑滑块）
```
/** 各指关节名（与 rig.fingers[name].joints 顺序一致）与 bend 范围 */
const FINGER_JOINTS: Record<FingerName, string[]> = {
  thumb: ["CMC", "MCP", "IP"],
  ...
};
const FINGER_JOINT_RANGE: Record<FingerName, [number, number]> = {
  thumb: [60, 180], // CMC 可到 60（DEFAULT_BEND_RANGE 90-180，CMC 特例 60-180）
```
**实测**（`%TEMP%/mc-audit/thumb-joints.ts`）：
```
thumb: segments=2 joints=3 :: j0(children=5 [...]) j1(children=6 ["thumb-joint1","thumb-seg1","thumb-nail",...]) j2(children=0 [])
index: segments=3 joints=3 :: j0(children=5 [...]) j1(children=5 [...]) j2(children=6 [...])
```

## 影响

拇指有 3 个关节、2 段。`buildFingerChain` 在 `j=2`（IP）时 `segments[2]` 不存在 → `break`，于是 **IP 关节组被创建并入链，但没有任何子节点**（`children=0`），它位于远节指尖处。`applyPose` 把 `bends.thumb[2]`（IP 弯屈）写到这个空组上 —— **画面零变化**。

同时段的挂载整体错位一位：`j0`（标 CMC）挂的是近节（0.71），`j1`（标 MCP）挂的是远节（0.53），**真正解剖上的指间关节被标成了 MCP**，于是「拇指 MCP 弯屈」滑块实际驱动的是指间褶皱，而「拇指 IP 弯屈」滑块驱动空气。

用户可见后果：关键帧面板里拖动拇指 IP 滑块，数值会存进关键帧、面板数字会变，但 3D 视图纹丝不动 —— 保存后再打开仍然是死的。

注：这不是 0.4.0 low-poly 重构引入的回归 —— 旧的 `handGeometry.ts`（`git show 50c2547^:src/hand/handGeometry.ts`）用同样的 `for (j…){ if (seg) {…} }` 结构，拇指 IP 关节组同样为空。

## 修复

要真正让 IP 生效，拇指链需要**在两节之间多一个关节组**（两段 ↔ 三关节的正确映射：CMC 空关节 → MCP 挂近节 → IP 挂远节）。最小改动方案：

```ts
// buildFingerChain：为「关节数 = 段数 + 1」的链补一个末端空关节，
// 并把段挂到正确的关节下（拇指：CMC 空、MCP→近节、IP→远节）
```

但这会改变拇指的可见弯折位置（当前是 MCP 折痕实际在指间），属于**观感变更**，需真机验收。若暂不改视觉，则至少：
- 在 `HandRigView.applyPose` 里对拇指做显式映射（把 `bends.thumb[2]`（IP）写到 `nodes.joints[1]`），并在 `HandRig.ts`/`docs/params.md` 注明「拇指 bend 数组语义：CMC/MCP 为 CMC 倾角与指间折角，IP 暂由 MCP 承担」；
- 或在编辑器面板上对拇指 IP 滑块加禁用/说明（i18n），避免用户继续调一个无效控件。

---

# F7 — 接受退化指根布局 → NaN 顶点 → 整手包围盒 NaN → 标定页相机适配崩坏

**严重度**：medium  **分类**：robustness  **文件**：src/hand/handRigStore.ts:182-187；src/hand/handMesh.ts:249-253、585-599  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/handRigStore.ts:182-187`（bases 只做单值区间截断，**不校验相互关系**）
```
    bases: {
      index: { x: clampNum(base("index").x, -2, 2, 0.52), y: clampNum(base("index").y, -1, 1, 0.1) },
      middle: { x: clampNum(base("middle").x, -2, 2, 0.17), y: clampNum(base("middle").y, -1, 1, 0.12) },
      ring: { x: clampNum(base("ring").x, -2, 2, -0.17), y: clampNum(base("ring").y, -1, 1, 0.1) },
      pinky: { x: clampNum(base("pinky").x, -2, 2, -0.52), y: clampNum(base("pinky").y, -1, 1, 0.06) },
    },
```
`src/hand/handMesh.ts:248-253`（web 的横向半宽为 0 时 `t` 变 NaN）
```
  const cx = (xL + xR) / 2;
  const half = (xR - xL) / 2;
  const bell = (x: number): number => {
    const t = Math.max(-1, Math.min(1, (x - cx) / half));
    return Math.sqrt(1 - t * t); // 圆弧逼近：中心 1、两端 0
  };
```
`src/hand/handMesh.ts:585-598`（填充棱同样在 half=0 时产生 NaN）
```
  const mid = (x0 + x1) / 2;
  const half = Math.abs(x1 - x0) / 2;
  ...
    const u = Math.abs(x - mid) / half;
    const crest = crestMid + (crestEnd - crestMid) * u * u;
```
**实测**（`%TEMP%/mc-audit/nan-probe.ts`）：
```
normalize accepted degenerate bases: true
  meshes=77 withNaN=2 parts=web-0:114,knuckle-filler:540
all-identical bases: meshes=77 withNaN=6 parts=web-0:114,web-1:114,web-2:114,knuckle-filler:540,knuckle-filler:540,knuckle-filler:540
extreme accepted cfg: meshes=77 withNaN=0 parts=
```

## 影响

`normalizeHandRigConfig` 的职责就是「校验/规范化任意输入为合法配置」，但它对 `bases` 只做逐值截断，**允许两根手指落在同一 x**（`index.x == middle.x`）。此时：

- `webLensGeometry` 的 `half=0` → `(x-cx)/0 = 0/0 = NaN` → `Math.min(1,NaN)=NaN` → `Math.max(-1,NaN)=NaN` → `sqrt(1-NaN)=NaN` → 顶点 NaN；
- `buildKnuckleFiller` 的 `u = |x-mid|/0` 同样 NaN；
- NaN 顶点会让 `Box3.setFromObject` 产出 NaN 包围盒（`HandCalibView.ts:279` 的 `this.handBox`）→ `fit()`（`HandCalibView.ts:225`）算出的相机位置/投影全为 NaN → **标定页整个视图变黑/空白**，且 `contentBox()` 的并集也全 NaN，标尺网格一起消失；
- 编辑器里手部同样不可见（NaN 顶点不可渲染），且 `Box3` 崩坏会影响后续任何包围盒逻辑。

触发路径是 localStorage 被外部改坏/被旧版写坏（标定页 UI 本身改不出等值 bases，因为四指 x 是写死的、只有共用的 `fingerSpacing`）。概率低，但**后果是整页不可用且无任何报错**，与 `normalizeHandRigConfig` 声称的「结构不合法返回 null（调用方回退默认）」相悖。

## 修复

在 `normalizeHandRigConfig` 里增加关系校验，非法即回退默认（或直接返回 null）：

```ts
// 四指根必须互不相同且按 index→pinky 单调递减（拇指侧→小指侧）
const baseXs = ["index", "middle", "ring", "pinky"].map((n) => bases[n].x);
const distinct = new Set(baseXs).size === 4;
const ordered = baseXs.every((x, i) => i === 0 || x < baseXs[i - 1]);
if (!distinct || !ordered) return null;   // 或回退到 DEFAULT_HAND_CONFIG.bases
```

同时在 `buildHandMesh` 里对 `half` 做保护（`const half = Math.max(Math.abs(x1 - x0) / 2, 1e-4)`），让几何生成对退化输入**不再吐 NaN**（纵深防御）。并在 `verify-hand-mesh.ts` 增加一条「等值 bases 不产生 NaN」的断言。

---

# F8 — API 的 `setHandType` 不转调 `handView.setHandType`；`HandRigView.setHandType` 成了零调用死代码；两份规格文档互相矛盾

**严重度**：medium  **分类**：contract violation / doc drift  **文件**：src/hand/handApi.ts:153-167；src/hand/HandRigView.ts:84-92；docs/hand-api-spec.md:44；docs/hand-api-usage.md:25  **工作量**：S-M  **置信度**：high

## 证据（逐字）

`docs/hand-api-spec.md:44`（**规格要求转调**）
```
| `setHandType(t: "left" \| "right")` | 转调 `handView.setHandType` |
```
`docs/hand-api-spec.md:21`（公开接口清单）
```
| `HandRigView` 公开 API | `src/hand/HandRigView.ts` | `init()` / `setPose(pose: Pose \| null)` / `setHandType(type)` / `setVisible(b)` / `currentPose()` / `type` |
```
`src/hand/handApi.ts:153-167`（**实现是「切显隐」，根本没有转调**）
```
    setHandType(t: HandType): HandApiResult {
      if (!handView) return err("API 未挂载（需在编辑器页）");
      if (t !== "left" && t !== "right") return err(`手型非法：${String(t)}`);
      // 单手显示切换（十八轮双手固定左右实例）：left 只显左手 / right 只显右手；
      // 后续 setVisible(true) 恢复双手
      if (t === "left") {
        handView.setVisible(true);
        mirrorView?.setVisible(false);
      } else {
        handView.setVisible(false);
        mirrorView?.setVisible(true);
      }
      lastHandType = t;
      return ok();
    },
```
`src/hand/HandRigView.ts:84-92`（被 spec 点名的公开方法，**全仓零调用**）
```
  setHandType(type: HandType): void {
    if (type === this.handType) return;
    this.handType = type;
    this.rig = createRigFromConfig(this.config, type);
    this.buildRig();
    this.dirty = true;
    this.applyPose();
    void this.requestRender();
  }
```
`docs/hand-api-usage.md:25`（**usage 文档描述的是实现行为，与 spec 矛盾**）
```
| `setHandType("right" \| "left")` | 切换手型（镜像手随之取对侧） |
```
`docs/hand-api-usage.md:59-61`
```
编辑器默认双手显示（左手为主、右手为辅）。`setPose` / `playFrames` 驱动的单条
姿态会以**对称方式**同时作用于双手（左手取姿态本体、右手取其 x 镜像），无需额外
调用；`setHandType("left" | "right")` 切换单手显示（只显左手 / 只显右手），
```
全仓检索 `setHandType`：`src/hand/handApi.ts`（类型 + API 方法）、`src/hand/HandRigView.ts`（方法定义）——**没有任何调用方**（EditorPage 早已改为固定 left/right 双实例，不再切手型）。

## 影响

- **契约违反**：spec §3 明写「转调 `handView.setHandType`」，实现却是显隐切换。spec §4 的「冲突规避约束」正是为了让 API 实现方照抄这份表；照抄的第三方实现会得到**完全不同的行为**（换手型 vs 换显隐），而 spec 顶部状态还写着「**已实现**」。
- **死代码**：`HandRigView.setHandType` 零调用方，但它会 `buildRig()` 重建整只手（≈4.9 ms/手，实测），是有副作用的重操作；留着会让人误以为手型是可切换的。
- **文档漂移**：spec 与 usage 对同一方法给出两种语义（"转调 setHandType" vs "切换单手显示"），usage 还与 spec §2 的接口表不一致。
- **边界脆弱**：spec §3 的签名是 `registerHandApi(handView: HandRigView): void`（单参）。按 spec 单参调用时 `mirrorView` 为 `undefined`，`setHandType("right")` 会执行 `handView.setVisible(false)` → **唯一的一只手被整体隐藏**（因为没有 mirrorView 去显示右手）。

## 修复

1. 以实现为准更新 spec §3 表格与 §2 接口表，明确 `setHandType` 的语义是「切单手显示」，并把 `registerHandApi` 的实际签名（`(view, mirror?)`）写进 spec；
2. 删除 `HandRigView.setHandType`（零调用 + 有副作用的重操作），或在 spec §4 冻结清单里注明它保留给未来单实例场景；
3. 在 `handApi.setHandType` 里对 `mirrorView === null` 做显式处理：`right` 且无 mirror 时返回 `{ok:false, error:"…需双手实例…"}`，不要静默隐藏唯一的手；
4. usage 文档补一句「`setHandType` 只切显隐，不改手型（实例固定 left/right）」。

---

# F9 — `getState()` 的 `handType` / `visible` 是模块级陈旧快照

**严重度**：medium  **分类**：state contract  **文件**：src/hand/handApi.ts:45-48、130-135、176-186  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/handApi.ts:45-48`
```
// HandRigView 未暴露显隐 getter（公开签名受规格约束不可改），API 侧记录 setVisible 最近值
let lastVisible = true;
// setHandType 最近值（getState 用）
let lastHandType: HandType = "left";
```
`src/hand/handApi.ts:130-135`（注册时重置了 `lastVisible`，**没重置 `lastHandType`**）
```
export function registerHandApi(view: HandRigView, mirror?: HandRigView): void {
  if (!import.meta.env.DEV) return;
  handView = view;
  mirrorView = mirror ?? null;
  lastVisible = true;
```
`src/hand/handApi.ts:176-186`
```
    getState(): HandApiState {
      return {
        ok: true,
        handType: lastHandType,
        visible: lastVisible,
        playing: playTimer !== null,
        pose: handView?.currentPose() ?? null,
      };
    },
```
`src/vue/pages/EditorPage.vue:322-325`（**编辑器也会改显隐，但 API 不知道**）
```
function applyHandVisibility(): void {
  handLeft?.setVisible(showHand.value && (showBothHands.value || focusHand.value === "left"));
  handRight?.setVisible(showHand.value && (showBothHands.value || focusHand.value === "right"));
}
```

## 影响

- `getState().visible` 只跟踪 API 自己的 `setVisible` 调用。用户在编辑器里按 H（手显隐）或切「单手/双手」，`applyHandVisibility()` 改了 `HandRigView.userVisible`，但 API 的 `lastVisible` **不变** → `getState()` 报告的可见性与实际画面不符。
- `getState().handType` 只跟踪 API 的 `setHandType`。用户在编辑器里切主位手（`setFocusHand`）后，API 仍报旧值；而且 `registerHandApi` 没有重置 `lastHandType`，**离开再进入编辑器页后仍保留上次的值**（模块级状态）。
- `getState()` 是 usage 文档推荐的调试入口（「读当前状态」），返回不可信的状态会让脚本作者基于错误前提做决策。

## 修复

- `unregisterHandApi()` / `registerHandApi()` 里同时重置 `lastHandType` 与 `lastVisible`；
- 更根本的做法：让 API 的可见性/手型**以视图为准**。`HandRigView` 已有 `type` getter（`HandRigView.ts:80-82`），可让 `getState().handType` 读 `handView.type`；显隐则需要在不破坏公开签名的前提下拿到真值——可以给 `HandRigView` 增加一个**新增**的只读 getter `get visible(): boolean`（不改动既有签名，spec §4 的约束针对的是「修改既有公开方法签名」），或在 `handApi` 里订阅编辑器的 `applyHandVisibility`（通过 `registerHandApi` 的可选回调）保持同步。

---

# F10 — `HandCalibView.dispose()` 调 `rebuild()`（重建整只手）而非 `rebuild(null)`

**严重度**：medium  **分类**：resource leak  **文件**：src/hand/HandCalibView.ts:196-213、257-282；对照 src/hand/HandOrbitView.ts:86、96-114  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/HandCalibView.ts:196-213`
```
  dispose(): void {
    if (this.rulerRaf) cancelAnimationFrame(this.rulerRaf);
    this.rulerRaf = 0;
    this.rulerDirty = false;
    this.dragCleanup?.();
    this.dragCleanup = null;
    this.dragging = null;
    this.resizeObserver.disconnect();
    this.rebuild();
    this.renderer.dispose();
```
`src/hand/HandCalibView.ts:257-282`（`rebuild()` 会**从头再造一只手**并 push 进 disposables）
```
  private rebuild(): void {
    for (const d of this.disposables) disposeObject(d.obj);
    this.disposables.length = 0;
    for (const child of [...this.rootGroup.children]) {
      this.rootGroup.remove(child);
    }
    const rig = createRigFromConfig(this.cfg, "right");
    // 0.4.0 low-poly 重构：handMesh 截面放样生成器（测量视图关标记；左视开描边）
    const built = buildHandMesh(this.cfg, rig, 1, {
      withMarks: false,
      linearOutput: false,
      withOutline: this.view === "left",
    });
    ...
    this.disposables.push({ obj: built.root });
    this.fit();
  }
```
`src/hand/HandOrbitView.ts:81-94`（**同项目的正确写法**）
```
  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.rebuild(null);
    this.renderer.dispose();
```
`src/hand/HandOrbitView.ts:96-100`
```
  private rebuild(cfg: HandRigConfig | null): void {
    for (const d of this.disposables) disposeObject(d.obj);
    this.disposables.length = 0;
    for (const child of [...this.rootGroup.children]) this.rootGroup.remove(child);
    if (!cfg) return;
```

## 影响

`dispose()` 走 `rebuild()` → 释放旧网格 → **重新构建一整套新手部几何**（实测 ≈4.9 ms/手，左视图还要多生成 EdgesGeometry）→ `fit()` → `drawRuler()`（整块 SVG 重建）→ `render()`（在即将被销毁的 renderer 上再渲染一帧）→ 然后 `renderer.dispose()`。

而这次新建的 `built.root` 被 push 进 `this.disposables` 后**再也没人 dispose**（`dispose()` 不会跑第二轮）→ 刚建的几何成为孤儿；它已经被 `render()` 渲染过一次，GPU 上有 buffer。

标定页挂载两个 `HandCalibView`（俯视 + 左视），每次离开该页都会触发两次。

## 修复

把 `HandCalibView.dispose()` 里的 `this.rebuild();` 改成 `this.rebuild(null);`，并给 `rebuild` 加 `cfg: HandRigConfig | null` 参数（与 `HandOrbitView` 对齐）：

```ts
private rebuild(cfg: HandRigConfig | null = this.cfg): void {
  for (const d of this.disposables) disposeObject(d.obj);
  this.disposables.length = 0;
  for (const child of [...this.rootGroup.children]) this.rootGroup.remove(child);
  if (!cfg) return;
  ...
}
```

---

# F11 — `applyPose` 每次姿态变更都为每个接触点新建几何与材质

**严重度**：medium  **分类**：perf / GC  **文件**：src/hand/HandRigView.ts:169-185  **工作量**：M  **置信度**：high

## 证据（逐字）

`src/hand/HandRigView.ts:169-185`
```
    // 接触点：小段局部坐标 → 挂到该段关节组，随 FK 自动变换
    for (const m of this.contactPool) m.removeFromParent();
    this.contactPool.length = 0;
    for (const c of pose.contacts) {
      const seg = this.fingers[c.finger]?.segments[c.segmentIndex];
      if (!seg) continue;
      const marker = new Mesh(
        new SphereGeometry(0.045 * H, 8, 8),
        new MeshBasicMaterial({
          color: new Color().setRGB(1, 1, 1),
          toneMapped: false,
        }),
      );
      marker.position.copy(contactLocalPoint(c, seg, this.sideSign, H));
      seg.joint.add(marker);
      this.contactPool.push(marker);
    }
```
`src/vue/pages/EditorPage.vue:1494-1502`（播放时 60Hz 调用 `renderPreview` → `setPose` → `applyPose`）
```
        previewFrame.value += stepFrames;
      }
      if (!playing.value) {
        renderPreview();
        return;
      }
      applyStepAtFrame(previewFrame.value);
    }
    renderPreview();
```

## 影响

每次 `setPose`（编辑器播放时 **60 次/秒**）都会为每个接触点 `new` 一个 `SphereGeometry(0.045*H, 8, 8)`（81 顶点 / 128 三角形 + normal + uv）与一个 `MeshBasicMaterial`，旧对象只 `removeFromParent()` 不复用也不 dispose。

- 分配速率 = 接触点数 × 60 /秒。一个有 4~6 个接触点的手法即 **240~360 组几何+材质/秒**，全是短命对象 → 稳定的 GC 压力与分配抖动；
- 因为旧 marker 已从场景摘除、从未被渲染（不会上传 GPU），所以**不是 GPU 泄漏**，但 JS 侧分配是实打实的；
- 叠加 F2 的 API `playFrames`（也会 60Hz 调 `setPose`）后分配速率翻倍。

## 修复

把 marker 做成**池**（复用同一份 geometry/material，仅改 position 与父节点）：

```ts
// 类字段
private readonly markerGeo = new SphereGeometry(0.045 * H, 8, 8);  // H 在构造后才知道 → 懒建
private readonly markerMat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
private readonly markerPool: Mesh[] = [];
```

`applyPose` 里按 `pose.contacts.length` 取用/回收池对象（多余的对象 `removeFromParent()` 后放回池），`dispose()` 时统一 `markerGeo.dispose(); markerMat.dispose();`（与 F3 一并做）。

---

# F12 — `three` / `@types/three` 被手部源码直接 import 却未在 package.json 声明

**严重度**：medium  **分类**：dependency hygiene  **文件**：package.json:12-28；src/hand/handMesh.ts:18-31、31；src/hand/HandCalibView.ts:9-18；src/hand/HandOrbitView.ts:7-16  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/handMesh.ts:18-31`
```
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
```
`package.json:12-28`（**依赖里没有 three**）
```
  "dependencies": {
    "@tauri-apps/api": "^2.11.1",
    "cubing": "^0.63.3",
    "vue": "^3.5.41",
    "vue-router": "^4.6.4"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.11.4",
    "@types/node": "^26.1.2",
    "@vitejs/plugin-vue": "^6.0.8",
    "puppeteer-core": "^25.5.0",
    "tsx": "^4.23.8",
    "typescript": "~6.0.3",
    "vite": "^8.2.0",
    "vue-tsc": "^3.3.9"
  }
```
实测：
```
$ node -e "const p=require('./node_modules/cubing/package.json'); console.log(p.dependencies)"
{ ... "three": "^0.170.0", "@types/three": "^0.169.0", ... }
$ node -e "…package-lock…" → node_modules/three 0.170.0 / node_modules/@types/three 0.169.0（均非 devDependency）
```

## 影响

手部模块是 three 的**直接消费方**，但 three 只以 cubing 的**传递依赖**身份存在于 lockfile。当前 npm 扁平化恰好把它提升到顶层 `node_modules/three`，所以能跑；但：

- 一旦 cubing 换 three 主版本、或出现第二个需要不同 three 版本的依赖，npm 会把 cubing 的 three **嵌套**到 `node_modules/cubing/node_modules/three`，顶层不再有 `node_modules/three` → `import "three"` 直接**构建失败**（`ERR_MODULE_NOT_FOUND`）；
- three 的版本变更（渲染 API、色彩管理默认值）会**静默**改变手部几何与观感，而 package.json 里看不到任何约束；
- 类型也靠传递依赖的 `@types/three@0.169`，与运行时 0.170 存在小版本错配。

（注：本条与 `docs/audit/infra.md` 的 F4 是同一根因的不同侧面——那里从「全仓 13 处引用」角度记录，这里补充手部模块的具体依赖面。）

## 修复

在 `package.json` 显式声明并锁版本：

```json
"dependencies": { "three": "0.170.0", ... },
"devDependencies": { "@types/three": "0.169.0", ... }
```

然后 `npm install` 更新 lockfile（本次审计未执行安装）。若担心与 cubing 双份 three，可改用 npm `overrides` 强制单版本。

---

# F13 — `window.motionCubeHand` 零自动化覆盖

**严重度**：medium  **分类**：test coverage  **文件**：scripts/playtest-ui.mjs:418-430；src/hand/handApi.ts 全部  **工作量**：M  **置信度**：high

## 证据（逐字）

`scripts/playtest-ui.mjs:418-430`（playtest 只校验 `__motionCubeEditor` 的**实例存在性**，**不碰 `window.motionCubeHand`**）
```
// 8c) 3D 视口：魔方 + 左右手注入（十八轮双轨；手型选择器已由双手显示取代）
if ((await page.$("#editor-view twisty-player")) === null) throw new Error("编辑器缺少 3D 视口魔方");
const handApiOk = await page.evaluate(() => {
  const ed = globalThis.__motionCubeEditor ?? {};
  const l = ed.handLeft, r = ed.handRight;
  return (
    !!l && !!r &&
    typeof l.setPose === "function" && typeof r.setPose === "function" &&
    l.type === "left" && r.type === "right"
  );
});
if (!handApiOk) throw new Error("编辑器手视图 API 未暴露");
```
`docs/hand-api-spec.md:65-81`（验证清单全是**人工**步骤）
```
## 5. 验证清单

1. `npm run typecheck` 0 error；
2. `node scripts/shot-editor-barehand.mjs`（需 dev server 5175）流程不回归；
3. 手工验证（console）：
   ...
4. 非法输入（缺 bends、非法手型）返回 `{ok:false}` 且手部状态不变。
```
`docs/hand-api-usage.md:64-69`
```
## 验证记录

2026-09-12 真机验证通过（DEV dev server + Chrome）：`getState` /
`setPose`（合法通过、非法拒绝）/ `playFrames`（playing 态） / `stop` /
`setHandType` / `setVisible` 全部按预期返回；同日二次验证双手对称驱动与
单手显示切换（十八轮 left/right 双轨语义）。
```

## 影响

API 契约（升序帧号校验、整段拒绝、错误隔离、左右对称驱动、DEV 门控）**没有任何自动化断言**。已经漏掉的两类问题都是这个缺口的直接后果：

- F2（编辑器覆盖 API 姿态）——人工「验证记录」是单次 setPose + 立即观察，恰好绕开了覆盖窗口；
- F8（`setHandType` 语义与 spec 不符）——人工验证的是「行为符合直觉」，没人对着 spec 表格逐条核对。

CI 里 `npx tsx scripts/verify-hand-mesh.ts` 只覆盖几何，`scripts/verify-data.ts` 只覆盖数据契约，API 层是空白。

## 修复

新增 `scripts/verify-hand-api.ts`（可 `npx tsx` 直跑，无需浏览器），把 `handApi.ts` 的**纯逻辑**部分（帧序校验、fps 校验、错误文案、镜像驱动）抽成可注入的纯函数后直接断言：

- 帧号必须严格升序、重复帧被拒、空数组被拒；
- 任一帧 `parsePose` 失败 → **整段拒绝**且不打断正在进行的播放；
- `fps <= 0` / `fps = NaN` 被拒；
- `setPose` 非法输入返回 `{ok:false}` 且 `handView` 姿态未变；
- `driveBoth` 对左右手分别喂「本体」与 `mirrorPose(本体)」；
- `unregisterHandApi()` 后 `window.motionCubeHand` 为 `undefined` 且定时器被清。

再在 `playtest-ui.mjs` 里加一条 DEV 断言：`window.motionCubeHand` 存在、`getState().ok === true`、非法 `setPose` 返回 `ok:false`（并把 F2 的覆盖问题写成一条「API 驱动后 500ms 姿态仍为 API 值」的断言——它现在会红，正好当作 F2 的回归测试）。

---

# F14 — `verify-hand-mesh.ts` 的镜像断言只比内侧边、绕向只测右手，结构上无法发现 F1 / F15

**严重度**：medium  **分类**：test coverage  **文件**：scripts/verify-hand-mesh.ts:90-122、37-70  **工作量**：S  **置信度**：high

## 证据（逐字）

`scripts/verify-hand-mesh.ts:109-121`
```
  // 拇指根镜像
  if (side === -1) {
    const r = buildHandMesh(DEFAULT_HAND_CONFIG, createDefaultRig("right"), 1);
    const br = bbox(r);
    expect(Math.abs(br.min.x + b.max.x) < 1e-4, "左右手 X 包围盒应镜像");
    expect(
      Math.abs(r.thumbRoot.position.x + res.thumbRoot.position.x) < 1e-6,
      "拇指根 X 应镜像",
    );
  }
  // 绕向（掌前缘平面帽 / 中指尖端斜锥面）
  checkWindingZ(res, "palm", label, 0.5);
  checkWindingZ(res, "middle-seg2", label, 0.1);
```
`scripts/verify-hand-mesh.ts:124-138`（「极值」只改 `shape`，**从不改配置的结构字段**）
```
const extremes: Array<{ name: string; shape: Record<string, number> }> = [
  { name: "粗刻面+大隆起", shape: { facets: 4, knuckleBulge: 1.6 } },
  ...
];
for (const e of extremes) {
  ...
  const res = buildHandMesh(cfg, createRigFromConfig(cfg, "right"), 1);
  noNaN(res, `极值[${e.name}]`);
}
```
`scripts/verify-hand-mesh.ts:140-154`（部件计数与绕向**只对右手**做）
```
  const counts: Record<string, number> = { "knuckle-collar": 0, "knuckle-filler": 0, "palmar-pad": 0 };
  ...
  checkWindingZ(res, "knuckle-filler", "default", 0.3);
  checkWindingZ(res, "palmar-pad", "default", 0.3);
```

## 影响

- 镜像断言 `Math.abs(br.min.x + b.max.x) < 1e-4` 只比较**内侧**两条边。实测右手 `x[-1.24875, 1.85856]`、左手 `x[-1.84984, 1.24875]` → `br.min.x + b.max.x = -1.24875 + 1.24875 = 0` **通过**；但外侧差 0.0087（thenar 奇数刻面不对称，F15）**被完全漏检**。
- `checkWindingZ` 只在 `side === 1` 的分支里对 `knuckle-filler` 跑，且它只检查「最靠 +Z 的那个三角形」，不检查整体朝向 → **F1 的 540 个反向三角形一个都没被看见**（脚本当前 exit 0，ALL PASS）。
- `extremes` 只遍历 `shape`，`bases`/`palm` 等结构字段没有非法组合用例 → F7 的 NaN 路径没有覆盖。
- 因此这个「几何自检」给出的绿信号强度远低于它的表面含义，正好解释了 F1/F15/F7 三个几何缺陷为何能一路进入 0.4.1 发布。

## 修复

在 `verify-hand-mesh.ts` 增加三类断言（左手必须参与）：

1. **逐部件镜像**：对每个 `userData.part`，断言 `|R.min.x + L.max.x| < tol` 且 `|R.max.x + L.min.x| < tol`（tol 取 1e-3，且对 `thenar` 允许到 2e-2 直到 F15 修掉）；
2. **整体朝向**：对 `knuckle-filler`/`knuckle-collar`/`web-*`/`palm` 等闭合/半闭合部件，用「面法线 · 截面径向 > 0」的比例断言（左右手都跑），比例应 ≈ 1；现成实现可参考本次审计的临时探针 `%TEMP%/mc-audit/hand-check.ts`；
3. **配置健壮性**：加一条「`index.x == middle.x` 不得产生 NaN 顶点」的用例（配合 F7 的修复）。

---

# F15 — 默认 `shape.facets = 15`（奇数）导致截面采样不对称，左右手不是精确镜像

**严重度**：low  **分类**：correctness  **文件**：src/hand/handRigStore.ts:57；src/hand/handMesh.ts:156-180  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/handRigStore.ts:55-67`
```
export const DEFAULT_SHAPE: HandShapeParams = {
  fingerWidth: 1.15,
  facets: 15,
  knuckleBulge: 1.1,
  ...
```
`src/hand/handMesh.ts:166-179`（截面采样：θ 等分 F 份，**F 为奇数时采样点集不关于 x 轴对称**）
```
  const pts: Vec3[] = [];
  for (let k = 0; k < facets; k++) {
    const th = (k * 2 * Math.PI) / facets; // 顶点在 ±x：平坦面朝 ±y（指腹/指背）
    const c = Math.cos(th);
    const s = Math.sin(th);
    const n = s < 0 ? nPad : nBack;
    const b = s < 0 ? bPad : bBack;
    pts.push([
      Math.sign(c) * Math.abs(c) ** (2 / n) * a,
      Math.sign(s) * Math.abs(s) ** (2 / n) * b + yOff,
      z,
    ]);
  }
```
**实测**（`%TEMP%/mc-audit/nan-probe.ts`，thenar 的 X 包围盒镜像误差）：
```
facets=4  thenar R.x[0.9278,1.8586] L.x[-1.8586,-0.9278] mirrorErr=0.000000
facets=6  thenar R.x[0.9278,1.8586] L.x[-1.8586,-0.9278] mirrorErr=0.000000
facets=8  thenar R.x[0.9278,1.8586] L.x[-1.8586,-0.9278] mirrorErr=0.000000
facets=14 thenar R.x[0.9278,1.8586] L.x[-1.8586,-0.9278] mirrorErr=0.000000
facets=15 thenar R.x[0.9350,1.8586] L.x[-1.8498,-0.9278] mirrorErr=0.008713   ← 默认值
facets=16 thenar R.x[0.9278,1.8586] L.x[-1.8586,-0.9278] mirrorErr=0.000000
```

## 影响

`facets=15` 时，对应的 θ 采样点集合**不关于 x 轴对称**（θ_k + π 落在两个采样点之间），于是同一份配置在左右手生成的截面多边形略有差异。表现为 thenar 纵脊最外缘左右差 **0.0087 数据单位**（≈0.016 世界单位 ≈ 1.6% 魔方边长）—— 肉眼几乎不可见，但它是「左右手不是精确镜像」这一事实的几何来源，且与 F1 叠加后会放大观感差异（左手填充棱被剔除 + thenar 边界不对齐）。

另外，`facets` 被 clamp 到 [4,16]（handRigStore.ts:214）但没限制奇偶，用户在标定页把 facets 调成奇数就会再次引入不对称。

## 修复

- 最小改动：`DEFAULT_SHAPE.facets` 改为 **16**（偶数），并在 `normalizeHandRigConfig` 里把 `facets` 向上取整到偶数（`Math.ceil(x/2)*2`），保证任何用户取值都对称；
- 或者更彻底：让 `ringPoints` 对 x 做显式对称化（把 `|cos|` 采样改为「先采上半环再镜像」），使任意 F 都对称；
- 修复后左右手 thenar 镜像误差应为 0（实测偶数 facets 已是 0）。

---

# F16 — `clampBend` / `JointDef.range` 在渲染路径从未使用

**严重度**：low  **分类**：dead code / data contract  **文件**：src/hand/HandRig.ts:117-135、18-29；src/hand/HandRigView.ts:165  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/HandRig.ts:117-135`
```
export const DEFAULT_BEND_RANGE = { min: 90, max: 180 };
...
export function clampBend(joint: JointDef, value: number): number {
  const r = joint.range ?? DEFAULT_BEND_RANGE;
  return Math.min(r.max, Math.max(r.min, value));
}
```
`src/hand/HandRig.ts:23-25`（关节定义里带 range）
```
  /** 屈伸范围（默认 90–180） */
  range?: { min: number; max: number };
```
`src/hand/HandRigView.ts:163-166`（渲染时**直接使用原始 bend，未夹取**）
```
      for (let j = 0; j < nodes.joints.length; j++) {
        // bend = 指腹侧夹角（180 伸直）；绕 X 旋转使段向指腹（-Y）弯
        nodes.joints[j].rotation.x = degToRad(180 - (bends[j] ?? 180));
      }
```
全仓检索 `clampBend`：仅 `src/hand/HandRig.ts`（定义）与 `scripts/verify-data.ts:52,191-197`（**测试**）——没有任何生产代码调用。

## 影响

- 关节的屈伸范围是数据模型里的一等公民（`JointDef.range`），但**运行时从不生效**。经 `parsePose` 校验通过的 `bends` 只要求「有限数字数组」（`src/data/technique.ts:204`），不做范围检查 → 外部 API 或手改 JSON 可以塞 `bends.index[1] = 900`，渲染出「手指反折 720°」的畸形手，既不报错也不夹取；
- `clampBend` 只在测试里被调用，等于**测试了一个生产路径不用的函数**——这是典型的假覆盖。

## 修复

在 `HandRigView.applyPose` 里按关节定义夹取（需要拿到 `rig.fingers[name].joints[j].range`）：

```ts
const jointDef = this.rig.fingers[name].joints[j];
const bend = clampBend(jointDef, bends[j] ?? 180);
nodes.joints[j].rotation.x = degToRad(180 - bend);
```

并在 `parsePose` 层对越界值给出明确错误或夹取（API 侧建议**夹取**而非拒绝，避免脚本因一个越界数字整段被拒）。

---

# F17 — `parsePose` 不校验四元数是否归一

**严重度**：low  **分类**：data contract  **文件**：src/data/technique.ts:151-159、194-230；src/hand/HandRigView.ts:135-140  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/data/technique.ts:151-159`
```
function parseQuat(v: unknown, name: string): Pose["palm"]["quaternion"] {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new TechniqueError(`关键帧姿态非法：${name} 必须为对象`);
  const { w, x, y, z } = o;
  if (!isFiniteNum(w) || !isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(z)) {
    throw new TechniqueError(`关键帧姿态非法：${name} 含非数字分量`);
  }
  return { w, x, y, z };
}
```
`src/hand/HandRigView.ts:135-140`（直接塞进 three.js 的四元数，**不做归一化**）
```
    this.root.quaternion.set(
      palm.quaternion.x,
      palm.quaternion.y,
      palm.quaternion.z,
      palm.quaternion.w,
    );
```
（`Object3D.quaternion.set` 不归一化；`Matrix4.makeRotationFromQuaternion` 假定单位四元数。）

## 影响

外部脚本喂 `{w: 2, x: 0, y: 0, z: 0}`（模长 2）能通过 `parsePose` 校验，进入渲染后 three.js 用未归一化四元数构造旋转矩阵 → 矩阵带 2 倍缩放 → **整只手被放大/畸变**，而不是报错。规范化的缺失让「非法姿态」这一防线在四元数维度上完全失效。

## 修复

在 `parseQuat` 里校验并归一化（模长为 0 时拒绝）：

```ts
const len = Math.hypot(w, x, y, z);
if (len < 1e-6) throw new TechniqueError(`关键帧姿态非法：${name} 四元数为零向量`);
return { w: w / len, x: x / len, y: y / len, z: z / len };
```

注意：`mirrorPose` 对四元数做 `{w, x, -y, -z}`，保持模长不变，归一化后仍然正确。

---

# F18 — `mirrorPose` 与入参共享 `bends` / `contacts` 引用

**严重度**：low  **分类**：maintainability  **文件**：src/hand/HandRig.ts:93-115  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/HandRig.ts:103-115`
```
  return {
    ...pose,
    palm: {
      transform: mirrorT(pose.palm.transform),
      thumbBase: mirrorT(pose.palm.thumbBase),
    },
    thumbCMC: {
      ...pose.thumbCMC,
      abduction: -pose.thumbCMC.abduction,
      rotation: -pose.thumbCMC.rotation,
    },
  };
```
（`...pose` 只浅拷贝：`bends` 与 `contacts` 仍是**同一个对象/数组引用**。）

## 影响

`mirrorPose(p).bends === p.bends`、`mirrorPose(p).contacts === p.contacts` 恒成立。API 的 `driveBoth` 正是这样把同一份 `bends` 喂给左右手（`handApi.ts:51-54`）——目前无害，因为两边都不就地改 `bends`；但只要将来有人在「镜像后」改一个 bend（例如补一个拇指关节角），**源姿态会被同步改掉**，产生极难排查的串扰。`src/vue/pages/EditorPage.vue:312-313` 的 `mirrorToOppositeAtPlayhead` 也是浅拷贝镜像，同样共享引用。

## 修复

`mirrorPose` 里深拷贝可变部分：

```ts
bends: Object.fromEntries(
  Object.entries(pose.bends).map(([k, v]) => [k, [...v]]),
) as Pose["bends"],
contacts: pose.contacts.map((c) => ({ ...c })),
```

---

# F19 — `playFrames` 对 `fps` 与帧数无上限

**严重度**：low  **分类**：robustness  **文件**：src/hand/handApi.ts:83-124  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/handApi.ts:83-84`
```
  const fps = opts?.fps ?? DEFAULT_FRAME_RATE;
  if (!Number.isFinite(fps) || fps <= 0) return err(`fps 必须 > 0：${String(fps)}`);
```
`src/hand/handApi.ts:106-124`
```
  playTimer = window.setInterval(() => {
    ...
    driveBoth(parsed[idx].pose);
  }, 1000 / fps);
```
`src/hand/handApi.ts:80-82`
```
  if (!Array.isArray(frames) || frames.length === 0) {
    return err("frames 必须为非空数组");
  }
```

## 影响

- `fps` 只校验「有限且 > 0」。`fps: 1e9` → `setInterval(..., 1e-6)` 被浏览器钳到 ~1ms → **每秒约 1000 次回调**，每次都 `driveBoth` → `setPose` → `applyPose`（重建接触点标记，见 F11）→ 稳定的高频分配与渲染请求；
- `frames` 数组长度无上限 → 一次性 `parsePose` 十万条会长时间阻塞主线程（`playFrames` 是同步 API，`parsePose` 在循环里同步执行）；
- `frames[0].frame` 允许负数/小数（只校验 `Number.isFinite` 与后续严格升序）。

## 修复

```ts
const fps = opts?.fps ?? DEFAULT_FRAME_RATE;
if (!Number.isFinite(fps) || fps <= 0 || fps > 240) return err(`fps 必须在 (0, 240]：${String(fps)}`);
if (frames.length > 10000) return err(`frames 过多：${frames.length}`);
```

并把 `frames[i].frame` 收紧为非负整数（与 `parseKeyframe` 对 frame 的要求一致，见 `src/data/technique.ts:241`）。

---

# F20 — `scripts/measure-hand.mjs` 不测量任何东西

**严重度**：low  **分类**：dead code / doc drift  **文件**：scripts/measure-hand.mjs:1-6、52-70  **工作量**：S  **置信度**：high

## 证据（逐字）

`scripts/measure-hand.mjs:1-6`
```
// 测量编辑器 3D 视口里手/魔方的像素比例（当前渲染），用于校准缩放。
// 运行（先起 5174）：node scripts/measure-hand.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
```
`scripts/measure-hand.mjs:52-67`
```
// 视口居中
const rect = await page.evaluate(() => {
  const v = document.querySelector("#editor-view");
  v.scrollIntoView({ block: "center" });
  const r = v.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
    raw: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
});
await sleep(600);
const shot = `${OUT}/measure-hand.png`;
console.log("rect:", JSON.stringify(rect));
await page.screenshot({ path: shot });
```
脚本尾部只有 `console.log("done")`，**没有任何像素分析、没有手/魔方边长测量、没有比例输出**；`readFileSync` 被 import 但从未使用。

## 影响

文件名与头注释承诺的「测量手/魔方像素比例，用于校准缩放」并未实现：脚本只是把视口矩形打印出来 + 存一张 PNG，供人眼看。`handScale` 的定量校准（AGENTS.md 提到「3.1 渲染后整体过大，中指 4.1 块超出魔方面」这类目测回调）因此仍靠人工目测，没有可复现的量测工具。

## 修复

二选一：
- **补齐实现**：读回 PNG，用像素扫描估算魔方面与手部的外接尺寸并输出比例（例如按手部肤色像素 `#e4d4bd` 与魔方白面 `#f0f0f0` 的连通域包围盒），把 `rect` 升级为 `handPx / cubePx = …`；
- **降级为截图工具**：把头注释改成「打开编辑器并截取视口（供人工目测手/魔方相对大小）」，文件名改为 `shot-editor-view.mjs`，并删掉未用的 `readFileSync` import。

---

# F21 — 标定页 ResizeObserver 每事件全量重建 SVG，未做 rAF 合并

**严重度**：low  **分类**：perf  **文件**：src/hand/HandCalibView.ts:99、215-255、316-429、143-150  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/HandCalibView.ts:99-100`
```
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(container);
```
`src/hand/HandCalibView.ts:252-254`（`fit()` 末尾无条件重画标尺并渲染）
```
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.drawRuler();
    this.render();
```
`src/hand/HandCalibView.ts:316-317`（`drawRuler` 每次 `replaceChildren()` 整棵 SVG 重建）
```
  private drawRuler(): void {
    this.overlay.replaceChildren();
```
`src/hand/HandCalibView.ts:143-150`（**只有拖标尺路径做了 rAF 合并**，resize 路径没有）
```
  private scheduleRulerDraw(): void {
    if (this.rulerDirty) return;
    this.rulerDirty = true;
    this.rulerRaf = requestAnimationFrame(() => {
      this.rulerDirty = false;
      this.drawRuler();
    });
  }
```
`src/hand/HandCalibView.ts:399-428`（每次重画要生成 51 条刻度线 + 数字 + 命中条 + 尺身）

## 影响

拖动窗口/改变侧栏宽度时，`ResizeObserver` 每帧触发 → `fit()` → `drawRuler()` 重建整棵 SVG（网格线 + 51 刻度 + 数字 text + 若干 rect，含 `document.createElementNS` 数百次）+ 一次 WebGL 渲染。标定页有两个 `HandCalibView`，量级翻倍。拖拽窗口时明显掉帧。

## 修复

给 resize 路径也加上 rAF 合并（复用已有的 `scheduleRulerDraw` 思路）：

```ts
private resizeRaf = 0;
this.resizeObserver = new ResizeObserver(() => {
  if (this.resizeRaf) return;
  this.resizeRaf = requestAnimationFrame(() => {
    this.resizeRaf = 0;
    this.fit();
  });
});
```

并在 `dispose()` 里 `cancelAnimationFrame(this.resizeRaf)`。进一步可把「网格线」与「标尺」拆成两个 SVG 层，网格只在盒变化时重画。

---

# F22 — `CUBE_UNIT_WORLD` 寄居在 `HandRigView.ts`

**严重度**：low  **分类**：maintainability  **文件**：src/hand/HandCalibView.ts:21；src/hand/HandOrbitView.ts:19；src/hand/HandRigView.ts:31-32  **工作量**：S  **置信度**：high

## 证据（逐字）

`src/hand/HandRigView.ts:31-32`
```
/** 1 魔方单位（块边长）≈ cubing 世界单位（sticker 面内间距 ±0.33 ↔ 规范 ±1 推出） */
export const CUBE_UNIT_WORLD = 0.33;
```
`src/hand/HandCalibView.ts:21`
```
import { CUBE_UNIT_WORLD } from "./HandRigView";
```
`src/hand/HandOrbitView.ts:19`
```
import { CUBE_UNIT_WORLD } from "./HandRigView";
```
`src/hand/HandRigView.ts:19-29`（该模块顶部依赖 `CubePlayer` → cubing）
```
import type { CubePlayer } from "../cube/CubePlayer";
...
import { buildHandMesh, meshSurfaceOffset, type FingerNodes } from "./handMesh";
import { createRigFromConfig, loadHandRigConfig, type HandRigConfig } from "./handRigStore";
```

## 影响

标定页与轨道视图为了拿一个**纯常量**（0.33），把 `HandRigView` → `CubePlayer` → cubing.js 整条依赖链拉进来。这两个视图本身完全不需要 cubing（各自有独立的 `WebGLRenderer`），却被迫与编辑器渲染线耦合：将来若 `CubePlayer` 的构造/生命周期变动，标定页会被牵连；同时也妨碍把标定页单独拆成独立包。

## 修复

把常量搬到中性位置（例如新增 `src/hand/units.ts`，或放进已有的 `handRigStore.ts`），三处统一从新位置导入；`HandRigView` 再从那里 re-export 以保持既有 import 不破。

---

# F23 — 计划中的「手-魔方碰撞箱」：代理数据已具备，但缺公开访问口，与 spec §4 冻结清单冲突

**严重度**：medium  **分类**：spec / design  **文件**：src/hand/HandRigView.ts:36-49、44；docs/hand-api-spec.md:61；docs/todo.md:22  **工作量**：M  **置信度**：high

## 证据（逐字）

`docs/todo.md:20-23`（待办原文）
```
### 手部
- ⬜ 用户**真机定版**十二~十六轮手部观感（feat/hand-lowpoly 分支保留至定版后删）。
- ⬜ **碰撞箱**：手-魔方简化相交判断（段级 AABB/胶囊代理），供接触可行性校验 /
  自动姿态 / 穿透检测。
```
`docs/hand-api-spec.md:59-62`（**冻结清单**）
```
## 4. 冲突规避约束（硬性）

- **禁止修改**：`src/hand/handMesh.ts`、`src/hand/handGeometry.ts`、`src/hand/HandRig.ts` 类型定义、`src/hand/handRigStore.ts`、`src/hand/HandRigView.ts` 公开方法签名、`scripts/playtest-ui.mjs` 既有断言（这些在 feat/hand-lowpoly 高频迭代中）。
```
`src/hand/handMesh.ts:49-57`（**段级代理数据其实已经齐备**）
```
export type SegmentNode = { joint: Group; len: number; radius: number; thickness: number };
export type FingerNodes = { root: Group; joints: Group[]; segments: SegmentNode[] };

export type HandMeshResult = {
  root: Group;
  fingers: Record<FingerName, FingerNodes>;
  thumbRoot: Group;
  thumbDof: Group;
};
```
`src/hand/handMesh.ts:76-78`（表面偏移工具）
```
export function meshSurfaceOffset(seg: SegmentNode, dir: "x" | "y", H: number): number {
  return (dir === "x" ? seg.radius : seg.thickness) + MARK_GAP * H;
}
```
`src/hand/HandRigView.ts:44`（**但这份代理数据在视图层是 private**）
```
  private fingers = {} as Record<FingerName, FingerNodes>;
```
`src/hand/HandRigView.ts:36-49`（公开面只有这些）
```
export class HandRigView {
  private readonly group = new Group();
  ...
  private fingers = {} as Record<FingerName, FingerNodes>;
```
`src/hand/HandRigView.ts:206-214`（接触点 → 段局部坐标的换算，碰撞箱需要它的逆运算）
```
/** 接触点在该段局部坐标：z = t×len，按侧偏移（腹 -Y / 背 +Y 用厚度；拇指/小指侧用宽度） */
function contactLocalPoint(c: Contact, seg: FingerNodes["segments"][number], sideSign: number, H: number): Vector3 {
```

## 已具备的碰撞箱原语（回答「已有什么可复用」）

| 需要的原语 | 现状 | 位置 |
|---|---|---|
| 段级胶囊/AABB 代理（半宽、半厚、长度） | ✅ 已有：`SegmentNode{ len, radius, thickness }` | handMesh.ts:49 |
| 段在世界空间的位姿（FK 后的关节矩阵） | ✅ 已有：`SegmentNode.joint` 是 `Object3D`，`getWorldMatrix` 即得 | handMesh.ts:49 |
| 表面偏移（腹/背/拇指侧/小指侧） | ✅ 已有：`meshSurfaceOffset()` | handMesh.ts:76 |
| 段局部坐标 → 接触点 | ✅ 已有：`contactLocalPoint()` | HandRigView.ts:207 |
| 整手世界 AABB（粗代理） | ✅ 已有且在用：`Box3.setFromObject(root)` | HandCalibView.ts:279、HandOrbitView.ts:112 |
| 数据单位 → 世界单位换算 | ✅ 已有：`CUBE_UNIT_WORLD` | HandRigView.ts:32 |
| 魔方世界 AABB | ⚠ 需现场算：`Box3.setFromObject(player 的 three 对象)` | 无现成封装 |
| **从 `HandRigView` 取到段代理** | ❌ **缺失**：`fingers` 是 private，无公开访问口 | HandRigView.ts:44 |

## 影响

碰撞箱功能（`docs/todo.md:22`）在数据层几乎是「现成的」——段级半宽/半厚/长度 + FK 矩阵都在。真正的阻塞是**取数路径**：`HandRigView.fingers` 是 private，外部拿不到段代理；而 spec §4 又把 `HandRigView` 的公开面列为**禁改清单**（理由是手部几何层高频迭代、API 层不得破坏它）。

结果是：该功能要么绕过 `HandRigView` 自己重建一份网格（几何重复构建、状态不同步），要么需要给 `HandRigView` 增加公开方法 —— 后者与 spec §4 的字面约束冲突，需要**先修订 spec**。这个冲突现在不写在任何地方，接手的人会在实现时才撞上。

## 修复

1. **先修 spec**：在 `docs/hand-api-spec.md` §4 的禁改清单里补一句例外条款，例如「允许**新增**只读访问器（如 `segmentProxies(): SegmentProxy[]`），不得修改/删除既有公开方法签名」——把「冻结既有签名」与「允许增量扩展」区分开；
2. **新增只读访问器**：在 `HandRigView` 增加
   ```ts
   /** 段级碰撞代理（世界空间 AABB）：只读快照，碰撞箱/穿透检测消费 */
   segmentProxies(): { finger: FingerName; index: number; min: Vector3; max: Vector3 }[]
   ```
   内部用 `SegmentNode.joint` 的世界矩阵把 `(±radius, ±thickness, 0..len)` 变换到世界空间，取 AABB；
3. **魔方侧**：在 `CubePlayer` 上补一个 `worldBounds(): Box3`（或直接在碰撞模块里对 `onThreeScene` 的对象 `setFromObject`），避免各处重复算；
4. 复用 `meshSurfaceOffset` 与 `contactLocalPoint` 的语义，保证「接触点判定」与「碰撞代理」用同一套表面偏移定义，避免两套几何口径打架。

---

## 附：本次审计判定为「干净」的部分

- **DEV 门控真实有效**：`registerHandApi` 内 `if (!import.meta.env.DEV) return;`（handApi.ts:131）在生产构建中被静态消除——核对 `dist/assets/EditorPage-DKcRKQU2.js`（构建时间晚于全部手部源文件）**全文没有 `window.motionCubeHand =` 赋值**，仅剩 `unregisterHandApi` 里的 `delete window.motionCubeHand`。生产包不暴露该对象，符合 spec 与 usage 文档的承诺。
- **i18n 无缺口**：`zh-CN.ts` 与 `en.ts` 键集完全一致（各 344 个，`hand.*` 各 57 个），`hand.*` / `help.*` 段**没有任何未翻译值**。
- **外部输入校验主体健全**：`parsePose`（technique.ts:194-230）对 palm/bends/thumbCMC/contacts 做了深度校验并抛 `TechniqueError`；`handApi.tryParsePose` 捕获后转成 `{ok:false,error}`，符合「不抛异常到外部」的承诺；`playFrames` 采取「先全量 parse 再接管定时器」，非法调用不会打断正在进行的播放。
- **左右对称驱动的数学正确性**：`mirrorPose` 的四元数镜像 `{w,x,-y,-z}`（= M·R·M，M=diag(-1,1,1)）与左右手网格的 `sideSign` 约定自洽——`mirrorPose(defaultHandPose("left"))` 恰好等于 `defaultHandPose("right")`（`verify-data.ts:331` 有对应断言）；contacts 的解剖侧语义由 `contactLocalPoint` 里的 `sideSign` 自动成立，无需改数据。
- **数据契约层的存储校验较完整**：`normalizeHandRigConfig` 对 v1→v4 的迁移、逐值区间截断、`shape` 缺省回填均有 `scripts/verify-data.ts:226-330` 的覆盖（v3 迁移、越界截断、fingerWidth 旧档补默认等），CI 亦在跑。
- **`buildHandMesh` 的重建成本可接受**：实测 ≈4.9 ms/只手，标定页已有 150ms 防抖 + rAF 合并（HandCalibPage.vue:97-104），不构成卡顿风险（但 `HandCalibView.dispose()` 里的那次多余重建应去掉，见 F10）。
