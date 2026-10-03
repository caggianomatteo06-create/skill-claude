// Portabilità dei dati tra dispositivi:
//  1. Cartella sincronizzata (File System Access API, Chrome/Edge): scegli una
//     cartella dentro OneDrive / Google Drive / Dropbox o una chiavetta USB.
//     L'app ci scrive aula-data.json + media/ + gli appunti in Markdown leggibili.
//  2. Backup ZIP: un unico file da scaricare e reimportare su un altro PC.
import * as db from './db.js';

const FFLATE = '../vendor/fflate.js';
const DATA_FILE = 'aula-data.json';
const FORMAT = 1;

export const fsSupported = 'showDirectoryPicker' in window;

let dirHandle = null;

export async function loadFolder() {
  dirHandle = await db.kvGet('folderHandle');
  return dirHandle;
}

export function folderName() { return dirHandle ? dirHandle.name : null; }

export async function folderPermission(request = false) {
  if (!dirHandle) return 'none';
  const opts = { mode: 'readwrite' };
  let p = await dirHandle.queryPermission(opts);
  if (p !== 'granted' && request) p = await dirHandle.requestPermission(opts);
  return p;
}

export async function chooseFolder() {
  dirHandle = await window.showDirectoryPicker({ id: 'aula', mode: 'readwrite' });
  await db.kvSet('folderHandle', dirHandle);
  return dirHandle;
}

export async function forgetFolder() {
  dirHandle = null;
  await db.kvSet('folderHandle', null);
}

// ---------- merge (vince la modifica più recente, record per record)

async function localSnapshot() {
  const out = { format: FORMAT, app: 'aula', exportedAt: Date.now() };
  for (const s of db.STORES) out[s] = await db.all(s);
  return out;
}

// Se una nota locale viene sovrascritta da una versione diversa, la vecchia
// finisce nella cronologia della lezione: nessuna riga va mai persa.
function keepHistory(winner, loser) {
  if (!loser || loser.deleted || winner.deleted) return winner;
  if ((loser.notes || '') === (winner.notes || '') || !loser.notes) return winner;
  const hist = [...(winner.history || [])];
  if (!hist.some(h => h.notes === loser.notes)) {
    hist.unshift({ at: loser.updatedAt, notes: loser.notes, reason: 'sync' });
  }
  return { ...winner, history: hist.slice(0, 15) };
}

export async function mergeIn(data) {
  if (!data || data.app !== 'aula') throw new Error('File non riconosciuto');
  let n = 0;
  for (const s of db.STORES) {
    for (const rec of data[s] || []) {
      const cur = await db.get(s, rec.id);
      if (!cur || (rec.updatedAt || 0) > (cur.updatedAt || 0)) {
        const next = s === 'lectures' ? keepHistory(rec, cur) : rec;
        await db.put(s, next, true);
        n++;
      }
    }
  }
  return n;
}

function blobRefs(snap) {
  const ids = new Set();
  for (const l of snap.lectures) if (!l.deleted) for (const a of l.audio || []) ids.add(a.blobId);
  for (const it of snap.items) if (!it.deleted && it.blobId) ids.add(it.blobId);
  return ids;
}

// ---------- cartella

async function readJSON(dir, name) {
  try {
    const fh = await dir.getFileHandle(name);
    return JSON.parse(await (await fh.getFile()).text());
  } catch (e) {
    if (e.name === 'NotFoundError') return null;
    throw e;
  }
}

async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

// nomi file portabili ovunque (OneDrive, Drive, chiavette FAT32…): niente accenti né simboli
const safe = s => (s || 'senza titolo').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\w .,()'+-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'senza titolo';

export async function syncFolder({ onStatus = () => {} } = {}) {
  if (!dirHandle) throw new Error('Nessuna cartella collegata');
  if ((await folderPermission(false)) !== 'granted') throw new Error('Permesso cartella non concesso');

  onStatus('Leggo la cartella…');
  const remote = await readJSON(dirHandle, DATA_FILE);
  const pulled = remote ? await mergeIn(remote) : 0;

  onStatus('Scrivo i dati…');
  const snap = await localSnapshot();
  await writeFile(dirHandle, DATA_FILE, JSON.stringify(snap));

  // media mancanti nella cartella
  const media = await dirHandle.getDirectoryHandle('media', { create: true });
  const local = new Set(await db.blobKeys());
  let pushed = 0;
  for (const id of blobRefs(snap)) {
    if (!local.has(id) || (await exists(media, id))) continue;
    onStatus(`Copio file ${++pushed}…`);
    await writeFile(media, id, await db.getBlobLocal(id));
  }

  // appunti leggibili anche senza l'app
  onStatus('Esporto gli appunti in Markdown…');
  await writeMarkdown(snap);

  await db.kvSet('lastSync', Date.now());
  onStatus('');
  return { pulled, pushed };
}

async function writeMarkdown(snap) {
  const last = (await db.kvGet('lastMdExport')) || 0;
  const courses = Object.fromEntries(snap.courses.map(c => [c.id, c]));
  const root = await dirHandle.getDirectoryHandle('Appunti', { create: true });
  for (const l of snap.lectures) {
    if (l.deleted || (l.updatedAt || 0) <= last) continue;
    const c = courses[l.courseId];
    const dir = await root.getDirectoryHandle(safe(c && !c.deleted ? c.name : 'Senza corso'), { create: true });
    const items = snap.items.filter(i => i.lectureId === l.id && !i.deleted);
    try {
      await writeFile(dir, `${l.date || ''} ${safe(l.title)}.md`.trim(), lectureMarkdown(l, c, items));
    } catch (e) {
      console.warn('Markdown non scritto per', l.title, e);
    }
  }
  await db.kvSet('lastMdExport', Date.now());
}

// Legge un blob: prima dal browser, poi (se manca) dalla cartella collegata.
export async function getBlob(id) {
  const b = await db.getBlobLocal(id);
  if (b) return b;
  if (!dirHandle || (await folderPermission(false)) !== 'granted') return null;
  try {
    const media = await dirHandle.getDirectoryHandle('media');
    const f = await (await media.getFileHandle(id)).getFile();
    const blob = new Blob([await f.arrayBuffer()], { type: f.type });
    await db.putBlob(blob, id);
    return blob;
  } catch {
    return null;
  }
}

// ---------- Markdown

export const fmtTime = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(x).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export function lectureMarkdown(l, course, items = [], { transcript = true } = {}) {
  const out = [`# ${l.title || 'Lezione'}`, ''];
  const meta = [course ? `**Corso:** ${course.name}` : '', l.date ? `**Data:** ${l.date}` : '',
    (l.tags || []).length ? `**Tag:** ${l.tags.join(', ')}` : ''].filter(Boolean);
  if (meta.length) out.push(meta.join(' · '), '');
  out.push('## Appunti', '', l.notes || '_(nessun appunto)_', '');
  const links = items.filter(i => i.kind === 'link');
  const files = items.filter(i => i.kind !== 'link');
  if (links.length) {
    out.push('## Link', '');
    for (const i of links) out.push(`- [${i.name || i.url}](${i.url})${i.caption ? ' — ' + i.caption : ''}`);
    out.push('');
  }
  if (files.length) {
    out.push('## Allegati', '');
    for (const i of files) out.push(`- ${i.name}${i.caption ? ' — ' + i.caption : ''}`);
    out.push('');
  }
  for (const a of l.ai || []) out.push(`## ${a.title}`, '', a.text, '');
  if (transcript && (l.transcript || []).length) {
    out.push('## Trascrizione', '');
    for (const seg of l.transcript) out.push(`[${(seg.part ? `p${seg.part + 1} ` : '') + fmtTime(seg.start)}] ${seg.text}`);
    out.push('');
  }
  return out.join('\n');
}

// ---------- ZIP

async function fflate() { return import(FFLATE); }

// lectureIds: null = tutto, altrimenti solo quelle lezioni (+ corsi e allegati collegati)
export async function exportZip(lectureIds = null, { onStatus = () => {} } = {}) {
  const { zip } = await fflate();
  let snap = await localSnapshot();
  if (lectureIds) {
    const set = new Set(lectureIds);
    snap.lectures = snap.lectures.filter(l => set.has(l.id));
    const cids = new Set(snap.lectures.map(l => l.courseId));
    snap.courses = snap.courses.filter(c => cids.has(c.id));
    snap.items = snap.items.filter(i => set.has(i.lectureId));
  }
  const files = { [DATA_FILE]: [new TextEncoder().encode(JSON.stringify(snap)), { level: 6 }] };
  const courses = Object.fromEntries(snap.courses.map(c => [c.id, c]));
  for (const l of snap.lectures) {
    if (l.deleted) continue;
    const c = courses[l.courseId];
    const items = snap.items.filter(i => i.lectureId === l.id && !i.deleted);
    files[`Appunti/${safe(c ? c.name : 'Senza corso')}/${`${l.date || ''} ${safe(l.title)}`.trim()}.md`] =
      [new TextEncoder().encode(lectureMarkdown(l, c, items)), { level: 6 }];
  }
  let i = 0;
  const refs = [...blobRefs(snap)];
  for (const id of refs) {
    onStatus(`Preparo file ${++i}/${refs.length}…`);
    const b = await getBlob(id);
    // audio e immagini sono già compressi: level 0 = più veloce
    if (b) files[`media/${id}`] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }];
  }
  onStatus('Comprimo…');
  const data = await new Promise((res, rej) => zip(files, (err, out) => (err ? rej(err) : res(out))));
  onStatus('');
  return new Blob([data], { type: 'application/zip' });
}

export async function importZip(file, { onStatus = () => {} } = {}) {
  const { unzip } = await fflate();
  onStatus('Leggo il backup…');
  const buf = new Uint8Array(await file.arrayBuffer());
  const files = await new Promise((res, rej) => unzip(buf, (err, out) => (err ? rej(err) : res(out))));
  const raw = files[DATA_FILE];
  if (!raw) throw new Error('Nel file ZIP manca ' + DATA_FILE);
  const data = JSON.parse(new TextDecoder().decode(raw));
  const types = {};
  for (const l of data.lectures || []) for (const a of l.audio || []) types[a.blobId] = a.mime;
  for (const it of data.items || []) if (it.blobId) types[it.blobId] = it.mime;
  let n = 0;
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith('media/')) continue;
    const id = path.slice(6);
    if (!id || (await db.hasBlob(id))) continue;
    onStatus(`Importo file ${++n}…`);
    await db.putBlob(new Blob([bytes], { type: types[id] || '' }), id);
  }
  const merged = await mergeIn(data);
  onStatus('');
  return { merged, media: n };
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
