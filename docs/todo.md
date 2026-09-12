# 项目 TODO 与进度（motion-cube）

> 更新：2026-09-11　✅ 已完成 ｜ 🚧 进行中 ｜ ⬜ 待办
> 唯一进度/待办文档（合并自 progress.md、rubik-anime-lab-migration.md；旧文档
> base/start/formula/docs_old/migration-vue-winui-plan 已归档删除；params.md 保留）。

## 当前状态

- 版本 **0.4.0**（package.json 与 src-tauri/tauri.conf.json 同步；2026-09-12
  feat/hand-lowpoly 合并入 main 时带入，合并本身未 bump）
- 基座整备（2026-09-06）：手部拇指重校、新应用图标、EBUSY 修复已并入 main；
  盲拧彳亍法与求解器进阶研究封存分支，详见下节「基座整备」
- 求解器：CFOP / CFOP+（一步 ZBLL + 回退）/ Roux（LSE 4a+6E2C）三方法全绿
  （typecheck + smoke-solver + smoke-solver-edge + verify-data）
- 解法底选择：CFOP/Roux 方法面板「解法底」区——**多选面集合**（默认选中全局底颜色；
  可加选/取消其它色，最少保留一个；「重置为全局底」回归）。选单色底 → 求解先整块旋转
  （baseFaceSetupAlg 把该色转到 D 面位）+ 中心色 relabel（贴纸颜色标签按面位 home 色
  重映射，位置不变——不破坏求解器「中心归 home」前提），对集合内每底分别求解取最短；
  SolveResult 带 setupAlg（演示前先播放整块旋转）+ base 记录视角
- 一步 ZBLL 覆盖 52.5%（M2 变体闭包，1944 轨道，prepare 0.5s）；未覆盖回退 OLL+PLL
- ZBLS 305 条落库接入 solve 链（F2L×3→ZBLS→一步 ZBLL，显示排除 F2L）
- 技术栈：Vite 8 + Vue 3.5 + cubing.js（TwistyPlayer + cubing/alg）+ three.js（手模型）

## 活跃待办

### 基座整备（2026-09-06，分支合并 + 不确定功能回退）

- ✅ **并入基座（main）**：① EBUSY 根因修复（vite watch ignore `reference/`）+
  dispose 残留探针（39b858a→cab5627）；② 手部拇指 CMC 三轴重校 + 手部几何固定值
  合理化（327cbbd→dc096a8，0.3.8，用户确认效果满意）；③ 新应用图标替换 gomoku
  占位 + `tools/icon-lab` 生成工具入库（78a2548）。
- 🗄 **封存分支（不并入，随时 cherry-pick 找回）**：
  - `feat/hand-thumb-normalize` = 盲拧彳亍法档案：数据层建库（6b716d7）+ 说明页
    3D 展示（e1b4ace）+ todo 记录（806dfd1）——公式表接入未完成，待接完再评估合入。
  - `research/solver-advanced` = 求解器进阶研究档案：EOLR 一步表命中 ~0 实证 →
    维持 4a 搜索+6E2C；降群/ZZ 方向参考；彳亍公式 xls 整串重叠率 v2011 8.1% /
    一九四三 4.7%——结论参考价值有限，仅此少量保留，探针与完整记录在分支。
- ⬜ **回退意向·暂缓（用户判定效果不佳，按「main 内容先不回退」暂缓执行）**：
  ① zbll（cfop-adv 一步 ZBLL：覆盖 52.5%、命中均步 ≈ CFOP 无实际收益）；② 桥式
  高级（roux-adv，EOLR 路线研究半途而废）。回退方式 = 方法面板移除 cfop-adv /
  roux-adv 选项（底层公式库保留休眠），基座确认后执行。
- ✅ **手部遗留（已随合并解决）**：硬编码微调数字 `PALM_Y_OFFSET = -0.02` 属旧
  handGeometry.ts 冻结基线，该文件已随 50c2547 合并清理删除，遗留消灭。

### 手部模型 low-poly 重构（2026-09-11 立项 🚧，分支 feat/hand-lowpoly）

- **目标**：low-poly 风格但形体精度高于现行模型（指节剖面/掌弓/指蹼/关节隆起/
  拇指隆起形态）；内部几何实现大刀阔斧不保留，只守兼容面：
  ① `HandRigView` 公开 API（EditorPage 唯一消费方：constructor/init/setPose/
  setHandType/setVisible/currentPose/type）；② `Pose`/`Contact` 数据契约不动形状
  （technique.ts 严格校验落盘，手法库已存数据不破坏）；③ handRigStore 键
  `motion-cube.handRig` 与版本迁移 v3→v4；④ `CUBE_UNIT_WORLD=0.33`、sideSign、
  拇指 CMC 三轴欧拉分解（42/20/45 重校成果）；⑤ 标定页参数可调（参数集重定义，
  旧值尽量映射）。
- **路线**：阶段0 兼容面冻结 + 基线截图（shot-editor-hand 前后对照）→ 阶段1
  剖面数据层（v4 配置 + v3 迁移）→ 阶段2 新几何生成器（截面放样 + 平顶刻面
  着色）→ 阶段3 接口置换（HandRigView/HandCalibView/标定页面板）→ 阶段4
  A/B 对照校准 + 全量验证 + 真机 + bump 0.4.0。旧 handGeometry 暂留分支做
  A/B 对照，合并前清理。
- **心态**：相当程度破坏、可能回档——分支独立演进，main 不动，废弃即整支丢弃。
- **进度（2026-09-11 本轮，阶段 0-4 全部落地）**：① v4 数据层（shape 造型 10 参数
  + v1–v4 迁移，verify-data 补迁移/越界断言）；② `handMesh.ts` 截面放样生成器
  （超椭圆剖面指段 + 关节球兜底弯折 + 掌梯形放样（横弓/纵凹/梯形）+ 大鱼际刻面
  椭球 + 指蹼；逐面顶点色伪受光，双渲染器口径一致）+ `verify-hand-mesh` 自检
  （镜像/绕向/极值/顶点色）；③ 换芯集成——HandRigView/HandCalibView 切新生成器
  （公开 API 与接触锚点兼容，腹背接触偏移改按剖面厚度）+ 标定页「造型」面板
  （10 参数）+ `#/hand-lab` 新旧 A/B 对照调试页 + i18n zh/en。验证：typecheck /
  build / verify-data / verify-hand-mesh / playtest-ui 全绿；截图
  `spike-shots/hand-lab-1/-2-rotated.png` + `hand-calib-lowpoly.png`——A/B 对照
  指节隆起/段腰收窄/掌横弓/刻面明暗全面优于旧基线；默认 tipTaper 0.6→0.66
  （俯视指尖过尖微调）。版本 bump **0.4.0**。
- ✅ **真机验收第一轮（2026-09-11 晚反馈，已落地）**：① 拇指 CMC 默认展收/抬离
  **归零**（42/20→0/0——low-poly 几何已自带自然位，仅保留对掌 45°，HandRig.ts）；
  ② 拇指根 x 0.55→**0.92** + 大鱼际 x 0.48→**0.60** 外移——拇指与四指平行时间隙
  ≥ 指间隙（0.36 vs 0.35）；③ 指蹼由「菱形凸起」改为 **U 形谷棱柱**（XY 下半圆弧
  采样逼近 U——谷底低两侧高、端头没入关节球、z 向延伸 mcpZ+0.2H，
  handMesh.ts `webGussetGeometry`）。截图 hand-lab-1/-2-rotated + hand-calib-lowpoly
  复验通过。注：用户已固化 localStorage 仍持旧值，标定页重置或手动对齐新默认。
- ⬜ **碰撞箱**：手-魔方简化相交判断（段级 AABB/胶囊代理），供接触可行性校验 /
  自动姿态 / 穿透检测使用（用户 2026-09-11 提出）。
- ⚠ **渲染管线兼容注意**：R1 渲染替换处于半替换状态（游戏页已回退 cubing、
  RenderCubeHost/RenderDemo 在库休眠）——手部经 `CubePlayer.onThreeScene` 挂载
  自愈，渲染线推进（尤其 EditorPage 自建宿主）时必须回归验证手部挂载/显隐/接触点。
- ✅ **真机验收第二轮（2026-09-12 反馈，已落地）**：大鱼际椭球重构为**肌腹式纵脊**
  （`buildThenarRidge`：从掌根延伸至近掌指缘、外突更鼓——width=外突量/height=竖向
  鼓起/length=前伸比例，肌腹中段最鼓两端收束；thenar.x/z 字段退役不再消费，标定页
  移除对应输入）；拇指根改**锚在纵脊前段**（thumbCorner 默认 0.92/-0.08/0.12）——
  大拇指从大鱼际上与四指**平行伸出**（CMC 0/0/45），不再从掌中斜向伸出。
  注：已固化存档需标定页重置对齐（旧 thumbCorner.z=-0.45 会把拇指拉回掌中）。
- ✅ **真机验收第五轮（2026-09-12 反馈，已落地）**：① **双渲染器颜色不一致根因修复**
  ——顶点色统一线性编码（用户截图实证编辑器手部整体发白：cubing 渲染器实际存在
  线性→sRGB 输出转换，旧「线性管线直写 sRGB」口径已失效——渲染管线半替换的兼容
  影响兑现，linearOutput 双路径删除）；② 编辑器默认姿态拇指「奇怪下撇」——拇指
  默认弯度 160/160/165→**175/170/170**（基关节 20° 弯+45° 扭转呈钩状下坠，与
  「从大鱼际平行伸出」冲突；既有手法关键帧数据不受影响，新姿态取新默认）；
  ③ 新增 `scripts/shot-editor-barehand.mjs`（视口显隐隐藏魔方后的裸手检查脚本）。
- ✅ **真机验收第六轮（2026-09-12 反馈，已落地）**：① **手部颜色反向回退**——线性
  编码在编辑器过暗如枯木（上轮方向判断错误），恢复 cubing 路径顶点色直写 sRGB=
  淡米偏白（用户选定口径），linearOutput 双路径并存；② 拇指默认弯度 175/170/170→
  **170/165/168**（保留一定自然弯）；③ 示例库新增 **「复杂运动演示（示例）」** 手法
  （绑 ZBLL 示例 7 步公式，11 关键帧：接近→握持→腕部摆动+逐指拨动→释放，
  gen-samples.ts 生成管线，公式库「加载示例」合入）；④ 裸手检查脚本支持
  SPIKE_TEC 选指定手法。
- 🚧 **外部注入 API**（A 期已实现，9ca48b0 随合并入 main）：`window.motionCubeHand`
  （DEV 限定：setPose/playFrames/stop/clear/setHandType/setVisible/getState，姿态全过
  parsePose 深度校验），实现方按 docs/hand-api-spec.md 硬约束交付、规格已标记已实现；
  ⬜ 真机验证（DevTools 控制台驱动手部姿态/播放）；B 期（WebSocket 帧流、生产
  opt-in）暂缓。
- ✅ **真机验收第七轮（2026-09-12 反馈，已落地）**：① **拇指轴扶正**——诊断结论：
  轴本身与四指严格平行（刚体变换不变量，编辑器默认姿态在 #/hand-lab 新增「编辑器
  默认姿态」视图实证），「下撇不平行」观感主因 = 45° 对掌扭转把弯屈方向偏出指平面
  → 默认扭转 45→**15°**（对掌需求留给姿态数据/标定滑块）；② **拇指根 Z 固化 -0.33**
  （用户实测 0.12 太靠前）；③ **大鱼际前缘适配后退拇指根**：脊前端 cap 在拇指根后
  0.18，不再向掌指缘悬出「搁板」；④ **拇指独有怪指尖取消**：IP 末梢关节不再放关节
  球（此前拇指尖是球头、四指是收口圆头，现统一）；⑤ hand-lab 双姿态切换
  （测量直姿/编辑器默认姿态）。
- ⬜ **手部细化·下一轮清单**：指蹼双面（背/掌两侧都有，现仅单面）+ 横断面边界弧度
  （现太直）；手掌部分整体化；指节剖面（指面微凸、指背更平滑小凸）；关节略收紧；
  指甲面细化；指节圆滑与略微扩大。
- ✅ **手部细化·九轮（2026-09-12，已落地 10f990d）**：① **指蹼重做**——U 谷棱柱
  （单面有、断面平直）→ 指根间**圆角药丸条**（背/掌两侧观感一致、全曲面，顶面自然
  成 U 谷）；② **大鱼际截面 × 拇指根截面对齐**——脊末端环直接采用拇指根段截面尺寸
  与圆心，经漏斗渐变（0.72→1 双站插值）汇入，接缝无台阶；③ 掌体截面 3.1→2.85 更圆
  （部分整体化）+ 脊嵌入加深（a×0.35→0.45）；④ 指节剖面反转——指面微凸
  （n=2+0.35×padFlat）、指背更平（n=2.3+0.5×padFlat），滑块语义改「指背扁平」；
  ⑤ 关节球更圆更大（bulge 1.18→1.22、球面 8×4 段）但差距收窄（递减 0.92/0.85→
  0.94/0.88）；⑥ 节端微收腰（0.9→0.86、根环 0.95/后延 0.88）；⑦ **指甲**——末节
  背侧浅色圆角片（NAIL 0xf0dcbd，随指尖收口微俯 0.14rad）。
- ✅ **手部细化·十轮（2026-09-12，近圆锥重构）**：① 指节生成逻辑重写——**近圆锥**：
  段内连续收分、**末环半径=下一段宽**（跨段半径连续、无分界线），根环全宽+关节环
  **指面独立微凹成折痕**（ringPoints 升级腹/背独立半径，背侧不凹）；② 指根不凸出
  掌面——根球系数 j0 1.0→0.9（PIP/DIP 0.96/0.92 保持柔和丰满）+ 掌前缘厚度保持
  （渐薄 0.1→0.04）；③ 指蹼药丸收缩 1/3+ 并后撤下沉（长 0.3→0.18、y 下沉 0.03、
  后撤至 mcpZ+0.04）。修复过程：新环调用漏 bBack 参数致 NaN（TS 抓出），已补齐。
- ✅ **手部细化·十一轮（2026-09-12，已落地）**：① **指蹼定版内凹**——药丸外凸废除，
  回归 U 谷棱柱（谷线顶低于指根球顶=只凹不凸）并后撤缩窄（z 至 mcpZ+0.14、弧收 0.5）；
  ② **关节凸起平滑**——球系数贴锥面（j0 0.98/j1 1.0/j2 0.96，默认 bulge 1.22→1.1）；
  ③ **脊-掌接缝平滑**——嵌入 a×0.45→0.55 + 漏斗站 6→8（整体性增强，抹平慎用口径：
  仅动接缝不动形体）。
- ✅ **合并完成（2026-09-12）**：feat/hand-lowpoly → main **ff 至 50c2547**（19 提交；
  不 push、不打 tag；版本 0.4.0 双端同步不动）。清单 1-5 全项落地：① handGeometry.ts
  删除 + hand-lab 改单视图调试页（50c2547）；② CI verify 补 verify-hand-mesh；③ 全量
  验证绿（typecheck / build / verify-data / verify-hand-mesh / playtest 5174 十七截图）；
  ④ 合并入 main；⑤ 分支处置：feat/hand-lowpoly 保留至真机定版；feat/hand-thumb-normalize
  内容已在 main（dc096a8 同内容）；feat/zbll-import-verify、research/solver-advanced 按
  用户裁定封存不并入。**并发说明**：合并准备期间实现方 AI 落地外部注入 API A 期
  （9ca48b0 实现 + 53c68db 文档标记），经规格硬约束核查（未碰 handMesh / HandRig 类型 /
  HandRigView 签名 / playtest 断言，technique.ts 仅 parsePose 加 export）随分支带入；
  该 API 未经真机轮，DEV 构建限定、零生产面，后续真机验证归 API 线。
- ✅ **手部细化·十二轮（2026-09-12，已落地）**：① **指蹼双凹透镜棱柱**——背侧 U 谷
  + 掌侧 ∩ 上凹（指面侧也有内凹面，解决单面问题），圆弧逼近全曲面；② **自发光口径**——
  伪受光对比 0.78+0.22→0.9+0.1、刻面抖动 0.05→0.03（面观感弱化、整体平亮偏白）；
  ③ **指尖收钝**——tipTaper 0.66→0.74、前伸 0.18→0.12len。
- ✅ **手部细化·十三轮（2026-09-12，合并后首轮，main 直做）**：① **四指整体加粗**——
  新 shape 参数 `fingerWidth`（默认 1.15，clamp 0.9–1.45），`createRigFromConfig`
  骨架层乘段宽（接触锚点/关节球/指甲全派生量自动跟随）；**拇指不乘**——其根截面
  与大鱼际脊末环配平，乘子会破坏对齐；旧 v4 档加载时 clamp 列表自动补默认。
  ② **掌面↔手指平滑相接**——指根 MCP 球掌侧**静态领圈**（buildKnuckleCollar）：
  凹圆角站环从掌前缘宽足印收细沉入球体（末环 < 球面截线半径防共面闪烁）；
  挂掌侧不随指弯——球心即弯转轴、球面旋转不变，弯曲时依旧贴合；足印 1.25×半宽、
  外侧掌壁 +0.03H 裕量钳制、相邻领圈允许交叠（鞍谷=掌指隆脊间解剖凹谷）。
  ③ 标定页造型面板新增「手指加粗」滑条 + i18n zh/en；verify-data 补旧档补默认/
  越界截断/乘子仅四指断言（默认一致性断言同步乘子语义）；verify-hand-mesh 极值
  改走 createRigFromConfig 同路径 + 领圈计数断言 + 极粗指极值。全验证绿
  （typecheck/build/verify×2/多角度连拍目检无裂缝无闪烁）。
- ✅ **手部细化·十四轮（2026-09-12，main 直做）**：① **四指根同时下压**——
  `ROOT_EMBED=0.3`（×段半宽沿 −z 压入掌面）：露出掌面的截面即指根清晰超椭圆
  （与掌面**截面对齐**），MCP 球前凸 1.08→0.72 半宽（**凸起减半**）；0.3 为弯曲
  封闭下限（压入后球在面处截线半径须仍 ≈ 指壁，更深则弯折开裂）；拇指不压
  （大鱼际脊截面配平不动）。② **关节凸起再弱化**——系数组 0.98/1.0/0.96→
  **0.93/0.95/0.92**（默认 bulge 1.1 下球径 1.02/1.05/1.01 半宽，仍 ≥ 段宽保弯折
  兜底）；系数在代码侧，用户旧存档（bulge 1.1）**立即生效无需重置**。③ **领圈
  改造为根窝倒角**——球缩小+下压后从「抱球」变「根窝」：面缘足印（近椭圆 1.22
  半宽）逐站收细，**末环与指根截面同式同值**（同超椭圆指数/指面折痕比例 0.86，
  ×0.985 沉入指内）——领圈与指壁字面截面对齐无缝。全验证绿（typecheck/build/
  verify×2/八角度连拍目检：掌面四指干净截面露出、球状凸起消失、根窝倒角平滑）。
- ✅ **手部细化·十五轮（2026-09-12，main 直做）**：掌心侧衔接流畅化。① **指根间
  填充棱**——相邻根窝之间的细化三棱柱（`buildKnuckleFiller`：(y,z) 平面圆角三角
  superellipse n=1.5 顶点朝 +z，`ringYZ` 新采样器，沿指行 7 站放样），脊线两窝间
  浅凹＝**关节的凹陷**，端环没入相邻根窝锥面与关节球——掌面侧城垛状 V 缺口填平；
  ② **指根掌侧肌凸**——每指窝下方（掌缘方向）浅盘状隆起（`buildPalmarPad`：扁椭球
  罩面，类大鱼际但露出仅 ~0.016H、弧度小），相邻肌凸间留浅谷；③ **根窝邻指钳制**——
  足印 ≤0.46×窝距，止住十四轮前的互相叠压，谷位由填充棱衔接。绕向教训：ringYZ
  首版法线朝内（verify-hand-mesh winding 断言抓出），自 +x 端看逆时针应为 +z→+y 向。
  全验证绿（typecheck/build/verify×2/连拍目检：窝间连续、肌凸浅盘可见、无破面）。
- ✅ **手部细化·十六轮（2026-09-12，main 直做）**：① **掌前缘端面后收斜坡**——
  用户实证「近梯形不在末端下压就没和手指贴上」：端面原为横跨全掌高的直立壁，四指
  只占上半段，下半段悬空。`frontFaceZ(y)`：指线（0.05H）以上保持 mcpZ，以下线性
  后收 0.12H 成斜坡（buildPalm 前环逐点应用），直立壁消除、指根掌侧与掌面贴合；
  webs z0 / 填充棱底面 / 肌凸共用同一函数落坡。② **肌凸放大贴坡**——0.028H→
  **0.05H**、加宽 1.15×半宽、位置 cy−0.11H，随坡面法线倾斜（rotateX atan 坡度）
  贴坡不悬空（用户反馈「看不出来肌凸」）。③ **标定页右手交互视图**——
  `HandOrbitView`（新文件）：透视相机 + OrbitControls，**静态**（坡面法线机位）
  / **动态**（拖拽旋转 + 滚轮缩放，阻尼）切换，测量直姿与俯视/左视同配置源，
  dispose 完整；i18n zh/en 4 键。全验证绿（typecheck/build/verify×2/playtest
  十七截图/交互视图拖拽缩放实测）。
- ✅ **双手显示（0.4.0 十七轮，2026-09-12，下一轮开工项）**：编辑器左右手同屏。
  `HandRigView` 加可选镜像链接 `setMirror`——主手 `setPose` 自动以 `mirrorPose`
  （HandRig.ts 新纯函数：位置 x 取反 + 四元数 M·R·M 镜像 + CMC 展收/对掌取反 +
  bends 照搬）驱动对侧实例，**外部注入 API 驱动主手时镜像手同样跟随**；EditorPage
  第二实例（手型恒取选择器对侧，onHandTypeChange 联动）+ 视口显隐组「双手显示/
  恢复单手」开关（默认开，与隐藏手独立）；`defaultHandPose` 手位 x=±0.9 分立两侧
  （原注释「坐标待手调」落地——x=0 时镜像手与主手完全重叠）。verify-data 补
  mirrorPose 断言（含双次镜像还原）。镜像手随既定休朝向手指自然交叠为正确镜像
  语义，真实手法播放时双手随姿态分离。
- ✅ **双手独立编辑 + 手位修正（0.4.0 十八轮，2026-09-12，用户反馈驱动）**：
  ① **默认手位重定**——双手分立魔方左右两侧、掌心贴左右面、拇指朝上（右手贴右面：
  掌心 −x / 拇指 +y / 四指向后 −z，掌心位 ±1.86，q=(w0, √½, √½, 0)），替代旧
  「z=∓2.2 掌心朝视线」基准（用户实证旧位错误）；
  ② **双手独立编辑（数据层破坏性变更，旧档平滑兼容）**——`TechniqueKeyframe.mirror?:
  Pose` 对侧手轨道：缺省=镜像跟随主手（旧档语义不变），存在=独立轨道（可与其他帧
  跟随态混插值）；parseKeyframe 校验 mirror；编辑器关键帧面板「编辑手 主手/对侧手」
  切换（patch 按编辑手路由，对侧手首次编辑自动物化 mirrorPose(kf.pose) 为可编辑副本，
  「清除对侧数据」恢复跟随）；渲染层 renderPreview 双轨驱动（主手恒走 pose 轨）；
  ③ **显隐/快捷键跟上**——新编辑器动作 `toggle-both-hands`（默认 B 键，设置页可改；
  旧键位档缺新动作按动作回退默认不再整体作废）；H 手显隐 / B 双手显隐均同步两实例；
  ④ **handApi 双实例驱动**——`registerHandApi(view, mirror?)`：setPose/playFrames/
  clear/setHandType/setVisible 全部同步镜像手（setHandType 取对侧）；HandRigView 撤销
  十七轮的 setMirror 隐藏耦合（显式双轨取代）。verify-data 补 mirror 轨道序列化往返。
  实测：双手贴面分离截图 ✓ / B 键单双手切换 ✓ / H 双手齐隐 ✓ / 对侧手编辑物化 ✓。
- ✅ **双手定版细化（0.4.0 十九轮，2026-09-12，用户反馈驱动）**：① **表述改左右手**
  ——手型选择器退役（双手常显后无单手型语义），编辑手按钮改「左手 / 右手」（左手
  为主，默认编辑左手）；实例更名 handLeft/handRight（固定 "left"/"right" 类型）；
  ② **双手默认不关联**——关键帧显式 `left/right` 双轨（`mirror` 字段退役，旧档
  { pose, mirror? } 解析时迁移：pose→右手、mirror→左手、缺省镜像），autoKf/添加
  关键帧双轨同时物化（对侧以当前插值姿态落轨保连续）——编辑一手不再带动另一手；
  镜像需经面板「镜像到对侧」按钮手动一次性拷贝；③ **单手左手为主**——B 键单手
  模式只显左手（右手为辅隐藏）；④ **handScale 默认 1.85**（用户预期值；旧存档需
  标定页重置）+ 默认手位 ±1.95 贴面（掌面 ≈±1.53 恰触面）；⑤ handApi 语义同步——
  setPose/playFrames 对称驱动双手，setHandType 改单手显示切换（getState.handType
  记录最近值）；playtest 断言更新（handLeft/handRight + 类型校验）。gen-samples
  双轨化重生成示例库。全验证绿（typecheck/build/verify×2/playtest 十七截图/
  双手贴面分离与右手编辑实测）。
- ✅ **主位手规则定版（十九轮用户纠偏，11fedb6）**——认知纠正：主位是随模式走的
  角色，非固定左手。**双手状态 = 右手主位**（公式右撇子基准，默认编辑右手）；
  **单手状态 = 默认左手且左手即主位**（右撇子单手拼惯用左手），面板可换右手
  （换后右手即主位）。实现：editingHand → focusHand（默认 right）；B 切换时按
  模式重置主位（双手→right / 单手→left）；applyHandVisibility 统一显隐（单手
  只显主位手）；toggle/setFocus 后 renderPreview 刷新面板数值与双手喂轨。实测：
  双手默认右手高亮 ✓ / 单手默认左手 ✓ / 面板换右手即主位 ✓ / 回双手右手主位 ✓。
- ⬜ 待办：用户**真机定版**十二轮~十六轮手部观感（main 已含；feat/hand-lowpoly
  分支保留至定版）。

### 路线图重排（2026-09-11 用户裁定）

- **编辑器批**：搜索优化 → 自定义开始状态 UI → 拍扩展延后；左右手同时显示最后
  （依赖渲染线后做）。
- **渲染线**：① 速度滑条统一 + 高可中断队列重构＝**重点**；② R1 接驳余项
  （有点难，缓）；③ R8/R10/R3 交互演示增强（可考虑）；R2 视觉层可并行后置。
- **公式/盲拧线整体后移**，远期优先级：**桥式高级 > cfop 高级（zbll）> 盲拧**；
  方向改**自建推导**——盲拧以 8+18 基础公式推导拓展至全 818 条（xls 参考资料仅
  做参照不做数据源）；zbll 问题在命中率口径非库完整性（493/493）；桥式高级
  推导相对容易。`feat/zbll-import-verify` 数据侦查成果封存待重启（Y_TO_FR 修法
  与覆盖率轮一并，见分支 todo 第四轮收尾记录）。
- 桌面版发布三件套、求解器进阶集：再议。

### 盲拧参考换新 + ZBLL/ZBLS 数据侦查（2026-09-08，本轮轻量，未深入）

- ✅ **任务1 · 盲拧参考换新**：删除旧彳亍法参考（`reference/` 下 `一九四三...xls`、
  `chichu v2011.xls`、`chichu.html`、`This.exe` 及分析副本 `_work/`）；从
  `E:\phx_lumin\Downloads\3-Style (V5)等1个文件.zip` 解压**中文版** xlsx 入库
  `reference/3-style-v5/三盲三循环818-魔方根.xlsx`（818 条三循环，13 表：
  介绍/编码/分类/双拼/棱/角/笔记/奇置换/翻棱/转角/统计/棱组/角组，buffer UF/UFR，
  作者 CubeRoot）。英文版同源（11 表、无双拼）未入库；notes-new-refs.md 已重写。
  ⬜ 深度解析 + 重新形式化接入公式库——**下一轮**。
- ✅ **任务2 · Alg-Trainers 可达性侦查（未爬全量，仅定可行性）**：网站
  mihlefeld.github.io/Alg-Trainers 为 GitHub Pages（仓库 mihlefeld/Alg-Trainers，
  公开、GPL-3.0）；**原始数据即仓库内 JSON**，无需爬网页：
  - `3x3-ZBLL-Trainer/algs_info.json` = **472 条**（T/U/L/Pi/Sune/Antisune 各 72 +
    H 40；每条含 name/group/algset + `a[]` 多算法 + `s` 打乱）——**与现有库一致**
    （472 + 21 PLL = 493 口径成立，ZBLL 简单核对即通过）。
  - `3x3-ZBLS-Trainer/algs_info.json` = **302 条**（FR1–45 分组，`1-1`..`45-2` 命名）
    ——**少于现有库 305 条**（`data/samples/cuberoot-algs.json` zbls=305），差 3 待核。
  - 已落盘 `reference/mihlefeld-alg-trainers/`（6 个 JSON：ZBLL/ZBLS 各
    algs_info/algsets_info/groups_info）——下轮直接消费。
- ⬜ **下一轮**：① 3-Style V5 深度解析 + 公式库重新形式化；② 决定 ZBLL/ZBLS 数据源
  （现有 cuberoot 305 vs mihlefeld 302）并**重启 ZBLL 覆盖率验证**——开分支
  `feat/zbll-import-verify`（原始数据已备，从 `scripts/coverage-zbll.mts` /
  `scripts/verify-zbll-coverage.ts` 现行口径（926/1944 轨）继续）。

### 游戏页：速度体系统一 + 多色底（✅ 已完成，0.3.7 已 bump）

- ✅ **速度体系统一 + 打乱倍速上限 5x**：两滑条统一为「实际 s/步」显示、同一基准
  （1000ms/步 @1.00s/步，cubing tempoScale=1 语义）+ 滑条范围 0.20–3.00 s/步
  （下限 0.20s/步 = 原 5x 等效）；`speed`/`scrambleSpeed` 改存秒/步：
  打乱 `delay = max(60, scrambleSpeed*1000)`、播放 `delay = max(60, speed*1000)`，
  `setSpeed(1/秒)`（tempoScale 换算），播完恢复演示速度——「同倍率不同速」遗留消灭。

- ✅ **单色底真正生效**：`solve(state, method?, baseFace)` 三层语义——`setupAlg =
  baseFaceSetupAlg(base)`（非 D 底整块旋转把该色转到 D 面位）+ 中心色 relabel
  （`relabelByCenter`：贴纸颜色标签按其所在面位 home 色重映射，位置不变）+
  归一化求解。**实证推翻旧探针**：engine MOVES 支持整块旋转步（x/x2/y/z/z'…），
  色映射路线下「setupAlg 旋转后 + moves」对任意底还原（旧探针整块旋转后未重标注
  中心色，方法有误）。演示先播放 setupAlg 整块旋转再播 moves（视觉旋转到对应底）。

- ✅ **多色底多选**：`SolveBaseChoice = Face[]`（localStorage `motion-cube.solveBase`）；
  面板去「跟随原始底」chip；默认选中全局底色；点选 toggle 加入/移除（**最少保留
  一个**，取消唯一被拒）；「重置为全局底」。求解对集合内每底分别执行取最短
  （多选综合优化暂缓）。

- ✅ **验证工具更新**：verify-solve-base.ts 新语义重写（A1 默认==global 深等、A2 六色
  底旋转还原实证、A3 D==默认、A4 红底实态任意显式底还原、A4b roux 抽查、A5 moves
  合法性）——**26/26 PASS**；shot-solve-base.mjs 多选 chip 交互断言（默认原始底选中/
  加选/取消/取消唯一被拒/重置回归）——**15/15 PASS**（截图 solve-base-1/2/3.png）。

- ✅ **解法底小修（0.3.7 之后本轮，不进版本）——「底对面/底不生效」根因实证修复**：
  ① `baseFaceSetupAlg` 表 **F→x'、B→x 方向互换**（实证旧表把所选底**对色**转到 D 面位，
  正是「解法底变成全局底对面」现象坐标层根因；U/R/L/D 方向原已正确）；
  ② `solve` 显式底 setupAlg **动态化**：按「base 色中心当前实际面位」构造整块旋转
  （非标准全局底视角（全局底≠D）下 base 色不在其 home 面位，旧固定语法转成对面）；
  ③ `SolveResult.endAlg` 改为**动态收尾**：把真实还原终点 T 整块旋转回「所选底朝向
  solved」（24 个整块旋转候选按中心排列匹配；标准全局底视角下 T 已=所选底朝向 solved
  ⇒ endAlg=""；非标准视角自动补）——「演示全程所选底视角、解完停在所选底」落地。
  实证：`verify-solve-base.ts` 提升至 **34/34**（新增 A6/A6b 收尾视角断言）；typecheck 绿。
  注：verify 固定打乱含整块/中层步会搅动中心，A6 采用「T 六面单色且 D 面位中心=所选底」
  语义断言（「标准 solved 经 setup」的静态 target 非可比对象，早版本据此误报 FAIL）。
   - ✅ **2026-08-22 多选 UI 语义第二轮排查修复（用户实测「多选非对面两底仍得对面底 /
     cfop 下一次打乱用另一底但没旋转、所选底成侧面」）**：
     ① `WHOLE_ROT24` 构造**去前导空格**（f=D 时 setup="" 拼接产出 `" z"`→调用方 split(" ")
     得到空串步，`MOVES[""]` 崩溃）；② `solve.ts` target 改用 **base 色 home 位固定旋转
     `baseFaceSetupAlg(baseFace)`** 而非动态 setupAlg——动态 setup 基于「state 视角下面 base
     色当前所在面位」（非标准全局底视角下≠home 位），构造出的 target 是「当前视角朝向」而非
     「base 色在 D」，endAlg 于是把终点转去别的底视角 = 用户观察的「对面色/别的色在底面」；
     标准全局底视野（base 色恰在 home 位）下动态==固定，早期 verify 全过掩盖了差异。
     实证：新增 `scripts/probe-solve-base-ui.ts` **情景矩阵测试序列 22/22**（S1-S9 单轮 + S10
     两轮连续；S3/S4 非对面两底、S6/S7/S8 全局底≠D 含 p=3、S9 六色底关、S10 用户「下一次
     打乱」；各×cfop/roux；断言终态六面单色且 D 位色∈所选）。修复后 S8（全局 L + [U,L,R]）
     从「endAlg=× 崩溃」→「end=x2 z2 终态 D=U」；S10 轮2 best=R 终态 D=R∈所选。verify-solve-base
     仍 34/34、typecheck 绿。
   - ⚠ **速度滑条待统一（用户确认临时，不急）**：播放中改速度→动画按新速度走但会「停顿补满
     原始时长」；打乱过程改速度无效（scrambleCube 的 delay/setSpeed 在循环外固定）。归「渲染
     替换重建高可中断队列」时一并重构（已入 todo 技术债方向，本轮不动）。

### 求解器 / 公式库
- ⬜ **EOLR 一步表命中率 ~0**：lse-eolr 46 case 建表仅收全 EO 22 条；精确指纹匹配
  命中率 ~0，需改 EO 分类匹配（见「Roux LSE 改造」进度）
- ✅ **cfop-adv 双路线取短（本轮已落地）**：第 4 组 F2L vs ZBLS、LL 普通（OLL+PLL）
  vs 高级（EO 预置+一步 ZBLL）各取较短路——实测 24 样本 `高级>普通 0/24`
  （==23、<1 例 -9），均值 61.21 ≤ CFOP 61.58，恒保证高级不劣于普通
- ⬜ **cfop-adv 剩余**（要「高级真实更短」，非必须）：一步 ZBLL 覆盖 ~52%（命中均步
  ≈ CFOP、未覆盖靠双路线已不劣）；补全 ZBLL 库 / EO 预置并入首步（深工程，暂缓）
- ✅ **桥式普通入口恢复（本轮已落地）**：`roux` = 普通桥式（1-look CMLL + LSE
  4a/4b/4c 分步，新增 lse4c 表）；`roux-adv` = 现有效果（EOLR 一步 + 6E2C）完整保留
- ✅ **rouxBasic 数值复测（2026-08-21 完成）**：probe-solver-methods.ts rouxBasic 列，
  Windows tsx 跑 40 样本（seed 0x9e3779b9 可复现）——普通 Roux 均值 47.33 vs 高级
  （EOLR）45.08，恒 高级≤普通（无变劣）；CFOP 高级>普通 0/40（==37、<3 例 Δ-9/-4/-4）
  → 双路线取短承诺再次兑现
- ⬜ **CFOP 进阶集**：快速十字（预判）+ 高级 F2L（双向/多槽 multislot）
- ⬜ **Roux 进阶集**：LSE 4b+4c 合并一步、EOLR 之上更优解法
- ⬜ **高级方法**：降群（Thistlethwaite/Kociemba）、ZZ（EO-Line → 桥 → 顶层）；
  ZBLL 需改前置公式与棱定向预置配合；Roux EOLR 爬取 cuberoot + 4b 伪 UL/UR 带入
  6E2C（L10P/4E2C 子状态）
- ⬜ 新集合爬取：复用 `scripts/gen-cuberoot-algs.mjs` 管线，加进 SETS 即自动清洗/校验

### 动画编辑器
- ⬜ **搜索优化**：模糊搜索（子串/编辑距离/拼音）、标签过滤、分类过滤
- ⬜ **左右手同时显示**：数据层大改（Pose 手型维度/双实例 + HandRigView 双实例 +
  标定/示例适配），最后做
- ⬜ **自定义开始状态 UI**：正放/倒放均可自定义起始态（公式页适配）；缺省回退
  正放=公式逆序状态、倒放=还原态（已实现）
- ⬜ **拍扩展**：接触轨道按拍编辑；关键帧箭头拖动吸附拍网格；拍网格吸附开关

### 桌面版（tauri）
- ⬜ **双标题栏**：decorations:false + 自绘标题栏（data-tauri-drag-region + 窗口按钮）
- ✅ **icons 占位替换**：icon-lab 生成新图标已替换 gomoku 占位（2026-09-06 入库，生成工具 `tools/icon-lab/`）
- ⬜ **严格隐藏逻辑**：对象级显隐（魔方/左右手）与点选/命中交互规则统一
- ⬜ **playtest 并入 CI**：networkidle0 卡点解决后再并入 ci.yml

### 新需求登记（2026-09-12）
- ⬜ **MCP 预览服务**：加一个 MCP 预览（截图/状态查询），方便 AI 写作时实时查看
  应用渲染与页面状态；与外部注入 API（暂缓）共用底层能力。
- ⬜ **标灰页小魔方默认转动了 U 的 bug**：标灰面板朝向小魔方默认不是还原态而是转了
  U——与其他自定义开始态（正放/倒放起始态）一起修。
- ✅ **注入 API 文档（2026-09-12 三件套完成）**：`docs/hand-api-usage.md`（方法表/
  快速上手/双手显示关系/验证记录）+ 说明页（#/help）「开发者 · 手部注入 API（DEV）」
  小节 + README「外部注入 API（DEV）」指引。✅ **API 真机验证通过**（Chrome 实测
  DEV dev server）：getState / setPose（合法通过+非法拒绝）/ playFrames（playing 态）
  / stop / setHandType / setVisible 全按预期。

### 技术债 / 长期
- ✅ 调试后门 `window.__motionCube` DEV 守卫（59d7751：仅 `import.meta.env.DEV` 挂载）；无 CSP ⬜
- ✅ 标定页每次输入全量重建 3D 几何：输入防抖 150ms + 重建放 rAF（连续键入/拖动期间合并一次，不再每键同步重建双视图）；标尺 `drawRuler` 改 rAF 合并调度（拖拽移动不再每 pointermove 全量重画 SVG overlay）
- ⬜ ~~手部模型精度细化（低优先，困难）~~ → **并入手部 low-poly 重构立项**（2026-09-11，见「手部模型 low-poly 重构」节）：网格细节/关节比例/观感问题在该重构中一并解决
- ⬜ 动画抽搐/真实卡顿感（连击冷却已基础版 120ms）；圆弧等函数路径

## rubik-anime-lab 迁移/合成计划（2026-08-20 新建，未动工）

> 参考文件已入库 `reference/`（分析用，不入 3D 渲染依赖）：
> - `reference/rubik-anime-lab.html`：上一参考实现（原
>   `rubik-anime-lab-0b0c6984.zip`，已分析）
> - `reference/rubik-cube.html`：求解器移植来源（可读源，48xx 行）
> - `reference/rubik-v4promax.html`：v4 增强版单文件 build（minified，含
>   Three.js；动漫卡线渲染 + 表面拖转 + CFOP/Roux 分步演示）

### LSE 部分
- ⬜ 保留我方 **4a→6E2C 阶段结构**，不照搬「整体最优+事后切里程碑」（该文件 4b/4c
  常近空：全局最优把定向/归位穿插省步，EO 里程碑在序列末尾才首次满足）
- ⬜ 可选借鉴「两条路线取短」：整体最优 vs 阶段化，仅当显著更短且阶段非空时采用；
  注意步数不单调递减（演示可能先变乱再收）需评估
- ⬜ 校验口径：切里程碑用与求解同源的坐标判定（对齐 lse-eolr 指纹/U 中心判定）

### 交互部分（CubePlayer / GamePage）
- ⬜ **操作层高亮**：three.js 侧当前转动层加 emissive/tint；拖拽与播放移动都触发；
  以片当前 pos 判层（对齐我方 CUBIES pos）
- ⬜ **高可中断**：单一动画状态 + 队列，所有入口（拖转/跳步/打乱/复原/演示）先清
  再接管；播放被打断时状态机直接落位（无 Promise）
- ⬜ **任意角度拖拽**：Raycaster 拾面 → 拖向定轴（叉积）→ 连续角度跟随（±1.05π）
  → 松手最近 90° 取整 + 吸附动画；px90 换算保证缩放无关手感

### 重建思路：替换 cubing.js 渲染层
- ✅ **阶段 0 接口收敛**（c91c531）：CubePlayer 抽象接口隐藏 cubing 专属泄漏
  （`onThreeScene` 替代 `experimentalCurrentThreeJSPuzzleObject`、
  `requestRender` 替代 `experimentalCurrentVantages/scheduleRender`）；
  GrayOverlay/HandRigView/EditorPage 只依赖接口 → 之后替换只重写 CubePlayer
- 🚧 **阶段 1 渲染替换**：three.js 自建 26 块+贴纸（数据复用 solver/engine 54 贴纸 +
  stickering 坐标）+ rubik-anime-lab 交互特性
  - ✅ 渲染核心（b142a37）：`src/cube/render/pose.ts`（纯逻辑层：27 块姿态 pos+rot3x3、
    axisAngleMat 右手正角 / quarterMat 顺时针=负角 snap 精确 0/±1、applyMovePose 同步
    54 state）+ `src/cube/render/RenderCube.ts`（three 视图：root.scale=1/3 对齐 cubing
    尺度、26 块黑体+至多 3 张贴纸@dir*1.5、C1 动画队列 step(dt) easeOut、可中断丢弃、
    undo 历史栈、setState 重涂槽位色）+ `scripts/verify-render-cube.ts`（自检 10/10 全绿）
  - ✅ 接驳宿主与拖转（已提交 + 真机验证）：`src/cube/render/RenderCubeHost.ts`（Scene +
    PerspectiveCamera(cubing 对齐 lat20/lon30/dist6.5)+WebGLRenderer+自驱 rAF+B1 拖转
    状态机：拾面 pending→useB 判轴→layer 拖角 ±1.05π→endPointer 角度+速度惯性取整→
    dragMove(from,to,dur,mi) 吸附 commit、净零 mi=null 不提交、orbit/wheel dist∈[5.2,18]/
    autoSpin + onManualMove/onInteractionChange；pick/planeHit 用 Raycaster）
    + RenderCube 升级（Anim.from、dragMove、setLayerVisual、debugMeshHits(userData)、
    isAnimating）+ `src/vue/pages/RenderDemoPage.vue`（`#/render-demo` 调试验证：打乱连播/
    撤销/适配视角/演示公式/自转）+ `scripts/render-shot.mjs`（puppeteer 截图验证：
    初始视角对齐 cubing、拖中心→U 顺时针 mi=U 提交、连播中断；输出 spike-shots/
    render-*.png）+ verify-render-cube 扩 H/I/J/K 拖转断言（19/19）。
    **真机验证（2026-08-25）**：render-shot 全链路 DONE（初始视角对齐 cubing→拖中心
    提交 mi=U→打乱连播 queue=7→撤销→editor-cubing 对照，5 截图 spike-shots/）；
    probe-render-dispose 往返 #/render-demo↔#/editor ×3 断言 `.rstage canvas==1` 且无
    body 直接子 canvas —— **8/8 ALL PASS**（dispose 完整化、无残留 canvas、无双实例，
    root cause 修复确认）。**vite EBUSY 根因修复**：vite.config server.watch.ignored 加
    `"**/reference/**"`（子代理 _work 产物 Excel COM 诊断 log 被锁 → watch EBUSY 崩）。
  - ⚠ **碰壁记录（2026-08-21）**：游戏页切 render 后端后真机崩溃已回退（提交
    947e9fd）。**root cause**：RenderCubeHost.dispose 从未移除自己的 canvas（全屏
    不透明黑底，clear 0x0b0e18）→ HMR/卸载后残留黑底 canvas + 重建后端双实例叠加
    （双 canvas 同时 rAF 渲染 + 双指针监听）→ 背景黑污染 + 渲染/旋转错乱。**已修**：
    dispose 补 `renderer.forceContextLoss()` + `canvas.remove()`。**教训**：headless/
    swiftshader 验证通过 ≠ 真机（GPU/生命周期差异），渲染类改动**必须先真机验证再
    提交**。**重做清单**：dispose 完整化（remove canvas/forceContextLoss/停 rAF）、
    单实例保证（残留 canvas 检测）、真机前置验证、相机/拖转真机手感。游戏页已回
    cubing 后端（session backend 默认）。
  - ✅ 播放条语义（render 轨，CubePlayer 双轨已实现）：play=从头连播 {seq,i,playing}/
    pause=清 playing/setMoves=setState 直达末态（jumpToEnd 等价）/reset 复位/undo/setSpeed
  - ⬜ 接驳余项（未做）：① CubePlayer 内部默认切换 RenderCube 后端（现默认 'cubing'）+
    ② EditorPage 自建宿主循环（Scene+PerspectiveCamera+WebGLRenderer+rAF 替换 cubing
    vantages——最大工程，真机崩溃教训，must 真机验证后再提交）+ ③ 最终视觉对比
    （dev 5174 + 截图）
- ⬜ **阶段 2 语法层**：默认保留 `cubing/alg`（纯 TS 无 DOM，唯一消费方
  `src/notation/alg.ts`）；solver 与 3D 显示已解耦（engine 零 cubing 依赖）
- 风险：GrayOverlay/HandRigView 靠 cubing 场景重建回调自愈 + 按需渲染；坐标/色彩
  魔法数字（stickering ±1.5、CUBE_UNIT_WORLD=0.33、linearSRGB 管线）全要重推；
  懒渲染兜底（kickRender/kickTimers）可删但要保证快照恢复不丢帧；动画语义
  （experimentalAddMove cancel / jumpToEnd / timeRange）要重写保证等价

### v4pro max 参考分析（2026-08-20，只读）

> 来源 `reference/rubik-v4promax.html`（minified，5066 行，含 Three.js 单文件）。
> 基于它作阶段 1/2 的可借鉴特性，非照搬清单。

- ⬜ **动漫卡线渲染（零后处理）**：反转壳体描边（hull=黑底 BackSide 材质 + 1.02 放大
  盒体）+ MeshToonMaterial + gradientMap（0.28/0.55/0.8/1 色阶）+ 贴纸微 emissive +
  圆角贴纸几何；三光源 + shadowMap + 地面径向渐变紫光；背景旋转光芒/透视网格为纯
  CSS 可忽略
- ⬜ **表面拖转交互模型**：射线拾面 → 切向得分选轴 → 先锁轴 → 拖角带增益
  （1.8×，clamp ±π）→ 松手按最近 90° 吸附（可出 0/1/2/3 圈，0.32rad 死区）；
  5px 死区防误触；视角 orbit 带惯性 + 双指 pinch（5.6–17 clamp）+ 空闲自动旋转
- ⬜ **双解法 + 中心校正**：CFOP（十字搜索→贪心 F2L→OLL/PLL 表）与 Roux
  （FB/SB 块搜索→CMLL→LSE 4a/4b/4c）双路线，total/ms/verified 重放自检；
  「centre」阶段归位中心（与 solver 中心漂移处理一致，UI 化展示）
- ⬜ **Worker 求解**：求解器作为字符串经 Blob URL 跑 Web Worker，8s 超时降级
  inline，UI 不阻塞
- ⬜ **分步演示 UI**：底部播放条分阶段彩色进度段 + 标签、当前步大字 + 阶段名 +
  计数、首/上/播/下/尾 + 进度条点击 seek（pendingSeek 合并 + 直接 apply 快进）；
  右侧步骤按阶段分组、每步 chip 可点击跳转、当前 chip 自动滚动进视口；
  播放完 COMPLETE! 庆祝 + solved-badge；手动转动即失效旧解法并 toast
- ⬜ 工程韧性：boot try/catch + 非 WebGL 优雅降级；analysePixels 渲染帧采样贴纸
  颜色自检；单一动画队列 + isLocked() 门禁（与「高可中断」一致）

### 参考文件全面审查（2026-08-21，只读审查 + 用户采用决议）

> 子代理审查：`.research_zbll/` 全部 28 脚本 + 5 JSON；`reference/` 三份 HTML。
> 核心结论：rubik-anime-lab.html = 零依赖纯 WebGL 自建魔方，正是「阶段 0/1/2
> 渲染替换」的现成范本；52.5% 覆盖（926/1944）是 cuberoot 单源 family 闭包天花板。

**✅ 已确认采用（用户选定）**
- **R1 渲染替换三件套**（阶段 1 地基）：CubeCore 26 块模型
  （`newGeo`/`geoApply`，rubik-anime-lab L552-585）+ 拖转交互
  （L1868-1946：拾面→屏幕方向→角度累进→动量吸附最近 90°，含中间层）
  + 高可中断动画队列（L1764-1849：单状态+每帧 step+`anim=null` 即打断）
  —— B/C 逻辑可近乎直接照搬，几何/渲染按 three.js 翻译
- **R2 动漫卡线两遍渲染**（L1413-1459/1590-1654）：反向外壳（FRONT+expand）
  + SDF 圆角贴纸裁切 + 三段色调；three 侧用 ShaderMaterial 翻译
- **R3 快照重放分步演示 + LSE 里程碑切段**：`solGeo` 快照 + `jumpTo(k)` 重放前 k 步
  （L1966-2050）进 GamePage 演示；D2 按 predEO/predULUR 切 4a/4b/4c 演示边界（思路）
- **R5 coverage 回归工具**：`orbit_count`+`per_set_coverage` 逻辑（family
  并集 4 变体 canon）提取为 `scripts/verify-zbll-coverage.ts`（Node 原生
  TS strip-types 运行，勿用 tsx——WSL/沙箱 esbuild 平台不匹配）。当前报
  **926/1944（49.5% of 1872）**，各 set 断言：T148/U152/L226/Pi148/S232/AS234/H87，
  与 .research 全对齐。（实现为 .ts 而非原决议 .mjs：直接复用主引擎，先做
  贴纸一致性校验，避免双引擎重复）
- **R6 实现 mirrorAlg + mirrorState**：落地 `engine.ts`（与 invertAlg 同级）——
  MIR 表（analysis.mjs）+ x/z 面贴纸反射（sticker_analysis.mjs）+ R↔L/F↔B 重标。
  **重大语义修正**：绕镜像法线轴（x）的步 M/M'/M2、x/x'/x2 **方向保持不翻转**
  （贴纸反射下与 x 轴转动对易，探针实证；其余照 M2 表）。恒等式校验内置于
  R5 工具（单步+300 随机序列 mirrorAlg∘apply == mirrorState∘apply，354/354，
  mirror 对合 200/200）——决议要求的「贴纸引擎与主 engine.ts 一致性校验」即此。
- **R8 v4pro 交互增强**：undo（逆向）、键盘（space 暂停/Z 撤销/方向键单步/
  键入 UDRLFBMS/Alt+S 打乱）、复制解法到剪贴板、COMPLETE 庆祝+solved-badge+toast
- **R10 oc 阶段摘要 HTML**：解法分阶段摘要视图（phases 列表+各阶段步数），
  与现有 solve panel 阶段展示合并参考

**⬜ 暂缓 / 未采用**
- R4 记谱宽层展开+化简（parse/simplify）：cubing.js 已覆盖大部分，仅 simplify 可能有用
- R7 zbll_map 双源并集闭包：唯一可突破 52.5% 的路径，但需先量化 union 再决定
  （风险中高，暂缓）
- R9 Dx 中心校正 + verified 重放自检：主项目已覆盖中心漂移处理，印证为主
- 明确不复用：`debug_*`、空 `roman_canons.json`、cubing.js 依赖脚本

**README 引用声明（待办）**
- ⬜ 采用参考实现后，在 README 添加致谢：「部分实现思路（具体写出）参考或者
  直接采用了灰测群群友跑出来的魔方」——待用户确认最终措辞/指向后再写入

## 已完成批次（摘要）

- **0.3.2 求解器移植**（08-19）：54 贴纸引擎 + search（PDB/IDA*）+ OLL/PLL/CMLL
  图库 + F2L 表 + CFOP/Roux + solve 入口 + GamePage 求解 UI；smoke + puppeteer 全绿
- **0.3.2 内置公式库**（08-19）：cuberoot.me 爬取 9 集合 241 case + 54 贴纸语义
  校验 + BUILTIN_LIBRARY + 公式库页加载按钮
- **0.3.3 游戏页+演示**（08-20，d58ad5c）：求解面板（方法/阶段/演示/复制）、打乱
  按钮、恢复进度/打乱后 3D 显示修复、求解表空闲预热
- **0.3.4 ZBLL/ZBLS 全覆盖**（08-20，8f75a5c）：解析器 `[2345]'` 记法；zbll 466→472；
  全阶段禁 tidyAlg 不消步；ZBLS 305 落库接入；GamePage cfop-adv；一步 ZBLL 查表
  （52.5% 覆盖 + 回退 OLL+PLL，prepare 0.5s）
- **0.3.5**（08-20）：打乱 3 倍速播放；Roux LSE 改造（4a→6E2C、EOLR 一步表）；
  6 色底双模式（跟随设置底/固定 D）；cfop-adv 中性发现（反例入
  `data/samples/cfop-adv-zbll-case.json`）
- **0.3.6**（08-21）：解法底选择 v1——方法面板「解法底」区（跟随全局底(默认)/六色底
  U/R/F/D/L/B），localStorage `motion-cube.solveBase` 持久化；坐标中性结论：显式底不改
  moves、仅记录视角；验证 verify-solve-base 11/11 + UI 7 chip 全绿
- **0.3.7 本轮**（08-22）：①速度体系统一——两滑条改「实际 s/步」显示、同一基准
  （1000ms/步 @1.00s/步，tempoScale=1/秒），打乱下限 0.20s/步（=5x 等效），消灭「同倍率
  不同速」遗留；②单色底真正生效——solve 三层：`baseFaceSetupAlg` 整块旋转（B 色转 D 面位）
  + `relabelByCenter` 中心色重映射（贴纸颜色按面位 home 色重名，位置不变，不破坏求解器
  「中心归 home」）+ 归一求解；演示先播 setupAlg 再播 moves（视觉旋转到对应底）；实证推翻
  旧探针（整块旋转后未重标注中心色致误判）；③多色底多选——`SolveBaseChoice = Face[]`
  （localStorage `motion-cube.solveBase`），去「跟随原始底」chip、默认选中全局底色、
  可加选/取消（最少一个，取消唯一被拒）、「重置为全局底」；集合内逐底求解取最短。
  验证：typecheck 绿 + verify-solve-base 26/26 + shot-solve-base 15/15（截图画三张）
- **更早（08-06~08-13，归档）**：Vue/WinUI 迁移、动画编辑器全量迭代、拍概念、
  标灰面板、首页视差、tauri 桌面版、安全审查等，详见 git log

## 工程约定

- 端口 **5173** 为用户日常预览；本项目 dev/playtest 用 **5174** 或其它非 5173 端口
- 版本号 package.json 与 src-tauri/tauri.conf.json 必须同步（tauri 打包以 conf 为准）
- 提交：不 amend、不擅自 push；功能/修复提交时评估 bump
- 验证命令：`npm run typecheck` / `npm run build` / `node scripts/smoke-solver.ts` /
  `node scripts/smoke-solver-edge.ts` / `node scripts/playtest-ui.mjs`（SPIKE_URL 指向非 5173）