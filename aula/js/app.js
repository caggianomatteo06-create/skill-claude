import * as db from './db.js';
import * as sync from './sync.js';
import * as T from './transcribe.js';
import * as AI from './ai.js';
import { Recorder, recSupported, recoverPending } from './recorder.js';
import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';

const { fmtTime } = sync;

// ======================================================================
// Stato
// ======================================================================
const S = {
  courses: new Map(),
  lectures: new Map(),
  items: new Map(),
  rec: null,        // Recorder attivo
  live: null,       // trascrizione live attiva
  interim: '',
  job: null,        // trascrizione in corso
  dirty: false,
  syncing: false,
  syncMsg: '',
  tab: localGet('aula.tab', 'tr'),
  notesMode: 'edit',
  mobileView: 'notes',
  chat: {},         // lectureId -> [{kind, title, text, q, done, err}]
  urls: new Map(),  // blobId -> object URL
};

const DEFAULTS = {
  trEngine: 'local',
  localModel: 'onnx-community/whisper-small',
  cloudPreset: 'groq',
  cloudBase: T.CLOUD_PRESETS.groq.base,
  cloudModel: T.CLOUD_PRESETS.groq.model,
  aiModel: 'claude-opus-5-5',
  live: true,
  rememberKeys: true,
  speed: 1,
};
let settings = { ...DEFAULTS, ...JSON.parse(localGet('aula.settings', '{}')) };
let keys = JSON.parse((settings.rememberKeys ? localStorage : sessionStorage).getItem('aula.keys') || '{}');

function localGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function saveSettings() { localStorage.setItem('aula.settings', JSON.stringify(settings)); }
function saveKeys() {
  localStorage.removeItem('aula.keys');
  sessionStorage.removeItem('aula.keys');
  (settings.rememberKeys ? localStorage : sessionStorage).setItem('aula.keys', JSON.stringify(keys));
}

// ======================================================================
// Utilità
// ======================================================================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtDT = ms => new Date(ms).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtSize = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const COLORS = ['#2f5d50', '#3b6ea5', '#8a4fb0', '#b0533c', '#b58a1b', '#4f8a3b', '#a0466e', '#4a5568'];

function toast(msg, err = false, ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), err ? ms * 2 : ms);
}

async function blobUrl(blobId) {
  if (S.urls.has(blobId)) return S.urls.get(blobId);
  const b = await sync.getBlob(blobId);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  S.urls.set(blobId, u);
  return u;
}

function mediaDuration(blob) {
  return new Promise(res => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    const u = URL.createObjectURL(blob);
    const done = d => { URL.revokeObjectURL(u); res(Number.isFinite(d) ? d : 0); };
    a.onloadedmetadata = () => {
      if (a.duration !== Infinity) return done(a.duration);
      // webm registrati dal browser non hanno durata: la forziamo
      a.ontimeupdate = () => { a.ontimeupdate = null; done(a.duration); };
      a.currentTime = 1e101;
    };
    a.onerror = () => done(0);
    setTimeout(() => done(0), 15000);
    a.src = u;
  });
}

const TS_RE = /\[\[(?:p(\d+)\s+)?((?:\d+:)?\d{1,2}:\d{2})\]\]/g;
const parseClock = t => t.split(':').reduce((a, x) => a * 60 + +x, 0);

// nelle risposte di Claude anche [12:30] (parentesi singole) diventa un minuto cliccabile
const TS_LOOSE_RE = /(?<!\[)\[(?:p(\d+)\s+)?((?:\d+:)?\d{1,2}:\d{2})\](?![(\]])/g;
// quando un testo di Claude finisce negli appunti, i suoi [12:30] diventano [[12:30]]
const looseToNotes = t => (t || '').replace(TS_LOOSE_RE, (m, p, c) => `[[${p ? 'p' + p + ' ' : ''}${c}]]`);

function renderMd(src, { loose = false } = {}) {
  const btn = (m, p, t) =>
    `<button class="ts" data-act="seek" data-p="${p ? p - 1 : 0}" data-t="${parseClock(t)}">${p ? 'p' + p + ' ' : ''}${t}</button>`;
  src = (src || '').replace(TS_RE, btn);
  if (loose) src = src.replace(TS_LOOSE_RE, btn);
  let html = marked.parse(src, { breaks: true, gfm: true });
  html = html.replace(/src="aula:([\w-]+)"/g, 'data-aula="$1"');
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-act', 'data-p', 'data-t', 'data-aula', 'target'] });
}

function hydrateMd(root) {
  for (const img of $$('img[data-aula]', root)) {
    const it = S.items.get(img.dataset.aula);
    if (it && it.blobId) blobUrl(it.blobId).then(u => { if (u) img.src = u; });
    img.dataset.act = 'zoom';
  }
  for (const a of $$('a[href]', root)) { a.target = '_blank'; a.rel = 'noopener'; }
}

// ======================================================================
// Dati
// ======================================================================
async function loadState() {
  for (const [store, map] of [['courses', S.courses], ['lectures', S.lectures], ['items', S.items]]) {
    map.clear();
    for (const r of await db.all(store)) if (!r.deleted) map.set(r.id, r);
  }
}

const lecturesOf = courseId => [...S.lectures.values()]
  .filter(l => courseId === undefined || (courseId === 'none' ? !l.courseId || !S.courses.has(l.courseId) : l.courseId === courseId))
  .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
const itemsOf = lectureId => [...S.items.values()].filter(i => i.lectureId === lectureId).sort((a, b) => a.createdAt - b.createdAt);

async function saveLecture(lec) {
  // istantanea automatica degli appunti: al massimo una ogni 20 minuti di modifiche
  const h = lec.history || [];
  const lastAt = h.length ? h[0].at : (lec.createdAt || 0);
  if (lec._lastSaved && lec._lastSaved !== lec.notes && Date.now() - lastAt > 20 * 60e3) {
    lec.history = [{ at: Date.now(), notes: lec._lastSaved, reason: 'auto' }, ...h].slice(0, 15);
  }
  lec._lastSaved = lec.notes;
  const { _lastSaved, ...rec } = lec;
  await db.put('lectures', rec);
  lec.updatedAt = rec.updatedAt;
  lec.createdAt = rec.createdAt;
}
const saveLectureSoon = debounce(lec => saveLecture(lec), 700);

async function newLecture({ courseId = null, type = 'lezione', then } = {}) {
  const n = lecturesOf(courseId || 'none').filter(l => (l.type || 'lezione') === type).length + 1;
  const lec = {
    id: db.uid(), courseId, type,
    title: type === 'nota' ? 'Nuova nota' : `Lezione ${n} — ${new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}`,
    date: today(), tags: [], notes: '', transcript: [], audio: [], ai: [], history: [],
  };
  await saveLecture(lec);
  S.lectures.set(lec.id, lec);
  go(`#/l/${lec.id}`);
  if (then === 'rec') setTimeout(() => startRecording(lec.id), 50);
  if (then === 'upload') setTimeout(() => pickAudio(lec.id), 50);
  if (then === 'title') setTimeout(() => { const t = $('#lTitle'); t && (t.focus(), t.select()); }, 50);
}

async function deleteLecture(id) {
  const lec = S.lectures.get(id);
  if (!lec) return;
  for (const it of itemsOf(id)) {
    await db.remove('items', it.id);
    if (it.blobId) await db.deleteBlob(it.blobId);
    S.items.delete(it.id);
  }
  for (const a of lec.audio || []) await db.deleteBlob(a.blobId);
  await db.remove('lectures', id);
  S.lectures.delete(id);
}

// ======================================================================
// Routing e navigazione
// ======================================================================
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function route() {
  const [, kind, id] = (location.hash || '#/').split('/');
  return { kind: kind || 'home', id: id ? decodeURIComponent(id) : null };
}

function renderNav() {
  const r = route();
  const curCourse = r.kind === 'l' ? (S.lectures.get(r.id)?.courseId || 'none') : r.kind === 'c' ? r.id : null;
  const courses = [...S.courses.values()].sort((a, b) => a.name.localeCompare(b.name));
  const count = id => lecturesOf(id).length;
  $('#nav').innerHTML = `
    <a href="#/" class="${r.kind === 'home' ? 'on' : ''}">🗂 Tutte le lezioni <span class="n">${S.lectures.size}</span></a>
    <a href="#/c/none" class="${curCourse === 'none' ? 'on' : ''}">📓 Quaderno <span class="n">${count('none')}</span></a>
    <div class="sec">Corsi <button class="icon" data-act="newCourse" title="Nuovo corso">＋</button></div>
    ${courses.map(c => `<a href="#/c/${c.id}" class="${curCourse === c.id ? 'on' : ''}"><span class="sw" style="background:${esc(c.color)}"></span>${esc(c.name)}<span class="n">${count(c.id)}</span></a>`).join('')
      || '<div class="muted small" style="padding:4px 9px">Nessun corso. Creane uno con ＋</div>'}`;
  updatePill();
}

function render() {
  document.getElementById('app').classList.remove('nav-open');
  renderNav();
  const r = route();
  if (r.kind === 'l' && S.lectures.has(r.id)) return renderLecture(r.id);
  if (r.kind === 's') return renderSearch(r.id || '');
  if (r.kind === 'c' && (r.id === 'none' || S.courses.has(r.id))) return renderList(r.id);
  return renderList(undefined);
}

// ======================================================================
// Elenco lezioni
// ======================================================================
function renderList(courseId) {
  teardownPlayer();
  const c = courseId && courseId !== 'none' ? S.courses.get(courseId) : null;
  const list = lecturesOf(courseId);
  const title = c ? c.name : courseId === 'none' ? 'Quaderno' : 'Tutte le lezioni';
  const cid = c ? c.id : '';
  const empty = !S.lectures.size && !S.courses.size;
  $('#main').innerHTML = `
  <div class="page">
    <div class="page-head">
      <button class="icon only-mobile" data-act="menu" aria-label="Menu">☰</button>
      <div class="grow">
        <h1>${c ? `<span class="sw" style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${esc(c.color)};margin-right:8px"></span>` : ''}${esc(title)}</h1>
        <div class="muted small">${c && c.prof ? 'Prof. ' + esc(c.prof) + ' · ' : ''}${courseId === 'none' ? 'Lezioni e note senza corso · ' : ''}${list.length} element${list.length === 1 ? 'o' : 'i'}</div>
      </div>
      <div class="row">
        ${recSupported ? `<button class="rec" data-act="newLec" data-c="${cid}" data-then="rec">● Registra lezione</button>` : ''}
        <button class="primary" data-act="newLec" data-c="${cid}" data-then="title">＋ Nuova lezione</button>
        <button data-act="newLec" data-c="${cid}" data-then="upload">⤒ Carica audio</button>
        <button data-act="newNote" data-c="${cid}">📝 Nota</button>
        ${c ? `<button class="icon" data-act="editCourse" data-id="${c.id}" title="Modifica corso">✎</button>` : ''}
      </div>
    </div>
    ${empty ? welcome() : list.length ? `<div class="lec-list">${list.map(card).join('')}</div>`
      : `<div class="card empty muted">Ancora niente qui. Registra una lezione, caricane l'audio o crea una nota.</div>`}
  </div>`;
}

function welcome() {
  return `
  <div class="card">
    <h2 style="margin-bottom:6px">Benvenuto in Aula 👋</h2>
    <p class="muted" style="margin:0">Un unico posto per le tue lezioni: registri o carichi l'audio, ottieni la trascrizione, prendi appunti collegati al minuto esatto, aggiungi foto della lavagna, slide e link, e chiedi a Claude riassunti e domande d'esame.</p>
    <div class="welcome">
      <div class="card"><h3>1 · Crea i tuoi corsi</h3><p class="muted small">Analisi, Fisica… ogni corso raccoglie le sue lezioni.</p><button data-act="newCourse">＋ Nuovo corso</button></div>
      <div class="card"><h3>2 · Registra o carica</h3><p class="muted small">Registra dal PC o dal telefono, oppure carica un file audio/video (anche le registrazioni Teams).</p>${recSupported ? '<button class="rec" data-act="newLec" data-then="rec">● Registra ora</button>' : '<button data-act="newLec" data-then="upload">⤒ Carica audio</button>'}</div>
      <div class="card"><h3>3 · Porta tutto con te</h3><p class="muted small">Collega una cartella su OneDrive/Drive o una chiavetta: ritrovi tutto sul PC dell'università.</p><button data-act="settings">☁ Sincronizzazione</button></div>
    </div>
  </div>`;
}

function card(l) {
  const c = S.courses.get(l.courseId);
  const dur = (l.audio || []).reduce((a, x) => a + (x.duration || 0), 0);
  const nImg = itemsOf(l.id).length;
  const ex = (l.notes || '').replace(TS_RE, '').replace(/[#*_>`\[\]!()-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  return `<button class="card lec-card" data-act="open" data-id="${l.id}">
    <span class="t">${l.type === 'nota' ? '📝 ' : ''}${esc(l.title || 'Senza titolo')}</span>
    <span class="m">${l.date ? `<span>${fmtDate(l.date)}</span>` : ''}${c ? `<span class="badge c"><span class="sw" style="width:8px;height:8px;border-radius:2px;background:${esc(c.color)}"></span>${esc(c.name)}</span>` : ''}</span>
    <span class="m">${dur ? `<span>🎧 ${fmtTime(dur)}</span>` : ''}${l.transcript?.length ? '<span>📝 trascritta</span>' : ''}${nImg ? `<span>📎 ${nImg}</span>` : ''}${(l.ai || []).length ? '<span>✨ ' + l.ai.length + '</span>' : ''}${S.rec && S.rec.lectureId === l.id ? '<span style="color:var(--rec)">● in registrazione</span>' : ''}</span>
    ${ex ? `<span class="ex">${esc(ex)}</span>` : ''}
    ${(l.tags || []).length ? `<span class="m">${l.tags.map(t => `<span class="badge">#${esc(t)}</span>`).join('')}</span>` : ''}
  </button>`;
}

// ======================================================================
// Pagina lezione
// ======================================================================
let P = { lectureId: null, part: 0, audio: null };

function renderLecture(id) {
  const lec = S.lectures.get(id);
  if (P.lectureId !== id) teardownPlayer();
  const courses = [...S.courses.values()].sort((a, b) => a.name.localeCompare(b.name));
  $('#main').innerHTML = `
  <div class="lec">
    <div class="lec-head">
      <div class="row" style="flex-wrap:nowrap">
        <button class="icon only-mobile" data-act="menu" aria-label="Menu">☰</button>
        <button class="icon" data-act="back" title="Indietro">←</button>
        <input class="title grow" id="lTitle" value="${esc(lec.title)}" placeholder="Titolo della lezione" aria-label="Titolo">
        <button class="icon" data-act="lecMenu" title="Altro">⋯</button>
      </div>
      <div class="meta">
        <select id="lCourse" aria-label="Corso">
          <option value="">📓 Quaderno (nessun corso)</option>
          ${courses.map(c => `<option value="${c.id}" ${c.id === lec.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          <option value="__new">＋ Nuovo corso…</option>
        </select>
        <input type="date" id="lDate" value="${esc(lec.date || '')}" aria-label="Data">
        <input type="text" id="lTags" value="${esc((lec.tags || []).join(', '))}" placeholder="tag, separati da virgola" aria-label="Tag">
      </div>
    </div>
    <div class="player" id="player"></div>
    <div class="mobile-switch">
      <button data-act="mview" data-v="notes" class="${S.mobileView === 'notes' ? 'on' : ''}">✏️ Appunti</button>
      <button data-act="mview" data-v="side" class="${S.mobileView === 'side' ? 'on' : ''}">📝 Trascrizione · 📎 · ✨</button>
    </div>
    <div class="lec-body mobile-${S.mobileView}">
      <section class="pane notes">
        <div class="toolbar">
          <button data-act="fmt" data-f="b" title="Grassetto"><b>B</b></button>
          <button data-act="fmt" data-f="i" title="Corsivo"><i>I</i></button>
          <button data-act="fmt" data-f="h" title="Titolo">H</button>
          <button data-act="fmt" data-f="ul" title="Elenco">• Elenco</button>
          <button data-act="fmt" data-f="todo" title="Da fare">☐</button>
          <button data-act="fmt" data-f="code" title="Formula / codice">∑</button>
          <span class="sep"></span>
          <button data-act="stamp" title="Inserisci il minuto attuale dell'audio (Alt+T)">⏱ Minuto</button>
          <button data-act="mark" title="Segna momento importante (Alt+M)">⭐</button>
          <button data-act="addPhoto" data-insert="1" title="Inserisci foto">🖼 Foto</button>
          <button data-act="addLink" data-insert="1" title="Inserisci link">🔗 Link</button>
          <span class="grow"></span>
          <button data-act="notesMode" title="Scrivi / Anteprima">${S.notesMode === 'edit' ? '👁 Anteprima' : '✏️ Scrivi'}</button>
        </div>
        <textarea class="notes" id="notes" placeholder="Scrivi qui i tuoi appunti…  (Markdown: # titolo, **grassetto**, - elenco)\n\nAlt+T inserisce il minuto della registrazione: cliccandolo poi riascolti quel punto.\nIncolla (Ctrl+V) una foto per inserirla." ${S.notesMode === 'edit' ? '' : 'hidden'}>${esc(lec.notes || '')}</textarea>
        <div class="md preview" id="preview" ${S.notesMode === 'edit' ? 'hidden' : ''}></div>
      </section>
      <section class="pane side">
        <div class="tabs" role="tablist">
          <button data-act="tab" data-t="tr" class="${S.tab === 'tr' ? 'on' : ''}">📝 Trascrizione <span class="muted" id="trCount"></span></button>
          <button data-act="tab" data-t="att" class="${S.tab === 'att' ? 'on' : ''}">📎 Allegati <span class="muted" id="attCount"></span></button>
          <button data-act="tab" data-t="ai" class="${S.tab === 'ai' ? 'on' : ''}">✨ Claude</button>
        </div>
        <div class="pane-body" id="sideBody"></div>
      </section>
    </div>
  </div>`;
  lec._lastSaved ??= lec.notes;
  if (S.notesMode !== 'edit') renderPreview();
  bindLectureInputs(lec);
  renderPlayer();
  renderSide();
}

function curLecture() {
  const r = route();
  return r.kind === 'l' ? S.lectures.get(r.id) : null;
}

function bindLectureInputs(lec) {
  $('#lTitle').addEventListener('input', e => { lec.title = e.target.value; saveLectureSoon(lec); });
  $('#lDate').addEventListener('change', e => { lec.date = e.target.value; saveLecture(lec); });
  $('#lTags').addEventListener('change', e => {
    lec.tags = e.target.value.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);
    saveLecture(lec);
  });
  $('#lCourse').addEventListener('change', async e => {
    if (e.target.value === '__new') {
      const c = await editCourse();
      if (c) { lec.courseId = c.id; await saveLecture(lec); }
      return render();
    }
    lec.courseId = e.target.value || null;
    await saveLecture(lec);
    renderNav();
  });
  const ta = $('#notes');
  ta.addEventListener('input', () => { lec.notes = ta.value; saveLectureSoon(lec); });
  ta.addEventListener('dragover', e => { e.preventDefault(); ta.classList.add('notes-drop'); });
  ta.addEventListener('dragleave', () => ta.classList.remove('notes-drop'));
  ta.addEventListener('drop', async e => {
    e.preventDefault();
    ta.classList.remove('notes-drop');
    if (e.dataTransfer.files.length) await addFiles(lec.id, [...e.dataTransfer.files], { insert: true });
  });
}

function renderPreview() {
  const lec = curLecture();
  const el = $('#preview');
  if (!lec || !el) return;
  el.innerHTML = renderMd(lec.notes) || '<p class="muted">Nessun appunto. Premi ✏️ Scrivi per iniziare.</p>';
  hydrateMd(el);
}

// ---------- editor
function insertAtCursor(text, { newline = false } = {}) {
  const ta = $('#notes');
  const lec = curLecture();
  if (!ta || !lec) return;
  if (S.notesMode !== 'edit') toggleNotesMode();
  const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
  let pre = ta.value.slice(0, s);
  if (newline && pre && !pre.endsWith('\n')) pre += '\n';
  ta.value = pre + text + ta.value.slice(e);
  const pos = pre.length + text.length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
  lec.notes = ta.value;
  saveLectureSoon(lec);
}

function fmt(kind) {
  const ta = $('#notes');
  if (!ta || ta.hidden) return;
  const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
  const wrap = (a, b = a) => {
    ta.setRangeText(a + (sel || 'testo') + b, s, e, 'end');
    if (!sel) ta.setSelectionRange(s + a.length, s + a.length + 5);
  };
  const prefix = p => {
    const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
    ta.setRangeText(p, ls, ls, 'end');
  };
  ({ b: () => wrap('**'), i: () => wrap('_'), code: () => wrap('`'), h: () => prefix('## '), ul: () => prefix('- '), todo: () => prefix('- [ ] ') })[kind]();
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function toggleNotesMode() {
  S.notesMode = S.notesMode === 'edit' ? 'preview' : 'edit';
  const ta = $('#notes'), pv = $('#preview');
  if (!ta) return;
  ta.hidden = S.notesMode !== 'edit';
  pv.hidden = S.notesMode === 'edit';
  $('[data-act=notesMode]').textContent = S.notesMode === 'edit' ? '👁 Anteprima' : '✏️ Scrivi';
  if (S.notesMode === 'edit') ta.focus(); else renderPreview();
}

// tempo "attuale": registrazione in corso su questa lezione, altrimenti posizione del player
function currentStamp() {
  const lec = curLecture();
  if (S.rec && lec && S.rec.lectureId === lec.id) return { part: S.rec.part, t: S.rec.elapsed() };
  if (P.audio && P.audio.src && lec && (lec.audio || []).length) return { part: P.part, t: P.audio.currentTime };
  return null;
}
const stampText = st => `[[${st.part ? `p${st.part + 1} ` : ''}${fmtTime(st.t)}]]`;

function insertStamp(star = false) {
  const st = currentStamp();
  if (!st) return toast('Nessun audio: avvia la registrazione o carica l\'audio della lezione.');
  if (star) {
    // ⭐ va sempre su una riga nuova in fondo, così non interrompe ciò che stai scrivendo
    const ta = $('#notes');
    if (ta) ta.setSelectionRange(ta.value.length, ta.value.length);
    insertAtCursor(`${stampText(st)} ⭐ `, { newline: true });
  } else insertAtCursor(stampText(st) + ' ');
}

// ======================================================================
// Player audio
// ======================================================================
function teardownPlayer() {
  if (P.audio) { P.audio.pause(); P.audio.removeAttribute('src'); P.audio.load(); }
  P = { lectureId: null, part: 0, audio: null };
}

function renderPlayer() {
  const lec = curLecture();
  const el = $('#player');
  if (!lec || !el) return;
  const parts = lec.audio || [];
  const recHere = S.rec && S.rec.lectureId === lec.id;
  const recBtn = recSupported && !S.rec ? `<button class="rec" data-act="rec">● Registra</button>` : '';
  const upBtn = !recHere ? `<button data-act="upload" title="Carica file audio o video">⤒ Carica audio</button>` : '';
  if (!parts.length) {
    el.innerHTML = recHere
      ? `<span style="color:var(--rec);font-weight:600">● Registrazione in corso</span><span class="muted small">Prendi appunti: Alt+T inserisce il minuto, ⭐ segna i momenti importanti.</span>`
      : `${recBtn}${upBtn}<span class="muted small">Registra la lezione o carica un file (mp3, m4a, wav, mp4 di Teams…)</span>`;
    P.audio = null;
    return;
  }
  if (P.lectureId !== lec.id) P = { lectureId: lec.id, part: 0, audio: null };
  if (P.part >= parts.length) P.part = 0;
  // il vecchio elemento audio (se c'era) va fermato prima di sostituirlo
  const resume = P.audio && P.audio.src ? { t: P.audio.currentTime, play: !P.audio.paused } : null;
  if (P.audio) { P.audio.pause(); P.audio.removeAttribute('src'); P.audio.load(); }
  el.innerHTML = `
    <audio id="aud" preload="metadata"></audio>
    ${parts.length > 1 ? `<select id="partSel" aria-label="Parte">${parts.map((a, i) => `<option value="${i}" ${i === P.part ? 'selected' : ''}>${i + 1}. ${esc(a.name || 'Audio')}</option>`).join('')}</select>` : ''}
    <button class="icon" data-act="skip" data-d="-10" title="Indietro 10 s (Alt+J)">⏪</button>
    <button class="primary" id="playBtn" data-act="play" title="Play/Pausa (Alt+K)">▶</button>
    <button class="icon" data-act="skip" data-d="10" title="Avanti 10 s (Alt+L)">⏩</button>
    <input type="range" class="seek" id="seek" min="0" max="1000" value="0" aria-label="Posizione">
    <span class="time" id="ptime">0:00 / ${fmtTime(parts[P.part].duration)}</span>
    <select id="speed" aria-label="Velocità">${[0.75, 1, 1.25, 1.5, 1.75, 2].map(s => `<option value="${s}" ${+settings.speed === s ? 'selected' : ''}>${s}×</option>`).join('')}</select>
    <button class="icon" data-act="partMenu" title="Opzioni audio">⋯</button>
    ${recHere ? '<span style="color:var(--rec);font-weight:600">● REC</span>' : recBtn}${upBtn}`;
  const audio = $('#aud');
  P.audio = audio;
  audio.playbackRate = +settings.speed;
  const dur = () => Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (lec.audio[P.part]?.duration || 0);
  audio.addEventListener('timeupdate', () => {
    if (P.audio !== audio) return;
    const d = dur(), sk = $('#seek'), pt = $('#ptime');
    if (sk) sk.value = d ? Math.round(audio.currentTime / d * 1000) : 0;
    if (pt) pt.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(d)}`;
    highlightSeg();
  });
  audio.addEventListener('play', () => { const b = $('#playBtn'); if (b) b.textContent = '❚❚'; });
  audio.addEventListener('pause', () => { const b = $('#playBtn'); if (b) b.textContent = '▶'; });
  $('#seek').addEventListener('input', e => { const d = dur(); if (d) audio.currentTime = e.target.value / 1000 * d; });
  $('#speed').addEventListener('change', e => { settings.speed = +e.target.value; audio.playbackRate = settings.speed; saveSettings(); });
  const ps = $('#partSel');
  if (ps) ps.addEventListener('change', e => loadPart(+e.target.value));
  loadPart(P.part, resume && resume.t + 1, resume && resume.play);
}

async function loadPart(i, seekTo = null, play = false) {
  const lec = curLecture();
  if (!lec || !P.audio) return;
  const a = lec.audio[i];
  const audio = P.audio;
  if (P.part !== i || !audio.src) {
    P.part = i;
    const u = await blobUrl(a.blobId);
    if (!u) {
      toast('Audio non presente su questo dispositivo. Collega la cartella sincronizzata o importa il backup.', true);
      return;
    }
    audio.src = u;
    audio.playbackRate = +settings.speed;
    const ps = $('#partSel');
    if (ps) ps.value = i;
    await new Promise(r => audio.addEventListener('loadedmetadata', r, { once: true }));
  }
  if (seekTo != null) audio.currentTime = Math.max(0, seekTo - 1);
  if (play) audio.play().catch(() => {});
}

function seek(part, t) {
  const lec = curLecture();
  if (S.rec && S.rec.lectureId === lec?.id && part === S.rec.part) return toast('Questo punto è nella registrazione in corso: potrai riascoltarlo dopo lo stop.');
  if (!lec || !(lec.audio || [])[part]) return toast('Audio non disponibile per questo punto.');
  if (!P.audio) return;
  loadPart(part, t, true);
}

// ======================================================================
// Pannello laterale
// ======================================================================
function renderSide() {
  const lec = curLecture();
  if (!lec || !$('#sideBody')) return;
  $('#trCount').textContent = lec.transcript?.length ? `(${lec.transcript.length})` : '';
  const ni = itemsOf(lec.id).length;
  $('#attCount').textContent = ni ? `(${ni})` : '';
  if (S.tab === 'tr') renderTranscript();
  else if (S.tab === 'att') renderAttachments();
  else renderAI();
}

// ---------- Trascrizione
let trFilter = '';
let follow = true;

function renderTranscript() {
  const lec = curLecture();
  const body = $('#sideBody');
  if (!lec || !body || S.tab !== 'tr') return;
  const segs = lec.transcript || [];
  const job = S.job && S.job.lectureId === lec.id ? S.job : null;
  const q = norm(trFilter);
  const hl = t => {
    if (!q) return esc(t);
    const n = norm(t);
    let out = '', i = 0, k;
    while ((k = n.indexOf(q, i)) !== -1) { out += esc(t.slice(i, k)) + '<mark>' + esc(t.slice(k, k + q.length)) + '</mark>'; i = k + q.length; }
    return out + esc(t.slice(i));
  };
  const shown = segs.map((s, i) => [s, i]).filter(([s]) => !q || norm(s.text).includes(q));
  const recHere = S.rec && S.rec.lectureId === lec.id;
  body.innerHTML = `
    ${job ? `<div class="job"><div class="row"><b class="grow">${esc(job.phase)}</b><button class="small" data-act="cancelJob">Annulla</button></div>
      <div class="progress ${job.pct ? '' : 'indet'}"><i style="width:${Math.round(job.pct * 100)}%"></i></div>
      <div class="muted small">Puoi continuare a usare l'app; non chiudere la scheda.</div></div>` : ''}
    <div class="tr-tools">
      <button class="primary" data-act="transcribe" ${job || !(lec.audio || []).length ? 'disabled' : ''}>🎙 Trascrivi audio</button>
      <button data-act="importTr">⤓ Importa testo/sottotitoli</button>
      ${segs.length ? `<input type="search" id="trq" placeholder="Cerca nella trascrizione" value="${esc(trFilter)}" class="grow" style="min-width:120px">
      <label class="small row" style="gap:4px"><input type="checkbox" id="follow" ${follow ? 'checked' : ''}> segui</label>
      <button class="icon" data-act="trMenu" title="Altro">⋯</button>` : ''}
    </div>
    ${segs.length ? `<div id="segs">${shown.map(([s, i]) => `
      <div class="seg ${s.src === 'live' ? 'live' : ''}" data-i="${i}">
        ${s.start != null ? `<button class="ts" data-act="seek" data-p="${s.part || 0}" data-t="${s.start}">${s.part ? 'p' + (s.part + 1) + ' ' : ''}${fmtTime(s.start)}</button>` : '<span></span>'}
        <div class="tx" contenteditable="true" spellcheck="false">${hl(s.text)}</div>
      </div>`).join('')}</div>` : !job ? `
      <div class="notice">
        <p style="margin-top:0"><b>Come ottenere la trascrizione</b></p>
        <p>🎙 <b>Dal vivo</b>: mentre registri, Chrome/Edge trascrivono in tempo reale (attivabile nelle impostazioni).</p>
        <p>💻 <b>Nel browser</b>: Whisper gira sul tuo PC, gratis e privato. La prima volta scarica il modello.</p>
        <p>☁️ <b>Cloud</b>: con una chiave Groq (gratuita) o OpenAI, un'ora di lezione si trascrive in meno di un minuto.</p>
        <p style="margin-bottom:0">⤓ <b>Importa</b>: hai già la trascrizione di Teams/Zoom (.vtt, .srt) o un testo? Importala.</p>
      </div>` : ''}
    ${recHere && S.live ? `<div class="seg live"><span class="ts">live</span><div class="tx" id="interim">${esc(S.interim) || '<span class="muted">in ascolto…</span>'}</div></div>` : ''}`;
  const trq = $('#trq');
  if (trq) trq.addEventListener('input', debounce(e => { trFilter = e.target.value; renderTranscript(); $('#trq')?.focus(); }, 250));
  const fl = $('#follow');
  if (fl) fl.addEventListener('change', e => { follow = e.target.checked; });
  for (const tx of $$('.seg .tx[contenteditable]', body)) {
    tx.addEventListener('blur', () => {
      const i = +tx.parentElement.dataset.i;
      const t = tx.textContent.trim();
      if (lec.transcript[i] && lec.transcript[i].text !== t) {
        lec.transcript[i].text = t;
        lec.transcript[i].src = lec.transcript[i].src === 'live' ? 'edit' : lec.transcript[i].src;
        saveLecture(lec);
      }
    });
  }
  if (recHere && follow) body.scrollTop = body.scrollHeight;
}

function highlightSeg() {
  if (S.tab !== 'tr' || !P.audio) return;
  const lec = curLecture();
  const t = P.audio.currentTime;
  let best = null;
  for (const el of $$('#segs .seg')) {
    const s = lec.transcript[+el.dataset.i];
    if (!s || (s.part || 0) !== P.part || s.start == null) continue;
    if (s.start <= t + 0.3) best = el; else break;
  }
  const cur = $('#segs .seg.now');
  if (cur === best) return;
  cur && cur.classList.remove('now');
  if (best) {
    best.classList.add('now');
    if (follow && !P.audio.paused && document.activeElement?.closest('.seg') == null) best.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function sortTranscript(lec) {
  lec.transcript.sort((a, b) => (a.part || 0) - (b.part || 0) || ((a.start ?? 0) - (b.start ?? 0)));
}

async function transcribeDialog() {
  const lec = curLecture();
  const parts = lec.audio || [];
  const res = await modal(`
    <h2>Trascrivi l'audio</h2>
    ${parts.length > 1 ? `<label>Quale audio<select name="part">${parts.map((a, i) => `<option value="${i}" ${i === P.part ? 'selected' : ''}>${i + 1}. ${esc(a.name)} (${fmtTime(a.duration)})</option>`).join('')}</select></label>` : '<input type="hidden" name="part" value="0">'}
    <fieldset>
      <legend>Motore</legend>
      <label class="chk"><input type="radio" name="engine" value="local" ${settings.trEngine === 'local' ? 'checked' : ''}> 💻 Nel browser (Whisper) — gratis, privato, offline dopo il primo download</label>
      <label>Modello<select name="model">${T.LOCAL_MODELS.map(m => `<option value="${m.id}" ${m.id === settings.localModel ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
      <label class="chk"><input type="radio" name="engine" value="cloud" ${settings.trEngine === 'cloud' ? 'checked' : ''}> ☁️ Cloud (${esc(T.CLOUD_PRESETS[settings.cloudPreset]?.label || 'API')}) — veloce, serve la chiave API ${keys.cloud ? '✓' : '(non impostata)'}</label>
    </fieldset>
    <label>Lingua<select name="lang">
      <option value="italian">Italiano</option><option value="english">Inglese</option><option value="spanish">Spagnolo</option><option value="french">Francese</option><option value="german">Tedesco</option>
    </select></label>
    <p class="muted small" style="margin:0">⏱ Nel browser: su un portatile normale servono circa 15-40 minuti per un'ora di lezione con "Small" (molto meno con una GPU). Con il cloud meno di un minuto.
    ${lec.transcript.some(s => (s.part || 0) === P.part) ? '<br>⚠️ La trascrizione esistente di questo audio verrà sostituita (le versioni dal vivo comprese).' : ''}</p>
    <div class="btns"><button value="cancel">Annulla</button><button value="ok" class="primary">Inizia</button></div>`);
  if (!res) return;
  const f = res.data;
  settings.trEngine = f.engine;
  if (f.engine === 'local') settings.localModel = f.model;
  saveSettings();
  if (f.engine === 'cloud' && !keys.cloud) {
    toast('Imposta prima la chiave del servizio cloud.', true);
    return openSettings('tr');
  }
  runTranscription(lec.id, +f.part, f);
}

async function runTranscription(lectureId, part, f) {
  const lec0 = S.lectures.get(lectureId);
  const blob = await sync.getBlob(lec0.audio[part].blobId);
  if (!blob) return toast('File audio non trovato su questo dispositivo.', true);
  const ac = new AbortController();
  S.job = { lectureId, part, phase: 'Preparo…', pct: 0, abort: () => { ac.abort(); T.cancelLocal(); } };
  navigator.storage?.persist?.();
  const fresh = () => S.lectures.get(lectureId);
  fresh().transcript = fresh().transcript.filter(s => (s.part || 0) !== part);
  await saveLecture(fresh());
  renderTranscript();
  const LANG = { italian: 'it', english: 'en', spanish: 'es', french: 'fr', german: 'de' };
  const opts = {
    signal: ac.signal,
    onProgress: p => { if (S.job) { S.job.phase = p.phase; S.job.pct = p.pct; } updateJobUI(); },
    onSegments: segs => {
      const lec = fresh();
      if (!lec) return;
      lec.transcript.push(...segs.map(s => ({ ...s, part, src: f.engine })));
      sortTranscript(lec);
      saveLecture(lec);
      if (curLecture()?.id === lectureId) renderSide();
    },
  };
  const t0 = performance.now();
  try {
    if (f.engine === 'cloud') {
      await T.transcribeCloud(blob, { ...opts, base: settings.cloudBase, model: settings.cloudModel, key: keys.cloud, language: LANG[f.lang] || 'it' });
    } else {
      await T.transcribeLocal(blob, { ...opts, model: f.model || settings.localModel, language: f.lang || 'italian' });
    }
    toast(`Trascrizione completata in ${fmtTime((performance.now() - t0) / 1000)} ✓`);
  } catch (e) {
    if (e.name === 'AbortError') toast('Trascrizione annullata. Le parti già fatte restano salvate.');
    else toast('Errore di trascrizione: ' + e.message, true);
  } finally {
    S.job = null;
    if (curLecture()?.id === lectureId) renderSide();
  }
}

function updateJobUI() {
  const lec = curLecture();
  if (!S.job || !lec || lec.id !== S.job.lectureId || S.tab !== 'tr') return;
  const box = $('#sideBody .job');
  if (!box) return renderTranscript();
  box.querySelector('b').textContent = S.job.phase;
  const pr = box.querySelector('.progress');
  pr.classList.toggle('indet', !S.job.pct);
  pr.querySelector('i').style.width = Math.round(S.job.pct * 100) + '%';
}

async function importTranscript() {
  const lec = curLecture();
  const parts = lec.audio || [];
  const res = await modal(`
    <h2>Importa trascrizione</h2>
    <p class="muted small" style="margin:0">Incolla il testo o scegli un file .vtt / .srt / .txt (es. la trascrizione di Teams o Zoom). I tempi vengono riconosciuti automaticamente.</p>
    <label>File<input type="file" name="file" accept=".vtt,.srt,.txt,.md,text/*"></label>
    <label>…oppure incolla il testo<textarea name="text" placeholder="[00:01] Buongiorno a tutti…"></textarea></label>
    ${parts.length > 1 ? `<label>Si riferisce all'audio<select name="part">${parts.map((a, i) => `<option value="${i}">${i + 1}. ${esc(a.name)}</option>`).join('')}</select></label>` : '<input type="hidden" name="part" value="0">'}
    <label class="chk"><input type="checkbox" name="replace" checked> Sostituisci la trascrizione esistente di quell'audio</label>
    <div class="btns"><button value="cancel">Annulla</button><button value="ok" class="primary">Importa</button></div>`);
  if (!res) return;
  const file = res.form.elements.file.files[0];
  const text = file ? await file.text() : res.data.text;
  if (!text || !text.trim()) return;
  const part = +res.data.part;
  const segs = T.parseTranscriptText(text).map(s => ({ ...s, part, src: 'import' }));
  if (res.data.replace) lec.transcript = lec.transcript.filter(s => (s.part || 0) !== part);
  lec.transcript.push(...segs);
  sortTranscript(lec);
  await saveLecture(lec);
  toast(`Importati ${segs.length} segmenti`);
  renderSide();
}

// ---------- Allegati
function renderAttachments() {
  const lec = curLecture();
  const body = $('#sideBody');
  if (!lec || !body || S.tab !== 'att') return;
  const items = itemsOf(lec.id);
  const imgs = items.filter(i => i.kind === 'image');
  const files = items.filter(i => i.kind === 'file');
  const links = items.filter(i => i.kind === 'link');
  const at = i => i.at ? `<button class="ts" data-act="seek" data-p="${i.at.part}" data-t="${i.at.t}">${i.at.part ? 'p' + (i.at.part + 1) + ' ' : ''}${fmtTime(i.at.t)}</button> ` : '';
  const icon = m => /pdf/.test(m) ? '📕' : /presentation|powerpoint/.test(m) ? '📊' : /sheet|excel|csv/.test(m) ? '📗' : /word|document/.test(m) ? '📘' : /audio/.test(m) ? '🎧' : /video/.test(m) ? '🎬' : '📄';
  body.innerHTML = `
    <div class="att-add">
      <button data-act="addPhoto">📷 Foto</button>
      <button data-act="addFile">📎 File / slide</button>
      <button data-act="addLink">🔗 Link</button>
    </div>
    <div class="dropzone" id="drop">Trascina qui foto, PDF, slide… oppure incolla (Ctrl+V) un'immagine o un link</div>
    ${imgs.length ? `<h3 style="margin:16px 0 8px;font-size:14px">Foto (${imgs.length})</h3><div class="att-grid">${imgs.map(i => `
      <div class="att-img" data-id="${i.id}">
        <img data-blob="${i.blobId}" alt="${esc(i.caption || i.name)}" data-act="zoom" data-item="${i.id}">
        <div class="acts">
          <button data-act="insItem" data-id="${i.id}" title="Inserisci negli appunti">↳</button>
          <button data-act="capItem" data-id="${i.id}" title="Didascalia">✎</button>
          <button data-act="delItem" data-id="${i.id}" title="Elimina">🗑</button>
        </div>
        ${i.caption || i.at ? `<div class="cap">${i.at ? fmtTime(i.at.t) + ' · ' : ''}${esc(i.caption || '')}</div>` : ''}
      </div>`).join('')}</div>` : ''}
    ${files.length ? `<h3 style="margin:16px 0 8px;font-size:14px">File (${files.length})</h3>${files.map(i => `
      <div class="att-row">
        <span class="ic">${icon(i.mime || '')}</span>
        <div class="nm"><a href="#" data-act="openItem" data-id="${i.id}">${esc(i.name)}</a><span class="muted small">${at(i)}${fmtSize(i.size || 0)}${i.caption ? ' · ' + esc(i.caption) : ''}</span></div>
        <button class="icon" data-act="insItem" data-id="${i.id}" title="Inserisci negli appunti">↳</button>
        <button class="icon" data-act="capItem" data-id="${i.id}" title="Nota">✎</button>
        <button class="icon" data-act="delItem" data-id="${i.id}" title="Elimina">🗑</button>
      </div>`).join('')}` : ''}
    ${links.length ? `<h3 style="margin:16px 0 8px;font-size:14px">Link (${links.length})</h3>${links.map(i => `
      <div class="att-row">
        <span class="ic">🔗</span>
        <div class="nm"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.name || i.url)}</a><span class="muted small">${at(i)}${esc(new URL(i.url).hostname)}${i.caption ? ' · ' + esc(i.caption) : ''}</span></div>
        <button class="icon" data-act="insItem" data-id="${i.id}" title="Inserisci negli appunti">↳</button>
        <button class="icon" data-act="capItem" data-id="${i.id}" title="Modifica">✎</button>
        <button class="icon" data-act="delItem" data-id="${i.id}" title="Elimina">🗑</button>
      </div>`).join('')}` : ''}
    ${!items.length ? '<p class="muted small" style="margin-top:14px">📱 Dal telefono, "Foto" apre direttamente la fotocamera: fotografa lavagna e slide durante la lezione, finiscono collegate al minuto della registrazione.</p>' : ''}`;
  for (const img of $$('img[data-blob]', body)) blobUrl(img.dataset.blob).then(u => { if (u) img.src = u; });
  const drop = $('#drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files.length) addFiles(lec.id, [...e.dataTransfer.files]);
    else {
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (/^https?:\/\//.test(url)) addLink(lec.id, url.trim());
    }
  });
}

async function addFiles(lectureId, files, { insert = false } = {}) {
  const lec = S.lectures.get(lectureId);
  const st = S.rec && S.rec.lectureId === lectureId ? { part: S.rec.part, t: S.rec.elapsed() } : null;
  navigator.storage?.persist?.();
  for (const f of files) {
    if (/^audio\//.test(f.type) || (/^video\//.test(f.type) && confirm(`"${f.name}" è un video: vuoi usarlo come audio della lezione (per riascoltarlo e trascriverlo)?\n\nAnnulla = allegalo come file.`))) {
      await addAudio(lec, f);
      continue;
    }
    const kind = /^image\//.test(f.type) ? 'image' : 'file';
    const blob = kind === 'image' ? await shrinkImage(f) : f;
    const blobId = await db.putBlob(blob);
    const it = { id: db.uid(), lectureId, kind, name: f.name || (kind === 'image' ? 'Foto' : 'File'), mime: blob.type || f.type, size: blob.size, blobId, caption: '', at: st };
    await db.put('items', it);
    S.items.set(it.id, it);
    if (insert) insertAtCursor(itemMarkdown(it) + '\n', { newline: true });
  }
  if (curLecture()?.id === lectureId) renderSide();
  if (files.length) toast(files.length === 1 ? 'Aggiunto ✓' : `${files.length} file aggiunti ✓`);
}

// foto dal telefono: 12 MP → ridotte a 2560 px, bastano e risparmiano spazio
async function shrinkImage(file) {
  try {
    if (file.size < 1.5e6 || /gif|svg/.test(file.type)) return file;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 4e6) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return b && b.size < file.size ? b : file;
  } catch { return file; }
}

function itemMarkdown(it) {
  if (it.kind === 'image') return `![${it.caption || it.name}](aula:${it.id})`;
  if (it.kind === 'link') return `[${it.name || it.url}](${it.url})`;
  return `📎 ${it.name}`;
}

async function addLink(lectureId, url = '', insert = false) {
  if (!url) {
    const res = await modal(`
      <h2>Aggiungi link</h2>
      <label>Indirizzo<input type="url" name="url" required placeholder="https://…" autofocus></label>
      <label>Titolo (facoltativo)<input type="text" name="name" placeholder="es. Slide del professore, video YouTube…"></label>
      <label>Nota (facoltativa)<input type="text" name="caption"></label>
      <div class="btns"><button value="cancel" formnovalidate>Annulla</button><button value="ok" class="primary">Aggiungi</button></div>`);
    if (!res || !res.data.url) return;
    url = res.data.url.trim();
    var name = res.data.name.trim(), caption = res.data.caption.trim();
  }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { return toast('Link non valido', true); }
  const st = S.rec && S.rec.lectureId === lectureId ? { part: S.rec.part, t: S.rec.elapsed() } : null;
  const it = { id: db.uid(), lectureId, kind: 'link', url, name: name || '', caption: caption || '', at: st };
  await db.put('items', it);
  S.items.set(it.id, it);
  if (insert) insertAtCursor(itemMarkdown(it) + ' ');
  if (curLecture()?.id === lectureId) renderSide();
  toast('Link aggiunto ✓');
}

async function captionItem(id) {
  const it = S.items.get(id);
  const res = await modal(`
    <h2>${it.kind === 'link' ? 'Modifica link' : 'Didascalia / nota'}</h2>
    ${it.kind !== 'image' ? `<label>Nome<input type="text" name="name" value="${esc(it.name)}"></label>` : ''}
    ${it.kind === 'link' ? `<label>Indirizzo<input type="url" name="url" value="${esc(it.url)}"></label>` : ''}
    <label>Nota<textarea name="caption" style="min-height:80px">${esc(it.caption || '')}</textarea></label>
    <div class="btns"><button value="cancel">Annulla</button><button value="ok" class="primary">Salva</button></div>`);
  if (!res) return;
  Object.assign(it, res.data);
  await db.put('items', it);
  renderSide();
}

async function deleteItem(id) {
  const it = S.items.get(id);
  if (!confirm(`Eliminare "${it.name || it.url}"?`)) return;
  await db.remove('items', id);
  if (it.blobId) await db.deleteBlob(it.blobId);
  S.items.delete(id);
  renderSide();
}

async function openItem(id) {
  const it = S.items.get(id);
  const u = await blobUrl(it.blobId);
  if (!u) return toast('File non presente su questo dispositivo.', true);
  if (/pdf|image|text|audio|video/.test(it.mime || '')) window.open(u, '_blank');
  else sync.download(await sync.getBlob(it.blobId), it.name);
}

// ---------- audio della lezione
function pickFiles(accept, multiple = true, capture = false) {
  return new Promise(res => {
    const inp = $('#filePick');
    inp.value = '';
    inp.accept = accept;
    inp.multiple = multiple;
    if (capture) inp.setAttribute('capture', 'environment'); else inp.removeAttribute('capture');
    inp.onchange = () => res([...inp.files]);
    inp.oncancel = () => res([]);
    inp.click();
  });
}

async function pickAudio(lectureId) {
  const files = await pickFiles('audio/*,video/*,.m4a,.mp3,.wav,.ogg,.opus,.webm,.aac,.flac,.mp4,.mkv', true);
  const lec = S.lectures.get(lectureId);
  for (const f of files) await addAudio(lec, f);
}

async function addAudio(lec, file) {
  toast(`Importo "${file.name}"…`);
  navigator.storage?.persist?.();
  const duration = await mediaDuration(file);
  const blobId = await db.putBlob(file);
  lec.audio = lec.audio || [];
  lec.audio.push({ blobId, name: file.name.replace(/\.[^.]+$/, ''), mime: file.type, size: file.size, duration });
  await saveLecture(lec);
  if (curLecture()?.id === lec.id) {
    P.part = lec.audio.length - 1;
    renderPlayer();
    renderSide();
    if (!S.job && confirm(`Audio aggiunto (${fmtTime(duration)}). Vuoi trascriverlo adesso?`)) {
      S.tab = 'tr';
      renderLecture(lec.id);
      transcribeDialog();
    }
  }
}

// ======================================================================
// Registrazione
// ======================================================================
const saveLiveSoon = debounce(lec => saveLecture(lec), 2000);

async function startRecording(lectureId) {
  if (S.rec) return toast('Stai già registrando un\'altra lezione.');
  if (!recSupported) {
    return toast(window.isSecureContext
      ? 'Questo browser non supporta la registrazione. Usa Chrome, Edge o Safari aggiornati, oppure registra col telefono e carica il file.'
      : 'Per usare il microfono Aula deve essere aperta da un indirizzo https:// (es. GitHub Pages).', true);
  }
  const lec = S.lectures.get(lectureId);
  const part = (lec.audio || []).length;
  const r = new Recorder({
    lectureId, part,
    onLevel: v => { const i = $('#recLevel i'); if (i) i.style.width = Math.min(100, v * 160) + '%'; },
  });
  try {
    await r.start();
  } catch (e) {
    return toast('Microfono non disponibile: ' + (e.name === 'NotAllowedError' ? 'permesso negato. Consenti il microfono dalla barra degli indirizzi.' : e.message), true);
  }
  S.rec = r;
  navigator.storage?.persist?.();
  if (settings.live && T.liveSupported) {
    S.live = T.startLive({
      clock: () => r.elapsed(),
      onFinal: seg => {
        const l = S.lectures.get(lectureId);
        if (!l) return;
        l.transcript.push({ ...seg, part, src: 'live' });
        saveLiveSoon(l);
        if (curLecture()?.id === lectureId && S.tab === 'tr') renderTranscript();
      },
      onInterim: txt => {
        S.interim = txt;
        const el = $('#interim');
        if (el) el.textContent = txt || 'in ascolto…';
      },
      onError: err => { toast('Trascrizione live non disponibile (' + err + '). La registrazione continua.', true); S.live = null; },
    });
  }
  showRecbar();
  if (curLecture()?.id === lectureId) { renderPlayer(); S.tab = 'tr'; renderLecture(lectureId); $('#notes')?.focus(); }
  toast(settings.live && T.liveSupported ? 'Registrazione avviata · trascrizione live attiva' : 'Registrazione avviata');
}

function showRecbar() {
  const bar = $('#recbar');
  bar.hidden = false;
  const lec = S.lectures.get(S.rec.lectureId);
  $('#recGo').textContent = lec?.title || 'Lezione';
  clearInterval(S.recTimer);
  S.recTimer = setInterval(() => {
    if (!S.rec) return;
    $('#recTime').textContent = fmtTime(S.rec.elapsed());
  }, 500);
}

async function togglePause() {
  if (!S.rec) return;
  if (S.rec.paused) {
    S.rec.resume();
    $('#recPause').textContent = 'Pausa';
    $('#recbar').classList.remove('paused');
  } else {
    S.rec.pause();
    $('#recPause').textContent = 'Riprendi';
    $('#recbar').classList.add('paused');
  }
}

async function stopRecording() {
  const r = S.rec;
  if (!r) return;
  $('#recStop').disabled = true;
  if (S.live) { S.live.stop(); S.live = null; }
  S.interim = '';
  let out;
  try { out = await r.stop(); } finally { $('#recStop').disabled = false; }
  S.rec = null;
  clearInterval(S.recTimer);
  $('#recbar').hidden = true;
  $('#recbar').classList.remove('paused');
  $('#recPause').textContent = 'Pausa';
  const lec = S.lectures.get(r.lectureId);
  const blobId = await db.putBlob(out.blob);
  lec.audio = lec.audio || [];
  lec.audio.splice(r.part, 0, { blobId, name: `Registrazione ${r.part + 1}`, mime: out.mime, size: out.blob.size, duration: out.duration, recorded: true });
  await saveLecture(lec);
  await db.clearRecChunks(out.recId);
  toast(`Registrazione salvata (${fmtTime(out.duration)}, ${fmtSize(out.blob.size)}) ✓`);
  if (curLecture()?.id === lec.id) { P.part = r.part; renderPlayer(); renderSide(); }
  else renderNav();
}

async function recoverRecordings() {
  const rec = await recoverPending();
  for (const p of rec) {
    let lec = S.lectures.get(p.lectureId);
    if (!lec) {
      lec = { id: p.lectureId || db.uid(), courseId: null, type: 'lezione', title: 'Registrazione recuperata', date: today(), tags: [], notes: '', transcript: [], audio: [], ai: [], history: [] };
      S.lectures.set(lec.id, lec);
    }
    const duration = p.duration || await mediaDuration(p.blob);
    const blobId = await db.putBlob(p.blob);
    lec.audio = lec.audio || [];
    lec.audio.push({ blobId, name: 'Registrazione recuperata', mime: p.mime, size: p.blob.size, duration, recorded: true });
    await saveLecture(lec);
    await db.clearRecChunks(p.recId);
    toast(`Recuperata una registrazione interrotta (${fmtTime(duration)}) in "${lec.title}" ✓`, false, 8000);
  }
}

// ======================================================================
// Claude
// ======================================================================
function renderAI() {
  const lec = curLecture();
  const body = $('#sideBody');
  if (!lec || !body || S.tab !== 'ai') return;
  const items = itemsOf(lec.id);
  const nVis = items.filter(i => i.kind === 'image' || /pdf/.test(i.mime || '')).length;
  const conv = S.chat[lec.id] || [];
  const hasKey = !!keys.anthropic;
  body.innerHTML = `
    <div class="notice">
      Claude legge i tuoi appunti, la trascrizione${nVis ? ', le foto e i PDF' : ''} di questa lezione e ti prepara il materiale di studio.
      ${hasKey ? '' : `<br><b>Nessuna chiave API:</b> i pulsanti copiano tutto negli appunti e aprono claude.ai, dove incolli (Ctrl+V) e invii — funziona con il tuo abbonamento Claude. <button class="link" data-act="settings" data-s="ai">Aggiungi una chiave</button> per avere le risposte direttamente qui.`}
    </div>
    ${!lec.transcript?.length && !lec.notes ? '<p class="muted small">Questa lezione non ha ancora né appunti né trascrizione.</p>' : ''}
    <div class="row small">
      ${hasKey ? `<select id="aiModel" aria-label="Modello">${AI.MODELS.map(m => `<option value="${m.id}" ${m.id === settings.aiModel ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>` : ''}
      ${hasKey && nVis ? `<label class="row" style="gap:4px"><input type="checkbox" id="aiImgs" checked> includi foto e PDF (${nVis})</label>` : ''}
    </div>
    <div class="ai-actions">
      ${Object.entries(AI.ACTIONS).map(([k, a]) => `<button data-act="ai" data-k="${k}">${hasKey ? '✨' : '📋'} ${esc(a.title)}</button>`).join('')}
    </div>
    <div class="row">
      <textarea id="aiQ" rows="2" class="grow" placeholder="Fai una domanda sulla lezione… (Ctrl+Invio)" style="resize:vertical"></textarea>
      <button class="primary" data-act="aiAsk">${hasKey ? 'Chiedi' : '📋 Copia'}</button>
    </div>
    <div id="conv">${conv.map((m, i) => convBlock(m, i)).join('')}</div>
    ${(lec.ai || []).length ? `<h3 style="margin:18px 0 8px;font-size:14px">Salvati nella lezione</h3>${lec.ai.map(a => `
      <details class="saved"><summary><b class="grow">${esc(a.title)}</b><span class="muted small">${fmtDT(a.at)}</span>
        <button class="icon small" data-act="aiIns" data-id="${a.id}" title="Aggiungi agli appunti">↳</button>
        <button class="icon small" data-act="aiDel" data-id="${a.id}" title="Elimina">🗑</button></summary>
        <div class="md">${renderMd(a.text, { loose: true })}</div></details>`).join('')}` : ''}`;
  for (const d of $$('details.saved .md, #conv .md', body)) hydrateMd(d);
  $('#aiModel')?.addEventListener('change', e => { settings.aiModel = e.target.value; saveSettings(); });
  $('#aiQ').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); aiRun(null); } });
}

function convBlock(m, i) {
  return `${m.q ? `<div class="chat-msg user">${esc(m.q)}</div>` : ''}
    <div class="ai-out ${m.done ? '' : 'loading'}" data-i="${i}">
      ${m.q ? '' : `<div class="muted small" style="margin-bottom:6px">✨ ${esc(m.title)}</div>`}
      <div class="md">${m.err ? `<p style="color:var(--rec)">${esc(m.err)}</p>` : renderMd(m.text || (m.done ? '' : '_Claude sta pensando…_'), { loose: true })}</div>
      ${m.done && !m.err ? `<div class="row" style="margin-top:8px">
        <button class="small" data-act="aiSave" data-i="${i}">💾 Salva nella lezione</button>
        <button class="small" data-act="aiToNotes" data-i="${i}">↳ Aggiungi agli appunti</button>
        <button class="small" data-act="aiCopy" data-i="${i}">📋 Copia</button>
      </div>` : ''}
    </div>`;
}

async function aiRun(action) {
  const lec = curLecture();
  const items = itemsOf(lec.id);
  const course = S.courses.get(lec.courseId);
  const question = action ? null : $('#aiQ').value.trim();
  if (!action && !question) return $('#aiQ').focus();
  const context = AI.buildContext(lec, course, items);
  if (!keys.anthropic) {
    await navigator.clipboard.writeText(AI.clipboardPrompt(action, context, question));
    toast('Copiato! Incolla in claude.ai (Ctrl+V) e invia.', false, 6000);
    window.open('https://claude.ai/new', '_blank', 'noopener');
    return;
  }
  const conv = S.chat[lec.id] ||= [];
  const history = [];
  if (!action) {
    for (const m of conv) if (m.q && m.done && !m.err) history.push({ role: 'user', content: m.q }, { role: 'assistant', content: m.text });
    $('#aiQ').value = '';
  }
  const entry = { title: action ? AI.ACTIONS[action].title : 'Domanda', action, q: question, text: '', done: false, at: Date.now() };
  conv.push(entry);
  const idx = conv.length - 1;
  renderAI();
  const blocks = [];
  if ($('#aiImgs')?.checked !== false) {
    for (const it of items) {
      const b = (it.kind === 'image' || /pdf/.test(it.mime || '')) && await sync.getBlob(it.blobId);
      if (!b) continue;
      try {
        if (it.kind === 'image') blocks.push(await AI.imageBlock(b));
        else if (b.size < 20e6) blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await b64(b) }, title: it.name });
      } catch {}
    }
  }
  const outEl = () => $(`#conv .ai-out[data-i="${idx}"] .md`);
  try {
    entry.text = await AI.ask({
      apiKey: keys.anthropic, model: settings.aiModel, context, images: blocks, action, question, history,
      onText: t => { entry.text = t; const el = outEl(); if (el) el.innerHTML = renderMd(t, { loose: true }); },
    });
  } catch (e) {
    entry.err = e.status === 401 ? 'Chiave API non valida.' : e.message || String(e);
  }
  entry.done = true;
  if (curLecture()?.id === lec.id && S.tab === 'ai') renderAI();
}

const b64 = blob => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });

// ======================================================================
// Ricerca
// ======================================================================
function renderSearch(q) {
  teardownPlayer();
  const nq = norm(q.trim());
  const res = [];
  if (nq) {
    const snip = (t, i) => {
      const a = Math.max(0, i - 60);
      const raw = t.slice(a, i + nq.length + 80);
      const k = i - a;
      return (a ? '…' : '') + esc(raw.slice(0, k)) + '<mark>' + esc(raw.slice(k, k + nq.length)) + '</mark>' + esc(raw.slice(k + nq.length)) + '…';
    };
    for (const l of lecturesOf(undefined)) {
      const hits = [];
      let i = norm(l.title).indexOf(nq);
      if (i >= 0) hits.push({ w: 'Titolo', s: snip(l.title, i) });
      i = norm(l.notes).indexOf(nq);
      if (i >= 0) hits.push({ w: 'Appunti', s: snip(l.notes, i) });
      if ((l.tags || []).some(t => norm(t).includes(nq))) hits.push({ w: 'Tag', s: l.tags.map(t => '#' + esc(t)).join(' ') });
      for (const s of l.transcript || []) {
        const k = norm(s.text).indexOf(nq);
        if (k >= 0) { hits.push({ w: `Trascrizione ${s.start != null ? fmtTime(s.start) : ''}`, s: snip(s.text, k), seek: s }); if (hits.length > 6) break; }
      }
      for (const it of itemsOf(l.id)) {
        const txt = [it.name, it.caption, it.url].filter(Boolean).join(' · ');
        const k = norm(txt).indexOf(nq);
        if (k >= 0) hits.push({ w: 'Allegato', s: snip(txt, k) });
      }
      for (const a of l.ai || []) {
        const k = norm(a.text).indexOf(nq);
        if (k >= 0) hits.push({ w: a.title, s: snip(a.text, k) });
      }
      if (hits.length) res.push({ l, hits });
    }
  }
  $('#main').innerHTML = `
    <div class="page">
      <div class="page-head"><button class="icon only-mobile" data-act="menu">☰</button><h1>Risultati per “${esc(q)}”</h1></div>
      <div class="results">${res.length ? res.map(({ l, hits }) => `
        <div class="res" data-act="open" data-id="${l.id}">
          <b>${esc(l.title)}</b> <span class="muted small">${fmtDate(l.date)} ${S.courses.get(l.courseId) ? '· ' + esc(S.courses.get(l.courseId).name) : ''}</span>
          ${hits.slice(0, 5).map(h => `<div class="small" ${h.seek ? `data-act="openSeek" data-id="${l.id}" data-p="${h.seek.part || 0}" data-t="${h.seek.start}"` : ''}><span class="w">${esc(h.w)}:</span> ${h.s}</div>`).join('')}
        </div>`).join('') : '<div class="card empty muted">Nessun risultato.</div>'}</div>
    </div>`;
}

// ======================================================================
// Corsi
// ======================================================================
async function editCourse(id = null) {
  const c = id ? S.courses.get(id) : { name: '', prof: '', color: COLORS[S.courses.size % COLORS.length] };
  const res = await modal(`
    <h2>${id ? 'Modifica corso' : 'Nuovo corso'}</h2>
    <label>Nome del corso<input type="text" name="name" value="${esc(c.name)}" required autofocus placeholder="es. Analisi Matematica I"></label>
    <label>Docente (facoltativo)<input type="text" name="prof" value="${esc(c.prof || '')}"></label>
    <label>Colore<div class="row">${COLORS.map(col => `<label class="chk" style="gap:2px"><input type="radio" name="color" value="${col}" ${col === c.color ? 'checked' : ''}><span style="display:inline-block;width:20px;height:20px;border-radius:6px;background:${col}"></span></label>`).join('')}</div></label>
    <div class="btns">${id ? '<button value="delete" class="danger" formnovalidate style="margin-right:auto">Elimina corso</button>' : ''}<button value="cancel" formnovalidate>Annulla</button><button value="ok" class="primary">Salva</button></div>`);
  if (!res) return null;
  if (res.value === 'delete') {
    if (!confirm(`Eliminare il corso "${c.name}"? Le sue lezioni NON vengono cancellate: finiscono nel Quaderno.`)) return null;
    for (const l of lecturesOf(id)) { l.courseId = null; await saveLecture(l); }
    await db.remove('courses', id);
    S.courses.delete(id);
    go('#/');
    return null;
  }
  if (!res.data.name.trim()) return null;
  const rec = { ...c, id: id || db.uid(), name: res.data.name.trim(), prof: res.data.prof.trim(), color: res.data.color || c.color };
  await db.put('courses', rec);
  S.courses.set(rec.id, rec);
  renderNav();
  return rec;
}

// ======================================================================
// Menu lezione, cronologia, esportazioni
// ======================================================================
async function lectureMenu() {
  const lec = curLecture();
  const res = await modal(`
    <h2>${esc(lec.title)}</h2>
    <div style="display:grid;gap:8px">
      <button value="md">⬇️ Scarica appunti + trascrizione (.md)</button>
      <button value="copy">📋 Copia tutto come testo</button>
      <button value="zip">📦 Esporta questa lezione (.zip, con audio e foto)</button>
      <button value="hist">🕘 Cronologia degli appunti (${(lec.history || []).length})</button>
      <button value="print">🖨 Stampa / salva PDF degli appunti</button>
      <button value="del" class="danger">🗑 Elimina lezione</button>
    </div>
    <div class="btns"><button value="cancel">Chiudi</button></div>`);
  if (!res) return;
  const course = S.courses.get(lec.courseId);
  const md = () => sync.lectureMarkdown(lec, course, itemsOf(lec.id));
  const fname = `${lec.date || ''} ${lec.title}`.trim().replace(/[\\/:*?"<>|]+/g, ' ');
  if (res.value === 'md') sync.download(new Blob([md()], { type: 'text/markdown' }), fname + '.md');
  if (res.value === 'copy') { await navigator.clipboard.writeText(md()); toast('Copiato ✓'); }
  if (res.value === 'zip') sync.download(await sync.exportZip([lec.id], { onStatus: s => s && toast(s, false, 1200) }), fname + '.aula.zip');
  if (res.value === 'hist') historyDialog();
  if (res.value === 'print') printNotes(lec);
  if (res.value === 'del') {
    if (!confirm(`Eliminare definitivamente "${lec.title}" con audio, trascrizione e allegati?`)) return;
    const back = lec.courseId ? `#/c/${lec.courseId}` : '#/';
    await deleteLecture(lec.id);
    go(back);
  }
}

function printNotes(lec) {
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(lec.title)}</title>
    <style>body{font:15px/1.6 system-ui,sans-serif;max-width:760px;margin:30px auto;padding:0 20px;color:#111}img{max-width:100%}.ts{font:12px monospace;background:#eee;border:0;padding:0 5px;border-radius:4px}</style>
    <h1>${esc(lec.title)}</h1><p>${fmtDate(lec.date)}</p>${renderMd(lec.notes)}`);
  w.document.close();
  // le immagini locali vanno risolte nella nuova finestra
  Promise.all($$('img[data-aula]', w.document).map(async img => {
    const it = S.items.get(img.dataset.aula);
    if (it) img.src = await blobUrl(it.blobId);
  })).then(() => setTimeout(() => w.print(), 400));
}

async function historyDialog() {
  const lec = curLecture();
  const h = lec.history || [];
  const why = { auto: 'salvataggio automatico', sync: 'sostituita da un altro dispositivo', restore: 'prima di un ripristino' };
  const res = await modal(`
    <h2>Cronologia degli appunti</h2>
    ${h.length ? `<p class="muted small" style="margin:0">Versioni precedenti degli appunti di questa lezione. Ripristinando, la versione attuale viene comunque conservata qui.</p>
    ${h.map((v, i) => `<details class="saved"><summary><b class="grow">${fmtDT(v.at)}</b><span class="muted small">${esc(why[v.reason] || '')} · ${v.notes.length} caratteri</span></summary>
      <div class="md" style="max-height:240px;overflow:auto">${renderMd(v.notes)}</div>
      <div class="btns" style="padding:0 12px 10px"><button value="r${i}">↩︎ Ripristina questa versione</button></div></details>`).join('')}`
      : '<p class="muted">Ancora nessuna versione salvata. Aula conserva automaticamente le versioni precedenti mentre scrivi e quando una sincronizzazione sostituisce gli appunti.</p>'}
    <div class="btns"><button value="cancel">Chiudi</button></div>`);
  if (!res || !res.value.startsWith('r')) return;
  const v = h[+res.value.slice(1)];
  lec.history = [{ at: Date.now(), notes: lec.notes, reason: 'restore' }, ...h].slice(0, 15);
  lec.notes = v.notes;
  lec._lastSaved = v.notes;
  await saveLecture(lec);
  renderLecture(lec.id);
  toast('Versione ripristinata ✓');
}

async function partMenu() {
  const lec = curLecture();
  const a = lec.audio[P.part];
  const res = await modal(`
    <h2>${esc(a.name)}</h2>
    <p class="muted small" style="margin:0">${fmtTime(a.duration)} · ${a.size ? fmtSize(a.size) : ''} · ${esc(a.mime || '')}</p>
    <label>Nome<input type="text" name="name" value="${esc(a.name)}"></label>
    <div class="btns"><button value="del" class="danger" style="margin-right:auto">🗑 Elimina audio</button><button value="dl">⬇️ Scarica</button><button value="cancel">Chiudi</button><button value="ok" class="primary">Salva</button></div>`);
  if (!res) return;
  if (res.value === 'ok') { a.name = res.data.name; await saveLecture(lec); renderPlayer(); }
  if (res.value === 'dl') {
    const b = await sync.getBlob(a.blobId);
    const ext = (a.mime || '').includes('webm') ? 'webm' : (a.mime || '').includes('ogg') ? 'ogg' : (a.mime || '').includes('mp4') ? 'm4a' : (a.mime.split('/')[1] || 'audio');
    if (b) sync.download(b, `${lec.title} - ${a.name}.${ext}`);
  }
  if (res.value === 'del') {
    if (!confirm('Eliminare questo audio? La trascrizione resta, ma i minuti non saranno più riascoltabili.')) return;
    lec.audio.splice(P.part, 1);
    for (const s of lec.transcript) if ((s.part || 0) > P.part) s.part--;
    await db.deleteBlob(a.blobId);
    P.part = 0;
    if (P.audio) P.audio.removeAttribute('src');
    await saveLecture(lec);
    renderPlayer();
    renderSide();
  }
}

async function trMenu() {
  const lec = curLecture();
  const res = await modal(`
    <h2>Trascrizione</h2>
    <div style="display:grid;gap:8px">
      <button value="copy">📋 Copia tutto il testo</button>
      <button value="copyts">📋 Copia con i minuti</button>
      <button value="notes">↳ Incolla la trascrizione in fondo agli appunti</button>
      <button value="clear" class="danger">🗑 Cancella la trascrizione</button>
    </div>
    <div class="btns"><button value="cancel">Chiudi</button></div>`);
  if (!res) return;
  const txt = ts => lec.transcript.map(s => ts && s.start != null ? `[${(s.part ? `p${s.part + 1} ` : '') + fmtTime(s.start)}] ${s.text}` : s.text).join(ts ? '\n' : ' ');
  if (res.value === 'copy') { await navigator.clipboard.writeText(txt(false)); toast('Copiato ✓'); }
  if (res.value === 'copyts') { await navigator.clipboard.writeText(txt(true)); toast('Copiato ✓'); }
  if (res.value === 'notes') {
    const lines = lec.transcript.map(s => s.start != null ? `${stampText({ part: s.part || 0, t: s.start })} ${s.text}` : s.text).join('\n');
    lec.notes = (lec.notes ? lec.notes + '\n\n' : '') + '## Trascrizione\n\n' + lines;
    await saveLecture(lec);
    renderLecture(lec.id);
  }
  if (res.value === 'clear' && confirm('Cancellare tutta la trascrizione di questa lezione?')) {
    lec.transcript = [];
    await saveLecture(lec);
    renderSide();
  }
}

// ======================================================================
// Impostazioni, sincronizzazione, backup
// ======================================================================
async function openSettings(section) {
  const perm = await sync.folderPermission(false);
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const last = await db.kvGet('lastSync');
  const html = `
    <h2>Impostazioni</h2>
    <fieldset id="s-sync">
      <legend>☁️ Sincronizzazione tra PC</legend>
      ${sync.fsSupported ? `
        <p class="muted small" style="margin:0">Scegli una cartella dentro <b>OneDrive</b>, <b>Google Drive</b>, <b>Dropbox</b> o su una <b>chiavetta USB</b>. Aula ci salva tutto (dati, audio, foto e appunti in Markdown leggibili). Sull'altro PC apri Aula e collega la stessa cartella.</p>
        <div class="row">
          ${sync.folderName() ? `<span class="grow">📁 <b>${esc(sync.folderName())}</b> ${perm === 'granted' ? '<span class="muted small">· collegata' + (last ? ', ultima sync ' + fmtDT(last) : '') + '</span>' : '<span style="color:var(--warn)" class="small">· da riconnettere</span>'}</span>
            <button value="sync" class="primary">${perm === 'granted' ? '↻ Sincronizza ora' : '🔓 Riconnetti'}</button><button value="unlink">Scollega</button>`
          : `<button value="folder" class="primary">📁 Scegli cartella…</button>`}
        </div>` : `<p class="muted small" style="margin:0">Questo browser non permette di collegare una cartella (serve Chrome o Edge su computer). Usa il backup ZIP qui sotto.</p>`}
      <div class="row">
        <button value="export">📦 Esporta tutto (.zip)</button>
        <button value="import">⤓ Importa backup / lezione (.zip)</button>
      </div>
      ${est ? `<p class="muted small" style="margin:0">Spazio usato nel browser: ${fmtSize(est.usage || 0)} ${persisted ? '· archivio protetto dalla pulizia automatica ✓' : '· <button class="link" value="persist">proteggi dalla pulizia automatica</button>'}</p>` : ''}
    </fieldset>
    <fieldset id="s-tr">
      <legend>🎙 Trascrizione</legend>
      <label class="chk"><input type="checkbox" name="live" ${settings.live ? 'checked' : ''} ${T.liveSupported ? '' : 'disabled'}> Trascrizione dal vivo mentre registro ${T.liveSupported ? '(usa il riconoscimento vocale del browser, serve internet)' : '(non supportata da questo browser: usa Chrome o Edge)'}</label>
      <label>Modello Whisper nel browser<select name="localModel">${T.LOCAL_MODELS.map(m => `<option value="${m.id}" ${m.id === settings.localModel ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
      <label>Servizio cloud<select name="cloudPreset">${Object.entries(T.CLOUD_PRESETS).map(([k, p]) => `<option value="${k}" ${k === settings.cloudPreset ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
      <div class="row"><label class="grow">Indirizzo API<input type="url" name="cloudBase" value="${esc(settings.cloudBase)}"></label><label>Modello<input type="text" name="cloudModel" value="${esc(settings.cloudModel)}" style="width:190px"></label></div>
      <label>Chiave API del servizio cloud<input type="password" name="cloudKey" value="${esc(keys.cloud || '')}" placeholder="gsk_… (Groq) oppure sk-… (OpenAI)" autocomplete="off"></label>
      <p class="muted small" style="margin:0">Groq: crea una chiave gratuita su console.groq.com → API Keys.</p>
    </fieldset>
    <fieldset id="s-ai">
      <legend>✨ Claude</legend>
      <label>Chiave API Anthropic (facoltativa)<input type="password" name="anthropicKey" value="${esc(keys.anthropic || '')}" placeholder="sk-ant-…" autocomplete="off"></label>
      <p class="muted small" style="margin:0">Senza chiave i pulsanti di Claude copiano il materiale e aprono claude.ai (usi il tuo abbonamento). Con la chiave (console.anthropic.com) le risposte arrivano qui e paghi a consumo.</p>
    </fieldset>
    <fieldset>
      <legend>🔐 PC condiviso (es. università)</legend>
      <label class="chk"><input type="checkbox" name="rememberKeys" ${settings.rememberKeys ? 'checked' : ''}> Ricorda le chiavi API su questo dispositivo (togli la spunta sui PC pubblici)</label>
      <p class="muted small" style="margin:0">Quando hai finito su un PC non tuo: sincronizza o esporta, poi cancella i dati da questo browser.</p>
      <div class="row"><button value="wipe" class="danger">🧹 Cancella tutti i miei dati da questo browser</button></div>
    </fieldset>
    <div class="btns"><button value="cancel" class="primary">Fatto</button></div>`;
  const dlg = $('#dlg'), form = $('#dlgForm');
  form.innerHTML = html;
  form.onchange = e => {
    const f = form.elements;
    const n = e.target.name;
    if (n === 'cloudPreset') {
      const p = T.CLOUD_PRESETS[f.cloudPreset.value];
      if (p.base) f.cloudBase.value = p.base;
      f.cloudModel.value = p.model;
    }
    Object.assign(settings, {
      live: f.live.checked, localModel: f.localModel.value, cloudPreset: f.cloudPreset.value,
      cloudBase: f.cloudBase.value.trim(), cloudModel: f.cloudModel.value.trim(), rememberKeys: f.rememberKeys.checked,
    });
    keys = { anthropic: f.anthropicKey.value.trim(), cloud: f.cloudKey.value.trim() };
    saveSettings();
    saveKeys();
  };
  form.oninput = e => { if (e.target.type === 'password') form.onchange(e); };
  dlg.returnValue = '';
  if (!dlg.open) dlg.showModal();
  if (section) $(`#s-${section}`, form)?.scrollIntoView();
  const value = await new Promise(r => dlg.addEventListener('close', () => r(dlg.returnValue), { once: true }));
  form.onchange = form.oninput = null;
  const again = () => openSettings();
  try {
    if (value === 'folder') { await sync.chooseFolder(); await doSync(true); return again(); }
    if (value === 'sync') { await sync.folderPermission(true); await doSync(true); return again(); }
    if (value === 'unlink') { if (confirm('Scollegare la cartella? I dati restano sia qui sia nella cartella.')) await sync.forgetFolder(); updatePill(); return again(); }
    if (value === 'persist') { const ok = await navigator.storage.persist(); toast(ok ? 'Archivio protetto ✓' : 'Il browser non ha concesso la protezione (installa Aula come app per ottenerla).'); return again(); }
    if (value === 'export') {
      const blob = await sync.exportZip(null, { onStatus: s => s && toast(s, false, 1000) });
      sync.download(blob, `aula-backup-${today()}.zip`);
      return again();
    }
    if (value === 'import') {
      const [f] = await pickFiles('.zip,application/zip', false);
      if (!f) return again();
      const r = await sync.importZip(f, { onStatus: s => s && toast(s, false, 1000) });
      await loadState();
      render();
      toast(`Importati ${r.merged} elementi e ${r.media} file ✓`);
      return;
    }
    if (value === 'wipe') return wipeDevice();
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message, true);
  }
  render();
}

async function wipeDevice() {
  const linked = sync.folderName() && (await sync.folderPermission(false)) === 'granted';
  const msg = linked
    ? 'Prima sincronizzo con la cartella collegata, poi cancello da questo browser lezioni, audio, appunti, chiavi e impostazioni. Continuare?'
    : 'ATTENZIONE: non c\'è una cartella sincronizzata. Se non hai esportato un backup, i dati di questo browser andranno persi. Cancellare tutto?';
  if (!confirm(msg)) return;
  if (S.rec) await stopRecording();
  if (linked) {
    try { await doSync(true); } catch (e) { if (!confirm('Sincronizzazione fallita: ' + e.message + '\nCancellare comunque?')) return; }
  }
  await db.wipeAll();
  localStorage.removeItem('aula.settings');
  localStorage.removeItem('aula.keys');
  localStorage.removeItem('aula.tab');
  sessionStorage.clear();
  location.hash = '';
  location.reload();
}

// --- autosync
async function doSync(manual = false) {
  if (S.syncing) return;
  if (!sync.folderName()) return;
  if ((await sync.folderPermission(false)) !== 'granted') { updatePill(); return; }
  S.syncing = true;
  S.dirty = false;
  updatePill();
  try {
    // salva subito eventuali appunti in attesa
    const lec = curLecture();
    if (lec) await saveLecture(lec);
    const r = await sync.syncFolder({ onStatus: m => { S.syncMsg = m; updatePill(); } });
    if (r.pulled) {
      await loadState();
      refreshAfterPull();
    }
    if (manual) toast(`Sincronizzato ✓ ${r.pulled ? `(${r.pulled} aggiornamenti ricevuti)` : ''}`);
  } catch (e) {
    S.dirty = true;
    toast('Sincronizzazione non riuscita: ' + e.message, true);
  } finally {
    S.syncing = false;
    S.syncMsg = '';
    updatePill();
  }
}
const syncSoon = debounce(() => doSync(false), 6000);

function refreshAfterPull() {
  renderNav();
  const r = route();
  if (r.kind !== 'l') return render();
  const lec = S.lectures.get(r.id);
  if (!lec) return go('#/');
  lec._lastSaved = lec.notes;
  const ta = $('#notes');
  if (ta && ta.value !== lec.notes) {
    if (document.activeElement === ta) {
      // stai scrivendo: non sovrascriviamo sotto le dita, vince la tua versione
      // (quella arrivata dall'altro PC resta nella cronologia)
      lec.history = [{ at: Date.now(), notes: lec.notes, reason: 'sync' }, ...(lec.history || [])].slice(0, 15);
      lec.notes = ta.value;
      saveLecture(lec);
    } else {
      ta.value = lec.notes || '';
      if (S.notesMode !== 'edit') renderPreview();
    }
  }
  const t = $('#lTitle');
  if (t && document.activeElement !== t) t.value = lec.title || '';
  // il player non viene ricreato, così l'audio in riproduzione non si interrompe
  renderSide();
}

async function updatePill() {
  const el = $('#syncPill');
  if (!el) return;
  let txt, cls = '';
  if (S.syncing) txt = '↻ ' + (S.syncMsg || 'Sincronizzo…');
  else if (!sync.folderName()) { txt = '☁️ Attiva la sincronizzazione'; cls = 'warn'; }
  else if ((await sync.folderPermission(false)) !== 'granted') { txt = `🔓 Riconnetti «${sync.folderName()}»`; cls = 'warn'; }
  else if (S.dirty) txt = '● Modifiche da sincronizzare';
  else { const l = await db.kvGet('lastSync'); txt = `✓ Sincronizzato${l ? ' ' + new Date(l).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''}`; cls = 'ok'; }
  el.textContent = txt;
  el.className = 'pill ' + cls;
}

// ======================================================================
// Dialog generico
// ======================================================================
function modal(html) {
  const dlg = $('#dlg'), form = $('#dlgForm');
  if (dlg.open) dlg.close();
  dlg.returnValue = '';
  form.innerHTML = html;
  form.onchange = form.oninput = null;
  dlg.showModal();
  const af = form.querySelector('[autofocus]');
  if (af) af.focus();
  return new Promise(resolve => {
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue;
      if (!v || v === 'cancel') return resolve(null);
      const data = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
        else if (el.type === 'checkbox') data[el.name] = el.checked;
        else if (el.type !== 'file') data[el.name] = el.value;
      }
      resolve({ value: v, data, form });
    }, { once: true });
  });
}

// ======================================================================
// Eventi
// ======================================================================
const actions = {
  menu: () => $('#app').classList.toggle('nav-open'),
  back: () => { const l = curLecture(); go(l && l.courseId && S.courses.has(l.courseId) ? `#/c/${l.courseId}` : '#/'); },
  open: el => go(`#/l/${el.dataset.id}`),
  openSeek: (el, e) => {
    e.stopPropagation();
    go(`#/l/${el.dataset.id}`);
    S.tab = 'tr';
    setTimeout(() => seek(+el.dataset.p, +el.dataset.t), 300);
  },
  newCourse: () => editCourse(),
  editCourse: el => editCourse(el.dataset.id).then(() => render()),
  newLec: el => newLecture({ courseId: el.dataset.c || null, then: el.dataset.then }),
  newNote: el => newLecture({ courseId: el.dataset.c || null, type: 'nota', then: 'title' }),
  settings: el => openSettings(el.dataset.s),
  lecMenu: () => lectureMenu(),
  partMenu: () => partMenu(),
  trMenu: () => trMenu(),
  tab: el => {
    S.tab = el.dataset.t;
    localStorage.setItem('aula.tab', S.tab);
    $$('.tabs button').forEach(b => b.classList.toggle('on', b === el));
    renderSide();
  },
  mview: el => {
    S.mobileView = el.dataset.v;
    $('.lec-body').className = 'lec-body mobile-' + S.mobileView;
    $$('.mobile-switch button').forEach(b => b.classList.toggle('on', b === el));
  },
  fmt: el => fmt(el.dataset.f),
  notesMode: () => toggleNotesMode(),
  stamp: () => insertStamp(false),
  mark: () => insertStamp(true),
  seek: el => seek(+el.dataset.p || 0, +el.dataset.t),
  play: () => { if (!P.audio) return; if (!P.audio.src) return loadPart(P.part, null, true); P.audio.paused ? P.audio.play() : P.audio.pause(); },
  skip: el => { if (P.audio) P.audio.currentTime = Math.max(0, P.audio.currentTime + +el.dataset.d); },
  rec: () => startRecording(curLecture().id),
  upload: () => pickAudio(curLecture().id),
  transcribe: () => transcribeDialog(),
  cancelJob: () => S.job && S.job.abort(),
  importTr: () => importTranscript(),
  addPhoto: async el => {
    const lec = curLecture();
    const files = await pickFiles('image/*', true, matchMedia('(pointer: coarse)').matches);
    if (files.length) addFiles(lec.id, files, { insert: !!el.dataset.insert });
  },
  addFile: async () => {
    const lec = curLecture();
    const files = await pickFiles('*/*', true);
    if (files.length) addFiles(lec.id, files);
  },
  addLink: el => addLink(curLecture().id, '', !!el.dataset.insert),
  insItem: el => { insertAtCursor(itemMarkdown(S.items.get(el.dataset.id)) + '\n', { newline: true }); toast('Inserito negli appunti'); },
  capItem: el => captionItem(el.dataset.id),
  delItem: el => deleteItem(el.dataset.id),
  openItem: (el, e) => { e.preventDefault(); openItem(el.dataset.id); },
  zoom: async el => {
    const lb = $('#lightbox');
    const it = S.items.get(el.dataset.item || el.dataset.aula);
    lb.innerHTML = `<img src="${el.src}" alt=""><p>${esc(it?.caption || it?.name || '')}</p>`;
    lb.hidden = false;
  },
  ai: el => aiRun(el.dataset.k),
  aiAsk: () => aiRun(null),
  aiSave: async el => {
    const lec = curLecture();
    const m = S.chat[lec.id][+el.dataset.i];
    lec.ai = lec.ai || [];
    lec.ai.unshift({ id: db.uid(), title: m.q ? 'D: ' + m.q.slice(0, 80) : m.title, text: m.text, at: Date.now() });
    await saveLecture(lec);
    toast('Salvato nella lezione ✓');
    renderAI();
  },
  aiToNotes: el => {
    const lec = curLecture();
    const m = S.chat[lec.id][+el.dataset.i];
    const ta = $('#notes');
    if (ta) ta.setSelectionRange(ta.value.length, ta.value.length);
    insertAtCursor(`\n\n## ${m.q ? m.q : m.title} (Claude)\n\n${looseToNotes(m.text)}\n`);
    toast('Aggiunto in fondo agli appunti ✓');
  },
  aiCopy: async el => { await navigator.clipboard.writeText(S.chat[curLecture().id][+el.dataset.i].text); toast('Copiato ✓'); },
  aiIns: (el, e) => {
    e.preventDefault();
    const a = curLecture().ai.find(x => x.id === el.dataset.id);
    const ta = $('#notes');
    if (ta) ta.setSelectionRange(ta.value.length, ta.value.length);
    insertAtCursor(`\n\n## ${a.title} (Claude)\n\n${looseToNotes(a.text)}\n`);
  },
  aiDel: async (el, e) => {
    e.preventDefault();
    const lec = curLecture();
    if (!confirm('Eliminare questo elemento salvato?')) return;
    lec.ai = lec.ai.filter(x => x.id !== el.dataset.id);
    await saveLecture(lec);
    renderAI();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('dialog') && el.tagName === 'BUTTON' && el.value) return;
  const fn = actions[el.dataset.act];
  if (fn) { if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault(); fn(el, e); }
});

$('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });
$('#scrim').addEventListener('click', () => $('#app').classList.remove('nav-open'));
$('#closeSide').addEventListener('click', () => $('#app').classList.remove('nav-open'));
$('#openSettings').addEventListener('click', () => openSettings());
$('#syncPill').addEventListener('click', async () => {
  if (!sync.folderName()) return openSettings('sync');
  if ((await sync.folderPermission(true)) === 'granted') doSync(true);
  else updatePill();
});
$('#recStop').addEventListener('click', stopRecording);
$('#recPause').addEventListener('click', togglePause);
$('#recMark').addEventListener('click', () => {
  if (curLecture()?.id !== S.rec?.lectureId) go(`#/l/${S.rec.lectureId}`);
  setTimeout(() => insertStamp(true), 50);
});
$('#recGo').addEventListener('click', () => S.rec && go(`#/l/${S.rec.lectureId}`));

const q = $('#q');
q.addEventListener('input', debounce(() => {
  if (q.value.trim()) { history.replaceState(null, '', `#/s/${encodeURIComponent(q.value.trim())}`); render(); q.focus(); }
}, 300));
q.addEventListener('keydown', e => { if (e.key === 'Escape') { q.value = ''; go('#/'); } });

window.addEventListener('hashchange', render);

document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); q.focus(); q.select(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); const l = curLecture(); if (l) saveLecture(l); doSync(true); return; }
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  const map = { t: () => insertStamp(false), m: () => insertStamp(true), k: () => actions.play(), j: () => actions.skip({ dataset: { d: -10 } }), l: () => actions.skip({ dataset: { d: 10 } }) };
  if (map[k] && curLecture()) { e.preventDefault(); map[k](); }
});

// incolla immagini, file e link direttamente nella lezione
document.addEventListener('paste', async e => {
  const lec = curLecture();
  if (!lec || $('#dlg').open) return;
  const files = [...(e.clipboardData?.files || [])];
  const inNotes = e.target.id === 'notes';
  if (files.length) {
    e.preventDefault();
    return addFiles(lec.id, files, { insert: inNotes });
  }
  const text = e.clipboardData?.getData('text/plain')?.trim();
  const editable = e.target.closest('input, textarea, [contenteditable=true]');
  if (!editable && text && /^https?:\/\/\S+$/.test(text)) {
    e.preventDefault();
    addLink(lec.id, text);
  }
});

window.addEventListener('beforeunload', e => {
  const lec = curLecture();
  if (lec) saveLecture(lec);
  if (S.rec || S.job) { e.preventDefault(); e.returnValue = ''; }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') doSync(false);
  else { const l = curLecture(); if (l) saveLecture(l); }
});

db.onChange(() => { S.dirty = true; updatePill(); syncSoon(); });

// ======================================================================
// Avvio
// ======================================================================
(async function init() {
  await loadState();
  await sync.loadFolder();
  render();
  await recoverRecordings();
  if (sync.folderName()) doSync(false);
  else updatePill();
  if (!S.lectures.size) renderNav();
})().catch(e => {
  console.error(e);
  $('#main').innerHTML = `<div class="page"><div class="card"><h2>Qualcosa è andato storto</h2><p class="muted">${esc(e.message)}</p><p class="muted small">Prova a ricaricare la pagina. Se usi la navigazione in incognito, alcuni browser bloccano l'archivio locale.</p></div></div>`;
});
