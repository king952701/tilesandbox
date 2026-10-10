# M2 证据记录（2026-10-10）

原则同 M1：**没有观察到的画面一律 NOT ASSESSED，不伪造结论**。

## 已执行

| 命令 | 结果 |
|---|---|
| `node tests/run.js` | **56 passed, 0 failed**（M1 32 项 + M2 24 项） |
| `node tools/smoke.mjs 120` | SMOKE PASS，120 帧 + 放置/挖掘/合成/存档/战斗/饥饿/死亡全流程无异常 |
| `node tools/craft-calc.mjs --all` | 13 条配方全部展开成原材料与耗时 |
| `node tools/craft-calc.mjs iron_pick --inv wood=20,iron_ore=6` | 缺料判定正确（缺铁矿 4） |
| `node --check src/*.js` | 10 个文件语法通过 |

## 关键实测输出

```
[9]  idle 2.0 / walk 3.0 / work 5.0 per hour
     one work hour costs 5 hunger — 95.00
     starving costs 1 HP/s — hp=49
     well fed regenerates +1 HP / 5s — hp=51
[10] dark + 24..64 tiles at night -> spawn | bright/too close/too far/daytime/cap -> blocked
[11] dmg = atk - def, min 1 | wood sword 10 / iron sword 25 / hand 2
[12] half of every stack is kept — stone=5 wood=2 | respawn hp=50 hunger=50 delay=10
[13] 13 recipes, T0..T3 all used, no recipe crafts a raw material

[smoke] place 2475,135 -> tile=3
[smoke] dig 2475,139 (grass) -> 0 in 0.52s, +1 fiber
[smoke] craft wood_pick -> ok
[smoke] save -> 1 dirty chunk(s), 4 item stacks
[smoke] combat: slime 20hp -> dead after 24 swings
[smoke] starving: hp 94.0 -> 93.0
[smoke] death: dead=true -> respawned=true hp=50 hunger=49.9
```

配方试算（节选）：`面包 = 小麦×6 / 3.5s`、`箱子 = 木材×25 + 纤维×10 / 2.5s`、`熟肉 = 生肉×1 + 煤矿×1 / 2.0s`。

## 本次修掉的真问题（不是走过场）

1. `ctx.ellipse` 在冒烟桩里缺失 → 云层绘制抛错 → **整个启动流程中断**（玩家停在 0,0、chunk 未生成）。
   这不是桩的问题暴露得早，而是说明云层代码真的会被执行；桩补齐后启动正常。
2. 战斗测试里怪物被击退跑出攻击距离，24 次挥砍才打死 → 击退力度（`dmg × 0.8 × 6`）相对攻击范围
   （28 px）偏大，实战手感会"打一下退三步"。**留给 M2 手感调优**，先记录不擅自改数值。
3. `damageOf` 定义在 `data.js`，`systems.js` 只是使用 → 测试 import 错文件报
   `does not provide an export named 'damageOf'`，已改为从 `data.js` 导入。

## 仍未观察（NOT ASSESSED）

- 任何一帧画面：昼夜三档配色、云与山的视差、像素小人、怪物精灵、粒子、autotile 拼接效果。
- 手机端：摇杆、攻击/聊天按钮位置、安全区、横屏提示。
- 聊天面板的媒体功能：`MediaRecorder` / `canvas.captureStream` / 麦克风权限在真机 Cordova WebView
  上的可用性（Android WebView 各版本差异大，代码里做了能力检测并降级提示，但没在设备上跑过）。
- 存档 `load()` 路径（node 无 IndexedDB）与跨会话持久化。

## 自己看一眼

```
node tools/serve.js 8123      # 或直接用已运行的实例
浏览器打开 http://localhost:8123/
A/D 移动 · 空格跳 · 左键挖 · 右键放 · F 攻击 · R 吃 · E 合成 · C 聊天
```
