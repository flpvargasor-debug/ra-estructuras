// Service worker: guarda la app completa para uso sin conexión.
const CACHE = 'ra-estructuras-v1';
const FILES = [
  './', 'index.html', 'app.js', 'manifest.webmanifest', 'demo.glb',
  'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/three.module.min.js',
  'vendor/addons/controls/OrbitControls.js',
  'vendor/addons/loaders/GLTFLoader.js', 'vendor/addons/loaders/ColladaLoader.js',
  'vendor/addons/loaders/OBJLoader.js', 'vendor/addons/loaders/MTLLoader.js',
  'vendor/addons/loaders/TGALoader.js', 'vendor/addons/utils/BufferGeometryUtils.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok && new URL(e.request.url).origin === location.origin) {
        const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match('index.html')))
  );
});
