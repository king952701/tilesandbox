// tools/smoke.mjs — headless smoke run: stub the DOM, boot main.js, drive N frames.
// It cannot verify how the game LOOKS; it verifies the frame loop does not throw and that
// world/player/inventory state actually advances. Run: node tools/smoke.mjs [frames]
import { TILES } from '../src/data.js';
import { makeMob } from '../src/systems.js';

const FRAMES = Number(process.argv[2] || 120);
const TILE_NAME = Object.fromEntries(TILES.map((t) => [t.id, t.name]));
const TILE_DROP = Object.fromEntries(TILES.map((t) => [t.id, t.drop]));

function ctxStub() {
  const noop = () => {};
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', imageSmoothingEnabled: false,
    fillRect: noop, clearRect: noop, strokeRect: noop, drawImage: noop,
    save: noop, restore: noop, scale: noop, setTransform: noop, translate: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, fill: noop, stroke: noop,
    ellipse: noop, arc: noop, rect: noop, quadraticCurveTo: noop, bezierCurveTo: noop, arcTo: noop,
    fillText: noop, strokeText: noop, measureText: () => ({ width: 0 }),
    createPattern: () => ({}), clip: noop, isPointInPath: () => false,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: noop, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
}
function canvasStub() {
  return {
    width: 0, height: 0, style: {},
    getContext: () => ctxStub(),
    addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  };
}
function elStub(id) {
  return {
    id, textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {} },
    addEventListener: () => {}, querySelectorAll: () => [], appendChild: () => {},
  };
}

let now = 0;
const rafQueue = [];
const errors = [];

globalThis.performance = { now: () => now };
globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.navigator = { userAgent: 'node-smoke' };
globalThis.location = { search: '' };
globalThis.addEventListener = () => {};
globalThis.window = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2,
  addEventListener: () => {}, __tsDebug: false,
};
globalThis.document = {
  hidden: false,
  createElement: (tag) => (tag === 'canvas' ? canvasStub() : elStub(tag)),
  getElementById: (id) => (id === 'game' ? canvasStub() : elStub(id)),
  querySelector: () => elStub('q'),
  addEventListener: () => {}, querySelectorAll: () => [],
};
process.on('uncaughtException', (e) => errors.push('uncaught: ' + e.message));
process.on('unhandledRejection', (e) => errors.push('rejection: ' + (e && e.message)));

const t0 = Date.now();
await import('../src/main.js');
await new Promise((r) => setImmediate(r));          // let the async boot() settle

const ts = globalThis.window.__ts || globalThis.__ts;
if (!ts) { console.log('SMOKE FAIL: main.js did not expose window.__ts'); process.exit(1); }

const p0 = { x: ts.game.player.x, y: ts.game.player.y };
for (let i = 0; i < FRAMES; i++) {
  const cb = rafQueue.shift();
  if (!cb) break;
  now += 16.7;
  try { cb(now); } catch (e) { errors.push(`frame ${i}: ${e.message}`); break; }
}
const ms = Date.now() - t0;

const { world, game, renderer } = ts;
let generated = 0;
for (let i = 0; i < world.generated.length; i++) if (world.generated[i]) generated++;

console.log(`\n[smoke] frames=${FRAMES} wall=${ms}ms`);
console.log(`[smoke] seed=${ts.SEED} chunks generated=${generated} quad cache=${renderer.cache.size}`);
console.log(`[smoke] player ${p0.x.toFixed(1)},${p0.y.toFixed(1)} -> ${game.player.x.toFixed(1)},${game.player.y.toFixed(1)} onGround=${game.player.onGround}`);
console.log(`[smoke] clock=${(game.seconds / 50).toFixed(2)}h inventory=${[...game.inv].map(([k, v]) => k + ':' + v).join(', ') || '(empty)'}`);

// exercise gameplay APIs the loop itself never touches
try {
  const px = Math.floor(game.player.x / 16);

  // place: find an air cell above the player
  game.addInv('stone', 5);
  game.sel = game.hotbar.indexOf('stone');
  let ty = Math.floor(game.player.y / 16) - 2;
  while (ty > 0 && world.get(px, ty) !== 0) ty--;
  game.aim(px * 16 + 8, ty * 16 + 8);
  game.intent.place = true;
  game.update(0.016);
  const placed = world.get(px, ty);
  console.log(`[smoke] place at ${px},${ty} -> tile=${placed} (expect 3)`);
  if (placed !== 3) errors.push('placement did not write the tile');

  // dig: hold on a solid cell below the player and count the seconds
  let dy = Math.floor(game.player.y / 16) + 2;
  while (dy < 799 && world.get(px, dy) === 0) dy++;
  const targetId = world.get(px, dy);
  const invBefore = game.inv.get(TILE_DROP[targetId]) || 0;
  game.aim(px * 16 + 8, dy * 16 + 8);
  game.intent.dig = true;
  let secs = 0;
  while (secs < 6 && world.get(px, dy) !== 0) { game.update(1 / 60); secs += 1 / 60; }
  game.intent.dig = false;
  const after = world.get(px, dy);
  const gained = (game.inv.get(TILE_DROP[targetId]) || 0) - invBefore;
  console.log(`[smoke] dig ${px},${dy} (id=${targetId} ${TILE_NAME[targetId]}) -> ${after} in ${secs.toFixed(2)}s, +${gained} ${TILE_DROP[targetId] || '(no drop)'}`);
  if (after !== 0) errors.push('digging did not break the tile');

  game.craft('wood_pick');
  game.update(1.0);
  console.log(`[smoke] craft wood_pick -> ${game.inv.get('wood_pick') ? 'ok' : 'FAILED'}`);
  if (!game.inv.get('wood_pick')) errors.push('crafting produced nothing');

  const saved = await game.save();
  console.log(`[smoke] save -> ${saved.chunks.length} dirty chunk(s), ${saved.player.inv.length} item stacks`);
  if (saved.chunks.length === 0) errors.push('save produced no dirty chunks despite edits');

  // M2: fight a mob
  const mob = makeMob('slime', game.player.x + 10, game.player.y, false);
  game.mobs.push(mob);
  const mobHp0 = mob.hp;
  let swings = 0;
  while (game.mobs.length && swings < 40) {
    mob.x = game.player.x + 10;            // cancel knockback so the swing always connects
    game.combat.cd = 0;
    game.attack();
    game.update(1 / 60);
    swings++;
  }
  console.log(`[smoke] combat: slime ${mobHp0}hp -> ${game.mobs.length ? game.mobs[0].hp + 'hp' : 'dead'} after ${swings} swings`);
  if (game.mobs.length) errors.push('mob survived 40 sword swings');

  // M2: hunger drains, starvation hurts
  game.hunger.value = 0;
  const hpBefore = game.player.hp;
  game.update(1.0);
  console.log(`[smoke] starving: hp ${hpBefore.toFixed(1)} -> ${game.player.hp.toFixed(1)}`);
  if (game.player.hp >= hpBefore) errors.push('starvation did not drain hp');

  // M2: death -> respawn
  game.player.hp = 0;
  game.update(1 / 60);
  const wasDead = game.dead;
  for (let i = 0; i < 700; i++) game.update(1 / 60);   // > 10s
  console.log(`[smoke] death: dead=${wasDead} -> respawned=${!game.dead} hp=${game.player.hp} hunger=${game.hunger.value}`);
  if (!wasDead) errors.push('player did not die at 0 hp');
  if (game.dead) errors.push('player never respawned');
} catch (e) { errors.push('api: ' + e.message); }

if (errors.length) { console.log('\n[smoke] ERRORS:'); errors.forEach((e) => console.log('  - ' + e)); }
console.log(errors.length ? '\nSMOKE FAIL\n' : '\nSMOKE PASS (no runtime errors — visuals NOT observed)\n');
process.exit(errors.length ? 1 : 0);
