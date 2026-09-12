# 手部外部注入 API 使用说明（`window.motionCubeHand`）

> 规格与实现约束见 [hand-api-spec.md](hand-api-spec.md)；本文面向使用者。
> A 期已实现（DEV 构建限定）；B 期（WebSocket 帧流、生产 opt-in）暂缓。

## 是什么

**DEV 构建**（`npm run dev` / tauri dev）下，动画编辑器页（`#/editor`）会挂载
`window.motionCubeHand`，供外部脚本直接驱动手部姿态与播放：

- DevTools 控制台手敲；
- Tauri 桌面版 `webview.eval(...)`；
- 用户脚本 / MCP 预览服务等外部自动化。

生产构建（`npm run build` / tauri build）**不暴露**该对象（`import.meta.env.DEV` 守卫）。

## 方法一览（全部返回 `{ ok: boolean; error?: string }`，不抛异常）

| 方法 | 说明 |
| --- | --- |
| `setPose(json)` | 直接设置姿态；入参经 `technique.parsePose` 深度校验，结构同手法关键帧的 `pose` |
| `playFrames(frames, opts?)` | 帧流播放：`frames = [{ frame: 绝对帧号, pose }, …]`（升序、不重复）；`opts = { fps?, loop? }`，绝对帧号定时推进 |
| `stop()` | 停止播放 |
| `clear()` | 清除姿态（手回到隐藏，等同编辑器无姿态态） |
| `setHandType("right" \| "left")` | 切换手型（镜像手随之取对侧） |
| `setVisible(bool)` | 手部显隐 |
| `getState()` | `{ ok, handType, visible, playing, pose }`——当前完整状态快照 |

姿态数据格式与手法库关键帧完全一致（`palm.transform / palm.thumbBase / bends /
thumbCMC / contacts`），因此可以直接把手法库 JSON 里的关键帧喂给 `setPose` /
`playFrames`。

## 快速上手（DevTools 控制台）

```js
const h = window.motionCubeHand;

// 1) 读当前状态（含当前姿态，可作为试手数据）
const s = h.getState();

// 2) 原位回放当前姿态
h.setPose(s.pose);

// 3) 两帧播放示例（30fps，绝对帧号）
h.playFrames([{ frame: 0, pose: s.pose }, { frame: 12, pose: s.pose }], { fps: 30 });
h.stop();

// 4) 手型 / 显隐
h.setHandType("left");
h.setVisible(false);

// 5) 非法数据会被拒绝（不抛异常）
h.setPose({ nonsense: 1 }); // { ok: false, error: "关键帧姿态非法：palm 必须为对象" }
```

## 与双手显示的关系

编辑器开启「双手显示」后，对侧镜像手随主手自动跟随——`window.motionCubeHand`
驱动的每一条姿态同样会同步到镜像手，无需额外调用。

## 验证记录

2026-09-12 真机验证通过（DEV dev server + Chrome）：`getState` /
`setPose`（合法通过、非法拒绝）/ `playFrames`（playing 态） / `stop` /
`setHandType` / `setVisible` 全部按预期返回。
