# TILESANDBOX

2.5D 无缝大世界沙盒。**79200 × 12800 像素**的连续世界由 16 px tile 拼接（4950 × 800 = 3,960,000 格），
玩家挖开地表、向下探索洞穴与矿脉、回到地面建造与耕种。

一份代码，三端运行：

| 端 | 形态 |
|---|---|
| PC 浏览器 | GitHub Pages 静态站（键盘 + 鼠标） |
| 手机浏览器 | 同一个静态站（虚拟摇杆 + 触摸挖掘，锁横屏） |
| 安卓 APK | Cordova 壳打包同一份 `www/`，由 GitHub Actions 构建 |

## 本地跑起来

```bash
node tests/run.js        # 逻辑层自测（32 项，含世界生成确定性）
node tools/serve.js      # http://localhost:8080  ?seed=1234 可换种子
```

无 node 在 PATH 时，用已解压的二进制绝对路径调用（本机实测路径见下）。

## 操作

| 端 | 操作 |
|---|---|
| PC | `A/D` 移动 · `空格` 跳 · 鼠标左键按住挖 · 右键放 · `1-9` 热栏 · `E` 合成 |
| 手机 | 左半屏摇杆 · 右半屏按住挖 · 按钮：跳 / 放置 / 合成 |

## 架构要点

- **世界数据全驻留**（`Uint16Array` ×2 + `Uint8Array` ×2，约 24 MB），**渲染面 LRU**
  （32×32 tile 的 quadrant 离屏 canvas，PC 64 块 / 手机 16 块）。
- **存储 chunk 64×64 tile**，**渲染 quadrant 32×32 tile**，1 chunk = 4 quadrant。
- **确定性生成**：禁用 `Math.random`，噪声 = `f(seed, 绝对 tile 坐标)`，同种子任何设备逐字节一致。
- **零外部素材**：16 px tile 图集在启动时由 Canvas 程序化绘制，仓库内没有第三方图片/字体/音频。
- **免构建**：原生 ES modules，`www/` 是物理复制产物，数据内联在 `src/data.js`（Cordova `file://` 下
  fetch JSON 会被 CORS 拦）。

细节见 `docs/architecture/architecture.md`（含 ADR-0001…0007）、`docs/architecture/performance-budget.md`、
`design/gdd/systems.md`、`design/art-bible.md`、`design/ux/hud-and-input.md`。

## 出包

```powershell
# 本地生成 www/ 并同步到 cordova/www/
powershell -File tools\prepare-www.ps1
```

- **Pages**：push 到 `main` → `.github/workflows/pages.yml` 部署 `www/`。
- **APK**：改 `src/` 或 `cordova/config.xml` → `.github/workflows/apk.yml` 产出 `tilesandbox-apk`
  （debug 一定有；配了 `KEYSTORE_BASE64` 等 secrets 才额外出签名 release）。

## 当前进度

**M1（已完成）**：世界生成（地表/土/石/基岩 + 洞穴 + 矿脉 + 树）、chunk 流式生成、玩家物理与
tile 碰撞、挖掘与掉落、放置、9 格热栏与合成、昼夜循环与配色、火把光照与 lightmap、
IndexedDB 存档（只存改过的 chunk）、键盘与触控输入、HUD。

**M2（已完成）**：饥饿与 starvation 后果、夜晚刷怪（亮度/距离/密度上限）、战斗（伤害公式、
击退、攻击冷却）、怪物 AI 与死亡惩罚（掉一半背包、10s 复活）、掉落粒子、像素小人与怪物精灵、
视差云与山、autotile 对角全覆盖、**13 条配方数据库 + 材料试算工具**、
**内置聊天（文字/拍照/录像/录音/图片/分享背包物品与坐标）**。

**未实现（M3）**：作物、养殖、货币与 NPC、洞穴结构与宝箱、第二 biome。
**待定**：多人联机（需要服务端，见 `production/epics/EPIC-M2.md` 的三方案对比）。

## 材料试算

```bash
node tools/craft-calc.mjs --all                         # 全部配方 → 原材料 + 总耗时
node tools/craft-calc.mjs bread 2                       # 造 2 个面包要什么
node tools/craft-calc.mjs iron_pick --inv wood=20,iron_ore=6   # 对照库存看缺料
```

## 聊天与多人

面板按 `C`（手机点"聊"）：发文字、拍照（截当前画面）、录像（canvas 录 6 秒）、录音、
选设备图片、分享背包物品、分享坐标。消息存 IndexedDB，重启可看历史。

**当前是离线单机版**：静态站与 APK 里没有服务端，两部手机不会互通。`MessageBus` 留了
`attachRemote({ send, onMessage })` 接口，接一个 WebSocket 即可变多人——接哪家由你定，
我不擅自引入第三方云服务。

## 许可

代码 MIT。视觉全部程序化生成，不含第三方素材。
