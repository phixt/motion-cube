# 审计报告 · AREA = pages

> 范围：`src/app/App.ts`、`src/vue/{App.vue,router.ts,theme.ts,i18n.ts}`、`src/vue/pages/{GamePage,LibraryPage,HandCalibPage,KeymapPage,HelpPage,HandLabPage,RenderDemoPage,StartPage}.vue`、`src/vue/composables/useParallax.ts`、`src/vue/styles/global.css`、`src/styles/base.css`、`src/preview/*`
> （`src/vue/pages/EditorPage.vue` 不在本 area 内，未审。）
> 方式：只读审计 + 只读验证脚本（全部脚本写在 OS 临时目录，未改动仓库任何文件）。
> 验证脚本位置：`%TEMP%/mc-audit/{bench-solve.ts,bench-solve2.ts,bench-endalg.ts,i18n-keys.ts}`

## 概览

| # | 标题 | 严重度 | 分类 | 文件 | 行 |
|---|---|---|---|---|---|
| 1 | 复制求解公式漏掉收尾旋转 `endAlg`，复制结果与演示结果朝向不一致 | high | 正确性 / 数据契约 | src/vue/pages/GamePage.vue | 88-94, 292-295 |
| 2 | 进度快照只保存最近 24 步，超出部分静默丢失 | high | 正确性 / 数据丢失 | src/vue/pages/GamePage.vue | 108-114, 166-171 |
| 3 | 设置页整对象回写覆盖标题栏改过的语言，语言下次启动静默回退 | high | 状态 / 全局单例 | src/vue/pages/KeymapPage.vue | 38, 134-140, 197-221 |
| 4 | 页面层完全没有错误边界，渲染/3D 初始化异常 = 空白页且无恢复入口 | high | 错误处理 | src/main.ts, src/vue/App.vue | 24-28, 151-157 |
| 5 | 按键捕获吞掉全部键盘输入：Tab 被当成新按键绑定、Ctrl+C/F5 失效 | medium | 可访问性 / 输入 | src/vue/pages/KeymapPage.vue | 148-184 |
| 6 | 捕获过程中切换作用域会把游戏动作写进编辑器键位表 | medium | 正确性 / 状态污染 | src/vue/pages/KeymapPage.vue | 156-177 |
| 7 | 求解面板与标灰面板同位重叠，标灰面板被完全遮住 | medium | 布局 | src/vue/pages/GamePage.vue | 539-554, 647-662 |
| 8 | “视差: 关” 停不掉背景漂移与魔方自转；项目 CSS 无 `prefers-reduced-motion` | medium | 可访问性 / 文档漂移 | src/vue/pages/StartPage.vue | 160-185 |
| 9 | `<html lang>` 固定 `zh-CN`，切英文后不更新 | medium | i18n / 可访问性 | index.html | 2 |
| 10 | 页面层几乎无可访问名称，动态状态无 `aria-live` | medium | 可访问性 | src/vue/App.vue, src/vue/pages/*.vue | 多处 |
| 11 | 手部标定页“标尺”开关不落盘，与设置页同概念双源真相 | medium | 状态 / 数据契约 | src/vue/pages/HandCalibPage.vue | 53, 58-61, 418 |
| 12 | CI 不跑 UI playtest、也不跑 `verify-solve-base.ts`，但 README/todo 声称已跑 | medium | CI 卫生 / 文档漂移 | .github/workflows/ci.yml | 1-38 |
| 13 | 死代码与遗留脚手架仍进生产构建（`src/app/App.ts`、`src/router.ts`、`src/preview/*`） | medium | 死代码 / 维护成本 | src/app/App.ts, src/router.ts, src/preview/* | — |
| 14 | 路由切换无焦点管理、无路由播报 | medium | 可访问性 | src/vue/App.vue | 151-157 |
| 15 | 求解为纯同步主线程执行，无进度反馈、无取消 | medium | 性能 / 主线程阻塞 | src/vue/pages/GamePage.vue | 220-249 |
| 16 | 多底“取最短”指标不含 setup/endAlg 成本；解法底“空=跟随全局底”契约在 UI 不可达 | medium | 正确性 / 契约 | src/vue/pages/GamePage.vue | 230-241 |
| 17 | 页面层硬编码中文绕过 i18n（切英文后仍显示中文） | medium | i18n | src/vue/pages/GamePage.vue 等 | 137, 321, 325 |
| 18 | `RenderDemoPage` 用 `position: fixed` 逃离壳布局并盖住侧栏 | low | 布局 / 死页面 | src/vue/pages/RenderDemoPage.vue | 120-128 |
| 19 | 模板渲染路径里调用 `loadSettings()`（每次重渲染读 localStorage + JSON.parse） | low | 性能 | src/vue/pages/GamePage.vue | 354 |
| 20 | `t("solve.fail", { error })` 的文案没有 `{error}` 占位符，状态栏丢失错误详情 | low | i18n | src/vue/pages/GamePage.vue | 244 |
| 21 | 8 个 i18n key + 1 段 CSS 已无引用 | low | 死代码 | src/i18n/locales/*.ts | — |
| 22 | 调试路由（render-demo / hand-lab）侧栏高亮错误项 | low | 正确性 | src/vue/App.vue | 76-85 |
| 23 | 标定页 `syncInputs()` 用全局 `getElementById` 回写，会覆盖正在编辑的输入框 | low | 可维护性 | src/vue/pages/HandCalibPage.vue | 200-223 |
| 24 | 注释 / README 与代码漂移（3 处） | low | 文档漂移 | README.md, src/vue/i18n.ts | — |
| 25 | `persist()` 的 `setTimeout` 未在卸载时清理 | nit | 资源 | src/vue/pages/KeymapPage.vue | 127-132 |
| 26 | `useParallax` 只在挂载时读一次 `pointer: fine`，外接鼠标后视差不恢复 | nit | 边界 | src/vue/composables/useParallax.ts | 14, 110 |

---

## 1. 复制求解公式漏掉收尾旋转 `endAlg`，复制结果与演示结果朝向不一致

- **严重度**：high
- **分类**：正确性 / 数据契约违规
- **文件**：`src/vue/pages/GamePage.vue:88-94`（复制）、`src/vue/pages/GamePage.vue:292-295`（演示）
- **证据**：

```ts
// src/vue/pages/GamePage.vue:88-94
const copySolve = async (): Promise<void> => {
  if (!solveResult.value || !solveResult.value.moves.length) return;
  // 「解法以所选底为基础」：复制公式带整块旋转前缀（= 标准魔方上先旋转到底再执行的完整公式）
  const setup = solveResult.value.setupAlg;
  const full = (setup ? setup + " " : "") + solveResult.value.moves.join(" ");
  status.value = (await copyText(full)) ? t("hud.copied") : t("hud.copyFail");
};
```

```ts
// src/vue/pages/GamePage.vue:292-295（演示路径会播 endAlg）
  const endAlg = solveResult.value.endAlg;
  if (endAlg) {
    for (const mv of endAlg.split(" ")) if (!(await play(mv))) return;
  }
```

- **影响**：`solve()` 的返回契约是 `setupAlg + moves + endAlg`（`src/cube/solver/solve.ts:84-89` 明确说明 `endAlg` 是“演示收尾整块旋转”）。演示路径播了 `endAlg`，复制路径没播、也没复制。于是：
  - 当全局底色 ≠ D（例如红底）且所选解法底 ≠ 全局底时，`endAlg` 非空，用户复制到的公式**结束朝向与演示完全不同**。
  - 求解面板 UI 里**根本没有展示 `endAlg`**（模板 `379-391` 行只渲染 `setupAlg` 与各阶段），用户看不到演示最后多出来的那一步整块旋转。
  - 用户把复制的公式贴到别处/记到笔记里，会得到一个“解完了但朝向不对”的公式。
- **验证**（只读脚本 `%TEMP%/mc-audit/bench-endalg.ts`，全局底 = R、同样打乱）：

```
global base = R, setupAlg(R) = "z"
base=U setup="z" end="x2 z2" rotateFrom=R | COPY(57 mv) | DEMO(59 mv)
   copy centers=3,4,2,0,1,5  demo centers=3,1,5,0,4,2  same=false
base=D setup="" end="z'" rotateFrom=null | COPY(69 mv) | DEMO(70 mv)
   copy centers=4,0,2,1,3,5  demo centers=0,1,2,3,4,5  same=false
```
  即：`copy centers != demo centers`，复制出的公式停在错误朝向。标准 D 底时 `endAlg` 恰好为空，所以问题只在非 D 全局底（红/蓝底等）下暴露——属于“平时测不出来、切底色就出错”的隐性 bug。
- **修复**：
  1. `copySolve` 改为拼 `setupAlg + moves + endAlg`（三段都判空）；
  2. 求解面板增加一行展示 `endAlg`（可复用现有 `.solve-stage.solve-stage-rotate` 样式，文案如 `solve.rotateEnd`）；
  3. 补一条 Node 级回归（`scripts/verify-solve-base.ts` 里已有红底实态 A4/A6 场景，直接在其上加断言：`setup+moves+endAlg` 的中心朝向 == `baseFaceSetupAlg(base)` 目标朝向，且 `setup+moves`（不含 endAlg）在 `endAlg != ""` 时**不**等于目标）。
- **工作量**：S（<1h）
- **置信度**：high（已用真实求解器跑出可复现差异）

---

## 2. 进度快照只保存最近 24 步，超出部分静默丢失

- **严重度**：high
- **分类**：正确性 / 数据丢失
- **文件**：`src/vue/pages/GamePage.vue:108-114`、`src/vue/pages/GamePage.vue:166-171`、`src/vue/pages/GamePage.vue:129-138`
- **证据**：

```ts
// src/vue/pages/GamePage.vue:108-114（moves 是“移动日志”，只保留最近 24 条）
const logMove = (move: string): void => {
  moves.value.push(move);
  if (moves.value.length > 24) moves.value.splice(0, moves.value.length - 24);
  void nextTick(() => {
    if (moveLogEl.value) moveLogEl.value.scrollLeft = moveLogEl.value.scrollWidth;
  });
};
```

```ts
// src/vue/pages/GamePage.vue:166-171（快照直接复用这个被截断的日志数组）
// 每步达成后自动保存快照（复用编辑器/tauri 持久）
watch(
  moves,
  (m) => saveSnapshot(m.join(" ")),
  { deep: true },
);
```

- **影响**：移动日志是**显示用**的（i18n 文案 `hud.logMuted` = “（键盘/按钮产生的逐步动作）”，模板 `404-406` 行只渲染 chip），却被当成了**持久化来源**。用户连续转了 30 步后关闭应用，重开后 `loadSnapshot()` 恢复的只有最后 24 步 → **魔方被还原到一个错误的中间状态**，而且 UI 没有任何提示（状态栏只会显示硬编码的“已恢复上次进度”，见 #17）。清空进度前，用户不会知道自己丢步了。
- **修复**：把“完整状态序列”和“显示日志”拆成两个数据源，例如新增 `const fullMoves = ref<string[]>([])`（只追加不截断）用于 `saveSnapshot`，`moves` 继续只做渲染；或在 `logMove` 里对完整序列做持久化、对 `moves` 做截断。
- **工作量**：S（<1h）
- **置信度**：high（代码路径唯一且明确；`saveSnapshot` 全仓仅 GamePage 一处调用）

---

## 3. 设置页整对象回写覆盖标题栏改过的语言，语言下次启动静默回退

- **严重度**：high
- **分类**：状态管理 / 重复的全局状态
- **文件**：`src/vue/pages/KeymapPage.vue:38`、`134-140`、`197-221`；`src/vue/App.vue:44-49`
- **证据**：

```ts
// src/vue/pages/KeymapPage.vue:38（挂载时对整个 settings 对象做一次性快照）
const settings = ref(loadSettings());
```

```ts
// src/vue/pages/KeymapPage.vue:134-140 / 197-221（每次改动都把整份快照写回）
const cooldownMs = computed({
  get: () => settings.value.moveCooldownMs,
  set: (v: number) => {
    settings.value.moveCooldownMs = v;
    saveSettings(settings.value);   // ← 整对象回写
  },
});
...
const pickBase = (face: Face): void => {
  settings.value.baseFace = face;
  saveSettings(settings.value);     // ← 整对象回写
};
```

```ts
// src/vue/App.vue:44-49（标题栏改语言写的是“当前值 + locale”）
const onLocaleChange = (e: Event): void => {
  const v = (e.target as HTMLSelectElement).value;
  if (!isLocale(v)) return;
  setMotionCubeLocale(v);
  saveSettings({ ...loadSettings(), locale: v });
};
```

- **影响**：`App.vue` 写 `saveSettings({ ...loadSettings(), locale })`（读-改-写，正确），而 `KeymapPage` 持有的是**挂载时的旧快照**并整对象写回。复现路径：
  1. 打开「设置」页（此时快照里 `locale = "zh-CN"`）；
  2. 在标题栏把语言切成 English（localStorage 变为 `locale = "en"`，界面已是英文）；
  3. 在设置页动一下任意开关（底色 / 六色底 / 标尺 / 连击冷却）→ `saveSettings(settings.value)` 把**旧的 `locale: "zh-CN"` 一并写回**；
  4. 当前会话界面仍是英文（`localeRef` 未变），但 **localStorage 里已是中文** → 下次启动语言静默变回中文，且用户完全无从察觉。
- **修复**：`KeymapPage` 不要缓存整份 settings。改成每次写都 `saveSettings({ ...loadSettings(), <改的那个字段>: v })`，或把 `settings` 抽成 `src/settings.ts` 里的单一响应式 store（`settingsRef`），所有页面读同一份、写入走同一入口。
- **工作量**：M（~1 天，若顺便抽 store；若只改 KeymapPage 则 S）
- **置信度**：high（三方代码路径可静态推出完整复现链）

---

## 4. 页面层完全没有错误边界，渲染/3D 初始化异常 = 空白页且无恢复入口

- **严重度**：high
- **分类**：错误处理
- **文件**：`src/main.ts:24-28`、`src/vue/App.vue:151-157`；触发点 `src/hand/HandCalibView.ts:73`、`src/hand/HandOrbitView.ts:39`、`src/vue/pages/HandLabPage.vue:71`
- **证据**：

```ts
// src/main.ts:24-28（没有任何 errorHandler / errorCaptured）
const app = createApp(App);
app.use(router);
app.provide(i18nKey, i18n);
app.config.globalProperties.$t = i18n.t;
app.mount("#app");
```

```ts
// src/hand/HandCalibView.ts:73（WebGL 创建没有任何保护；GPU 禁用/驱动异常直接抛）
this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
```

全仓检索 `onErrorCaptured|errorHandler|window.onerror|unhandledrejection` → **0 命中**（src/vue、src/app、src/main.ts 全部没有）。
- **影响**：
  - 标定页 `onMounted` 里 `new HandCalibView(...)` 抛异常（WebGL context 创建失败 / 显卡驱动黑名单 / 远程桌面软件渲染被禁）→ Vue 只会把 “Unhandled error during execution of mounted hook” 打到 console，用户看到的是**两个空的黑框**，没有任何说明，也无法重试。
  - 页面组件**渲染期**抛错（`<script setup>` 顶层表达式、computed 里访问未定义数据）→ 生产构建下该子树不渲染 = **内容区全白**；开发模式下 Vue 的 `logError` 会重新抛出，可能把整个 app 拆掉。
  - Tauri 桌面版没有内置“重新加载”，用户只能重启进程；工作区里没有 `errorHandler` 兜底，也没有 `docs/todo.md` 记录该技术债。
- **修复**：
  1. `src/main.ts` 加 `app.config.errorHandler = (err, instance, info) => { console.error(...); showFatalFallback(err); }`，把错误渲染成一个壳内可见的降级面板（含“重试”按钮 `location.reload()`）；
  2. `HandCalibPage` / `HandLabPage` 的 WebGL 构造各自 try/catch，失败时在页面内显示可读提示（例如“无法创建 WebGL 上下文，请开启硬件加速”）；
  3. 页面组件外层套一个 `<ErrorBoundary>`（`onErrorCaptured`）以便单页失败不拖垮整壳。
- **工作量**：M（~1 天）
- **置信度**：medium-high（静态检索确认无任何兜底；“白屏”的具体表现随 Vue 版本/构建模式略有差异，但“静默失败、无恢复入口”这一结论是确定的）

---

## 5. 按键捕获吞掉全部键盘输入：Tab 被当成新按键绑定、Ctrl+C/F5 失效

- **严重度**：medium
- **分类**：可访问性 / 输入处理
- **文件**：`src/vue/pages/KeymapPage.vue:148-184`
- **证据**：

```ts
// src/vue/pages/KeymapPage.vue:156-177
  const onKey = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      spaceHeld = true;
      e.preventDefault();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    captureCleanup?.();
    captureCleanup = null;
    capturing.value = null;
    if (e.code === "Escape") return;
    const nb: KeyBinding = { code: e.code, shift: e.shiftKey, space: spaceHeld };
    if (scope.value === "editor") {
      editorActionCfg.value[row.action as EditorAction] = nb;
    } else if (row.isSpecial) {
      gameCfg.value.specials[row.action as SpecialAction] = nb;
    } else {
      gameCfg.value.moves[row.action] = nb;
    }
    persist();
  };
  window.addEventListener("keydown", onKey);
```

- **影响**：
  - 监听挂在 `window` 上，**捕获期间任何按键都被 `preventDefault()` 并当成新绑定写入**：`Tab` 会被绑定成某个动作（同时焦点无法移动）、`F5`/`Ctrl+R` 被拦（不能刷新）、`Ctrl+C`/`Ctrl+V` 被拦（不能复制粘贴）、`Alt+Tab` 也会被吞（部分环境下直接锁死窗口）。
  - 键盘用户进入捕获态后**无法用 Tab 退出**，唯一的“取消”是 Esc，而提示文案要用户先读到才可能知道（`keymap.captureHint`）。
  - 被误绑的 `Tab` 会写进 localStorage 键位表，在游戏页按下 Tab 就会触发该动作（`KeymapController.onKeyDown` → `player.applyMove`）。
- **修复**：
  1. 捕获态只接受“可绑定键”，对其余键（`Tab`、`F5`、`Escape`、带 `Ctrl/Alt/Meta` 的组合）**只 `stopPropagation()` 不 `preventDefault()`**，并把 `Escape` 显式设为“取消且不落盘”；
  2. 提供可见的“取消”按钮（目前只有文本提示），或在捕获态下把焦点锁到一个对话框容器上（`role="dialog"` + `aria-modal`），捕获结束归还焦点；
  3. 至少把 `Tab` 从可绑定集合里排除，并在 UI 上标出“不可绑定键”。
- **工作量**：M（~1 天）
- **置信度**：high（代码路径直接可读，行为无歧义）

---

## 6. 捕获过程中切换作用域会把游戏动作写进编辑器键位表

- **严重度**：medium
- **分类**：正确性 / 状态污染
- **文件**：`src/vue/pages/KeymapPage.vue:156-177`、`src/vue/pages/KeymapPage.vue:103-113`
- **证据**：

```ts
// src/vue/pages/KeymapPage.vue:168-175
    const nb: KeyBinding = { code: e.code, shift: e.shiftKey, space: spaceHeld };
    if (scope.value === "editor") {
      editorActionCfg.value[row.action as EditorAction] = nb;   // ← 用的是「此刻」的 scope
    } else if (row.isSpecial) {
      gameCfg.value.specials[row.action as SpecialAction] = nb;
    } else {
      gameCfg.value.moves[row.action] = nb;
    }
```

```ts
// src/vue/pages/KeymapPage.vue:103-113（冲突检测遍历对象全部键，伪键也会算进来）
  const seen = new Map<string, { binding: KeyBinding; actions: string[] }>();
  for (const [action, b] of Object.entries(editorActionCfg.value)) {
    const k = bindingKey(b);
    const entry = seen.get(k) ?? { binding: b, actions: [] };
    entry.actions.push(action);
    seen.set(k, entry);
  }
```

- **影响**：捕获开始时锁定的是某一行（`row`，含 `row.action` 与 `row.isSpecial`），但落盘时用的是**按键那一刻的 `scope.value`**。用户在“游戏键位”页点「修改」后，不按 Esc 而是直接点“编辑器键位”切换作用域，再按一个键 → `editorActionCfg.value["R"] = nb` 被写入一个**根本不是 EditorAction 的伪键**（`row.action` 是 `"R"` 这类公式符号）。后果：
  - 该伪键被 `saveEditorActionKeys` 写进 localStorage；
  - `conflicts` 计算把它算进去 → 设置页弹出**假的按键冲突警告**；
  - 该伪键会被 `EditorPage` 的键位控制器当成真实动作匹配（`KeymapController.resolve` 遍历 `Object.entries(cfg)`）。
  - 重新加载后 `deserializeEditorActions` 只保留 `EDITOR_ACTION_ORDER` 里的键（伪键被丢弃），所以是“本次会话内污染”，但用户会看到一条无法解释的冲突提示。
- **修复**：在 `startCapture` 里把「目标作用域 + 目标动作 + 目标集合」快照下来（`captureTarget = { scope, action, kind }`），落盘时用快照而不是实时 `scope.value`；同时在 `scope` 变化时调用 `stopCapture()`。
- **工作量**：S（<1h）
- **置信度**：high

---

## 7. 求解面板与标灰面板同位重叠，标灰面板被完全遮住

- **严重度**：medium
- **分类**：布局 / 溢出
- **文件**：`src/vue/pages/GamePage.vue:539-554`（`.solve-panel`）、`src/vue/pages/GamePage.vue:647-662`（`.gray-panel`）
- **证据**：

```css
/* src/vue/pages/GamePage.vue:539-554 */
.solve-panel {
  position: absolute;
  right: 12px;
  top: 118px;
  z-index: 28;
  width: 340px;
  max-height: calc(100% - 130px);
  overflow: auto;
  ...
}

/* src/vue/pages/GamePage.vue:647-662 */
.gray-panel {
  position: absolute;
  right: 12px;
  top: 118px;
  z-index: 28;
  width: 300px;
  max-height: calc(100% - 130px);
  overflow: auto;
  ...
}
```

模板中 `.gray-panel`（`359` 行）在 `.solve-panel`（`361-397` 行）**之前**，两者 `right/top/z-index` 完全相同 → 同层级下后渲染的 `.solve-panel`（340px 宽）整块盖住 `.gray-panel`（300px 宽）。
- **影响**：标灰（灰块/十字/桥式预设）是游戏页的核心功能之一。用户打开标灰面板后点「求解」，面板整个消失且无法找回（`toggleGray` 只切换 `hidden`，没有记忆），只能再点一次「标灰」把它开回来——但此时求解面板仍在，会再次被盖住，形成“看不到也点不着”的循环。
- **修复**：把两者错开（例如 `.solve-panel { top: 118px }`、`.gray-panel { top: 118px }` 改为纵向堆叠：求解面板 `right:12px`，标灰面板 `right:12px; top: calc(118px + <solve-panel 高>)`），或给求解面板单独一个停靠位（底部/左侧）；最小改法是求解面板 `top` 下移一个高度并让两者互斥显示。
- **工作量**：S（<1h）
- **置信度**：high

---

## 8. “视差: 关” 停不掉背景漂移与魔方自转；项目 CSS 无 `prefers-reduced-motion`

- **严重度**：medium
- **分类**：可访问性 / 文档漂移
- **文件**：`src/vue/pages/StartPage.vue:160-185`、`src/vue/components/PseudoCube3D.vue:52-54`、`src/vue/composables/useParallax.ts:4`、`README.md:71`
- **证据**：

```css
/* src/vue/pages/StartPage.vue:160-185 —— 5 条无限循环的漂移动画，与视差强度设置无关 */
/* 慢漂移：形状内层 CSS 动画，视差外层 JS transform，互不冲突 */
.bg-drift-a { top: 12%; left: 8%; animation: drift-a 52s ease-in-out infinite alternate; }
.bg-drift-b { bottom: 16%; left: 16%; animation: drift-b 64s ease-in-out infinite alternate; }
.bg-drift-c { top: 20%; right: 10%; animation: drift-c 46s ease-in-out infinite alternate; }
.bg-drift-d { bottom: 10%; right: 20%; animation: drift-d 58s ease-in-out infinite alternate; }
.bg-drift-e { top: 6%; right: 38%; animation: drift-e 70s ease-in-out infinite alternate; }
```

```css
/* src/vue/components/PseudoCube3D.vue:52-54 —— 魔方 40s 自转，同样不受设置控制 */
.cube-spin {
  animation: cube-spin 40s linear infinite;
}
```

```ts
// src/vue/composables/useParallax.ts:4（注释明确说“不受系统 reduced-motion 影响”，但没有任何替代兜底）
 * - 帧率无关 lerp（1-e^(-λΔt)）；强度由显式设置控制（不受系统 reduced-motion 影响）；强度=0 时暂停 rAF
```

```md
<!-- README.md:71 -->
- 可访问性：装饰层 `aria-hidden` + `pointer-events: none`；视差/自转/漂移强度由显式设置控制（不依赖系统 reduced-motion，可选择"视差: 关"停用）
```

- **影响**：`PARALLAX_SCALE[0] = 0` 只让 JS 视差输出恒为 0（`--par-u/--par-v` 归零），**CSS 漂移与魔方自转照跑**。README 承诺的“可选择『视差: 关』停用”实际上做不到；系统级 “减少动画” 也完全不被项目 CSS 响应（全项目 `src/` 内 `prefers-reduced-motion` 仅出现在 vendor 里，见 `src/vendor/winui-on-web/styles/animations.css:633`）。对前庭敏感/注意力障碍用户（含开启系统减少动画的用户）来说，首页是应用里唯一的“强制动效”入口，而唯一的缓解手段（视差开关）无效。
- **修复**：
  1. 在 `useParallax` 里把“强度=0”翻译成一个根节点 class（如 `html.parallax-off`），并在 `global.css` 里 `html.parallax-off .bg-drift-*, html.parallax-off .cube-spin { animation: none; }`；
  2. 额外加 `@media (prefers-reduced-motion: reduce) { .bg-drift-*, .cube-spin { animation: none !important; } }`，让系统设置成为兜底（README 的措辞同步改）；
  3. 或者把“视差”开关语义升级为“动效”开关（同时管漂移 + 自转 + 视差），i18n key 相应改名。
- **工作量**：M（~1 天，含文案与 i18n 调整）
- **置信度**：high（CSS 与 README 逐字可核）

---

## 9. `<html lang>` 固定 `zh-CN`，切英文后不更新

- **严重度**：medium
- **分类**：i18n / 可访问性
- **文件**：`index.html:2`、`src/vue/i18n.ts:36-39`、`src/preview.html:2`
- **证据**：

```html
<!-- index.html:2 -->
<html lang="zh-CN">
```

```ts
// src/vue/i18n.ts:36-39（切语言只改 ref 与模块目录，不动 documentElement.lang）
export function setMotionCubeLocale(locale: MotionCubeLocale): void {
  localeRef.value = locale;
  setLocale(locale);
}
```

全仓检索 `documentElement.lang` → **0 命中**（只有 vendor 的 `WinStandardUICommand.ts:40` 读取它）。
- **影响**：用户切到 English 后，文档语言声明仍是 `zh-CN`。屏幕阅读器会用中文语音/断句规则朗读英文界面；浏览器/翻译插件/拼写检查也会按中文处理；`lang` 还影响 `Intl`/字体回退与部分辅助技术的发音词典。这是切英文后立刻可感知但极难自查的一类问题。
- **修复**：在 `setMotionCubeLocale` 里加一行 `document.documentElement.lang = locale === "en" ? "en" : "zh-CN";`；同时 `src/preview/main.ts` 也走同一函数（它目前直接 `createMotionCubeI18n()`，没走 `setMotionCubeLocale`）。
- **工作量**：S（<1h）
- **置信度**：high

---

## 10. 页面层几乎无可访问名称，动态状态无 `aria-live`

- **严重度**：medium
- **分类**：可访问性
- **文件**：`src/vue/App.vue:130-133`、`src/vue/pages/GamePage.vue:311`、`333`、`src/vue/pages/LibraryPage.vue:326`、`353`、`374`、`src/vue/pages/KeymapPage.vue:229`、`src/vue/pages/HandCalibPage.vue:270`
- **证据**：

```html
<!-- src/vue/App.vue:130-133 —— 语言下拉框没有任何可访问名称 -->
      <select class="lang-select" :value="locale" @change="onLocaleChange">
        <option value="zh-CN">中文</option>
        <option value="en">English</option>
      </select>
```

```html
<!-- src/vue/pages/GamePage.vue:311 / 333 -->
        <WinTextBox v-model:Text="algText" class="hud-alg" :PlaceholderText="t('hud.algPlaceholder')" />
...
        <span id="hud-status" class="hud-status">{{ status }}</span>
```

```html
<!-- src/vue/pages/LibraryPage.vue:326 / 353 / 374 —— 只靠 placeholder 当标签 -->
        <input id="cat-name" v-model="catName" class="native-input" :placeholder="t('library.categoryName')" />
        <input id="f-name" v-model="fName" class="native-input" :placeholder="t('library.name')" />
        <input id="f-moves" v-model="fMoves" class="native-input moves-input" spellcheck="false" :placeholder="t('library.moves')" />
```

全仓检索 `aria-live|role="status"|role="alert"`（在 `src/vue`、`src/app` 内）→ **0 命中**（vendor 组件内部有）。
- **影响**：
  - 屏幕阅读器读这些控件只会得到 “edit / combo box”，**没有名字**（placeholder 不是 accessible name）；公式输入框、分类名/公式名/公式串、搜索框、语言下拉全部如此。
  - 状态反馈（`hud-status` “已应用 / 解析失败 / 已复制”、`#lib-status`、`#hand-status`、`.save-status`）是纯视觉的 `<span>`/`<div>`，辅助技术用户**听不到**任何结果反馈——包括“解析失败：…”这种必须知道的信息。
  - `WinSlider`（`id="speed"` / `id="scramble-speed"` / `id="cooldown-slider"`）也没有关联的 `<label for>`。
- **修复**：
  1. 给所有输入控件补 `<label for>`（可见或 `.sr-only`）或 `aria-label`；placeholder 保留作提示；
  2. 给 4 处状态区加 `role="status" aria-live="polite"`（错误态用 `role="alert"`）；
  3. 标题栏语言下拉加 `aria-label`（可用 `t('app.title')` 或新增 `app.language`）。
- **工作量**：M（~1 天）
- **置信度**：high（静态检索 + 逐处阅读；未做真实读屏器测试）

---

## 11. 手部标定页“标尺”开关不落盘，与设置页同概念双源真相

- **严重度**：medium
- **分类**：状态 / 数据契约
- **文件**：`src/vue/pages/HandCalibPage.vue:53`、`58-61`、`418`；对照 `src/vue/pages/KeymapPage.vue:207-213`、`327-328`
- **证据**：

```ts
// src/vue/pages/HandCalibPage.vue:53 —— 局部 ref，从 settings 读初值，但从不写回
const rulerEnabled = ref(loadSettings().rulerEnabled);
```

```html
<!-- src/vue/pages/HandCalibPage.vue:418 —— @Toggled 只作用于当前 3D 视图 -->
            <WinToggleSwitch v-model:IsOn="rulerEnabled" :OnContent="t('hand.rulerOn')" :OffContent="t('hand.rulerOff')" @Toggled="applyRuler" />
```

```ts
// src/vue/pages/KeymapPage.vue:207-213 —— 同一个概念的另一份、且真的落盘的实现
const rulerEnabled = computed({
  get: () => settings.value.rulerEnabled,
  set: (v: boolean) => {
    settings.value.rulerEnabled = v;
    saveSettings(settings.value);
  },
});
```

全仓检索 `saveSettings(` → 只有 `src/vue/App.vue:48` 与 `src/vue/pages/KeymapPage.vue`（4 处）；**HandCalibPage 一次都没有**。
- **影响**：标定页的“标尺”开关长得像一个设置，实则只对当前两个 3D 视图生效：切页回来即回到 `settings.rulerEnabled` 的旧值，用户以为保存了但没有。同时 `settings.rulerEnabled` 本身在别处也没人消费（游戏/编辑器都没有标尺），所以「设置」页那个“标尺默认显示”实际只影响标定页的初始状态 —— 一个开关有两个实现、两套语义。
- **修复**：二选一 —— 要么标定页开关直接写 `settings.rulerEnabled`（与 KeymapPage 共用同一 store），要么把标定页开关明确降级为“本次预览”并改文案/去掉开关外观，避免误导。
- **工作量**：S（<1h）
- **置信度**：high

---

## 12. CI 不跑 UI playtest、也不跑 `verify-solve-base.ts`，但 README/todo 声称已跑

- **严重度**：medium
- **分类**：CI 卫生 / 文档漂移 / 回归覆盖
- **文件**：`.github/workflows/ci.yml:1-38`、`README.md:36`、`docs/todo.md:75`、`scripts/verify-solve-base.ts:17`
- **证据**：

```yaml
# .github/workflows/ci.yml:28-38 —— 只跑 node 级脚本，playtest 完全没有
      - name: Verify data
        run: npx tsx scripts/verify-data.ts
      - name: Verify hand mesh
        run: npx tsx scripts/verify-hand-mesh.ts
      - name: Solver + render + coverage smoke (native Node, strip-types)
        run: |
          node scripts/smoke-solver.ts
          node scripts/smoke-solver-edge.ts
          node scripts/verify-render-cube.ts
          node scripts/verify-zbll-coverage.ts
```

```md
<!-- README.md:36 -->
├─ .github/workflows/      # CI（typecheck / build / verify / playtest）+ Release（tag 触发）
```

```md
<!-- docs/todo.md:75 -->
- ⬜ 双标题栏（decorations:false + 自绘标题栏）；对象级显隐与点选/命中交互规则统一；
  playtest 并入 CI（networkidle0 卡点解决后）。
```

```ts
// scripts/verify-solve-base.ts:17 —— 关键的多底多选语义明确声明「不验证」
 * 多色底多选（GamePage 对集合中每底分别求解取最短）为 UI 层语义，此处不验证。
```

- **影响**：
  - 页面层唯一的端到端回归是 `scripts/playtest-ui.mjs` / `scripts/playtest-solver.mjs`，**两者都不在 CI 里**，只在本地手动跑（且 todo 记录“因为 networkidle0 卡点还没并入 CI”）。因此任何页面层回归（路由切换、改键、求解面板、标灰）都可能在合并后才被发现。
  - `scripts/verify-solve-base.ts` 是纯 Node（作者注明“勿用 tsx；node 直跑”），本地跑是全绿的（已验证：`node scripts/verify-solve-base.ts` → `ALL PASS`），但 **CI 里没有它**，解法底这条高风险逻辑实际上处于“无自动回归”状态。
  - README 写 “CI（… / playtest）” 与实际不符。
- **修复**：把 `node scripts/verify-solve-base.ts` 加进 ci.yml 的 smoke 步骤（零成本、纯 Node）；playtest 并入 CI 需要先解决 networkidle0 卡点（改用 `domcontentloaded` + 显式 selector 等待），至少把 `playtest-ui.mjs` 放到 `pull_request` 上做人工触发；同步修 README 第 36 行。
- **工作量**：S（加一行 verify）+ M（playtest 入 CI）
- **置信度**：high

---

## 13. 死代码与遗留脚手架仍进生产构建

- **严重度**：medium
- **分类**：死代码 / 维护成本
- **文件**：`src/app/App.ts:1-11`、`src/router.ts:12-28`、`src/preview/*`、`vite.config.ts:19-24`
- **证据**：

```ts
// src/app/App.ts:1-11 —— 全文件；从未被任何地方 import
/**
 * 应用装配层：负责把魔方播放器、输入系统、时间线、库面板粘合在一起。
 * 当前为占位，后续由 main.ts 调用。
 */
export function createApp() {
  return {
    start() {
      console.log("[app] motion-cube started");
    },
  };
}
```

```ts
// src/router.ts:12-28 —— 轻量 hash 路由的三个函数全部无调用方（只有 Route 类型被 vue/router.ts 引用）
export function currentRoute(): Route { ... }
export function navigate(route: Route): void { ... }
export function onRouteChange(cb: (route: Route) => void): () => void { ... }
```

```ts
// vite.config.ts:19-24 —— preview.html 是正式构建的第二个入口
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        preview: fileURLToPath(new URL("./preview.html", import.meta.url)),
      },
    },
  },
```

```ts
// src/preview/router.ts:2-19 —— 所有路由都指向占位页
import PlaceholderPage from "./pages/PlaceholderPage.vue";
/** 与 motion-cube 现有 7 个路由对应（占位页），用于验证壳与导航。 */
export const PREVIEW_ROUTES: ... = [ { name: "start", ... }, ... ];
const routes: RouteRecordRaw[] = PREVIEW_ROUTES.map((r) => ({ path: `/${r.name}`, name: r.name, component: PlaceholderPage }));
```

- **影响**：
  - `src/app/App.ts` 是 11 行的占位 stub，注释说“后续由 main.ts 调用”，但 `src/main.ts` 用的是 Vue 的 `createApp`。它从未被 import（全仓检索无引用），README 第 19 行却把它描述成“应用装配（App.ts：路由表 / 壳布局 / 启动引导）” —— 文档与代码完全脱节。
  - `src/preview/*` 是“阶段 3 壳验证载体”，其 7 个路由全部指向 `PlaceholderPage`（只显示占位文案 + 一个 WinButton）。它作为 **第二个 rollup 入口**进生产构建 → `dist/preview.html`（已在 `dist/` 中确认存在）随安装包一起分发，用户打开会看到一个“所有页面都是占位”的空壳，且 `PREVIEW_ROUTES` 与 `APP_ROUTES` 两份导航表需要手工同步（已不同步：preview 没有 render-demo / hand-lab）。
  - `src/router.ts` 的三个导出函数是旧 vanilla 架构的遗留，现已由 vue-router 取代。
- **修复**：
  1. 删除 `src/app/App.ts`（或实现它并让 `src/main.ts` 真的用它），同步修 README 第 19 行；
  2. 删除 `src/router.ts` 中无用的三个函数，只保留 `Route` 类型（可整体移到 `src/vue/router.ts` 附近）；
  3. 把 `preview.html` 从 `vite.config.ts` 的 `build.rollupOptions.input` 移除（dev 下仍可用 `npm run dev` 访问 `/preview.html`，但不再进生产包），或直接把 `src/preview/*` 一并删除（WinUI 控件预览已由 vendor 自己的 gallery 覆盖）。
- **工作量**：S（<1h）
- **置信度**：high

---

## 14. 路由切换无焦点管理、无路由播报

- **严重度**：medium
- **分类**：可访问性
- **文件**：`src/vue/App.vue:151-157`
- **证据**：

```html
<!-- src/vue/App.vue:151-157 -->
      <router-view v-slot="{ Component }">
        <Transition name="page-fade" mode="out-in">
          <div class="mc-page-view" :key="route.fullPath">
            <component :is="Component" />
          </div>
        </Transition>
      </router-view>
```

- **影响**：
  - 切换页面后焦点仍停留在侧栏的导航项（`div role="button" tabindex=0`）上，**不会移动到新页面的标题/主内容**；键盘用户按 Tab 时，要重新遍历一遍侧栏才能进入正文。
  - 没有任何 `aria-live` 区域播报“已进入 XX 页”，屏幕阅读器用户切换后得不到任何确认。
  - 页面内容没有 `<main>` 语义地标（`.mc-page-view` 是普通 `div`），辅助技术无法用“跳到主内容”快捷键。
- **修复**：
  1. 把 `.mc-page-view` 换成 `<main tabindex="-1">`，在 `watch(route)` 后把焦点移到它（或页面标题）；
  2. 加一个视觉隐藏的 `aria-live="polite"` 区域，内容为 `t('nav.' + route.name)`，路由变化时更新；
  3. 若要更完整，可加 “跳到主内容” skip-link。
- **工作量**：M（~1 天）
- **置信度**：high

---

## 15. 求解为纯同步主线程执行，无进度反馈、无取消

- **严重度**：medium
- **分类**：性能 / 主线程阻塞
- **文件**：`src/vue/pages/GamePage.vue:220-249`、`src/vue/pages/GamePage.vue:361-363`
- **证据**：

```ts
// src/vue/pages/GamePage.vue:220-249
const doSolve = (): void => {
  if (!session || solving.value || demoRunning.value) return;
  cancelDemo();
  solving.value = true;
  solveResult.value = null;
  solveError.value = "";
  status.value = t("solve.solving");
  // 让状态栏/按钮先刷新，再跑同步求解（预热未完成时首解会建表 ~几百 ms）
  void nextTick(() => {
    try {
      const bases = solveBase.value.length ? solveBase.value : [loadSettings().baseFace];
      const method = methodOpts.resolveSolverMethod(solveMethod.value, solveOptions.value);
      let best: SolveResult | null = null;
      for (const b of bases) {
        const res = solveCube(currentState(), method, b);
        if (!best || res.moves.length < best.moves.length) best = res;
      }
      ...
```

```html
<!-- src/vue/pages/GamePage.vue:361-363 —— “求解中”只是一行静态文字 -->
    <div v-if="solving" class="solve-panel">
      <div class="solve-title">{{ t("solve.solving") }}…</div>
    </div>
```

- **影响**：整个求解（可能 N 个底各解一次）在一个同步块里跑完，主线程被占满 → 窗口无响应、动画卡住、无法取消。“求解中…”是纯文本、无动画、无 `aria-busy`，用户无法判断是卡死还是正在算。实测数据（只读脚本 `%TEMP%/mc-audit/bench-solve2.ts`）：
  - `prepareSolvers()` 预热全部 5 个方法 = **607ms**（其中 roux 单独 373ms）；预热只在 `requestIdleCallback(..., {timeout:2000})` 里做，用户若在页面打开后立刻点「求解」，建表成本就落在这次点击上；
  - 建表之后单次 CFOP 求解仅 0–4ms，6 个底合计 ~6ms —— 所以**真正卡顿的来源是首次建表，不是算法本身**。
  - 目前的预热方式浪费：GamePage 只提供 CFOP / Roux 两个入口，却预热了全部 5 个方法（含 `cfop-adv` / `roux-merge` / `roux-adv`）。
- **修复**：
  1. 预热只做当前方法：`prepareSolvers(resolveSolverMethod(...))`，避免 5 份表；
  2. 求解移入 Web Worker（或用 `setTimeout(0)` 分片），让「求解中」面板能出动画并支持取消；
  3. 面板加 `aria-busy="true"` 与一个不确定进度指示（spinner）。
- **工作量**：M（~1 天；Worker 化因为求解器是纯 TS 无 DOM 依赖，可行）
- **置信度**：high（耗时已实测）

---

## 16. 多底“取最短”指标不含 setup/endAlg 成本；解法底“空=跟随全局底”契约在 UI 不可达

- **严重度**：medium
- **分类**：正确性 / 契约
- **文件**：`src/vue/pages/GamePage.vue:230-241`、`src/cube/solver/methodOptions.ts:20-25`、`111-118`、`src/vue/components/SolverOptionsPanel.vue:49-58`
- **证据**：

```ts
// src/vue/pages/GamePage.vue:230-241
      const bases = solveBase.value.length ? solveBase.value : [loadSettings().baseFace];
      const method = methodOpts.resolveSolverMethod(solveMethod.value, solveOptions.value);
      let best: SolveResult | null = null;
      for (const b of bases) {
        const res = solveCube(currentState(), method, b);
        if (!best || res.moves.length < best.moves.length) best = res;   // ← 只比 moves
      }
      /* bases 恒非空（默认放全局底色上，面板最少保留一个底） */
```

```ts
// src/cube/solver/methodOptions.ts:20-25（文档承诺“空数组 = 跟随全局底色设置（默认）”）
 * 解法底（多色底 / 6 色底）：独立 localStorage key（motion-cube.solveBase），
 * 取值为**多选面集合** Face[]（多色底）；空数组 = 跟随全局底色设置（默认）。
```

```ts
// src/vue/components/SolverOptionsPanel.vue:52-58 —— 面板不允许清空到 0
const toggleBase = (f: Face): void => {
  const cur = bases.value;
  const has = cur.includes(f);
  if (has && cur.length === 1) return;      // ← 最后一项不可取消
  emit("update:solveBase", has ? cur.filter((x) => x !== f) : [...cur, f]);
};
```

```ts
// src/vue/pages/GamePage.vue:38-41 —— 挂载时就把空数组替换成非空，契约入口被堵死
{
  const loaded = methodOpts.loadSolveBases();
  solveBase.value = loaded.length ? loaded : [loadSettings().baseFace];
}
```

- **影响**：
  - “取最短”比的是 `moves.length`，**不含 `setupAlg`（1 步整块旋转）和 `endAlg`（0–2 步）**。选出来的“最短解”对用户演示时未必最短（多底各差 1–3 步）。
  - `solve.baseGlobal`（“跟随全局底”）i18n key 存在，但 UI 里没有任何入口；`DEFAULT_SOLVE_BASE = []` 的“空数组”语义被 GamePage 初始化 + 面板“最后一个不可取消”双重堵死 → 持久化的空数组状态永远无法在 UI 重建（除非手改 localStorage）。`SolverOptionsPanel` 注释“默认空 = 跟随全局底”因此是误导。
- **修复**：
  1. 比较指标改为 `moves.length + setupLen + endLen`（与用户感知的总步数一致）；
  2. 要么实现“跟随全局底”入口（在面板加一个 `solve.baseGlobal` 的可选项 / 允许清空到 0），要么删掉 `DEFAULT_SOLVE_BASE = []` 这条死契约并把注释改成实际语义；
  3. `solveBase` 的持久化语义（空 vs 非空）要有唯一来源，别在 GamePage 与 methodOptions 各写一份。
- **工作量**：S（<1h）
- **置信度**：high

---

## 17. 页面层硬编码中文绕过 i18n

- **严重度**：medium
- **分类**：i18n
- **文件**：`src/vue/pages/GamePage.vue:137`、`321`、`325`；`src/vue/pages/LibraryPage.vue:42`；`src/vue/pages/RenderDemoPage.vue:5-10`；`src/vue/pages/HandLabPage.vue:144-148`
- **证据**：

```ts
// src/vue/pages/GamePage.vue:137 —— 硬编码中文，未走 t()
    status.value = "已恢复上次进度";
```

```html
<!-- src/vue/pages/GamePage.vue:321 / 325 —— 单位写死中文 -->
          <WinTextBlock class="speed-label" :Text="`${t('hud.speed')} ${speed.toFixed(2)} s/步`" FontSize="13" />
          <WinTextBlock class="speed-label" :Text="`${t('hud.scrambleSpeed')} ${scrambleSpeed.toFixed(2)} s/步`" FontSize="13" />
```

```ts
// src/vue/pages/LibraryPage.vue:42 —— 标签建议写死中文
const TAG_SUGGESTIONS = ["CFOP", "Roux", "ZZ", "单手", "脚拧"];
```

- **影响**：切到 English 后，游戏页仍会出现“已恢复上次进度”“s/步”，公式库标签建议仍是“单手 / 脚拧”。两个调试页（RenderDemo / HandLab）整页中文且带硬编码深色主题（`background: #0b0e18`），与 app 的主题/材质切换完全不联动。整体上 en 目录（346 条）已与 zh-CN 完全对齐（已用只读脚本核对：`zh-CN 346 / en 346，仅在 zh-CN: 0，仅在 en: 0`），却仍留了一批绕过 i18n 的硬编码。
- **修复**：
  1. 新增 `hud.statusRestored`、`hud.unitPerStep` 等 key，把上述 3 处换成 `t(...)`；
  2. `TAG_SUGGESTIONS` 改为 i18n key 数组（`t('library.tagSuggestionSingleHand')` 等）；
  3. 两个调试页要么纳入 i18n，要么明确标注为“仅开发调试、不随语言切换”，并从生产构建里剔除（见 #13 / #18）。
- **工作量**：S（<1h）
- **置信度**：high

---

## 18. `RenderDemoPage` 用 `position: fixed` 逃离壳布局并盖住侧栏

- **严重度**：low
- **分类**：布局 / 死页面
- **文件**：`src/vue/pages/RenderDemoPage.vue:119-128`、`src/vue/router.ts:18`、`43`
- **证据**：

```css
/* src/vue/pages/RenderDemoPage.vue:119-128 */
.rdemo {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #0b0e18;
  color: #eaf0ff;
  font-family: system-ui, sans-serif;
}
```

```ts
// src/vue/router.ts:18-19 —— 调试页不进侧栏，但路由是公开的
  RenderDemoPage: () => import("./pages/RenderDemoPage.vue"), // R1 阶段1 渲染宿主调试验证页（不进侧栏）
  HandLabPage: () => import("./pages/HandLabPage.vue"), // 手部 low-poly A/B 对照调试页（不进侧栏）
```

- **影响**：其它页面都遵守“页面填满内容区（`height:100%`），详情区内部滚动”的约定（`LibraryPage/HandCalibPage/KeymapPage/HelpPage/HandLabPage` 都是 `height:100%; overflow:auto`）。`RenderDemoPage` 用 `position: fixed; inset: 0` 相对**视口**定位：`.win-nav-left-panel` 在 DOM 中位于 `.win-nav-content` 之前且为 `position: relative; z-index: auto`，而 fixed 后代不受 `.win-nav-shell { overflow: hidden }` 裁剪 → 该调试页的不透明背景会**覆盖整个侧栏内容区**，只剩标题栏（`z-index: 9999`）还在。用户从 `#/render-demo` 进站后无法用鼠标点侧栏导航离开，只能改 URL。
- **修复**：改成与其它页一致的 `position: absolute; inset: 0; height: 100%`（在 `.mc-page-view` 的定位上下文内），或直接 `height: 100%` + flex 布局。
- **工作量**：S（<1h）
- **置信度**：medium-high（基于 vendor 的 `.win-nav-shell` / `.win-nav-left-panel` / `.win-nav-content` 的定位与层叠规则推导，未做真机像素验证）

---

## 19. 模板渲染路径里调用 `loadSettings()`（每次重渲染读 localStorage + JSON.parse）

- **严重度**：low
- **分类**：性能
- **文件**：`src/vue/pages/GamePage.vue:354`
- **证据**：

```html
<!-- src/vue/pages/GamePage.vue:348-357 -->
    <SolverOptionsPanel
      v-if="optionsOpen && currentOptionGroup"
      id="solver-options"
      class="solve-options-float"
      v-model="solveOptions"
      :solve-base="solveBase"
      :global-base="loadSettings().baseFace"
      @update:solve-base="(b) => (solveBase = b)"
      :group="currentOptionGroup"
    />
```

- **影响**：`loadSettings()` 每次都 `localStorage.getItem` + `JSON.parse` + 逐字段校验（`src/settings.ts:110-139`）。在模板里直接调用 = **每次组件重渲染都同步读一次 localStorage 并解析 JSON**。GamePage 的重渲染频率不低（`moves` 每步一变、`status` 一变、`solveResult` 一变都会触发），求解/演示期间尤其频繁。主线程 I/O + JSON 解析本该只做一次。
- **修复**：把 `loadSettings().baseFace` 提到 `setup` 里算成 `const globalBase = computed(() => loadSettings().baseFace)` 或直接用 `settings` store 的响应式值（与 #3 一并处理最省事）。
- **工作量**：S（<1h）
- **置信度**：high

---

## 20. `t("solve.fail", { error })` 的文案没有 `{error}` 占位符，状态栏丢失错误详情

- **严重度**：low
- **分类**：i18n
- **文件**：`src/vue/pages/GamePage.vue:244`、`src/i18n/locales/zh-CN.ts:144`、`src/i18n/locales/en.ts:146`
- **证据**：

```ts
// src/vue/pages/GamePage.vue:242-245
    } catch (e) {
      solveError.value = (e as Error).message;
      status.value = t("solve.fail", { error: solveError.value });
    }
```

```ts
// src/i18n/locales/zh-CN.ts:144
  "solve.fail": "求解失败",
```

- **影响**：`{error}` 占位符在文案里不存在，参数被丢弃 → 状态栏只显示“求解失败”，**具体异常信息只出现在右侧求解浮层里**；而浮层的标题同样只写 `t("solve.fail")`，真实原因在下面的 `.solve-error` 里，视觉上容易看漏。solver 抛的典型信息是 `内部错误：求解结果未还原`（`src/cube/solver/solve.ts:195`），对用户定位问题很关键。
- **修复**：把文案改成 `"solve.fail": "求解失败：{error}"`（en: `"Solve failed: {error}"`），或让 `solve.fail` 保持短标题、另加 `solve.failDetail`。
- **工作量**：S（<1h）
- **置信度**：high

---

## 21. 8 个 i18n key + 1 段 CSS 已无引用

- **严重度**：low
- **分类**：死代码
- **文件**：`src/i18n/locales/zh-CN.ts:50-54`、`136`、`146`、`191`；`src/i18n/locales/en.ts:50-54`、`138`、`148`、`193`；`src/vue/pages/KeymapPage.vue:415-417`
- **证据**：全仓检索以下 key，除 locale 定义外**无任何引用**：
  `start.library`、`start.editor`、`start.hand`、`start.keymap`、`start.help`、`solve.methodCfopAdv`、`solve.baseGlobal`、`keymap.synced`。

```css
/* src/vue/pages/KeymapPage.vue:415-417 —— .scope-btn.sync 无对应元素 */
.scope-btn.sync {
  margin-left: auto;
}
```

- **影响**：8×2 条无用文案（zh + en 各 8 条 = 16 条）留在目录里；“同步按钮已移除”的历史痕迹（`keymap.synced` + `.scope-btn.sync`）仍在，容易让后续维护者以为还有同步功能（playtest 脚本里也有对应注释“同步按钮已移除”）。
- **修复**：删除这些 key 与死 CSS；或把 `solve.methodCfopAdv` 真正接进方法按钮（当前 UI 只有 CFOP / Roux 两个按钮，但 `methodOptions.ts` 已支持 `cfop-adv`）。
- **工作量**：S（<1h）
- **置信度**：high

---

## 22. 调试路由（render-demo / hand-lab）侧栏高亮错误项

- **severity**：low
- **分类**：正确性
- **文件**：`src/vue/App.vue:76-85`、`src/vue/router.ts:22-30`、`43-44`
- **证据**：

```ts
// src/vue/App.vue:80-85
const selectedNavigationItem = computed({
  get: () => navMenuItems.value.find((i) => i.Tag === route.name) ?? navMenuItems.value[0],
  set: (item) => {
    if (item?.Tag) void router.push({ name: item.Tag });
  },
});
```

- **影响**：`APP_ROUTES` 只有 7 项，不含 `render-demo` / `hand-lab`。当用户停在调试路由时，侧栏会高亮第 0 项（“返回 / start”），看起来像是当前在开始页 —— 状态显示与真实路由不符。点侧栏第 0 项才会真正跳走。
- **修复**：找不到匹配时返回 `undefined`（`SelectedItem` 允许空），或把调试路由也加进 `APP_ROUTES` 但用 `FooterMenuItems` 之类的方式隔离。
- **工作量**：S（<1h）
- **置信度**：high

---

## 23. 标定页 `syncInputs()` 用全局 `getElementById` 回写，会覆盖正在编辑的输入框

- **severity**：low
- **分类**：可维护性 / 输入
- **文件**：`src/vue/pages/HandCalibPage.vue:200-223`、`74-77`
- **证据**：

```ts
// src/vue/pages/HandCalibPage.vue:200-223（按 id 全局查询 DOM，并逐个覆盖 value）
const syncInputs = (): void => {
  for (const name of FINGER_ORDER) {
    for (let s = 0; s < FINGER_SEGMENTS[name]; s++) {
      const len = document.getElementById(`len-${name}-${s}`) as HTMLInputElement | null;
      ...
      if (len) len.value = cfg.value.fingers[name][s].length.toFixed(2);
```

```ts
// src/vue/pages/HandCalibPage.vue:74-77（在 3D 视图里拖标尺也会触发全量回写）
const onRulerAngleChange = (angle: number): void => {
  cfg.value.rulerAngle = angle;
  syncInputs();
};
```

- **影响**：`syncInputs()` 会把**所有**数值框的 `value` 重写为配置值。用户正在某个框里输入到一半（例如“0.7”打到“0.”），此时在 3D 视图里拖了一下标尺 → 全量回写把半成品输入抹掉。虽然页面注释说“保留旧版『输入中途不被回写打断』的行为”，但这条路径恰好会打断。另外用 `document.getElementById` 而不是 `ref`，绕开了 Vue 的响应式与作用域隔离（id 一旦与其它页面重名就会串页）。
- **修复**：`syncInputs()` 跳过 `document.activeElement` 所在的输入框；或改用模板 `ref` 数组逐个同步（避免全局 id 查询）。
- **工作量**：S（<1h）
- **置信度**：medium-high

---

## 24. 注释 / README 与代码漂移（3 处）

- **severity**：low
- **分类**：文档漂移
- **文件**：`README.md:19`、`README.md:36`（见 #12）、`src/vue/i18n.ts:26-30`
- **证据**：

```md
<!-- README.md:19 -->
│  ├─ app/                 # 应用装配（App.ts：路由表 / 壳布局 / 启动引导）
```

```ts
// src/vue/i18n.ts:26-30
const EXTRA: Record<Locale, Record<string, string>> = {
  "zh-CN": mcZhCN,
  // en 目录为空：先并入 zh-CN 保持 motion-cube 现有回退行为
  "en-US": { ...mcZhCN, ...mcEn },
};
```

- **影响**：
  - README 把 `src/app/App.ts` 描述成“应用装配（路由表 / 壳布局 / 启动引导）”，实际是 11 行 stub、从未被调用（真正的壳是 `src/vue/App.vue`）。新人按 README 找壳的入口会走错。
  - `src/vue/i18n.ts` 的注释“en 目录为空”已过时：`src/i18n/locales/en.ts` 有 346 条完整英文（已用只读脚本核对 zh/en key 完全对齐）。注释误导后续维护者以为英文目录需要补写。
- **修复**：改注释与 README 描述；把 `src/app/` 从 README 树里去掉或标注为“遗留占位，待删除”。
- **工作量**：S（<1h）
- **置信度**：high

---

## 25. `persist()` 的 `setTimeout` 未在卸载时清理

- **severity**：nit
- **分类**：资源
- **文件**：`src/vue/pages/KeymapPage.vue:127-132`
- **证据**：

```ts
// src/vue/pages/KeymapPage.vue:127-132
const persist = (): void => {
  if (scope.value === "game") saveKeymap(gameCfg.value);
  else saveEditorActionKeys(editorActionCfg.value);
  savedFlash.value = true;
  window.setTimeout(() => (savedFlash.value = false), 1200);
};
```

- **影响**：定时器句柄未保存也未在 `onBeforeUnmount` 清理；页面在 1.2s 内卸载时，回调仍会执行一次（对已卸载组件的 ref 赋值，Vue 3 不报错但属于无意义的工作），连续改键会堆积多个定时器。
- **修复**：保存 timer id，`onBeforeUnmount` 里 `clearTimeout`（该页已有 `onBeforeUnmount(stopCapture)` 钩子，直接扩展）。
- **工作量**：S（<1h）
- **置信度**：high

---

## 26. `useParallax` 只在挂载时读一次 `pointer: fine`，外接鼠标后视差不恢复

- **severity**：nit
- **分类**：边界
- **文件**：`src/vue/composables/useParallax.ts:14`、`110`
- **证据**：

```ts
// src/vue/composables/useParallax.ts:14
  const finePointer = window.matchMedia("(pointer: fine)");
...
// src/vue/composables/useParallax.ts:110
  if (!finePointer.matches) scale = 0;
```

- **影响**：`MediaQueryList` 没有监听 `change`。触屏/触控板设备上 `pointer: fine` 为 false → `scale = 0`，视差永久关闭；用户随后接入有线鼠标，视差也不会恢复，直到改动视差强度设置（`watch(parallaxIntensityRef, onSettingOrMotionChange)`）才会重新计算。同时 `scale === 0` 时 `onPointerMove` 直接 return，连 `--par-u/--par-v` 都不更新。
- **修复**：`finePointer.addEventListener("change", ...)`，变化时重算 `scale` 并 `start()`；`onScopeDispose` 里移除监听。
- **工作量**：S（<1h）
- **置信度**：high

---

## 验证记录（只读，未改动仓库任何文件）

| 脚本 | 目的 | 结果 |
|---|---|---|
| `%TEMP%/mc-audit/bench-solve.ts` | 六底求解耗时 / setupAlg / endAlg / “取最短”指标 | 单底 0–4ms；`best-by-moves` 与 `best-by-total` 在该样本一致；六底 endAlg 在标准 D 底时全为空 |
| `%TEMP%/mc-audit/bench-solve2.ts` | 分方法 prepare/solve 耗时 | `prepareSolvers()`=607ms（roux 单独 373ms）；建表后单次 solve ≤4ms；6 底合计 2–6ms |
| `%TEMP%/mc-audit/bench-endalg.ts` | 红底（R）实态下 endAlg 与复制串对比 | `copy centers != demo centers`（base=U / base=D 两例），证实 #1 |
| `%TEMP%/mc-audit/i18n-keys.ts` | zh-CN / en key 对齐 + 页面层 key 缺失 | zh 346 / en 346，双向差集为 0；页面层静态 `t()` key 无缺失 |
| `node scripts/verify-solve-base.ts`（仓库内既有脚本） | 解法底回归 | `ALL PASS`（该脚本未进 CI，见 #12） |

仓库状态：未修改、未新增、未删除任何仓库文件（`git status` 干净）；所有临时脚本位于 `%TEMP%/mc-audit/`。
