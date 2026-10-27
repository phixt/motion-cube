# infra 审计报告 — Build / CI / Tauri / tooling / 文档卫生

- 审计范围：`package.json`、`package-lock.json`、`vite.config.ts`、`tsconfig.json`、`.github/workflows/**`、`src-tauri/**`、`scripts/**`（42 个）、`tools/icon-lab/**`、`AGENTS.md`、`README.md`、`docs/*.md`
- 排除：`node_modules/`、`dist/`、`src-tauri/target/`、`spike-shots/`、`reference/`、`.reasonix/`、`src/vendor/winui-on-web`（第三方；仅在项目侧误用时记录）
- 方法：通读全部相关文件；对可无副作用执行的验证脚本逐个实跑并记录退出码；对 CI 声明的 4 条 `node` 命令逐条实跑复现；对文档中的每条具体断言回查源码/配置
- 只读保证：本次审计仅写入本文件 `docs/audit/infra.md`。审计过程中误跑 `scripts/extract-solver-data.mjs`（它会写仓库内文件，见 F7），已用 `git checkout -- src/cube/solver/algsRaw.ts src/cube/solver/f2lTable.ts` 完整还原；`git status` 现无已跟踪文件的改动。未执行 `npm install`、未启动 dev server、未 commit/branch/stash。
- 运行环境：Windows，Node v24.18.0，npm 11.16.0，rustc 1.96.1

---

## 实跑验证记录（用于给发现背书）

| 命令 | 结果 |
|---|---|
| `node scripts/smoke-solver.ts` | exit 0（3 迭代 × 3 方法全 OK） |
| `node scripts/smoke-solver-edge.ts` | exit 0（22 断言全 OK） |
| `node scripts/verify-render-cube.ts` | exit 0（PASS 22 / FAIL 0） |
| `node scripts/verify-zbll-coverage.ts` | exit 0（ALL PASS，493/493） |
| `npx tsx scripts/verify-data.ts` | exit 0（ALL PASS） |
| `npx tsx scripts/verify-hand-mesh.ts` | exit 0（ALL PASS ✓） |
| `npm run typecheck` | exit 0 |
| `npm ci --dry-run` | exit 0（lock 与 package.json 依赖集一致） |
| `node scripts/verify-solve-base.ts` | exit 0（ALL PASS）**← 不在 CI** |
| `node scripts/probe-solve-base-ui.ts` | exit 0（22 pass / 0 fail）**← 不在 CI** |
| `node scripts/verify-zbls-rounds.ts` | exit 0（2603 轮 / 0 失败）**← 不在 CI** |
| `node scripts/find-zbls-diff-3.ts` | exit 0 **← 不在 CI** |
| `node scripts/probe-locale-keys.ts` | exit 0（en/zh 无缺项）**← 不在 CI** |
| `node scripts/verify-notation.mjs` | exit 0（ALL PASS）**← 不在 CI** |
| `node scripts/probe-solver-methods.ts` | **exit 1**（ERR_MODULE_NOT_FOUND，见 F16） |
| `node scripts/extract-solver-data.mjs` | exit 0，但**改写了 2 个已跟踪源码文件**（见 F7） |

结论：CI 中已有的 4 条 `node` 校验命令确实能跑通且结果为绿；真正的问题不是"CI 跑不起来"，而是 **CI 跑得太少**，且**文档描述的 CI 与 Release 流程与仓库实际内容不符**。

---

## 发现汇总

| # | 标题 | 严重度 | 分类 | 文件 | 行 | 工作量 | 置信度 |
|---|---|---|---|---|---|---|---|
| F1 | 根本不存在 Release workflow，README/AGENTS/todo 均声称存在 | high | doc-vs-code drift | README.md / AGENTS.md / docs/todo.md | 12,36,13,111-112 | M | high |
| F2 | CI 没有 playtest job，README/AGENTS 却声称有（todo 说法相反） | high | doc-vs-code drift | .github/workflows/ci.yml / README.md / AGENTS.md / docs/todo.md | 8-44,36,13,75 | M | high |
| F3 | headless CI playtest 目前不可行：3 个结构性阻塞点 | high | CI / tooling | scripts/playtest-ui.mjs 等 20 个 | 8-9,108-109 | M | high |
| F4 | `three` / `@types/three` 被直接引用却未声明 | high | dependency hygiene | package.json | 13-28 | S | high |
| F5 | CI 无任何 Rust/Tauri 任务，桌面端从未在 CI 编译过 | high | CI | .github/workflows/ci.yml | 8-44 | S | high |
| F6 | 6 个确定性校验脚本全绿却都不在 CI | high | CI coverage | scripts/verify-solve-base.ts 等 | — | S | high |
| F7 | `extract-solver-data.mjs` 用仓库外硬编码路径静默覆写已跟踪源码 | medium | tooling safety | scripts/extract-solver-data.mjs | 5,25,36 | S | high |
| F8 | `node scripts/*.ts` 约定不可强制：源码已含 Node strip-types 拒绝的语法 | medium | correctness / maintainability | src/cube/GrayOverlay.ts | 28 | S-M | high |
| F9 | `playtest-spike.mjs` 使用已不存在的 `#alg-input`，属 provably-broken 遗留脚本 | medium | dead code | scripts/playtest-spike.mjs | 60,63,115 | S | high |
| F10 | Tauri CSP 关闭 + NSIS 安装包未签名 + 仅 Windows 目标 | medium | security / config | src-tauri/tauri.conf.json | 26-28,30-34,48-51 | M | high |
| F11 | 完全没有单元测试运行器（提出零依赖最小方案） | medium | test coverage | package.json | 6-12 | M | high |
| F12 | `Cargo.toml` 版本 0.1.0 —— 第三份无人管的版本号副本 | medium | version drift | src-tauri/Cargo.toml | 3 | S | high |
| F13 | `docs/solver-baseline.json` 是已提交的金标准文件但陈旧且无强制校验 | medium | test coverage | docs/solver-baseline.json / scripts/record-solver-baseline.ts | 2 / 137 | S | high |
| F14 | 无 `engines`、无 Node 版本钉死，CI 用浮动 `node-version: 22` | medium | dependency / CI hygiene | package.json / .github/workflows/ci.yml | 4-12 / 20 | S | high |
| F15 | 3 个脚本默认落到 5173（用户保留端口），其中 2 个被 README 当作 QA 命令 | medium | correctness | scripts/shot-shell.mjs, shot-preview.mjs, verify-drag.mjs | 40,35,11 | S | high |
| F16 | `probe-solver-methods.ts` 用无扩展名 import，在项目自己的 node 约定下必崩 | low | maintainability | scripts/probe-solver-methods.ts | 4-5 | S | high |
| F17 | `package-lock.json` 根版本仍是 0.1.0 | low | dependency hygiene | package-lock.json | packages[""].version | S | high |
| F18 | Rust 侧 `serde` / `serde_json` 为无用依赖 | low | dead code | src-tauri/Cargo.toml | 16-19 | S | high |
| F19 | 仓库根目录遗留一次性探针；两个已提交数据文件无人引用 | low | dead code | .research_zbll_probe.mjs, data/samples/* | 1-10 | S | high |
| F20 | todo.md 称 `reference/` 已入库，实际被 gitignore | low | doc-vs-code drift | docs/todo.md / .gitignore | 45 / 48 | S | high |
| F21 | hand-api-spec 禁改清单含不存在的文件，且写错 dev server 端口 | low | doc-vs-code drift | docs/hand-api-spec.md | 61,68 | S | high |
| F22 | 2 个脚本硬编码 URL 忽略 `SPIKE_URL`；`--disable-gpu` 使截图失去意义 | low | tooling | scripts/probe-render.mjs, shot-hand-calib-debounce.mjs | 16 / 12,16-17 | S | high |
| F23 | `vite.config.ts` 端口 5173 与项目自订端口规则冲突 | low | doc-vs-code drift | vite.config.ts / README.md | 8 / 45 | S | medium |
| F24 | CI 重复执行两次全量类型检查 | nit | CI efficiency | .github/workflows/ci.yml | 26-30 | S | high |
| F25 | CI workflow 缺 `permissions:` 与 `concurrency:` | nit | CI hygiene | .github/workflows/ci.yml | 1-44 | S | high |
| F26 | AGENTS.md 对同一条命令同时写 `node` 与「（tsx）」，运行器含糊 | nit | doc-vs-code drift | AGENTS.md | 52 | S | high |

---

# F1 — 根本不存在 Release workflow，但三份文档都声称存在

**严重度**：high  **分类**：doc-vs-code drift  **文件**：README.md:12,36；AGENTS.md:12-13；docs/todo.md:111-112  **工作量**：M  **置信度**：high

## 证据（逐字）

`README.md:12`
```
- 桌面版：Tauri 2（NSIS 打包，tag 触发 Release CI）
```

`README.md:36`
```
└─ .github/workflows/      # CI（typecheck / build / verify / playtest）+ Release（tag 触发）
```

`AGENTS.md:12-13`
```
- **自动化（GitHub Actions）**：已配置；已加 .github/workflows（CI:
  typecheck/build/verify/playtest；发布: tag 触发 tauri 打包上传 Releases）
```

`docs/todo.md:111-112`
```
- 提交：不 amend、不擅自 push、不打 tag（tag 触发 Release CI）；功能/修复提交时
  评估 bump
```

实际仓库内容：
```
$ find .github -type f
.github/workflows/ci.yml
```

且 git 历史证明 Release workflow **从未存在过**：
```
$ git log --all --diff-filter=A --name-only --format="%h" -- ".github/workflows/*"
a2798a4
.github/workflows/ci.yml
```

## 影响

发布流程是 100% 手工的：`docs/todo.md:10` 自己写明"本地编译已交付，发布由用户执行"。但 README/AGENTS 把"打 tag → CI 打包 → 上传 Releases"写成了既定事实，并且 AGENTS.md 把它列为**项目记忆**（下一轮接手的人/代理会直接照做）。按文档执行"bump → 打 tag → push"的用户会发现：没有任何安装包被发布出来，而 tag 已经消耗掉了（GitHub tag 不可重用，需要再打一个）。同时 `.github/workflows/ci.yml` 的触发条件是 `on: push: branches: [main]`，即使补了 Release job 也要显式加 `tags:`。

## 修复

二选一，但必须做完其中一件：

1. **补齐流水线**（推荐）：新增 `.github/workflows/release.yml`
   ```yaml
   on:
     push:
       tags: ['v*']
   jobs:
     release:
       runs-on: windows-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 22, cache: npm }
         - run: npm ci
         - run: npm run tauri build
         - uses: actions/upload-artifact@v4
           with:
             name: nsis
             path: src-tauri/target/release/bundle/nsis/*.exe
   ```
   并把 `on: push: branches: [main]` 保留在 ci.yml（tag 不触发 ci.yml，需给 ci.yml 加 `tags-ignore: ['v*']` 或用 `branches` 过滤）。同时要处理 F10 的签名问题，否则产物是未签名安装包。
2. **改文档**：把 README:12 / README:36 / AGENTS.md:12-13 / todo.md:111-112 中"tag 触发 Release CI"的表述全部改成"发布为手工流程：`npm run tauri build`，产物在 src-tauri/target/release/bundle/nsis/，由维护者上传 Release"。

---

# F2 — CI 没有 playtest job，README/AGENTS 声称有，todo 却说还没有

**严重度**：high  **分类**：doc-vs-code drift  **文件**：.github/workflows/ci.yml:8-44；README.md:36；AGENTS.md:12-13；docs/todo.md:74-75  **工作量**：M  **置信度**：high

## 证据（逐字）

`docs/todo.md:74-75`（**唯一正确的说法**）
```
- ⬜ 双标题栏（decorations:false + 自绘标题栏）；对象级显隐与点选/命中交互规则统一；
  playtest 并入 CI（networkidle0 卡点解决后）。
```

`README.md:36`
```
└─ .github/workflows/      # CI（typecheck / build / verify / playtest）+ Release（tag 触发）
```

`AGENTS.md:12-13`
```
- **自动化（GitHub Actions）**：已配置；已加 .github/workflows（CI:
  typecheck/build/verify/playtest；发布: tag 触发 tauri 打包上传 Releases）
```

而 `.github/workflows/ci.yml` 只有一个 job：
```yaml
jobs:
  check:
    name: Typecheck + Build + Verify
    runs-on: ubuntu-latest
    timeout-minutes: 15
```
步骤仅有 Checkout / Setup Node / Install dependencies / Typecheck / Build / Verify data / Verify hand mesh / Solver + render + coverage smoke —— **没有任何 playtest 步骤，也没有 `npx playwright`/`puppeteer` 依赖安装**。

## 影响

三层含义：

1. **文档互斥**：README/AGENTS 说"CI 含 playtest"，todo 说"playtest 尚未并入 CI（卡在 networkidle0）"。三份文档中两份是错的，且错的是被最常阅读的两份。
2. **实际质量损失**：UI 层（路由、按键改绑、灰面板、时间轴关键帧、公式库增删）**没有任何自动回归网**。整个应用是 Vue SPA，UI 回归只能靠 Windows 本地手点。
3. **误导 CI 状态**：看到 README 会以为 UI 已被覆盖，实际 `git log` 显示 CI 只加过纯逻辑校验（`a2798a4` 加 typecheck/build/verify，`59d7751` 加 4 条 smoke，`50c2547` 加 verify-hand-mesh）。

## 修复

- 立刻：把 README.md:36 与 AGENTS.md:12-13 的 "CI: typecheck/build/verify/playtest" 改成 "CI: typecheck/build/verify（playtest 待并入，见 docs/todo.md）"。
- 随后：按 F3 的方案真正补上 playtest job。若短期不做，就让 todo.md:75 的条目保持 ⬜ 并写明阻塞原因（F3 已定位）。

---

# F3 — headless CI playtest 目前不可行：三个结构性阻塞点

**严重度**：high  **分类**：CI / tooling  **文件**：scripts/playtest-ui.mjs:8-9,108-109；scripts/shot-shell.mjs:40；scripts/shot-preview.mjs:36  **工作量**：M  **置信度**：high

## 证据（逐字）

**(a) 没有任何脚本会启动 dev server。** 全仓 `scripts/` 中没有一处 spawn vite：
```
$ grep -rn "spawn\|execFile" scripts/*.mjs
scripts/fetch-cuberoot.mjs:5:import { execFileSync } from "node:child_process";
scripts/fetch-cuberoot.mjs:15:const raw = execFileSync("curl.exe", ...
scripts/sync-winui.mjs:19:import { execFileSync } from "node:child_process";
scripts/sync-winui.mjs:42:execFileSync(cmd, args, ...
```
README.md:77 也确认了前置条件：
```
node scripts/playtest-ui.mjs        # 完整 UI 流程回归（需先起 dev server，可用 SPIKE_URL 指定地址）
```

**(b) 20 个脚本把浏览器路径硬编码为 Windows 路径。** `scripts/playtest-ui.mjs:8-9`
```js
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
```
同样的两行出现在 `measure-hand.mjs`、`playtest-solver.mjs`、`playtest-spike.mjs`、`probe-render-dispose.mjs`、`probe-render.mjs`、`render-shot.mjs`、`shot-editor-barehand.mjs`、`shot-editor-hand.mjs`、`shot-game-cubing.mjs`、`shot-game-render.mjs`、`shot-hand-calib-debounce.mjs`、`shot-hand-calib.mjs`、`shot-hand-lab.mjs`、`shot-preview.mjs`、`shot-shell.mjs`。而依赖是 `puppeteer-core`（不自带浏览器），所以在 ubuntu-latest 上 `executablePath` 指向一个不存在的文件 → 启动即失败。

**(c) `networkidle0` 就是 todo 记录的卡点，且根因不是 networkidle0 本身。** `scripts/playtest-ui.mjs:108-109`
```js
await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
await page.reload({ waitUntil: "networkidle0", timeout: 30000 }); // 预热 Vite 依赖优化，规避 Outdated Optimize Dep
```
第 109 行的注释暴露了真正的竞态：**冷启动时 Vite 的依赖预打包会触发整页 reload**（"Outdated Optimize Dep"）。`goto` 在 reload 之前就 resolve 了，于是脚本拿到的是"即将被丢弃的旧页面"的元素句柄。`networkidle0` 只是把这个 reload 竞态放大成 30s 超时。

**同一仓库里已经有更稳的写法**，说明这个坑是已知的：
```
scripts/shot-shell.mjs:54:  await page.goto(`${base}/#/${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
scripts/shot-preview.mjs:36:await page.goto(`${base}/preview.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
scripts/measure-hand.mjs:31:await page.goto(`${URL}#/library`, { waitUntil: "domcontentloaded", timeout: 30000 });
```
另外应用本身**不发起任何网络请求**（`grep -rn "fetch(\|EventSource\|new WebSocket" src/` 无结果），所以 `networkidle0` 的"零网络"条件本来就没必要。

## 影响

- todo.md:75 的"playtest 并入 CI"**不是一个待修的 bug，而是一项尚未开始的工程**：不做上面三条改造，playtest job 加进 CI 只会立刻红。
- 即使强行加上，Vite 冷启动 reload 竞态会让 job 在不同 runner 上时红时绿（flaky），这类 flaky CI 比没有 CI 更消耗信任。
- 用户影响面：所有 UI 回归（按键改绑、灰面板、时间轴、公式库）目前 100% 依赖人工。

## 修复

1. **浏览器解析跨平台化**（一次性改 20 处，建议抽 `scripts/_browser.mjs`）：
   ```js
   const executablePath = process.env.CHROME_PATH
     ?? (process.platform === "win32" ? (existsSync(CHROME) ? CHROME : EDGE) : undefined);
   // puppeteer-core 无浏览器时传 undefined 会报清晰错误；CI 里用
   // browser-actions/setup-chrome@v1 装 Chrome 后设 CHROME_PATH
   ```
2. **CI 里自己起 server**：`npm run dev -- --port 5174 --strictPort &`，然后 `npx wait-on http://127.0.0.1:5174/ -t 60000`（或一个 5 行轮询脚本），再 `SPIKE_URL=http://127.0.0.1:5174/ node scripts/playtest-ui.mjs`。
3. **把 `networkidle0` 换成 `domcontentloaded` + 显式元素等待**（脚本第 110 行本来就有 `await page.waitForSelector(".start-page")`），并删掉第 109 行那次手工 `reload()` —— 或者改成"先 `waitForSelector` 再断言"，让 reload 后重试。
4. **用 `windows-latest` 跑 playtest job**：脚本依赖 `--enable-unsafe-swiftshader --use-angle=swiftshader` 做软件 WebGL，Windows 上的行为与本地一致，能消除 swiftshader 版本差异带来的渲染断言漂移。

---

# F4 — `three` / `@types/three` 被直接 import（src/ 12 处 import、10 个文件；另 2 处在 scripts/），却未在 package.json 声明

**严重度**：high  **分类**：dependency hygiene  **文件**：package.json:13-28  **工作量**：S  **置信度**：high

## 证据（逐字）

`package.json:13-28`
```json
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
——**没有 `three`，也没有 `@types/three`**。

直接 import `three` 的位置（`src/` 12 处 import 分布在 10 个文件，`scripts/` 另有 2 处）：
```
src/cube/CubePlayer.ts:2:import type { Object3D } from "three";
src/cube/GrayOverlay.ts:6:import { Vector3, type Mesh, type Object3D } from "three";
src/cube/render/RenderCube.ts:40:} from "three";
src/cube/render/RenderCubeHost.ts:34:} from "three";
src/hand/HandCalibView.ts:18:} from "three";
src/hand/handMesh.ts:30:} from "three";
src/hand/handMesh.ts:31:import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
src/hand/HandOrbitView.ts:15:} from "three";
src/hand/HandOrbitView.ts:16:import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
src/hand/HandRigView.ts:18:} from "three";
src/vue/pages/EditorPage.vue:11:import { Euler, Quaternion } from "three";
src/vue/pages/HandLabPage.vue:11:import { Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";
scripts/gen-samples.ts:5:import { Euler, Quaternion } from "three";
scripts/verify-hand-mesh.ts:7:import { Box3 } from "three";
```

它们完全靠 **cubing 的传递依赖被提升** 才能解析：
```
$ npm ls three
motion-cube@0.4.1 D:\P_rojects\motion-cube
`-- cubing@0.63.3
  `-- three@0.170.0

$ npm ls @types/three
motion-cube@0.4.1 D:\P_rojects\motion-cube
`-- cubing@0.63.3
  `-- @types/three@0.169.0
```
而 `three` 包本身**不提供类型**：
```
$ node -e "console.log(require('./node_modules/three/package.json').types)"
NONE
```
即 `import type { Object3D } from "three"` 的类型完全来自被提升到顶层的 `@types/three@0.169.0`——那是 cubing 顺手带进来的。cubing 的声明为：
```json
"dependencies": {
  "@types/three": "^0.169.0",
  "three": "^0.170.0"
}
```
注意 `three@0.170.0` 与 `@types/three@0.169.0` **版本已经错开一档**。

## 影响

- **构建可被上游单方面打断**：cubing 只要把 `three` 移到 `peerDependencies`、或升级 `@types/three` 到 0.170（该版本有 breaking change），`npm ci` 装出的树里 `node_modules/@types/three` 消失，`vue-tsc` 立刻报 `Could not find a declaration file for module 'three'`，**整个项目 typecheck 失败**。项目对此毫无控制权。
- **双副本风险**：一旦项目自己声明 `three` 而版本与 cubing 的区间不重叠，npm 会把 cubing 的那份嵌套到 `node_modules/cubing/node_modules/three`，运行时出现两份 three 实例 → `instanceof Object3D` / `instanceof Mesh` 判定失败，three 内部行为诡异（这类 bug 极难定位）。
- **审计/许可视角**：`three` 是直接依赖却不在 manifest 里，`npm ls --depth=0` 看不到它，许可证清单与依赖审计工具都会漏项。
- `scripts/verify-hand-mesh.ts` 和 `scripts/gen-samples.ts` 同样直接 import `three` —— **CI 的一条 gate 依赖一个未声明的包**。

## 修复

```json
"dependencies": {
  "@tauri-apps/api": "^2.11.1",
  "cubing": "^0.63.3",
  "three": "^0.170.0",
  "vue": "^3.5.41",
  "vue-router": "^4.6.4"
},
"devDependencies": {
  "@types/three": "^0.169.0",
  ...
}
```
然后 `npm install` 刷新 lock（会顺带修掉 F17 的 lock 版本），并把 `three` 与 `@types/three` 对齐到同一 minor（0.170.x 有对应 `@types/three@0.170.x`），避免长期的类型/运行时错位。

---

# F5 — CI 没有任何 Rust/Tauri 任务，桌面端从未在 CI 编译过

**严重度**：high  **分类**：CI  **文件**：.github/workflows/ci.yml:8-44  **工作量**：S  **置信度**：high

## 证据（逐字）

`.github/workflows/ci.yml` 全文只有 44 行，唯一 job：
```yaml
jobs:
  check:
    name: Typecheck + Build + Verify
    runs-on: ubuntu-latest
    timeout-minutes: 15
```
全部步骤：
```
14:      - name: Checkout
17:      - name: Setup Node
23:      - name: Install dependencies
26:      - name: Typecheck
29:      - name: Build
32:      - name: Verify data
35:      - name: Verify hand mesh
38:      - name: Solver + render + coverage smoke (native Node, strip-types)
```
—— 没有 `dtolnay/rust-toolchain`，没有 `cargo check`，没有 `cargo build`，没有 `cargo test`，也没有 `tauri build`。

而 Rust 侧是有实质内容的（`src-tauri/Cargo.lock` 已提交，锁定了 `tauri 2.11.5`、`tauri-build 2.6.3`）：
```
$ grep -A2 '^name = "tauri"$' src-tauri/Cargo.lock
name = "tauri"
version = "2.11.5"
```
`src-tauri/Cargo.toml:14` 的 `tauri-build = { version = "2", features = [] }` 与 `tauri = { version = "2", features = [] }` 都是浮动大版本号。

## 影响

- `npm run tauri build` 只在**发版那一刻**由维护者本地执行。tauri 升级、conf schema 变更、Cargo.toml 任何编辑导致的编译失败，要等到打 tag 那一刻才暴露 —— **tag 已经消耗、版本号已经 bump**。
- `tauri = "2"` 是浮动范围，`cargo update` 随时可能引入 breaking 的 2.x 小版本；没有 CI 就没有任何信号。
- Windows-only 的 NSIS 打包链（WiX/NSIS 工具链）从来没有被自动验证过，`tauri.conf.json` 的 bundle 配置错误（如 `icon` 列表缺文件）也只在本地打包时才炸。

## 修复

新增第二个 job：
```yaml
  rust:
    name: Tauri (cargo check)
    runs-on: windows-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with: { components: clippy, rustfmt }
      - uses: Swatinem/rust-cache@v2
        with: { workspaces: src-tauri }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build          # frontendDist 需要存在
      - run: cargo check --manifest-path src-tauri/Cargo.toml
      - run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```
再把 F1 的 release job 挂上来，桌面端就真正有回归网了。

---

# F6 — 6 个确定性校验脚本全绿，却都不在 CI

**严重度**：high  **分类**：CI coverage  **文件**：scripts/verify-solve-base.ts、scripts/probe-solve-base-ui.ts、scripts/verify-zbls-rounds.ts、scripts/find-zbls-diff-3.ts、scripts/probe-locale-keys.ts、scripts/verify-notation.mjs  **工作量**：S  **置信度**：high

## 证据（逐字）

这些脚本都以 exit code 表达成败、无需浏览器、无需网络、无需 dev server —— 正是 CI gate 的理想形态，但 `.github/workflows/ci.yml` 里一个都没有。实跑结果：

```
$ node scripts/verify-solve-base.ts
PASS A6b roux 红底实态 U 底收尾停在所选底朝向
ALL PASS — 解法底 verify（六色底视觉旋转+relabel 求解全还原）
EXIT=0

$ node scripts/probe-solve-base-ui.ts
=== 结果：22 pass / 0 fail ===
EXIT=0

$ node scripts/verify-zbls-rounds.ts
== 汇总：2603 轮，失败 0 项 ==
ALL PASS ✓（数据层 302 口径 + 表基线不变 + ZBLS/ZBLL 端到端实证）
EXIT=0

$ node scripts/find-zbls-diff-3.ts
== 结论：O 组 3 条已剔除数据层（留档可溯）→ 有效 ZBLS 全集 = 302，与 mihlefeld 一致 ==
EXIT=0

$ node scripts/probe-locale-keys.ts
en 缺项（zh 有 en 无）: 无
zh 缺项（en 有 zh 无）: 无
EXIT=0

$ node scripts/verify-notation.mjs
PASS 非法输入抛错  →  ok
ALL PASS
EXIT=0
```
最后一条还被 README.md:76 当作正式 QA 命令列出：
```
node scripts/verify-notation.mjs    # 记法解析/序列化自检（纯 Node）
```

## 影响

| 脚本 | 守护的东西 | 回归时的用户影响 |
|---|---|---|
| `verify-solve-base.ts` | 解法底多选（整块旋转 + 中心 relabel） | "求解后停在错误的底色上"，魔法方停在非约定朝向，教程/演示不可用 |
| `probe-solve-base-ui.ts` | 22 条 UI 语义情景矩阵 | 多选底时选错面、演示结束停错底 |
| `verify-zbls-rounds.ts` | ZBLS 302 口径 + 表基线 268/1696 + 2603 轮端到端 | ZBLS 命中失效 → 一步 ZBLL 求解回退，步数暴涨 |
| `find-zbls-diff-3.ts` | "全槽已解"形必须为 0 | O 组 3 条回潮 → 求解器把非 ZBLS 状态当 ZBLS 处理 |
| `probe-locale-keys.ts` | en/zh key 对齐 | 新增面板文案在英文界面显示成 key 原文 |
| `verify-notation.mjs` | cubing/alg 解析/序列化/求逆 | 公式输入解析失败 / 求逆错误 → 动画播放错步 |

其中 ZBLS 302 与 ZBLL 493 是**已经随 0.4.1 发布的数据基座**；`probe-locale-keys.ts` 守的正是 AGENTS.md 自列的高风险面（i18n 缺口）。这些护栏目前完全靠"人记得手动跑"。

## 修复

在 ci.yml 的 smoke 步骤后追加一段（全部是 `node` strip-types，无需 tsx/esbuild）：
```yaml
      - name: Solver base + ZBLS/ZBLL + i18n + notation gates
        run: |
          node scripts/verify-solve-base.ts
          node scripts/probe-solve-base-ui.ts
          node scripts/verify-zbls-rounds.ts
          node scripts/find-zbls-diff-3.ts
          node scripts/probe-locale-keys.ts
          node scripts/verify-notation.mjs
```
实测 `verify-zbls-rounds.ts` 本地耗时在现有 15 分钟预算内可接受。另建议把 `probe-solve-base-ui.ts` 重命名为 `verify-solve-base-ui.ts`——它虽然叫 probe，但实现的是断言 + exit code，是 gate 不是 probe（见附录 A）。

---

# F7 — `extract-solver-data.mjs` 用仓库外硬编码路径静默覆写已跟踪源码

**严重度**：medium  **分类**：tooling safety  **文件**：scripts/extract-solver-data.mjs:5,25,36  **工作量**：S  **置信度**：high

## 证据（逐字）

`scripts/extract-solver-data.mjs:5`
```js
const SRC = "C:\\Users\\phx_lumin\\Downloads\\rubik-cube.html";
```
`scripts/extract-solver-data.mjs:25`
```js
writeFileSync("src/cube/solver/f2lTable.ts", f2lTs, "utf8");
```
`scripts/extract-solver-data.mjs:36`
```js
writeFileSync("src/cube/solver/algsRaw.ts", rawTs, "utf8");
```
—— 没有 `--out`、没有 `--force`、没有 `git status` 脏检查、没有任何确认提示，直接覆盖两个 **已被 git 跟踪的求解器数据源文件**。

生成物的文件头自己也写着"勿手改"（脚本 18-20 行生成的注释）：
```
/** f2lTable.ts — 由 rubik-cube.html f2l-table.js 提取（勿手改）。
```

**实测（审计期间误触发）**：
```
$ node scripts/extract-solver-data.mjs
extracted f2lTable.ts + algsRaw.ts
EXIT=0

$ git status --short
 M src/cube/solver/algsRaw.ts
 M src/cube/solver/f2lTable.ts
```
（已用 `git checkout --` 还原，工作区已恢复干净。）

## 影响

1. **可移植性为零**：换机器/换 CI runner → `readFileSync` 抛 ENOENT，脚本直接崩。
2. **静默数据回归**：在维护者机器上，任何一次 `node scripts/extract-solver-data.mjs` 都会把线上发布的 **F2L 150 case 表**和**内置 LL 公式库**替换成"Downloads 目录里那个 HTML 文件"的内容。diff 可能只差几行，肉眼扫过去很容易放过，随后 `solve.ts` 的 CFOP/Roux 结果全变。而且脚本名和所在目录（`scripts/`，与 42 个脚本并列）不会让人联想到"这是个会改源码的生成器"。
3. **生成源不可追溯**：生成物头里不记录源文件 hash，无法判断当前 `f2lTable.ts` 是否真的来自那份 HTML。

## 修复

- 给脚本加 `--out <dir>`（默认写 OS 临时目录），并加 `--force` 才允许覆盖仓库内路径；或
- 直接删除该脚本——数据已经落库且被 `verify-zbls-rounds.ts` / `verify-render-cube.ts` 等 gate 覆盖，重跑生成器的收益远低于风险；
- 至少在生成物头部写入源文件 sha256，便于追溯。

---

# F8 — `node scripts/*.ts` 约定不可强制：源码已含 Node strip-types 拒绝的语法

**严重度**：medium  **分类**：correctness / maintainability  **文件**：src/cube/GrayOverlay.ts:28  **工作量**：S-M  **置信度**：high

## 证据（逐字）

CI 把它当作一条正式约定写进了注释：
`.github/workflows/ci.yml:38-39`
```yaml
      - name: Solver + render + coverage smoke (native Node, strip-types)
        # node scripts/*.ts 直跑（Node 22 strip-types，无 tsx/esbuild 依赖，Linux 可跑）
```
但项目源码里已经存在 Node 的 strip-only 模式**明确不支持**的语法 —— TypeScript 参数属性：
`src/cube/GrayOverlay.ts:26-28`
```ts
  private readonly tmp = new Vector3();

  constructor(private readonly player: CubePlayer) {}
```

实测（Node v24.18.0，3 行复现文件放在 %TEMP%，未写入仓库）：
```
$ node pp.ts
C:\Users\PHX_LU~1\AppData\Local\Temp\tmp.XzDIAYSYVG\pp.ts:2
class A {
  constructor(private readonly x: number) {}
                               ^^^^^^^^^
}

SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode
    at parseTypeScript (node:internal/modules/typescript:68:40)
EXIT=1

$ npx tsx pp.ts
A { x: 1 }
EXIT=0
```

另有一个脚本已经因此跑不起来 —— `scripts/probe-solver-methods.ts:4-5` 用了**无扩展名** import：
```ts
import { CFOP } from "../src/cube/solver/cfop";
import { ROUX } from "../src/cube/solver/roux";
```
```
$ node scripts/probe-solver-methods.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'D:\P_rojects\motion-cube\src\cube\solver\cfop' imported from
D:\P_rojects\motion-cube\scripts\probe-solver-methods.ts
EXIT=1
```
而项目其余所有脚本都严格用显式 `.ts` 扩展名（`smoke-solver.ts:3-4`、`verify-zbls-rounds.ts:27-29`、`smoke-solver-edge.ts:2-3`…）。

## 影响

- 当前 4 条 CI 脚本恰好没有传递地 import 到 `GrayOverlay.ts`，所以 CI 是**侥幸绿**的。任何新脚本（或 solver barrel `index.ts` 未来 re-export GrayOverlay）都会在 CI 上炸出 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` —— 这条错误信息完全不像"项目约定被破坏"，排查成本极高。
- "不用 tsx/esbuild"是 CI 路径相对 `npx tsx` 的唯一实质优势（Linux 上省一个平台二进制），但这个优势靠口头约定维持，没有任何强制手段。
- `probe-solver-methods.ts` 的头部写着 "运行：npx tsx scripts/probe-solver-methods.ts [N]（Windows 侧；WSL 缺 linux esbuild 二进制）" —— 也就是说它为了跑通而依赖 tsx，与 CI 的路径分道扬镳。

## 修复

1. `src/cube/GrayOverlay.ts:28` 改成显式字段：
   ```ts
   private readonly player: CubePlayer;
   constructor(player: CubePlayer) { this.player = player; }
   ```
2. `scripts/probe-solver-methods.ts:4-5` 补上 `.ts` 扩展名，之后它也能用 `node` 直接跑。
3. 加一条 CI 强制步骤（零新依赖）：
   ```yaml
      - name: Enforce node strip-types compatibility
         run: node scripts/verify-node-strip-compat.ts
   ```
   该脚本遍历 `src/**/*.ts`（含 Vue 之外的纯 ts）逐个 `import()`，遇到 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` 即 exit 1。这样"能被 `node` 直接跑"变成可执行的契约，而不是注释里的愿望。

---

# F9 — `playtest-spike.mjs` 使用已不存在的 `#alg-input`，属 provably-broken 遗留脚本

**严重度**：medium  **分类**：dead code  **文件**：scripts/playtest-spike.mjs:60,63,115  **工作量**：S  **置信度**：high

## 证据（逐字）

`scripts/playtest-spike.mjs:60`
```js
await page.type("#alg-input", "(R' U R' U') (R D' R' D) R' U' D' (R2 U' R2' D R2)");
```
`scripts/playtest-spike.mjs:63`
```js
const appliedValue = await page.$eval("#alg-input", (el) => el.value);
```
`scripts/playtest-spike.mjs:115`
```js
await page.type("#alg-input", "R U ???");
```

而 `#alg-input` 在整个 `src/` 中**不存在**：
```
$ grep -rn "alg-input" src/
(空)
```
当前游戏页的算法输入框是 `src/vue/pages/GamePage.vue:311`
```html
        <WinTextBox v-model:Text="algText" class="hud-alg" :PlaceholderText="t('hud.algPlaceholder')" />
```
—— vendored 的 `WinTextBox` 组件，`class="hud-alg"`，**没有 id**。`page.type("#alg-input", ...)` 会抛 `No element found for selector: #alg-input`。

`page.type` 之前还有一步 `await page.waitForFunction(() => !!document.querySelector("twisty-player"), ...)`（第 43 行），该元素由 cubing 注册（`node_modules/cubing/dist/lib/cubing/twisty/index.js:4635` → `customElementsShim.define("twisty-player", TwistyPlayer)`），这部分仍然成立 —— 所以脚本是在**第 60 行**才崩。

该脚本是 vanilla TS 时代的遗留物（命名 `spike`、输出目录 `spike-shots/`、`#move-log`/`#hud-status` 等旧 DOM id），而当前 Vue 版游戏页的 `#move-log`/`#hud-status` 仍在（`GamePage.vue:333`、`:404`），但输入框已经不是 `#alg-input` 了。

**没有任何文档引用它**：README.md / AGENTS.md / docs/*.md 中的 `scripts/*` 引用清单里不含 `playtest-spike.mjs`。

## 影响

- 一个永远跑不过第 60 行的脚本混在 `scripts/` 里，占据"playtest-*"前缀，与真正在用的 `playtest-ui.mjs` / `playtest-solver.mjs` 混淆。新人按前缀找"跑 UI 回归"的脚本时可能挑中它，白花时间。
- 它的断言还基于旧语义（移动日志包含 `"R" "R'" "M" "x" "r"`、重置清空日志），即使修好 `#alg-input` 也很可能大面积失败。

## 修复

删除 `scripts/playtest-spike.mjs`（或移入 `docs/archived/scripts/`）。同时全仓 grep 一次旧 DOM id（`#alg-input`、`#spike-*`）确认没有别的脚本残留依赖。

---

# F10 — Tauri CSP 关闭 + NSIS 安装包未签名 + 仅 Windows 打包目标

**严重度**：medium  **分类**：security / config  **文件**：src-tauri/tauri.conf.json:26-28, 30-34, 48-51  **工作量**：M  **置信度**：high

## 证据（逐字）

`src-tauri/tauri.conf.json:26-28`
```json
    "security": {
      "csp": null
    }
```
`src-tauri/tauri.conf.json:30-34`
```json
  "bundle": {
    "active": true,
    "targets": [
      "nsis"
    ],
```
`src-tauri/tauri.conf.json:48-51`
```json
    "windows": {
      "certificateThumbprint": null,
      "digestAlgorithm": "sha256",
      "timestampUrl": "",
```
`src-tauri/tauri.conf.json:44-45`
```json
    "copyright": "",
    "category": "Productivity",
```
`src-tauri/tauri.conf.json:39`
```json
      "icons/icon.icns",
```
（macOS 用的 `.icns` 列在 bundle 图标里，但 targets 只有 nsis —— 死配置。）

capabilities 侧是干净的（最小权限）：
`src-tauri/capabilities/default.json`
```json
{
  "identifier": "default",
  "description": "Default capabilities for the main window",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```
`src-tauri/src/lib.rs` 仅 6 行，未挂任何插件；`Cargo.toml` 也未引入 updater/shell/fs 等插件。

## 影响

1. **CSP 关闭**：`"csp": null` 意味着 webview 不施加任何 Content-Security-Policy。当前应用只加载本地资源、且注入 API（`window.motionCubeHand`）是 DEV 限定（`src/hand/handApi.ts` 里 `import.meta.env.DEV` 守卫），实际风险不高 —— 但这是桌面应用最重要的一层纵深防御，尤其是 localStorage 里存着用户手法数据。`docs/todo.md:80` 已把 "CSP" 列为技术债，但没有具体项与负责人。
2. **安装包未签名**：`certificateThumbprint: null` + `timestampUrl: ""` → NSIS 安装器无 Authenticode 签名。**每个用户安装时都会看到 Windows SmartScreen「未知发布者」警告**，且没有时间戳意味着签名在证书到期后失效、无法长期校验安装包完整性。面向个人用户分发时这是实打实的信任障碍。
3. **仅 Windows**：`targets: ["nsis"]` → 无 macOS/Linux 产物；`longDescription: ""`、`copyright: ""` → 安装器里描述与版权为空。

## 修复

- CSP：先按现有资源盘点再收紧（WinUIonWeb 大量使用内联样式，`index.html`/`preview.html` 用 `data:` favicon，Tauri v2 资源走 `asset:`/`http://asset.localhost`），起点可以是：
  ```json
  "security": {
    "csp": "default-src 'self'; img-src 'self' data: asset: http://asset.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost"
  }
  ```
  上线前在 dev 与打包版各验一遍渲染与注入 API。
- 签名：加 EV/普通代码签名证书，把 `certificateThumbprint` 与 `timestampUrl` 填上（CI 里从 secret 读取），并在 F1 的 release workflow 里加 `signtool sign /tr <timestamp>`。
- 把 `icons/icon.icns` 从 bundle 图标列表移除（或加 dmg/app target），补 `longDescription`。

---

# F11 — 完全没有单元测试运行器（并给出零依赖的最小方案）

**严重度**：medium  **分类**：test coverage  **文件**：package.json:6-12  **工作量**：M  **置信度**：high

## 证据（逐字）

`package.json:6-12`
```json
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "vue-tsc --noEmit",
    "tauri": "tauri"
  },
```
—— **没有 `test` 脚本**，devDependencies 里也没有 vitest / jest / uvu / @vue/test-utils 之类。

仓库里所有"测试"都是一次性脚本形态（无 runner、无 `describe/it`、无断言库、无单测粒度报告）：
```
scripts/verify-data.ts, verify-hand-mesh.ts, verify-render-cube.ts, verify-zbll-coverage.ts,
verify-solve-base.ts, verify-zbls-rounds.ts, find-zbls-diff-3.ts, probe-locale-keys.ts,
probe-solve-base-ui.ts, smoke-solver.ts, smoke-solver-edge.ts, verify-notation.mjs
```
它们的命名与用法各不相同（`npx tsx` / `node` / 带参 / 不带参），没有统一入口，**没法一条命令跑完所有测试**。

## 影响

- 求解器（`src/cube/solver/`，engine + search + algs + f2lTable + cfop + roux + zbl + zbls，近 12 个模块）、手法数据契约（`src/data/technique.ts` 的旧档迁移）、手部几何（`src/hand/handMesh.ts`）—— 这些是最容易出回归、也最难靠肉眼发现问题的部分，目前**没有可复用的单元测试套件**，只有一堆需要"按名字发现"的脚本。
- 这正是 F6 的成因：因为没有统一 runner，"哪些是 gate"没有权威清单，6 个 gate 就漏在了 CI 外。
- 没有 `npm test` 意味着新人无法自查；也无法在 PR 上看到"这次改动影响了哪些测试"。

## 修复（最小、低摩擦、零新依赖）

用 **Node 内置 test runner**（Node ≥18 自带，输出 TAP，GitHub Actions 原生可读），复用项目已在 CI 里跑通的 strip-types 路径：

1. `package.json` 加：
   ```json
   "scripts": {
     "test": "node --test --experimental-strip-types \"src/**/*.test.ts\" \"scripts/**/*.test.ts\""
   }
   ```
   （Node ≥22.18 可省略 `--experimental-strip-types`；保留它可兼容 22.6–22.17，见 F14。）
2. 把已有 bespoke 脚本**包成 `node:test` 用例**（改动极小，只是把 `check()` 换成 `test()`）：
   ```ts
   import { test } from "node:test";
   import assert from "node:assert/strict";
   test("A axisAngleMat(axis,-90°) == rot(v,axis,1)", () => { ... });
   ```
   建议首批迁移：`smoke-solver.ts`（求解器端到端）、`verify-solve-base.ts`（解法底）、`probe-locale-keys.ts`（i18n key 对齐）、`verify-render-cube.ts` 的 pose↔state 对偶（随机 300 轮那段最适合做 property-based 用例）。
3. CI 加一步：
   ```yaml
      - name: Unit tests
        run: npm test
   ```
4. 若之后需要 Vue 组件测试，再考虑 `vitest` + `@vue/test-utils`（与 Vite 8 同源，迁移成本最低），但**先不要**——`node:test` 已经能覆盖 90% 的风险面（求解器 + 数据契约 + 几何 + i18n）。

这样也顺带解决了 F14（`node --test` 会显式暴露 Node 版本下限）与 F6（`npm test` 成为唯一权威入口）。

---

# F12 — `Cargo.toml` 版本 0.1.0：第三份无人管的版本号副本

**严重度**：medium  **分类**：version drift  **文件**：src-tauri/Cargo.toml:3  **工作量**：S  **置信度**：high

## 证据（逐字）

`src-tauri/Cargo.toml:1-7`
```toml
[package]
name = "motion-cube"
version = "0.1.0"
description = "Motion Cube - Rubik's cube finger animation editor"
authors = ["phixt"]
edition = "2021"
rust-version = "1.77.2"
```
`src-tauri/Cargo.lock`（root package，同样是 0.1.0）：
```
name = "motion-cube"
version = "0.1.0"
```
而另外两份是 0.4.1：
```
package.json:4              "version": "0.4.1",
src-tauri/tauri.conf.json:4  "version": "0.4.1",
```
规则本身只覆盖两份：
`AGENTS.md:10-11`
```
- **版本号**：package.json 与 src-tauri/tauri.conf.json 的 version 必须同步
  （tauri 打包以 conf 为准）；功能/修复提交时评估 bump
```
`docs/todo.md:110`
```
- 版本号 package.json 与 src-tauri/tauri.conf.json 必须同步（tauri 打包以 conf 为准）
```

## 影响

- Tauri 打包器以 `tauri.conf.json` 为准，所以**用户安装的包版本号是对的**，无直接用户影响。
- 但 `CARGO_PKG_VERSION` / `cargo metadata` 报的是 0.1.0；一旦有人 `cargo install` 或把这个 crate 当依赖用，拿到的是 0.1.0。
- 治理漏洞本身更值得修：项目有三份版本号却只规定同步两份，第三份（恰好是最容易忘的 Rust 那份）已经漂了 4 个 minor。这正是 F4/F17 的同源问题——**manifest 缺一个统一校验点**。

## 修复

1. 把 `src-tauri/Cargo.toml` 的 `version` 改成 `0.4.1`（并 `cargo update -p motion-cube` 或手改 Cargo.lock 的 root version）。
2. 把 AGENTS.md:10-11 与 todo.md:110 的规则扩成三份同步（package.json / tauri.conf.json / Cargo.toml）。
3. 更稳的做法：加一个 `scripts/verify-versions.ts`，断言三处 + `package-lock.json` 根版本一致，并在 CI 里跑（顺带覆盖 F17）。

---

# F13 — `docs/solver-baseline.json` 是已提交的金标准文件，但陈旧且无强制校验

**严重度**：medium  **分类**：test coverage  **文件**：docs/solver-baseline.json:2；scripts/record-solver-baseline.ts:137  **工作量**：S  **置信度**：high

## 证据（逐字）

`docs/solver-baseline.json:1-5`（已提交到 git）
```json
{
  "note": "求解方法基线（2026-08-20）。cfop/roux 普通=人类式分步契约（roux 与旧版 3e30423 逐行一致）；roux-merge=默认合并 4b+4c（4a + 4b+4c 两段）；cfop-adv/roux-adv=高级参考列。",
  "assert": {
    "n12": 60,
    "n20": 10,
    "lcg": "1664525/1013904223 seed 0x51a7",
    "humanStages": "100% 命中"
  },
```
写入者 `scripts/record-solver-baseline.ts:137`
```js
  writeFileSync(resolve(import.meta.dirname, "../docs/solver-baseline.json"), JSON.stringify(out, null, 2));
```
`docs/plan-solver-interaction.md:133` 引用了该脚本：
```
scripts/record-solver-baseline.ts
```

## 影响

- 该文件读起来像一份**回归契约**（`expectedStages`、`humanStages: "100% 命中"`），但标注日期是 **2026-08-20**，而此后求解器经历了 ZBLS 302 口径、Roux 合并 4b+4c、解法底多选等改动（见 `docs/todo.md:11-15`）。它是否仍与当前行为一致，**没有任何机制去校验**。
- 生成脚本直接写已跟踪文件，没有 `--check` / `--out` 模式，也没有 diff 步骤；一旦有人把它接进 CI，最先遇到的是"文件本来就过期"导致的失败，掩盖真实回归。
- `docs/solver-baseline.json` 是 docs/ 下唯一的机器生成产物，混在手写文档目录里，没有"这是生成物，勿手改"的标记（文件里也没有该标记）。

## 修复

二选一：

- **(a) 变成真正的金标准**：先重跑 `node scripts/record-solver-baseline.ts` 重新生成并提交（注意它会写仓库文件，需在干净工作区做），然后加 CI 步骤"重生成到临时目录并与已提交版本 diff，不一致即失败"。为此给脚本加 `--out <file>` 参数。
- **(b) 降级为报告产物**：把输出路径改到 gitignore 的目录（如 `spike-shots/solver-baseline.json`），并从 git 中移除该文件，在 docs 里注明它是"运行时报告，不是契约"。

推荐 (a) —— 这份 baseline 正好覆盖"人类式分步契约"，是求解器最值钱的不变量。

---

# F14 — 无 `engines`、无 Node 版本钉死，CI 用浮动 `node-version: 22`

**严重度**：medium  **分类**：dependency / CI hygiene  **文件**：package.json:4-12；.github/workflows/ci.yml:17-21  **工作量**：S  **置信度**：high

## 证据（逐字）

`package.json` 全文 29 行，**没有 `engines` 字段**（`node -e "console.log(require('./package.json').engines)"` → `ABSENT`），仓库根也没有 `.nvmrc` / `.node-version` / `.npmrc`（`ls` 全部不存在）。

`.github/workflows/ci.yml:17-21`
```yaml
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
```

而项目文档化的验证命令里有依赖 **Node 原生 TS 类型擦除** 的：
`docs/todo.md:113-115`
```
- 验证命令：`npm run typecheck` / `npm run build` / `npx tsx scripts/verify-data.ts` /
  `npx tsx scripts/verify-hand-mesh.ts` / `node scripts/smoke-solver.ts` /
  `node scripts/smoke-solver-edge.ts` / `node scripts/playtest-ui.mjs`
```
`AGENTS.md:52`
```
  验证：`node scripts/smoke-solver.ts` / `scripts/smoke-solver-edge.ts`（tsx）、
```
Node 的类型擦除在 **22.18.0 才默认开启**（22.6–22.17 需要 `--experimental-strip-types`），Node 20 上 `node foo.ts` 直接 `ERR_UNKNOWN_FILE_EXTENSION`。本机 Node 是 v24.18.0，所以本地无感。

## 影响

- 一个用 Node 20 LTS（仍在广泛使用）的贡献者，照 `docs/todo.md:114` 敲 `node scripts/smoke-solver.ts`，会拿到一个和"项目约定"完全无关的 Node 报错，很难自查。
- CI 的 `node-version: 22` 是**浮动**的：任何一次 Node 22.x 小版本发布都可能改变 strip-types 的行为（比如新增/收紧某种语法），CI 会在无人改动代码的情况下变红或变绿。
- 项目里同时存在两套 TS 运行方式（`npx tsx` 与 `node` 原生），但**没有声明最低 Node 版本**，也就没有统一的环境契约。

## 修复

1. `package.json` 加 `"engines": { "node": ">=22.18.0" }`。
2. 提交 `.node-version`（内容如 `22.18.0` 或团队统一的 `24.x`），CI 改用 `node-version-file: '.node-version'`。
3. 若团队希望兼容更老的 Node，就统一走 `tsx`（把 ci.yml 里 `node scripts/*.ts` 改成 `npx tsx scripts/*.ts`），并在 `engines` 里写 `>=20` —— 二选一，别让两套并存且无声明。

---

# F15 — 3 个脚本默认落到 5173（用户保留端口），其中 2 个被 README 当作 QA 命令

**严重度**：medium  **分类**：correctness  **文件**：scripts/shot-shell.mjs:40；scripts/shot-preview.mjs:35；scripts/verify-drag.mjs:11  **工作量**：S  **置信度**：high

## 证据（逐字）

项目自订的端口规则（两处都写得很明确）：
`AGENTS.md:5-6`
```
- **端口**：5173 是用户日常预览端口（用户自己占用），本项目的自动化、dev server、
  playtest 一律使用其他端口（如 5174），避免与用户预览冲突。
```
`docs/todo.md:109`
```
- 端口 **5173** 为用户日常预览；本项目 dev/playtest 用 **5174** 或其它非 5173 端口
```
但三个脚本的默认值违反了它：
```
scripts/shot-shell.mjs:40:const base = process.env.SPIKE_URL ?? "http://localhost:5173";
scripts/shot-preview.mjs:35:const base = process.env.SPIKE_URL ?? "http://localhost:5173";
scripts/verify-drag.mjs:11:const URL = process.env.SPIKE_URL ?? "http://localhost:5173/";
```
（其余 15 个浏览器脚本默认都是 5174。）

而这两个 5173 脚本被 README.md:78-79 当作正式 QA 命令列出：
```
node scripts/shot-shell.mjs         # 壳回归截图（7 路由 + 主题/材质切换）
node scripts/shot-preview.mjs       # WinUI 预览页截图
```

## 影响

- 按 README 原样执行（不设 `SPIKE_URL`）→ 命中用户**日常预览**那个 5173 服务。那可能是一个跑着旧代码、或者用户手动改过的实例 → 截图回归的是错误的产物，QA 结论失真且难以察觉（截图看起来"正常"）。
- 自动化跑在 CI/并行会话里时，5173 可能被别人占用 → 端口冲突或连到无关服务。
- 项目的端口规则写在两份记忆文档里，却有 3 个脚本违反 —— 说明规则没有落到代码里。

## 修复

把这 3 个默认值改成 `http://localhost:5174`（与另外 15 个脚本一致），并让脚本在 `SPIKE_URL` 未设置、5174 也不可达时**快速失败并给出提示**，而不是静默连到别的端口。

---

# F16 — `probe-solver-methods.ts` 用无扩展名 import，在项目自己的 node 约定下必崩

**严重度**：low  **分类**：maintainability  **文件**：scripts/probe-solver-methods.ts:4-5  **工作量**：S  **置信度**：high

## 证据（逐字）

`scripts/probe-solver-methods.ts:1-6`
```ts
/**
 * probe-solver-methods.ts — 对比 CFOP 普通 / CFOP 高级(ZBLL) / Roux 步数（随机打乱样本）。
 * 目的：实证「CFOP 高级常比普通多步」是否仍存在；双路线取短修复后应恒 adv ≤ normal。
 * 运行：npx tsx scripts/probe-solver-methods.ts [N]（Windows 侧；WSL 缺 linux esbuild 二进制）
 */
import { CFOP } from "../src/cube/solver/cfop";
import { ROUX } from "../src/cube/solver/roux";
```
实跑：
```
$ node scripts/probe-solver-methods.ts 1
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'D:\P_rojects\motion-cube\src\cube\solver\cfop' imported from
D:\P_rojects\motion-cube\scripts\probe-solver-methods.ts
    at finalizeResolution (node:internal/modules/esm/resolve:271:11)
EXIT=1
```
项目其余脚本一律用显式 `.ts`：
```
scripts/smoke-solver.ts:3:import { solve, prepareSolvers } from "../src/cube/solver/index.ts";
scripts/smoke-solver-edge.ts:2:import { solve } from "../src/cube/solver/index.ts";
scripts/verify-zbls-rounds.ts:27:} from "../src/cube/solver/engine.ts";
```

## 影响

- 该脚本**只能**靠 tsx 跑，与 CI 使用的 `node` 路径不兼容（它的头注释自己也承认 "Windows 侧；WSL 缺 linux esbuild 二进制" —— 这正是 tsx/esbuild 的平台二进制问题，而 `node` 原生路径恰恰能绕开它）。
- 脚本头说 "npx tsx"，但项目其余 8 个 `.ts` 脚本都明确标注 "node 原生 strip-types 运行，勿用 tsx"（见 `verify-render-cube.ts:2-3`、`verify-zbll-coverage.ts:1-2`、`verify-solve-base.ts:1-2`、`record-solver-baseline.ts:2-3`）。同一目录里存在两套互斥约定，且没有说明为什么这一个必须特殊。

## 修复

补上 `.ts` 扩展名（`from "../src/cube/solver/cfop.ts"`），它就能在 `node` 下运行；把头注释改成与同类脚本一致的 "node 原生 strip-types 运行"。若它要进 CI（它是一个有用的"高级解法不劣于普通解法"回归断言），改完即可。

---

# F17 — `package-lock.json` 根版本仍是 0.1.0

**严重度**：low  **分类**：dependency hygiene  **文件**：package-lock.json（`packages[""].version`）  **工作量**：S  **置信度**：high

## 证据（逐字）

```
$ node -e "console.log(require('./package-lock.json').packages[''].version)"
0.1.0
$ node -e "console.log(require('./package.json').version)"
0.4.1
```
lock 的 root 块也精确镜像了 package.json 的依赖集（因此同样没有 `three`）：
```json
{
  "name": "motion-cube",
  "version": "0.1.0",
  "dependencies": { "@tauri-apps/api": "^2.11.1", "cubing": "^0.63.3", "vue": "^3.5.41", "vue-router": "^4.6.4" },
  ...
}
```
`npm ci` 不会因此失败（实测 `npm ci --dry-run` → `up to date`，exit 0），所以 CI 不受影响。

## 影响

低。但它是 F4 的**根因证据**：lock 的 root `dependencies` 块是 package.json 的镜像 —— 当 `three` 未被声明时，lock 忠实地记录了"没声明"，于是 `npm ci` 装出来的树里 `three` 只是 cubing 的传递依赖。任何读 lock 的工具（依赖审计、许可扫描、SBOM 生成）都会认为项目不直接依赖 three。

另外 lock 根版本 0.1.0 与 package.json 0.4.1 不一致，会让 `npm version` / 发布相关工具产生困惑。

## 修复

修完 F4 后执行一次 `npm install` 刷新 lock（根版本会同步为 0.4.1）。可加 `scripts/verify-versions.ts` 一并断言（见 F12）。

---

# F18 — Rust 侧 `serde` / `serde_json` 为无用依赖

**严重度**：low  **分类**：dead code  **文件**：src-tauri/Cargo.toml:16-19  **工作量**：S  **置信度**：high

## 证据（逐字）

`src-tauri/Cargo.toml:16-19`
```toml
[dependencies]
tauri = { version = "2", features = [] }
serde_json = "1"
serde = { version = "1", features = ["derive"] }
```
但 Rust 源码里一处都没用到：
```
$ grep -rn "serde" src-tauri/src/
(空)
```
`src-tauri/src/lib.rs` 全文 6 行：
```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```
`src-tauri/src/main.rs` 全文 6 行，只调 `motion_cube_lib::run()`。

## 影响

- 每次 `cargo build` 都要额外编译 serde / serde_json 及其依赖树（serde_derive、proc-macro2、quote、syn…），拖长构建时间、增加攻击面（供应链审计里多两个 crate）。
- 更重要的是**认知误导**：Cargo.toml 里摆着 `serde` + `derive` feature + `serde_json`，会让读者以为存在"命令/事件序列化"的 IPC 契约 —— 实际上一个都没有。将来真要加 Tauri command 时，这两个依赖会被误认为"已经准备好了"。

## 修复

从 `Cargo.toml` 删除 `serde` 与 `serde_json`（并重新生成 `Cargo.lock`）。若确实计划做 Rust↔前端 IPC，则反过来：现在就把契约设计好并写进 `docs/`。

---

# F19 — 仓库根目录遗留一次性探针；两个已提交数据文件无人引用

**严重度**：low  **分类**：dead code  **文件**：.research_zbll_probe.mjs:1-10；data/samples/cuberoot-recons.json；data/samples/cfop-adv-zbll-case.json  **工作量**：S  **置信度**：high

## 证据（逐字）

仓库根目录有一个 **已被 git 跟踪** 的一次性探针（10 行）：
```
$ git ls-files | grep -i research
.research_zbll_probe.mjs
```
`.research_zbll_probe.mjs` 全文：
```js
import { cube3x3x3 } from "cubing/puzzles";
const kp = await cube3x3x3.kpuzzle();
console.log("moves:", Object.keys(kp.definition.moves).join(","));
const solved = kp.defaultPattern();
for (const m of ["y", "y2", "x", "z"]) {
  try { const p = solved.applyMove(m); console.log("applyMove ok:", m, "changed:", !p.isIdentical(solved)); }
  catch (e) { console.log("applyMove FAIL:", m, e.message.slice(0, 60)); }
}
```
它属于 `scripts/` 里应该有 42 个文件却只有这一个留在根目录的孤儿，且不被任何文档引用。

另外两个已提交的数据文件在 `src/`、`scripts/`、`docs/` 中均无引用：
```
$ git ls-files data/
data/samples/cfop-adv-zbll-case.json
data/samples/cuberoot-algs.json
data/samples/cuberoot-recons.json
data/samples/library.json
```
- `data/samples/cuberoot-recons.json` 是 `scripts/fetch-cuberoot.mjs`（网络抓取 cuberoot.me 复盘）的产物，只被该脚本自身提及。
- `data/samples/cfop-adv-zbll-case.json` 全仓无任何引用（grep `cfop-adv-zbll-case` 只命中文件自身）。

## 影响

- 仓库根目录出现非源码文件，破坏"根目录只放工程配置"的惯例；review 时容易被误当作有效入口。
- 已提交但无人引用的数据文件是**误改风险点**：任何人"顺手更新"它们都不会触发任何测试，却可能让人以为线上用的是这份数据。
- `scripts/fetch-cuberoot.mjs` 依赖外网 API（`https://api.cuberoot.me/v1`），在没有网络/TLS 受限的环境里必然失败，且它的产物并非应用运行所需。

## 修复

- 删除 `.research_zbll_probe.mjs`（结论早已固化在 `docs/archived/zbls-ogroup-3-cases.md` 里，脚本本身没有留存价值）。
- `data/samples/cfop-adv-zbll-case.json`：接入 `src/data/algDb.ts` 或删除。
- `data/samples/cuberoot-recons.json`：若确为有价值的数据源，接入应用并写进 README；否则删除脚本与数据。
- 顺带：把 `scripts/` 按下文的四分类整理，并加一个 `scripts/README.md`（见附录 A）。

---

# F20 — todo.md 称 `reference/` 已入库，实际被 gitignore

**严重度**：low  **分类**：doc-vs-code drift  **文件**：docs/todo.md:45；.gitignore:48；AGENTS.md:58  **工作量**：S  **置信度**：high

## 证据（逐字）

`docs/todo.md:44-45`
```
- 方向：**自建推导**——盲拧以 8+18 基础公式推导拓展至全 818 条（3-Style V5 xlsx
  仅参照不做数据源，reference/ 已入库）；zbll 问题在命中率口径非库完整性（493/493）；
```
实际：
```
$ git check-ignore -v reference
.gitignore:48:reference	reference
$ git ls-files reference | wc -l
0
```
`.gitignore:44-48`
```
# cuberoot API 抓取缓存（可重新 --fetch 生成）
.cache/

.research_zbll
reference
```
而 AGENTS.md:58 的说法是正确的：
```
- **reference/（gitignore，全程不入库，仅本地参考）**：`3-style-v5/三盲三循环818-魔方根.xlsx`
```

## 影响

- todo.md 是"唯一进度/待办总账"，是团队对"哪些数据在库里"的判断依据。"已入库"会误导后续工作（例如以为 818 条盲拧档案已在仓库里、可以直接引用而无需再取参考文件）。
- 反向风险同样真实：一旦有人按字面理解去 `git add reference/`，会把第三方数据（Alg-Trainers 的 3x3-ZBLL 472 / 3x3-ZBLS 302 JSON、3-Style V5 的 xlsx）连同其许可状态一起提交进库 —— 与 AGENTS.md 明确的"全程不入库"策略冲突，且这些素材的再分发许可未在仓库中声明。

## 修复

把 `docs/todo.md:45` 改为"仅参照不做数据源，reference/ 已 gitignore、不入库（见 .gitignore）"，与 AGENTS.md:58 对齐。

---

# F21 — hand-api-spec 禁改清单含不存在的文件，且写错 dev server 端口

**严重度**：low  **分类**：doc-vs-code drift  **文件**：docs/hand-api-spec.md:61,68  **工作量**：S  **置信度**：high

## 证据（逐字）

`docs/hand-api-spec.md:61`
```
- **禁止修改**：`src/hand/handMesh.ts`、`src/hand/handGeometry.ts`、`src/hand/HandRig.ts` 类型定义、`src/hand/handRigStore.ts`、`src/hand/HandRigView.ts` 公开方法签名、`scripts/playtest-ui.mjs` 既有断言（这些在 feat/hand-lowpoly 高频迭代中）。
```
但 `src/hand/handGeometry.ts` **不存在**：
```
$ ls src/hand/
HandCalibView.ts  HandOrbitView.ts  HandRig.ts  HandRigView.ts  handApi.ts  handMesh.ts  handRigStore.ts
```
它是在 commit `50c2547` 被删除的：
```
$ git log --oneline -1 50c2547
50c2547 chore(hand): 合并前清理——删除 handGeometry.ts 冻结基线（A/B 对照使命完成，hand-lab 改单视图调试页）+ CI 补 verify-hand-mesh
```
`docs/hand-api-spec.md:68`
```
2. `node scripts/shot-editor-barehand.mjs`（需 dev server 5175）流程不回归；
```
—— 全项目标准端口是 5174（AGENTS.md:6、todo.md:109、以及 15 个脚本的默认值），5175 只此一处。

## 影响

- 这份 spec 是**交给外部实现方的硬约束合同**（文档抬头："供实现方"、"实现方应严格遵循本文档的「冲突规避约束」"）。禁改清单里放一个不存在的文件，会让实现方以为要去找/保护一个已经不存在的基线。
- 端口写错会让实现方起错端口 → `shot-editor-barehand.mjs` 连不上（该脚本默认 5174，但可用 `SPIKE_URL` 覆盖，所以只是"文档误导"，不至于彻底跑不通）。

## 修复

`docs/hand-api-spec.md:61` 删掉 `src/hand/handGeometry.ts`；`:68` 的 5175 改成 5174。

---

# F22 — 2 个脚本硬编码 URL 忽略 `SPIKE_URL`；`--disable-gpu` 使截图失去意义

**严重度**：low  **分类**：tooling  **文件**：scripts/probe-render.mjs:16；scripts/shot-hand-calib-debounce.mjs:12,16-17  **工作量**：S  **置信度**：high

## 证据（逐字）

`scripts/probe-render.mjs:16`（其余 18 个脚本都用 `process.env.SPIKE_URL ?? ...`）
```js
await page.goto("http://localhost:5174/#/render-demo", { waitUntil: "networkidle0", timeout: 30000 });
```
`scripts/shot-hand-calib-debounce.mjs:12`
```js
const URL = "http://127.0.0.1:5174/#/hand";
```
`scripts/shot-hand-calib-debounce.mjs:16-17`
```js
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
```
—— 其余全部浏览器脚本统一用：
```js
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", ...]
```
而该脚本自己的头注释（`:9`）声称截图有诊断价值：
```
 5. 截图 spike-shots/hand-calib.png（防抖后页面仍然渲染完整）。
```

## 影响

- `--disable-gpu` 关闭 GPU 后端 → WebGL 走软件路径不可靠/不可用，标定页的 3D 手部视图（`src/hand/HandCalibView.ts`，three.js + WebGLRenderer）**大概率渲染为空白**。于是"截图证明页面仍然渲染完整"这条结论不成立 —— 截图只是没有证据，而不是正面证据。防抖计数断言（第 4 步）仍然有效，但截图部分名不副实。
- 两个脚本无法指向别的实例（CI、并行端口、代理），与项目统一的 `SPIKE_URL` 约定不一致。

## 修复

两个脚本都改用 `process.env.SPIKE_URL ?? "http://localhost:5174/"`；`shot-hand-calib-debounce.mjs` 换用 `--enable-unsafe-swiftshader --use-angle=swiftshader` 并把 `headless: "new"` 统一为 `headless: true`，让截图真正反映渲染。

---

# F23 — `vite.config.ts` 端口 5173 与项目自订端口规则冲突

**严重度**：low  **分类**：doc-vs-code drift  **文件**：vite.config.ts:8；README.md:45  **工作量**：S  **置信度**：medium

## 证据（逐字）

`vite.config.ts:7-8`
```ts
  server: {
    port: 5173,
```
`README.md:45`
```
npm run dev        # http://localhost:5173
```
`AGENTS.md:5-6`
```
- **端口**：5173 是用户日常预览端口（用户自己占用），本项目的自动化、dev server、
  playtest 一律使用其他端口（如 5174），避免与用户预览冲突。
```
Tauri 侧是正确的（`src-tauri/tauri.conf.json:7-8`）：
```json
    "devUrl": "http://localhost:5174",
    "beforeDevCommand": "npm run dev -- --port 5174 --strictPort",
```

## 影响

- 规则说"本项目的 dev server 一律用其他端口"，但 `npm run dev` 用的正是被保留的 5173。Vite 在端口被占用时会**自动递增**（5174/5175…），于是 `npm run dev` 可能在 5175 上起来，而 README 写着 5173、AGENTS 写着"用 5174" —— 三处对不上。
- 这与 F15 是同一个根因：端口约定只存在于文档，没有落到配置里。

## 修复

把 `vite.config.ts` 的 `server.port` 改成 `5174` 并加 `strictPort: true`（占用时直接报错而不是静默换端口），删掉 `tauri.conf.json` 里多余的 `--port 5174 --strictPort` 覆盖，README.md:45 改成 5174。这样"5173 归用户、5174 归项目"在代码层成立，而不是靠记忆。

---

# F24 — CI 重复执行两次全量类型检查

**严重度**：nit  **分类**：CI efficiency  **文件**：.github/workflows/ci.yml:26-30；package.json:8,10  **工作量**：S  **置信度**：high

## 证据（逐字）

`package.json:8,10`
```json
    "build": "vue-tsc --noEmit && vite build",
    "typecheck": "vue-tsc --noEmit",
```
`.github/workflows/ci.yml:26-30`
```yaml
      - name: Typecheck
        run: npm run typecheck

      - name: Build
        run: npm run build
```
—— `npm run build` 已经先跑了一遍 `vue-tsc --noEmit`。

## 影响

每次 CI 多跑一遍 `vue-tsc`（覆盖 `src` + `scripts` + `vite.config.ts`，本机 typecheck 耗时可观）。纯浪费，不影响正确性。

## 修复

二选一：删掉 ci.yml 的 Typecheck 步骤（build 已含）；或把 `build` 改成 `"build": "vite build"`，把类型检查完全交给独立的 typecheck 步骤（更利于缓存与分离关注点，推荐后者）。

---

# F25 — CI workflow 缺 `permissions:` 与 `concurrency:`

**严重度**：nit  **分类**：CI hygiene  **文件**：.github/workflows/ci.yml:1-44  **工作量**：S  **置信度**：high

## 证据（逐字）

`.github/workflows/ci.yml:1-8`
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
```
—— 整个 workflow 没有 `permissions:`（令牌拿到仓库默认权限），也没有 `concurrency:`。

## 影响

- `permissions: contents: read` 是 GitHub 推荐的最小权限基线；缺少它时，令牌权限取决于仓库/组织的默认设置（老组织可能是 write）。
- 没有 `concurrency` 时，向 main 连推多个 commit 会并行跑多份完全相同的 job，白烧 Actions 分钟数。
- 补 F1 的 release workflow 时，`permissions:` 更重要（它需要 `contents: write` 上传 Release 资产），应当显式声明。

## 修复
```yaml
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

---

# F26 — AGENTS.md 对同一条命令同时写 `node` 与「（tsx）」，运行器含糊

**严重度**：nit  **分类**：doc-vs-code drift  **文件**：AGENTS.md:52  **工作量**：S  **置信度**：high

## 证据（逐字）

`AGENTS.md:52-53`
```
  验证：`node scripts/smoke-solver.ts` / `scripts/smoke-solver-edge.ts`（tsx）、
  `scripts/playtest-solver.mjs`。
```
前半句给的是 `node scripts/smoke-solver.ts`，括号里却写「（tsx）」，而第二条根本没给运行器。

而 CI 的实际写法（`.github/workflows/ci.yml:41-42`）是：
```yaml
          node scripts/smoke-solver.ts
          node scripts/smoke-solver-edge.ts
```
—— 都是 `node`，不是 tsx。

## 影响

AGENTS.md 是"项目记忆"文档，代理与新人都照它执行。含糊的运行器说明会导致：有人用 `npx tsx` 跑（多拉一个 esbuild 平台二进制，在某些环境还会失败），有人用 `node` 跑（在 Node < 22.18 上失败）。

## 修复

统一写成 `node scripts/smoke-solver.ts` / `node scripts/smoke-solver-edge.ts`（与 CI 一致），并去掉「（tsx）」；同时把 F14 的最低 Node 版本一并写明。

---

# 附录 A — `scripts/` 分类清单（42 个文件）

命名约定混乱是 F6/F11 的成因：同一个目录下混着"CI 闸门""一次性诊断探针""截图工具""数据生成器"，仅靠文件名无法判断。现状分类：

## A1. Gate（确定性、exit code 表达成败、无需浏览器/网络 → 应进 CI）

| 脚本 | 当前在 CI？ | 实跑结果 |
|---|---|---|
| `scripts/verify-data.ts` | ✅ | ALL PASS |
| `scripts/verify-hand-mesh.ts` | ✅ | ALL PASS |
| `scripts/smoke-solver.ts` | ✅ | all OK |
| `scripts/smoke-solver-edge.ts` | ✅ | edge cases OK |
| `scripts/verify-render-cube.ts` | ✅ | PASS 22 / FAIL 0 |
| `scripts/verify-zbll-coverage.ts` | ✅ | ALL PASS 493/493 |
| `scripts/verify-solve-base.ts` | ❌ | ALL PASS |
| `scripts/probe-solve-base-ui.ts` | ❌ | 22 pass / 0 fail（**应改名 verify-solve-base-ui.ts**） |
| `scripts/verify-zbls-rounds.ts` | ❌ | 2603 轮 0 失败 |
| `scripts/find-zbls-diff-3.ts` | ❌ | 结论一致 |
| `scripts/probe-locale-keys.ts` | ❌ | en/zh 无缺项（**应改名 verify-locale-keys.ts**） |
| `scripts/verify-notation.mjs` | ❌ | ALL PASS |
| `scripts/record-solver-baseline.ts` | ❌ | 写 `docs/solver-baseline.json`（金标准生成器，见 F13） |

→ 6 个 gate 缺席 CI（F6）。其中 3 个命名为 `probe-*` 但实现是 gate，属于命名误导。

## A2. Playtest / Browser（需要 dev server + 浏览器；见 F3）

`playtest-ui.mjs`（README/AGENTS 引用）｜`playtest-solver.mjs`（AGENTS 引用）｜`playtest-spike.mjs`（**provably broken，见 F9；无任何文档引用 → 删除**）

## A3. Shot（截图 / 视觉验证，多为开发辅助）

`shot-shell.mjs`｜`shot-preview.mjs`｜`shot-editor-barehand.mjs`｜`shot-editor-hand.mjs`｜`shot-game-cubing.mjs`｜`shot-game-render.mjs`｜`shot-hand-calib.mjs`｜`shot-hand-calib-debounce.mjs`｜`shot-hand-lab.mjs`｜`shot-solve-base.mjs`｜`shot-solver-options.mjs`｜`render-shot.mjs`｜`measure-hand.mjs`｜`verify-drag.mjs`（**名为 verify，实为需人工看图的视觉比对**）｜`verify-hand-calib.mjs`（**像素级视觉校验**）

## A4. Probe（一次性诊断，结论已固化在 docs/）

`probe-eolr-rootcause.ts`（→ `docs/research-roux-adv.md`）｜`probe-lse-merge-savings.ts`（同上）｜`probe-solver-methods.ts`（**修好扩展名后可升级为 gate，见 F16**）｜`probe-render.mjs`｜`probe-render-dispose.mjs`（守卫 947e9fd 之前的渲染 dispose 崩溃）

## A5. Generator（会写仓库文件 —— 必须与只读脚本物理隔离）

| 脚本 | 写入目标 | 风险 |
|---|---|---|
| `gen-cuberoot-algs.mjs` | `data/samples/cuberoot-algs.json` | 覆盖已发布公式库；需联网 |
| `gen-samples.ts` | `data/samples/library.json`（并 `rmSync` 删 formulas/techniques.json） | 覆盖示例库；需 `three`（未声明，见 F4） |
| `fetch-cuberoot.mjs` | `data/samples/cuberoot-recons.json` | 需外网；产物无人引用（F19） |
| `extract-solver-data.mjs` | **`src/cube/solver/f2lTable.ts` + `algsRaw.ts`（源码！）** | **高危，见 F7** |
| `record-solver-baseline.ts` | `docs/solver-baseline.json` | 覆盖已提交金标准（F13） |
| `sync-winui.mjs` | `src/vendor/winui-on-web/**` + `THIRD_PARTY_NOTICES.md` | 整目录覆盖第三方 vendored 源码 |
| `tools/icon-lab/魔方图标生成.py` | `--dir` 指定目录（默认输出 1024 PNG + `uninstaller.ico`） | Python + 第三方渲染库，项目无 Python 依赖声明 |

## 建议的整理动作（低风险、可分批）

1. 建 `scripts/gate/`、`scripts/browser/`、`scripts/tools/` 三个子目录，把 A1 全部改为 `scripts/gate/` 并在 `package.json` 暴露统一入口：
   ```json
   "verify": "node scripts/gate/run-all.ts"
   ```
   （`run-all.ts` 依次 spawn 全部 gate 并汇总退出码 —— 这就是 F11 的最小落地形态。）
2. 把 A5 里的写文件脚本统一加 `--dry-run` / `--out` / `--force` 三件套，至少 `extract-solver-data.mjs` 优先（F7）。
3. 删除 `playtest-spike.mjs`（F9）、`.research_zbll_probe.mjs`（F19）。
4. 新增 `scripts/README.md`，按上表四分类列出每个脚本、运行方式、是否在 CI、是否写文件。

---

# 附录 B — 建议的 CI 目标形态（一次性收敛上述 high 项）

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:                       # 现有 job，保持
    name: Typecheck + Build + Verify
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: '.node-version', cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build
      - run: npm test                        # ← F11：node --test 统一入口
      - name: Gates (native Node, strip-types)
        run: node scripts/gate/run-all.ts    # ← F6：12 个 gate 一次跑完
      - name: Version sync
        run: node scripts/verify-versions.ts # ← F12/F17

  rust:                       # ← F5
    name: Tauri
    runs-on: windows-latest
    steps: [... dtolnay/rust-toolchain, cargo check, cargo clippy ...]

  playtest:                   # ← F2/F3（改造后）
    name: Playtest
    runs-on: windows-latest
    steps: [... setup-chrome, 起 5174 dev server, node scripts/playtest-ui.mjs ...]
```

对应关系一览：

| 本报告发现 | 对应改动 |
|---|---|
| F1 | 新增 `release.yml`（tags 触发）或改文档 |
| F2 / F3 | 新增 `playtest` job + 浏览器跨平台化 + 改 `networkidle0` |
| F4 / F17 | `package.json` 声明 three/@types/three + 刷新 lock |
| F5 | 新增 `rust` job |
| F6 | 新增 `gates` 步骤 |
| F7 | `extract-solver-data.mjs` 加 `--out/--force` 或删除 |
| F8 | 修 `GrayOverlay.ts:28` + 加 strip-compat 校验脚本 |
| F9 | 删除 `playtest-spike.mjs` |
| F10 | CSP + 代码签名 + bundle 精简 |
| F11 | `node --test` + `npm test` |
| F12 / F17 | `verify-versions.ts` 统一校验三处版本 |
| F13 | `record-solver-baseline.ts --out` + CI diff |
| F14 | `engines` + `.node-version` |
| F15 / F22 / F23 | 端口与 SPIKE_URL 约定落到代码 |
| F16 | 补 `.ts` 扩展名 |
| F18 | 删 serde / serde_json |
| F19 / F20 / F21 | 删孤儿文件 + 修文档 |
| F24 / F25 / F26 | CI 卫生 + 文档措辞 |
