# TILESANDBOX 架构

> 整合 four-way 分工产出后的裁决版本。冲突处已由技术总监裁决，见 ADR-0001 / ADR-0002。

## 0. 一句话架构

**世界数据全驻留、渲染面按需换入换出**：396 万格的 tile 数据用 TypedArray 一次性分配（约 24 MB，
PC 与手机都扛得住），而真正吃内存的是"画出来的像素"——那部分按 32×32 tile 的 quadrant 离屏
canvas 缓存 + LRU，挖一格只重画 9 格，绝不整块重烘。

## 1. 世界常量（写死，改这里等于改存档）

| 常量 | 值 | 说明 |
|---|---|---|
| `TILE` | 16 px | 世界像素 79200×12800 ÷ 16 → 4950 × 800 |
| `WORLD_TILES_X / Y` | 4950 / 800 | 3,960,000 格 |
| `CHUNK` | 64 tile | 存储/生成单位，1024×1024 px |
| `CHUNKS_X / Y` | 78 / 13 | 1014 个 chunk（末行末列有 padding：4992/832） |
| `QUAD` | 32 tile | **渲染烘焙单位**，512×512 px，1 chunk = 4 quadrant |
| 世界边界 | 硬边界 | 左右上下都是不可穿越的基岩，**不做环绕**（无缝指无加载门，不是环形世界） |

坐标换算（负坐标必须 `Math.floor`，不能用 `|0`）：

```
tx = Math.floor(px / 16)          px = tx * 16
cx = tx >> 6,  lx = tx & 63       cy = ty >> 6,  ly = ty & 63
chunkIdx  = (ly << 6) | lx            // 0..4095，块内索引
chunkId   = cy * 78 + cx              // 0..1013
gi        = ty * 4950 + tx            // 世界行主序
```

## 2. 分层（后 → 前）

| # | 层 | 视差 | 实现 |
|---|---|---|---|
| 0 | 天空渐变 | — | CSS `linear-gradient`，0 draw call |
| 1–2 | 远景山/云/中景树线 | 0.15–0.7 | 离屏 strip 横向 wrap 平铺 |
| 3 | 背景墙 tile | 1.0 | quadrant 烘焙 |
| 4 | 主地形 tile | 1.0 | quadrant 烘焙 + autotile |
| 5 | 实体（玩家/掉落/怪物） | 1.0 | drawImage，按 y 排序 |
| 6 | 光照 | 1.0 | 每格 1 像素 lightmap 放大 + 一次全屏 tint |
| 7 | HUD / 触控 | — | DOM + CSS（独立合成层） |

主 canvas 1 张 + UI canvas 1 张 + quadrant 离屏池（池化复用，永不 `new`）+ lightmap 1 张。

## 3. 数据流

```
输入抽象层(intent) ──▶ 玩法系统(player/mining/inventory/crafting/time)
                             │  改 tile ─▶ world.setTile() ─▶ 标脏 quadrant + 邻接
                             ▼
                       相机 ─▶ 可见 quadrant 计算 ─▶ 命中缓存？drawImage : 烘焙
                             ▼
                        光照 BFS(脏区) ─▶ lightmap ─▶ 全屏 tint ─▶ 呈现
存档：玩家改动过的 chunk（flags.b0）→ IndexedDB；未改动的靠 seed 重生成，不落盘
```

---

# ADR

## ADR-0001：tile 数据全驻留，渲染面 LRU

- **状态**：已接受
- **背景**：3,960,000 格；两种意见——①按视口换入换出 tile 数据；②全驻留。
- **决策**：tile 数据（6 B/格）一次性分配 **约 24 MB 全驻留**（含 padding 4.9%），不再做 tile 层的换入换出；
  只对**渲染面**做 LRU（PC ≤ 64 quadrant，手机 ≤ 16 quadrant）。
- **理由**：换入换出 tile 数据省的是 24 MB，代价是跨边界的竞态、加载空洞和一堆状态机；而真正的内存
  大户是烘焙面（512×512 RGBA = 1 MB/块，全缓存 = 4 GB），那才是必须 LR U 的东西。
- **代价**：首屏启动时一次性分配 24 MB TypedArray（手机可接受，已在预算 180 MB 内）。
- **格式**：SoA，`tileId:Uint16 + wallId:Uint16 + light:Uint8 + flags:Uint8`。
  `flags`: b0=玩家改过（参与 diff 存盘）、b1=已开掘、b2=矿脉、b3=光源污染。

## ADR-0002：存储 chunk 64×64，渲染 quadrant 32×32（4:1）

- **状态**：已接受
- **背景**：两派分别主张 chunk=64 与 chunk=32。
- **决策**：**生成/存储/存盘用 64×64 tile 的 chunk（1014 个）；渲染烘焙用 32×32 tile 的 quadrant
  （每个 chunk 切成 4 个）**。二者不是两套世界，是同一份数据的两种视图。
- **理由**：chunk 越大，生成时的跨块结构（洞穴腔体、树、POI）越好处理，存盘条目越少；quadrant 越小，
  挖一格的重烘代价越低（512×512 单次烘焙 2–4 ms，1024×1024 要 8–12 ms，移动端会掉帧）。
- **代价**：需要维护 chunk↔quadrant 的映射与邻接脏标记（边界格要脏到相邻块，最多 4 块）。

## ADR-0003：免构建，原生 ES modules

- **状态**：已接受
- **决策**：不引入打包器。`index.html` 用 `<script type="module">` 引 `src/main.js`；`www/` 是物理复制产物。
- **理由**：三端（PC 浏览器 / 手机浏览器 / Cordova WebView）跑同一份源码；本机没有 node 在 PATH，
  任何构建步骤都会变成出包时的单点故障；`file://` 下 fetch 会被 CORS 拦，所以**数据一律内联成 .js 或走
  程序化生成，不 fetch JSON**（M1 的 tiles/items/recipes 直接以 JS 常量导出，JSON 副本供 Tiled 与工具链用）。
- **代价**：无 tree-shaking、无压缩；首包靠程序化生成资产压体积（零图片文件）。

## ADR-0004：零外部美术素材，图集程序化生成

- **状态**：已接受
- **决策**：所有 16 px tile 与实体精灵在**启动时用 Canvas 程序化绘制**进图集，仓库内**不放任何第三方
  图片/字体/音频**。
- **理由**：项目要求不引入未授权素材；程序化生成让首包 < 5 MB 且无版权风险；像素风的 51 变体本来就该
  由代码按调色板派生，而不是手画 408 张。
- **代价**：美术风格受限于程序化调色板，细节不如手绘（M1 可接受）。

## ADR-0005：Tiled 只做 template，不碰主世界

- **状态**：已接受
- **决策**：主世界（396 万格）**不进 TMX**；`.tsx` 作为 tile 字典（local id ↔ `solid/hp/drop/light/toolTier`），
  构建期导出运行时 `tiles.json`；`.tmx` 只用于 8×8~64×64 tile 的**建筑模板/POI 片段**，离线
  `tiled --export-map json` 转成 stamp 常量打包进 JS。
- **理由**：396 万格 csv 约 20 MB 文本，Tiled 编辑 1014 个 chunk 不可行；运行期解析 TMX 在 Cordova
  `file://` 下会被 CORS 拦。运行期**只用 local id，绝不用 GID**（避免 firstgid 漂移）。
- **代价**：多一道离线转换步骤（M1 未启用模板，先落规范）。

## ADR-0006：存档 schema v1（冻结，改动需询问）

- **状态**：已接受（首次定义，冻结）
- **决策**：
  - IndexedDB `db="tilesandbox"`，`version=1`；store：`meta`(keyPath `saveId`)、
    `chunks`(keyPath `["saveId","ci"]`)、`player`(keyPath `saveId`)。
  - **世界存档与玩家存档分离**（换世界不影响角色）。
  - **只存改过的 chunk**：`modCount ≤ 1024` 存稀疏三元组 `[[idx,tile,wall],…]`；`> 1024` 存整块 24 KB blob。
    `light` 不持久化，加载后重算。
  - 每条记录带 `v:1`；`v` 不匹配走 `migrations[1→2]` 链式升级，不识别则只读不写。
  - `seed` 与 `seedVer` 入存档；噪声参数版本变动 → `seedVer+1`，只重生成玩家没改过的 chunk。
- **schema 变更是停机项**：任何字段增删改都必须先问用户（automation=autonomous 下的例外）。

```json
{ "v":1, "saveId":"w-7f3a", "seed":20250101, "seedVer":3,
  "world":{"wTiles":4950,"hTiles":800,"chunk":64},
  "player":{"x":39600,"y":2048,"hp":20,"inv":[...]},
  "chunks":[{"v":1,"ci":163,"cx":7,"cy":2,"modCount":3,"mods":[[520,11,0],[521,11,0],[600,0,7]]}] }
```

## ADR-0008：聊天是客户端能力，多人靠可插传输层

- **状态**：已接受
- **背景**：需求是"游戏内置聊天，可发语音/视频/图片/游戏内资源，其他玩家可以查看"。
- **决策**：数据层拆成 `MessageBus`（本地优先：写 IndexedDB → emit → 若有传输层再上行）。
  多人只差一个 `attachRemote({ send, onMessage })` 实现；**不擅自接第三方云**。
- **理由**：静态 Pages 与 Cordova 包里没有服务端，两部手机之间没有通道；引入 BaaS 又与
  "不引入未授权第三方素材/服务"的长期约束冲突，必须先问用户。
- **代价**：当前 UI 显示"离线模式（消息存本机）"，多人功能待定。
- **媒体**：截图走 `canvas.toBlob`；录像走 `canvas.captureStream` + `MediaRecorder`；
  录音走 `getUserMedia` + `MediaRecorder`；全部做能力检测，不支持时降级提示而不是崩。

## ADR-0009：IndexedDB 升到 version 2（新增 chat store）

- **状态**：已接受
- **背景**：聊天与媒体需要持久化。
- **决策**：`db.js` 统一打开 `tilesandbox` v2，含 `saves`（keyPath `saveId`）与 `chat`（keyPath `id`）两个
  store；**世界/玩家存档记录结构仍是 v:1，一字未动**（ADR-0006 冻结的是记录 schema，不是库版本号）。
- **代价**：v1 数据库会走一次 upgrade 建 chat 表，旧存档无损。
- **未做**：HP 与饥饿不跨会话保存（那才是真正的记录 schema 变更，按规矩等你点头）。

## ADR-0007：确定性生成（同种子同世界）

- **状态**：已接受
- **决策**：禁用 `Math.random`；噪声 = 纯函数 `f(seed, 世界绝对 tile 坐标)`，哈希用 `Math.imul` 混合
  （mulberry32 + 自制 value noise），**禁用 `Math.sin` 哈希**（跨引擎精度不一致）。
  所有采样用**绝对 tile 坐标**，禁止用块内局部坐标；按格随机的结构（矿脉胞元、树、POI）用
  `Math.floor(tx/CELL)` 的绝对胞元号，保证块边界两侧算出同一结果。
- **代价**：自己实现噪声（约 120 行），不能用现成库（也不想引入依赖）。

---

## 生成管线（分层参数，深度 d = ty - surfaceY，向下为正）

1. **地表高度**：value-noise fBm，`octaves=4`，`baseFreq=1/512 tile`，`lacunarity=2`，`gain=0.5`；
   山地叠加 ridged `oct=3, freq=1/1024`；`surfaceY = 120 + n*60`（约 120..180）。
2. **土层**：`soilThick = 18 + fbm(freq=1/256, oct=3) * 12` 格。
3. **岩石**：土以下为 stone；`ty ≥ 760` 为不可破坏 bedrock（最后 40 行）。
4. **洞穴**：worm = `|simplex(freq=1/48) - 0.5| < 0.06`，叠加 `oct=2, simplex(freq=1/24) > 0.62` 腔体；
   密度随深度 `0.12 → 0.35`（ty 140..700 线性），700 以下衰减。
5. **矿脉**：每矿种独立噪声 `simplex(freq=1/16, seed + i*7919) > 0.78`，限制深度带：
   煤 160–400 / 铁 250–550 / 金 400–650 / 宝石 550–720；另按 32×32 tile 绝对胞元哈希
   `hash % 1000 < density`（煤 20 / 铁 12 / 金 6 / 宝石 3）撒半径 2–5 的簇。
6. **成本**：每格约 5 次采样 × 4096 ≈ 2 万次/chunk，目标 ≤ 4 ms，超标即拆两帧。

## 按需生成与回收

- **存活半径**：生成/模拟 PC `r=4`（9×9=81 chunk）、手机 `r=2`（5×5=25）；
  渲染面 PC `r=2`、手机 `r=1`。
- **触发**：玩家所在及相邻 8 块（r=1）**同步生成**（≤ 8 ms/帧）；r=2..R 走空闲队列
  （`requestIdleCallback`，无则 `setTimeout(0)`），每帧最多 1 chunk、时间片 ≤ 2 ms，按曼哈顿距离升序。
- **回收**：出半径即释放 quadrant 面（`canvas.width = 0` 助 GC），tile 数组不释放（全驻留）。
- **写盘**：`flags.b0` 为真的 chunk，出半径或 `visibilitychange/pagehide` 时写；自动存档节流 15 s
  且增量 `modCount ≥ 32` 才真正写。
