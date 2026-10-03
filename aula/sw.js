// Service worker: l'app si apre anche senza internet (es. aula senza Wi-Fi).
// File dell'app: rete prima (così gli aggiornamenti arrivano subito), cache se offline.
// Librerie da CDN: cache prima.
const CACHE = 'aula-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon.svg',
  'js/app.js', 'js/db.js', 'js/sync.js', 'js/transcribe.js', 'js/whisper-worker.js', 'js/ai.js', 'js/recorder.js',
  'vendor/marked.esm.js', 'vendor/purify.es.mjs', 'vendor/fflate.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('aula-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  // librerie JS/WASM da jsDelivr (i modelli Whisper li mette in cache transformers.js da solo)
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
