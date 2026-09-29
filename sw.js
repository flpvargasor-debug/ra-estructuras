// Service worker: guarda la app completa para uso sin conexión.
const CACHE = 'ra-estructuras-v5';
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
// Red primero (así siempre llega la última versión); si no hay conexión, se usa lo guardado.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000); // señal débil: no esperar más de 4 s
      const r = await fetch(req, { cache: 'no-cache', signal: ctl.signal }); clearTimeout(t);
      if (r.ok) { const c = await caches.open(CACHE); c.put(req, r.clone()); }
      return r;
    } catch {
      return (await caches.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? await caches.match('index.html') : Response.error());
    }
  })());
});
