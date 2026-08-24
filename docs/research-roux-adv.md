# Roux 高级方法家族调研结论（2026-08-24）

> 数据驱动：本文所有"命中率 / 步数节省 / 表规模"均为本机实测（探针脚本
> `scripts/probe-eolr-rootcause.ts`、`scripts/probe-lse-merge-savings.ts`，用
> `node` 直接跑，Node 24 strip-types，与 `record-solver-baseline.ts` 同款）。
> 目标：为「高级 Roux 路线」的**复选框粒度拆分**与实现顺序提供依据。

---

## 0. 目标与核心结论（TL;DR）

- **用户方向**：高级解法不常驻、以「普通方法右侧弹出复选框」形式逐步开放；解法必须
  「符合人类思考、分步演示」而非「整段算 8-10 步伪装成一步」。当前 roux-adv =
  EOLR 一步表 + 6E2C 合一，正是用户否定的「整段式」。
- **最高收益两项**：
  1. **4b+4c 合并一步（6E2C / l4e）**——实测净省 ~2.46 步（0..7，97/120 有省，
     0 例反而更长），且天然是"把 4b 伪位并入 4c 一次算完"的人类式合并视角。这几乎
     就是 roux-adv 相对 roux 那 ~2.7 步的全部来源（基线 48.26→45.57）。
  2. **EO 分类匹配（把 EOLR 从"位置级精确指纹"改成"EO 类匹配 + 4b 伪位带入"）**——
     当前 EOLR 命中率 ~0 的根因是它用**位置级指纹**查一个只含 46 条 canonical
     setup 的表；改成按 `eo4a` 那种 **EO 类分类**（Arrow / 1-1 / 2Adj / 2Opp / All-6…）
     建表才可能真正命中。
- **推荐路线一句话**：先把 `roux.merge4b4c` 拆成独立粒度并作为 Roux 默认勾选（兑现
  现有收益、修正 baseline），再把 EOLR 重建成 **EO 类匹配 + UL/UR 伪位** 的
  真正一步表作为可勾选项；NM-CMLL 与 SE 排在后面（收益小、改动深）。

---

## 1. 现状盘点（代码位置）

| 项 | 位置 | 说明 |
|---|---|---|
| roux-adv 整段式 | `src/cube/solver/roux.ts:133-191` `solve()` | block1→block2→cmll→**EOLR 一步(4a)**→**6E2C(4c含角)**；4b 不单列 |
| 普通分步 | `roux.ts:195-238` `solveBasic()` | block1→block2→cmll→**4a eo**→**4b ulur**→**4c l4e** |
| EOLR 建表 | `roux.ts:114-124` + `eolrFingerprint`（`roux.ts:61-70`） | 46 setup→只收全 EO 22 条；指纹=6棱code+U中心code |
| 表接口 | `roux.ts:86` `eolr: Map<number,{moves,name}>` | 键=位置级指纹 |
| EO 分类数据 | `data/samples/cuberoot-algs.json` `sets["eo4a"]`（11 case，**按 EO 类命名**） | 业界 4a 分类的正确抽象 |
| 复选框框架 | `src/cube/solver/methodOptions.ts` | 已声明 `roux.eolr`+`roux.merge4b4c`（`:58-59`）；`resolveSolverMethod` `:104-107` 现在**无法区分**二者 |
| 待拆 TODO | `methodOptions.ts:17-18` | 「仅合并 4b4c 不 EOLR 的独立粒度 待 research-roux-adv.md 结论后再拆」 |
| rouxSafe | `src/cube/solver/algs.ts:104` | `cornersInU && ROUX_BLOCKS 全已解`；CMLL 图用 `algGraph(cmllCode, ALG_LIBRARY.filter(rouxSafe))`（`roux.ts:96`） |

---

## 2. 方法逐项评估

### 2.1 EOLR（完整版）——当前命中率 ~0 的根因

**实测**（`probe-eolr-rootcause.ts`，N=300）：
- 建表 22 条（46 setup，仅 22 经"施加后全 EO"过滤保留；Arrow/中间态不入表）。
- 46 setup → **46 个互异指纹**。
- 真实后 CMLL LSE 状态：300 样本里 **297 个互异指纹**。
- live 指纹 ∩ setup 指纹 = **2/297**；EOLR 表命中 = **2/300 = 0.7%**。

**根因**：`eolrFingerprint`（`roux.ts:61-70`）是**位置级精确指纹**——6 条 LSE 棱在
各自**确切槽位**的 code（`readEdge` 值）+ U 中心 code（U 旋转 4 取最小）。而
`EOLR_RAW`（cuberoot `lse-eolr`）的 46 条 setup 全都是**"箭头已形成"的规范位置**
（Arrow / 1-1 / 2Adj / 2Opp / All-6…，见数据枚举）。真实打乱经过 block1/2+CMLL 后，
LSE 的 6 条棱落在**任意位置**，与这些 canonical 位置几乎永远不完全重合 → 位置级
指纹查表必 miss。**这是抽象选错了：建表按"位置"，查表也该按"位置"，但表只覆盖
46 个特殊位置，无法覆盖任意 LSE 状态。**

**业界完整 EOLR 形态**：EOLR 不是"查位置"，而是**对已 EO（或带 Arrow）的 6 棱做
EO 类分类 + UL/UR 定位同时完成**。cuberoot 的 `eo4a` 就是正确分类：11 个 EO 类
（All 6 / 2 Top 2 Bot / Bottom 2 / Top 2 Front 2 / 4 Top / 2 Top Opp / 2 Top Adj /
1 Top 1 Bot / 2 Top Adj 2 Bot / Back Arrow…），每类对应「当前 EO 状态 → 一条同时
做完 EO+定位 UL/UR 的 M/U 公式」。真正的 EOLR 表 = **按 EO 类建 2 层**：先由当前
6 棱的 EO 花式（不关心位置）分成 ~10 类，每类内再按 UL/UR 伪位的 4 个相对位置选公式。
数据规模：约 10 类 × 少量位置变体 ≈ 几十条（cuberoot 恰好就是 46 ≈ 这个量级），
但键必须是"EO 类 + UL/UR 相对位"，不是"6 棱绝对位置"。

**差距**：①键从"位置级指纹"改为"EO 类指纹"（编码 6 棱的**朝向花式**而非槽位）；
②建表过滤逻辑（`roux.ts:114-124` 只收全 EO）应改为**接收 Arrow/中间 EO 态**，并给
每条 setup 标 EO 类；③命中判定从"指纹相等"改为"EO 类相等且 UL/UR 伪位匹配"。

### 2.2 EOLRb / EO 预判（第一二块阶段）

- 本质：block1/block2 阶段就尽量让 LSE 的 EO 更有利（减少坏棱 / 直接形成好箭头），
  是"block 构建技巧"，不是新表。
- **是否适合程序化**：低。ItemSolver（`search.ts`）的 block1 用 `FACE_MOVES`、block2
  用 `RUM`，goal 只要求块归位（`roux.ts:94-95`），**没有把"LSE EO 前置条件"编进
  goal 或启发式**。要预判需在多目标里加 EO 约束（块归位 + 坏棱数最小），会大幅抬高
  IDA* 分支、且收益本身主观（人类靠预判省的是"后段少想几步"，对演示器无机械收益）。
- **结论**：不作主线；可作为 checkbox 之外的"说明性技巧"，不实现。

### 2.3 4b+4c 合并（advanced LSE / 6E2C）——**最高收益项**

**实测**（`probe-lse-merge-savings.ts`，N=120，均已 EO 后）：
- split（`ulur` 4b + `l4e` 4c）= 均值 **10.93** 步。
- merged（`l4e` 一步，UL/UR 伪位并入）= 均值 **8.47** 步。
- 净节省均值 **2.46**（min 0 / max 7）；`节省>0`：97 例；`==0`：23 例；`<0`（反而更长）：
  **0 例**。

**收益数学**：合并是"UL/UR 不必先各自归位，而是作为伪位在 4c 里顺带解决"——省的是
4b 那段单独定位 UL/UR 的冗余。这**对应人类解法**里 4b/4c 本来就是连续可合并观察的，
不是"算法算 8-10 步伪装一步"。且它**永不劣于分步**（0 例更长），是严格帕累托改进。

**对演示器价值**：6E2C 可以把 LSE 展示成「EO → 一次做完 UL/UR+四棱」，比「4a/4b/4c
三小步」更贴近高级思路，同时仍是分步（阶段清晰）而非整段——**符合用户核心诉求**。

**实现差距**：当前 `roux-adv` 已用 l4e 一步（`roux.ts:186-188`），表/代码都在；缺的是
把它从「EOLR+6E2C 耦合」里拆成**独立粒度**，并让普通 roux 也能选「仅合并 4b4c」。
代码位置：`methodOptions.ts:104-107`（resolve 不能区分）、`roux.ts:185-188`（6E2C 段）。

### 2.4 NM-CMLL（不保存 M 层）

- 本质：CMLL 阶段放宽「保持 M 层」约束——把 M 层"借"给 CMLL 公式以换取更短/更顺的
  角向公式，代价是 block2 阶段不再被强制 M-safe，块构建更自由。
- 当前差距：block2 用 `RUM`（`roux.ts:21,95`）、CMLL 用 `algGraph(cmllCode,
  ALG_LIBRARY.filter(rouxSafe))`（`roux.ts:96`），`rouxSafe`（`algs.ts:104`）要求
  `cornersInU && ROUX_BLOCKS 全已解`——即**当前是标准 CMLL（保块保 M）**。NM-CMLL 要
  改成允许 CMLL 动 M、block2 不再保 M。
- **收益评估**：节省通常小幅（CMLL±1-3 步），但**改动深**——涉及 block2 子空间、CMLL
  公式图的安全标签、以及后续 LSE 起始态的 M 漂移。对"人类式演示"反而更难讲（M 被
  借走，块恢复不直观）。
- **结论**：可作 checkbox 预留项，**排后**；先不实现。

### 2.5 其它 Roux 进阶（各一句）

- **SE / 斜进（SEF）**：FB 阶段斜着做以利用空槽，高级技巧，程序化=在 block1 搜索里加
  "非 D 层块也参与"的启发式；收益主观、改动大，**不实现**。
- **LSE 快速优化（Arrow/EO 提前）**：见 2.2，属预判技巧，不作主线。
- **M 层技巧（M/M2 转向）**：靠 `tidyAlg`/`buildAllowed`（`search.ts:39-56`）已天然
  消同面合并，无需额外工作。
- **block 预判（FB/SB lookahead）**：见 2.2，多目标启发式成本高，排后。

---

## 3. 推荐路线（含实现顺序与小步划分）

**原则**：每个 checkbox 粒度独立、可勾选可关闭；普通 roux 保持现有分步不退化；
高级不常驻（`methodOptions.ts` 已实现该哲学）。

### 第 1 步：拆分 `roux.merge4b4c`（最高收益 · 低风险 · 先做）
1. `solveBasic` 增加一档「EO → 6E2C(l4e)」输出（把 `roux.ts:224-235` 的 4b/4c 合并成
   一段 `lse-6e2c`），普通 roux 保持 4a/4b/4c 三小步不变。
2. `methodOptions.ts:104-107` 的 resolve 拆成：
   - `roux.merge4b4c` → 用「4a + 6E2C」路线；
   - `roux.eolr` → 用重建后的 EOLR 一步表（见第 2 步）；
   - 二者都关 = 普通分步（现状基线，`docs/solver-baseline.json` 锁定 48.26）。
3. 校验：`node scripts/probe-lse-merge-savings.ts`（净省 ~2.46、0 例更长）+ 重跑
   `record-solver-baseline.ts` 确认普通路径序列 (`lse-eo→lse-ulur→lse-4c`) 不回归。
4. 默认勾选 `merge4b4c`（把「默认省 2.5 步且永不更差」当作 Roux 高级的兜底收益）。

### 第 2 步：重建 EOLR 为 EO 类匹配（次高收益 · 中风险 · 数据改造）
1. 新增 `eoFingerprint`（6 棱**朝向花式**分类，对位置不敏感，U 旋转归一）——用
   `eo4a` 的 11 类为纲（`data/samples/cuberoot-algs.json` `sets["eo4a"]`）。
2. 改建表：对 `lse-eolr` 46 条，按「施加后落到哪个 EO 类 + UL/UR 伪位」键控
   （不再按 6 棱绝对位置、不再只收全 EO）。放宽 `roux.ts:121` 的 `lseEoDone(S)` 过滤
   （Arrow 中间态也应入表，表键标 EO 类）。
3. `T.eolr` 键改 `Map<eoClassFp, moves>`；命中判定改「EO 类相等」。
4. 校验：`probe-eolr-rootcause.ts` 命中率应从 0.7% 量级显著上升；若 EO 类太粗导致
   误配，缩到「EO 类 + UL/UR 相对位」两级键。

### 第 3 步（排后，可选）：NM-CMLL 作为 checkbox 预留
- 仅当第 1、2 步落地且收益已验证后再评估；涉及 block2 子空间与 CMLL 安全标签的深度
  改动，暂不入路线。

---

## 4. 不确定处 / 标注

- **EO 类匹配的实际命中收益不确定**：cuberoot `lse-eolr` 只有 46 条，即使改成 EO 类
  键，覆盖的是"EO 已完成/Arrow"的 LSE 输入；真实后 CMLL 状态有约 1/2 已 EO（其余需先
  4a）。因此 EOLR 一步表**只能服务已 EO/Arrow 子集**，非 EO 状态仍走 `T.eo` 4a 再转
  6E2C——这是**混合路线**（分步 EO + 一步 EOLR 可选），收益上限有限。量化需在第 2 步
  实测「真实状态中 EO/Arrow 占比」，作为 EOLR 是否值得独立 checkbox 的最终判据。
- **`eo4a` 的 11 类分类是否与 cuberoot `lse-eolr` setup 的 EO 花式一一对应**：未逐条
  核对，第 2 步建表时需做交叉验证（同一状态两种视角分类一致性）。
- **NM-CMLL 的具体步数收益**：未实测（需改造子空间后才能量化）；当前标注为"小幅、
  排后"，属估计。
- **演示器分步呈现**：6E2C 应显示为可展开的「EO → 六棱二中心」两步，而非单条 8-10
  步公式——具体 UI 粒度（是否可再分为 4b 视图）依赖 GamePage 求解面板现状，本调研未
  展开。

---

## 5. 附：本次实证脚本（可复跑）

- `scripts/probe-eolr-rootcause.ts` — EOLR 命中率根因（表规模/指纹多样性/命中 0.7%）。
- `scripts/probe-lse-merge-savings.ts` — 4b+4c 合并净节省分布（~2.46，0 例更长）。