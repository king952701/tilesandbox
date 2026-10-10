// world.js — 程序化生成（种子化、跨设备一致）与光照
import { CH, WTX, WTY, STRIDE, idx, chunkIdOf, fbm, vnoise, hash01, hash2i, TILE } from './core.js';
import { TILES, ORES } from './data.js';

const CAVE_FREQ = 1 / 48;
const CAVE_THRESH = 0.06;
const BEDROCK_ROWS = 40;

/** cave: worm carving (absolute tile coords => seam-free across chunks) */
function isCave(seed, tx, ty, depth) {
  if (depth < 3) return false;
  const w = Math.abs(vnoise(seed ^ 0x5bf03635, tx * CAVE_FREQ, ty * CAVE_FREQ) - 0.5);
  if (w < CAVE_THRESH) return true;
  const chamber = vnoise(seed ^ 0x1b873593, tx / 24, ty / 24);
  const density = 0.12 + Math.min(0.23, Math.max(0, (ty - 140) / 560) * 0.23);
  if (ty > 700) return chamber > 0.62 - (ty - 700) * 0.002;
  return chamber > 1 - density;
}

/** ore: cell-hash clusters + noise, restricted to depth bands */
function oreAt(seed, tx, ty) {
  for (let k = 0; k < ORES.length; k++) {
    const o = ORES[k];
    if (ty < o.yMin || ty > o.yMax) continue;
    const cxi = Math.floor(tx / 32), cyi = Math.floor(ty / 32);
    if (hash01(seed + o.id * 7919, cxi, cyi) * 1000 >= o.density) continue;
    if (vnoise(seed + o.id * 131, tx / 4, ty / 4) > 0.45) return o.id;
  }
  return 0;
}

export function generateChunk(world, cx, cy) {
  const cid = chunkIdOf(cx, cy);
  if (world.generated[cid]) return false;
  world.generated[cid] = 1;
  const seed = world.seed;
  const x0 = cx * CH, y0 = cy * CH;

  for (let ly = 0; ly < CH; ly++) {
    const ty = y0 + ly;
    if (ty >= WTY) break;
    for (let lx = 0; lx < CH; lx++) {
      const tx = x0 + lx;
      if (tx >= WTX) break;
      const i = idx(tx, ty);
      const sy = world.surfaceY(tx);
      let id = 0, wall = 0;

      if (ty >= WTY - BEDROCK_ROWS) {
        id = 10;                                        // bedrock
      } else if (ty < sy) {
        id = 0;                                         // sky
      } else if (ty === sy) {
        id = 1;                                         // grass
      } else {
        const depth = ty - sy;
        const soil = 18 + Math.round(fbm(seed ^ 0x51ed, tx, 0, 3, 1 / 256) * 12);
        if (depth <= soil) {
          id = 2;                                       // dirt
          wall = 1;
        } else {
          id = 3;                                       // stone
          wall = 2;
          if (isCave(seed, tx, ty, depth)) { id = 0; wall = 2; }
          else {
            const ore = oreAt(seed, tx, ty);
            if (ore) { id = ore; world.flags[i] |= 4; }
          }
        }
      }
      world.tileId[i] = id;
      world.wallId[i] = wall;
      world.light[i] = sunLight(world, tx, ty);
    }
  }

  // trees: stamp after terrain so they sit on the surface
  for (let lx = 0; lx < CH; lx++) {
    const tx = x0 + lx;
    if (tx >= WTX) break;
    if (tx % 24 !== 0) continue;
    const r = hash2i(seed ^ 0x77, Math.floor(tx / 24), 0) % 100;
    if (r >= 35) continue;
    const sy = world.surfaceY(tx);
    if (sy < y0 - 8 || sy > y0 + CH + 8) continue;
    const th = 4 + (hash2i(seed ^ 0x88, tx, 1) % 3);
    for (let k = 1; k <= th; k++) {
      const ty = sy - k;
      if (ty < 0 || ty >= WTY) continue;
      const i = idx(tx, ty);
      if (world.tileId[i] === 0) world.tileId[i] = 4;   // trunk
    }
    for (let dy = -2; dy <= 0; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx2 = tx + dx, ty2 = sy - th + dy;
        if (tx2 < 0 || tx2 >= WTX || ty2 < 0 || ty2 >= WTY) continue;
        const i = idx(tx2, ty2);
        if (world.tileId[i] === 0) world.tileId[i] = 12; // leaves
      }
    }
  }
  return true;
}

/** sunlight: full above the surface, fades over ~21 tiles underground */
export function sunLight(world, tx, ty) {
  if (tx < 0 || tx >= WTX) return 0;
  const sy = world.surfaceY(tx);
  if (ty <= sy) return 255;
  const d = ty - sy;
  const v = 255 - d * 12;
  return v > 0 ? v : 0;
}

/**
 * Recompute light for a tile box: sunlight, then every known source within radius.
 * sources: Map<tileIndex, strength(0..1)>
 */
export function refreshLight(world, sources, tx0, ty0, tx1, ty1) {
  const R = 8;
  for (let ty = ty0; ty <= ty1; ty++) {
    if (ty < 0 || ty >= WTY) continue;
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || tx >= WTX) continue;
      let best = sunLight(world, tx, ty);
      for (const [si, s] of sources) {
        const sx = si % STRIDE, sy = (si / STRIDE) | 0;
        const d = Math.abs(sx - tx) + Math.abs(sy - ty);
        if (d > R) continue;
        const v = (1 - d / (R + 1)) * 255 * s;
        if (v > best) best = v;
      }
      world.light[idx(tx, ty)] = best;
      world.markQuadDirty(tx, ty);
    }
  }
}

export function addSource(world, sources, tx, ty, strength) {
  sources.set(idx(tx, ty), strength);
  refreshLight(world, sources, tx - 8, ty - 8, tx + 8, ty + 8);
}

export function removeSource(world, sources, tx, ty) {
  sources.delete(idx(tx, ty));
  refreshLight(world, sources, tx - 8, ty - 8, tx + 8, ty + 8);
}
