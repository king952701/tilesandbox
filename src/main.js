// main.js — 装配、输入（键盘/触控）、HUD、主循环
import { World, TILE, WTX, WTY, CH, CHX, CHY, idx } from './core.js';
import { TILES, ITEMS, RECIPES, DAY_SECONDS } from './data.js';
import { buildAtlas, ATLAS } from './atlas.js';
import { Renderer } from './render.js';
import { Game } from './game.js';
import { generateChunk } from './world.js';
import { MessageBus } from './social.js';
import { ChatUI } from './chatui.js';

const MOBILE = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const params = new URLSearchParams(location.search);
const SEED = (() => { const s = params.get('seed'); return s ? (parseInt(s, 10) || 20250101) >>> 0 : 20250101; })();

const canvas = document.getElementById('game');
const world = new World(SEED);
buildAtlas();
const renderer = new Renderer(canvas, world, { mobile: MOBILE, zoom: 2 });
const game = new Game(world);

const cam = { x: 0, y: 0 };
const hud = {
  hotbar: document.getElementById('hotbar'),
  clock: document.getElementById('clock'),
  toast: document.getElementById('toast'),
  craft: document.getElementById('craft'),
  rotate: document.getElementById('rotate'),
  stick: document.getElementById('stick'),
  knob: document.getElementById('knob'),
  btnJump: document.getElementById('btnJump'),
  btnAttack: document.getElementById('btnAttack'),
  btnPlace: document.getElementById('btnPlace'),
  btnCraft: document.getElementById('btnCraft'),
  hpBar: document.querySelector('#hpBar i'),
  foodBar: document.querySelector('#foodBar i'),
  chatBtn: document.getElementById('btnChat'),
};

/* chat: local-first. Attach a transport (WebSocket) to bus.attachRemote() for multiplayer. */
const bus = new MessageBus();
bus.offlineOnly = true;
const chat = new ChatUI({
  bus, game, canvas,
  els: {
    panel: document.getElementById('chatPanel'),
    list: document.getElementById('chatList'),
    input: document.getElementById('chatInput'),
    send: document.getElementById('chatSend'),
    close: document.getElementById('chatClose'),
    attach: document.getElementById('chatAttach'),
    inv: document.getElementById('chatInv'),
    status: document.getElementById('chatStatus'),
  },
});
chat.mount();
hud.chatBtn.addEventListener('click', toggleChat);
window.addEventListener('keydown', (e) => { if (e.code === 'KeyC') toggleChat(); });

function toggleChat() {
  const p = document.getElementById('chatPanel');
  const show = p.style.display !== 'flex';
  p.style.display = show ? 'flex' : 'none';
  if (show) document.getElementById('chatInput').focus();
}

game.onToast = (m) => { hud.toast.textContent = m; hud.toast.style.opacity = '1'; setTimeout(() => { hud.toast.style.opacity = '0'; }, 1800); };
game.onHud = renderHotbar;

function renderHotbar() {
  let html = '';
  for (let i = 0; i < 9; i++) {
    const it = game.hotbar[i];
    const def = it ? ITEMS[it] : null;
    const n = it ? (game.inv.get(it) || 0) : 0;
    html += `<div class="slot${i === game.sel ? ' sel' : ''}" data-i="${i}">${def ? def.name : ''}${def ? `<span>${n}</span>` : ''}</div>`;
  }
  hud.hotbar.innerHTML = html;
  for (const el of hud.hotbar.querySelectorAll('.slot')) {
    el.addEventListener('click', () => { game.sel = +el.dataset.i; renderHotbar(); });
  }
}

function renderCraft() {
  let html = '<h3>合成</h3>';
  for (const r of RECIPES) {
    const need = r.inputs.map((i) => `${ITEMS[i.item].name}×${i.count}`).join(' + ');
    const have = r.inputs.every((i) => (game.inv.get(i.item) || 0) >= i.count);
    html += `<div class="row${have ? '' : ' off'}" data-id="${r.id}"><b>${ITEMS[r.outputs[0].item].name}</b><span>${need}</span></div>`;
  }
  html += '<div class="hint">按 E 关闭</div>';
  hud.craft.innerHTML = html;
  for (const el of hud.craft.querySelectorAll('.row')) {
    el.addEventListener('click', () => { game.craft(el.dataset.id); renderCraft(); renderHotbar(); });
  }
}

/* ---------------- input ---------------- */
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyE') { hud.craft.style.display = hud.craft.style.display === 'block' ? 'none' : 'block'; if (hud.craft.style.display === 'block') renderCraft(); }
  if (e.code >= 'Digit1' && e.code <= 'Digit9') { game.sel = +e.code.slice(5) - 1; renderHotbar(); }
  if (e.code === 'KeyF') game.attack();
  if (e.code === 'KeyR') { const it = game.hotbar[game.sel]; if (it) game.eat(it); }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));

function screenToWorld(sx, sy) {
  const z = renderer.zoom;
  return { x: cam.x + sx / z, y: cam.y + sy / z };
}

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  const w = screenToWorld(e.clientX - r.left, e.clientY - r.top);
  game.aim(w.x, w.y);
});
canvas.addEventListener('pointerdown', (e) => {
  if (MOBILE) return;                       // touch is handled by the stick / buttons
  const r = canvas.getBoundingClientRect();
  const w = screenToWorld(e.clientX - r.left, e.clientY - r.top);
  game.aim(w.x, w.y);
  if (e.button === 0) game.intent.dig = true;
  if (e.button === 2) game.intent.place = true;
});
addEventListener('pointerup', () => { game.intent.dig = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* touch: left half = stick, right half = aim + dig, buttons = jump / place / craft */
if (MOBILE) {
  let stickId = null, digId = null;
  const setKnob = (dx, dy) => { hud.knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (sx < r.width * 0.45) {
      stickId = e.pointerId;
      hud.stick.dataset.ox = sx; hud.stick.dataset.oy = sy;
      hud.stick.style.left = (sx - 56) + 'px'; hud.stick.style.top = (sy - 56) + 'px';
      hud.stick.style.display = 'block';
    } else {
      digId = e.pointerId;
      const w = screenToWorld(sx, sy);
      game.aim(w.x, w.y);
      game.intent.dig = true;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (e.pointerId === stickId) {
      const ox = +hud.stick.dataset.ox, oy = +hud.stick.dataset.oy;
      const dx = Math.max(-48, Math.min(48, sx - ox)), dy = Math.max(-48, Math.min(48, sy - oy));
      setKnob(dx, dy);
      game.intent.move = Math.abs(dx) > 8 ? Math.sign(dx) : 0;
      game.intent.jump = dy < -30;
    } else if (e.pointerId === digId) {
      const w = screenToWorld(sx, sy);
      game.aim(w.x, w.y);
    }
  });
  const endPointer = (e) => {
    if (e.pointerId === stickId) { stickId = null; game.intent.move = 0; setKnob(0, 0); hud.stick.style.display = 'none'; }
    if (e.pointerId === digId) { digId = null; game.intent.dig = false; }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  for (const b of [hud.btnJump, hud.btnAttack, hud.btnPlace, hud.btnCraft, hud.chatBtn]) b.style.display = 'flex';
  hud.btnJump.style.display = 'flex';
  hud.btnAttack.style.display = 'flex';
  hud.btnAttack.addEventListener('click', () => game.attack());
  hud.btnJump.addEventListener('click', () => { game.intent.jump = true; });
  hud.btnPlace.addEventListener('click', () => { game.intent.place = true; });
  hud.btnCraft.addEventListener('click', () => {
    hud.craft.style.display = hud.craft.style.display === 'block' ? 'none' : 'block';
    if (hud.craft.style.display === 'block') renderCraft();
  });
}

function readKeys() {
  if (MOBILE) return;
  let m = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) m -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) m += 1;
  game.intent.move = m;
  if (keys.has('Space') || keys.has('KeyW') || keys.has('ArrowUp')) game.intent.jump = true;
}

/* ---------------- resize / lifecycle ---------------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.resize(w, h);
  const portrait = h > w;
  if (MOBILE && portrait) hud.rotate.style.display = 'flex'; else hud.rotate.style.display = 'none';
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));

let paused = false;
document.addEventListener('visibilitychange', () => {
  paused = document.hidden;
  if (paused) game.save();
});
addEventListener('pagehide', () => game.save());
document.addEventListener('pause', () => game.save(), false);   // Cordova

/* ---------------- loop ---------------- */
let last = performance.now();
let acc = 0, frames = 0, worst = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (paused) { last = now; return; }
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;                    // never let a background tab teleport the world
  const t0 = performance.now();

  readKeys();
  game.update(dt);
  game.ensureChunks(game.player.x, game.player.y, 1);

  const z = renderer.zoom;
  const vw = renderer.w / z, vh = renderer.h / z;
  cam.x = game.player.x + game.player.w / 2 - vw / 2;
  cam.y = game.player.y + game.player.h / 2 - vh / 2;
  cam.x = Math.max(0, Math.min(WTX * TILE - vw, cam.x));
  cam.y = Math.max(0, Math.min(WTY * TILE - vh, cam.y));

  renderer.draw(cam, game.player, game.seconds, dt, game.mobs, game.particles, game.facing);
  hud.hpBar.style.width = Math.max(0, (game.player.hp / 100) * 100) + '%';
  hud.foodBar.style.width = Math.max(0, game.hunger.value) + '%';

  const ms = performance.now() - t0;
  worst = Math.max(worst, ms); frames++; acc += ms;
  if (acc > 1000) {
    const fps = Math.round(frames * 1000 / acc);
    const hh = Math.floor((game.seconds / DAY_SECONDS) * 24);
    hud.clock.textContent = String(hh).padStart(2, '0') + ':00';
    if (window.__tsDebug) console.log(`fps=${fps} frame=${(acc / frames).toFixed(2)}ms worst=${worst.toFixed(1)}ms quads=${renderer.cache.size}`);
    acc = 0; frames = 0; worst = 0;
  }
}

/* ---------------- boot ---------------- */
(async function boot() {
  resize();
  game.spawn();
  const loaded = await game.load();
  if (!loaded) { game.addInv('wood', 20); game.addInv('fiber', 5); }
  renderHotbar();
  console.log(`[TILESANDBOX] seed=${SEED} mobile=${MOBILE} zoom=${renderer.zoom} dpr=${renderer.dpr} atlas=${ATLAS.canvas ? 'ok' : 'MISSING'} saved=${loaded}`);
  if (!ATLAS.canvas) console.error('[TILESANDBOX] atlas failed to build — tiles would be blank');
  requestAnimationFrame(frame);
})();

window.__ts = { world, game, renderer, cam, SEED };
