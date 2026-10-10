# M1 证据记录（2026-10-10）

原则：**证据优先于感觉**。每条验收判据给出 PASS / FAIL / NOT ASSESSED，并注明证据位置。
「解析通过」「无异常」不等于「看起来是对的」——没有观察到的画面一律记 NOT ASSESSED，不伪造结论。

## 环境

- 本机 Windows + PowerShell 5.1，`node` 不在 PATH，用已解压的
  `C:\Users\沈\.workbuddy\binaries\node\versions\20.18.0.installing.24528.__extract_temp__\node-v20.18.0-win-x64\node.exe`
- 无浏览器自动化工具（无 Playwright/Puppeteer），**没有截图能力**。

## 已执行的证据

| 命令 | 结果 | 证据 |
|---|---|---|
| `node tests/run.js` | **32 passed, 0 failed** | 见下「判据表」与本报告末尾的原始输出摘要 |
| `node tools/smoke.mjs 120` | SMOKE PASS，120 帧无运行时异常 | 无头 DOM 桩实跑主循环 + 放置/挖掘/合成/存档 API |
| `node --check src/*.js` | 8 个文件语法全通过 | — |
| 静态引用检查 | 7 个模块的 import/export 与 `main.js` 取的 DOM id 全部可解析 | 临时脚本，已删 |
| `node tools/serve.js 8123` + HTTP GET | `/`、`/src/main.js`、`/src/core.js` 均 200 | 服务器仍在 8123 端口运行 |

## 判据表（`design/gdd/systems.md` 第 7 节 A1–A7）

| # | 判据 | 结论 | 证据 / 说明 |
|---|---|---|---|
| A1 | 空手挖泥土 0.5±0.1 s 破碎并掉 1 块入包；木镐挖石 2.22±0.05 s；木镐点铁矿提示等级不够 | **PASS** | 单测 `[7]`：dirt/hand=0.500s、stone/wood=2.222s、iron/wood=Infinity、bedrock=Infinity；冒烟实测挖草（同 H=0.5）0.52 s，`+1 fiber` |
| A2 | 有 5 块石头可连续放 5 格、各扣 1，放完可站在其上不穿透 | **PARTIAL** | 冒烟：放置写入 `tile=3` PASS；「连续 5 格各扣 1」与「站立不穿透」未观察 → NOT ASSESSED（无浏览器） |
| A3 | 60fps 跑 30 s 无卡顿（p95 < 20 ms），跨 chunk 无接缝与空洞 | **NOT ASSESSED** | 无头跑 120 帧无异常（wall=134 ms，含启动），但这既不是真帧率也不是真画面。需实机观察 |
| A4 | 20 min 完成一次日出→日落，≥3 档可辨；火把周围 6 tile 亮度 ≥0.25 | **NOT ASSESSED** | 昼夜与光照逻辑已落盘（`render.js` `skyAt` / `world.js` `refreshLight`），`sunLight` 单测通过；画面未观察 |
| A5 | 10 木材 0.5 s 产出木镐并扣料；不足时禁用且不扣料 | **PASS** | 冒烟：`craft wood_pick -> ok`；缺料分支走 `toast` 且不扣料（代码路径，`game.craft`） |
| A6 | 退出重进后坐标、背包、已改 tile 完全一致 | **PARTIAL** | `save()` 产出 1 个 dirty chunk + 4 个物品栈 PASS；`load()` 在无 IndexedDB 的 node 环境跑不到 → NOT ASSESSED，需浏览器实机 |
| A7 | 同 seed 两次生成 3×3 chunk 逐字节一致 | **PASS** | 单测 `[4]`：同 seed 同 chunk 全部 4096 格一致，不同 seed 有差异 |

## 关键实测数字

```
[4]  same seed -> identical chunk                       (A7)
[7]  dirt / hand = 0.500s | stone / wood = 2.222s | iron / wood = Infinity
[smoke] chunks generated=9  quad cache=4
[smoke] player 39600,2176 -> 39600,2196  onGround=true
[smoke] place 2475,135 -> tile=3
[smoke] dig 2475,139 (grass) -> 0 in 0.52s, +1 fiber
[smoke] save -> 1 dirty chunk(s), 4 item stacks
```

## 明确未做的事情（不要当成已完成）

1. **没有观察到任何一帧画面。** 所有视觉结论（配色、tile 拼接、昼夜观感、光照渐变、移动端布局）都是
   NOT ASSESSED。
2. **没有在真机/模拟器上跑过 APK**，也没有建 GitHub 仓库（推送需用户授权）。
3. **移动端触控路径**（摇杆/按钮/安全区）只在代码里存在，未在任何设备上碰过。
4. 矿石挖掘偏慢（铁矿/铁镐 7.9 s）是已知不平衡，故意留到 M2 调。

## 怎么自己看一眼（30 秒）

```
node tools/serve.js 8123        # 或直接用已运行的实例
浏览器打开 http://localhost:8123/          ?seed=1234 换种子
A/D 移动 · 空格跳 · 左键按住挖 · 右键放 · 1-9 热栏 · E 合成
```

看到画面后请把截图放进 `production/qa/evidence/`，并把上面 NOT ASSESSED 的项补成 PASS / FAIL。
