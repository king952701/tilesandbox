// chatui.js — 内置聊天面板：文字 / 拍照 / 录像 / 录音 / 图片 / 分享背包物品与坐标
import { MSG, capturePhoto, recordVideo, recordAudio, pickImage, canRecord, canCaptureStream } from './social.js';
import { ITEMS } from './data.js';

export class ChatUI {
  constructor({ bus, game, canvas, els }) {
    this.bus = bus;
    this.game = game;
    this.canvas = canvas;
    this.els = els;
    this.urls = new Map();       // message id -> object URL (revoked on unload)
    this.recording = null;
  }

  mount() {
    const e = this.els;
    this.bus.on((m) => this.append(m));
    this.history();

    e.send.addEventListener('click', () => this.sendText());
    e.input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') this.sendText(); });
    e.close.addEventListener('click', () => { e.panel.style.display = 'none'; });

    for (const btn of e.attach.querySelectorAll('button[data-a]')) {
      btn.addEventListener('click', () => this.onAttach(btn.dataset.a));
    }
    addEventListener('unload', () => { for (const u of this.urls.values()) URL.revokeObjectURL(u); });

    const caps = [];
    if (!canCaptureStream(this.canvas)) caps.push('录屏不可用');
    if (!canRecord()) caps.push('录音不可用');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) caps.push('麦克风不可用');
    e.status.textContent = this.bus.remote
      ? '已连接'
      : (`离线模式（消息存本机）${caps.length ? ' · ' + caps.join(' · ') : ''}`);
  }

  async history() {
    const msgs = await this.bus.history(60);
    for (const m of msgs.reverse()) this.append(m);
  }

  sendText() {
    const text = this.els.input.value.trim();
    if (!text) return;
    this.els.input.value = '';
    this.bus.send({ type: MSG.TEXT, text });
  }

  async onAttach(kind) {
    const e = this.els;
    try {
      if (kind === 'photo') {
        const blob = await capturePhoto(this.canvas);
        await this.bus.send({ type: MSG.IMAGE, blob, text: '截图' });
        this.game.toast('已拍照并发送到聊天');
      } else if (kind === 'video') {
        if (this.recording) { this.game.toast('正在录制中'); return; }
        this.game.toast('开始录屏 6 秒…');
        const p = recordVideo(this.canvas, 6000);
        this.recording = p;
        const blob = await p;
        this.recording = null;
        await this.bus.send({ type: MSG.VIDEO, blob, text: '录像' });
        this.game.toast('录像已发送');
      } else if (kind === 'audio') {
        this.game.toast('开始录音 6 秒…');
        const blob = await recordAudio(6000);
        await this.bus.send({ type: MSG.AUDIO, blob, text: '语音' });
        this.game.toast('语音已发送');
      } else if (kind === 'image') {
        const file = await pickImage();
        await this.bus.send({ type: MSG.IMAGE, blob: file, text: file.name || '图片' });
        this.game.toast('图片已发送');
      } else if (kind === 'item') {
        this.showInventory();
      } else if (kind === 'loc') {
        const p = this.game.player;
        await this.bus.send({
          type: MSG.LOCATION, text: '我的位置',
          tx: Math.floor(p.x / 16), ty: Math.floor(p.y / 16),
        });
        this.game.toast('位置已发送');
      }
    } catch (err) {
      this.game.toast(String((err && err.message) || err));
    }
  }

  showInventory() {
    const box = this.els.inv;
    box.innerHTML = '';
    const entries = [...this.game.inv];
    if (!entries.length) { box.innerHTML = '<div class="hint">背包是空的</div>'; return; }
    for (const [id, n] of entries) {
      const b = document.createElement('button');
      b.className = 'itemBtn';
      b.textContent = `${ITEMS[id] ? ITEMS[id].name : id} ×${n}`;
      b.addEventListener('click', () => {
        this.bus.send({ type: MSG.ITEM, itemId: id, count: n, text: `分享了 ${ITEMS[id] ? ITEMS[id].name : id} ×${n}` });
        box.innerHTML = '';
        this.game.toast('物品已分享到聊天');
      });
      box.appendChild(b);
    }
  }

  append(m) {
    const e = this.els;
    const row = document.createElement('div');
    row.className = 'msg' + (m.sender === 'me' ? ' me' : '');
    const head = document.createElement('div');
    head.className = 'who';
    const t = new Date(m.ts || Date.now());
    head.textContent = `${m.sender === 'me' ? '我' : m.sender} · ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    row.appendChild(head);

    const body = document.createElement('div');
    body.className = 'body';
    if (m.type === MSG.TEXT || m.type === MSG.ITEM || m.type === MSG.LOCATION) {
      body.textContent = m.text || '';
      if (m.type === MSG.LOCATION && m.tx !== undefined) body.textContent += ` (${m.tx}, ${m.ty})`;
    } else if (m.blob) {
      const url = URL.createObjectURL(m.blob);
      this.urls.set(m.id, url);
      if (m.type === MSG.IMAGE) {
        const img = document.createElement('img');
        img.src = url; img.alt = m.text || '图片';
        body.appendChild(img);
      } else if (m.type === MSG.VIDEO) {
        const v = document.createElement('video');
        v.src = url; v.controls = true; v.playsInline = true;
        body.appendChild(v);
      } else if (m.type === MSG.AUDIO) {
        const a = document.createElement('audio');
        a.src = url; a.controls = true;
        body.appendChild(a);
      }
    } else {
      body.textContent = m.text || '(空消息)';
    }
    row.appendChild(body);
    e.list.appendChild(row);
    e.list.scrollTop = e.list.scrollHeight;
  }
}
