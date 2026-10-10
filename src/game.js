// game.js — 玩法层：物理、挖掘/放置、背包、合成、时间、存档
// 规则：数值来自 data.js；不引用 DOM（UI 通过回调 toast / onHud 通知）。
import { TILE, WTX, WTY, idx, CH, CHX, CHY, chunkIdOf, inWorld, FLAG_MODIFIED } from './core.js';
import { TILES, ITEMS, TOOLS, RECIPES, digTime, DAY_SECONDS, COMBAT, HUNGER } from './data.js';
import { generateChunk, addSource, removeSource, refreshLight, sunLight } from './world.js';
import { Hunger, SpawnDirector, Combat, isNight, deathPenalty, respawnState } from './systems.js';
import { idbPut, idbGet, STORE_SAVES } from './db.js';

export const PHYS = { gravity: 1500, jump: 520, speed: 240, maxFall: 1200 };
const DIG_RADIUS = 6;      // tiles the cursor may reach
const AUTOSAVE_EVERY = 15; // seconds

export class Game {
  constructor(world) {
    this.world = world;
    this.sources = new Map();
    this.seconds = 6 * 50;                 // start at 06:00
    this.player = {
      x: 0, y: 0, vx: 0, vy: 0, w: 12, h: 28, onGround: false, target: null, progress: 0,
      hp: COMBAT.playerHp,
    };
    this.mobs = [];
    this.particles = [];        // debris, capped at 120
    this.facing = 1;
    this.hunger = new Hunger();
    this.combat = new Combat();
    this.director = new SpawnDirector(world.seed);
    this.dead = false; this.respawnT = 0;
    this.spawnTileX = Math.floor(WTX / 2);
    this.onHurt = null;
    this.targetKey = '';
    this.inv = new Map();
    this.hotbar = new Array(9).fill(null);
    this.sel = 0;
    this.intent = { move: 0, jump: false, dig: false, place: false };
    this.toastMsg = ''; this.toastT = 0;
    this.craftQueue = null;
    this.autosave = 0;
    this.onToast = null;
    this.onHud = null;
  }

  toast(msg) {
    this.toastMsg = msg; this.toastT = 2.0;
    if (this.onToast) this.onToast(msg);
  }

  spawn(tx = Math.floor(WTX / 2)) {
    const sy = this.world.surfaceY(tx);
    this.player.x = tx * TILE;
    this.player.y = (sy - 3) * TILE;
    this.ensureChunks(this.player.x, this.player.y, 1);
  }

  /** generate chunks within radius r synchronously (r=1 must never be skipped) */
  ensureChunks(px, py, r) {
    const cx = Math.floor(px / TILE / CH), cy = Math.floor(py / TILE / CH);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= CHX || y >= CHY) continue;
        generateChunk(this.world, x, y);   // fresh chunks are baked on first draw
      }
    }
  }

  currentTool() {
    const it = this.hotbar[this.sel];
    if (!it) return TOOLS.hand;
    return (ITEMS[it] && ITEMS[it].tool) || TOOLS.hand;
  }

  addInv(item, n = 1) {
    if (!item) return;
    this.inv.set(item, (this.inv.get(item) || 0) + n);
    if (!this.hotbar.includes(item)) {
      const i = this.hotbar.indexOf(null);
      if (i >= 0) this.hotbar[i] = item;
    }
    if (this.onHud) this.onHud();
  }

  take(item, n = 1) {
    const have = this.inv.get(item) || 0;
    if (have < n) return false;
    const left = have - n;
    if (left > 0) this.inv.set(item, left); else this.inv.delete(item);
    if (left === 0) {
      const i = this.hotbar.indexOf(item);
      if (i >= 0) this.hotbar[i] = null;
    }
    if (this.onHud) this.onHud();
    return true;
  }

  aim(worldX, worldY) {
    const p = this.player;
    const tx = Math.floor(worldX / TILE), ty = Math.floor(worldY / TILE);
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const near = Math.abs(tx * TILE + TILE / 2 - cx) < DIG_RADIUS * TILE &&
                 Math.abs(ty * TILE + TILE / 2 - cy) < DIG_RADIUS * TILE;
    p.target = (inWorld(tx, ty) && near) ? { tx, ty } : null;
  }

  breakTile(tx, ty, id) {
    const w = this.world;
    w.set(tx, ty, 0);
    if (id === 11) removeSource(w, this.sources, tx, ty);
    refreshLight(w, this.sources, tx - 8, ty - 8, tx + 8, ty + 8);
    const drop = TILES[id].drop;
    if (drop) this.addInv(drop, 1);
    this.spawnDebris(tx, ty, TILES[id].colors ? TILES[id].colors[1] : '#8A5A34');
    this.autosave = 0;
  }

  spawnDebris(tx, ty, color) {
    if (this.particles.length > 114) return;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.particles.push({
        x: tx * TILE + 8, y: ty * TILE + 8,
        vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 40,
        life: 0.6, max: 0.6, color,
      });
    }
  }

  updateDebris(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }

  placeAt(tx, ty) {
    const it = this.hotbar[this.sel];
    if (!it) { this.toast('手上没有方块'); return; }
    const def = ITEMS[it];
    if (!def || !def.place) { this.toast('这个不能放置'); return; }
    const w = this.world;
    if (!inWorld(tx, ty) || w.get(tx, ty) !== 0) return;
    if (!this.take(it, 1)) return;
    w.set(tx, ty, def.place);
    if (def.place === 11) addSource(w, this.sources, tx, ty, def.light || 1.0);
    refreshLight(w, this.sources, tx - 8, ty - 8, tx + 8, ty + 8);
    w.markQuadDirty(tx, ty);
    this.autosave = 0;
  }

  craft(recipeId) {
    const r = RECIPES.find((x) => x.id === recipeId);
    if (!r) return;
    for (const inp of r.inputs) if ((this.inv.get(inp.item) || 0) < inp.count) {
      this.toast(`材料不足：${ITEMS[inp.item].name}`); return;
    }
    if (this.craftQueue) return;
    for (const inp of r.inputs) this.take(inp.item, inp.count);
    this.craftQueue = { r, t: 0 };
  }

  /* ---------------- physics ---------------- */
  moveAxis(axis, delta) {
    const p = this.player, w = this.world;
    if (axis === 'x') p.x += delta; else p.y += delta;
    const tx0 = Math.floor(p.x / TILE), tx1 = Math.floor((p.x + p.w - 0.001) / TILE);
    const ty0 = Math.floor(p.y / TILE), ty1 = Math.floor((p.y + p.h - 0.001) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!w.isSolid(tx, ty)) continue;
        if (axis === 'x') {
          p.x = delta > 0 ? tx * TILE - p.w : (tx + 1) * TILE;
          p.vx = 0; return;
        }
        if (delta > 0) { p.y = ty * TILE - p.h; p.onGround = true; }
        else p.y = (ty + 1) * TILE;
        p.vy = 0; return;
      }
    }
  }

  update(dt) {
    const p = this.player;
    this.seconds = (this.seconds + dt) % DAY_SECONDS;
    if (this.toastT > 0) this.toastT -= dt;

    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn();
      return;
    }

    if (this.intent.move !== 0) this.facing = Math.sign(this.intent.move);
    this.updateDebris(dt);

    const starving = this.hunger.value <= 0;
    const digging = this.intent.dig && p.target && this.world.get(p.target.tx, p.target.ty) !== 0;
    const activity = digging ? 'work' : (this.intent.move !== 0 ? 'walk' : 'idle');
    this.hunger.update(dt, activity, p, this);

    p.vx = this.intent.move * PHYS.speed * (starving ? HUNGER.starveSpeedMul : 1);
    p.vy = Math.min(PHYS.maxFall, p.vy + PHYS.gravity * dt);
    if (this.intent.jump && p.onGround) { p.vy = -PHYS.jump; p.onGround = false; this.intent.jump = false; }
    p.onGround = false;
    this.moveAxis('x', p.vx * dt);
    this.moveAxis('y', p.vy * dt);

    // mining
    if (this.intent.dig && p.target) {
      const { tx, ty } = p.target;
      const id = this.world.get(tx, ty);
      const key = tx + ',' + ty;
      if (key !== this.targetKey) { this.targetKey = key; p.progress = 0; }
      if (id !== 0) {
        const t = digTime(TILES[id], this.currentTool());
        if (!isFinite(t)) { p.progress = 0; if (this.toastT <= 0) this.toast('工具等级不够'); }
        else {
          p.progress += (dt / t) * (starving ? HUNGER.starveDigMul : 1);
          if (p.progress >= 1) { this.breakTile(tx, ty, id); p.progress = 0; }
        }
      }
    } else { p.progress = 0; this.targetKey = ''; }

    if (this.intent.place && p.target) { this.placeAt(p.target.tx, p.target.ty); this.intent.place = false; }

    // M2 survival
    this.director.update(dt, this, this.world);
    this.combat.update(dt, this, this.world);
    if (p.hp <= 0 && !this.dead) this.die();

    // crafting progress
    if (this.craftQueue) {
      this.craftQueue.t += dt;
      if (this.craftQueue.t >= this.craftQueue.r.time) {
        for (const o of this.craftQueue.r.outputs) this.addInv(o.item, o.count);
        this.toast(`做好了：${ITEMS[this.craftQueue.r.outputs[0].item].name}`);
        this.craftQueue = null;
      }
    }

    this.autosave += dt;
    if (this.autosave >= AUTOSAVE_EVERY) { this.autosave = 0; this.save(); }
  }

  /* ---------------- M2 survival ---------------- */
  attack() {
    const m = this.combat.playerAttack(this);
    if (m && this.onHud) this.onHud();
    return m;
  }

  eat(itemId) {
    if (this.hunger.eat(itemId)) {
      this.take(itemId, 1);
      this.toast(`吃了 ${ITEMS[itemId].name}（+${ITEMS[itemId].food} 饱食）`);
      if (this.onHud) this.onHud();
      return true;
    }
    this.toast('这个不能吃');
    return false;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    const p = deathPenalty(this.inv);
    this.inv = p.kept;                       // half the stack of everything stays, half is lost
    this.hotbar = this.hotbar.filter((it) => it && this.inv.has(it));
    while (this.hotbar.length < 9) this.hotbar.push(null);
    this.mobs.length = 0;
    this.respawnT = respawnState().delay;
    this.toast('你倒下了……10 秒后在出生点复活');
    if (this.onHud) this.onHud();
  }

  respawn() {
    const s = respawnState();
    this.dead = false;
    this.player.hp = s.hp;
    this.hunger.value = s.hunger;
    this.spawn(this.spawnTileX);
    this.toast('复活了');
    if (this.onHud) this.onHud();
  }

  get progressOfTile() { return this.player.progress; }

  /* ---------------- persistence ---------------- */
  async save() {
    const w = this.world;
    const chunks = [];
    for (const cid of w.modifiedChunks) {
      const cx = cid % CHX, cy = (cid / CHX) | 0;
      const mods = [];
      const x0 = cx * CH, y0 = cy * CH;
      for (let ly = 0; ly < CH; ly++) {
        for (let lx = 0; lx < CH; lx++) {
          const tx = x0 + lx, ty = y0 + ly;
          if (tx >= WTX || ty >= WTY) continue;
          const i = idx(tx, ty);
          if (!(w.flags[i] & FLAG_MODIFIED)) continue;
          mods.push([ly * CH + lx, w.tileId[i], w.wallId[i]]);
        }
      }
      if (mods.length) chunks.push({ v: 1, ci: cid, cx, cy, modCount: mods.length, mods: mods.slice(0, 4096) });
    }
    const rec = {
      v: 1, saveId: 'default', seed: w.seed, seedVer: w.seedVer,
      player: { x: this.player.x, y: this.player.y, seconds: this.seconds, inv: [...this.inv], hotbar: this.hotbar.slice() },
      chunks,
    };
    try { await idbPut(STORE_SAVES, rec); } catch (e) { /* storage unavailable: run without persistence */ }
    return rec;
  }

  async load() {
    let rec = null;
    try { rec = await idbGet(STORE_SAVES, 'default'); } catch (e) { return false; }
    if (!rec || rec.seed !== this.world.seed) return false;
    for (const c of rec.chunks || []) {
      const x0 = c.cx * CH, y0 = c.cy * CH;
      for (const [li, tile, wall] of c.mods) {
        const lx = li % CH, ly = (li / CH) | 0;
        const tx = x0 + lx, ty = y0 + ly;
        if (!inWorld(tx, ty)) continue;
        const i = idx(tx, ty);
        this.world.tileId[i] = tile; this.world.wallId[i] = wall;
        this.world.flags[i] |= FLAG_MODIFIED;
        if (tile === 11) this.sources.set(i, 1.0);
        this.world.markQuadDirty(tx, ty);
      }
    }
    const p = rec.player;
    if (p) {
      this.player.x = p.x; this.player.y = p.y; this.seconds = p.seconds || this.seconds;
      this.inv = new Map(p.inv || []); this.hotbar = p.hotbar || this.hotbar;
    }
    return true;
  }
}


