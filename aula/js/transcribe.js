// Trascrizione: tre strade, dalla più semplice alla più potente.
//  - live: Web Speech API mentre registri (Chrome/Edge, serve internet)
//  - locale: Whisper nel browser, gratis e privato (lento su PC deboli)
//  - cloud: API compatibile OpenAI (Groq gratuito, OpenAI…), veloce
// Claude non accetta audio in ingresso: per questo la trascrizione si fa qui
// e poi il testo va a Claude per riassunti e appunti.

export const LOCAL_MODELS = [
  { id: 'onnx-community/whisper-base', label: 'Whisper Base (~80 MB, veloce, qualità discreta)' },
  { id: 'onnx-community/whisper-small', label: 'Whisper Small (~250 MB, consigliato per l\'italiano)' },
  { id: 'onnx-community/whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (~800 MB, solo con GPU/WebGPU)' },
];

export const CLOUD_PRESETS = {
  groq: { label: 'Groq (gratis con limiti, velocissimo)', base: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'whisper-1' },
  custom: { label: 'Altro servizio compatibile OpenAI', base: '', model: 'whisper-1' },
};

const SR = 16000;

// Decodifica qualsiasi file audio/video in PCM mono a 16 kHz.
export async function decodeAudio(blob) {
  const buf = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, SR, SR);
  const audio = await ctx.decodeAudioData(buf);
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / audio.numberOfChannels;
  }
  return out;
}

// Divide l'audio in finestre, tagliando nel punto più silenzioso vicino al
// confine così da non spezzare le parole a metà.
export function windows(pcm, seconds) {
  const out = [];
  const win = seconds * SR, look = 4 * SR, frame = SR / 20;
  let start = 0;
  while (start < pcm.length) {
    let end = Math.min(pcm.length, start + win);
    if (end < pcm.length) {
      let best = end, bestE = Infinity;
      for (let p = end - look; p < end; p += frame) {
        let e = 0;
        for (let i = p; i < p + frame; i++) e += pcm[i] * pcm[i];
        if (e < bestE) { bestE = e; best = p + frame / 2; }
      }
      end = Math.floor(best);
    }
    out.push({ offset: start / SR, data: pcm.subarray(start, end) });
    start = end;
  }
  return out;
}

// ---------- Whisper nel browser

let worker = null;
let reqId = 0;
const pending = new Set();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
    // es. libreria non scaricabile (offline, rete che blocca il CDN): non restare appesi
    worker.addEventListener('error', e => {
      e.preventDefault();
      const err = new Error('Impossibile avviare Whisper nel browser' + (e.message ? ': ' + e.message : '') +
        '. Controlla la connessione (la prima volta serve internet) oppure usa la trascrizione cloud.');
      for (const rej of pending) rej(err);
      pending.clear();
      worker.terminate();
      worker = null;
    });
  }
  return worker;
}

function ask(msg, onEvent) {
  const w = getWorker();
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    const h = ({ data }) => {
      if (data.type === 'download') { onEvent && onEvent(data); return; }
      if (data.id !== undefined && data.id !== id && data.type !== 'ready') return;
      w.removeEventListener('message', h);
      pending.delete(reject);
      if (data.type === 'error') reject(new Error(data.message));
      else resolve(data);
    };
    pending.add(reject);
    w.addEventListener('message', h);
    w.postMessage({ ...msg, id });
  });
}

export function cancelLocal() {
  if (worker) { worker.terminate(); worker = null; }
  for (const rej of pending) rej(new DOMException('Annullato', 'AbortError'));
  pending.clear();
}

export async function transcribeLocal(blob, { model, language = 'italian', onProgress, onSegments, signal }) {
  onProgress({ phase: 'Decodifico l\'audio…', pct: 0 });
  const pcm = await decodeAudio(blob);
  const device = 'gpu' in navigator ? 'webgpu' : 'wasm';
  onProgress({ phase: 'Carico il modello (solo la prima volta lo scarica)…', pct: 0 });
  const ready = await ask({ type: 'load', model, device }, d =>
    onProgress({ phase: `Scarico il modello… ${Math.round(d.progress || 0)}%`, pct: 0 }));
  const wins = windows(pcm, 120);
  const all = [];
  for (let i = 0; i < wins.length; i++) {
    if (signal && signal.aborted) throw new DOMException('Annullato', 'AbortError');
    onProgress({ phase: `Trascrivo (${ready.device === 'webgpu' ? 'GPU' : 'CPU'}) — parte ${i + 1} di ${wins.length}`, pct: i / wins.length });
    // copia: il buffer viene trasferito al worker
    const audio = wins[i].data.slice();
    const res = await ask({ type: 'transcribe', audio, offset: wins[i].offset, language }, null);
    all.push(...res.chunks);
    onSegments(res.chunks);
  }
  onProgress({ phase: 'Fatto', pct: 1 });
  return all;
}

// ---------- Cloud (API compatibile OpenAI /audio/transcriptions)

function wav(pcm) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export async function transcribeCloud(blob, { base, model, key, language = 'it', onProgress, onSegments, signal }) {
  if (!key) throw new Error('Manca la chiave API del servizio di trascrizione (Impostazioni).');
  onProgress({ phase: 'Decodifico l\'audio…', pct: 0 });
  const pcm = await decodeAudio(blob);
  // 10 minuti di WAV 16 kHz mono ≈ 19 MB: sotto il limite di 25 MB dei servizi
  const wins = windows(pcm, 600);
  const all = [];
  for (let i = 0; i < wins.length; i++) {
    onProgress({ phase: `Invio parte ${i + 1} di ${wins.length}…`, pct: i / wins.length });
    const fd = new FormData();
    fd.append('file', wav(wins[i].data), `parte-${i + 1}.wav`);
    fd.append('model', model);
    fd.append('language', language);
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'segment');
    const r = await fetch(base.replace(/\/$/, '') + '/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd, signal,
    });
    if (!r.ok) throw new Error(`Errore ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const segs = (j.segments || [{ start: 0, end: wins[i].data.length / SR, text: j.text }])
      .map(s => ({ start: s.start + wins[i].offset, end: s.end + wins[i].offset, text: (s.text || '').trim() }))
      .filter(s => s.text);
    all.push(...segs);
    onSegments(segs);
  }
  onProgress({ phase: 'Fatto', pct: 1 });
  return all;
}

// ---------- Live (Web Speech API)

export const liveSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export function startLive({ lang = 'it-IT', clock, onFinal, onInterim, onError }) {
  const SRc = window.SpeechRecognition || window.webkitSpeechRecognition;
  let stopped = false;
  let rec = null;
  let segStart = null;
  const run = () => {
    rec = new SRc();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = ev => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (segStart === null) segStart = clock();
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          if (text) onFinal({ start: segStart, end: clock(), text });
          segStart = null;
        } else interim += r[0].transcript;
      }
      onInterim(interim);
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopped = true; onError(e.error); }
    };
    // il riconoscimento si ferma da solo dopo un po': lo riavviamo
    rec.onend = () => { if (!stopped) setTimeout(() => { if (!stopped) try { run(); } catch {} }, 250); };
    rec.start();
  };
  run();
  return {
    stop() { stopped = true; try { rec.stop(); } catch {} onInterim(''); },
  };
}

// ---------- Import sottotitoli / trascrizioni esterne (Teams, Zoom, YouTube…)

const tsToSec = t => {
  const m = t.trim().replace(',', '.').match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3];
};

export function parseTranscriptText(text) {
  text = text.replace(/\r/g, '').trim();
  const cue = /((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*((?:\d+:)?\d+:\d+[.,]\d+)[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  const segs = [];
  let m;
  while ((m = cue.exec(text))) {
    const body = m[3].replace(/<v\s+([^>]+)>/g, '$1: ').replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim();
    if (body) segs.push({ start: tsToSec(m[1]), end: tsToSec(m[2]), text: body });
  }
  if (segs.length) return segs;
  // righe del tipo "[12:34] testo" o "12:34 testo"
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const re = /^\[?((?:\d+:)?\d{1,2}:\d{2})\]?\s*[-–:]?\s*(.*)$/;
  if (lines.some(l => re.test(l))) {
    for (const l of lines) {
      const mm = l.match(re);
      if (mm) segs.push({ start: tsToSec(mm[1]), end: null, text: mm[2] });
      else if (segs.length) segs[segs.length - 1].text += ' ' + l;
    }
    return segs.filter(s => s.text);
  }
  // testo semplice: un paragrafo per segmento, senza tempi
  return text.split(/\n\s*\n/).map(p => ({ start: null, end: null, text: p.replace(/\n/g, ' ').trim() })).filter(s => s.text);
}
