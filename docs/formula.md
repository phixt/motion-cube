# 公式示例

## 数据来源与参考（cuberoot.me）

- 站点可达（2026-08-06 实测）：复盘页 <https://cuberoot.me/zh/recon> 与公式库
  <https://cuberoot.me/zh/alg/3x3> 均可访问；两者均为客户端渲染，直接 HTTP 抓取不可用，
  但有公开 JSON API：`https://api.cuberoot.me/v1/...`。
- 复盘 API：`/v1/recon/list`（列表）、`/v1/recon/{id}`（详情，含分步解法）。
- 公式集 API：`/v1/alg/sets/3x3/{set}`，set 含 f2l / adv-f2l / oll / pll / zbls / zbll /
  coll / wv / cmll / sbls / eo4a / anti-pll / sv / ell / fruf / cls / vls / ollcp / 1lll；
  原始数据源为 speedcubedb，每个 case 带 setup（复现态打乱）与多条候选公式。
- 精选复盘样本见 `data/samples/cuberoot-recons.json`（3 CFOP + 2 Roux + 1 ZB，含分步解法），
  刷新命令：`node scripts/fetch-cuberoot.mjs`。
- 公式库示例 `data/samples/library.json` 中标注"速拧参考"的公式来自该公式库。

---

1. 41STM/ 3.24=12.65TPS

B R2 B' F U2 F2 D' R B' D2 B R2 F U F' D B2 (17h*)
x' // insp
x'↓B'·R' U F R U' R UD' // W xcross (GR)
R' F R F' // BR
L U L' // GO
y' U R U' R' // BO
U2'↓F (R U R' U')2 F' // OLL-V+ (0.567)
U' x· R2' D2 R U R' D2 R U' R x' // PLL-A (0.584)

2. 46STM/ 3.41=13.49TPS

B2 R2 F D R U2 L2 R' D2 L D L2 D' B2 L' D2 U'
x' z' // insp
D U r' R' U' R2 D L' D // W xcross (OG)
R U' R' U R U' R' // RG
L U y' U R U R' U' R' F' R // RB+OB
U' r' U2' R U R' U // OLL-O- cancel into
F' r F L' U' L U L F' L2' U L U' // PLL-L

3. 41STM/ 7.08=5.79TPS

L2 R2 U2 L2 B' D2 F' L2 D2 B' D2 R U' R' B2 U' L U2 F2 U
x2 // Inspection
D' L D2 L' D2 // W xcross (BO)
U2 R' U R // F2L 2 (GR)
U' R U' R' L U' L' // F2L 3 (GO)
U y L' U' L // F2L 4 (BR)
F R U R' U' F' // OLL
U R U R' U' R' F R2 U' R' U' R U R' U2 // PLL T

4. 49STM/ 5.01=9.78TPS

y2 B F2 D2 U2 R' U' B L' U2 F U' B' F' D U' R' D2 U' (19h*)
y // insp
D↓F·D D // Lf
R U' B2 // LB+DR
R' U' R U2' R' U' R // RB
·R U' R' U R U' R' // RF
(U U')↓F R2 D R' U R D' R2' U' F' // CMLL-U
U' M U' M' U' M U' M' // EOLR-1/1
U M2' U // 4b
M' U2' M2' U2' M' // EP
