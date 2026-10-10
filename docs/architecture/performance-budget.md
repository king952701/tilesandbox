# 性能预算（硬指标，超标即 FAIL）

| 指标 | PC | 手机 / Cordova |
|---|---|---|
| 目标帧率 | 60 fps（锁 60） | 30 fps（逻辑 30，UI 层 60） |
| 每帧 JS 预算 | ≤ 8 ms | ≤ 10 ms |
| drawImage / 帧 上限 | 1200（烘焙后实际 6–30） | 300（实际 6–16） |
| 可见 tile 上限 1280×720 | 3600（80×45，zoom 1） | 900（40×23，zoom 2） |
| 可见 tile 上限 1920×1080 | 8160（120×68，zoom 1） | 2040（60×34，zoom 2） |
| 图集尺寸上限 | 4096²（仍建议 2048²） | **2048²** |
| 主画布 backing | DPR ≤ 2 | **DPR 强制 ≤ 2**（3 也降 2） |
| 进程内存上限 | ≤ 512 MB | ≤ 180 MB |
| quadrant 缓存 | ≤ 64 块（64 MB） | ≤ 16 块（16 MB） |
| 首包体积 | — | **< 5 MB**（零图片，程序化资产） |
| chunk 生成 | ≤ 8 ms（同步）/ ≤ 2 ms（空闲分片） | 同左，半径减半 |
| lightmap 更新 | 10 Hz | 5 Hz |

## 为什么是这个量级

3,960,000 格如果逐帧遍历必死。三个决定把它压到每帧 6–30 次 drawImage：

1. **47-blob autotile**：变体在烘焙期算一次，运行期只查 `Uint8Array(256)`。
2. **32×32 tile quadrant 烘焙**：可见 3600 格 → 12 次 drawImage；挖一格只重画 3×3 = 9 格（< 0.05 ms）。
3. **每格 1 像素 lightmap**：光照 BFS 在 chunk 级脏区跑，绘制时放大 16× 靠双线性得平滑渐变。

## 热路径零分配清单

- tile 数据全 TypedArray（`Uint16Array` / `Uint8Array`），禁止 `{x,y}` 对象数组。
- 粒子/掉落/实体用**对象池**，禁止每帧 `new`。
- 光照 BFS 用预分配的 `Int32Array` 环形队列。
- 禁止每帧闭包、字符串拼接、`map/filter` 产生临时数组。
- quadrant 离屏 canvas **池化复用**，永不 `new`（iOS 累计 canvas 约 256 MB 上限，超了静默白屏）。

## 移动端专项

- `canvas.width = round(cssW * min(devicePixelRatio, 2))`，CSS 尺寸单独设。
- 像素风只走整数 zoom（1/2），`imageSmoothingEnabled = false`。
- `visibilitychange` / `pagehide` / Cordova `pause`：取消 rAF、暂停音频、flush 存档；
  恢复时 `dt = min(dt, 0.1)` 防时间跳变。
- 数据文件不 fetch（Cordova `file://` 下 CORS 会拦），内联成 `.js`。
