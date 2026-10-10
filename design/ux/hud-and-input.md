# TILESANDBOX UX 规格：输入与 HUD（三端）

## 1. 输入抽象层

键盘 / 触控 /（未来手柄）统一成 **intent**，玩法层只认 intent，不认设备：

```
moveX (-1..1)   jump(pressed)   dig(held, targetTile)   place(targetTile)
hotbar[0..8]    openCraft       pause
```

## 2. PC（键盘 + 鼠标）

| 操作 | 键位 |
|---|---|
| 移动 | `A/D` 或 `←/→` |
| 跳跃 | `Space` / `W` |
| 挖掘 | 按住鼠标左键（对准的 tile） |
| 放置 | 鼠标右键 |
| 热栏 | `1`–`9`，滚轮切换 |
| 合成 | `E` |
| 暂停/菜单 | `Esc` |
| 缩放 | `-` / `=`，`0` 复位 |

光标高亮目标 tile（1 px 描边 + 半透明遮罩），挖掘时显示进度环。

## 3. 手机（触控）

- **虚拟摇杆**：底座 R=56 dp、拇指 R=24 dp、死区 8 dp；圆心 `(24 + safeL) dp, (H - 120 - safeB) dp`。
- **右侧按钮**：主按钮（跳跃/挖掘）直径 64 dp，右边缘距 `24 + safeR` dp、下边缘距 `24 + safeB` dp；
  次按钮（放置/合成）在主按钮左/上 80 dp；命中区 ≥ 48 dp。
- **挖掘方式**：按住屏幕对准点即持续挖掘（无需摇杆配合）；放置走独立按钮 + 对准点。
- **方向**：锁横屏（`Orientation=landscape`），竖屏显示"请旋转设备"浮层并暂停主循环。
- **viewport**：`width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover`；
  `body{overscroll-behavior:none;touch-action:none;-webkit-tap-highlight-color:transparent}`，canvas `position:fixed;inset:0`。
- **安全区**：HUD 四边 `padding: env(safe-area-inset-*)`，无 inset 时兜底 12 dp。
- 用 `pointerdown/up`，只在需要处 `addEventListener(..., {passive:false})`，避免 300 ms 延迟与滚动冲突。

## 4. HUD 布局

| 元素 | 位置 | 说明 |
|---|---|---|
| 热栏 9 格 | 底部居中（PC）/ 左下上方（手机，避开摇杆） | 56×56 dp，选中格 +2 px 描边与缩放 1.05 |
| 生命 / 饥饿 | 左上 | 条状 + 数值，饥饿 M2 才启用 |
| 时间钟 | 右上 | 游戏内小时 + 昼夜图标 |
| 合成面板 | 居中弹层 | 分组：可合成（亮）/ 缺料（灰 + 缺什么） |
| 提示条 | 底部上方 | "需要石镐" / "背包已满"，2 s 淡出 |

HUD 是 DOM + CSS 独立合成层，只在数据变化时脏重绘，不参与 canvas 每帧绘制。

## 5. 反馈

- 挖掘：裂纹叠加（4 阶段）+ 每 0.15 s 一次粒子 + 破碎时 6 粒碎屑。
- 放置：0.1 s 缩放弹入（1.0 → 1.15 → 1.0）。
- 受伤：屏幕边缘红色渐晕 + 0.1 s 抖动（M2）。
- 可点击元素涟漪与按压缩放（M3 UI 规范）。

## 6. 无障碍与设置

- 设置项：音效音量、画面缩放（1×/2×）、摇杆位置（左/右）、震动反馈开关。
- 色盲友好：矿物用形状差异（点/条/十字/菱形）而不只靠颜色。
- 全部文本集中在一个 `strings.js`，为后续本地化留口子。
