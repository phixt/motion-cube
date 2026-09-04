# 手法动画编辑器 · 参数模型

> 更新：2026-09-04（拇指 CMC 三轴重校；handRig 配置 v3）
> 本文件为编辑器/游戏共用数据模型的骨架；类型定义以源码为准，下表为便于理解的摘要。

## 约定

- **坐标系**：魔方单位（1 = 一个块边长）；世界右手系；WCA 标准朝向（白顶/绿前/红右）；手与魔方在同一世界空间。
- **关节角 `bend`**：指腹侧夹角——伸直 180°、自然 ≈135°、极限 ≈90°；默认范围 90–180（拇指 CMC 放宽到 60–180）。
- **段内位置 `t`**：0 = 段根部（关节侧），1 = 指尖；"近指尖 1/3" ≈ t 0.67。
- **帧率**：数据层基准 60fps（`DEFAULT_FRAME_RATE`），但 `frameRate` 为手法级可调字段
  （编辑器预设 23.97/24/29.97/30/59.94/60/120/240/1000）；帧号上限 `MAX_KEYFRAME_FRAME = 36_000`。

## 手骨架（`src/hand/HandRig.ts`）

骨架 `HandRig` 是几何与关节约束定义，所有 pose 共用：

| 参数 | 含义 |
|---|---|
| `handType` | `"left" | "right"`——决定靠拇指侧方向定义（渲染镜像） |
| `fingers[].segments[]` | 每指段定义：`{ length, width }`（魔方单位）；拇指 2 段，其余 3 段 |
| `fingers[].joints[]` | 每指关节定义：`{ name, bend, range?, abduction?, elevation?, rotation? }`；通用指 MCP/PIP/DIP，拇指 CMC/MCP/IP |
| `joint.range` | 屈伸范围（默认 90–180）；仅拇指 CMC 覆盖为 60–180 |
| `joint.abduction / elevation / rotation` | 拇指 CMC 三轴（度）：掌平面展收 / 抬离掌面 / 对掌自转；**仅拇指 CMC 使用** |

默认骨架按人体测量数据折算（见下方「手部比例」）。

## 姿态（`Pose`）

| 参数 | 含义 |
|---|---|
| `palm.transform` | 手掌位置 + 四元数朝向 |
| `palm.thumbBase` | 拇指根相对手掌的位姿（拇指基底自由度所在） |
| `bends[finger]` | 各指关节 bend 值数组（顺序与骨架 joints 一致） |
| `thumbCMC` | 拇指 CMC 三自由度：`{ abduction, elevation, rotation }`（度；旧数据缺 elevation 按 0 解析） |
| `contacts[]` | 接触列表（见下） |

## 接触（`Contact`）

| 参数 | 含义 |
|---|---|
| `finger` | 手指名 |
| `segmentIndex` | 所在段序号（拇指 0–1，其余 0–2） |
| `side` | 接触侧 ∈ `pad`(腹) / `back`(背) / `thumbSide`(靠拇指侧) / `pinkySide`(靠小指侧) |
| `t` | 段内位置 0–1（0=段根，1=指尖） |
| `target` | 魔方元素名（字符串，如 "UL 边"、"ULB"、"B 面"） |

> 接触的起止时刻不存 pose 内——由手法级 `contactTracks`（精确起止帧）承载。

## 手法（`src/data/technique.ts`）

| 参数 | 含义 |
|---|---|
| `id / name` | 标识 / 显示名 |
| `formulaId` | 关联公式（必填；一个公式可绑定多个手法） |
| `frameRate` | 帧率（默认 60，可调） |
| `keyframes[]` | 稀疏控制点：`{ frame, pose, easing? }`（linear/easeIn/easeOut/easeInOut），按帧升序 |
| `stepMapping[]` | 手法段 ↔ 公式某一步：`{ stepIndex, startFrame, endFrame, kind? }`；`kind` = move / pause（空拍） |
| `contactTracks[]` | 接触轨道：`{ startFrame, endFrame, contact }`（精确起止，中途可接触/释放） |
| `startState?` | 自定义正放起始态（alg；缺省 = 公式逆序状态） |
| `reverseStart?` | 自定义倒放起始态（alg；缺省 = 还原态） |

## 公式（`src/data/formula.ts`）

| 参数 | 含义 |
|---|---|
| `id / name` | 标识 / 显示名 |
| `moves` | 标准 WCA/SiGN 记法（规范化后） |
| `tags` | 标签数组（流派等主观归类，如 CFOP/Roux） |
| `categoryId` | 所属分类 id（单选；null = 未分类） |

只存公式本身，不存速度/手法；与手法库通过 `formulaId` 弱关联。

## 手部标定配置（`src/hand/handRigStore.ts`，localStorage `motion-cube.handRig`）

| 参数 | 含义 |
|---|---|
| `handScale` | 整体放大系数：数据单位 → 渲染倍数（默认 2.1/1.33） |
| `fingerSpacing` | 四指根 X 乘数（默认 1） |
| `palm` | 手掌盒体 `{ width, height, length, mcpZ }`；前表面落在 mcpZ |
| `bases[]` | 四指根相对手掌中心 `{ x, y }`（右手 +X 为拇指侧，左手渲染 X 取反） |
| `thumbCorner` | 拇指根锚点（掌根/腕侧，`{ x, y, z }`，x 按手型取反） |
| `thenar` | 大鱼际凸块椭球 `{ width, height, length, x, y, z }` |
| `thumbCmc` | 拇指 CMC 自然外翻 `{ abduction, elevation, rotation }`（度；v3 新增，写入骨架 CMC 默认值） |
| `rulerAngle` | 标尺角度（度，0=水平，90=竖直） |
| `fingers[]` | 各指段长/粗细（可标定覆写默认骨架） |

「固化」保存到 localStorage，编辑器/游戏构造 HandRigView 时读取同一配置。

## 编辑器功能（非数据字段，UI 层）

- **吸附**：`snapOn` 开关，按 1/3 块边长（sticker 网格）取整坐标。
- **自动建帧**：`autoKf` 开启后，编辑目标 = 播放头帧，空白帧改数值自动建帧（以插值姿态为基底）。
- **自动路径**：首末关键帧间按 15 帧间隔 slerp 生成中间关键帧。
- **插入中间帧 / 正弦路径**：选中关键帧区间插入中间帧 / 正弦函数路径。
- **播放**：整体倍速（0.25–4x）、循环、倒放；时间线总长下限 = 最短单步 0.01s × frameRate（至少 1 帧）。

## 手部比例（人体测量数据源，2026-08-06）

默认手骨架按开源人体测量数据折算（1 单位 = 1 块边长；段粗为圆柱直径）。
可调入口：标定页 `#/hand`（平铺手掌 + 块边长标尺，参数实时预览，「固化保存」后编辑器/游戏生效）。

| 指 | 段长（近/中/远） | 段粗（近/中/远） | 总长比（中指=1） |
|---|---|---|---|
| 拇指 | 0.71 / 0.53 | 0.28 / 0.21 | 0.70 |
| 食指 | 0.79 / 0.46 / 0.35 | 0.26 / 0.21 / 0.16 | 0.90 |
| 中指 | 0.86 / 0.56 / 0.35 | 0.27 / 0.21 / 0.16 | 1.00 |
| 无名指 | 0.76 / 0.51 / 0.36 | 0.25 / 0.22 / 0.16 | 0.93 |
| 小指 | 0.63 / 0.37 / 0.33 | 0.23 / 0.19 / 0.14 | 0.75 |

手掌：宽 1.35 × 厚 0.45 × 长 1.55（MCP 线 z=0.4）；整体放大 `handScale = 2.1/1.33`
（小指渲染 ≈ 2.1 块边长，中指 ≈ 2.8 恰好横跨一个魔方面；2026-08-06 目测由 3.1 回调）。

拇指 CMC 自然外翻（2026-09-04 重校为三轴，见 `DEFAULT_THUMB_CMC`）：
展收 42°（掌平面内离开食指）+ 抬离 20°（向指背侧抬起，左视图与掌面约 20°）+
对掌自转 45°（指腹转向掌/指侧）。旧版仅两轴且 `abduction` 映射到绕长轴自转
（视觉上不产生抬离，注释声称的"侧视 21°"从未实现），已修正为
`rotation.x = -elevation / rotation.y = ±abduction / rotation.z = ∓rotation`（按手型镜像）。

数据来源：

- 各指总长比：acbjournal 2024（51 名 18–30 岁青年，指节之和 mm：
  thumb 49.5 / index 63.9 / middle 70.7 / ring 65.5 / little 53.3）
  <https://acbjournal.org/journal/view.html?volume=57&number=2&spage=172&vmd=A>
- 指节长度占比：JSSM（久坐男性，指骨长度 %：thumb 57.3/42.7；index 49.5/28.8/21.7；
  middle 48.5/31.8/19.6；ring 46.8/31.2/22.0；little 47.0/27.9/25.1）
  <https://jssm.org/tablejssm-07-544.xml/table001.xml>
- 指粗比：儿童 3–10 岁指径（thumb 16 / index,middle 15 / ring 14 / little 13，mm）
  → 相对小指 1.23 / 1.15 / 1.15 / 1.08 / 1.00；指节 taper 取 JSSM 体积比折算并略保守化
- 手掌参考：中国成人 3D 扫描（掌长 113.25 / 掌宽 83.58 / 掌厚 30.50 mm，
  掌宽/掌长 ≈ 0.74）；目测回调到紧凑尺寸

存储：`motion-cube.handRig`（localStorage，结构见 `src/hand/handRigStore.ts`，
配置版本 v3（v1 拇指根语义迁移、v2→v3 新增 `thumbCmc`，均自动规范化与越界截断；
`createDefaultRig()` 保持纯默认，测试断言按默认值）。