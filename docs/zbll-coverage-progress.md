# ZBLL / ZBLS 全覆盖 + 公式库清查 —— 进度留痕

> 记录时间：2026-08-20（本次更新：宏观核算重启 + ZBLS 引入 + 全量目标清单；已清除过时/偏差描述，仅留已验证事实）
> 状态：**S1-S5 已实施完成（解析器/不消步/ZBLS 接入/GamePage/核算+变体+一步查表）；S6 回归+bump+提交**
> 分支：`feat/solver`（不 amend；637c39d 为用户补遗 commit 勿动；已推 9c4ceb3、d58ad5c；版本 0.3.4）

---

## 〇、总目标清单（2026-08-20 全量）

1. **库完整性（已确认，见 3.4）**：所有合法 ZBLL 公式都已记录；
   被丢的 case 全部为「解析器 bug 误丢」或「宽转/整转的合法 non-pureLL」，**没有真正非法的公式**。
2. **宏观核算（已重启）**：抛开旧口径，从 ZBLS → ZBLL 重新核算覆盖（见 3.6）。
3. **引入 ZBLS**（305 case 已缓存）：实现「最后一组 F2L + 棱定向」两步链：
   CFOP 高级 = Cross → F2L×3 → **ZBLS**（一组 F2L + EO 同时完成）→ **一步 ZBLL**。
4. **显示策略**：
   - **ZBLS 展示时排除 F2L**：显示公式时把 F2L 部分排除，因为库里有不标准的 preset 混入。
   - **U2 vs U2' 按原始方向展示**：结果相同但手感/手法差别很大；展示时**不得擅自消步**
     （如 R' R2 不能显示成 R；不盲目消步是全面清查目标之一）。
   - **解析器跟上**：`parseAlg`/`parseAlgFull` 需保留原始 move 方向（含 L3/L4/L4' 记法、
     U2'、R' R2 等），生成/展示/库数据三处口径一致。
5. **Roux 批次**：EOLR（本地 lse-eolr 46 cases）+ 4b 伪 UL/UR 并入 6E2C；解法每栏标公式名。
6. **GamePage 接入 "cfop-adv"** 按钮 + solve panel 显示阶段 algs。
7. 后续：6 色底双模式、打乱 3 倍速、降群 + ZZ 入待办、全量回归 → 版本 bump → 提交推送。

---

## 一、核心目标（ZBLL 一步解）

- 实现 CFOP 高级（ZBLL）批次：Cross → F2L → 棱定向预置(EO) → 一步 ZBLL，替代 OLL→PLL。
- 落地用户修正逻辑 `calculate_zbll_coverage`：

  > 用群论生成器在 EO solved 约束下生成 7776 个物理状态；识别函数把每个物理状态映射到
  > 462 个基础算法之一（**考虑 AUF / Mirror / Inverse**）；**coverage == 1.0** 才算
  > 462 个算法完美覆盖 7776 个物理状态。

- 理论依据：`7776 / 4(AUF) / 2(Mirror) / 2(Inverse) = 486 ≈ 493`（标准 ZBLL case 数）
  ≈ 462（内置库）。**若库是「每个 16-state 轨道的代表元」集合，则 coverage 应趋近 1.0。**

---

## 二、已完成（已落地/已验证）

1. **zbl.ts**（`src/cube/solver/zbl.ts`）
   - `eoCode` 健全化：`permIndex(llEdgePerm) * 16 + base2(llEdgeFlips)`，192 状态、200/200 通过。
   - `ZBL_GENS` 过滤 pureLL 算法（剔除 4 条 non-pureLL：ZBLL **L 61/64/66/68**，记为 `droppedZBL=4`）；
     类型改为 `LibEntry[]`（补 `invName / pureLL / rouxSafe / orientationNeutral` 字段）。
   - typecheck 全绿。

2. **cfop.ts**（`src/cube/solver/cfop.ts`）：新增 `solveAdvanced`
   （cross → f2l1-4 → zbl-eo + zbl）；导出 `CFOP = { prepare, solve, solveAdvanced, SLOTS, solveSlot }`。

3. **solve.ts**（`src/cube/solver/solve.ts`）：新增方法 key `"cfop-adv"`
   （label "CFOP 高级（ZBLL）"，blurb "十字 → F2L → 棱定向预置 → 一步 ZBLL"）；
   `prepare = cfopPrepare + zblPrepare`。

4. **scripts/smoke-solver.ts**：加入 "cfop-adv"；3 方法全 OK
   （注意：zbl 阶段现为 15–22 步的多步链，尚未真正一步化）。

5. **覆盖率分析基础设施**：
   - 462 纯公式仅 AUF 覆盖 **1848/7776（= 462×4，每 case 恰 1 个 AUF 轨道）**。
   - BFS 生成 7776 状态用 `{s, scr}` 栈（曾误用 `{st}` 导致崩溃）；用 LL-only gens
     （462 纯公式 + U/U'/U2）生成，勿用 M/U/R/L 整群 BFS（曾 OOM）。

---

## 三、核心发现（关键结论，勿重走弯路）

### 3.1 几何镜像会破坏 F2L（已确认，镜像路线整体废弃）
- 整立方体沿 x=0 平面反射（R↔L）会把 F2L 块 DRF↔DFL 互换，**破坏 F2L-solved**（probe-zbl65）。
- **LL-only 镜像（只反射顶层 y=1 贴片）也无效**：probe-zbl107 实锤——对 LL 空间 7776 个状态做
  llMirror，**产物 0/7776 落在 LL 空间内**（反射是反定向/手性操作，产物不是合法可解的 LL 态）。
- 早前 LL-mirror 并集 6248/6448（probe-zbl69/70）**口径无效**：那些被计入的 covered 状态本就
  不在 LL 空间（probe-zbl61/62：covered 6248 vs 库内 LL 空间 3124）。
- **结论：状态级镜像（整块或 LL-only）全部不可用，勿再走这条路线。**

### 3.2 字符串镜像算法与状态镜像的关系（已确认无效，保留背景）
- 字符串镜像 `mirrorAlg`（R↔L', U↔U', F↔F', M↔M', r↔l' 等）对 alg 逐 move 反射。
- 状态级 llMirror 本就不是合法 LL 态（见 3.1），因此 `mirrorAlg(A)` 应用到 `llMirror(canonical(A))`
  不还原（probe-zbl72/77：50 例全不通过，差 6 贴片）——**该对照本身无意义，勿再纠缠**。
- 算法级 mirror 的剩余价值只在「镜像 case 用镜像算法直接解」这一语义（见 3.7），
  与状态反射解耦。

### 3.4 库内数据事实（probe-zbl73/80/81/82/83，98/99/109 复核）
- cuberoot 原始缓存 `.cache/cuberoot/zbll.json` 共 **472 条**（= 标准 ZBLL 非 PLL 全集），
  含全部 6 条被 crawl 丢的 case 与 4 条 non-pureLL（probe-zbl99）。
- 经 `gen-cuberoot-algs.mjs` 落库的 `data/samples/cuberoot-algs.json` 只有 **466 条** zbll：
  - **6 条被 crawl 丢**（U 10/21、Pi 28/37、AS 25/72）：**全部合法**，因**解析器 bug 误丢**——
    原始公式含 `L3/L3'/L4/L4'` 记法（L3 = L' 即 270°、L3' = L、L4 = 恒等），
    脚本正则只认 `(2|'|’)` 后缀，把 `L3'` 等静默解析错 → invariant 失败被丢（probe-zbl86/87）。
  - **4 条 non-pureLL**（L 61/64/66/68）：**合法**，用宽转 l/r/f + 中块 E + 整转 x/z/y，
    纯算法检验 `setup+alg` 非严格还原，但 gen 脚本 invariant（含 `normalizeOrientation`）
    通过（probe-zbl92/96/97）；因非 pureLL 被 zbl.ts 过滤（droppedZBL=4）。
- **结论：所有合法 ZBLL 公式都已记录（缓存 472 = 标准全集）**；JSON 缺的 6 条是解析器 bug，
  L3/L4 记法修复后全部通过 invariant，可找回。**不存在真正非法的公式。**
- 每条 case 的 `setup` 态与 `invertAlg(alg)` 态 **AUF 等价**（can==setup 全对）；
  `alg` 解自己的 `setup` **466/466 全对**（probe-zbl78）。
- 466 条 setup 对应 **466 个互不重复的 AUF 轨道**（无重复 case）→ 库确实是「每 case 1 AUF 轨道」。
- 所以库 ≠ 每 case 覆盖 16 状态的完整代表集：**466 条只覆盖 1944 个 AUF 轨道中的 466 个（24%）**。
- inverse 轨道几乎全被库内已有的反向 case 覆盖（probe-zbl74：inverse 483 与 base 484 几乎重叠）。

### 3.5 与标准 ZBLL 数量的对照（probe-zbl109 修正，2026-08-20）
- 标准 ZBLL = 472 非 PLL + 21 PLL = **493 case**；cuberoot 缓存 472 正好 = 标准非 PLL 全集。
- probe-zbl109（修正早前 zbl95 的 PLL 过滤 bug）：472 缓存 setup → **472 个互不重复 AUF 轨道**；
  +21 条 PLL（ALG_LIBRARY 的 22 条 pureLL 非 AUF 项，其中 21 条新轨道）→ **合计 493/1944 轨道**。
- **即使补全 472+PLL=493，仅 AUF 也远不能覆盖 1944 轨道**（493×4 = 1972 状态 ≠ 7776）：
  说明**标准计数依赖 mirror/inverse 识别，不能只按 AUF 算**。
- 早前 zbl88 的「494」与 zbl95 的「473」均系统计口径/过滤 bug，以 **493（probe-zbl109）** 为准。

### 3.6 ZBLS → ZBLL 宏观核算（probe-zbl101/102/104/105/110/111，已缓存 zbls.json）
- cuberoot API `.../3x3/zbls`：**305 条 case**（subgroup 28 组；`sticker.kind="f2l"`；
  `mirrorCaseId` 指向镜像配对；sample：EO/Line/VP/VM/IF/IL/IZ/D…）。
- 每条 case 的 setup 态 = **F2L 恰缺 1 组（302/305）+ LL 任意**（probe-zbl104）——符合 ZBLS 定义。
- 用候选 algs 求解后：**276/305 回到已解**（F2L solved + LL 棱全定向）；295/305 LL 棱全定向
  （probe-zbl110）；简单 case（EO/Line/VP/I）setup+alg 直接还原，另有 **29 条需选 alts 或主 alg
  不直接还原**（如 D 类，probe-zbl111）——不能只用每组第一条 alg。
- **宏观模型**：CFOP 高级链 = Cross → F2L×3 → **ZBLS（1 组 F2L + EO）** → **一步 ZBLL**。
  ZBLS 结束后棱全定向，LL 剩 7776 态恰好是 ZBLL 的输入空间 → ZBLL 覆盖问题与 ZBLS 解耦，
  可分别核算。

### 3.7 Mirror 判定 + 显示/解析策略
- **状态级镜像（整块 + LL-only）全部废弃**：整块破坏 F2L（3.1），LL-only 产物不在 LL 空间
  （probe-zbl107：0/7776）。状态反射与算法镜像的关系对照无效（3.2）。
- **算法级 mirror 是唯一剩余候选**：probe-zbl94 全 472 case 用 {a, inv, mir, mir-inv} 4 变体 + AUF，
  约定 A/B/C 分别 777/782/901 轨道（C：仅 R↔L 不翻转方向最接近，仍 ~46%）。
  尚未确认这是否等于标准 ZBLL 文献的「Mirror」语义。
- **显示策略（用户新要求，硬约束）**：
  1. **ZBLS 显示排除 F2L**：展示公式时去掉 F2L 部分（库内有非标准 preset 混入）。
  2. **U2 vs U2' 按原始方向展示**：结果相同但手感不同；**禁止展示时盲目消步**（R' R2 不得合成 R；
     全面清查目标之一就是避免盲目消步）。
  3. **解析器跟上**：需实现/保留 `parseAlgFull`（识别 `[2345]'` 后缀），
     `parseAlg` 不能把 U2' 规范化成 U2（会丢手感信息）；`MOVES` 已含 f/l/r/E/x/y/z。

### 3.8 覆盖率实测汇总（全部 LL-only BFS，7776 状态 / 1944 AUF 轨道）
| 方案 | 状态/轨道覆盖 | 说明 |
|---|---|---|
| 仅 AUF（462 case） | 1848（462 轨道） | = 462×4，每 case 1 个 AUF 轨道 |
| 472 缓存 setup（AUF-only） | 1888（472 轨道） | probe-zbl95 |
| +21 条 PLL（AUF-only） | 1972（493 轨道） | probe-zbl109（修正） |
| LL-mirror 并集（484） | 6448 | **口径无效**：covered 含非 LL 态（3.1） |
| **alg 级 {a,inv,mir,mir-inv}（466）** | **3772（943/1944 轨道）** | probe-zbl71/74/75 |
| alg 级（472 全库，mirror 约定 A/B/C） | 777/782/901 轨道 | probe-zbl94 |
| 状态级 LL-only 镜像 | 0/7776 在 LL 空间 | probe-zbl107，**已废弃** |

**结论：任何口径都未到 7776/7776。目前最严谨口径（alg 级，472 全库 + 最佳 mirror 约定 C）
只有 ~46%（~901/1944 轨道）。root cause = 库非完整 16-state 轨道代表集 + mirror 语义未定。**

---

## 四、尚未搞清的根因（下一步排查方向）

1. **库是否本质不完整？——已确认**
   - 缓存 472 = 标准非 PLL 全集，且「每 case = 1 AUF 轨道」已实锤（472+PLL=493 轨道，
     probe-zbl109）。所以 coverage 靠「AUF + mirror + inverse 识别到基础算法」的口径
     必然到不了 1.0，除非 mirror/inverse 变体真正能补足（当前 alg 级最好 ~46%）。
   - **待用户裁决：标准 ZBLL 的 493 条是否每 case 覆盖 1 个 16-state 轨道（含 mirror/inverse）？
     若是，cuberoot 472 条缓存只是「1 case = 1 AUF 轨道」的平铺，需自行生成 mirror/inverse 变体
     来凑 1944 轨道；若否，则标准计数与识别口径需要重新对齐。**

2. **「Mirror」的精确定义未定（状态级已排除）**
   - 状态级镜像（整块 + LL-only）已全部排除（probe-zbl107：0/7776 在 LL 空间）。
   - 算法级 mirror（约定 C）只到 ~46%（probe-zbl94：A/B/C = 777/782/901 轨道）。
   - 需要用户确认：cuberoot/标准 ZBLL 语义中「Mirror」是否指**算法字符串镜像**
     （R↔L 不翻转方向，约定 C）？当前按 C 是 901 轨道。

3. **识别口径**
   - 目前「识别」实现为：对每个物理状态 S，检查 ∃ 基础算法 A、∃ 变换 t∈{id, inv, mirror}、
     ∃ AUF u：`t(A)` 在 u 后解 S。这是 probe-zbl71 的口径。
   - 另一种意图是「S 的镜像/逆状态本身由某基础算法直接解」（状态级，probe-zbl69/70，
     **已被 3.1/3.7 排除**）。
   - **仍需用户裁决最终 coverage 定义口径。**

4. **ZBLS 接入（新）**
   - 305 条已缓存；需决定 ZBLS 在 solve 链中的阶段化与显示（显示排除 F2L）。
   - 求解需遍历候选 algs（276/305 用第一条即回已解，29 条需选 alts）——解析/匹配不能只用第一条。

---

## 五、探针清单（scripts 下已删除，可随时重写）

- probe-zbl28：M/U/R/L 整群 BFS 曾 OOM（勿用）。
- probe-zbl51：`{st}` 栈 bug 致 BFS 失败；zbl52：`{s, scr}` 栈正常，7776 状态。
- probe-zbl61/62：covered 6248 vs 库内 LL 空间 3124 → 部分 covered 不在 LL 空间（佐证 3.1 口径无效）。
- probe-zbl65：整块镜像 F2L-solved=false（几何镜像破坏 F2L）。
- probe-zbl71：**alg 级** AUF×{a,inv,mir纯,mir-inv纯} = 3772/7776（1842 个变体 alg）。
- probe-zbl73：zbll 466 条 subgroup 分布（40 组）。
- probe-zbl74：变体轨道去重 = 943/1944（base 484 / inverse 483 / mirror 437 / mir-inv 436）。
- probe-zbl78：466/466 alg 解自己的 setup 通过。
- probe-zbl80/81：setup 态与 inverse-alg 态 AUF 等价；466 条 = 466 个互不重复轨道。
- probe-zbl84：4 条 non-pureLL（L 61/64/66/68）确认为宽转/整转算法；U2' 出现 177/466。
- probe-zbl85/86/87：6 条被丢 case（U 10/21、Pi 28/37、AS 25/72）用 L3/L4 感知解析器全部通过
  invariant → **全为合法，parser bug 误丢**（L3=L'、L4=恒等）。
- probe-zbl92/96/97：L61/64/66/68 的 setup+alg 不严格还原（含整转/宽转），但 invariant
  （normalizeOrientation）通过 → 合法 non-pureLL。
- probe-zbl94：**alg 级** {a,inv,mir,mir-inv} 全 472 case，mirror 约定 A/B/C = 777/782/901 轨道
  （C：R↔L 不翻转方向最佳，仍 ~46%）。
- probe-zbl99：6 条被丢 + 4 条 non-pureLL 全部在缓存中（库完整性确认）。
- probe-zbl101/102/104/105/110/111：ZBLS 305 条缓存；302/305 setup 恰缺 1 组 F2L；候选 algs 求解
  **276/305 回已解**、LL 棱全定向 295/305、29 条需选 alts（ZBLS 结构验证）。
- probe-zbl107：**LL-only 镜像 0/7776 落在 LL 空间**（状态镜像废弃的实锤）。
- probe-zbl108/109：PLL = ALG_LIBRARY 22 条 pureLL 非 AUF 项（21 条新 AUF 轨道）；
  472+PLL = **493/1944 轨道**（修正 zbl88「494」、zbl95「473」）。

---

## 六、关键代码/文件

- `src/cube/solver/zbl.ts`：eoCode 已健全、ZBL_GENS 已过滤；待扩展为一步全覆盖（或查表）。
- `src/cube/solver/cfop.ts`：solveAdvanced 已加；`src/cube/solver/solve.ts`：cfop-adv 已加。
- `src/cube/solver/algs.ts`：algGraph/analyzeAlg/LibEntry/ALG_LIBRARY、permIndex/llCornerPerm/
  llCornerTwists/llEdgeFlips/llEdgePerm。
- `src/cube/solver/engine.ts`：MOVES（含 f/l/r/E/x/y/z，无 L3/L4 记法——需 parseAlgFull 扩展）/
  MOVE_NAMES/transformMove/parseAlg/invertAlg/CUBIES（`{i,pos,stickers,type}`，用 `cb.pos` 非 `cb.p`）/
  STICKER_POS/STICKER_NORMAL/stickerIndex。
- `data/samples/cuberoot-algs.json`：zbll 466 条（缺 6 条 L3/L4 误丢，可找回）；lse-eolr 46 / eo4a 11。
- `.cache/cuberoot/zbll.json`：472 条原始缓存（完整）；**`.cache/cuberoot/zbls.json`：305 条 ZBLS（新）**。
- `scripts/gen-cuberoot-algs.mjs`：zbll SET + invariant；**正则需支持 `[2345]'` 后缀**（当前只认 2/'/’）。
- `scripts/smoke-solver.ts`：已含 cfop-adv 回归。
- `src/vue/pages/GamePage.vue`：方法按钮、solve panel（algs 未显示）、打乱/输入/日志 UI 改造点。
- `src/i18n/locales/{zh-CN,en}.ts`、`docs/todo.md`、`scripts/playtest-solver.mjs`、`scripts/playtest-ui.mjs`。
- `package.json`、`src-tauri/tauri.conf.json`：版本 0.3.3。

---

## 七、工程注意事项（AGENTS.md 摘录）

- 端口：5173 是用户日常预览；本项目 dev/playtest 一律 5174 或其它非 5173 端口。
- tauri：`npm run tauri dev/build`（走 5174），产物 src-tauri/target/release。
- 版本号：package.json 与 src-tauri/tauri.conf.json 的 version 必须同步（当前 0.3.3）。
- Windows：优先 pwsh；中文输出前设 UTF-8；沙箱受限进程无法启动 WindowsApps 别名程序时用完整路径。
- 提交：不 amend、不擅自 push；仅在用户明确要求时提交。

---

## 八、后续批次（待办，未开始）

1. **一步 ZBLL 全覆盖**（当前卡点）：
   - 裁决 coverage 口径与「Mirror」定义（状态级已排除，只剩算法级 mirror 约定）。
   - 修复 `gen-cuberoot-algs.mjs` 正则支持 `[2345]'` 后缀，找回 6 条被丢 case（472+PLL=493）。
   - 补全后重测 alg 级覆盖率；若仍 ~46%，则需生成 mirror/inverse 变体（每基础 case → 4 变体）
     或与用户对齐「每 case 1 AUF 轨道」的识别语义。
   - 达成 1.0 后：扩展 ZBL_GENS，zbl 阶段改直接查表或加 U gens，保证每 EO 态 1 步 ZBLL；
     重跑 200/200 探针 + smoke-solver。
2. **ZBLS 接入（新，用户已要求）**：
   - 解析 `.cache/cuberoot/zbls.json`（305 条）落库；阶段化「ZBLS（F2L+EO）」；
   - **显示时排除 F2L 部分**；**U2 vs U2' 按原始方向展示、不消步（R' R2 保留）**；
   - solve 链：Cross → F2L×3 → ZBLS → 一步 ZBLL。
3. GamePage 接入 "cfop-adv" 按钮（solveMethod 类型 `"cfop" | "roux"` 需加 "cfop-adv"；
   btn-method-cfop-adv；solve panel 显示阶段 algs：`.solve-stage/.stage-short/.stage-moves/.stage-count`）。
4. Roux 批次：EOLR（本地 lse-eolr 46 cases）+ 4b 伪 UL/UR 并入 6E2C；解法每栏标公式名。
5. 6 色底双模式综合评估 + 开关 + 设置页可用底配置。
6. 打乱 3 倍速播放；输入公式可播放；日志选择/复制。
7. 降群 + ZZ 入待办。
8. 全量回归（typecheck + smoke-solver + playtest-solver + playtest-ui）→ 版本 bump → 提交推送。

---

## 九、给下次会话的速查

- 别在未裁决口径前继续堆探针：先问用户「Mirror 指算法级（约定 C）还是另有定义」「coverage 用
  算法级口径还是允许生成变体」「ZBLS 是否立即接入 solve 链」。
- **库完整性已确认**：缓存 472 = 标准全集；JSON 466 = 缺 6（L3/L4 解析 bug，可找回）+ zbl.ts
  过滤 4 条 non-pureLL（合法，宽转/整转）。不存在真正非法的公式。
- **关键数字（2026-08-20 复核）**：LL 空间 7776 = 1944 AUF 轨道；472 缓存 setup = 472 轨道；
  +21 条 PLL = **493/1944**（probe-zbl109）。算法级 mirror 最佳 ~46%（约定 C，901/1944）。
- **镜像路线结论**：状态级镜像（整块/LL-only）全部废弃（LL-only 产物 0/7776 在 LL 空间，
  probe-zbl107）；只剩算法级 mirror 一种候选语义。
- **显示硬约束**：ZBLS 显示排除 F2L；U2' / R' R2 等按原始方向展示，不盲目消步；解析器需支持
  `[2345]'` 后缀记法。
- 若用户同意「补全 493 + 算法级 mirror（约定 C）仍不达标」→ 需生成 4 变体库或换识别口径。
- 所有探针脚本模式统一：`Set-Content scripts/probe-*.mts` → `npx tsx` → `Remove-Item`；
  BFS 用 `{s, scr}` 栈；AUF 归一化用 `AUFROT`（U 三次取字典序最小）。

---

## 十、S1-S5 实施完成（2026-08-20 晚，本轮）

> 用户裁决：① Mirror 语义先查文献（子代理调研定论）；② coverage 先算法级核算，~46% 不达标再生成
> 4 变体库；③ ZBLS 完整接入 solve 链 + 显示排除 F2L；④ 全部阶段禁用 tidyAlg；⑤ Roux 本轮不做。
> 本轮尾声用户再裁决：**允许回退、覆盖率到可接受程度即可、抛弃复杂核算**。

### S1 解析器 `[2345]'` 记法（engine.ts + gen 脚本）
- `parseAlg` 正则扩为 `([UDLRFBMESudlrfbxyzXYZ]w?|Uw|Dw|Rw|Lw|Fw|Bw)([2345])?('|’)?`：X3→X'、X3'→X、
  X4/X4'→恒等丢弃、X5→X、**X2' 保留为 "X2'"**（不规范化成 X2）；`parseAlgFull` 保留原始记法；
  `expandRepeats` 展开 `(A)N`（含 ZBLS 的 `(L' U2 L U')2`）；MOVES 加 `base+"2'"` 别名条目。
- gen 脚本同步；**zbll 466→472**（找回 U 10/21、Pi 28/37、AS 25/72，L3/L4 误丢全部找回）。

### S2 不消步
- `cfop.ts` 全阶段移除 `tidyAlg`（cross/f2l/oll/pll/zbl）；展示 = 执行序列（U2'、R' R2 原样）。

### S3 ZBLS 305 条落库 + 接入 solve 链
- gen 脚本加 `sets.zbls`（305 case × **4 组槽位候选** × 1886 候选；`mirrorCaseId` 305/305）。
- 关键发现：ZBLS 候选记法含 `[U2]` AUF 标注、`(A)2` 重复、`=y'` 等价变体、`M'R'` 连写宽转——
  全部是解析问题非数据非法（`normalizeZblsAlg` = expandRepeats + 剥标注 + 压空格）。
- `src/cube/solver/zbls.ts`：**setup 态建表**（候选语义是「setup 态 → F2L solved + LL EO」非「→ solved」，
  故不能用候选逆态作键）+ 槽位 y 归一到 FR（Y_TO_FR={FR:0,FL:3,BL:2,BR:1}）+ AUF U 归一 +
  LL 完整坐标（角 perm×twist×棱 perm×flip）；求解 = 归一码查表 + 4 AUF × 候选遍历 + 实时验证
  （nonLLSolved && LL EO，归位吸收公式整转残差）。**setup 态 270/270 匹配、verifyFail=0**；
  真实打乱命中率受数据覆盖限制（254 常用 case 集 vs 状态空间）→ 回退兜底。
- solve 链：Cross → F2L×3 → **ZBLS**（第 4 组 F2L + EO 一步）→ solveLL；ZBLS 未覆盖回退 f2l4。
  **显示排除 F2L**：F2L 阶段只有 3 组，第 4 组在 zbls 阶段内。

### S4 GamePage
- `solveMethod` 加 `"cfop-adv"`；`btn-method-cfop-adv` 按钮；i18n `solve.methodCfopAdv`
  （zh: "CFOP 高级" / en: "Advanced CFOP"）；solve panel 显示阶段 algs（`.stage-algs`）。

### S5 coverage 核算 + 变体 + 一步查表（按用户裁决简化）
- **Mirror 定义（文献定论，M2 约定）**：R↔L'、L↔R'、F↔F'、B↔B'、U↔U'、D↔D'
  （R/L 互换且方向翻转，其余保持面但方向翻转；r↔l'、M↔M'）。实证：`.research_zbll/`。
- **算法级核算**（`scripts/coverage-zbll.mts`）：base-only 472/1944 = **24.3%**；
  4 变体闭包（base/mirror/inverse/mir-inv）**1020/1944 = 52.5%**。
- **变体落库**：gen 脚本 zbll case 加 `variants` 字段（M2 镜像/逆/mir-inv，pureLL 校验过滤）。
- **一步 ZBLL 查表**（zbl.ts）：`Map<zblCode, 公式>`（O(gens) 毫秒级；替代全空间 BFS——
  原 472 公式 BFS 7776 空间 39s、1400 公式后 110s，查表后 **prepare 526ms**）。
  solveLL 只接受单公式；未覆盖由 cfop.ts 回退 OLL+PLL（`ollCode(s0) !== 0` 才做 OLL——
  避免 EO 预置后漏翻角）。真实打乱一步命中 **~43%**（理论 52.5%）。
- **已放弃**：补满 1944（cuberoot+Roman 数据上限 ~926-1020 轨道，两家库均不完整）、Roman 合并、
  多口径对比——用户裁决允许回退、覆盖率可接受即可。

### 回归与版本
- typecheck 全绿；smoke-solver 3 方法 × 打乱全 OK（prepare 0.5s）；版本 **0.3.4**。

### 后续待办（未做）
- Roux 批次（EOLR + 4b 伪 UL/UR）、6 色底双模式、打乱 3 倍速、降群 + ZZ、
  ZBLS 覆盖提升（需更全 ZBLS 数据）、1944 一步 ZBLL（需完整公式集数据源）。