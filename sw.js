/* Frequency Oasis — MIDI DNA service worker: cache-first app shell, works offline. */
const VERSION = 'fo-midi-dna-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png',
  'theory.js', 'midi-parser.js', 'analysis-tonal.js', 'analysis-motion.js', 'analysis-character.js', 'analysis-session.js', 'audio-engine.js', 'viz-core.js', 'piano-roll.js', 'viz-helix.js', 'viz-chladni.js', 'viz-geometry.js', 'exports.js', 'demo.js', 'views.js', 'views2.js', 'views3.js', 'app.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request; if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(r, copy)); } return res; }).catch(() => r.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
