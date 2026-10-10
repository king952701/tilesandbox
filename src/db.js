// db.js — single IndexedDB handle for the whole game
// DB version 2 adds the 'chat' store. World/player save records stay at v:1 (ADR-0006);
// the record schema is untouched, only a second object store was added.
export const DB_NAME = 'tilesandbox';
export const DB_VER = 2;
export const STORE_SAVES = 'saves';   // keyPath: saveId  — world edits + player state
export const STORE_CHAT = 'chat';     // keyPath: id (autoIncrement) — chat messages

let dbPromise = null;
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SAVES)) db.createObjectStore(STORE_SAVES, { keyPath: 'saveId' });
      if (!db.objectStoreNames.contains(STORE_CHAT)) db.createObjectStore(STORE_CHAT, { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbPromise;
}

export async function idbPut(store, rec) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(rec);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}

export async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const rq = tx.objectStore(store).get(key);
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error);
  });
}

export async function idbAll(store, limit = 200) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const out = [];
    const tx = db.transaction(store, 'readonly');
    const rq = tx.objectStore(store).openCursor(null, 'prev');
    rq.onsuccess = () => {
      const cur = rq.result;
      if (!cur || out.length >= limit) { res(out); return; }
      out.push(cur.value);
      cur.continue();
    };
    rq.onerror = () => rej(rq.error);
  });
}

export async function idbDelete(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}
