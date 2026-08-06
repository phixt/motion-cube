# 旧文档归档（docs_old）

> 归档自：`example.md`、`forumlaExample.md`、`spike.md`（均已删除），内容重构为更清晰的描述。
> 当前有效文档：`base.md`（基底魔方需求）、`start.md`（项目目标）、`formula.md`（公式库需求）、`params.md`（手法动画编辑器参数模型）。

## 1. 手指动作示例（原 example.md）

原文为口语化、不精确的叙述，**不作为逐句还原的依据**；其全部要素已参数化进 `params.md`。以下为重构后的要素清单（仅作背景参考）。

### 计量约定

- 关节角以指腹侧为基准：完全伸直 = 180°，自然弯曲 ≈ 135°，弯曲极限 ≈ 90°。
- 指节：第一指节（近节）、第二/三指节（中节 + 远节）；涉及关节：近端指间（PIP）、远端指间（DIP）。

### 手法一：单拨 U（左手食指）

- 初始态：近节与 UL 边平行；PIP 自然弯曲、DIP 几乎不弯；第二 + 三指节与 ULB 的 LB 边约成 45°；接触点在指腹近指尖约 1/3 处，落在 UL 边。
- 终态：指背贴合（原 ULB → 现 ULF 的）L 面，并延伸至现 LU 棱的 L 面；PIP ≈ 45°、DIP ≈ 135°。
- 连拨：复位后重复（"单指常规两拨"）。

### 手法二：双指连拨（食指 + 中指）

- 初始态：手掌旋转；两指与 U 面近乎垂直；两指关节自然弯曲、略成圆弧；接触：食指指腹靠中指侧 1/3 贴 ULB 的 B 面。
- 过程：两指近似先后平行拨动；理想态下拨到一半手指即离开魔方（接触中途解除）。
- 终态：近端自然放置。

### 手法三：食指 eido 连拨（"eido" 为占位名，词义待确认）

- 初始态：指腹贴 ULB 的 B 面，指轴与 U 面夹角 45°～完全平行（连续参数族）。
- 中间态：≈ 单拨 U 的终态。
- 终态：近中指侧贴（现 UF 边的）F 面；PIP ≈ 135°，DIP 几乎不弯。

### 原文歧义（供参考）

- "近端指骨间关节自然弯曲，近端…几乎不弯曲"疑为"近端自然弯曲、远端几乎不弯"的笔误。
- "近指尖 1/3" 的计量起点未定义（`t` 起点可配）。
- "eido" 词义不明。

## 2. 公式示例（原 forumlaExample.md）

- V Perm：`(R' U R' U') (R D' R' D) R' UD' (R2 U' R2' D R2)`（15 步；"UD'" 为组合动作，cubing.js 可原样解析）。
- 还原过程示例（占位性质，非标准格式）：打乱一般 20 步；按阶段（CFOP/桥式等）记录，每步可拆解统计。
- 公式库只存公式（标准 R L 记法），不存速度/手法；与手法库建立关联（见 `formula.md`、`params.md`）。

## 3. Spike 验证结论（原 spike.md）

### 结论

- cubing.js 0.63.3 路线验证通过：记法解析/播放、自定义键盘映射、鼠标拖拽视角全部生效。
- 记法：`cubing/alg` 支持 WCA/SiGN 全语法（M/E/S 中层、双层、x/y/z、交换子、多行注释），解析/回写/展开/求逆通过；V Perm 原样可解析；非法输入抛错。
- 键盘：关闭内置输入，自定义 keydown 层 + `experimentalAddMove(move, {cancel:true})`；实测 R / R' / M / x / r 生效。
- 拖拽：`experimentalDragInput: "auto"` 为 Twizzle 式原生视角旋转。

### cubing API 速查（实现阶段仍有用）

- `TwistyPlayer` 配置：`puzzle / alg / visualization / background / controlPanel / hintFacelets / experimentalMovePressInput / experimentalDragInput / cameraLatitude|Longitude|Distance / tempoScale`。
- 取值：`controlPanel: "none"`、`visualization: "3D"`、`hintFacelets: "none"`、`experimentalMovePressInput: "auto"|"none"|"basic"`、`experimentalDragInput: "auto"|"none"`。
- 方法：`play / pause / togglePlay / experimentalAddMove / experimentalRemoveFinalChild（动画撤销）/ jumpToStart / experimentalScreenshot`。
- 属性（setter）：`alg / tempoScale / cameraLatitude / cameraLongitude / cameraDistance / cameraLatitudeLimit / experimentalSetupAlg`。

### 工具坑（Windows）

- puppeteer-core 启动 Edge 时若已有 Edge 实例会直接让位退出（code 0）；改用 Chrome + 临时 `--user-data-dir` 解决。
- 新版 puppeteer 移除了 `page.waitForTimeout`，用 `sleep()` 代替。
- WebGL 无头渲染需 `--enable-unsafe-swiftshader --use-angle=swiftshader`。
- TypeScript 7 对未使用参数/属性检查更严；CSS 副作用导入需 `src/vite-env.d.ts`。
