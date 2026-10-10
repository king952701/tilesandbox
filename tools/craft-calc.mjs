// tools/craft-calc.mjs — 材料组合试算：把目标物品展开成原材料清单与总耗时
// 用法：
//   node tools/craft-calc.mjs --all                 列出全部配方的原材料试算
//   node tools/craft-calc.mjs bread 2               造 2 个面包需要什么
//   node tools/craft-calc.mjs iron_pick --inv wood=20,iron_ore=6   对照库存看缺料
import { RECIPES, ITEMS, RAW_MATERIALS } from '../src/data.js';

const nameOf = (id) => (ITEMS[id] ? ITEMS[id].name : id);
const byOutput = new Map();
for (const r of RECIPES) {
  const out = r.outputs[0];
  if (!byOutput.has(out.item)) byOutput.set(out.item, r);
}

/** expand a target into raw materials and crafting steps */
export function plan(itemId, count = 1, seen = new Set()) {
  const recipe = byOutput.get(itemId);
  const raw = new Map();
  const steps = [];
  let time = 0;
  if (!recipe || RAW_MATERIALS.has(itemId)) { raw.set(itemId, count); return { raw, steps, time }; }
  if (seen.has(itemId)) return { raw, steps, time, cycle: true };
  seen.add(itemId);

  const outCount = recipe.outputs[0].count || 1;
  const runs = Math.ceil(count / outCount);
  time += recipe.time * runs;
  steps.push({ id: recipe.id, station: recipe.station, runs, time: recipe.time * runs, out: `${nameOf(itemId)} ×${runs * outCount}` });
  for (const inp of recipe.inputs) {
    const sub = plan(inp.item, inp.count * runs, new Set(seen));
    for (const [k, v] of sub.raw) raw.set(k, (raw.get(k) || 0) + v);
    for (const s of sub.steps) steps.push(s);
    time += sub.time;
  }
  return { raw, steps, time };
}

function fmt(map) { return [...map].map(([k, v]) => `${nameOf(k)}×${v}`).join(' + ') || '(无需材料)'; }

const args = process.argv.slice(2);
const invArg = args.indexOf('--inv');
const inv = new Map();
if (invArg >= 0) {
  for (const pair of (args[invArg + 1] || '').split(',')) {
    const [k, v] = pair.split('=');
    if (k && v) inv.set(k, Number(v));
  }
  args.splice(invArg, 2);
}

if (args[0] === '--all' || args.length === 0) {
  console.log('\n配方数据库试算（目标 → 原材料 → 台面 → 总耗时）\n');
  console.log('目标'.padEnd(12) + '台面'.padEnd(6) + '耗时'.padEnd(8) + '原材料展开');
  console.log('-'.repeat(78));
  for (const r of RECIPES) {
    const out = r.outputs[0];
    const p = plan(out.item, out.count);
    console.log(
      nameOf(out.item).padEnd(12 - (nameOf(out.item).length - [...nameOf(out.item)].length)) +
      r.station.padEnd(6) + (p.time.toFixed(2) + 's').padEnd(8) + fmt(p.raw),
    );
  }
  console.log(`\n共 ${RECIPES.length} 条配方，原材料 ${RAW_MATERIALS.size} 种（挖掘获得，不可合成）\n`);
} else {
  const target = args[0];
  const count = Number(args[1] || 1);
  if (!ITEMS[target]) { console.log(`未知物品：${target}`); process.exit(1); }
  const p = plan(target, count);
  console.log(`\n目标：${nameOf(target)} ×${count}`);
  if (!byOutput.has(target)) { console.log('这是原材料，挖就行，不需要合成\n'); process.exit(0); }
  console.log(`原材料：${fmt(p.raw)}`);
  console.log(`总耗时：${p.time.toFixed(2)}s（逐级累加）`);
  console.log(`步骤：`);
  for (const s of p.steps) console.log(`  [${s.station}] ${s.id} ×${s.runs} → ${s.out}  ${s.time.toFixed(2)}s`);
  if (inv.size) {
    const missing = [];
    for (const [k, v] of p.raw) {
      const have = inv.get(k) || 0;
      if (have < v) missing.push(`${nameOf(k)} 缺 ${v - have}（有 ${have}）`);
    }
    console.log(missing.length ? `缺料：${missing.join('；')}` : '库存充足，可以直接开工');
  }
  console.log('');
}
