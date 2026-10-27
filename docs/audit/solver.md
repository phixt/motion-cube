# solver 审计报告 — 纯 TS 求解器（engine / search / algs / cfop / roux / zbl / zbls / f2lTable / solve / methodOptions）

- 审计范围：`src/cube/solver/{engine,search,algs,algsRaw,cfop,roux,zbl,zbls,f2lTable,solve,index,methodOptions}.ts`、`docs/plan-solver-interaction.md`、`docs/research-roux-adv.md`、`scripts/{smoke-solver,smoke-solver-edge,verify-zbll-coverage,verify-zbls-rounds,record-solver-baseline}.ts`、`scripts/playtest-solver.mjs`
- 旁读（消费侧，只为判断影响面）：`src/vue/pages/GamePage.vue`、`src/cube/stickering.ts`、`src/game/session.ts`、`src/notation/alg.ts`、`.github/workflows/ci.yml`
- 排除：`node_modules/`、`dist/`、`src-tauri/target/`、`spike-shots/`、`reference/`、`.reasonix/`、`src/vendor/winui-on-web`
- 方法：逐行读真实代码；所有结论均用**只读**探针脚本在 OS 临时目录（`%TEMP%/mc-audit/`）实测复现，脚本只 import 仓库模块、只写临时目录，**未写入仓库任何文件**（本文件除外）；未执行 `npm install`、未起 dev server、未 commit/branch/stash。
- 环境：Windows / Node v24.18.0 / npm 11.16.0。仓库自带的 `node scripts/verify-zbll-coverage.ts`（exit 0）、`npx tsx scripts/verify-zbls-rounds.ts`（exit 0，2603 轮）、`node scripts/verify-solve-base.ts`（exit 0）均实跑复核。
- **未运行 `scripts/record-solver-baseline.ts`**：该脚本会写 `docs/solver-baseline.json`（已跟踪文件），本次为只读审计，故意规避（见 F15）。

---

## 一、总体结论

**引擎层（engine.ts）与搜索层（search.ts）质量很高，本轮实测未发现正确性缺陷**：54 个转动的置换表全部满足双射 / 四次复原 / dest-perm 一致；棱角 code 编解码 24×2 组全部往返一致；300 个随机状态中**角置换奇偶 == 棱置换奇偶**的立方体不变量 0 次违例；IDA* 的 PDB 启发式可采、节点数实测峰值 **1903**（预算 6e6/8e6 绰绰有余），单次搜索 <1 ms。

**问题集中在"表 + 查表 + 文档口径"这一层**：ZBLL/ZBLS/EOLR 三张表的**查表键都编码了不该编码的状态**，导致高级分支在真实状态上**命中率≈0**，而这一失效被文档口径（"库完整 493/493 = 100%"）与脚本里的**非断言式统计**双重掩盖。此外发现一处**确凿的方向性 bug**：`WHOLE_ROT24` 只覆盖 24 个整块旋转中的 16 个，使演示收尾在 6/24 的魔方朝向下**底色错误**。

| # | 标题 | 严重度 | 分类 | 文件 | 行 | 工作量 | 置信度 |
|---|---|---|---|---|---|---|---|
| F1 | `WHOLE_ROT24` 只覆盖 16/24 个整块旋转 → 演示收尾底色错误 | high | 正确性 | src/cube/solver/solve.ts | 112-125, 137-143 | S | high |
| F2 | ZBLS 一步分支在真实状态上命中率 0（表键编码了完整 LL，与"LL 任意"契约矛盾） | high | 正确性 / 静默失效 | src/cube/solver/zbls.ts | 5-11, 40-45, 71-85, 140-170 | L | high |
| F3 | ZBLS 非 FR 缺槽失效的根因被误判为 `Y_TO_FR` 映射错（映射实测正确） | medium | doc-vs-code drift | src/cube/solver/zbls.ts | 25-32 | S | high |
| F4 | `zbl.ts` 头注释"任意棱已定向的顶层态都恰有一条 ZBLL 一步解"实测为假（命中率 50%） | medium | doc-vs-code drift | src/cube/solver/zbl.ts | 5-7, 105 | S | high |
| F5 | EOLR 一步表键值配对不成立（键=U 归一后的指纹，值=未归一 setup 的公式）：22 条中 11 条失效 | medium | 正确性 | src/cube/solver/roux.ts | 61-70, 114-124, 163-178 | M | high |
| F6 | `roux.eolr` 选项实际是空操作：roux-adv ≡ roux-merge（40/40 样本逐字节相同） | medium | 死代码 / 状态契约 | src/cube/solver/methodOptions.ts, src/cube/solver/roux.ts | 146-154, 163-188 | M | high |
| F7 | `verify-zbls-rounds.ts` F 段无硬断言（712/726 脱靶被容忍），B 段是自证式循环 | medium | 缺回归覆盖 | scripts/verify-zbls-rounds.ts | 116-139, 200-233 | M | high |
| F8 | CI 不跑 `verify-zbls-rounds.ts` / `record-solver-baseline.ts` / `verify-solve-base.ts` | medium | CI 卫生 | .github/workflows/ci.yml | 36-43 | S | high |
| F9 | smoke 只覆盖 3/5 方法；`roux-merge`、`roux-adv`（UI 选项实际落点）无任何 CI 覆盖 | medium | 缺回归覆盖 | scripts/smoke-solver.ts, scripts/smoke-solver-edge.ts | 28, 6-27 | S | high |
| F10 | 显式解法底（baseFace）路径缺少端到端朝向断言（`verify-solve-base.ts` A6 断言的是 endAlg **之前**的状态） | medium | 缺回归覆盖 | scripts/verify-solve-base.ts | 114-131 | S | high |
| F11 | 求解器无 Worker；主线程同步建表 ~560 ms（搜索本身 <1 ms，瓶颈在建表不在搜索） | medium | 性能 / 主线程 | src/cube/solver/solve.ts, src/vue/pages/GamePage.vue | 60-63 | M | high |
| F12 | Roux/EO 搜索深度上限余量仅 1 步（block2 上限 14 vs 实测最优 13；eo 上限 12 vs 11） | low | 健壮性 | src/cube/solver/roux.ts | 145-153, 180, 227 | M | medium |
| F13 | `cfop.solveSlot` 的 `EJECT[4]` 兜底分支不可达（0/2436），且语义错误（该 eject 的是角不是棱） | low | 死代码 | src/cube/solver/cfop.ts | 17-18, 74-80 | S | high |
| F14 | 硬编码表生成器依赖仓库外绝对路径，CI 无漂移校验（当前数据实测一致） | low | 可复现性 | scripts/extract-solver-data.mjs | 5 | S | high |
| F15 | i18n 孤儿键 `solve.methodCfopAdv`；阶段/方法 `label` 为永不渲染的硬编码中文 | low | i18n / 死数据 | src/i18n/locales/en.ts, src/i18n/locales/zh-CN.ts, src/cube/solver/solve.ts | 138, 136 | S | high |
| F16 | 非法状态下 `llCornerPerm` / `llEdgePerm` 静默错编码（readCorner/readEdge 返回 -1） | low | 健壮性 | src/cube/solver/algs.ts | 64-73 | S | high |
| F17 | ZBLS/ZBL 建表阶段 `catch {}` 静默吞掉解析/归位失败 | low | 错误处理 | src/cube/solver/zbls.ts, src/cube/solver/zbl.ts | 71-77, 115-124 / 67-74 | S | high |

---

## 二、实测验证记录

| 探针（`%TEMP%/mc-audit/`） | 关键输出 |
|---|---|
| `t1-engine.mts` | 54 转动：双射/四次复原/dest-perm 全部 OK（problems=0）；棱角 code 往返 0 错；**WHOLE_ROT24 distinct=16 / 24**；F2L 表 150 条：键错配 0、块未解 0、破坏其它槽 0；`ALG_RAW` 88 条 → 接受 90（含 3 条 AUF），仅拒 `CMLL-g` |
| `t2-coverage.mts` | 角/棱奇偶不变量 300 随机态 **0 违例**；OLL 图 **216 节点 = 全部合法 OLL 朝向态**；PLL 图 **288 节点 = 全部奇偶一致 LL 置换态**；ZBLL 表 **1068** 条，一步命中率 **30/60 = 50%**；ZBLS 表 268 键 / 1696 候选，缺槽 FR 命中 270/270（其余槽数据里根本不出现）；EOLR 表 **22** 条 |
| `t3-zbls-rot.mts` | 引擎 y 轴实测映射 FR→FL→BL→BR→FR ⇒ **到 FR 的转数正是 {FR:0, FL:3, BL:2, BR:1}**，与 `Y_TO_FR` 完全一致 |
| `t4-issues.mts` | `CFOP.solveAdvanced` 内 ZBLS 分支命中 **0/40**；`tidyAlg` 3000 随机序列语义保持 **0 违例**；F2L 已解槽被破坏 0/2000；Roux block2 实测最优深度峰值 **13** |
| `t5-perf.mts` | WHOLE_ROT24 换成 y 自转后 distinct=**24**（修复验证）；`prepare` 合计 **561 ms**（cfop 130 / zbl 45 / roux 371 / zbls 15）；单次搜索节点峰值 **1903**；深度峰值 block1=9(block2=13, eo=11, ulur=6, l4e=10) |
| `t6-zbls-data.mts` | cuberoot zbls 每 case 4 组：group0/1/2/3 分别对应缺槽 FR/FL/BL/BR；group0 施加于 setup → 缺槽=null（解完），group1..3 施加于 setup → 缺槽=MULTI（用错组）；**roux-adv 与 roux-merge 40/40 样本逐字节相同** |
| `t7-e2e.mts` | 250 组 22 步打乱 × 5 方法 **失败率全 0**；baseFace 端到端 **6/144 组合底色错误**；生成器源文件存在 |
| `t8c.mts` | 生成器抽取内容与仓库 `f2lTable.ts` / `algsRaw.ts` **完全一致**（仅差文件头注释与 export 行） |
| `t9-f2l-branches.mts` | `solveSlot` 分支计数：表命中 1498 / 角 eject 473 / 棱 eject 465 / **兜底 EJECT[4] = 0** |
| `t10-eolr.mts` | EOLR 22 条中 **15 条的归一 U 转角 ≠ 0**，其中 **11 条施加于其键所代表的归一态后 EO 不成立**（22 条施加于原始 setup 全部成立） |
| `t11-endalg.mts` | endAlg **之前**底色错 20/144（其中 14 例被 endAlg 正确修正）；**endAlg 之后（用户实际所见）底色仍错 6/144**，全部是 `endAlg=""` 的组合 |

---

## 三、发现明细

### F1 — `WHOLE_ROT24` 只覆盖 16/24 个整块旋转 → 演示收尾底色错误

- **严重度**：high
- **分类**：正确性（朝向契约）
- **文件**：`src/cube/solver/solve.ts:112-125`（表构造）、`137-143`（匹配函数）
- **证据**（`solve.ts:112-125` 原文）：

```ts
/** 全部 24 个整块旋转朝向：对每个面 f 用 baseFaceSetupAlg(f)（修方向后：把 f 色面位转到 D）
 *  作底朝向，再绕 D 轴（z 轴）自转 4 分位。覆盖「f 色在 D × 4 自转」= 完整 24 朝向。 */
const WHOLE_ROT24: string[] = (() => {
  const out: string[] = [];
  for (const f of FACES) {
    const setup = baseFaceSetupAlg(f);
    for (const spin of ["", "z", "z2", "z'"]) {
```

```ts
function finishRotBetween(T: State, target: State): string {
  const tc = centerColors(target);
  for (const g of WHOLE_ROT24) {
    if (centerColors(applyAlg(T, g)) === tc) return g;
  }
  return "";
}
```

- **根因**：注释写"绕 D 轴（z 轴）"——**D 轴是 y 轴，z 轴是 F/B 轴**。`baseFaceSetupAlg(f)` 把 f 色转到 D 之后，自转必须绕 **y**（D 轴）才能保持"f 色仍在 D"；用 z 自转会把 D 面位上的颜色转走，因此 24 个条目只产生 **16** 个互异朝向（8 个重复、8 个缺失）。
- **实测**：`t1-engine.mts` → `WHOLE_ROT24 entries=24 distinct orientations=16`，与"完整 24 朝向"的自述直接矛盾；缺失的 8 个朝向即 `x z` / `x z'` / `x' z` / `x' z'` / `x2 y` / `x2 y'` 等组合。
- **用户可见影响**：`finishRotBetween` 找不到匹配时**静默 `return ""`**。`t11-endalg.mts` 实测：24 种魔方朝向 × 6 种解法底共 144 组合中，**6 组合在演示收尾后底面颜色不是所选底色**（魔方已还原，但底色错了）：

```
POST rot="x z" base=D D色=R want=D endAlg="" setup=""
POST rot="x z'" base=D D色=L want=D endAlg="" setup=""
POST rot="x' z" base=D D色=R want=D endAlg="" setup=""
POST rot="x' z'" base=D D色=L want=D endAlg="" setup=""
POST rot="x2 y" base=D D色=U want=D endAlg="" setup=""
POST rot="x2 y'" base=D D色=U want=D endAlg="" setup=""
```

  `GamePage.vue:292-295` 在演示末尾施加 `endAlg`，为空即"不转"→ 用户看到"解完了但底色不是我选的那个"。可达路径：游戏公式框接受 `x/y/z`（`src/notation/alg.ts` 用 cubing `Alg.fromString`，自检用例含 `"x y' z2"`），叠加"六色底"开启时的整块前缀，即可构造出 `x z`、`x2 y` 这类朝向。
- **修复**：把自转轴改成 D 轴（y）：

  ```ts
  for (const spin of ["", "y", "y2", "y'"]) {
  ```

  `t5-perf.mts` 实测该改动后 `distinct=24`（原 z 版为 16）。更稳妥的做法是直接复用 `engine.ts:381-400` 已有的 `ROTATIONS`（那里就是用 x/y/z 三轴 BFS 出的 24 个朝向），避免第二份"手写朝向表"。
- **工作量**：S
- **置信度**：high（表构造、匹配函数、24 朝向真值、端到端底色结果四重实测）

---

### F2 — ZBLS 一步分支在真实状态上命中率 0（表键编码了完整 LL，与"LL 任意"契约矛盾）

- **严重度**：high
- **分类**：正确性 / 静默失效（整条高级分支不生效）
- **文件**：`src/cube/solver/zbls.ts:5-11`（契约）、`40-45`（坐标）、`71-85`（归一）、`98-129`（建表）、`140-170`（查表）
- **证据**（`zbls.ts:5-7` 自述 vs `40-45` 实现）：

```ts
 * 坐标：状态 = 「3 组 F2L 完成 + 1 组缺 + LL 任意」。
```

```ts
/** LL 完整坐标：角置换 × 角朝向 × 棱置换 × 棱翻色（U 层 8 块任意状态） */
const llCode = (state: State): number =>
  permIndex(llCornerPerm(state)) * 81 * 24 * 16 +
  base3(llCornerTwists(state)) * 24 * 16 +
  permIndex(llEdgePerm(state)) * 16 +
  base2(llEdgeFlips(state));
```

- **根因**：契约声明坐标只描述「3 组 F2L 完成 + 1 组缺 + **LL 任意**」，但 `llCode` 把 LL 的角置换/角朝向/棱置换/棱翻色**全部精确编码**（码空间 24×81×24×16 = 746496）。建表时键 = cuberoot 302 条 case 的 setup 态的 `llCode`（268 个互异键）；查表时键 = 真实状态的 `llCode`。真实状态的 LL 是任意的 → 落在这 268 个键上的概率≈0。
- **实测**：
  - `t4-issues.mts`：`CFOP.solveAdvanced` 内部 `solveZbls(st)` 命中 **0/40**（生产路径实测）。
  - `t2-coverage.mts`：ZBLS 表 268 键 / 1696 候选；对 cuberoot setup 态本身查表命中 270/270（即"表查自己"必中）。
- **用户可见影响**：`cfop-adv` 的第 4 组 F2L 永远走普通插入，`zbls` 阶段永不出现；用户勾选"一步 ZBLL(ZBLS)"高级选项得不到任何行为差异，界面无任何提示。整套 302 条数据 + 268 键表 + `verify-zbls-rounds.ts` 2603 轮验证在生产路径上**零收益**。
- **修复方向**（建议，非唯一）：
  1. 坐标降维：把 LL 抽象成 **EO 类 + 角块朝向类**（与 `docs/research-roux-adv.md` §2.1 对 EOLR 的结论同构），键 = (缺槽, EO 类)；
  2. 或改为主动搜索：把「最后一对 F2L + 顶层」作为联合搜索目标（当前代码库已有 PDB/IDA* 基础设施可用），彻底摆脱"必须命中 302 个训练态"的限制；
  3. 无论选哪条，都需要先修 F3/F7（口径与断言），否则修完也无法证明修好了。
- **工作量**：L
- **置信度**：high

---

### F3 — ZBLS 非 FR 缺槽失效的根因被误判为 `Y_TO_FR` 映射错（映射实测正确）

- **严重度**：medium
- **分类**：doc-vs-code drift（错误结论会误导后续修法）
- **文件**：`src/cube/solver/zbls.ts:25-32`
- **证据**：

```ts
// 缺槽 → 槽位归一到 FR 的 y 整转次数。
// ⚠ 已知局限（2026-09-11 F 段实证）：新旧两版映射（{FL:3,BL:2,BR:1} 与
//   {FL:1,BL:2,BR:3}）下非 FR 缺槽查表均 100% 脱靶（F 段 0 命中）——方向推导
//   （y 内容循环 F→R→B→L 时新映射应为正，共轭/直加两口径皆然）与实证矛盾，
//   嫌疑转向 F 段构造的组↔槽对应/整转残差或建表-查表口径不对称；修法另行
//   设计，落地时把 verify-zbls-rounds.ts F 段恢复为硬断言。
// 当前维持旧版数值 = 非 FR 槽查表脱靶后静默回退（与 0.3.8 生产行为一致）。
const Y_TO_FR: Record<string, number> = { FR: 0, FL: 3, BL: 2, BR: 1 };
```

- **实测反证**（`t3-zbls-rot.mts`）：用引擎自己的 y 轴旋转实测面位映射 `FR→FL→BL→BR→FR`，据此"把某槽转到 FR"的转数恰为 `{FR:0, FL:3, BL:2, BR:1}`——**与代码里的 `Y_TO_FR` 完全一致**，注释里被否定的"新版" `{FL:1,BL:2,BR:3}` 才是错的。
- **真正的根因**：`zbls.ts:74` 自己已经写明——"**y 整转会把 home 棱带走**"。整块 y 旋转会把已解的 3 个 F2L 槽的块一起转走（不再 home），因此"把缺槽转到 FR"这件事在整块旋转意义下**不可能同时保持其余 3 槽已解**；查表键随之改变 → 必然脱靶。正确做法是**用 group 序号表达槽位**（cuberoot 数据里 group0/1/2/3 本来就分别对应缺槽 FR/FL/BL/BR，见 `t6-zbls-data.mts` 实测），而不是用整块 y 去"归一"。
- **影响**：注释把后续修法引向错误方向（改映射数字），而正确修法在坐标/分组层面；`docs/todo.md:55-57` 的"嫌疑在组↔槽对应/整转残差"方向反而更接近。
- **修复**：重写该注释为"映射已实测正确；脱靶根因是整块 y 归一会破坏其余 3 槽并改变查表键，应改用 cuberoot 的 group 序号表达缺槽"，并把 F 段的期望值写进断言。
- **工作量**：S
- **置信度**：high

---

### F4 — `zbl.ts` 头注释"任意棱已定向的顶层态都恰有一条 ZBLL 一步解"实测为假

- **严重度**：medium
- **分类**：doc-vs-code drift
- **文件**：`src/cube/solver/zbl.ts:5-7`（头注释）与 `105`（内联注释）自相矛盾
- **证据**：

```ts
 *   - ZBLL：在完整 ZBLL 状态空间（角置换 24 × 角朝向 27 × 棱置换 12 = 7776）
 *     上以 cuberoot 466 条 ZBLL 公式为边 BFS——库完整，故任意"棱已定向"的
 *     顶层态都恰有一条 ZBLL 一步解；找不到即回退 OLL→PLL。
```

```ts
  // 一步 ZBLL 查表：4 种 AUF 变体码查表（变体库闭包覆盖 ~52% 轨道；未覆盖由调用方回退 OLL+PLL）
```

- **实测**（`t2-coverage.mts`）：ZBLL 表 1068 条；对 60 个"已完成 F2L"的真实状态调用 `ZBL.solveLL`，一步 ZBLL 命中 **30/60 = 50%**，与内联注释的"~52% 轨道"吻合，与头注释的"任意…都恰有一条"**直接矛盾**。文件内两处注释相隔 100 行给出相反结论。
- **外溢**：`AGENTS.md`（"一步 ZBLL 库完整 **493/493**（52.5%/926 轨道级旧口径已废弃…）"）与 `docs/todo.md:11-13`（"493/493（case 级覆盖 100%…**实际问题在命中率口径**）"）把"**数据 case 数完整**"表述成"**覆盖 100%**"，二者容易被读成"一步 ZBLL 总能命中"。`scripts/verify-zbll-coverage.ts` 测的是 cuberoot **数据**的 case 完整性（且用的是 case 的 `setup`，而 `zbl.ts` 建表用的是 `alg` 的逆态），**与运行时查表命中率不是同一件事**，脚本本身不测命中率。
- **用户可见影响**：高级 CFOP 的 LL 段有约一半概率回退到 OLL+PLL，用户看到的步数收益低于预期；文档承诺与实际不符。
- **修复**：
  1. 删掉 `zbl.ts:6-7` 的"故任意…都恰有一条"，改为"库完整指**数据 case 完整（493/493）**；**运行时一步命中率约 50%**（实测），未命中回退 OLL→PLL"；
  2. 在 `verify-zbll-coverage.ts` 里补一条**运行时命中率**断言（例如"≥40%"），把口径钉死，避免下次又被 493/493 掩盖；
  3. 同步修正 `AGENTS.md` 的表述。
- **工作量**：S
- **置信度**：high

---

### F5 — EOLR 一步表键值配对不成立（键=归一后指纹，值=未归一 setup 的公式）

- **严重度**：medium
- **分类**：正确性（表建/查不一致）
- **文件**：`src/cube/solver/roux.ts:61-70`（指纹）、`114-124`（建表）、`163-178`（查表）
- **证据**：

```ts
/** EOLR 表指纹：6 棱 code + U 中心 code，U 旋转 4 种取最小 */
function eolrFingerprint(state: State): { fp: number; um: number } {
```

```ts
  // EOLR 一步表：setup 态指纹 → 公式。仅保留「施加后动态 EO done」的全 EO case（Arrow 等中间态不入表）。
  const eolr = new Map<number, { moves: string[]; name: string }>();
  for (const c of EOLR_RAW.cases) {
    ...
    const { fp } = eolrFingerprint(S);
    if (!eolr.has(fp)) eolr.set(fp, { moves, name: c.name });
  }
```

```ts
  const { fp, um } = eolrFingerprint(st);
  const eolrHit = T.eolr.get(fp);
  if (eolrHit) {
    const pre = um ? parseAlg(U_MOVES[um]) : [];
    const st2 = applyAlg(st, [...pre, ...eolrHit.moves]);
    if (lseEoDone(st2)) {
```

- **根因**：建表键取的是 `min` over U 旋转的**归一化**指纹（即 `S·U^j` 的指纹，j 未必为 0），但存进去的**值是解 `S` 的公式**；查表时命中后先把 live 态转成其归一形再套该公式。`S·U^j` 与 `S` 的 LL 内容不同、而公式并不与 U 交换，故"键所代表的状态"与"公式所解的状态"不是同一个。
- **实测**（`t10-eolr.mts`）：表内 22 条中 **15 条的归一 U 转角 ≠ 0**，其中 **11 条**把公式施加到其键所代表的归一态后 **EO 不成立**（同样 22 条施加到原始 setup 态则 22/22 成立）。即 22 条里约一半是"配错键"的条目。
- **用户可见影响**：EOLR 分支几乎永远不触发（被 `lseEoDone(st2)` 事后校验挡住），与 `docs/todo.md:59` 记录的"EOLR 一步表命中率 ~0"互为因果——**修好"配对"只是必要条件，命中率低的另一个原因正是 `docs/research-roux-adv.md` §2.1 指出的"位置级指纹"抽象错误**（46 条 setup 全是"箭头已形成"的规范位置，真实状态几乎不重合）。
- **修复**：
  1. **先修配对**（S）：建表时把 setup 先做 U 归一 `S' = S·U^j` 再取指纹并存 `S'` 的解（即存 `a'` = 能解 `S·U^j` 的公式），或在值里额外记录 `j` 供查表时反算；
  2. **再换抽象**（M/L，按 `docs/research-roux-adv.md` §2.1）：键从"6 棱绝对位置"改成"EO 类 + UL/UR 相对位"，否则配对修好后命中率仍是 ~0；
  3. 建表时加断言：每条入库公式施加到其键所代表状态后必须 `lseEoDone` 成立（现在只校验了"施加到原始 setup 后成立"）。
- **工作量**：M
- **置信度**：high

---

### F6 — `roux.eolr` 选项实际是空操作：roux-adv ≡ roux-merge

- **严重度**：medium
- **分类**：死代码 / 状态契约（UI 选项无效果）
- **文件**：`src/cube/solver/methodOptions.ts:146-154`、`src/cube/solver/roux.ts:163-188`
- **证据**（`methodOptions.ts:150-153`）：

```ts
  if (base === "cfop") return opts["cfop.zbll"] ? "cfop-adv" : "cfop";
  if (opts["roux.eolr"]) return "roux-adv"; // EOLR 一步 + 合并（高级）
  if (opts["roux.merge4b4c"]) return "roux-merge"; // 仅合并 4b+4c（4a 分步 + 4c 一步，默认）
  return "roux"; // 纯分步 4a/4b/4c
```

- **实测**（`t6-zbls-data.mts`）：40 个随机打乱上 `solve(st,"roux-adv")` 与 `solve(st,"roux-merge")` 的 `moves` **逐字节相同（40/40）**，阶段序列也相同（`block1>block2>cmll>lse-eo>lse-l4e` vs `…>lse-4c`，仅标签不同）。原因即 F5：EOLR 表命中率≈0，`roux-adv` 实际退化为 `roux-merge`。
- **用户可见影响**：求解选项面板里的"EOLR（EO + UL/UR 一起）"复选框（`en.ts:156-157`，提示文案本身就写着"Roux advanced research in progress"）勾不勾**输出完全一样**；用户以为启用了高级路线，实际没有。`docs/todo.md:69-70` 已记有"方法面板移除 cfop-adv / roux-adv 选项"的回退意向，但代码里选项仍在且行为未标注。
- **修复**：
  - 短期（S）：在选项 `hintKey` 文案里明确标注"当前实现与『合并 4b+4c』等价（EOLR 表命中率≈0），见 docs/todo.md"，或按 todo 的回退意向把该选项下掉；
  - 根本（M/L）：按 F5 重建 EOLR 表后再放出该选项。
- **工作量**：M
- **置信度**：high

---

### F7 — `verify-zbls-rounds.ts` F 段无硬断言、B 段是自证式循环

- **严重度**：medium
- **分类**：缺回归覆盖（该恢复断言的地方没恢复）
- **文件**：`scripts/verify-zbls-rounds.ts:116-139`（B 段）、`200-233`（F 段）
- **证据**（F 段 `218-232`）：

```ts
        // 已知局限（2026-09-11）：非 FR 槽当前查表脱靶静默回退（见 zbls.ts Y_TO_FR 注），
        // 此处只计数不 fail；修法落地时把本段恢复为硬断言（hit === total）。
        if (!res) { miss++; continue; }
```

- **实测**：该脚本实跑 exit 0（2603 轮 / 0 失败），但 F 段输出为 **`命中并通过: 14/726（未命中 712，跳过 180）`** —— 97% 的非 FR 轮次脱靶却**不产生任何失败信号**；脚本整体仍然"ALL PASS ✓"。这正是"静默回退掩盖失败"的典型：B 段 `1080/1080` 是把表用**建表时用的同一批 setup 态**再查一遍（`t2-coverage.mts` 复现：缺槽 FR 命中 270/270），属于自证循环，**无法发现生产路径命中率为 0**（`t4-issues.mts` 实测 0/40）。
- **影响**：F2/F3 这类"整条分支失效"的问题，在现有脚本下永远是绿的；CI 里又没有这个脚本（见 F8），于是 ZBLS 事实上处于"无回归保护"状态。
- **修复**：
  1. F 段恢复 `expect(hit === total, ...)`（前提是先修 F2/F3；修不了就显式 `expect(miss === 712, "已知脱靶数变化，需更新口径")` 做成"哨兵式"断言，避免默默变化）；
  2. **新增生产路径断言**：对随机打乱 → CFOP 前 3 组 F2L → `solveZbls` 的命中率设下界（例如 > 0），否则分支再次失效无人知晓；
  3. B 段补一条"用**非**建表键的状态查表"的负向断言。
- **工作量**：M
- **置信度**：high

---

### F8 — CI 不跑 `verify-zbls-rounds.ts` / `record-solver-baseline.ts` / `verify-solve-base.ts`

- **严重度**：medium
- **分类**：CI 卫生
- **文件**：`.github/workflows/ci.yml:36-43`
- **证据**：

```yaml
      - name: Solver + render + coverage smoke (native Node, strip-types)
        # node scripts/*.ts 直跑（Node 22 strip-types，无 tsx/esbuild 依赖，Linux 可跑）
        run: |
          node scripts/smoke-solver.ts
          node scripts/smoke-solver-edge.ts
          node scripts/verify-render-cube.ts
          node scripts/verify-zbll-coverage.ts
```

- **实测**：三个求解器回归脚本均不在 CI：`scripts/verify-zbls-rounds.ts`（2603 轮 ZBLS/ZBLL 实证）、`scripts/verify-solve-base.ts`（六色底端到端）、`scripts/record-solver-baseline.ts`（人类式分步契约基线）。前两个本机实跑均 exit 0，可直接进 CI（`record-solver-baseline.ts` 会写 `docs/solver-baseline.json`，见 F15，需先改成可写临时目录或加 `git diff --exit-code` 断言）。
- **影响**：CI 只覆盖"3 方法 × 3 次打乱"的冒烟，而 ZBLS/解法底/基线三类回归全靠人工本地跑；F1/F2 这类缺陷正好落在这个盲区里。
- **修复**：把 `node scripts/verify-solve-base.ts`、`npx tsx scripts/verify-zbls-rounds.ts` 加进 CI 的 solver 步骤；`record-solver-baseline.ts` 改造后以"跑完 + `git diff --exit-code docs/solver-baseline.json`"方式入 CI（把基线变成可回归的契约）。
- **工作量**：S
- **置信度**：high

---

### F9 — smoke 只覆盖 3/5 方法；UI 选项实际落点的 `roux-merge` / `roux-adv` 无 CI 覆盖

- **严重度**：medium
- **分类**：缺回归覆盖
- **文件**：`scripts/smoke-solver.ts:28`、`scripts/smoke-solver-edge.ts:6-27`
- **证据**：

```ts
  for (const method of ["cfop", "cfop-adv", "roux"] as const) {
```

```ts
const check = (name: string, state: Uint8Array, method: "cfop" | "roux") => {
```

- **影响**：五个方法里 `roux-merge`、`roux-adv` 从未被 CI 冒烟——而它们正是 UI 选项面板（`methodOptions.ts:150-153`）在默认配置下会解析到的分支（`roux.merge4b4c` 默认勾选 → `roux-merge`；勾 EOLR → `roux-adv`）。`smoke-solver-edge.ts` 的中心漂移/切片步边界用例同样只跑 cfop/roux 两个方法。
- **附带**：默认迭代数只有 3（`iters = args[0] ? parseInt(args[0], 10) : 3`），3 次打乱对"分支不触发"类缺陷（如 F2）几乎没有检出能力。
- **修复**：
  1. `smoke-solver.ts` 的方法列表扩到 5 个（`["cfop","cfop-adv","roux","roux-merge","roux-adv"]`）；
  2. `smoke-solver-edge.ts` 的 `check` 签名扩到 5 个方法；
  3. CI 里把迭代数提到 ≥ 20（脚本已支持 `node scripts/smoke-solver.ts 20`）；
  4. 断言"每个方法的阶段序列符合契约"（`record-solver-baseline.ts` 已有 `expectedStages`，可直接复用）。
- **工作量**：S
- **置信度**：high

---

### F10 — 显式解法底路径缺少端到端朝向断言（`verify-solve-base.ts` A6 断言的是 endAlg **之前**的状态）

- **严重度**：medium
- **分类**：缺回归覆盖（F1 恰好落在这个盲区）
- **文件**：`scripts/verify-solve-base.ts:114-131`
- **证据**：

```ts
// A6 演示收尾视角（实证正确语义）：演示序列 setupAlg→moves→(endAlg) 之后，玩家停在
// 「所选底色在 D 面位」的某朝向 solved —— 断言 T=applyAlg(applyAlg(st,setup),moves) 六面单色
// 且 D 面位中心色==所选底（=T 在「所选底朝向族」内）。
...
    const T = applyAlg(applyAlg(st, res.setupAlg), res.moves);
    ok(
      `A6 ${label} 底 ${f} 收尾停在所选底朝向`,
      isUniform(T) && T[3 * 9 + 4] === FACE_IDX[f],
```

- **问题**：A6 的语义描述写的是"演示序列 setupAlg→moves→**(endAlg)** 之后"，但断言里的 `T` **没有施加 `endAlg`**——即断言的是演示的中途状态，不是用户最终看到的状态。`GamePage.vue:292-295` 会在末尾再播 `endAlg`。F1 的 6 个失败组合恰好只会在"施加 endAlg 之后"暴露，而 A6 断言不到。
- **附带**：A6 用 `if (!res.setupAlg) continue;` 跳过了 `D`/`global`（无 setup 旋转）的情形——**F1 的 6 个失败组合全部是 `base=D`**（setupAlg 为空），即被这行 `continue` 全部跳过。
- **修复**：
  1. A6 增加 `const T2 = res.endAlg ? applyAlg(T, res.endAlg) : T;` 并断言 `T2[3*9+4] === FACE_IDX[f]`；
  2. 去掉 `continue` 跳过（`D`/`global` 也断言），并把**输入魔方的朝向**参数化（当前只有"标准 D 底态"和"红底实态"两种，覆盖不到 `x z`、`x2 y` 这类组合）——建议直接枚举 24 种整块朝向 × 6 种底；
  3. 该脚本当前不在 CI（见 F8），修完需入 CI。
- **工作量**：S
- **置信度**：high

---

### F11 — 求解器无 Worker；主线程同步建表 ~560 ms（瓶颈在建表，不在搜索）

- **严重度**：medium
- **分类**：性能 / 主线程
- **文件**：`src/cube/solver/solve.ts:60-63`（`prepareSolvers`）、消费侧 `src/vue/pages/GamePage.vue:126-128`
- **证据**：

```ts
export function prepareSolvers(method?: SolveMethodKey): void {
  const list = method ? [SOLVER_METHODS[method]] : Object.values(SOLVER_METHODS);
  for (const m of list) if (m) m.prepare();
}
```

  消费侧：

```ts
  const run = (): void => { try { prepareSolvers(); } catch { /* 预热失败也可在首次求解时惰性建表 */ } };
  if ("requestIdleCallback" in window) (window as unknown as { requestIdleCallback: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback(run, { timeout: 2000 });
```

- **实测**（`t5-perf.mts`）：`prepare` 全部方法合计 **561 ms**（cfop 130 / zbl 45 / roux 371 / zbls 15），全部在主线程同步执行；`GamePage` 用**无参数**的 `prepareSolvers()` → 一次性建全部 5 个方法的表。
- **但搜索本身极快**（这纠正了"搜索会卡死主线程"的担忧）：
  - 单方法求解 avg 0–1 ms / worst 2 ms（`t4-issues.mts`）；
  - 单次 IDA* 搜索节点峰值 **1903**、最坏耗时 **<1 ms**（`t5-perf.mts`），节点预算 6e6/8e6 从未被接近；
  - 250 组 22 步打乱 × 5 方法 **失败率 0/1250**（`t7-e2e.mts`）。
- **用户可见影响**：`requestIdleCallback` 若在用户点击"求解"之前没跑（或被其它任务推迟到 2s 超时），建表成本会落进点击处理链 → 一次 **~0.5 s 的 UI 冻结**；多色底还会再乘以底数（`GamePage.vue:234-237` 对每个底各解一次）。
- **修复**（按性价比排序）：
  1. **S**：`GamePage` 改成 `prepareSolvers(method)` 只建当前方法所需表（`solve.ts` 已支持该参数），把 561 ms 摊到方法切换；
  2. **S**：把 `prepareSolvers` 放到 Web Worker（或 `requestIdleCallback` + 分帧建表），构建表数据可序列化后传递；
  3. **S**：进入 GamePage 即预热（不必等 idle），避免"首次点击卡顿"；
  4. 可选：`prepare()` 结果按方法缓存到 `localStorage`/预生成 JSON，运行时只反序列化。
  > 说明：**不需要**为了"搜索不卡主线程"而做 Worker——搜索本身是亚毫秒级；Worker 的价值在于把 ~0.5 s 的建表移出主线程。
- **工作量**：M
- **置信度**：high（均为实测；"无 Worker"已全仓 grep 确认）

---

### F12 — Roux / EO 搜索深度上限余量仅 1 步

- **严重度**：low
- **分类**：健壮性（深度上限 → 硬失败）
- **文件**：`src/cube/solver/roux.ts:145`（block1 depth 12）、`150`（block2 depth 14）、`180`（eo depth 12）、`227`（ulur depth 12）、`233`（l4e depth 16）、`186`（l4e depth 18）
- **证据**：

```ts
  mv = runItem(T.block2, 14, 8e6);
  if (!mv) throw new Error("second block failed");
```

```ts
    mv = runItem(T.eo, 12, 4e6);
    if (!mv) throw new Error("LSE edge orientation failed");
```

- **实测**（`t4-issues.mts` / `t5-perf.mts`）：最优深度峰值 block1=9（上限 12）、**block2=13（上限 14）**、**eo=11（上限 12）**、ulur=6（上限 12）、l4e=10（上限 16/18）。即 block2 与 eo 各只有 **1 步**余量；12 步打乱样本里 10/120 例的最优深度已达 13。
- **影响**：一旦某状态的最优解超上限，`solve()` 返回 null → 抛 `"second block failed"` / `"LSE edge orientation failed"`，UI 只能显示"求解失败"，**无降级路径**（不像 CFOP 那样会回退）。当前 250 组打乱 × 5 方法失败率 0，概率低，但余量过薄且失败是"硬失败"。
- **修复**：把 block2 上限提到 16、eo/ulur 提到 14（节点预算不变，实测节点峰值仅 1903，预算充裕得多）；或失败时放宽深度重试一次再抛。
- **工作量**：M
- **置信度**：medium（深度峰值基于 120–250 个样本，是下界不是上界）

---

### F13 — `cfop.solveSlot` 的 `EJECT[4]` 兜底分支不可达，且语义错误

- **严重度**：low
- **分类**：死代码（潜在错误兜底）
- **文件**：`src/cube/solver/cfop.ts:17-18`、`74-80`
- **证据**：

```ts
const EJECT: Record<number, string> = { 4: "R U R'", 5: "L' U' L", 6: "L U L'", 7: "R' U R" };
const EJECT_E: Record<number, string> = { 8: "R U R'", 9: "L' U' L", 10: "R' U R", 11: "L U L'" };
```

```ts
    let alg = F2L_TABLE[cc + "_" + ec];
    if (!alg) {
      const cSlot = (cc / 3) | 0, eSlot = ec >> 1;
      if (cSlot > 4) alg = EJECT[cSlot];
      else if (eSlot > 8) alg = EJECT_E[eSlot];
      else alg = EJECT[4];
    }
```

- **分析**：表覆盖 corner code 0..14 × edge code {0..7,16,17}（150 条全在，已逐条验证键↔公式一致且能解）。查表失败只有两种情形：corner 在别的 D 槽（cSlot 5..7 → `EJECT`）或 edge 在别的中层槽（eSlot 9..11 → `EJECT_E`）。`eSlot ∈ 4..7`（DF/DR/DB/DL）时才会落到 `EJECT[4]`，但十字已解 → 这 4 个 D 槽被十字棱占据 → **FR 棱不可能在那儿**，故 `EJECT[4]` 不可达；而它一旦可达也**是错误动作**（`EJECT[4]="R U R'"` 顶的是角，棱在 D 层时应走 `EJECT_E` 语义）。
- **实测**（`t9-f2l-branches.mts`，150 组打乱）：分支计数 `{table:1498, ejectCorner:473, ejectEdge:465, fallbackEject4:0}` → 兜底分支 **0 次**。
- **附带**：`EJECT_E[8]` 定义了但 `eSlot > 8` 永不取到 8（FR 是 home 槽，已被表覆盖）→ 死条目。
- **修复**：删除 `else alg = EJECT[4];` 分支（改为 `throw`，让"理论上不可能"的状态显式暴露而不是静默做错动作）；删除 `EJECT_E[8]`。
- **工作量**：S
- **置信度**：high

---

### F14 — 硬编码表生成器依赖仓库外绝对路径，CI 无漂移校验

- **严重度**：low
- **分类**：可复现性 / 依赖卫生
- **文件**：`scripts/extract-solver-data.mjs:5`
- **证据**：

```js
const SRC = "C:\\Users\\phx_lumin\\Downloads\\rubik-cube.html";
```

- **实测**：该文件在本机**存在**，且用它重新抽取的内容与仓库里的 `src/cube/solver/f2lTable.ts` / `algsRaw.ts` **完全一致**（`t8c.mts`：仅差文件头注释与 `export const` 那一行）——即当前**没有数据漂移**。但：
  - 源文件在 `Downloads/` 下、**不在仓库**、也不在 `reference/`（后者 gitignore）→ CI / 其他开发者 / 未来机器都**无法复现**这次比对；
  - 生成器还会**直接改写仓库内两个源文件**，没有 dry-run / diff 模式（本审计因此没有运行它，只复刻了抽取逻辑到临时目录）。
- **影响**：两块最关键的硬编码数据（F2L 150 例 + 内置 LL 公式 88 条）没有可自动验证的来源；一旦有人手改 `f2lTable.ts`/`algsRaw.ts`，CI 完全无感（`algs.ts` 的分类校验只能保证"不污染解法"，不能保证"表没被人改过"）。
- **修复**：
  1. 把源文件（或其内容摘要）纳入 `reference/` 之外的可分发型资产（例如 `data/solver/algs-source.json`），生成器改为读仓库内路径；
  2. 生成器加 `--check` 模式：抽取后与现有文件 diff，不一致则 exit 1；
  3. 把 `--check` 加进 CI。
- **工作量**：S
- **置信度**：high

---

### F15 — i18n 孤儿键与永不渲染的硬编码中文标签

- **严重度**：low
- **分类**：i18n / 死数据
- **文件**：`src/i18n/locales/en.ts:138`、`src/i18n/locales/zh-CN.ts:136`、`src/cube/solver/solve.ts:30-56`（方法 label/blurb）、`src/cube/solver/cfop.ts:97/104/116/130` 等（阶段 label）
- **证据**：

```
en.ts:138:  "solve.methodCfopAdv": "Advanced CFOP",
zh-CN.ts:136:  "solve.methodCfopAdv": "CFOP 高级",
```

  而 `GamePage.vue:329-330` 只有两个方法按钮（`solve.methodCfop` / `solve.methodRoux`），高级解法已下沉到选项面板 → `solve.methodCfopAdv` **无任何消费方**。
  另一方向：`SolveStage.label` / `Method.label` / `Method.blurb` 在 `solve.ts:188,210` 被一路填充，但 `GamePage.vue:386` 只渲染 `s.short`（短码，如 `Cross`/`F2L 1`/`4a EO`）→ `label` 字段里的硬编码中文（如 `"底层十字"`、`"最后一组 F2L + 顶层十字 (ZBLS)"`）**永不显示**，却要随每次求解被构造与传递。
- **影响**：
  - 孤儿键：`scripts/probe-locale-keys.ts` 只查"缺键"，查不出"多键"，所以 CI 不会报；
  - 硬编码中文 label：一旦 UI 将来想显示完整阶段名，会直接漏出中文（en 界面出现中文），属于埋雷。
- **修复**：
  1. 删除 `solve.methodCfopAdv` 两个孤儿键（或在方法面板恢复该按钮时再用）；
  2. 阶段 `label` 二选一：改为 i18n key（`solve.stage.cross` 等）或直接删除字段、只保留 `short`（推荐，成本最低）。
- **工作量**：S
- **置信度**：high

---

### F16 — 非法状态下 `llCornerPerm` / `llEdgePerm` 静默错编码

- **严重度**：low
- **分类**：健壮性（无防御的负数索引）
- **文件**：`src/cube/solver/algs.ts:64-73`
- **证据**：

```ts
export function llCornerPerm(state: State): number[] {
  const perm = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) perm[(readCorner(state, LL_CORNERS[p]) / 3) | 0] = p;
  return perm;
}
export function llEdgePerm(state: State): number[] {
  const perm = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) perm[readEdge(state, LL_EDGES[p]) >> 1] = p;
  return perm;
}
```

- **分析**：`readCorner` / `readEdge` 在找不到对应块时返回 **-1**（`engine.ts:358/371`）。`(-1/3)|0 === 0`、`(-1>>1) === -1` → 前者会把 slot 0 **重复赋值**（静默产出错误置换），后者会写 `perm[-1]`（数组上的 "-1" 属性，`join(",")` 时被忽略 → 同样产出错误置换）。两者都**不报错**。
- **影响**：目前调用方都保证合法状态，因此是"防御缺失"而非现网 bug；但它会让"非法状态"退化成"错误的查表键"，在 F2 这类"键错→静默回退"的链路里很难定位。建议 `readCorner/readEdge` 返回 -1 时抛错或让 `llCornerPerm/llEdgePerm` 直接抛。
- **修复**：在 `llCornerPerm`/`llEdgePerm` 里对负数 code 抛 `Error("invalid cube state")`（或改 `readCorner/readEdge` 为抛错）。
- **工作量**：S
- **置信度**：high

---

### F17 — ZBLS / ZBL 建表阶段 `catch {}` 静默吞掉解析与归位失败

- **严重度**：low
- **分类**：错误处理
- **文件**：`src/cube/solver/zbls.ts:71-77`、`115-124`；`src/cube/solver/zbl.ts:67-74`
- **证据**：

```ts
  try {
    const norm = normalizeOrientation(state);
    if (norm) s = norm.state;
  } catch { /* 保持原状态 */ }
```

```ts
      let moves: string[];
      try { moves = parseAlg(alg); } catch { continue; }
```

- **分析**：`catch { }` 让"数据里出现无法解析的公式 / 无法归位的态"变成**静默丢弃**，只有 `genCount`（1696）与表大小（268）两个计数在 `verify-zbls-rounds.ts` C 段被断言。计数一旦漂移能被发现，但"为什么少了一条"无从追溯。
- **影响**：与 F2/F4 叠加后，建表层的一切偏差都被"计数断言 + 静默 continue"吸收。
- **修复**：把 `catch` 改成收集失败清单（`skipped: {name, reason}[]`）并随 `prepare()` 结果返回，在 `verify-zbls-rounds.ts` 中断言 `skipped.length === 0`（或显式列出白名单）。
- **工作量**：S
- **置信度**：high

---

## 四、确认干净的部分（零发现）

| 项 | 结论与证据 |
|---|---|
| 转动置换表（`engine.ts:110-152`） | 54 个转动全部满足：置换双射、`applyMove` 四次回原、`dest` 与 `perm` 互逆一致（`t1-engine.mts` problems=0）。`U2'` 别名不进 `MOVE_NAMES` 的处理正确 |
| 棱/角 code 编解码（`engine.ts:291-310`） | 24 棱码 + 24 角码全部往返一致，且 carrier 必为所在槽的面法线（`t1-engine.mts` 0 错） |
| 角-棱奇偶不变量 | 300 个随机打乱态的全角/全棱置换奇偶完全一致（`t2-coverage.mts` 0 违例）→ 引擎未引入"物理不可能"状态 |
| 中心漂移处理（`solve.ts` 的 `relabelByCenter` + `normalizeOrientation` + `transformMove` 映射） | 逻辑正确：`relabelByCenter` 只改颜色标签不改位置，故 `isUniform` 校验在 relabel 前后等价；`normalizeOrientation` 在 relabel 后为恒等（中心已 home），在 global 路径下才真正做整块归位并把步映射回原帧 |
| IDA*/PDB（`search.ts`） | `buildPDB` 用 BFS 从目标码出发、`h()` 取各子集最大值 → 可采；`allowed` 剪枝只砍同面与同轴不可交换序，标准做法；节点峰值 1903、预算 6e6/8e6 远未触及；`descend` 沿精确 PDB 下坡，cross 为 exact（`subsets.length===1 && 覆盖全部 items`） |
| OLL/PLL/CMLL 图覆盖 | OLL 图 **216 节点 = 全部合法 OLL 朝向态（3³×2³）**；PLL 图 **288 节点 = 全部奇偶一致 LL 置换态（24×24/2）** → 常规 CFOP 的 LL 段覆盖完整，无"状态未识别"风险 |
| F2L 硬编码表（150 条） | 逐条验证：键 ↔ 公式一致（150/150）、施加后目标角+棱均归位（150/150）、**不破坏其它 3 个 F2L 槽**（150/150） |
| `tidyAlg`（`engine.ts:496-516`） | 3000 条随机步序列中语义保持 **0 违例** → Roux 阶段展示的 `tidyAlg(mv)` 与实际施加的 `mv` 等价 |
| 整轮求解稳定性 | 250 组 22 步打乱 × 5 方法 **失败 0**；`verify-zbls-rounds.ts` 2603 轮 0 失败；`verify-solve-base.ts` ALL PASS；`verify-zbll-coverage.ts` ALL PASS（但其口径问题见 F4） |

---

## 五、建议的修复顺序

1. **F1**（S，独立可上）——把 `WHOLE_ROT24` 的自转改为 y 轴或直接复用 `engine.ts` 的 `ROTATIONS`；同步修 F10 的断言，让回归能锁住它。
2. **F2 + F3 + F7**（L/M/S，必须一起做）——ZBLS 坐标降维或改主动搜索 → 修正 `Y_TO_FR` 误判注释 → 恢复/新增硬断言。这是本 area 唯一"整条功能不生效"的缺陷，收益最大。
3. **F4**（S）——修正 ZBLL 覆盖口径的表述（数据完整 ≠ 运行时命中），并在 `verify-zbll-coverage.ts` 增加运行时命中率断言。
4. **F5 + F6**（M）——先修 EOLR 表键值配对并加建表自检，再决定是重建 EO 类表还是在选项文案里标注"与合并 4b+4c 等效"。
5. **F8 + F9 + F10**（S/M）——把三个求解回归脚本纳入 CI、冒烟扩到 5 方法、迭代数提到 ≥20；这是防止上述缺陷复发的护栏。
6. **F11**（M）——`prepareSolvers(method)` 按需建表 + 预热提前；如仍卡顿再上 Worker。
7. **F12–F17**（S/M，低优先）——深度上限留余量、删死分支、生成器 `--check` 入 CI、清孤儿 i18n 键与硬编码 label、加非法状态防御、建表失败清单化。
