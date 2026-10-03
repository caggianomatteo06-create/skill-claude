// Trascrizione locale con Whisper (transformers.js). Gira in un Web Worker:
// l'audio non lascia mai il computer. Il modello si scarica una volta sola
// e resta in cache nel browser.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

env.allowLocalModels = false;

let asr = null;
let loadedKey = '';

async function load(model, device) {
  const key = model + '|' + device;
  if (asr && loadedKey === key) return;
  if (asr) { try { await asr.dispose(); } catch {} asr = null; }
  const dtype = device === 'webgpu'
    ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
    : 'q8';
  asr = await pipeline('automatic-speech-recognition', model, {
    device,
    dtype,
    progress_callback: p => {
      if (p.status === 'progress_total') {
        self.postMessage({ type: 'download', progress: p.progress, loaded: p.loaded, total: p.total });
      }
    },
  });
  loadedKey = key;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      let device = data.device;
      try {
        await load(data.model, device);
      } catch (e) {
        if (device !== 'webgpu') throw e;
        // WebGPU non disponibile o instabile: riprova con WASM (CPU)
        device = 'wasm';
        await load(data.model, device);
      }
      self.postMessage({ type: 'ready', device });
    } else if (data.type === 'transcribe') {
      const out = await asr(data.audio, {
        language: data.language || 'italian',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
      });
      const dur = data.audio.length / 16000;
      const chunks = (out.chunks || [{ timestamp: [0, dur], text: out.text }]).map(c => ({
        start: (c.timestamp[0] ?? 0) + data.offset,
        end: (c.timestamp[1] ?? dur) + data.offset,
        text: (c.text || '').trim(),
      })).filter(c => c.text);
      self.postMessage({ type: 'result', id: data.id, chunks });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: data.id, message: String(e && e.message || e) });
  }
};
