/* Service worker: оболочка берётся из кеша, поэтому приложение открывается без сети.
   Имя кеша версионированное — при обновлении старые кеши удаляются в activate. */
var CACHE = 'fincontrol-v1';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  // Страницу тянем из сети, чтобы обновления доезжали; офлайн — отдаём копию из кеша.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); }).catch(function () { });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || new Response('Нет сети и нет сохранённой копии', { status: 504 });
        });
      })
    );
    return;
  }

  // Остальное (иконки, шрифты) — сначала кеш, промах докладываем в кеш на будущее.
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () { });
        }
        return res;
      }).catch(function () {
        return new Response('', { status: 504, statusText: 'Офлайн' });
      });
    })
  );
});
