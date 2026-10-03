// Archivio locale (IndexedDB). Tutto resta nel browser finché non sincronizzi
// con una cartella o esporti un backup.

const DB_NAME = 'aula';
const DB_VERSION = 1;
export const STORES = ['courses', 'lectures', 'items'];

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('recchunks')) {
        const rc = db.createObjectStore('recchunks', { keyPath: 'seq', autoIncrement: true });
        rc.createIndex('recId', 'recId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let out;
    Promise.resolve(fn(t.objectStore(store))).then(v => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function all(store) {
  return tx(store, 'readonly', s => wrap(s.getAll()));
}

export async function get(store, id) {
  return tx(store, 'readonly', s => wrap(s.get(id)));
}

// Scrive un record aggiornando updatedAt (a meno che keepTime sia true, usato dal merge).
export async function put(store, rec, keepTime = false) {
  if (!keepTime) rec.updatedAt = Date.now();
  if (!rec.createdAt) rec.createdAt = rec.updatedAt || Date.now();
  await tx(store, 'readwrite', s => wrap(s.put(rec)));
  if (!keepTime) changed(store, rec);
  return rec;
}

// Cancellazione "morbida": resta una lapide per propagare la cancellazione con la sync.
export async function remove(store, id) {
  const rec = await get(store, id);
  if (!rec) return;
  const tomb = { id, deleted: true, createdAt: rec.createdAt, updatedAt: Date.now() };
  if (store === 'items') tomb.lectureId = rec.lectureId;
  await tx(store, 'readwrite', s => wrap(s.put(tomb)));
  changed(store, tomb);
}

export async function putBlob(blob, id = uid()) {
  await tx('blobs', 'readwrite', s => wrap(s.put({ id, blob, type: blob.type, size: blob.size })));
  return id;
}

export async function getBlobLocal(id) {
  const r = await tx('blobs', 'readonly', s => wrap(s.get(id)));
  return r ? r.blob : null;
}

export async function hasBlob(id) {
  const k = await tx('blobs', 'readonly', s => wrap(s.getKey(id)));
  return k !== undefined;
}

export async function blobKeys() {
  return tx('blobs', 'readonly', s => wrap(s.getAllKeys()));
}

export async function deleteBlob(id) {
  return tx('blobs', 'readwrite', s => wrap(s.delete(id)));
}

export async function kvGet(key, def = null) {
  const r = await tx('kv', 'readonly', s => wrap(s.get(key)));
  return r ? r.value : def;
}

export async function kvSet(key, value) {
  return tx('kv', 'readwrite', s => wrap(s.put({ key, value })));
}

// --- Spezzoni di registrazione: salvati ogni pochi secondi, così un crash
// del browser o una batteria scarica non fanno perdere la lezione.
export async function addRecChunk(recId, blob, meta) {
  return tx('recchunks', 'readwrite', s => wrap(s.add({ recId, blob, meta, at: Date.now() })));
}

export async function getRecChunks(recId) {
  const rows = await tx('recchunks', 'readonly', s => wrap(s.index('recId').getAll(recId)));
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function pendingRecIds() {
  const ids = new Set();
  await tx('recchunks', 'readonly', s => new Promise((resolve, reject) => {
    const req = s.index('recId').openKeyCursor(null, 'nextunique');
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      ids.add(c.key);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }));
  return [...ids];
}

export async function clearRecChunks(recId) {
  const rows = await getRecChunks(recId);
  await tx('recchunks', 'readwrite', s => Promise.all(rows.map(r => wrap(s.delete(r.seq)))));
}

export async function wipeAll() {
  const db = await open();
  db.close();
  dbp = null;
  await wrap(indexedDB.deleteDatabase(DB_NAME));
}

// --- Notifica modifiche (usata per l'autosync)
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed(store, rec) { for (const fn of listeners) fn(store, rec); }
