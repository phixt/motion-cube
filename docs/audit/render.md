# 渲染线审计报告 — AREA = render

- 审计范围：`src/cube/{CubePlayer,GrayOverlay,stickering}.ts`、`src/cube/render/{RenderCube,RenderCubeHost,pose}.ts`、`src/ui/{grayPanel,dom}.ts`、`src/timeline/Timeline.ts`、`src/vue/components/{PseudoCube3D,SolverOptionsPanel}.vue`、`src/game/session.ts`；为定位「渲染/播放层 ↔ 消费方」契约，附带只读检查了 `src/vue/pages/{GamePage,EditorPage,RenderDemoPage}.vue`、`src/input/keymap.ts`、`src/hand/HandRigView.ts`、`node_modules/cubing@0.63.3` 的 `twisty` 产物（第三方仅作行为取证，不评第三方代码）。
- 排除：`node_modules/`、`dist/`、`src-tauri/target/`、`spike-shots/`、`reference/`、`.reasonix/`、`src/vendor/winui-on-web`。
- 方法：通读全部目标文件；对 cubing 0.63.3 的 `experimentalCurrentThreeJSPuzzleObject` / `experimentalAddMove` / `CatchUpHelper` / `AlgDuration` / `AnchorTransformationProp` 逐段读源码取证；用只读探针脚本（写在 `%TEMP%/mc-audit/`，**未写入仓库**）实跑验证关键断言。
- 只读保证：本次审计仅写入本文件 `docs/audit/render.md`；未改动任何源码/测试/配置，未 `npm install`，未启动 dev server，未 commit/branch/stash（`git status` 仅见仓库原有的 `_v*.ts` 杂散文件与本文件）。
- 运行环境：Windows，Node v24.18.0，tsx 4.23.8。

---

## 实跑验证记录

| 命令 / 探针 | 结果 |
|---|---|
| `npx vue-tsc --noEmit` | exit 0（基线绿） |
| `npx tsx scripts/verify-render-cube.ts` | exit 0（PASS 22 / FAIL 0）——但**不覆盖** `CubePlayer` 的 render 后端编排（见 F19） |
| `%TEMP%/mc-audit/check-preset3.ts`（标灰预设 × 底色矩阵） | 复现 F1：6 个底色中 5 个错位，cross 命中 0~2/9、roux 命中 0~8/13 |
| `%TEMP%/mc-audit/check-render.ts`（dormant RenderCube 语义） | 复现 F6（贴纸态被二次施加）、F7（改速后动画瞬移） |
| cubing 源码取证 | `experimentalAddMove` → `catchUpMove` → `CatchUpHelper.catchUpMs = 500`；`AlgDuration.defaultDurationForAmount(1) = 1000`；`Twisty3DPuzzleWrapper.scheduleRender()` 每动画帧派发 `render-scheduled`；`AnchorTransformationProp` + `setupAnchor:"start"` ⇒ 静止态即已施加 setupAlg |

---

## 发现汇总

| # | 标题 | 严重度 | 分类 | 文件 | 行 | 工作量 | 置信度 |
|---|---|---|---|---|---|---|---|
| F1 | 标灰预设的旋转表与实际展示朝向不一致：底色≠D 时「十字/左桥/右桥」标错格子 | high | 正确性 / 数据契约 | src/cube/stickering.ts | 176-226 | M | high |
| F2 | 单步动画实际只占调度间隔的一半（cubing catch-up 500ms vs 项目基准 1000ms） | high | 正确性 / 时序契约 | src/cube/CubePlayer.ts, src/vue/pages/GamePage.vue, src/vue/pages/EditorPage.vue | 184, 194-196, 272-273, 89, 800 | M | high |
| F3 | 播放结束后 HUD 的「暂停」态不释放，再点一次按钮没反应 | medium | 状态 / 交互 | src/game/session.ts | 102-110 | M | high |
| F4 | 隐藏的标灰面板在每个动画帧全量重建 57 个 SVG 面 + 重刷 54 张贴纸材质 | medium | 性能 / 热路径 | src/game/session.ts, src/ui/grayPanel.ts, src/cube/GrayOverlay.ts | 55-73, 261-351, 30-36 | M | high |
| F5 | 打乱中改速度滑条无效（速度与步间隔只在打乱开始时读一次） | medium | 状态 / 交互 | src/vue/pages/GamePage.vue | 185-209 | S | high |
| F6 | render 后端「套公式后播放」会把 54 贴纸态施加两次，颜色与几何不一致 | medium | 正确性（休眠路径） | src/cube/CubePlayer.ts, src/cube/render/RenderCube.ts | 188-231, 300-317 | M | high |
| F7 | render 后端播放中改速：动画瞬移完成或倒退（`dur` 改写而 `t` 不换算） | medium | 正确性（休眠路径） | src/cube/render/RenderCube.ts | 319-322 | S | high |
| F8 | render 后端播放队列是 60ms 轮询：步间空档 + 常驻定时器 + 空闲仍满帧渲染 | medium | 性能 / 调度 | src/cube/CubePlayer.ts, src/cube/render/RenderCubeHost.ts | 122, 126-139, 211-234 | M | high |
| F9 | `CubePlayer.dispose()` 无调用点：离开游戏页/编辑器不释放 cubing 播放器、场景与监听 | medium | 资源泄漏 | src/game/session.ts, src/vue/pages/EditorPage.vue, src/cube/CubePlayer.ts | 166-171, 1506-1522, 287-299 | S | high |
| F10 | 标灰面板注册 window 级 `pointerup` 监听且从不移除，面板也无销毁接口 | low | 资源泄漏 | src/ui/grayPanel.ts | 456-459, 474 | S | high |
| F11 | render 后端静默忽略 `baseFace`：R1 切换默认后端会悄悄废掉六色底 | medium | 休眠路径 / 契约 | src/cube/CubePlayer.ts | 33-34, 108-123 | M | high |
| F12 | 标灰面板小魔方「默认转了 U」：面板忠实画实时态，而默认起始态是公式逆序态 | low | 文档漂移 / 已知缺陷 | src/vue/pages/EditorPage.vue, src/ui/grayPanel.ts | 751-758, 261-272 | M | medium |
| F13 | `RenderCubeHost` 自动自转慢了 1000 倍（参考实现用 ms，这里 dt 是秒） | low | 休眠路径 / 正确性 | src/cube/render/RenderCubeHost.ts | 211-234 | S | high |
| F14 | `GrayOverlay.init()` 无重试：3D 场景未创建时标灰永久静默失效 | low | 健壮性 | src/cube/GrayOverlay.ts | 30-52, 82-94 | S | medium |
| F15 | 套用公式后 `history` 未清：撤销会从「已套用的公式」里删一步，日志与魔方不一致 | low | 状态 / 数据契约 | src/game/session.ts | 83-92, 112-127 | S | high |
| F16 | `pose.ts` 死代码 + 误导性注释（`poseFromState` 名字像反推块位，实则返回恒等姿态） | low | 死代码 / 维护成本 | src/cube/render/pose.ts | 100-103, 134-141 | S | high |
| F17 | 渲染线无回归覆盖：`CubePlayer` render 编排、标灰预设、改速行为均无断言 | low | 测试覆盖 | scripts/verify-render-cube.ts | 1-20 | M | high |
| F18 | 播放层硬编码中文「已恢复上次进度」绕过 i18n（切英文仍显中文） | low | i18n | src/vue/pages/GamePage.vue | 137 | S | high |

### 零发现的子域

- `src/ui/dom.ts`：11 行纯 DOM 工厂，无状态、无监听，正确。
- `src/timeline/Timeline.ts`：纯函数（帧↔秒、关键帧校验/排序/区间、缓动、slerp/nlerp 姿态插值）；上限 `MAX_KEYFRAME_FRAME` 已防超大帧号打爆 DOM；`interpolatePose` 的 `contacts: []` 与注释一致（接触由 contactTracks 承载）。无问题。
- `src/vue/components/PseudoCube3D.vue`：静态 CSS 魔方 + 视差变量消费（`--par-u/--par-v` 由 `useParallax` 注入，契约吻合）；自转是纯 CSS 合成层动画，页面隐藏时浏览器自动暂停。无问题。
- `src/vue/components/SolverOptionsPanel.vue`：配置驱动（选项全部来自 `methodOptions.ts` + i18n key）、多底最少保留一个、重置回归全局底，均与注释一致；仅 `selected = computed(() => props.modelValue)` 属无害冗余（nit，不单列）。

---

## F1. 标灰预设的旋转表与实际展示朝向不一致：底色≠D 时「十字/左桥/右桥」标错格子

- **严重度**：high
- **文件**：`src/cube/stickering.ts:176-226`（调用方：`src/game/session.ts:69`、`src/vue/pages/EditorPage.vue:1360`）
- **证据**：

```ts
/** 每个底色对应的"左"面（其余由右手系推出），使旋转为真旋转 */
const LEFT_FOR_BASE: Record<Face, Face> = {
  D: "L",
  U: "R",
  F: "L",
  B: "R",
  L: "B",
  R: "F",
};
```

```ts
/** 规范朝向（底=D、左=L）→ 目标底色 的旋转矩阵（列主序） */
function rotationForBase(base: Face): number[][] {
  const n = FACE_NORMALS[base];
  const ln = FACE_NORMALS[LEFT_FOR_BASE[base]];
  const fn = cross(ln, n);
  ...
```

```ts
export function presetGrayStickers(preset: GrayPreset, base: Face): StickerId[] {
  const rot = rotationForBase(base);
  const keep = new Set<StickerId>();
  for (const p of CANONICAL_KEEP[preset]) {
    const [x, y, z] = applyRotation(p, rot);
    const id = stickerIdFromWorld(x, y, z);
    if (id) keep.add(id);
  }
  const grayed = allStickerIds().filter((id) => !keep.has(id));
  return grayed;
}
```

而展示用的整块旋转是另一张表（`src/cube/stickering.ts:237-251`）：

```ts
export function baseFaceSetupAlg(base: Face): string {
  switch (base) {
    case "D": return "";
    case "U": return "x2";
    case "F": return "x'";
    case "B": return "x";
    case "R": return "z";
    case "L": return "z'";
  }
}
```

两表互不知情：`LEFT_FOR_BASE` 说「U 当底时左面是 R」，但 setup `x2`（绕 x 轴 180°）保持 L 仍在左；`LEFT_FOR_BASE[B]="R"` 而 setup `x` 也让 L 留在左；`LEFT_FOR_BASE[R]="F"` 而 setup `z` 让 F 留在**前**面（不是左）。灰标 id 是**展示坐标系**的标签（`GrayOverlay` 用贴纸 mesh 的初始世界位置建映射，而 cubing 的 `AnchorTransformationProp` + `setupAnchor:"start"` 保证静止态已施加 setupAlg），因此预设必须按展示系给出，而当前按 `rotationForBase` 多转了一次。

只读探针 `%TEMP%/mc-audit/check-preset3.ts`（对每个底色比较「代码保留集」与「展示系下应当保留的集」）：

```
### cross
  base=U setup=x2     code==(A display-relative)? false overlap=0/9
  base=D setup=(none) code==(A display-relative)? true  overlap=9/9
  base=L setup=z'     code==(A display-relative)? false overlap=2/9
  base=R setup=z      code==(A display-relative)? false overlap=2/9
  base=F setup=x'     code==(A display-relative)? false overlap=2/9
  base=B setup=x      code==(A display-relative)? false overlap=2/9
### roux-left
  base=U setup=x2     ... overlap=0/13
  base=D setup=(none) ... overlap=13/13
  base=L setup=z'     ... overlap=5/13
  base=R setup=z      ... overlap=0/13
  base=F setup=x'     ... overlap=8/13
  base=B setup=x      ... overlap=0/13
```

- **影响**：默认设置 `baseFace:"D"` + `sixColorBase:true` 时是对的；一旦用户在设置里把底色改成 U/L/R/B/F，六色底会把魔方整块转到该底朝下，此时点「初始十字 / 左桥 / 右桥」，灰标落在**错误的一层/错的一侧**（例：底色=U 时「左桥」保留的其实是右边块，命中 0/13）。教学辅助给出相反的指示，且没有任何报错——属于"看起来能用、其实教错了"的静默错误。
- **修复**：预设与展示朝向必须同源。二选一：
  1. 展示系语义（推荐）：魔方永远以「底色朝下」展示，预设就是展示系里的规范图案 ⇒ 去掉 `rotationForBase` 这层旋转（`presetGrayStickers` 变成与 `base` 无关），`LEFT_FOR_BASE`/`rotationForBase` 一并删除；
  2. 若确实要「图案跟随底色 home 面」，则旋转必须与 setup 复合：展示位置 = `S · R · K`（`S = rotMatrix(baseFaceSetupAlg(base))`），当前漏了 `S`。
  无论哪种，都要补一条 6 底 × 3 预设的回归断言（可放 `scripts/verify-render-cube.ts` 或新建 `scripts/verify-gray-presets.ts`），断言「保留集 == 展示系规范图案」。
- **工作量**：M
- **置信度**：high（探针实跑复现；cubing setupAlg 的展示语义已从其源码逐段确认）

---

## F2. 单步动画实际只占调度间隔的一半（cubing catch-up 500ms vs 项目基准 1000ms）

- **严重度**：high
- **文件**：`src/cube/CubePlayer.ts:177-185`、`src/vue/pages/GamePage.vue:194-196` 与 `272-273`、`src/vue/pages/EditorPage.vue:89` 与 `800`
- **证据**：

```ts
  /** 追加一步并立即动画：键盘映射的核心通道 */
  applyMove(move: string): void {
    this._alg = this._alg ? `${this._alg} ${move}` : move;
    if (this.renderCube) {
      const name = move.trim();
      if (MOVES[name]) this.renderCube.playMove(name);
      return;
    }
    this.element!.experimentalAddMove(move, { cancel: true });
  }
```

```ts
  // 打乱动画实时速度 = 1/s（cubing tempoScale）；步间隔 = s/步 × 1000ms（播完再下一步）
  session.player.setSpeed(1 / scrambleSpeed.value);
  const delay = Math.max(60, scrambleSpeed.value * 1000);
```

```ts
const CUBING_MOVE_SECONDS = 1.0;   // EditorPage.vue:89
...
  if (stepSec > 0) player?.setSpeed((CUBING_MOVE_SECONDS / stepSec) * playSpeed.value);
```

cubing 0.63.3 侧：`experimentalAddMove` 并不走时间轴，而是把新步交给 catch-up 通道——

```js
  experimentalAddMove(flexibleMove, options) {   // node_modules/cubing/dist/lib/cubing/twisty/index.js:4006
    ...
        this.timestampRequest.set("end");
        this.catchUpMove.set({ move, amount: 0 });
```

```js
  animFrame(timestamp) {                            // CatchUpHelper.animFrame, 同文件 948-975
    const delta = this.tempoScale * (timestamp - this.lastTimestamp) / this.catchUpMs;
    ...
  }
  catchUpMs = 500;
```

而时间轴（`element.play()` 走的那条路）单步 1000ms：`defaultDurationForAmount(1) → 1e3`。项目把「s/步」基准统一到了 **1000ms@1x**，但项目所有逐步动画（键盘步、打乱、解法演示、编辑器分步播放）走的都是 `experimentalAddMove` ⇒ **catch-up 500ms**。

- **影响**：每一步动画在分配给它的时间片的前 50% 就结束，余下 50% 魔方静止等待下一次 `applyMove`：打乱 20 步实际观感是「快半拍 + 停顿半拍」，解法演示同理；编辑器里更糟——魔方动作在 step 区间的**前半段**就跳完，而后半段手部动画还在继续，魔方与手的时序错开半个区间（用户看到的「顿一下」正是 todo 里记的"停顿补满"类症状之一）。
- **修复**：把项目的单步基准改成 catch-up 的 500ms（`CUBING_MOVE_SECONDS = 0.5`，并同步 `GamePage` 的 `delay = s/步 × 500`），或者不用 `experimentalAddMove` 而是把整段 alg 交给时间轴（`element.alg = ...` + `play()`，此时 1000ms 基准成立、可按步 seek）。二选一后需同步更新 `docs/todo.md` 里"1000ms@1.00s/步"的注释口径。
- **工作量**：M
- **置信度**：high（cubing 源码逐行确认 + 项目侧调用点确认）

---

## F3. 播放结束后 HUD 的「暂停」态不释放，再点一次按钮没反应

- **严重度**：medium
- **文件**：`src/game/session.ts:102-110`（表现层：`src/vue/pages/GamePage.vue:313`）
- **证据**：

```ts
  function togglePlay(): void {
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.play();
      setPlaying(true);
    }
  }
```

`setPlaying` 只在 `togglePlay`/`reset` 里被调用（`session.ts:78-81`），没有任何地方在**动画播完**时把 `playing` 复位。cubing 侧播放结束只改自己的 `playingInfo`（`TwistyAnimationController.animFrame` 里 `this.model.playingInfo.set({playing:false})`），项目没有订阅。

```html
    <WinButton id="btn-play" :Content="playing ? t('hud.pause') : t('hud.play')" @Click="togglePlay" />
```

- **影响**：点「播放」看完一段公式后，按钮仍显示「暂停」；此时再点一次走的是 `player.pause()`（无事发生），用户必须点两次才能重播。空公式时 `player.play()` 什么都不播，但按钮同样卡在「暂停」。快捷键 `toggle-play` 同样表现。
- **修复**：让播放层回传"播完"事件——cubing 0.63 的 `TwistyPlayer.experimentalModel.playingInfo` 可读（`get()`），可在 `CubePlayer` 里加一个 `onPlaybackEnd` 回调（或在 `session` 里用一个 rAF/interval 观察 `playingInfo`），播完即 `setPlaying(false)`；空 alg 时 `play()` 直接不置 `playing=true`。
- **工作量**：M
- **置信度**：high

---

## F4. 隐藏的标灰面板在每个动画帧全量重建 57 个 SVG 面 + 重刷 54 张贴纸材质

- **严重度**：medium
- **文件**：`src/game/session.ts:55-73`、`src/ui/grayPanel.ts:261-351`、`src/cube/GrayOverlay.ts:30-45`
- **证据**：

```ts
  const overlay = new GrayOverlay(player);
  void overlay.init().then(() => overlay.requestApply(grayState.state));
  grayPanelHost.hidden = true;
  let grayPanelApi: ReturnType<typeof renderGrayPanel>;
  overlay.setRenderListener(() => grayPanelApi?.refresh());
  grayPanelApi = renderGrayPanel(grayPanelHost, { ... });
```

```ts
  async init(): Promise<void> {
    // cubing 每次调度渲染时可能重建材质/对象，在回调中重放标灰
    const obj = await this.player.onThreeScene(() => {
      if (!this.ready || this.map.size < 54) this.tryBuildMap();
      if (this.ready && this.lastState) this.doApply(this.lastState);
      this.renderListener?.();
    });
```

cubing 侧：`Twisty3DPuzzleWrapper` 的 `legacyPosition` 每次动画帧变化都会 `scheduleRender()`，而 `scheduleRender()` 派发 `render-scheduled`；`experimentalCurrentThreeJSPuzzleObject(cb)` 正是监听该事件并调用 `cb` ⇒ **每动画帧一次**。

面板每帧的工作量（`grayPanel.ts:261-351`）：54 次 `applyMat`+`viewFaceOf`（≈108 个临时对象）→ 57 个多边形各 4 个角点 + 2 次 `map` + `join` 拼字符串 + 3 次 `setAttribute`（points/fill/opacity）→ 再用

```ts
    for (const poly of svg.querySelectorAll<SVGPolygonElement>("polygon")) {
      const pts = poly.getAttribute("points");
      if (!pts) continue;
      collect2D(pts.split(" ").map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; }));
    }
```

把 57 个多边形的 points 字符串重新 split/parse 一遍来算 viewBox。外加 `GrayOverlay.doApply` 每帧 `new Set(mutable)`+`new Set(immutable)` 并对 54 张贴纸 `setHex`。

- **影响**：游戏页的标灰面板默认 `hidden = true`，却仍然被完整构建（57 个多边形）并且**每帧全量重绘**——播放/打乱/演示时是纯浪费；按上面量级估算≈1000+ 次分配/帧 + ≈120 次 DOM 属性写/帧，主线程抖动风险实在；`GrayOverlay.doApply` 的 80ms 防抖也因为「回调里直接 doApply」而完全失效。
- **修复**：
  1. 面板隐藏时不要注册 renderListener（`togglePanel()` 里挂/摘），或 `refresh()` 开头判 `root.hidden` 直接 return；
  2. `refresh()` 改成增量：只在灰状态变化时更新 `fill`，位置变化时才更新 `points`；
  3. viewBox 用模型数据算（`viewPos` 已有坐标），不要回读 DOM 属性；
  4. `doApply` 缓存 `Set`，别每帧新建。
- **工作量**：M
- **置信度**：high（cubing 事件链逐行确认；面板代码逐行确认）

---

## F5. 打乱中改速度滑条无效（速度与步间隔只在打乱开始时读一次）

- **严重度**：medium
- **文件**：`src/vue/pages/GamePage.vue:185-209`
- **证据**：

```ts
const scrambleCube = async (): Promise<void> => {
  if (!session || demoRunning.value) return;
  cancelDemo();
  const scr = randomScramble(20).join(" ");
  ...
  // 打乱动画实时速度 = 1/s（cubing tempoScale）；步间隔 = s/步 × 1000ms（播完再下一步）
  session.player.setSpeed(1 / scrambleSpeed.value);
  const delay = Math.max(60, scrambleSpeed.value * 1000);
  for (const mv of scr.split(" ")) {
    if (demoToken !== myToken) return;
    session.player.applyMove(mv);
    await new Promise<void>((r) => { sleepResolve = r; setTimeout(() => { ... }, delay); });
  }
  ...
  session.player.setSpeed(1 / speed.value); // 恢复演示滑条速度（防打乱倍速残留）
};
```

`scrambleSpeed` 在整个循环外只读一次；`watch(speed, ...)`（GamePage.vue:164）只监听**演示**滑条，不监听 `scrambleSpeed`。

- **影响**：打乱进行中拖动「打乱速度」滑条毫无反应（这正是 `docs/todo.md:37-38` 记的"打乱中改速无效"遗留项）；用户只能等这一轮打完再改。另外由于 F2（catch-up 500ms），即便速度真的改了，`delay` 也不会跟着变，两条时间线会继续漂移。
- **修复**：把 `setSpeed` 与 `delay` 移进循环，每步重新读 `scrambleSpeed.value`；或打乱期间禁用滑条并给出提示（同时消除"改了却没生效"的错觉）。
- **工作量**：S
- **置信度**：high

---

## F6. render 后端「套公式后播放」会把 54 贴纸态施加两次，颜色与几何不一致

- **严重度**：medium（休眠路径，但正是 R1 目标）
- **文件**：`src/cube/CubePlayer.ts:188-231`、`src/cube/render/RenderCube.ts:300-317`
- **证据**：

```ts
  /** 整段公式替换并直达末态（cubing jumpToEnd 等价；render 后端 = setState 末态） */
  setMoves(moves: string): void {
    this._alg = moves;
    if (this.renderCube) {
      this.stopRenderQueue();
      this.renderCube.setState(applyAlg(solvedState(), moves));
      return;
    }
```

```ts
  /** 播放：render 后端从头连播 _alg 序列（cubing 时间轴从头播放等价） */
  play(): void {
    if (this.renderCube) {
      const seq = this._alg.split(/\s+/).filter(Boolean);
      ...
      this.renderQueue = { seq, i: 0, playing: true };
```

`setState` 把 54 贴纸态直接写成「公式末态」，但**块姿态仍是 solved**；随后 `play()` 从 i=0 重播，每步 `commit()` 又对当前 state 施加该步（`pose.ts:106-114` 的 `state: applyMove(p.state, name)`）⇒ 末态被二次施加。

只读探针 `%TEMP%/mc-audit/check-render.ts` 实跑：

```
(1) after setState(end of 'R U')  state == applyAlg(solved,'R U') ? true
(1) after replaying 'R U'          state == applyAlg(solved,'R U') ? false
    got   : 200200331244115115110225225330330334115444444223055055
    expect: 000000222055111111111223223335335335223444444444055055
```

- **影响**：一旦把默认后端切到 RenderCube（todo「R1 接驳余项」），「套公式 → 播放」会让魔方几何正确、**颜色全错**（每张贴纸被二次置换）。cubing 后端没有这个问题：它的 `play()` 在 `atEnd` 时会 `timestampRequest.set("start")` 回到起点重播（`TwistyAnimationController.play` 的 `autoSkipToOtherEndIfStartingAtBoundary`），render 后端缺这个"先复位到 solved"的语义。
- **修复**：`play()` 前把 render 魔方复位到 solved 姿态（`renderCube.reset()` 或新增 `resetPose()` 只复位块姿态不动贴纸态），再按 seq 连播；`setMoves` 不应把"末态贴纸色"写进播放用状态（要么只更新 `_alg`，要么另存"目标态"供静态展示）。补 `scripts/verify-render-cube.ts` 断言：`setMoves("R U") → play 播完 → state == applyAlg(solved,"R U")`。
- **工作量**：M
- **置信度**：high（探针实跑）

---

## F7. render 后端播放中改速：动画瞬移完成或倒退（`dur` 改写而 `t` 不换算）

- **严重度**：medium（休眠路径）
- **文件**：`src/cube/render/RenderCube.ts:319-322`
- **证据**：

```ts
  setSpeed(speed: number): void {
    this.speed = speed;
    if (this.anim) this.anim.dur = playDur(speed);
  }
```

`anim.t`（已耗时）不变而 `dur` 被改写 ⇒ 进度 `x = t/dur` 突变：调快 → `x>1` 立即完成（瞬移）；调慢 → `x` 回退（视觉倒退）。探针实跑：

```
(2) speed 1->4 mid-move: ... isAnimating after step: false (t=150ms vs new dur=75ms => snapped to end?)
(3) speed 1->0.25 mid-move: quat [0,0,0,1]  (x=200/900=0.22 => angle rewinds)
```

- **影响**：todo 里"速度滑条统一 + 高可中断队列重构（含遗留：播放中改速「停顿补满」）"这条遗留，在 render 轨会以更糟的形式复现——魔方会**跳变/倒退**，而不是平滑变速；这正是"高可中断队列"要解决的核心诉求之一。
- **修复**：改速时按比例换算进度：`const p = a.t / a.dur; a.dur = playDur(speed); a.t = p * a.dur;`（或存 `progress` 而非 `t`）。同时把"变速时的视觉连续性"写进 `scripts/verify-render-cube.ts` 断言。
- **工作量**：S
- **置信度**：high（探针实跑）

---

## F8. render 后端播放队列是 60ms 轮询：步间空档 + 常驻定时器 + 空闲仍满帧渲染

- **严重度**：medium（休眠路径）
- **文件**：`src/cube/CubePlayer.ts:122` 与 `126-139`、`src/cube/render/RenderCubeHost.ts:211-234`
- **证据**：

```ts
    this.renderHost = host;
    this.renderPollId = window.setInterval(() => this.renderPoll(), 60);
```

```ts
  /** render 后端播放队列驱动：空闲时播下一条；播完或暂停后清队列 */
  private renderPoll(): void {
    const rc = this.renderCube;
    const q = this.renderQueue;
    if (!rc || !q) return;
    if (!q.playing) { if (!rc.isAnimating) this.renderQueue = null; return; }
    if (!rc.isAnimating && q.i < q.seq.length) {
      const name = q.seq[q.i++];
      if (MOVES[name]) rc.playMove(name);
    }
    if (q.i >= q.seq.length && !rc.isAnimating) this.renderQueue = null;
  }
```

下一步要等"上一次动画结束 **且** 下一次轮询命中" ⇒ 每步最多 60ms 空档（1x 时单步 300ms ⇒ 最多 20% 空转）；`setInterval` 常驻（除 `dispose()` 外不清）；宿主则是**无条件每帧渲染**：

```ts
      this.renderCube.step(dt);
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
```

- **影响**：render 轨一旦启用：连播一顿一顿；空闲时仍以 60fps 全量渲染整个 three 场景（GPU/CPU 常驻占用，笔记本续航与风扇受影响）；这与 cubing 后端"按需渲染"的行为不一致，也是 todo「高可中断队列重构」要一并解决的。
- **修复**：把队列调度搬进宿主 rAF（`RenderCubeHost` 已在每帧 `step(dt)`）：在 `RenderCube.commit()` 里回调"本步完成"，宿主同帧启动下一步 ⇒ 零空档、可中断；渲染改为"有动画/有交互才渲染"的按需策略（脏标记）。
- **工作量**：M
- **置信度**：high

---

## F9. `CubePlayer.dispose()` 无调用点：离开游戏页/编辑器不释放 cubing 播放器、场景与监听

- **严重度**：medium
- **文件**：`src/game/session.ts:166-171`、`src/vue/pages/EditorPage.vue:1506-1522`、`src/cube/CubePlayer.ts:287-299`
- **证据**：

```ts
    dispose: () => {
      overlay.dispose();
      keymap.detach();
      delete window.__motionCube;
    },
```

```ts
onBeforeUnmount(() => {
  ...
  grayOverlay?.dispose();
  grayOverlay = null;
  player = null;          // 直接置空，没有 player.dispose()
  ...
});
```

```ts
  /** 释放后端资源（render 后端卸载宿主与轮询；cubing 后端移除元素） */
  dispose(): void {
    if (this.renderHost) { ... return; }
    this.clearRenderRetries();
    this.element?.remove();
  }
```

全仓检索 `player?.dispose|player.dispose` 无任何调用点 ⇒ `CubePlayer.dispose()` 是死代码。

- **影响**：每次进出游戏页/编辑器，cubing 的 `TwistyPlayer`（含其 scene、model、`render-scheduled` 监听、canvas/WebGL 上下文）与 `GrayOverlay`/`HandRigView` 注册在 puzzle wrapper 上的回调都留在内存里；`GrayOverlay.dispose()` 只清了定时器，**回调仍在 cubing 侧被调用**，于是卸载后仍会继续 `doApply()`（克隆材质 + 写颜色）。多次进出后残留对象线性增长。
- **修复**：`session.dispose()` 与编辑器 `onBeforeUnmount` 都要调 `player.dispose()`；`CubePlayer` 维护自己注册的回调列表并在 `dispose()` 里清空；`GrayOverlay.dispose()` 需解除 cubing 回调（或由 `CubePlayer` 统一持有并销毁）。
- **工作量**：S
- **置信度**：high

---

## F10. 标灰面板注册 window 级 `pointerup` 监听且从不移除，面板也无销毁接口

- **严重度**：low
- **文件**：`src/ui/grayPanel.ts:456-459`、`src/ui/grayPanel.ts:474`
- **证据**：

```ts
  svg.addEventListener("pointerup", endGesture);
  svg.addEventListener("pointercancel", endGesture);
  window.addEventListener("pointerup", endGesture);
  svg.addEventListener("pointerleave", endGesture);
```

```ts
  root.append(title, presets, svg, note);
  refresh();
  return { refresh };
```

- **影响**：每开一次游戏页/编辑器就多一个常驻 window 监听（持有整棵 SVG 与闭包）；`renderGrayPanel` 只返回 `{refresh}`，没有销毁入口，调用方也无法回收。
- **修复**：`renderGrayPanel` 返回 `{ refresh, dispose }`，`dispose()` 里 `removeEventListener` 并清空 `root.innerHTML`；调用方（session / EditorPage）在卸载时调用。
- **工作量**：S
- **置信度**：high

---

## F11. render 后端静默忽略 `baseFace`：R1 切换默认后端会悄悄废掉六色底

- **严重度**：medium（休眠路径，但属"切默认后端"的前置阻塞）
- **文件**：`src/cube/CubePlayer.ts:33-34`、`src/cube/CubePlayer.ts:108-123`
- **证据**：

```ts
  /** 全局底色：游戏起始时旋转魔方使底色面朝下（cubing 后端经 setupAlg；render 后端暂忽略） */
  baseFace?: Face;
```

```ts
  private initRenderBackend(container: HTMLElement, options: CubePlayerOptions): void {
    const rc = new RenderCube({
      speed: 1,
      onStateChange: (s) => options.onStateChange?.(s),
    });
```

游戏侧是**有**传底色的：`src/game/session.ts:49` `new CubePlayer(stage, { cameraDistance: 6.5, baseFace: activeBase })`。

- **影响**：切到 render 后端后，六色底设置静默失效（魔方不再把所选底色转到底），而 UI 上设置项还在、看不出任何异常——属于"配置生效但无提示"的契约破坏；`baseFaceSetupAlg` 已有的正确映射（含 2026-08-22 的方向实证）可以复用。
- **修复**：render 后端实现 base 语义（对块姿态施加 `baseFaceSetupAlg(base)` 的整块旋转），或在切换默认后端前把该项列为前置任务并在 UI 上禁用该设置。
- **工作量**：M
- **置信度**：high

---

## F12. 标灰面板小魔方「默认转了 U」：面板忠实画实时态，而默认起始态是公式逆序态

- **严重度**：low（`docs/todo.md:26` 已登记、尚未修）
- **文件**：`src/vue/pages/EditorPage.vue:751-758`、`src/ui/grayPanel.ts:261-272`
- **证据**（todo 原文）：

```
- ⬜ **自定义开始态批**（下一轮开工项）：标灰页小魔方默认转动了 U 的 bug +
```

```ts
/** 正放起始态：优先自定义 startState，缺省 = 公式逆序状态（打乱态 S） */
function setStartState(): void {
  if (!player) return;
  player.setMoves(
    tech.value?.startState ??
      (formulaMoves.length ? invertMoves(formulaMoves.join(" ")) : ""),
  );
}
```

```ts
    const positions = opts.getPositions();
    // 视图位置：viewRot × 实时位置（未就绪时退回初始位置）
    const viewPos = new Map<StickerId, { v: V3; face: Face }>();
    for (const id of cells.keys()) {
      const live = positions.get(id);
      const p = live ?? stickerWorldPos(id);
```

- **影响**：编辑器默认把魔方置于「公式逆序态」（打乱态），标灰面板的小魔方忠实反映该实时姿态 ⇒ 用户看到的是一个转过的魔方（典型公式逆序态看起来就像"转了 U"），而预设（`CANONICAL_KEEP`）是按**还原态**规范朝向定义的 ⇒ 预设图案与小魔方朝向对不上，用户读不出预设含义。该 bug 与 todo 里"正放/倒放起始态统一 + 自定义开始状态 UI"是同一件事，尚未落地。
- **修复**：给面板加"规范朝向"开关（忽略实时旋转、按 `stickerWorldPos(id)` 画），或让预设随起始态一起定义；与 todo 的"起始态统一"批次一起做。
- **工作量**：M
- **置信度**：medium（"面板=实时态、预设=还原态定义"这一机制已确认；具体转了多少度取决于用户公式，故按 medium 记）

---

## F13. `RenderCubeHost` 自动自转慢了 1000 倍（参考实现用 ms，这里 dt 是秒）

- **严重度**：low（休眠路径）
- **文件**：`src/cube/render/RenderCubeHost.ts:211-234`
- **证据**：

```ts
    const loop = () => {
      if (this.disposed) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastT) / 1000);
      this.lastT = now;
      if (this.autoSpin) {
        if (!this.drag && !this.renderCube.isAnimating) {
          this.idle += dt * 1000;
          if (this.idle > 2600) {
            this.yaw += dt * 0.000085;
```

文件头注释写明参考语义是 `autoSpin idle>2600 → yaw += dt*0.000085`（**dt 以 ms 计**）。此处 `idle` 用了 `dt * 1000`（换算成 ms ✓），但 `yaw` 直接用了秒制 `dt` ⇒ 自转速率是参考实现的 1/1000（整圈约 20 小时，肉眼不可见）。`RenderDemoPage` 的「自转:ON」按钮因此看起来毫无作用。

- **影响**：dormant 路径的自转功能实际失效；R1 复用该宿主时同样失效。
- **修复**：把常量改成 rad/s（如 `this.yaw += dt * 0.085`）或显式 `dt * 1000 * 0.000085`，并在注释里标明单位。
- **工作量**：S
- **置信度**：high

---

## F14. `GrayOverlay.init()` 无重试：3D 场景未创建时标灰永久静默失效

- **严重度**：low
- **文件**：`src/cube/GrayOverlay.ts:30-52`、`src/cube/GrayOverlay.ts:82-94`
- **证据**：

```ts
  async init(): Promise<void> {
    // cubing 每次调度渲染时可能重建材质/对象，在回调中重放标灰
    const obj = await this.player.onThreeScene(() => { ... });
    this.obj = obj;
    this.tryBuildMap();
    this.ready = true;
    if (this.pending) { this.doApply(this.pending); this.pending = null; void this.requestRender(); }
  }

  /** 初始窗口内重试构建映射，直到 54 个小面全部定位（对象变换就绪前可能不完整） */
  private tryBuildMap(): void {
    if (this.map.size >= 54 || !this.obj) return;
    this.map.clear();
    this.buildMap(this.obj);
  }
```

注释说"初始窗口内重试构建映射"，但代码里**没有任何重试**：`tryBuildMap` 只在 init 与场景重建回调里被调用；`requestApply` 在 `!this.ready` 时只把状态存进 `pending` 并 return：

```ts
  requestApply(state: GrayState): void {
    this.pending = state;
    if (!this.ready) return;
```

cubing 的 `experimentalCurrentThreeJSPuzzleObject` 官方注释明确写着"may never resolve if the player never creates the relevant 3D object"（编辑器的 3D 视图是折叠/懒初始化场景）。

- **影响**：编辑器里若 3D 视图在挂载时处于折叠/未初始化状态，`overlay.init()` 的 promise 长期不 resolve ⇒ `ready` 永远 false ⇒ 3D 标灰不生效、面板拿不到实时位置（退回规范静态位置，小魔方不再跟随魔方）。用户在打开面板前不会看到任何提示。
- **修复**：仿照 `CubePlayer.setMoves` 的"延迟重绘"做法加一组重试定时器（500/2000/5000ms）驱动 `tryBuildMap()`/重取 `onThreeScene`；或在 `toggleGrayPanel()` 里按需重新 `init()`。
- **工作量**：S
- **置信度**：medium（cubing 侧"可能永不 resolve"是其官方注释所述；本项目编辑器确为懒初始化场景）

---

## F15. 套用公式后 `history` 未清：撤销会从「已套用的公式」里删一步，日志与魔方不一致

- **严重度**：low
- **文件**：`src/game/session.ts:83-92`、`src/game/session.ts:112-127`
- **证据**：

```ts
  function undo(): void {
    if (history.length === 0) { hooks.onStatus(t("hud.statusNoUndo")); return; }
    history.pop();
    hooks.onUndo();
    player.undoLastMove();
    hooks.onStatus(history.length ? t("hud.statusUndo") : t("hud.statusCleared"));
  }
```

```ts
  function applyAlg(input: string): string | null {
    ...
    player.setMoves(parsed.normalized);
    hooks.onReset();          // 只清了 HUD 日志，没清本函数外层的 history
    hooks.onStatus(t("hud.statusApplied"));
    return parsed.normalized;
  }
```

`reset()` 会 `history.length = 0`，但 `applyAlg()` 不会。

- **影响**：先按几个键（history=[a,b,c]）→ 套用公式（日志被清、魔方跳到公式末态、history 仍是 [a,b,c]）→ 按「撤销」：`history.pop()` 弹掉 c（但 c 早就不在魔方上了），而 `player.undoLastMove()` 执行的是 `element.experimentalRemoveFinalChild()`——删掉的是**刚套用的公式的最后一步**。魔方状态与 HUD 日志、提示语三者互相对不上。
- **修复**：`applyAlg()` 里补 `history.length = 0`（与 `reset()` 一致）；或把 history 的所有权收敛到播放层，让 `setMoves` 一并清空。
- **工作量**：S
- **置信度**：high

---

## F16. `pose.ts` 死代码 + 误导性注释

- **严重度**：low
- **文件**：`src/cube/render/pose.ts:100-103`、`src/cube/render/pose.ts:134-141`
- **证据**：

```ts
/**
 * 求解器态（54 贴纸）→ 块姿态（颜色落到 home 槽位）。用于外部 setState 同步：
 * 每块贴纸颜色 = state[stickerIndex(home 当前像)]；仅当整数姿态可逆。
 * 注意：此映射是「从颜色反推块位置」，仅当 state 合法（isUniform 层次）时准确。
 */
export function poseFromState(state: State): PoseState {
  const pieces = CUBIES.map((c) => ({ pos: c.pos.slice() as Vec3, rot: IDENT3.map((v) => v.slice() as Vec3) }));
  return { pieces, state: state.slice() as State };
}
```

注释声称"从颜色反推块位置"，实现却原样返回 solved 块姿态 + 传入 state（根本没反推）。全仓检索：`poseFromState` 与 `STICKER_WORLD` 只有定义、无任何引用；`applyAlgPose` 仅被 `scripts/verify-render-cube.ts` 使用。

- **影响**：休眠路径里的"看起来能用其实不能"的工具函数，未来若被 R1 接线用到会直接产出错误姿态；也是维护噪音。
- **修复**：删除 `poseFromState` 与 `STICKER_WORLD`（或真正实现"由颜色反推块位"并补测试）。
- **工作量**：S
- **置信度**：high

---

## F17. 渲染线无回归覆盖：`CubePlayer` render 编排、标灰预设、改速行为均无断言

- **严重度**：low
- **文件**：`scripts/verify-render-cube.ts:1-20`（覆盖清单）、被覆盖缺口对应 F1/F6/F7/F8
- **证据**：脚本头部自述覆盖 A–L 共 22 条断言，全部是 `RenderCube` 的**单类**行为（旋转矩阵等价、pose↔state 对偶、中断、undo、setState 重涂、拖转），**不涉及**：

```ts
// scripts/verify-render-cube.ts（节选）
import { applyAlg, CUBIES, MOVE_NAMES, MOVES, rot, solvedState, stickerIndex } from "../src/cube/solver/engine.ts";
import { applyAlgPose, axisAngleMat, m3Apply, quarterMat, type PoseState } from "../src/cube/render/pose.ts";
import { FACE_COLORS, RenderCube } from "../src/cube/render/RenderCube.ts";
```

即：`CubePlayer` 的 render 后端编排（`setMoves`→`play`→`pause`→`setSpeed` 的组合语义）没有任何测试——F6/F7/F8 全部落在这个空白区；标灰预设与底色适配（F1）也完全没有断言；`RenderCubeHost` 的拖转/相机/自转（F13）同样零覆盖。

- **影响**：R1 计划要把 `CubePlayer` 默认后端切到 RenderCube，而最可能出错的"编排层"恰好没有测试网；已验证存在的 F6/F7 就是这套测试本该拦住的。
- **修复**：在 `scripts/verify-render-cube.ts` 补 render 编排断言（`setMoves+play` 末态正确、改速不跳变、暂停语义、队列步间无空档），并新增标灰预设 × 6 底色的断言（F1）；一并接进 CI（CI 目前只跑 4 条 node 校验）。
- **工作量**：M
- **置信度**：high

---

## F18. 播放层硬编码中文「已恢复上次进度」绕过 i18n

- **严重度**：low
- **文件**：`src/vue/pages/GamePage.vue:137`
- **证据**：

```ts
    status.value = "已恢复上次进度";
```

同文件其余状态文案均走 `t(...)`（如 `t("hud.statusApplied")`、`t("solve.fail", {...})`）；此处是裸中文字面量。

- **影响**：切到英文界面后，快照恢复提示仍是中文（状态栏混排语言）。
- **修复**：新增 i18n key（如 `hud.statusRestored`）并替换；en/zh 两份 locale 同步（项目已有 `scripts/probe-locale-keys.ts` 可查缺项）。
- **工作量**：S
- **置信度**：high

---

## 备注（与其它 area 报告重叠，非本 area 独占）

- `src/vue/pages/GamePage.vue:354` 在模板里调用 `loadSettings().baseFace`：每次重渲染都会读一次 localStorage 并 `JSON.parse`。该文件属 pages area（其报告 #19 已记），本 area 只标注它与渲染层（`SolverOptionsPanel` 的 `globalBase` 入参）耦合，故不重复计分。
- `docs/todo.md:33-38` 记录的"R1 半替换 / 速度滑条统一 + 高可中断队列重构"与本报告 F6/F7/F8/F11/F13 一一对应：休眠路径不是"暂时没接线"，而是**接线即错**（F6 会算错颜色、F11 会废掉六色底）；建议在切换默认后端前先补 F6/F7/F8 + F17 的测试网。
