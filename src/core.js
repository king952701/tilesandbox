// core.js — 常量、确定性噪声、坐标索引、世界存储
// 规则：core 不引用 DOM，不引用 gameplay/ui；热路径零分配。
import { TILES } from './data.js';

export const TILE = 16;
export const CH = 64;            // storage/generation chunk (tiles)
export const QUAD = 32;          // render bake unit (tiles) -> 512x512 px
export const WTX = 4950;         // world width in tiles  (79200 / 16)
export const WTY = 800;          // world height in tiles (12800 / 16)
export const CHX = Math.ceil(WTX / CH);   // 78
export const CHY = Math.ceil(WTY / CH);   // 13
export const STRIDE = CHX * CH;           // 4992 (padding 42)
export const ROWS = CHY * CH;             // 832  (padding 32)
export const LEN = STRIDE * ROWS;         // 4,153,344

export const idx = (tx, ty) => ty * STRIDE + tx;
export const inWorld = (tx, ty) => tx >= 0 && ty >= 0 && tx < WTX && ty < WTY;
export const chunkIdOf = (cx, cy) => cy * CHX + cx;

/* ---------------- deterministic hashing / noise ---------------- */
// 禁止 Math.random 与 Math.sin 哈希（跨引擎精度不一致）

export function hash2i(seed, x, y) {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
export const hash01 = (seed, x, y) => hash2i(seed, x, y) / 4294967296;

export function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export function vnoise(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const sx = smooth(x - x0), sy = smooth(y - y0);
  const n00 = hash01(seed, x0, y0), n10 = hash01(seed, x0 + 1, y0);
  const n01 = hash01(seed, x0, y0 + 1), n11 = hash01(seed, x0 + 1, y0 + 1);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

export function fbm(seed, x, y, oct = 4, freq = 1 / 512, gain = 0.5, lac = 2) {
  let amp = 1, f = freq, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(seed + i * 7919, x * f, y * f);
    norm += amp; amp *= gain; f *= lac;
  }
  return sum / norm;
}

/** ridged noise for mountains */
export function ridged(seed, x, y, oct = 3, freq = 1 / 1024) {
  let amp = 1, f = freq, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise(seed + 991 * i, x * f, y * f) * 2 - 1);
    sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

/* ---------------- world storage (SoA, 6 bytes per tile) ---------------- */
export const FLAG_MODIFIED = 1;   // player changed -> must persist
export const FLAG_DUG = 2;        // exposed / mined once
export const FLAG_ORE = 4;
export const FLAG_LIT = 8;

export class World {
  constructor(seed = 20250101) {
    this.seed = seed >>> 0;
    this.seedVer = 1;
    this.tileId = new Uint16Array(LEN);
    this.wallId = new Uint16Array(LEN);
    this.light = new Uint8Array(LEN);
    this.flags = new Uint8Array(LEN);
    this.generated = new Uint8Array(CHX * CHY);      // per chunk
    this.surface = new Int16Array(STRIDE);           // surface tile y per column
    this.surfaceReady = new Uint8Array(STRIDE);
    this.dirtyQuads = new Set();
    this.modifiedChunks = new Set();   // chunk ids that must be persisted
  }

  /** surface height of a column: deterministic, cached */
  surfaceY(tx) {
    if (tx < 0 || tx >= WTX) return WTY - 1;
    if (!this.surfaceReady[tx]) {
      const base = fbm(this.seed, tx, 0, 4, 1 / 512, 0.5, 2);
      const mount = ridged(this.seed ^ 0x9e3779b9, tx, 0, 3, 1 / 1024);
      this.surface[tx] = Math.round(120 + base * 42 + mount * 18); // ~120..180
      this.surfaceReady[tx] = 1;
    }
    return this.surface[tx];
  }

  get(tx, ty) { return inWorld(tx, ty) ? this.tileId[idx(tx, ty)] : 10; } // 10 = bedrock out of bounds
  getWall(tx, ty) { return inWorld(tx, ty) ? this.wallId[idx(tx, ty)] : 0; }
  isSolid(tx, ty) { return TILES[this.get(tx, ty)].solid; }

  set(tx, ty, id) {
    if (!inWorld(tx, ty)) return false;
    const i = idx(tx, ty);
    if (this.tileId[i] === id) return false;
    this.tileId[i] = id;
    this.flags[i] |= FLAG_MODIFIED | FLAG_DUG;
    this.modifiedChunks.add(chunkIdOf(tx >> 6, ty >> 6));
    this.markQuadDirty(tx, ty);
    return true;
  }

  setWall(tx, ty, id) {
    if (!inWorld(tx, ty)) return false;
    const i = idx(tx, ty);
    this.wallId[i] = id; this.flags[i] |= FLAG_MODIFIED; this.markQuadDirty(tx, ty);
    return true;
  }

  /** mark the 32x32 quadrant (and neighbours when on an edge) dirty */
  markQuadDirty(tx, ty) {
    const qx = tx >> 5, qy = ty >> 5;
    this.dirtyQuads.add(qy * 1024 + qx);
    const lx = tx & 31, ly = ty & 31;
    if (lx === 0) this.dirtyQuads.add(qy * 1024 + (qx - 1));
    if (lx === 31) this.dirtyQuads.add(qy * 1024 + (qx + 1));
    if (ly === 0) this.dirtyQuads.add((qy - 1) * 1024 + qx);
    if (ly === 31) this.dirtyQuads.add((qy + 1) * 1024 + qx);
  }
}
