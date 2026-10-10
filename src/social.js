// social.js — chat messages, media capture, sharing in-game resources
//
// IMPORTANT / 能力边界：这是一个**客户端**实现。消息写进 IndexedDB 的 chat store，
// 同一个设备同一个浏览器里可见。要让"其他玩家也看到"，必须接一个服务端
// （WebSocket 转发 + 媒体对象存储）——静态 Pages 与 Cordova 包里没有服务端，
// 两个手机之间不会自动互通。为此这里留了 `attachRemote(transport)` 接口：
// 只要实现 { send(msg) -> Promise, onMessage(cb) } 就能接上，UI 与数据层不用改。
import { idbPut, idbAll, STORE_CHAT } from './db.js';

export const MSG = {
  TEXT: 'text', IMAGE: 'image', VIDEO: 'video', AUDIO: 'audio', ITEM: 'item', LOCATION: 'location',
};

export function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export class MessageBus {
  constructor() {
    this.listeners = new Set();
    this.remote = null;         // transport: { send(msg): Promise, onMessage(cb): void }
    this.remoteError = null;
    this.offlineOnly = false;   // set by the host when no transport is configured
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(msg) { for (const fn of this.listeners) fn(msg); }

  async send(partial) {
    const rec = { id: newId(), ts: Date.now(), sender: 'me', type: MSG.TEXT, text: '', ...partial };
    try { await idbPut(STORE_CHAT, rec); } catch (e) { /* storage full / unavailable: keep in memory */ }
    this.emit(rec);
    if (this.remote && typeof this.remote.send === 'function') {
      try { await this.remote.send(rec); } catch (e) { this.remoteError = String((e && e.message) || e); }
    }
    return rec;
  }

  async history(limit = 100) {
    try { return await idbAll(STORE_CHAT, limit); } catch { return []; }
  }

  /** attach a multiplayer transport; messages received from it land in the same feed */
  attachRemote(transport) {
    this.remote = transport;
    this.offlineOnly = false;
    if (typeof transport.onMessage === 'function') {
      transport.onMessage((m) => {
        const rec = { id: m.id || newId(), ts: m.ts || Date.now(), sender: m.sender || 'player', ...m };
        this.emit(rec);
        idbPut(STORE_CHAT, rec).catch(() => {});
      });
    }
  }
}

/* ---------------- media capture ---------------- */
export const canRecord = () => typeof MediaRecorder !== 'undefined';
export const canCaptureStream = (canvas) => canRecord() && typeof canvas.captureStream === 'function';

function pickMime(kind) {
  const candidates = kind === 'video'
    ? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const c of candidates) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
  return '';
}

/** screenshot of the game canvas -> PNG blob */
export function capturePhoto(canvas) {
  return new Promise((res, rej) => {
    if (!canvas.toBlob) { rej(new Error('canvas.toBlob unavailable')); return; }
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png');
  });
}

/** record the canvas for `ms` milliseconds -> video blob */
export function recordVideo(canvas, ms = 6000) {
  return new Promise((res, rej) => {
    if (!canCaptureStream(canvas)) { rej(new Error('此环境不支持录屏（canvas.captureStream 不可用）')); return; }
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, pickMime('video') ? { mimeType: pickMime('video') } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => res(new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'video/webm' }));
    rec.onerror = (e) => rej(e.error || new Error('recorder error'));
    rec.start();
    setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, ms);
  });
}

/** record microphone for `ms` milliseconds -> audio blob */
export async function recordAudio(ms = 6000) {
  if (!canRecord()) throw new Error('此环境不支持 MediaRecorder');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('没有麦克风权限接口');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream, pickMime('audio') ? { mimeType: pickMime('audio') } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => {
    rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); res(new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'audio/webm' })); };
  });
  rec.start();
  setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, ms);
  return done;
}

/** let the player pick an image from the device */
export function pickImage() {
  return new Promise((res, rej) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => (input.files && input.files[0] ? res(input.files[0]) : rej(new Error('未选择文件')));
    input.click();
  });
}
