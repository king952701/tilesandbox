# EPIC M1 — 挖得动、放得下、走得动、看得见昼夜

**目标**：在世界里能跑能跳能挖能放，看得到昼夜变化，三端（PC 浏览器 / 手机浏览器 / 安卓 APK）同一份代码跑起来。
**验收**：见 `design/gdd/systems.md` 第 7 节 A1–A7。

## Story 列表（按实现顺序）

| # | Story | 归属 | 验收（一句话） |
|---|---|---|---|
| S1 | 常量与坐标换算层 | core | `idx/tx↔chunk` 往返正确，边界格返回越界 |
| S2 | 确定性噪声（mulberry32 + value fbm） | core | 同 seed 两次生成 3×3 chunk 逐字节一致（A7） |
| S3 | tile 数组全驻留（SoA，6 B/格） | core | 分配成功，内存 ≈ 24 MB，读写往返一致 |
| S4 | tile 注册表 + 硬度/掉落数据 | data | `assets/data` 与运行时同一份，硬度分层 4 级 |
| S5 | 世界生成（地表/土/石/基岩 + 洞穴 + 矿脉） | world-gen | 同一 seed 可复现；矿脉落在其深度带内 |
| S6 | chunk 按需生成 + 空闲分片 | chunk-streaming | 跨 chunk 无空洞；单 chunk 生成 ≤ 8 ms |
| S7 | 玩家物理与 tile 碰撞 | gameplay | 可左右移动、跳跃，站得上自己放的方块（A2 后半） |
| S8 | 背包与 9 格热栏 | gameplay | 拾取入包、热栏选中、放置扣减 |
| S9 | 挖掘（进度环 + 掉落） | gameplay | 空手挖土 0.5±0.1 s；木镐挖石 2.22±0.05 s；硬度不够有提示（A1） |
| S10 | 放置 | gameplay | 连放 5 格各扣 1，可站立不穿透（A2） |
| S11 | 光照（阳光列衰减 + 火把点光源 + lightmap） | render | 火把周围 6 tile 亮度 ≥ 0.25（A4 后半） |
| S12 | 昼夜循环与配色插值 | render | 20 min 走完一天，≥3 档可辨（A4） |
| S13 | 相机与 quadrant 烘焙缓存 | render | 可见 tile 3600 时 drawImage ≤ 30；挖一格只重画 9 格 |
| S14 | 程序化图集与 autotile | art | 5 材质 × 20 变体 + 4 角补丁启动生成，无外部图片 |
| S15 | 合成（3 条 T0 配方） | gameplay | 10 木材 0.5 s 出木镐并扣料；缺料禁用（A5） |
| S16 | 存档（IndexedDB，只存改过的 chunk） | save-load | 退出重进坐标/背包/改动 tile 一致（A6） |
| S17 | 输入抽象层（键盘 + 触控） | input | PC 键鼠与手机摇杆产生同一组 intent |
| S18 | HUD（热栏/时间钟/提示条） | ui | DOM 层，脏重绘，不进每帧 canvas 绘制 |
| S19 | 三端壳：静态站 + Cordova + Actions | release | Pages 可访问；apk.yml 产出签名 APK |
| S20 | 移动端降级（DPR≤2 / 半径减半 / lightmap 5Hz） | perf | 手机端帧时间 p95 < 33 ms |

## Definition of Done（每条 Story）

1. 代码落盘且被 `main.js` 真正引用（不是写了没接）。
2. 有对应的验收判据，并在 `production/qa/evidence/` 留下证据或如实记录"未观察"。
3. 不改越界文件（玩法不引用 UI；core 不引用 DOM）。
4. 数值在 `assets/data` 或 `src/data.js`，代码里不写死魔法数（常量除外）。

## 不在 M1

饥饿、刷怪、战斗、死亡惩罚、作物、养殖、货币/NPC、T2+ 合成台、洞穴结构与宝箱、第二 biome、
47-blob 完整 autotile（M1 用 16 边变体 + 4 填充 + 4 角补丁，视觉等效，图集小 12 倍）。
