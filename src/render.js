// render.js — 相机、quadrant 烘焙、光照合成、昼夜配色
import { TILE, QUAD, WTX, WTY, idx } from './core.js';
import { TILES, MOBS } from './data.js';
import { ATLAS, maskOf, srcRect, wallSrcRect, patchRect, innerCornerMask, variantOf } from './atlas.js';

const QUAD_PX = QUAD * TILE;              // 512
const HOUR = (t) => (t / 50) % 24;        // 50s per game hour

/** three keyframes of the day; everything else is interpolated */
export const SKY_KEYS = [
  { h: 0,  sky: ['#0B1020', '#1B2440'], tint: [40, 56, 96], amb: 0.30 },   // night
  { h: 6,  sky: ['#F0956B', '#F7C59F'], tint: [255, 190, 150], amb: 0.75 }, // dawn
  { h: 12, sky: ['#7EC0EE', '#B8E0F0'], tint: [255, 255, 255], amb: 1.00 }, // noon
  { h: 18, sky: ['#E88A5A', '#F5C89A'], tint: [255, 180, 140], amb: 0.72 }, // dusk
  { h: 24, sky: ['#0B1020', '#1B2440'], tint: [40, 56, 96], amb: 0.30 },
];

export function skyAt(seconds) {
  const h = HOUR(seconds);
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (h >= SKY_KEYS[i].h && h <= SKY_KEYS[i + 1].h) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  }
  const t = (h - a.h) / Math.max(1e-6, b.h - a.h);
  const mix = (x, y) => Math.round(x + (y - x) * t);
  return {
    top: `rgb(${mix(hex(a.sky[0])[0], hex(b.sky[0])[0])},${mix(hex(a.sky[0])[1], hex(b.sky[0])[1])},${mix(hex(a.sky[0])[2], hex(b.sky[0])[2])})`,
    bottom: `rgb(${mix(hex(a.sky[1])[0], hex(b.sky[1])[0])},${mix(hex(a.sky[1])[1], hex(b.sky[1])[1])},${mix(hex(a.sky[1])[2], hex(b.sky[1])[2])})`,
    tint: [mix(a.tint[0], b.tint[0]), mix(a.tint[1], b.tint[1]), mix(a.tint[2], b.tint[2])],
    ambient: a.amb + (b.amb - a.amb) * t,
  };
}
function hex(s) { return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]; }

export class Renderer {
  constructor(canvas, world, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.mobile = !!opts.mobile;
    this.zoom = opts.zoom || (this.mobile ? 2 : 2);
    this.cacheLimit = this.mobile ? 16 : 64;
    this.cache = new Map();                 // quadId -> {canvas, used}
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 0; this.h = 0;
    this.lightCv = document.createElement('canvas');
    this.lightCtx = this.lightCv.getContext('2d');
    this.lightTimer = 0;
    this.bgCv = null;
  }

  resize(cssW, cssH) {
    this.w = cssW; this.h = cssH;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.buildBackground();
  }

  /** procedural parallax strips: mountains (0.15) and clouds (0.25), generated once */
  buildBackground() {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 256;
    const c = cv.getContext('2d');
    for (let layer = 0; layer < 2; layer++) {
      c.fillStyle = layer === 0 ? '#3A4A62' : '#2C3A50';
      c.beginPath(); c.moveTo(0, 256);
      for (let x = 0; x <= 1024; x += 32) {
        const n = Math.sin((x + layer * 137) * 0.011) * 34 + Math.sin(x * 0.031) * 14;
        c.lineTo(x, 120 + layer * 40 + n);
      }
      c.lineTo(1024, 256); c.closePath(); c.fill();
    }
    this.bgCv = cv;

    const cl = document.createElement('canvas');
    cl.width = 1024; cl.height = 128;
    const cc = cl.getContext('2d');
    cc.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 14; i++) {
      const x = (i * 137) % 1024, y = 30 + ((i * 53) % 60), w = 60 + ((i * 37) % 90);
      cc.beginPath();
      cc.ellipse(x, y, w / 2, 12 + (i % 3) * 4, 0, 0, Math.PI * 2);
      cc.fill();
    }
    this.cloudCv = cl;
  }

  quadId(qx, qy) { return qy * 1024 + qx; }

  bakeQuad(qx, qy) {
    const w = this.world;
    const cv = document.createElement('canvas');
    cv.width = QUAD_PX; cv.height = QUAD_PX;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    const x0 = qx * QUAD, y0 = qy * QUAD;
    for (let ly = 0; ly < QUAD; ly++) {
      const ty = y0 + ly;
      if (ty < 0 || ty >= WTY) continue;
      for (let lx = 0; lx < QUAD; lx++) {
        const tx = x0 + lx;
        if (tx < 0 || tx >= WTX) continue;
        const id = w.get(tx, ty);
        const dx = lx * TILE, dy = ly * TILE;
        if (id === 0) {
          const wall = w.getWall(tx, ty);
          if (wall) {
            const r = wallSrcRect(wall);
            if (r) c.drawImage(ATLAS.canvas, r[0], r[1], r[2], r[3], dx, dy, TILE, TILE);
          }
          continue;
        }
        const mask = maskOf(w, tx, ty);
        const r = srcRect(id, variantOf(mask, tx, ty));
        if (r) c.drawImage(ATLAS.canvas, r[0], r[1], r[2], r[3], dx, dy, TILE, TILE);
        // inner corners: one patch drawImage covers every diagonal subset
        const inner = innerCornerMask(mask);
        if (inner) { const p = patchRect(inner); c.drawImage(ATLAS.canvas, p[0], p[1], p[2], p[3], dx, dy, TILE, TILE); }
      }
    }
    return cv;
  }

  getQuad(qx, qy) {
    const id = this.quadId(qx, qy);
    let e = this.cache.get(id);
    if (e && !e.dirty) { e.used = performance.now(); return e.canvas; }
    const cv = this.bakeQuad(qx, qy);
    if (e) { e.canvas = cv; e.dirty = false; e.used = performance.now(); }
    else {
      this.cache.set(id, { canvas: cv, dirty: false, used: performance.now() });
      if (this.cache.size > this.cacheLimit) {
        let oldest = null, oid = null;
        for (const [k, v] of this.cache) if (!oldest || v.used < oldest.used) { oldest = v; oid = k; }
        if (oid !== null) { oldest.canvas.width = 0; this.cache.delete(oid); }
      }
    }
    return cv;
  }

  invalidateQuad(qid) {
    const e = this.cache.get(qid);
    if (e) e.dirty = true;
  }

  /** lightmap at tile resolution, stretched 16x with smoothing */
  updateLightmap(camX, camY) {
    const cols = Math.ceil(this.w / TILE / this.zoom) + 2;
    const rows = Math.ceil(this.h / TILE / this.zoom) + 2;
    const t0x = Math.floor(camX / TILE) - 1, t0y = Math.floor(camY / TILE) - 1;
    if (this.lightCv.width !== cols || this.lightCv.height !== rows) {
      this.lightCv.width = cols; this.lightCv.height = rows;
    }
    const img = this.lightCtx.createImageData(cols, rows);
    const d = img.data;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = t0x + c, ty = t0y + r;
        let v = (tx < 0 || ty < 0 || tx >= WTX || ty >= WTY) ? 255 : this.world.light[idx(tx, ty)];
        if (tx < 0 || ty < 0 || tx >= WTX || ty >= WTY) v = 255;
        const o = (r * cols + c) * 4;
        d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255;
      }
    }
    this.lightCtx.putImageData(img, 0, 0);
    this.lightRect = { t0x, t0y, cols, rows };
  }

  draw(cam, player, seconds, dt, mobs, particles, facing = 1) {
    const ctx = this.ctx;
    const sky = skyAt(seconds);

    // sky + parallax ridges
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, sky.top); g.addColorStop(1, sky.bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);

    const z = this.zoom;
    const vw = this.w / z, vh = this.h / z;
    ctx.save();
    ctx.scale(z, z);

    if (this.cloudCv) {
      const ox = -((cam.x * 0.25) % 1024);
      for (let x = ox - 1024; x < vw; x += 1024) ctx.drawImage(this.cloudCv, x, 40 - cam.y * 0.02, 1024, 128);
    }
    if (this.bgCv) {
      const ox = -((cam.x * 0.15) % 1024);
      ctx.globalAlpha = 0.55;
      for (let x = ox - 1024; x < vw; x += 1024) ctx.drawImage(this.bgCv, x, vh - 220, 1024, 256);
      ctx.globalAlpha = 1;
    }
    const qx0 = Math.max(0, Math.floor(cam.x / QUAD_PX));
    const qy0 = Math.max(0, Math.floor(cam.y / QUAD_PX));
    const qx1 = Math.floor((cam.x + vw) / QUAD_PX);
    const qy1 = Math.floor((cam.y + vh) / QUAD_PX);

    let baked = 0;
    for (let qy = qy0; qy <= qy1; qy++) {
      for (let qx = qx0; qx <= qx1; qx++) {
        const id = this.quadId(qx, qy);
        const e = this.cache.get(id);
        if (!e) { if (baked >= (this.mobile ? 1 : 2)) continue; baked++; }
        const cv = this.getQuad(qx, qy);
        ctx.drawImage(cv, qx * QUAD_PX - cam.x, qy * QUAD_PX - cam.y, QUAD_PX, QUAD_PX);
      }
    }

    // player
    if (player) {
      // 12x28 pixel figure: head / body / legs, 1px outline
      const px = player.x - cam.x, py = player.y - cam.y, w = player.w, h = player.h;
      const skin = '#F2C49B', hair = '#3B2A1E', shirt = '#4E6E9A', pants = '#2E3A52';
      ctx.fillStyle = '#1A1410'; ctx.fillRect(px - 1, py - 1, w + 2, h + 2);
      ctx.fillStyle = skin; ctx.fillRect(px + 2, py + 1, 8, 8);          // head
      ctx.fillStyle = hair; ctx.fillRect(px + 1, py, 10, 4);
      ctx.fillStyle = shirt; ctx.fillRect(px + 1, py + 9, w - 2, 9);     // body
      ctx.fillStyle = pants; ctx.fillRect(px + 1, py + 18, w - 2, h - 18); // legs
      ctx.fillStyle = '#101010'; ctx.fillRect(px + (facing < 0 ? 3 : 8), py + 3, 2, 2); // eye
    }

    // mobs (drawn after the player so they read as being in front)
    if (mobs) {
      for (const m of mobs) {
        const d = MOBS[m.kind];
        const mx = m.x - cam.x, my = m.y - cam.y;
        ctx.fillStyle = '#1A1410'; ctx.fillRect(mx - 1, my - 1, m.w + 2, m.h + 2);
        ctx.fillStyle = m.hurtT > 0 ? '#FFFFFF' : d.color;
        ctx.fillRect(mx, my, m.w, m.h);
        ctx.fillStyle = '#101010'; ctx.fillRect(mx + 2, my + 3, 2, 2); ctx.fillRect(mx + m.w - 4, my + 3, 2, 2);
        ctx.fillStyle = '#000000'; ctx.fillRect(mx, my - 5, m.w, 3);
        ctx.fillStyle = '#E04A4A'; ctx.fillRect(mx, my - 5, m.w * Math.max(0, m.hp / m.maxHp), 3);
      }
    }

    // debris particles (pooled, capped)
    if (particles) {
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - cam.x, p.y - cam.y, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    // target highlight
    if (player && player.target) {
      const t = player.target;
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1;
      ctx.strokeRect(t.tx * TILE - cam.x + 0.5, t.ty * TILE - cam.y + 0.5, TILE - 1, TILE - 1);
      if (t.progress > 0) {
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(t.tx * TILE - cam.x, t.ty * TILE - cam.y, TILE * Math.min(1, t.progress), 3);
      }
    }

    // lightmap (multiply) — 10Hz on PC, 5Hz on mobile
    this.lightTimer += dt;
    const period = this.mobile ? 0.2 : 0.1;
    if (this.lightTimer >= period || !this.lightRect) { this.updateLightmap(cam.x, cam.y); this.lightTimer = 0; }
    if (this.lightRect) {
      const { t0x, t0y, cols, rows } = this.lightRect;
      ctx.globalCompositeOperation = 'multiply';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.lightCv, t0x * TILE - cam.x, t0y * TILE - cam.y, cols * TILE, rows * TILE);
      ctx.imageSmoothingEnabled = false;
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();

    // day/night colour grade
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${sky.tint[0]},${sky.tint[1]},${sky.tint[2]})`;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';
  }
}
