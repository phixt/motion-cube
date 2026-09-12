# 手部外部注入 API · 规格说明（供实现方）

> 2026-09-12 · feat/hand-lowpoly 分支 · 状态：**已实现**（A 期同步 API，commit `9ca48b0`；
> 真机验证 22 项断言全过 + `shot-editor-barehand.mjs` 回归通过）。
> 实现方应严格遵循本文档的「冲突规避约束」——手部几何层正在高频迭代，API 层必须只调用
> 既有公开接口，不修改几何/数据内部。

## 1. 目标

在动画编辑器页暴露 `window.motionCubeHand`（DEV 构建限定），允许外部脚本（DevTools
控制台、Tauri `webview.eval`、用户脚本）直接驱动手部姿态与播放，便于：

- AI/脚本自动化查看手部形变效果（配合 `scripts/shot-editor-barehand.mjs` 截图流程）；
- 后续外部程序实时推帧（二期 WebSocket，本期不做）。

## 2. 现状与可复用触点（只调用，不修改）

| 触点 | 位置 | 说明 |
|---|---|---|
| `handView` | `EditorPage.vue` ~L1317 `handView = new HandRigView(player)`，并挂 `window.__motionCubeEditor = { player, handView }` | 手部视图实例（编辑器页生命周期内有效） |
| `HandRigView` 公开 API | `src/hand/HandRigView.ts` | `init()` / `setPose(pose: Pose \| null)` / `setHandType(type)` / `setVisible(b)` / `currentPose()` / `type` |
| `Pose` 数据契约 | `src/hand/HandRig.ts` | `palm.transform{position, quaternion(w,x,y,z)}` + `palm.thumbBase` + `bends: Record<FingerName, number[]>`（拇指 3 项/四指 3 项）+ `thumbCMC{abduction,elevation,rotation}` + `contacts[]` |
| 姿态校验 | `src/data/technique.ts` `parsePose(v: unknown): Pose` | **外部数据必须过它**，抛 `TechniqueError` |
| 基姿态构造 | `src/hand/HandRig.ts` `defaultHandPose(handType)` / `createDefaultPose(rig)` | 修改局部字段生成目标姿态 |
| DEV 后门先例 | `window.__motionCube`（仅 `import.meta.env.DEV` 挂载） | 挂载守卫沿用此模式 |

## 3. API 设计（新增 `src/hand/handApi.ts`）

```ts
export type HandApiPlayOptions = { fps?: number; loop?: boolean };

export function registerHandApi(handView: HandRigView): void
// 挂载 window.motionCubeHand（仅 DEV）；编辑器卸载时调用 unregisterHandApi()
```

`window.motionCubeHand` 表面（全部同步返回 `{ ok: boolean; error?: string; ... }`，不抛异常到外部）：

| 方法 | 行为 |
|---|---|
| `setPose(json: unknown)` | `parsePose` 校验 → `handView.setPose(pose)`；校验失败返回 `{ok:false, error}` |
| `playFrames(frames: { frame: number; pose: unknown }[], opts?: { fps?: number; loop?: boolean })` | 逐帧 `parsePose` 后按 `frame/fps` 间隔定时 `setPose`（不插值，帧率定时器用 `setInterval`，帧号升序校验）；`stop()` 可中断 |
| `stop()` | 停止 playFrames 定时器 |
| `clear()` | `handView.setPose(null)`（回到默认姿态路径） |
| `setHandType(t: "left" \| "right")` | 转调 `handView.setHandType` |
| `setVisible(b: boolean)` | 转调 `handView.setVisible` |
| `getState()` | 返回 `{ handType, visible, playing, pose: currentPose() }`（调试用） |

实现要点：

1. **只新增文件** `src/hand/handApi.ts`；`EditorPage.vue` 仅两处改动：
   - onMounted 中 `handView` 创建后 `registerHandApi(handView)`；
   - onBeforeUnmount 中 `unregisterHandApi()`。
2. **DEV 守卫**：`registerHandApi` 内部 `if (!import.meta.env.DEV) return;`（沿袭 `__motionCube` 先例；生产 opt-in 留二期）。
3. `playFrames` 的帧间插值**不做**（保持实现最小）；外部要平滑就自己密帧。
4. 所有定时器句柄存模块级变量，`unregisterHandApi` 必须清理（防切页泄漏）。
5. 实现偏差记录：`parsePose` 原为 `technique.ts` 模块私有函数，为实现「外部数据必须过它」
   已加 `export`（仅可见性变更，零逻辑改动，不在禁改清单内）。

## 4. 冲突规避约束（硬性）

- **禁止修改**：`src/hand/handMesh.ts`、`src/hand/handGeometry.ts`、`src/hand/HandRig.ts` 类型定义、`src/hand/handRigStore.ts`、`src/hand/HandRigView.ts` 公开方法签名、`scripts/playtest-ui.mjs` 既有断言（这些在 feat/hand-lowpoly 高频迭代中）。
- **允许修改**：新增 `src/hand/handApi.ts`；`EditorPage.vue` 上述两处 + import；本文件状态更新（实现后把「待实现」改「已实现」并附提交号）。
- `window.__motionCubeEditor` 保留不动（API 内部不依赖它，从参数传入 handView）。

## 5. 验证清单

1. `npm run typecheck` 0 error；
2. `node scripts/shot-editor-barehand.mjs`（需 dev server 5175）流程不回归；
3. 手工验证（console）：
   ```js
   motionCubeHand.setPose({
     palm: { transform: { position: { x: 0, y: 0, z: -2.2 },
       quaternion: { w: 0.5, x: -0.5, y: -0.5, z: 0.5 } },
       thumbBase: { position: { x: 0, y: 0, z: 0 }, quaternion: { w: 1, x: 0, y: 0, z: 0 } } },
     bends: { thumb: [170, 165, 168], index: [168, 135, 150], middle: [168, 135, 150],
       ring: [168, 135, 150], pinky: [168, 135, 150] },
     thumbCMC: { abduction: 0, elevation: 0, rotation: 15 }, contacts: [],
   });
   motionCubeHand.getState();
   ```
4. 非法输入（缺 bends、非法手型）返回 `{ok:false}` 且手部状态不变。

## 6. 分期

- **A 期（本文档）**：上述同步 API。
- **B 期（暂缓）**：本地 WebSocket 帧流实时驱动；生产构建 opt-in 暴露。
