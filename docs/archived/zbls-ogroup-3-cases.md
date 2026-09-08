# ZBLS O 组 3 条剔除 —— 引用修改说明

> 决议（2026-09-08 第三轮）：ZBLS 的职责是「最后一组 F2L + 控棱（LL 十字 EO）」，
> 实战中永远不会出现「四槽全解 + LL 棱已朝向」的回退态，因此 cuberoot 数据里
> O 组 I/V/D 三条**不是有效 ZBLS case**。有效 ZBLS 全集 = 302（与 mihlefeld
> Alg-Trainers ZBLS 302 计数一致，两库口径归一）。本轮把决议落到数据层。

## 删除了什么

`data/samples/cuberoot-algs.json → sets.zbls.cases`（305 → **302**）：

| id | 名称 | subgroup | setup（施加到已解态后四槽全解） |
|----|------|----------|--------------------------------|
| 6081 | I | O | `F U R U' R' F'` |
| 6082 | V | O | `F R U R' U' F'` |
| 6083 | D | O | `F R' F' R U S' R U' R' S` |

三条共同点：setup 只翻/转 LL 棱（S 切片回环后中层棱仍全部 home），**缺槽数 = 0**，
不属于「1 槽缺 + LL 任意」的 ZBLS 坐标空间。

## 额外留档

- 原样 JSON（含 `_archive` 元数据与恢复提示）：`docs/archived/zbls-ogroup-3-cases.json`（本目录）。
- 分析出处：`scripts/find-zbls-diff-3.ts`（形状分布判定）+ `docs/todo.md` 第三轮小节（决议原文）。

## 引用修改说明（逐处）

1. **`data/samples/cuberoot-algs.json`**：删除上述 3 个 case 对象（zbls 305→302）。
   其余 set 未动；JSON 合法性与条数由 `scripts/verify-zbls-rounds.ts` 断言。
2. **`scripts/gen-cuberoot-algs.mjs`**（防再生成回潮）：zbls 分支新增**形状过滤**——
   把 setup 施加到已解态，按「角+棱任一不 home」计未解槽数，≠1 即 drop。
   （验证中发现：过滤不能只按棱判——库内另有 32 条「棱 home 角乱」型是
   有效 ZBLS（槽确未解），只按棱会误杀；仅 O 组 3 条在两种口径下都是 0 槽。）
3. **`src/cube/solver/zbls.ts`**：仅更新文件头与建表注释中的计数表述（305→302、
   「D 类」措辞改指向归档文档）。**运行逻辑零改动**——这 3 条此前就被
   `normalize < 0` 跳过，从不进查找表（基线见下）。
4. **`scripts/find-zbls-diff-3.ts`**：脚本保留（是「差的 3 条」的判定依据，有档案价值），
   更新注释说明数据层已按决议剔到 302；现跑输出 `FR:302, ALL-SOLVED:0`，
   反而成为剔除动作的回归检查。
5. **`docs/todo.md`**：记录本轮动作与验证结论。
6. **未改动**（确认过不需要动）：`src/data/algDb.ts`、`scripts/verify-zbll-coverage.ts`、
   `scripts/verify-data.ts`、CI workflow——它们或跳过 zbls set，或不断言 zbls 条数。

## 是否会造成问题（简单检查结论：不会）

- **求解器行为不变（实证）**：删除前后 `prepare()` 表统计均为
  `tableSize=268, genCount=1696`——这 3 条从不进表，删前删后查找表逐条一致。
- **用户公式库不受影响**：zbls case 无 `alg` 字段，`algDb.ts` 的
  `if (!c.alg) continue` 使其从不进 `BUILTIN_LIBRARY`/localStorage，
  不存在旧 `cr-6081` 残留记录问题（这三条从未生成过公式 id）。
- **镜像链安全**：三条的 `mirrorCaseId` 全部自指（6081→6081 等），
  全文件无任何其它 case 引用它们作镜像，删除不产生悬空指针。
- **验证脚本兼容**：覆盖验证只看 zbll(472)/pll(21)，与 zbls 无关；
  typecheck/build 全绿。

## 新验证方式（本轮建立）

`scripts/verify-zbls-rounds.ts` —— 从「静态计数」升级为「样本轮验证」：

- **A 域合法性轮**（302 轮）：每条 zbls case 施加 setup → 必须是合法 ZBLS 态
  （恰好 1 槽缺、非四槽全解）；全槽已解 → 直接 FAIL（防回潮哨兵）。
- **B 求解命中轮**（302×4 AUF = 1208 轮）：setup 态叠随机 U 前置 →
  `solveZbls` 必须命中，且施加解后**实测** F2L 全解 + LL 棱朝向。
- **C 表基线回归**：`prepare()` 统计必须等于 `tableSize=268, genCount=1696`。
- **D ZBLL 命中轮**（493 条 × AUF 扰动）：库完整性 493/493 + 每条 setup 域合法 +
  施加 `alg`（含 AUF 收尾）后实测整魔方已解。
