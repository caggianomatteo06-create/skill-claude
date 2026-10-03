// Registratore: MediaRecorder + salvataggio incrementale in IndexedDB.
import * as db from './db.js';

function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];
  return opts.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

export const recSupported = !!(navigator.mediaDevices && window.MediaRecorder);

export class Recorder {
  constructor({ lectureId, part, onLevel }) {
    this.lectureId = lectureId;
    this.part = part;
    this.recId = `${lectureId}|${part}`;
    this.onLevel = onLevel;
    this.acc = 0;           // secondi accumulati prima dell'ultima ripresa
    this.since = null;      // performance.now() dell'ultima ripresa
    this.paused = false;
  }

  elapsed() {
    return this.acc + (this.since !== null ? (performance.now() - this.since) / 1000 : 0);
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.mime = pickMime();
    // 32 kbit/s Opus: voce chiara, ~15 MB per un'ora e mezza
    this.mr = new MediaRecorder(this.stream, { mimeType: this.mime || undefined, audioBitsPerSecond: 32000 });
    this.mime = this.mr.mimeType || this.mime || 'audio/webm';
    this.mr.ondataavailable = e => {
      if (e.data && e.data.size) {
        db.addRecChunk(this.recId, e.data, { lectureId: this.lectureId, part: this.part, mime: this.mime, elapsed: this.elapsed() });
      }
    };
    this.mr.start(5000);
    // lock: un'altra scheda di Aula non deve "recuperare" questa registrazione mentre è in corso
    navigator.locks?.request('aula-rec:' + this.recId, () => new Promise(r => { this.releaseLock = r; }));
    this.since = performance.now();
    this.meter();
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch {}
    this.onVis = async () => {
      // il wake lock decade quando la pagina va in secondo piano: lo riprendiamo
      if (document.visibilityState === 'visible' && (!this.wake || this.wake.released)) {
        try { this.wake = await navigator.wakeLock?.request('screen'); } catch {}
      }
    };
    document.addEventListener('visibilitychange', this.onVis);
  }

  meter() {
    try {
      this.ac = new AudioContext();
      const src = this.ac.createMediaStreamSource(this.stream);
      const an = this.ac.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        if (!this.ac) return;
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        this.onLevel && this.onLevel(peak / 128);
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {}
  }

  pause() {
    if (this.paused) return;
    this.mr.pause();
    this.acc = this.elapsed();
    this.since = null;
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    this.mr.resume();
    this.since = performance.now();
    this.paused = false;
  }

  // Ferma e restituisce { blob, mime, duration }
  async stop() {
    const duration = this.elapsed();
    await new Promise(res => {
      this.mr.addEventListener('stop', res, { once: true });
      this.mr.stop();
    });
    // lascia il tempo all'ultimo ondataavailable di finire la scrittura
    await new Promise(r => setTimeout(r, 300));
    this.cleanup();
    const chunks = await db.getRecChunks(this.recId);
    const blob = new Blob(chunks.map(c => c.blob), { type: this.mime });
    return { blob, mime: this.mime, duration, recId: this.recId };
  }

  cleanup() {
    cancelAnimationFrame(this.raf);
    try { this.ac && this.ac.close(); } catch {}
    this.ac = null;
    this.stream && this.stream.getTracks().forEach(t => t.stop());
    try { this.wake && this.wake.release(); } catch {}
    document.removeEventListener('visibilitychange', this.onVis);
    this.releaseLock && this.releaseLock();
  }
}

// Recupera registrazioni rimaste a metà (browser chiuso, crash, batteria…)
export async function recoverPending() {
  const out = [];
  const held = new Set(((await navigator.locks?.query())?.held || []).map(l => l.name));
  for (const recId of await db.pendingRecIds()) {
    if (held.has('aula-rec:' + recId)) continue;
    const chunks = await db.getRecChunks(recId);
    if (!chunks.length) continue;
    const meta = chunks[chunks.length - 1].meta || {};
    out.push({
      recId,
      lectureId: meta.lectureId,
      mime: meta.mime || 'audio/webm',
      duration: meta.elapsed || 0,
      blob: new Blob(chunks.map(c => c.blob), { type: meta.mime || 'audio/webm' }),
    });
  }
  return out;
}
