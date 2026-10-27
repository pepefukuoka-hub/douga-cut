// 一度開いたあとは、電波がなくても開けるようにする(自分のファイルだけを保存)
const CACHE = 'douga-v4';
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png',
  'vendor/ffmpeg.js', 'vendor/814.ffmpeg.js', 'vendor/ffmpeg-util.js', 'vendor/ffmpeg-core.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // 大きいwasmは、使ったときに一度だけ保存する
  const big = new URL(e.request.url).pathname.includes('/vendor/');
  const net = () => fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((ch) => ch.put(e.request, c)); } return r; });
  e.respondWith(big ? caches.match(e.request).then((hit) => hit || net()) : net().catch(() => caches.match(e.request)));
});
