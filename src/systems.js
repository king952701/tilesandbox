// systems.js — M2 survival: hunger, spawn director, mob AI, combat, death penalty
// Pure logic where possible (no DOM) so tests/run.js can assert it headlessly.
import { TILE, WTX, WTY, idx, inWorld, hash2i } from './core.js';
import { HUNGER, MOBS, SPAWN, COMBAT, DEATH, damageOf, HOUR_SECONDS, DAY_SECONDS, ITEMS } from './data.js';

export const isNight = (seconds) => {
  const h = (seconds / HOUR_SECONDS) % 24;
  return h < 6 || h >= 18;
};

/* ---------------- hunger ---------------- */
/** hunger consumed over `dt` real seconds; activity: 'idle' | 'walk' | 'work' */
export function hungerDrain(activity, dt) {
  const perHour = HUNGER.drainPerHour[activity] ?? HUNGER.drainPerHour.idle;
  return (perHour / HOUR_SECONDS) * dt;
}

export class Hunger {
  constructor(value = HUNGER.max) { this.value = value; this.regenT = 0; }
  update(dt, activity, player, game) {
    const before = this.value;
    this.value = Math.max(0, this.value - hungerDrain(activity, dt));
    if (this.value >= HUNGER.regenAbove) {
      this.regenT += dt;
      if (this.regenT >= HUNGER.regenInterval) { this.regenT = 0; player.hp = Math.min(COMBAT.playerHp, player.hp + 1); }
    } else this.regenT = 0;
    if (this.value === 0) player.hp -= HUNGER.starveDps * dt;
    if (before > 0 && this.value === 0 && game) game.toast('饿坏了！生命开始下降');
  }
  eat(itemId) {
    const def = ITEMS[itemId];
    if (!def || !def.food) return false;
    this.value = Math.min(HUNGER.max, this.value + def.food);
    return true;
  }
}

/* ---------------- spawn director ---------------- */
/** pure predicate so it can be unit tested without a world */
export function canSpawnAt({ light, distTiles, night, isCave, count, cap }) {
  if (light / 255 >= SPAWN.lightMax) return false;
  if (distTiles < SPAWN.minDist || distTiles > SPAWN.maxDist) return false;
  if (SPAWN.nightOnly && !night) return false;
  if (count >= cap) return false;
  return true;
}

export class SpawnDirector {
  constructor(seed = 1) { this.timer = SPAWN.interval; this.seed = seed; this.tick = 0; }
  update(dt, game, world) {
    const night = isNight(game.seconds);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = SPAWN.interval + (hash2i(this.seed, this.tick++, 0) / 4294967296 - 0.5) * 2 * SPAWN.jitter;

    if (!night) return;
    const mobs = game.mobs;
    if (mobs.length >= SPAWN.caps.active) return;
    const p = game.player;
    const ptx = Math.floor((p.x + p.w / 2) / TILE), pty = Math.floor((p.y + p.h / 2) / TILE);

    for (let attempt = 0; attempt < 8; attempt++) {
      const r = hash2i(this.seed ^ 0x51ab, this.tick, attempt);
      const ang = (r % 360) * Math.PI / 180;
      const dist = SPAWN.minDist + ((r >> 9) % (SPAWN.maxDist - SPAWN.minDist));
      const tx = Math.round(ptx + Math.cos(ang) * dist);
      const ty = Math.round(pty + Math.sin(ang) * dist * 0.5);
      if (!inWorld(tx, ty)) continue;

      const surfaceY = world.surfaceY(tx);
      const isCave = ty > surfaceY + 4;
      if (isCave && ty >= WTY - 45) continue;                       // not in bedrock
      const cap = isCave ? SPAWN.caps.cave : SPAWN.caps.surface;
      const count = mobs.reduce((n, m) => n + (m.cave === isCave ? 1 : 0), 0);
      const light = world.light[idx(tx, ty)];
      if (!canSpawnAt({ light, distTiles: dist, night, isCave, count, cap })) continue;

      // needs solid ground + 2 air above
      if (!world.isSolid(tx, ty + 1)) continue;
      if (world.get(tx, ty) !== 0 || world.get(tx, ty - 1) !== 0) continue;

      const kind = isCave ? 'bat' : ((r >> 3) % 2 === 0 ? 'slime' : 'zombie');
      mobs.push(makeMob(kind, tx * TILE, ty * TILE, isCave));
      return;
    }
  }
}

export function makeMob(kind, x, y, cave) {
  const d = MOBS[kind];
  return { kind, x, y, vx: 0, vy: 0, w: d.w, h: d.h, hp: d.hp, maxHp: d.hp, cave: !!cave, atkCd: 0, hurtT: 0 };
}

/* ---------------- combat ---------------- */
export function attackDamage(weaponId) {
  return COMBAT.weaponDmg[weaponId] ?? COMBAT.weaponDmg.hand;
}

export class Combat {
  constructor() { this.cd = 0; }
  /** player swings at the nearest mob in range; returns the mob or null */
  playerAttack(game) {
    if (this.cd > 0) return null;
    const p = game.player;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const weapon = game.hotbar[game.sel];
    const atk = attackDamage(weapon && ITEMS[weapon] && ITEMS[weapon].weapon ? weapon : 'hand');
    let best = null, bestD = Infinity;
    for (const m of game.mobs) {
      const d = Math.hypot(m.x + m.w / 2 - cx, m.y + m.h / 2 - cy);
      if (d < COMBAT.attackRange && d < bestD) { bestD = d; best = m; }
    }
    if (!best) return null;
    this.cd = COMBAT.attackCooldown;
    const dmg = damageOf(atk, MOBS[best.kind].def);
    best.hp -= dmg;
    best.hurtT = 0.15;
    const dir = (best.x + best.w / 2) < cx ? -1 : 1;
    best.vx = dir * dmg * COMBAT.knockbackPerDmg * 6;
    if (best.hp <= 0) killMob(game, best);
    return best;
  }

  update(dt, game, world) {
    if (this.cd > 0) this.cd -= dt;
    const p = game.player;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;

    for (let i = game.mobs.length - 1; i >= 0; i--) {
      const m = game.mobs[i];
      const d = MOBS[m.kind];
      if (m.hurtT > 0) m.hurtT -= dt;

      // gravity + chase
      m.vy = Math.min(900, m.vy + 1400 * dt);
      const dir = Math.sign(cx - (m.x + m.w / 2)) || 0;
      const dist = Math.abs(cx - (m.x + m.w / 2));
      m.vx = dist > 6 ? dir * d.speed : 0;
      moveMob(m, m.vx * dt, 0, world);
      moveMob(m, 0, m.vy * dt, world);
      m.vx *= 0.85;

      // contact damage
      m.atkCd -= dt;
      if (Math.hypot(m.x + m.w / 2 - cx, m.y + m.h / 2 - cy) < 20 && m.atkCd <= 0) {
        m.atkCd = COMBAT.mobAttackCooldown;
        p.hp -= damageOf(d.dmg, 0);
        if (game.onHurt) game.onHurt();
        if (p.hp <= 0) game.die();
      }

      // despawn far away
      if (dist > 120 * TILE || m.hp <= 0) game.mobs.splice(i, 1);
    }
  }
}

function moveMob(m, dx, dy, world) {
  m.x += dx;
  const tx0 = Math.floor(m.x / TILE), tx1 = Math.floor((m.x + m.w - 0.001) / TILE);
  const ty0 = Math.floor(m.y / TILE), ty1 = Math.floor((m.y + m.h - 0.001) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (!world.isSolid(tx, ty)) continue;
    if (dx > 0) m.x = tx * TILE - m.w; else if (dx < 0) m.x = (tx + 1) * TILE;
    m.vx = 0; return;
  }
  if (dy !== 0) {
    m.y += dy;
    const ay0 = Math.floor(m.y / TILE), ay1 = Math.floor((m.y + m.h - 0.001) / TILE);
    for (let ty = ay0; ty <= ay1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (!world.isSolid(tx, ty)) continue;
      if (dy > 0) m.y = ty * TILE - m.h; else m.y = (ty + 1) * TILE;
      m.vy = 0; return;
    }
  }
}

export function killMob(game, m) {
  const i = game.mobs.indexOf(m);
  if (i >= 0) game.mobs.splice(i, 1);
  const drops = { slime: 'fiber', bat: 'raw_meat', zombie: 'raw_meat' };
  const drop = drops[m.kind];
  if (drop) game.addInv(drop, 1);   // deterministic: exactly 1 unit, no RNG in gameplay
}

/* ---------------- death ---------------- */
/**
 * Pure part of the death penalty: what the player loses.
 * Applied by Game.die(); kept pure so tests can assert it.
 */
export function deathPenalty(inv, currency = 0) {
  const keep = new Map();
  for (const [k, v] of inv) { const half = Math.floor(v / 2); if (half > 0) keep.set(k, half); }
  return { dropped: inv, kept: keep, currencyLost: Math.floor(currency * DEATH.currencyLoss) };
}

export function respawnState() {
  return { hp: COMBAT.playerHp * DEATH.hpRatio, hunger: HUNGER.max * DEATH.hungerRatio, delay: DEATH.respawnDelay };
}
