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
| `playFrames(frames, opts?)` | 帧流播放：`frames = [{ frame: 绝对帧号, pose }, …]`（升序、不重复）；`opts = { fps?, loop? }`，按绝对帧号定时推进；`loop: true` 按片段跨度（末帧−首帧）取模循环（单帧片段只停在唯一姿态），缺省播到末帧即停。循环细节见下文「循环语义」 |
| `stop()` | 停止播放，并归还外部驱动所有权（见下节） |
| `clear()` | 清除姿态（手回到隐藏，等同编辑器无姿态态），并归还外部驱动所有权 |
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

编辑器默认双手显示（左手为主、右手为辅）。`setPose` / `playFrames` 驱动的单条
姿态会以**对称方式**同时作用于双手（左手取姿态本体、右手取其 x 镜像），无需额外
调用；`setHandType("left" | "right")` 切换单手显示（只显左手 / 只显右手），
`setVisible(true)` 恢复双手。手法关键帧本身为 left/right 显式双轨（可独立编辑，
双手默认不关联）。

## 外部驱动所有权（P1-1）

编辑器在播放中会以 60Hz 预览逻辑不断把双手姿态刷成当前手法的双轨姿态，这会把
注入 API 刚写入的姿态**静默覆盖**。为此 API 引入了显式的「外部驱动」所有权：

- `setPose` / `playFrames` **校验通过并成功接管**时，置 `externalDrive.active = true`
  （非法调用不接管，不会劫持编辑器控制权）；
- 接管期间，编辑器 `renderPreview()` / 重绘 **跳过**双轨 `setPose`，API 写的姿态留住；
- `stop()` / `clear()` 以及**任何用户交互**（播放/暂停、拖动播放头、编辑关键帧、
  切换手型、切页卸载）都会归还所有权（模块导出 `releaseExternalDrive()`，编辑器侧调用）；
- 归还后编辑器恢复「以手法库为准」的正常预览。

也就是说：脚本驱动 → 直到你点 `stop()` / `clear()` 或自己在界面上动手，编辑器都不会
抢回手部控制权。非循环 `playFrames` 播到末帧后仍保持所有权（末帧姿态留在手上），
需要归还就调 `stop()`。

## 循环语义（`loop: true`，P1-2）

`playFrames` 的 `frame` 是**绝对帧号**，帧号决定「这一帧什么时候出现」：

- **播放周期** = （末帧 − 首帧） ÷ fps 秒。周期内目标帧按跨度取模回绕：
  `target = 首帧 + (已流逝秒 × fps) mod (末帧 − 首帧)`，
  到达末帧后**回到首帧**继续下一周期（旧实现只增不减，播一遍就永久停在末帧）。
- **每个关键帧的占位** = 它与下一关键帧的帧号差（÷ fps 秒）；**末帧占周期最后
  1 帧时长**（取模区间是 [首帧, 末帧)，不这样处理末帧就永远轮不到，动画看起来
  只会停在倒数第二帧）。
- **单帧片段**（首帧 = 末帧）：没有动画可播，直接停在唯一姿态，不起定时器
  （`getState().playing` 为 false）。
- **非循环**：播到末帧即停（定时器清除、末帧姿态留在手上、所有权仍归 API）。

例：`playFrames([{frame:0,pose:A},{frame:15,pose:B},{frame:30,pose:C}], {fps:30, loop:true})`
→ 周期 1 秒：A 显示 0–0.5s、B 显示 0.5s–约 0.967s、C 占最后 1 帧（约 0.967–1s），
然后回到 A 重新开始。想要各帧等分，就把帧号等距排开（如 0/15/30/45）。

## 验证记录

2026-09-12 真机验证通过（DEV dev server + Chrome）：`getState` /
`setPose`（合法通过、非法拒绝）/ `playFrames`（playing 态） / `stop` /
`setHandType` / `setVisible` 全部按预期返回；同日二次验证双手对称驱动与
单手显示切换（十八轮 left/right 双轨语义）。

2026-10-27 审计第二批（P1-1 / P1-2 / P0-8）浏览器实证（DEV dev server 5174 +
Chrome headless，脚本 `spike-shots/verify-handapi-loop.mjs`，产物
`spike-shots/handapi-verify.log`）：

- `loop: true` 真循环：16ms 间隔抽样游程 `A→B→C→A→B→C→A→B→C→A`，
  A 段起点 0 / 1047 / 2030 / 3033 ms（间隔 ≈1000ms = 跨度 30 帧 ÷ fps 30），
  ≥3 个完整周期且回到起点；末帧 C 每个周期可见（约 33ms = 1 帧）。
- 编辑器**播放中** `setPose` / `playFrames` 写的姿态不被 60Hz 预览覆盖
  （700ms 后读回仍是注入值）。
- 非循环播到末帧即停（`playing=false`，姿态停在末帧）；`stop()` 停表且保留姿态；
  单帧片段不报错、不空转。
- P0-8：坏手法只跳过该条（其余手法/公式/分类全部保留、状态栏显式提示），
  整包 JSON 损坏时报错并**拒绝写回**（原数据不被空库覆盖）。
