// atlas.js — 启动时程序化生成 16px tile 图集（零外部图片）
// 每材质 20 张：16 个 4-bit 边变体 + 4 个内部填充变体；另加 4 张全局角补丁。
import { TILES, WALLS } from './data.js';
import { hash2i } from './core.js';

export const ATLAS = { canvas: null, size: 512, tile: 16, perRow: 32 };

/** bit layout: N=1 E=2 S=4 W=8 NE=16 SE=32 SW=64 NW=128 */
export function maskOf(world, tx, ty) {
  const solid = (x, y) => (world.get(x, y) !== 0 ? 1 : 0);
  return solid(tx, ty - 1) | (solid(tx + 1, ty) << 1) | (solid(tx, ty + 1) << 2) |
         (solid(tx - 1, ty) << 3) | (solid(tx + 1, ty - 1) << 4) | (solid(tx + 1, ty + 1) << 5) |
         (solid(tx - 1, ty + 1) << 6) | (solid(tx - 1, ty - 1) << 7);
}

function fillRect(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }

function drawVariant(ctx, px, py, colors, variant, seed) {
  const [hi, base, lo] = colors;
  ctx.clearRect(px, py, 16, 16);
  fillRect(ctx, px, py, 16, 16, base);
  fillRect(ctx, px, py, 16, 3, hi);          // top highlight
  fillRect(ctx, px, py + 13, 16, 3, lo);     // bottom shade
  // deterministic speckle so tiles are not flat
  for (let n = 0; n < 6; n++) {
    const h = hash2i(seed, variant * 31 + n, 7);
    const x = px + (h % 14) + 1, y = py + ((h >> 8) % 12) + 2;
    fillRect(ctx, x, y, 1, 1, (h >> 16) & 1 ? hi : lo);
  }
  if (variant < 16) {
    // 4-bit edge variant: draw a dark border on every unconnected side
    if (!(variant & 1)) fillRect(ctx, px, py, 16, 1, lo);        // N
    if (!(variant & 2)) fillRect(ctx, px + 15, py, 1, 16, lo);   // E
    if (!(variant & 4)) fillRect(ctx, px, py + 15, 16, 1, lo);   // S
    if (!(variant & 8)) fillRect(ctx, px, py, 1, 16, lo);        // W
  }
}

/**
 * Inner-corner patch. `subset` is a 4-bit mask of which diagonals are EMPTY while both
 * of their edges are solid: bit0=NE bit1=SE bit2=SW bit3=NW.
 * All 16 subsets are baked, so any 8-neighbour configuration resolves to
 * "1 base variant + at most 1 patch" — the visual equivalent of a full 47-blob set
 * for a fraction of the atlas space (20 + 16 tiles per material instead of 47+).
 */
function drawCornerPatch(ctx, px, py, subset, colors) {
  const [, , lo] = colors;
  ctx.clearRect(px, py, 16, 16);
  ctx.fillStyle = lo;
  const tri = (a, b, c) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath(); ctx.fill(); };
  if (subset & 1) tri([px + 16, py], [px + 10, py], [px + 16, py + 6]);              // NE
  if (subset & 2) tri([px + 16, py + 16], [px + 10, py + 16], [px + 16, py + 10]);   // SE
  if (subset & 4) tri([px, py + 16], [px + 6, py + 16], [px, py + 10]);              // SW
  if (subset & 8) tri([px, py], [px + 6, py], [px, py + 6]);                         // NW
}

export function buildAtlas() {
  const size = ATLAS.size, t = ATLAS.tile, perRow = ATLAS.perRow;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let row = 0;
  for (const tile of TILES) {
    if (!tile.colors) continue;
    for (let v = 0; v < 20; v++) {
      const px = (v % perRow) * t, py = row * t;
      drawVariant(ctx, px, py, tile.colors, v, tile.id * 1013);
    }
    row++;
  }
  // walls: single flat tile each (row continues)
  for (const w of WALLS) {
    if (!w.colors) continue;
    for (let v = 0; v < 20; v++) drawVariant(ctx, (v % perRow) * t, row * t, w.colors, 15, w.id * 7919);
    row++;
  }
  // inner-corner patches: all 16 diagonal subsets, neutral dark palette
  const patchRow = perRow - 1;
  for (let s = 0; s < 16; s++) {
    drawCornerPatch(ctx, s * t, patchRow * t, s, ['#000', '#000', '#1A1410']);
  }
  ATLAS.canvas = cv;
  ATLAS.rows = row;
  return cv;
}

/** source rect of a material variant in the atlas */
export function srcRect(tileId, variant) {
  let row = 0;
  for (const t of TILES) {
    if (!t.colors) continue;
    if (t.id === tileId) return [variant * ATLAS.tile, row * ATLAS.tile, ATLAS.tile, ATLAS.tile];
    row++;
  }
  return null;
}

/** source rect of a wall variant */
export function wallSrcRect(wallId) {
  let row = 0;
  for (const t of TILES) if (t.colors) row++;
  for (const w of WALLS) {
    if (!w.colors) continue;
    if (w.id === wallId) return [0, row * ATLAS.tile, ATLAS.tile, ATLAS.tile];
    row++;
  }
  return null;
}

/** inner-corner patch rect for a 4-bit diagonal subset (bit0=NE bit1=SE bit2=SW bit3=NW) */
export function patchRect(subset) {
  return [subset * ATLAS.tile, (ATLAS.perRow - 1) * ATLAS.tile, ATLAS.tile, ATLAS.tile];
}

/** the diagonal subset that needs patching for a given 8-neighbour mask */
export function innerCornerMask(mask) {
  return ((mask & 1) && (mask & 2) && !(mask & 16) ? 1 : 0) |
         ((mask & 2) && (mask & 4) && !(mask & 32) ? 2 : 0) |
         ((mask & 4) && (mask & 8) && !(mask & 64) ? 4 : 0) |
         ((mask & 8) && (mask & 1) && !(mask & 128) ? 8 : 0);
}

/** variant index for a mask: interior uses one of 4 random fills */
export function variantOf(mask, tx, ty) {
  const m = mask & 15;
  if (m === 15) return 16 + (hash2i(0x2f1b, tx, ty) & 3);
  return m;
}
