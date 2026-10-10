// tests/run.js — 逻辑层自测（无 DOM，node 20+ 运行：node tests/run.js）
import { World, TILE, WTX, WTY, CH, CHX, CHY, STRIDE, ROWS, LEN, idx, chunkIdOf, inWorld, fbm, vnoise, hash01 } from '../src/core.js';
import { TILES, TOOLS, ITEMS, digTime, ORES, HUNGER, COMBAT, MOBS, SPAWN, DEATH, RECIPES, RAW_MATERIALS, HOUR_SECONDS, damageOf } from '../src/data.js';
import { generateChunk, sunLight } from '../src/world.js';
import { Hunger, canSpawnAt, attackDamage, deathPenalty, respawnState, isNight } from '../src/systems.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

console.log('\n[1] constants');
ok('tile grid 4950x800', WTX === 4950 && WTY === 800, `${WTX}x${WTY}`);
ok('chunk grid 78x13', CHX === 78 && CHY === 13, `${CHX}x${CHY} = ${CHX * CHY} chunks`);
ok('stride/rows padding', STRIDE === 4992 && ROWS === 832, `${STRIDE}x${ROWS}`);
ok('world length', LEN === 4153344, `${LEN} cells`);
ok('memory footprint ~24MB', Math.abs(LEN * 6 / 1048576 - 23.8) < 1, `${(LEN * 6 / 1048576).toFixed(1)} MB`);

console.log('\n[2] index round-trip');
{
  const tx = 3711, ty = 613, i = idx(tx, ty);
  ok('idx -> tx,ty', ((i / STRIDE) | 0) === ty && (i % STRIDE) === tx);
  const cx = tx >> 6, cy = ty >> 6, cid = chunkIdOf(cx, cy);
  ok('chunk id -> cx,cy', (cid % CHX) === cx && ((cid / CHX) | 0) === cy, `cid=${cid}`);
  ok('inWorld bounds', inWorld(0, 0) && inWorld(4949, 799) && !inWorld(-1, 0) && !inWorld(4950, 0));
}

console.log('\n[3] deterministic noise');
{
  const a = fbm(1234, 100, 50, 4, 1 / 512), b = fbm(1234, 100, 50, 4, 1 / 512);
  const c = fbm(9999, 100, 50, 4, 1 / 512);
  ok('same seed -> same value', a === b, `${a.toFixed(6)}`);
  ok('different seed -> different value', a !== c);
  ok('value noise in [0,1]', vnoise(7, 3.3, 9.9) >= 0 && vnoise(7, 3.3, 9.9) <= 1);
  ok('hash01 in [0,1)', hash01(5, -3, -7) >= 0 && hash01(5, -3, -7) < 1);
}

console.log('\n[4] world generation is reproducible (A7)');
{
  const w1 = new World(20250101), w2 = new World(20250101), w3 = new World(777);
  generateChunk(w1, 38, 3); generateChunk(w2, 38, 3); generateChunk(w3, 38, 3);
  let same = true, differs = false;
  for (let ly = 0; ly < CH; ly++) {
    for (let lx = 0; lx < CH; lx++) {
      const tx = 38 * CH + lx, ty = 3 * CH + ly;
      const i = idx(tx, ty);
      if (w1.tileId[i] !== w2.tileId[i]) same = false;
      if (w1.tileId[i] !== w3.tileId[i]) differs = true;
    }
  }
  ok('same seed -> identical chunk', same);
  ok('different seed -> different chunk', differs);
}

console.log('\n[5] strata');
{
  const w = new World(20250101);
  for (let cy = 1; cy <= 12; cy++) generateChunk(w, 31, cy);   // cover surface -> bedrock
  const tx = 2000, sy = w.surfaceY(tx);
  ok('surface is grass', w.get(tx, sy) === 1, `surfaceY=${sy}`);
  ok('above surface is air', w.get(tx, sy - 3) === 0);
  ok('soil layer below', w.get(tx, sy + 3) === 2 || w.get(tx, sy + 3) === 0);
  let stone = 0, bedrock = 0;
  for (let ty = sy + 30; ty < sy + 60; ty++) {
    const id = w.get(tx, ty);
    if (id === 3 || id === 6 || id === 7 || id === 8 || id === 9) stone++;
  }
  for (let ty = WTY - 30; ty < WTY; ty++) if (w.get(tx, ty) === 10) bedrock++;
  ok('stone present below soil', stone > 5, `${stone} stone cells`);
  ok('bedrock in last 40 rows', bedrock > 5, `${bedrock} bedrock cells`);
}

console.log('\n[6] ore depth bands');
{
  const w = new World(4242);
  let checked = 0, outOfBand = 0;
  for (let cx = 20; cx < 26; cx++) {
    generateChunk(w, cx, 4);
    for (let tx = cx * CH; tx < cx * CH + CH; tx += 3) {
      for (let ty = 4 * CH; ty < 5 * CH; ty += 3) {
        const id = w.get(tx, ty);
        if (![6, 7, 8, 9].includes(id)) continue;
        checked++;
        const o = ORES.find((x) => x.id === id);
        if (ty < o.yMin || ty > o.yMax) outOfBand++;
      }
    }
  }
  ok('every ore sits in its band', outOfBand === 0, `${checked} ore cells checked, ${outOfBand} misplaced`);
}

console.log('\n[7] dig time formula (data.js <-> gdd/systems.md)');
{
  const dirt = TILES[2], stone = TILES[3], iron = TILES[7], bedrock = TILES[10];
  const t1 = digTime(dirt, TOOLS.hand);
  ok('dirt / hand = 0.50s', near(t1, 0.5, 0.01), `${t1.toFixed(3)}s`);
  const t2 = digTime(stone, TOOLS.wood_pick);
  ok('stone / wood pick = 2.22s', near(t2, 2.22, 0.02), `${t2.toFixed(3)}s`);
  const t3 = digTime(stone, TOOLS.stone_pick);
  ok('stone / stone pick = 1.07s', near(t3, 1.07, 0.02), `${t3.toFixed(3)}s`);
  ok('iron ore / wood pick is blocked (tier)', digTime(iron, TOOLS.wood_pick) === Infinity);
  ok('bedrock never diggable', digTime(bedrock, TOOLS.iron_pick) === Infinity);
  console.log(`  note  iron ore / iron pick = ${digTime(iron, TOOLS.iron_pick).toFixed(2)}s (M2 balance target ~2s)`);
}

console.log('\n[8] edit, dirty tracking, light');
{
  const w = new World(20250101);
  generateChunk(w, 30, 2);
  const tx = 30 * CH + 10, ty = 2 * CH + 10;
  w.set(tx, ty, 3);
  ok('set writes the tile', w.get(tx, ty) === 3);
  w.set(tx, ty, 0);
  ok('set clears the tile', w.get(tx, ty) === 0);
  ok('modified chunk recorded', w.modifiedChunks.has(chunkIdOf(30, 2)));
  ok('quadrant marked dirty', w.dirtyQuads.size >= 1, `${w.dirtyQuads.size} quads`);
  ok('out of bounds write rejected', w.set(-1, 0, 3) === false);
  const sy = w.surfaceY(tx);
  ok('sunlight full above surface', sunLight(w, tx, sy - 5) === 255);
  ok('sunlight zero deep down', sunLight(w, tx, sy + 40) === 0);
}

console.log('\n[9] hunger (M2)');
{
  const drain = (a) => (HUNGER.drainPerHour[a] / HOUR_SECONDS) * HOUR_SECONDS;
  ok('idle 2.0 / walk 3.0 / work 5.0 per hour', drain('idle') === 2 && drain('walk') === 3 && drain('work') === 5);
  const h = new Hunger(100);
  const p = { hp: 50 };
  h.update(HOUR_SECONDS, 'work', p, null);
  ok('one work hour costs 5 hunger', near(h.value, 95, 0.001), `${h.value.toFixed(2)}`);
  h.eat('bread');
  ok('bread restores 40', near(h.value, 100, 0.001), `${h.value.toFixed(2)} (capped at max)`);
  const h2 = new Hunger(0), p2 = { hp: 50 };
  h2.update(1, 'idle', p2, null);
  ok('starving costs 1 HP/s', near(p2.hp, 49, 0.001), `hp=${p2.hp}`);
  const h3 = new Hunger(100), p3 = { hp: 50 };
  for (let i = 0; i < 5; i++) h3.update(1, 'idle', p3, null);
  ok('well fed regenerates +1 HP / 5s', p3.hp === 51, `hp=${p3.hp}`);
}

console.log('\n[10] spawn director (M2)');
{
  const base = { light: 10, distTiles: 40, night: true, isCave: false, count: 0, cap: 8 };
  ok('dark + 24..64 tiles at night -> spawn', canSpawnAt(base));
  ok('bright tile blocks spawn', !canSpawnAt({ ...base, light: 200 }));
  ok('too close blocks spawn', !canSpawnAt({ ...base, distTiles: 10 }));
  ok('too far blocks spawn', !canSpawnAt({ ...base, distTiles: 90 }));
  ok('daytime blocks spawn', !canSpawnAt({ ...base, night: false }));
  ok('cap reached blocks spawn', !canSpawnAt({ ...base, count: 8 }));
  ok('night window is 18:00-06:00', isNight(19 * HOUR_SECONDS) && isNight(2 * HOUR_SECONDS) && !isNight(12 * HOUR_SECONDS));
}

console.log('\n[11] combat (M2)');
{
  ok('dmg = atk - def, min 1', damageOf(25, 2) === 23 && damageOf(10, 2) === 8 && damageOf(2, 10) === 1);
  ok('wood sword 10 / iron sword 25 / hand 2', attackDamage('wood_sword') === 10 && attackDamage('iron_sword') === 25 && attackDamage('hand') === 2);
  ok('mob stats exist', MOBS.slime.hp === 20 && MOBS.bat.hp === 30 && MOBS.zombie.hp === 60);
  ok('knockback scales with damage', COMBAT.knockbackPerDmg === 0.8);
}

console.log('\n[12] death penalty (M2)');
{
  const inv = new Map([['stone', 10], ['wood', 5], ['torch', 1]]);
  const r = deathPenalty(inv, 100);
  ok('half of every stack is kept', r.kept.get('stone') === 5 && r.kept.get('wood') === 2, `stone=${r.kept.get('stone')} wood=${r.kept.get('wood')}`);
  ok('stacks of 1 are lost', !r.kept.has('torch'));
  ok('half the currency is lost', r.currencyLost === 50);
  const s = respawnState();
  ok('respawn: 50% hp, 50% hunger, 10s delay', s.hp === 50 && s.hunger === 50 && s.delay === 10);
}

console.log('\n[13] crafting database');
{
  ok('13 recipes, unique ids', RECIPES.length === 13 && new Set(RECIPES.map((r) => r.id)).size === 13);
  const unknown = RECIPES.flatMap((r) => [...r.inputs, ...r.outputs]).filter((io) => !ITEMS[io.item]);
  ok('every recipe item exists in ITEMS', unknown.length === 0, unknown.map((u) => u.item).join(',') || 'none');
  const rawLeak = RECIPES.filter((r) => RAW_MATERIALS.has(r.outputs[0].item));
  ok('no recipe crafts a raw material', rawLeak.length === 0);
  const stations = new Set(RECIPES.map((r) => r.station));
  ok('stations T0..T3 all used', ['T0', 'T1', 'T2', 'T3'].every((s) => stations.has(s)), [...stations].join(','));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
