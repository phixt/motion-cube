# 审计报告 · AREA = editor（动画编辑器）

> 审计日期：2026-10-27　只读审计（除本文件外未创建/修改/删除仓库任何文件）
> 审计范围：`src/vue/pages/EditorPage.vue`（2536 行）、`src/timeline/Timeline.ts`、
> `src/data/technique.ts`、`src/data/snapshot.ts`、`src/notation/alg.ts`、
> `src/input/keymap.ts`、`src/input/pointer.ts`
> 连带只读检查（为定位契约）：`src/data/libraryStore.ts`、`src/cube/CubePlayer.ts`、
> `src/hand/{HandRig,HandRigView,handApi}.ts`、`src/ui/grayPanel.ts`、
> `scripts/{verify-data.ts,playtest-ui.mjs}`、`.github/workflows/ci.yml`、
> `docs/{todo.md,hand-api-spec.md}`、`src/i18n/locales/*`
> 排除：`node_modules/`、`dist/`、`src-tauri/target/`、`spike-shots/`、`reference/`、
> `.reasonix/`、`src/vendor/winui-on-web`（第三方，仅在需要取证时只读引用）

---

## 概览

编辑器是本项目唯一同时承担「数据编辑 + 3D 渲染驱动 + 播放时序」的页面，本次审计的
问题集中在三处：

1. **数据契约的写入侧没有校验闸门**。关键帧/步进映射的「重映射」路径（改帧率、改步长、
   插空拍）绕过了 `validateTechnique`，可以写入重复帧号的关键帧；这种手法一旦被保存，
   下次启动时 `loadLibrary()` 的 `catch` 会把**整个库**降级成空库（数据丢失）。
2. **`selectedFrame` 与 `previewFrame` 双真相**。面板显示的是播放头（`previewFrame`），
   但「缓动」「插入中间帧」改的是「选中帧」（`selectedFrame`）——两个来源不一致时，
   用户改的是另一个对象，或者操作静默失效。
3. **主位手规则只在「显隐 / 喂轨 / 面板」三处落实**，在「双手态允许切左手为主位」、
   「切换双手开关时覆盖用户显式选择」「外部注入 API 固定以左手为主手」三处越界。

共 15 条发现：3 × high、9 × medium、3 × low。

### 发现汇总

| # | 标题 | 严重度 | 分类 | 文件 | 行 | 工作量 | 置信度 |
|---|---|---|---|---|---|---|---|
| 1 | 帧重映射绕过校验 → 写入重复帧关键帧 → 手法编辑全废；保存后重启整库被清空 | high | correctness / data loss | src/vue/pages/EditorPage.vue | 491-508, 832-842, 1103-1135, 1196-1216, 1227-1238 | M | high |
| 2 | `stepMapping`/`contactTracks` 帧号无上限 → 导入一份 JSON 即可让标签页生成上亿 DOM 刻度 | high | validation gap / DoS | src/data/technique.ts | 68-86, 266-308 | S | high |
| 3 | 播放中改姿态/时长只重置 `stepMoveIndex`、不重置 `moveCursor` → 魔方执行错位动作 | high | correctness / state contract | src/vue/pages/EditorPage.vue | 815-842 | S | high |
| 4 | `selectedFrame` 与 `previewFrame` 双真相：改缓动/插中间帧作用在错误对象或静默失效 | medium | correctness / state contract | src/vue/pages/EditorPage.vue | 588-590, 661-670, 882-887, 1270-1297 | M | high |
| 5 | 复杂记法（交换子/共轭/宽层）未展开 → 播放时 `applyMove` 抛异常；`splitCompoundMove` 丢 `w` | medium | correctness | src/vue/pages/EditorPage.vue | 777-791 | M | high |
| 6 | 主位手规则三处越界：双手态允许左手主位、双手开关覆盖用户选择、API 主手固定为左手 | medium | contract violation / doc drift | src/vue/pages/EditorPage.vue | 129-132, 330-341, 1536-1546 | M | high |
| 7 | 外部注入 API 与编辑器双轨契约冲突（镜像 vs 独立双轨）+ `hand-api-spec.md` 与实现不符 | medium | doc drift / ownership | src/vue/pages/EditorPage.vue, src/hand/handApi.ts, docs/hand-api-spec.md | 1405-1406 | M | high |
| 8 | 时间线打开编辑面板时不刷新数值 → 面板显示的是上一次打开时的旧姿态 | medium | correctness / UX | src/vue/pages/EditorPage.vue | 215-227, 661-696 | S | high |
| 9 | 无「未保存」状态：切手法/切页静默丢弃编辑；库页保存可覆盖编辑器未保存内容 | medium | data loss / UX | src/vue/pages/EditorPage.vue | 731-749, 832-842, 1227-1238 | M | high |
| 10 | 卸载不释放 `CubePlayer`（`dispose()` 从未调用）、灰面板无销毁、遮罩定时器不清 | medium | resource leak | src/vue/pages/EditorPage.vue | 1506-1522 | S | high |
| 11 | 播放热路径每帧 18 次 `document.getElementById` + 多次姿态插值/四元数分配 | medium | perf / GC | src/vue/pages/EditorPage.vue | 661-710 | M | high |
| 12 | 2536 行单文件的四处重复实现（3 套帧重映射 / 4 个姿态输入 / 2 套面板回写）+ 660 行内联 CSS | medium | maintainability | src/vue/pages/EditorPage.vue | 491-508, 898-1021, 620-710, 1877-2536 | L | high |
| 13 | 自动路径/正弦路径 O(n² log n)：长手法上一次点击可卡数秒 | low | perf | src/vue/pages/EditorPage.vue | 1241-1267, 1300-1342 | M | high |
| 14 | 死代码与文案漂移：`pointer.ts` 整个文件未引用、10 个旧镜像模型 i18n key、快捷键提示过期 | low | dead code / doc drift | src/input/pointer.ts, src/i18n/locales/* | 1-6, 305-308, 344 | S | high |
| 15 | 危险编辑路径零回归覆盖：playtest 不测帧率/缓动/主位手/镜像/空拍，CI 不跑 playtest | low | test coverage | scripts/playtest-ui.mjs, .github/workflows/ci.yml | 327-458 | M | high |

### 与其它审计报告的交叉引用（避免重复计分）

- 手部 API 被编辑器每帧抢写：已在 `docs/audit/hand.md` **F2** 记录（high）。本报告
  **#7** 只从编辑器侧补充「主位手归属 + 规格漂移」这一层。
- `HandRigView` 无 `dispose()`、接触点标记球每帧重建：已在 `docs/audit/hand.md`
  **F3 / F11** 记录。本报告 **#10** 只补「编辑器卸载时未调用 `player.dispose()`」与
  「灰面板无销毁接口」（后者与 `docs/audit/render.md` **F10** 呼应）。
- 标灰面板 window 级 `pointerup` 泄漏：`docs/audit/render.md` **F10** 已记录，本报告不重复。

---

## 验证记录（只读，未改动仓库任何文件）

在 **OS 临时目录**（`%TEMP%\audit-editor-verify*.mts`）跑只读脚本，用仓库自身的
`tsx` 运行，未在仓库内落任何文件：

```
$ ./node_modules/.bin/tsx %TEMP%/audit-editor-verify.mts
A0 base frames: 1,2
A1 rescaled frames: 1,1                       ← 60fps→30fps 把帧 1、2 压成同一帧
A2 validateKeyframes(scaled) = 关键帧未按帧号升序（重复或倒序：1）
A3 validateTechnique(scaled) threw: 关键帧未按帧号升序（重复或倒序：1）
A4 upsertKeyframe threw: 关键帧未按帧号升序（重复或倒序：1）   ← 该手法此后无法编辑
C pose only: ok left.x=-1.95 right.x=1.95
C pose+mirror: ok left.x=-1.95 right.x=1.95
C pose+mirror:null: threw 关键帧姿态非法：pose 必须为对象
C left-only: threw 关键帧 0 需同时包含 left 与 right
C pose+left+right: accepted, left.x= -1.95 right.x= 1.95
```

```
$ ./node_modules/.bin/tsx %TEMP%/audit-editor-verify3.mts
NORM "[R, U]" -> "[R, U]"  expand="R U R' U'"      ← expandMoves 存在但编辑器不用
TOKEN "[R,": THROWS internal parsing error
TOKEN "U]": THROWS parsing unexpectedly ended early
FM "[R, U]"
   flat=["[R,","U]"]
   invalid tokens=["[R,","U]"]                      ← 会被原样喂给 player.applyMove
FM "(R' U R' U') (R D' R' D) R' UD' (R2 U' R2' D R2)"  → flat 全部合法
```

```
$ ./node_modules/.bin/tsx %TEMP%/audit-editor-verify4.mts
MOVE "R" -> ok      MOVE "Rw" -> ok      MOVE "r" -> ok      MOVE "x" -> ok
MOVE "[R," -> THROWS internal parsing error                ← cubing 侧确实抛
```

```
$ ./node_modules/.bin/tsx %TEMP%/audit-editor-verify5.mts
1) deserializeTechnique(dup frames): throws -> 关键帧未按帧号升序（重复或倒序：1）
2) deserializeLibraryData: throws -> 关键帧未按帧号升序（重复或倒序：1）
   => loadLibrary() catch => returns EMPTY_LIBRARY (whole library invisible)
3) stepMapping endFrame=1e8 ACCEPTED; totalFrames would be 100000000
   MAX_KEYFRAME_FRAME = 36000 -> keyframe cap does NOT cover stepMapping
4) frameRate=1e9 ACCEPTED; minTimelineFrames = 10000000 -> rulerTicks loops that many times
```

另外：`git show 1f36cce^:src/vue/pages/EditorPage.vue` 确认**旧**编辑器的默认手型是
`"right"`（`defaultHandPose((handTypeSelectEl.value?.value as HandType) ?? "right")`），
与现行迁移规则「旧 `pose` 视为右手」一致——迁移方向本身是对的（见 #6 的边界说明）。
`npx tsx scripts/verify-data.ts` 全绿（现有覆盖见 #15）。

---

# 1. 帧重映射绕过校验 → 写入重复帧关键帧 → 手法编辑全废；保存后重启整库被清空

**严重度**：high　**分类**：correctness / data loss　**文件**：
`src/vue/pages/EditorPage.vue:491-508`（`rescaleFrames`）、`832-842`（`commit`）、
`1103-1135`（`rebuildWithDurations`）、`1196-1216`（`insertPauseAfter`）、
`1227-1238`（`onSave`）；`src/data/technique.ts:117-124`（`upsertKeyframe` 会校验）；
`src/data/libraryStore.ts:17-25`（`loadLibrary` 的 catch → `EMPTY_LIBRARY`）
**工作量**：M　**置信度**：high

## 证据（逐字）

`src/vue/pages/EditorPage.vue:491-508`（改帧率的重映射，**全程不调用任何校验**）
```
function rescaleFrames(t2: Technique, oldFr: number, newFr: number): Technique {
  const remap = (frame: number): number => Math.round((frame / oldFr) * newFr);
  return {
    ...t2,
    frameRate: newFr,
    keyframes: t2.keyframes.map((k) => ({ ...k, frame: remap(k.frame) })),
    stepMapping: t2.stepMapping.map((m) => ({
      ...m,
      startFrame: remap(m.startFrame),
      endFrame: remap(m.endFrame),
    })),
    contactTracks: t2.contactTracks.map((c) => ({
      ...c,
      startFrame: remap(c.startFrame),
      endFrame: remap(c.endFrame),
    })),
  };
}
```

`src/vue/pages/EditorPage.vue:832-842`（`commit` 直接把未校验的结果写进状态）
```
function commit(fn: (t2: Technique) => Technique, keepInputs = false): void {
  if (!tech.value) return;
  try {
    tech.value = fn(tech.value);
    stepMoveIndex = 0;
    computeFormulaMoves();
    renderAll(keepInputs);
  } catch (e) {
    statusText.value = t("editor.kfFail", { error: e instanceof Error ? e.message : String(e) });
  }
}
```
`upsertKeyframe` 是**有**校验的（`src/data/technique.ts:117-124`）：
```
export function upsertKeyframe(t: Technique, keyframe: TechniqueKeyframe): Technique {
  const others = t.keyframes.filter((k) => k.frame !== keyframe.frame);
  const keyframes = sortKeyframes([...others, keyframe]);
  const next: Technique = { ...t, keyframes };
  validateTechnique(next);
  return next;
}
```
`src/data/libraryStore.ts:17-25`（**一条坏手法 → 整库降级为空库**）
```
export function loadLibrary(): LibraryData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY_LIBRARY;
    return deserializeLibraryData(raw);
  } catch {
    return EMPTY_LIBRARY;
  }
}
```
`src/vue/pages/EditorPage.vue:1227-1238`（保存也不校验）
```
const onSave = (): void => {
  if (!tech.value) return;
  try {
    lib.value = upsertTechniqueInLib(lib.value, tech.value);
    saveLibrary(lib.value);
    statusText.value = t("editor.saved");
    saveFailed.value = false;
  } catch (e) { ... }
};
```

## 影响

`rescaleFrames` 用 `Math.round(frame / oldFr * newFr)` 重映射帧号，**两个相距 1 帧的
关键帧在降帧率时会塌成同一帧**（实测 60→30：帧 1、2 → 1、1；帧 3、4 → 2、2）。
由于 `rescaleFrames` / `rebuildWithDurations` / `insertPauseAfter` 都不调用
`validateTechnique`，`commit` 会**静默接受**这个非法状态（`commit` 只在抛异常时回滚，
而这里不抛）——用户看不到任何报错。

此后：

1. 该手法的**任何**关键帧写入都走 `upsertKeyframe` → `validateTechnique` → 抛
   `关键帧未按帧号升序（重复或倒序：N）`。用户每改一个数值都只看到状态栏一行红字，
   **整个手法彻底无法编辑**（实测 A4）。
2. `onSave` 不做校验 → 非法手法被写进 localStorage。
3. 下次启动 `loadLibrary()` → `deserializeLibraryData` → `deserializeTechnique` 抛错 →
   被 `catch` 吞掉 → 返回 `EMPTY_LIBRARY`：**公式库与手法库一起变成空的**（实测 #2）。
   用户此时若在库页「新建公式」或编辑器「新建手法」，`saveLibrary` 会用这个空库
   **覆盖 localStorage**，原始数据不可恢复。

`rebuildWithDurations`（改单步时长）与 `insertPauseAfter`（插空拍）用的是同一类
「按步内比例重映射」，步骤被压缩时同样会塌帧，属于同一缺陷家族。

## 修复

1. **在重映射出口统一加校验**：`rescaleFrames` / `rebuildWithDurations` /
   `insertPauseAfter` 的返回值统一走 `validateTechnique(next)`；或更省事——让
   `commit()` 在赋值前统一校验：
   ```ts
   function commit(fn: (t2: Technique) => Technique, keepInputs = false): void {
     if (!tech.value) return;
     try {
       const next = fn(tech.value);
       validateTechnique(next);        // ← 唯一的写入闸门
       tech.value = next;
       ...
   ```
   校验失败时状态栏提示「重映射后关键帧帧号冲突，未应用」并保持原状态。
2. **重映射后去重**：对重映射后的关键帧按新帧号聚合（同帧保留最后一条），
   再排序，避免「拒绝」变成「用户数据丢失」的挫败感。
3. **帧号上限**：`rescaleFrames` 可能把帧号放大到 `MAX_KEYFRAME_FRAME` 之外
   （60fps 第 3000 帧 → 1000fps 第 50000 帧 > 36000），同样会被 `validateKeyframes`
   拒绝；要么钳位、要么在换帧率时提示。
4. **`onSave` 也要校验**：`upsertTechniqueInLib` 前调用 `validateTechnique(tech.value)`，
   非法状态不允许落盘。
5. **兜底**：`loadLibrary()` 的 `catch` 不应静默返回空库——至少要保留原始 raw 文本
   （如 `localStorage["motion-cube.library.broken"]`）并在 UI 上提示「库数据损坏」，
   而不是让用户在一个空库里继续操作并覆盖原数据。

## 工作量：M（~1 天）　置信度：high

---

# 2. `stepMapping`/`contactTracks` 帧号无上限 → 导入一份 JSON 即可让标签页生成上亿 DOM 刻度

**严重度**：high　**分类**：validation gap / DoS　**文件**：`src/data/technique.ts:68-86`
（`validateTechnique`）、`266-284`（`parseStepMapping`）、`287-308`（`parseContactTracks`）；
`src/timeline/Timeline.ts:9-13`（上限常量与其注释）；`src/vue/pages/EditorPage.vue:427-459`
（`totalFrames`/`rulerTicks`/`beatTicks`）　**工作量**：S　**置信度**：high

## 证据（逐字）

`src/timeline/Timeline.ts:9-13`（**代码注释明确承诺要防这一类**）
```
/**
 * 关键帧帧号上限（60fps 基准下 10 分钟）：时间线/预览表按帧生成 DOM 与采样行，
 * 无上限时误输入或恶意导入超大帧号（如 1e8）会导致页面渲染卡死。
 */
export const MAX_KEYFRAME_FRAME = 36_000;
```
但 `src/data/technique.ts:68-86` 的 `validateTechnique` **只校验关键帧**，步进映射与
接触轨道都没有上限：
```
  for (const m of t.stepMapping) {
    if (!Number.isInteger(m.stepIndex) || m.stepIndex < 0) throw new TechniqueError(`stepIndex 必须为非负整数：${m.stepIndex}`);
    if (!Number.isInteger(m.startFrame) || m.startFrame < 0) throw new TechniqueError(`startFrame 非法：${m.startFrame}`);
    if (!Number.isInteger(m.endFrame) || m.endFrame < m.startFrame) {
      throw new TechniqueError(`stepMapping 区间非法：${m.startFrame}–${m.endFrame}`);
    }
    ...
  }
  for (const c of t.contactTracks) {
    if (!Number.isInteger(c.startFrame) || c.startFrame < 0) {
      throw new TechniqueError(`接触轨道 startFrame 非法：${c.startFrame}`);
    }
    if (!Number.isInteger(c.endFrame) || c.endFrame < c.startFrame) {
      throw new TechniqueError(`接触轨道区间非法：${c.startFrame}–${c.endFrame}`);
    }
    ...
  }
```
`src/vue/pages/EditorPage.vue:427-459`（总长取自 `stepMapping`，刻度**逐帧**生成）
```
const totalFrames = computed(() => {
  if (!tech.value) return 0;
  const kfLast = tech.value.keyframes.length
    ? tech.value.keyframes[tech.value.keyframes.length - 1].frame
    : 0;
  const stepLast = tech.value.stepMapping.reduce((m, s) => Math.max(m, s.endFrame), 0);
  return Math.max(kfLast, stepLast, minTimelineFrames.value);
});
...
const rulerTicks = computed(() => {
  ...
  for (let f = 0; f <= total; f++) {
    if (f % majorEvery === 0) ticks.push({ frame: f, major: true });
    else if (f % minorEvery === 0) ticks.push({ frame: f, major: false });
  }
  return ticks;
});
```

## 影响

实测：`stepMapping: [{ stepIndex: 0, startFrame: 0, endFrame: 100000000 }]` **能通过
`deserializeTechnique`**（验证 #3）。用户在库页「导入」这样一份 JSON，再在编辑器里
选中该手法：

- `totalFrames` = 1e8；
- `rulerTicks` 循环 1 亿次并 push 约 2000 万个对象 → **标签页无响应 / 崩溃**；
- `beatTicks` 另跑 550 万次；
- `tlWidth` = 1e8 × 6px = 6 亿 px，超出浏览器元素尺寸上限。

代码注释里写的防护（`MAX_KEYFRAME_FRAME`）只覆盖了关键帧这一条路径，**步进映射和
接触轨道绕过了它**，与注释承诺不符。同理 `frameRate` 只校验 `> 0`，
`frameRate: 1e9` 合法 → `minTimelineFrames = 1e7` → `rulerTicks` 单次计算循环一千万次
（验证 #4）。

## 修复

1. 在 `validateTechnique` 里给 `stepMapping`/`contactTracks` 的 `startFrame/endFrame`
   加上 `MAX_KEYFRAME_FRAME` 上限（与关键帧同一常量），错误文案复用现有措辞：
   `stepMapping 区间超出上限（36000）`。
2. `parseStepMapping` / `parseContactTracks` 同步加上界（深度校验才是第一道闸）。
3. `frameRate` 增加上限（例如 ≤ 1000，已有预设最高 1000；或 ≤ 1000 后 `minTimelineFrames`
   仍可接受）。注意 `FRAME_RATE_PRESETS` 最高 1000，1000fps 时
   `minTimelineFrames = 10`，`rulerTicks` 循环 10 次，安全。
4. 兜底：`totalFrames` 再加一次 `Math.min(..., MAX_KEYFRAME_FRAME)`，避免任何漏网路径
   再把 DOM 撑爆。
5. 补一条 `scripts/verify-data.ts` 断言：`endFrame = 1e8` 的 technique 必须被拒。

## 工作量：S（<1h）　置信度：high

---

# 3. 播放中改姿态/时长只重置 `stepMoveIndex`、不重置 `moveCursor` → 魔方执行错位动作

**严重度**：high　**分类**：correctness / state contract　**文件**：
`src/vue/pages/EditorPage.vue:815-842`（`applyStepAtFrame` 与 `commit`）
**工作量**：S　**置信度**：high

## 证据（逐字）

`src/vue/pages/EditorPage.vue:815-830`
```
function applyStepAtFrame(frame: number): void {
  if (!tech.value) return;
  for (const m of tech.value.stepMapping) {
    if (m.stepIndex !== stepMoveIndex) continue;
    if (frame < m.startFrame) break;
    if (m.kind === "pause") {
      // 空拍：魔方不动作（手部动画继续）
      stepMoveIndex++;
      continue;
    }
    const move = formulaMoves[moveCursor];
    if (move) player?.applyMove(move);
    moveCursor++;
    stepMoveIndex++;
  }
}
```
`src/vue/pages/EditorPage.vue:832-842`
```
function commit(fn: (t2: Technique) => Technique, keepInputs = false): void {
  if (!tech.value) return;
  try {
    tech.value = fn(tech.value);
    stepMoveIndex = 0;
    computeFormulaMoves();
    renderAll(keepInputs);
  } catch (e) { ... }
}
```
两个游标在 `src/vue/pages/EditorPage.vue:77-80` 的注释里被刻意区分：
```
/** 倒放逆序执行指针：已逆序执行到第几步（从 formulaMoves.length 递减到 0） */
let revApplied = 0;
/** 已应用的公式动作数（空拍不消耗；stepIndex 为序列位置） */
let moveCursor = 0;
```

## 影响

`stepMoveIndex`（步序号）与 `moveCursor`（公式动作序号）必须同步推进；`commit()` 只把
`stepMoveIndex` 归零，`moveCursor` 保持旧值。播放过程中用户改一个姿态数值（输入框是
`@input` 触发 → 每个按键都走一次 `commit`），下一帧 `applyStepAtFrame` 就会：

- 用**旧的** `moveCursor`（例如 2）去取 `formulaMoves[2]`，把**第 3 个动作**当成
  **第 1 步**执行 → 魔方状态与时间线脱节（动作重复执行/漏执行）；
- 随后 `stepMoveIndex` 变成 1、`moveCursor` 变成 3，后续每一步都错位一格。

用户看到的是「播放中改了个 X，魔方就转错动作了」，而且没有任何报错提示。

## 修复

在 `commit()` 里把两个游标一起归位（与 `onPvPlay` 的重置语义一致）：
```
    tech.value = fn(tech.value);
    stepMoveIndex = 0;
    moveCursor = 0;          // ← 新增：与 stepMoveIndex 同步
    revApplied = tech.value?.stepMapping.length ?? 0;
    computeFormulaMoves();
```
更稳妥的做法：`commit()` 检测到 `playing.value` 为真时**先停播**（与
`onFrameRateChange:520` 的既有处理一致：`playing.value = false; // 播放中切换帧率会与步进/魔方状态脱同步，先停止`），
把「编辑」与「播放」两个状态机彻底互斥。

## 工作量：S（<1h）　置信度：high

---

# 4. `selectedFrame` 与 `previewFrame` 双真相：改缓动/插中间帧作用在错误对象或静默失效

**严重度**：medium　**分类**：correctness / state contract　**文件**：
`src/vue/pages/EditorPage.vue:588-590`、`661-670`、`882-887`、`1270-1297`、`1377-1382`
**工作量**：M　**置信度**：high

## 证据（逐字）

面板**显示**的是播放头帧（`src/vue/pages/EditorPage.vue:661-670`）：
```
function renderPreview(): void {
  const pose = shownPose();
  // 面板常驻时：帧号/缓动/删除/数值全部跟随播放头（姿态信息并入帧编辑器；
  // 正在输入的数值框不覆盖）
  if (kfPanelVisible.value) {
    const frame = previewFrame.value;
    const kf = tech.value?.keyframes.find((k) => k.frame === frame) ?? null;
    if (kfFrameEl.value) kfFrameEl.value.value = String(frame);
    if (kfEasingEl.value) kfEasingEl.value.value = kf?.easing ?? "linear";
```
而「改缓动」却用的是**选中帧**（`src/vue/pages/EditorPage.vue:882-887`）：
```
const onKfEasingChange = (e: Event): void => {
  if (!tech.value || selectedFrame.value === null) return;
  const kf = tech.value.keyframes.find((k) => k.frame === selectedFrame.value);
  if (!kf) return;
  commit((t2) => upsertKeyframe(t2, { ...kf, easing: (e.target as HTMLSelectElement).value as Easing }));
};
```
`selectedFrame` 只在「点时间线上的关键帧标记」时被写入（`src/vue/pages/EditorPage.vue:1377-1382`）：
```
const selectKf = (frame: number): void => {
  selectedFrame.value = frame;
  previewFrame.value = frame;
  kfPanelOpen.value = true; // 点关键帧箭头 → 展开侧边栏编辑面板
  renderAll();
};
```
「插入中间帧」同样依赖 `selectedFrame`（`src/vue/pages/EditorPage.vue:1270-1277`）：
```
const onInsertMid = (): void => {
  if (!tech.value || selectedFrame.value === null) {
    statusText.value = t("editor.insertMidNeed");
    return;
  }
  const sorted = [...tech.value.keyframes].sort((a, b) => a.frame - b.frame);
  const idx = sorted.findIndex((k) => k.frame === selectedFrame.value);
```

## 影响

面板的自我说明是「**始终跟随播放头**（点时间线/播放/步进即查看该帧姿态）」
（`src/vue/pages/EditorPage.vue:587`），但「缓动」「插入中间帧」走的是另一套语义：

- 用户**在标尺上定位**（`onRulerSeek`）或用 **←/→ 步进**（`stepFrames`）后，
  `selectedFrame` 仍是 `null` 或旧值 → 改缓动**静默无效**（`onKfEasingChange` 直接
  `return`，连状态栏提示都没有；下一次 `renderPreview` 又把下拉框写回旧值，
  用户以为是自己没保存成功）；
- 若 `selectedFrame` 指向**另一个**关键帧（例如先点了第 0 帧，再用 → 走到第 30 帧），
  改缓动会**改到第 0 帧**上，而面板显示的是第 30 帧的缓动值 —— 一次静默的数据错写；
- 「插入中间帧」在只做了标尺定位时直接报「需选中一个非末尾的关键帧」，与面板
  「跟随播放头」的承诺矛盾。

## 修复

统一到 `previewFrame` 一个真相，删除 `selectedFrame`（它只有 6 处引用，替换成本极低）：

1. 删除 `selectedFrame` ref，所有「当前关键帧」查询改为
   `tech.value.keyframes.find((k) => k.frame === previewFrame.value)`；
2. `onKfEasingChange` 改为按 `previewFrame.value` 查关键帧，查不到时给出状态栏提示
   （而不是静默 return）；
3. `onInsertMid` 同样按 `previewFrame` 查；
4. 若确实需要「显式选中」的语义（例如从 `selectKf` 继承），就让它**在播放头移动时
   同步跟随**（在 `stepFrames` / `seekFromEvent` / 播放 tick 里一并更新），
   保证两者永不分叉。

## 工作量：M（~1 天）　置信度：high

---

# 5. 复杂记法（交换子/共轭/宽层）未展开 → 播放时 `applyMove` 抛异常；`splitCompoundMove` 丢 `w`

**严重度**：medium　**分类**：correctness　**文件**：`src/vue/pages/EditorPage.vue:777-791`；
`src/notation/alg.ts:27-42`　**工作量**：M　**置信度**：high

## 证据（逐字）

`src/vue/pages/EditorPage.vue:777-791`
```
function computeFormulaMoves(): void {
  formulaMoves = [];
  if (!tech.value) return;
  const f = lib.value.formulas.find((x) => x.id === tech.value!.formulaId);
  if (!f) return;
  const parsed = parseMoves(f.moves);
  if (!parsed.ok) return;
  // 去括号 + 拆分复合动作（如 "UD'" → U、D'）：cubing 动画处理复合动作会崩溃
  // （areQuantumMovesSameAxis），单面顺序执行既稳定又与记法语义等价
  const tokens = parsed.normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s.replace(/[()]/g, ""));
  formulaMoves = tokens.flatMap(splitCompoundMove);
}
```
`src/notation/alg.ts:27-42`（**`expandMoves` 已经写好，但编辑器根本没用**）
```
/** 把复合动作 token 拆成单面动作：UD' → [U, D']；R2' → [R2']（保持修饰）。
 *  用于单步应用/播放：cubing 动画处理复合动作会崩溃（areQuantumMovesSameAxis）。 */
export function splitCompoundMove(token: string): string[] {
  const parts = token.match(/[UDFBLRudfbMESxyz](\d*'?)/g);
  if (!parts || parts.length <= 1) return [token];
  return parts;
}
...
/** 展开交换子/共轭/分组，得到平铺移动序列 */
export function expandMoves(input: string): string {
  return Alg.fromString(input).expand().toString();
}
```

## 影响

实测（验证 #3）：公式 `[R, U]`（交换子）在 `computeFormulaMoves` 后变成
`formulaMoves = ["[R,", "U]"]` —— **两个都不是合法动作 token**。播放时
`player.applyMove("[R,")` 会进 cubing 的 `new Move("[R,")`，实测抛
`internal parsing error`（验证 #4），异常发生在 `setInterval` 回调里 → 播放中断 +
控制台每帧报错。库里的公式是允许交换子/共轭的（`src/notation/alg.ts:61-62` 的
自检用例就含 `[R, U]`、`[R: U]`），用户给这类公式建手法就会踩到。

第二个缺陷在 `splitCompoundMove` 的正则：字符类里有大小写但**没有 `w`**，
所以 `RwUw` 会被切成 `["R","U"]` —— 宽层动作被静默降级成单层动作；
`splitCompoundMove("Rw")` 恰好因为只匹配到 1 段而原样返回，才没暴露。
`parseMoves("RwUw").normalized` 保持 `"RwUw"` 不拆空格（实测），所以这条路径真实可达。

## 修复

1. `computeFormulaMoves` 改用 `expandMoves` 先把交换子/共轭/括号组**展开成平铺序列**
   （`expandMoves("[R, U]")` → `"R U R' U'"`，实测），再按空白切分；
2. `splitCompoundMove` 的正则补 `w`（如 `/[UDFBLRudfbMESxyz]w?(\d*'?)/g`），或在切分后
   校验每个 token 能被 `Alg.fromString` 解析，解析失败则整条公式降级为「不可播放」
   并在 UI 上给出明确提示，而不是让异常飞到定时器里；
3. `applyStepAtFrame` 里的 `player?.applyMove(move)` 包一层 `try/catch`，单步失败时
   停止推进并提示「公式动作非法：<token>」。

## 工作量：M（~1 天）　置信度：high

---

# 6. 主位手规则三处越界：双手态允许左手主位、双手开关覆盖用户选择、API 主手固定为左手

**严重度**：medium　**分类**：contract violation / doc drift　**文件**：
`src/vue/pages/EditorPage.vue:129-132`、`330-341`、`1536-1546`；`src/hand/handApi.ts:130-167`
**工作量**：M　**置信度**：high

规则原文（`AGENTS.md:32-33` / `docs/todo.md:91-93`）：
「**主位手规则**——双手=右手主位（公式右撇子基准，默认编辑右手），单手=默认左手且左手即
主位（面板可换，换后即主位）。主位手 = 单手显示的手 + 关键帧面板默认编辑手。」

## 证据（逐字）

`src/vue/pages/EditorPage.vue:129-132`（规则注释 + 初值）
```
/** 主位手（十九轮用户定版）：随模式走的角色——双手状态下右手为主位（公式右撇子
 *  基准，默认编辑右手）；单手状态下默认左手且左手即主位，可换右手（换后右手即
 *  主位）。主位手 = 单手显示的手 + 关键帧面板默认编辑手。 */
const focusHand = ref<"left" | "right">("right");
```
`src/vue/pages/EditorPage.vue:330-341`（**双手开关无条件改写主位手**）
```
const toggleBothHands = (): void => {
  showBothHands.value = !showBothHands.value;
  // 主位规则：双手=右手主位（默认编辑）；单手=默认左手（可经面板换右手）
  focusHand.value = showBothHands.value ? "right" : "left";
  applyHandVisibility();
  renderPreview(); // 面板数值随主位手刷新 + 双手重喂轨
};
const setFocusHand = (h: "left" | "right"): void => {
  focusHand.value = h;
  applyHandVisibility();
  renderPreview();
};
```
`src/vue/pages/EditorPage.vue:1536-1546`（面板在**双手态也**允许切主位手）
```
          <div class="editor-kf-row">
            <WinTextBlock class="editor-label" :Text="t('editor.editHand')" />
            <button
              id="kf-edit-hand-left"
              class="zoom-btn"
              :class="{ on: focusHand === 'left' }"
              @click="setFocusHand('left')">{{ t("editor.handLeft") }}</button>
            <button
              id="kf-edit-hand-right"
              class="zoom-btn"
              :class="{ on: focusHand === 'right' }"
              @click="setFocusHand('right')">{{ t("editor.handRight") }}</button>
```
`src/hand/handApi.ts:130-134`（API 的「主手」固定是左手，与规则相反）
```
export function registerHandApi(view: HandRigView, mirror?: HandRigView): void {
  if (!import.meta.env.DEV) return;
  handView = view;
  mirrorView = mirror ?? null;
  lastVisible = true;
```
`src/vue/pages/EditorPage.vue:1406`（传入的正是左手实例）
```
  registerHandApi(handLeft, handRight ?? undefined); // DEV 外部注入 API（docs/hand-api-spec.md）
```

## 影响

逐条对照规则：

| 规则 | 现状 | 判定 |
|---|---|---|
| 双手 = 右手主位 | 双手态下面板仍可点「左手」→ `focusHand='left'`，关键帧面板转而编辑左手轨 | **越界**（规则说双手态右手主位） |
| 单手 = 默认左手且左手即主位 | `toggleBothHands` 关双手时把 `focusHand` 设为 `"left"` | 符合 |
| 单手 = 面板可换，换后即主位 | 用户在单手态选「右手」→ 切到双手再切回单手 → `focusHand` 被重置为 `"left"`，**用户显式选择被丢弃** | **越界** |
| API 侧 | `handApi` 的主手恒为左手，镜像手恒为右手 | 与「双手=右手主位」相反 |

具体后果：

- 双手态下用户点「编辑手=左手」，面板数值改显左手轨道 —— 与规则相悖；更糟的是这个状态
  **不被持久化**，刷新页面又回到右手，用户容易误以为数据被改了；
- 单手态显式选择右手主位后，来回切一次「双手显示」开关，选择被静默清零；
- API 与编辑器对「谁是主手」的认知相反：脚本作者按规则会认为驱动的是右手，实际
  `handApi` 驱动的是左手 + 镜像右手（见 #7）。

另外（迁移边界）：旧编辑器默认手型确为 `"right"`（`git show 1f36cce^:src/vue/pages/EditorPage.vue`
 可见 `?? "right"`），所以「旧 `pose` → 右手轨」的迁移方向**正确**；但旧档若是在
「手型选择器切到左手」状态下录制的，迁移后会被搬到右手轨，且双轨模型里没有任何
「这帧原本是哪只手」的元信息可恢复——属于无法完全修复的信息损失，最多在 UI 上提示。

## 修复

1. 规则落地为一个纯函数，UI 与数据路径共用，避免散落的三处 if：
   ```ts
   type HandMode = "both" | "single";
   function resolvePrimaryHand(mode: HandMode, userPref: "left" | "right"): "left" | "right" {
     return mode === "both" ? "right" : userPref;   // 双手恒右；单手用用户显式选择
   }
   ```
   `focusHand` 拆成两个状态：`handMode`（双手/单手）与 `singleHandPref`（用户在单手态
   的显式选择，默认 left）；`toggleBothHands` **不再**覆盖 `singleHandPref`；
2. 双手态下面板的「编辑手」按钮：要么置灰（`:disabled="showBothHands"`），要么改文案
   明确「双手态固定编辑右手」；若产品上确实要允许双手态自由切换，就把规则文档改成
   「双手态默认右手，可切换」——**规则与实现必须二选一，不能各说各话**；
3. `handApi` 的主手改为跟随编辑器主位手：`registerHandApi(handLeft, handRight, () => focusHand.value)`，
   `driveBoth` 时用当前主位手决定「原样驱动哪只、镜像驱动哪只」；
4. 旧档迁移：在 `parseKeyframe` 里给「由旧 `pose` 迁移而来」的帧打一个来源标记
   （如 `legacyHand: "right"`），面板上提示「本手法由旧版单轨数据迁移」。

## 工作量：M（~1 天）　置信度：high

---

# 7. 外部注入 API 与编辑器双轨契约冲突（镜像 vs 独立双轨）+ `hand-api-spec.md` 与实现不符

**严重度**：medium　**分类**：doc drift / ownership　**文件**：
`src/vue/pages/EditorPage.vue:1405-1406`；`src/hand/handApi.ts:41-54`、`130-167`、`176-184`；
`docs/hand-api-spec.md:32`、`44`、`50-52`　**工作量**：M　**置信度**：high

> 注：「API 驱动被编辑器每帧抢写」这一条已由 `docs/audit/hand.md` **F2** 记录（high），
> 本条不重复计分，只补**编辑器侧的所有权/契约**与**规格漂移**。

## 证据（逐字）

`src/hand/handApi.ts:41-54`（API 是「镜像对侧」模型）
```
let handView: HandRigView | null = null;
/** 镜像手（双手显示）：API 驱动主手时以 mirrorPose 同步驱动对侧 */
let mirrorView: HandRigView | null = null;
...
/** 主手 + 镜像手统一驱动（镜像手取 x 镜像姿态） */
function driveBoth(pose: Pose | null): void {
  handView?.setPose(pose);
  mirrorView?.setPose(pose ? mirrorPose(pose) : null);
}
```
`src/hand/handApi.ts:153-167`（`setHandType` 实际只切可见性，从不调用 `setHandType`）
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
`docs/hand-api-spec.md:44`（规格说「转调 `handView.setHandType`」）
```
| `setHandType(t: "left" \| "right")` | 转调 `handView.setHandType` |
```
`docs/hand-api-spec.md:32`（规格是**单实例**签名，实现已是双实例）
```
export function registerHandApi(handView: HandRigView): void
// 挂载 window.motionCubeHand（仅 DEV）；编辑器卸载时调用 unregisterHandApi()
```
`src/vue/pages/EditorPage.vue:697-709`（编辑器是**独立双轨**模型）
```
  // 双手驱动（十八轮显式双轨）：左手走 left 轨、右手走 right 轨，互不联动；
  ...
  if (handLeft) {
    handLeft.setPose(
      showBothHands.value || focusHand.value === "left" ? previewLeftPose() ?? defaultHandPose("left") : null,
    );
  }
```

## 影响

- **同一对手实例存在两套互斥的驱动契约**：编辑器 = 「左手走 left 轨、右手走 right 轨，
  互不联动（默认不镜像关联）」；`handApi` = 「左手拿原样姿态、右手拿镜像姿态」。
  规格文档 `docs/hand-api-spec.md` 写的是**更早的单实例**模型，实现已经是双实例镜像
  模型 —— 规格、编辑器、API 三方各说各话。
- `setHandType` 名不副实：它不换手型（`HandRigView.setHandType` 从未被调用），
  只是切换两个固定实例的可见性；`getState().handType` 返回的是模块变量 `lastHandType`，
  **与视图真实手型无关**，初值恒为 `"left"` —— 调试者据此判断「当前是哪只手」会得到
  错误结论。
- 规格文档承诺的「后续 `setVisible(true)` 恢复双手」也不成立：`setVisible(true)` 只是
  把两个实例都设为可见，并不恢复编辑器的 `showBothHands` 状态；下一次
  `applyHandVisibility()`（按 H 键或切双手开关）会把它覆盖。

## 修复

1. **规格同步**：`docs/hand-api-spec.md` 的第 3 节改成当前实现（双实例、镜像驱动），
   并把「`setHandType` → 转调 `handView.setHandType`」改成实际语义
   （「切换单手显示哪一只」）；`docs/hand-api-usage.md` 与 `help.handApi` 文案
   （`src/i18n/locales/en.ts:283`：`the mirrored hand follows automatically when dual-hand display is on`）
   同样需要复核。
2. **API 与编辑器统一所有权**：给编辑器加一个「外部接管」标志（hand.md F2 已给方案），
   API 驱动期间编辑器停止写姿态；同时把 API 的主手改为跟随 `focusHand`（与 #6 一并做）。
3. `getState()` 返回**真实**状态：`handType` 取 `handView.type`，`visible` 取两个实例
   可见性的与/或，而不是模块变量。
4. `setHandType` 改名 `setSingleHand(t)`（或保留名字但注明语义），避免调用方误解。

## 工作量：M（~1 天）　置信度：high

---

# 8. 时间线打开编辑面板时不刷新数值 → 面板显示的是上一次打开时的旧姿态

**严重度**：medium　**分类**：correctness / UX　**文件**：
`src/vue/pages/EditorPage.vue:215-227`、`661-696`、`712-729`　**工作量**：S　**置信度**：high

## 证据（逐字）

`src/vue/pages/EditorPage.vue:215-227`（点轨道只开面板，**不刷新数值**）
```
const onTrackPointerDown = (e: PointerEvent): void => {
  e.preventDefault(); // 阻止文本选择/拖拽干扰
  if (playing.value) playing.value = false; // 点轨道停止播放
  kfPanelOpen.value = true; // 点时间线 → 编辑面板常驻（姿态信息跟随播放头）
  // band 上按下即选中（Ctrl/Shift 多选立即生效，不依赖 click 松手）
  const band = (e.target as HTMLElement).closest?.(".tl-step-band");
  if (band) {
    const idx = Number(band.getAttribute("data-step-index") ?? "-1");
    if (idx >= 0) selectStep(idx, e);
  } else if (selectedSteps.value.length > 0) {
    selectedSteps.value = []; // 点空白取消多选
  }
};
```
`src/vue/pages/EditorPage.vue:661-696`（**面板关闭时 `renderPreview` 不回写数值**）
```
function renderPreview(): void {
  const pose = shownPose();
  // 面板常驻时：帧号/缓动/删除/数值全部跟随播放头（姿态信息并入帧编辑器；
  // 正在输入的数值框不覆盖）
  if (kfPanelVisible.value) {
    ...
```
面板用 `v-show` 挂载（`src/vue/pages/EditorPage.vue:1530`），DOM 一直在，关闭期间
`renderSelected` 仍会写值（`renderSelected` 无条件回写），但 `renderPreview` 的
`sync()` 逻辑只在面板可见时执行。

## 影响

复现路径：

1. 打开编辑器 → 选一个手法 → 编辑面板展开过一次（此时数值 = 帧 X）；
2. 关闭编辑面板（`#kf-panel-close` 按钮，`src/vue/pages/EditorPage.vue:1533`）；
3. 用 **←/→** 逐帧步进（`stepFrames` → `renderPreview`，此时 `kfPanelVisible` 为 false →
   数值**不更新**）；
4. 再点时间线轨道 → 面板展开 → **显示的是步骤 1 的旧数值**，不是当前播放头的姿态。

用户会据此改姿态 → 改到了错误的基准姿态（`ensureAutoKfPose` 用的是**当前插值姿态**
而不是面板显示的旧值，于是「看到的」和「改的」不是一回事），产生难以察觉的错误动作。

## 修复

1. 打开面板的入口统一补一次刷新：`onTrackPointerDown` 里在 `kfPanelOpen.value = true`
   之后调用 `renderSelected(); renderPreview();`（或直接 `renderAll()`）；
2. 或者去掉 `renderPreview` 里的 `if (kfPanelVisible.value)` 门禁——`sync()` 已经有
   `active !== el` 的保护，不会打断正在输入的框；代价是每帧多写 18 个隐藏输入框，
   建议与 #11（缓存 DOM 引用）一起做；
3. 补一条断言：面板打开时 `kf-frame` 必须等于 `previewFrame`（playtest 里现在只测了
   「点关键帧标记」这一条路径，见 #15）。

## 工作量：S（<1h）　置信度：high

---

# 9. 无「未保存」状态：切手法/切页静默丢弃编辑；库页保存可覆盖编辑器未保存内容

**严重度**：medium　**分类**：data loss / UX　**文件**：
`src/vue/pages/EditorPage.vue:731-749`、`832-842`、`1227-1238`、`844-861`
**工作量**：M　**置信度**：high

## 证据（逐字）

`src/vue/pages/EditorPage.vue:731-749`（切手法直接丢弃未保存编辑）
```
function selectTech(id: string): void => {
  selectedFrame.value = null;
  previewFrame.value = 0;
  kfPanelOpen.value = false; // 切换手法 → 收起编辑面板（用户指定唯一关闭途径之一）
  tech.value = lib.value.techniques.find((x) => x.id === id) ?? null;
  computeFormulaMoves();
  ...
  renderAll();
};
```
`src/vue/pages/EditorPage.vue:832-842`（`commit` 只改 `tech.value`，**不动 `lib.value`**）
```
function commit(fn: (t2: Technique) => Technique, keepInputs = false): void {
  if (!tech.value) return;
  try {
    tech.value = fn(tech.value);
    stepMoveIndex = 0;
    computeFormulaMoves();
    renderAll(keepInputs);
  } catch (e) { ... }
}
```
`src/vue/pages/EditorPage.vue:1227-1238`（只有显式点保存才落盘）
```
const onSave = (): void => {
  if (!tech.value) return;
  try {
    lib.value = upsertTechniqueInLib(lib.value, tech.value);
    saveLibrary(lib.value);
    statusText.value = t("editor.saved");
    saveFailed.value = false;
  } catch (e) { ... }
};
```
`src/vue/pages/EditorPage.vue:1699-1701` 附近模板：保存按钮只有 `failed` 一种状态，
```
            <WinButton id="editor-toggle-cube" ...
```
（`src/vue/pages/EditorPage.vue:1746-1753` 的保存按钮 `:class="{ failed: saveFailed }"`）

## 影响

- 用户的姿态/关键帧编辑只存在于 `tech.value`（内存），**没有任何「未保存」提示**：
  点另一个手法 → 编辑全部消失；切到别的页面 → 组件卸载 → 编辑全部消失；
  误关应用 → 全部消失。全程无任何提示。
- 更隐蔽的一条：`commit` 不更新 `lib.value`，因此库页（`src/vue/pages/LibraryPage.vue`）
  里的 `lib` 仍是旧版本；用户在库页点任何会 `saveLibrary` 的操作（新建公式、删除分类…），
  会把**编辑器里未保存的编辑**连同旧版本一起覆盖掉，且看起来「保存成功了」。
- `saveFailed` 只在 `saveLibrary` 抛异常时置位（QuotaExceeded 等），与「有没有未保存改动」
  无关，用户无法从 UI 判断自己有没有丢东西。

## 修复

1. 引入 `dirty` 状态：`commit()` 置 `dirty=true`，`onSave` 清零；保存按钮显示未保存
   标记（圆点/`•`），并提供 `Ctrl+S` 快捷键；
2. `selectTech` 在 `dirty` 为真时二次确认（至少给一次提示），或自动保存；
3. 组件卸载前（`onBeforeUnmount`）若 `dirty` 为真，提示未保存；
4. 或者把 `commit` 改成「同时更新 `lib.value`（内存）」，让编辑始终在库快照里，
   落盘仍由保存按钮控制——这样库页的 `saveLibrary` 就不会用旧版本覆盖新版本。

## 工作量：M（~1 天）　置信度：high

---

# 10. 卸载不释放 `CubePlayer`（`dispose()` 从未调用）、灰面板无销毁、遮罩定时器不清

**严重度**：medium　**分类**：resource leak　**文件**：`src/vue/pages/EditorPage.vue:1384-1522`
（`onMounted`/`onBeforeUnmount`）、`src/cube/CubePlayer.ts:287-299`　**工作量**：S　**置信度**：high

## 证据（逐字）

`src/vue/pages/EditorPage.vue:1506-1522`
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
`src/cube/CubePlayer.ts:287-299`（**有 `dispose()`，编辑器从不调用**）
```
  /** 释放后端资源（render 后端卸载宿主与轮询；cubing 后端移除元素） */
  dispose(): void {
    if (this.renderHost) {
      window.clearInterval(this.renderPollId);
      this.renderHost.dispose();
      this.renderHost = null;
      this.renderCube = null;
      this.renderQueue = null;
      return;
    }
    this.clearRenderRetries();
    this.element?.remove();
  }
```
`src/vue/pages/EditorPage.vue:1051-1057`（遮罩定时器只在**再次触发**时清理，从不清理于卸载）
```
    maskVisible.value = true;
    if (maskTimer !== null) clearTimeout(maskTimer);
    maskTimer = window.setTimeout(() => (maskVisible.value = false), 2600);
    return;
```

## 影响

- `CubePlayer.dispose()` 从未被调用：cubing 后端 `setMoves`/`reset` 会挂 3 个
  `renderRetries` 定时器（`src/cube/CubePlayer.ts:197-199`：`[500, 2000, 5000]`），
  卸载后它们仍会触发 `kickRender()` → 对**已从 DOM 移除**的 TwistyPlayer 调
  `experimentalCurrentVantages()`（内部有 catch，但仍是无效工作）；`TwistyPlayer`
  实例本身也没有走 `dispose()` 路径释放。
- `grayPanelApi` 没有销毁接口（`src/ui/grayPanel.ts` 的 `GrayPanelApi` 只有 `refresh`），
  面板内部的 window 级 `pointerup` 监听永不摘除——这一点已在 `docs/audit/render.md`
  **F10** 记录，此处只补「编辑器也没有调用任何清理」。
- `maskTimer` 卸载后仍会回调（把 `maskVisible` 置 false），属于卸载后写已卸载组件的 ref。
- `player = null` 只是丢引用，**不等于释放**；`HandRigView` 侧的手部几何泄漏已在
  `docs/audit/hand.md` **F3** 记录。

## 修复

1. `onBeforeUnmount` 里补：
   ```ts
   if (maskTimer !== null) { window.clearTimeout(maskTimer); maskTimer = null; }
   player?.dispose();
   player = null;
   ```
   （`handLeft?.dispose(); handRight?.dispose();` 属于 hand.md F3 的修复项。）
2. `CubePlayer.dispose()` 内部同时 `clearRenderRetries()`（render 后端分支目前**没有**
   清 `renderRetries`，虽然 render 后端不产生它们，但为对称应补上）。
3. 给 `renderGrayPanel` 增加 `dispose()`（摘 window 监听 + 清 SVG），由编辑器在卸载时调用；
   或至少让 `GrayPanelApi` 暴露 `destroy`。

## 工作量：S（<1h）　置信度：high

---

# 11. 播放热路径每帧 18 次 `document.getElementById` + 多次姿态插值/四元数分配

**严重度**：medium　**分类**：perf / GC　**文件**：`src/vue/pages/EditorPage.vue:661-710`、
`593-618`、`652-659`　**工作量**：M　**置信度**：high

## 证据（逐字）

`src/vue/pages/EditorPage.vue:684-694`（**每帧 15 次 `getElementById`（5 指 × 3 关节）**）
```
      for (const name of FINGER_ORDER) {
        const arr = pose.bends[name] ?? [];
        FINGER_JOINTS[name].forEach((_, j) => {
          const el = document.getElementById(`kf-bend-${name}-${j}`) as HTMLInputElement | null;
          if (el && active !== el) el.value = arr[j] !== undefined ? String(Math.round(arr[j])) : "";
        });
      }
```
`src/vue/pages/EditorPage.vue:691-694`（再 3 次）
```
      for (const key of CMC_KEYS) {
        const el = document.getElementById(`kf-cmc-${key}`) as HTMLInputElement | null;
        sync(el, String(Math.round(pose.thumbCMC[key])));
      }
```
`src/vue/pages/EditorPage.vue:661-663` + `1434-1503`（`renderPreview` 在播放时 60Hz 被调）
```
function renderPreview(): void {
  const pose = shownPose();
```
`src/vue/pages/EditorPage.vue:593-609`（每帧 2~3 次完整姿态插值，每次新建 bends 数组）
```
function trackPose(get: (kf: TechniqueKeyframe) => Pose): Pose | null {
  if (!tech.value || tech.value.keyframes.length === 0) return null;
  ...
  return interpolatePose(get(seg.a), get(seg.b), eased);
}
```
`src/vue/pages/EditorPage.vue:652-659`（每帧新建 `Euler`/`Quaternion`）
```
function poseRotationDeg(pose: Pose): { x: number; y: number; z: number } {
  const q = pose.palm.transform.quaternion;
  const e = new Euler().setFromQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
  return { x: (e.x * 180) / Math.PI, y: (e.y * 180) / Math.PI, z: (e.z * 180) / Math.PI };
}
```

## 影响

播放时每帧（60Hz）固定发生：

- **18 次 `document.getElementById`**（15 关节 + 3 CMC）——字符串拼接 + 全文档 id 索引
  查询，60fps × 18 = 1080 次/秒，纯属浪费（这些元素是静态的）；
- `renderPreview` 先算 `shownPose()`（1 次插值），再在 `renderPreview` 内部算左右手
  姿态（**再 2 次插值**）→ 每帧 3 次 `interpolatePose`，每次新建 5 个 bends 数组 +
  6 个四元数/向量对象；
- `poseRotationDeg` 每帧 `new Euler()` + `new Quaternion()`（three.js 对象，非池化）。

单帧的绝对开销不大，但在 60Hz 常驻循环 + 低配机器上会形成稳定的 GC 压力；
`getElementById` 还会在 id 重名时静默串页（与 `docs/audit/pages.md` **#23** 指出的
标定页同类问题）。

## 修复

1. 用模板 `ref` 数组一次性缓存这些输入框（`const kfBendEls = ref<HTMLInputElement[]>([])`），
   替代 `getElementById`；模板里的 `:id` 仍可保留用于测试定位；
2. `renderPreview` 每帧只算一次插值姿态并复用：`shownPose()`/`previewLeftPose()`/
   `previewRightPose()` 目前各自独立插值，改为「一次 `trackPose` 同时产出左右两条轨道」
   （或在无面板可见时跳过数值回写 altogether）；
3. `Euler`/`Quaternion` 提为模块级复用对象（`new Euler()`/`new Quaternion()` 复用实例，
   `setFromQuaternion` 是原地写入）；
4. 面板不可见时（`kfPanelVisible` 为 false）直接跳过整段数值回写——播放时面板通常收起。

## 工作量：M（~1 天）　置信度：high

---

# 12. 2536 行单文件的四处重复实现（3 套帧重映射 / 4 个姿态输入 / 2 套面板回写）+ 660 行内联 CSS

**严重度**：medium　**分类**：maintainability　**文件**：`src/vue/pages/EditorPage.vue`
（`491-508`、`898-1021`、`620-710`、`1103-1135`、`1196-1216`、`1877-2536`）
**工作量**：L（多天）　**置信度**：high

## 证据（逐字）

**（a）三套「帧重映射」实现**，语义高度重合：

`src/vue/pages/EditorPage.vue:1113-1124`（步内比例重映射）
```
  const remapFrame = (frame: number): number => {
    const old = t2.stepMapping;
    const oldTotal = Math.max(old.length ? old[old.length - 1].endFrame : 1, 1);
    const newTotal = Math.max(stepMapping.length ? stepMapping[stepMapping.length - 1].endFrame : 1, 1);
    const step = old.find((m) => frame >= m.startFrame && frame <= m.endFrame);
    if (!step || old.length === 0) {
      return Math.round((frame / oldTotal) * newTotal);
    }
    const ratio = (frame - step.startFrame) / Math.max(step.endFrame - step.startFrame, 1);
    const ns = stepMapping[step.stepIndex];
    return Math.round(ns.startFrame + ratio * (ns.endFrame - ns.startFrame));
  };
```
`src/vue/pages/EditorPage.vue:1196-1205`（同一套逻辑 + 步序平移）
```
    const remapFrame = (frame: number): number => {
      const oldTotal = Math.max(old.length ? old[old.length - 1].endFrame : 1, 1);
      const newTotal = Math.max(stepMapping.length ? stepMapping[stepMapping.length - 1].endFrame : 1, 1);
      const step = old.find((m) => frame >= m.startFrame && frame <= m.endFrame);
      if (!step || old.length === 0) return Math.round((frame / oldTotal) * newTotal);
      const newIdx = step.stepIndex + (step.stepIndex > idx ? 1 : 0);
      ...
```
`src/vue/pages/EditorPage.vue:491-508`（第三套：整体比例）
```
function rescaleFrames(t2: Technique, oldFr: number, newFr: number): Technique {
  const remap = (frame: number): number => Math.round((frame / oldFr) * newFr);
```
**（b）四个姿态输入 handler 共用同一段前置逻辑**（`898-926`、`929-958`、`961-986`、`996-1021`）：
```
const onBendInput = (e: Event, name: FingerName, j: number): void => {
  if (!tech.value) return;
  const target = previewFrame.value; // 编辑目标 = 播放头帧
  const hasKf = tech.value.keyframes.some((k) => k.frame === target);
  if (!hasKf && !autoKf.value) {
    statusText.value = t("editor.poseNeedKf");
    return;
  }
  let v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  const [lo, hi] = FINGER_JOINT_RANGE[name];
  v = Math.min(hi, Math.max(lo, v));
  commit(
    (t2) =>
      ensureAutoKfPose(t2, target, (pose) => {
```
**（c）两套面板回写**（`620-650` 的 `renderSelected` 与 `661-696` 的 `renderPreview`）
写的是同一批字段（帧号/缓动/删除按钮/XYZ/RXYZ/15 个关节/3 个 CMC），只是
`renderPreview` 多了 `activeElement` 保护、`renderSelected` 多了 `keepInputs` 开关。

**（d）660 行内联 CSS**（`1877-2536`，`<style>` 无 `scoped`），与其它页面风格不一致。

## 影响

- 三套重映射各自演化，已经产生了**同一缺陷家族的三份拷贝**（#1）；修一处忘两处的
  概率极高；
- 两个回写函数的字段清单必须手工保持同步，新增一个姿态字段要改两处；
- `EditorPage.vue` 2536 行里只有约 1523 行是逻辑，其余是样式，检索与评审成本高；
- `renderSelected` 与 `renderPreview` 对「正在输入的框」的保护策略不同，已经造成
  #8 那种「显示值 ≠ 生效值」的不一致。

## 修复（按收益排序，建议分步做）

1. **抽 `remapFrames(t, plan)` 单一实现**：入参给出「旧步区间 → 新步区间」的映射表，
   三处调用点共用；所有出口统一 `validateTechnique`（同时解决 #1）。
2. **抽 `editPoseAtPlayhead(patch)`**：把四个姿态 handler 的公共前置
   （目标帧 / 有无关键帧 / autoKf 判定 / 钳位 / commit）收成一处，handler 只剩
   「如何 patch」这一行差异。
3. **合并面板回写**：一个 `syncPanelInputs(pose, {keepInputs, skipActive})`，
   `renderSelected`/`renderPreview` 都调它（同时解决 #8）。
4. **样式外置**：`<style>` 搬到 `src/vue/pages/editor.css`（或 `src/styles/editor.css`）
   并加 `scoped`，编辑器文件瘦到 ~1500 行；进一步可把
   「时间线/播放引擎」「关键帧面板」「库操作」拆成三个 composable
   （`useTimelinePlayback` / `useKeyframePanel` / `useTechniqueLib`）。

## 工作量：L（多天）　置信度：high

---

# 13. 自动路径/正弦路径 O(n² log n)：长手法上一次点击可卡数秒

**严重度**：low　**分类**：perf　**文件**：`src/vue/pages/EditorPage.vue:1241-1267`、
`1300-1342`；`src/data/technique.ts:117-124`　**工作量**：M　**置信度**：high

## 证据（逐字）

`src/vue/pages/EditorPage.vue:1253-1265`
```
  commit((t2) => {
    let acc = t2;
    for (let f = first.frame + AUTO_PATH_STEP; f < last.frame; f += AUTO_PATH_STEP) {
      const t = (f - first.frame) / (last.frame - first.frame);
      acc = upsertKeyframe(acc, {
        frame: f,
        left: interpolatePose(first.left, last.left, t),
        right: interpolatePose(first.right, last.right, t),
        easing: first.easing ?? "linear",
      });
    }
    return acc;
  });
```
`src/data/technique.ts:117-124`（每次 `upsertKeyframe` 都会 **过滤 + 排序 + 全量校验**）
```
export function upsertKeyframe(t: Technique, keyframe: TechniqueKeyframe): Technique {
  const others = t.keyframes.filter((k) => k.frame !== keyframe.frame);
  const keyframes = sortKeyframes([...others, keyframe]);
  const next: Technique = { ...t, keyframes };
  validateTechnique(next);
  return next;
}
```

## 影响

每次插入都要 `filter` + `sort` 整个关键帧数组并做一次 `validateTechnique`（O(n)）。
一个 10 分钟、步长 15 帧的手势 → 约 2400 个中间关键帧 → 2400 次「过滤+排序 2400 项
+ 校验 2400 项」≈ 6500 万次比较 + 570 万次校验 → 主线程卡死数秒（UI 无进度、无取消）。
用户唯一的反馈是「点了一下没反应」。

## 修复

1. 批量生成：一次构造完整数组 → `sortKeyframes` 一次 → `validateTechnique` 一次；
2. 生成前估算数量并在 UI 上给出提示（例如「将生成 2400 个关键帧」）；
3. 分帧生成（每帧生成一小批，用 `requestAnimationFrame` 让出主线程），配合状态提示。

## 工作量：M（~1 天）　置信度：high

---

# 14. 死代码与文案漂移：`pointer.ts` 整个文件未引用、10 个旧镜像模型 i18n key、快捷键提示过期

**严重度**：low　**分类**：dead code / doc drift　**文件**：`src/input/pointer.ts:1-6`；
`src/i18n/locales/zh-CN.ts:305-308`、`344`、`275`；`src/i18n/locales/en.ts:317-320`、`352`、`281`；
`src/input/keymap.ts:74-94`；`src/vue/pages/EditorPage.vue:419-425`　**工作量**：S　**置信度**：high

## 证据（逐字）

`src/input/pointer.ts`（**全文 6 行，全仓零引用**）
```
/**
 * 层 C'：鼠标拖拽模式区分。
 * 需要区分：拖拽转层、拖拽翻面、任意视角查看。具体手势设计待定。
 * TODO(spike): 验证 twisty-player 原生拖拽行为，再决定自定义手势层。
 */
export type DragMode = "layer" | "reorient" | "view";
```
（检索：全仓仅此一处出现 `DragMode`）

`src/i18n/locales/zh-CN.ts:305-308`（**旧「主手/对侧手 + 镜像跟随」模型的残留文案**）
```
  "editor.handMain": "主手",
  "editor.handMirror": "对侧手",
  "editor.mirrorFollow": "镜像跟随主手",
  "editor.clearMirror": "清除对侧数据",
```
（全仓检索：`editor.handMain` / `editor.handMirror` / `editor.mirrorFollow` /
`editor.clearMirror` / `editor.selected` / `editor.preview` / `editor.timeline` /
`editor.timelineHide` / `editor.addKfHint` / `editor.handType` **在 locale 之外零引用**）

`src/i18n/locales/zh-CN.ts:344` 与 `en.ts:352`（**快捷键提示停留在三键时代**）
```
  "editor.toggleHint": "快捷键：Space 播放 / C 魔方显隐 / H 手显隐",
```
```
  "editor.toggleHint": "Keys: Space play / C cube / H hand",
```
而实际可配置动作有 8 个（`src/input/keymap.ts:74-83`：play / toggle-cube / toggle-hand /
**toggle-both-hands** / step-back / step-forward / jump-prev / jump-next）。

`src/i18n/locales/zh-CN.ts:275` 与 `en.ts:281`（**帮助页仍是「编辑器还没做」的占位**）
```
  "help.editorPlaceholder": "待编辑器实现后补充",
```
```
  "help.editorPlaceholder": "To be filled in once the editor ships",
```
（`src/vue/pages/HelpPage.vue:28` 直接把它渲染出来）

`src/vue/pages/EditorPage.vue:419-425`（**编辑器绑定永远无法使用 space 修饰**）
```
function resolveEditorAction(e: KeyboardEvent): EditorAction | null {
  const k = bindingKey({ code: e.code, shift: e.shiftKey, space: false });
  for (const [action, b] of Object.entries(editorActions.value)) {
    if (bindingKey(b) === k) return action as EditorAction;
  }
  return null;
}
```

## 影响

- `src/input/pointer.ts` 是一个从未被使用的空壳类型文件，注释里的「TODO(spike)」会误导
  后续维护者以为存在手势层；
- 10 个 `editor.*` i18n key 描述的是**已经被双轨模型取代**的旧设计（主手/对侧手/
  镜像跟随/清除对侧数据），留着会让人以为还存在「镜像跟随主手」开关；
- 快捷键提示与帮助页文案与实际功能不符（用户按提示找不到 B 键双手切换，也读不到
  帧率/倍速/空拍等编辑器能力）；
- `resolveEditorAction` 把 `space` 硬编码为 `false`，设置页若把某个动作绑成
  `Space+X` 之类（`KeyBinding.space` 是支持的字段），该绑定永远不触发，且没有任何提示。

## 修复

1. 删除 `src/input/pointer.ts`（或移到 `docs/` 记录设计意图），零引用即删；
2. 删除 10 个死 i18n key（zh + en 各 10 条）；`docs/audit/pages.md` **#21** 已清过一批
   同类死 key，本批可一并处理；
3. 更新 `editor.toggleHint`（补 B 双手切换、←/→ 逐帧、Shift+←/→ 跳帧），
   并把 `help.editorPlaceholder` 换成真正的编辑器使用说明（双轨、主位手、帧率/倍速、
   空拍、标灰）；
4. `resolveEditorAction` 传入真实的 `spaceHeld`（与 `KeymapController` 一致地维护
   Space 状态），或在设置页禁止给编辑器动作绑 space 修饰并给出说明。

## 工作量：S（<1h）　置信度：high

---

# 15. 危险编辑路径零回归覆盖：playtest 不测帧率/缓动/主位手/镜像/空拍，CI 不跑 playtest

**严重度**：low　**分类**：test coverage　**文件**：`scripts/playtest-ui.mjs:327-458`；
`.github/workflows/ci.yml`　**工作量**：M　**置信度**：high

## 证据（逐字）

`scripts/playtest-ui.mjs:327-338`（编辑器 playtest 覆盖的范围）
```
// 8b) 动画编辑器骨架：侧边栏选手法、时间线、选中/移动/添加关键帧、保存
await clickNav("动画编辑");
...
await clickTecItem("单拨 U（示例）");
await sleep(300);
let kfFrames = await page.$$eval("#tl-ruler .tl-kf", (els) => els.map((e) => e.dataset.frame).sort());
if (kfFrames.join() !== ["0", "30", "60"].join()) throw new Error(`示例手法关键帧应 0/30/60：${kfFrames}`);
```
全仓检索 playtest 脚本，以下编辑器控件**从不被点击**：
`#kf-easing`（缓动）、`#kf-framerate`（帧率）、`#kf-edit-hand-left` / `#kf-edit-hand-right`
（主位手切换）、`#kf-mirror-to-other`（镜像到对侧）、`#kf-frame-beat`（拍输入）、
`#insert-pause`（插空拍）、`#batch-apply`（批量时长）、`#step-dur-*`（单步时长）、
`#editor-toggle-both-hands`（双手开关）。

`.github/workflows/ci.yml`（**CI 不跑 playtest**）
```
      - name: Verify data
        run: npx tsx scripts/verify-data.ts

      - name: Verify hand mesh
        run: npx tsx scripts/verify-hand-mesh.ts
```
（`docs/todo.md:75` 已登记「playtest 并入 CI（networkidle0 卡点解决后）」为待办）

## 影响

本次审计的 high 级缺陷（#1 帧重映射绕过校验、#3 播放中改姿态错位动作、#4 缓动改错
对象）**全部落在 playtest 的盲区里**，而它们恰恰是「改一个数字就毁掉用户数据」的路径。
`scripts/verify-data.ts` 只覆盖数据层（`upsertKeyframe` 抛错、双轨迁移），**不覆盖
编辑器页的重映射逻辑**——因为重映射函数就写在 `.vue` 文件里，Node 脚本无法直接测。

## 修复

1. **把可测逻辑从 `.vue` 里抽出来**（与 #12 的重构合并做）：把
   `rescaleFrames` / `rebuildWithDurations` / `insertPauseAfter` 的重映射与
   `computeFormulaMoves` 移到 `src/data/technique.ts` 或新文件
   `src/editor/timelineOps.ts`，这样 `scripts/verify-data.ts` 可以直接断言：
   - 重映射后 `validateTechnique` 必须通过；
   - 60→30 且关键帧在 1、2 帧时不得产生重复帧；
   - `computeFormulaMoves("[R, U]")` 产出的每个 token 都必须能被 `Alg.fromString` 解析。
2. **补 playtest 断言**（按风险排序）：
   - 切帧率 60→30 后关键帧数不变、无重复帧、且能继续编辑（覆盖 #1）；
   - 改缓动后下拉值与关键帧数据一致（覆盖 #4）；
   - 点「编辑手=左手」后左/右轨道互不影响（覆盖 #6 的双轨契约）；
   - 「镜像到对侧」只改对侧轨道一次（覆盖 #7）；
   - 插空拍后步数 +1 且魔方不执行该步（覆盖空拍契约）。
3. **CI 跑 playtest**：todo 里已登记该待办；建议在 PR 上跑
   `SPIKE_URL` 指向 5174 的一次冒烟。

## 工作量：M（~1 天）　置信度：high

---

## 附：本区域「无发现」的部分

- `src/data/snapshot.ts`：只被 `GamePage.vue` 使用（`loadSnapshot`/`saveSnapshot`/`clearSnapshot`），
  与编辑器无交集；其文件头注释「可复用于动画编辑器」目前只是设想，未构成编辑器缺陷。
  唯一可提的小点是 `saveSnapshot` 直接写 localStorage 没有 try/catch（QuotaExceeded
  会抛），但属游戏页范畴，不在本报告计分。
- `src/notation/alg.ts` 其余导出（`parseMoves` / `normalizeMoves` / `invertMoves` /
  `validateFormulaMoves` / `notationSelfTest`）在编辑器路径上语义正确；
  `expandMoves` 本身可用（实测），问题只在编辑器**没有调用**它（见 #5）。
- `src/timeline/Timeline.ts` 的插值/缓动/四元数 nlerp-slerp 实现正确（`verify-data.ts`
  有断言覆盖），`MAX_KEYFRAME_FRAME` 常量本身合理（只是覆盖不全，见 #2）。
- `src/input/keymap.ts` 的 `deserializeEditorActions`（按动作回退默认，旧档不整体作废）
  与 `findConflicts` 语义正确；编辑器动作表与 `DEFAULT_EDITOR_ACTIONS` 一致。
- Vue 响应式层面未发现「非响应式写入」类缺陷：`tech`/`lib`/`groupOpen`/`formulaGroupOpen`
  都是 `ref` 且整体替换，`computed` 依赖读取正确；主要问题是**命令式 DOM 回写**
  （`getElementById` + `el.value =`）绕开了 Vue 绑定（见 #8、#11）。
