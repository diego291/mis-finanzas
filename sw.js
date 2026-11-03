/* Service worker: la app abre sin internet y se actualiza sola cuando subes cambios a GitHub.
   Al publicar una versión nueva, sube el número de CACHE (y VERSION en app.js). */
const CACHE = 'mis-finanzas-v3.0.9';
const ASSETS = ['./', 'index.html', 'styles.css?v=3.0.9', 'app.js?v=3.0.9', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'mf-conf').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                                   // la sincronización (POST a Apps Script) no se toca
  const url = new URL(req.url);
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;
  if (req.mode === 'navigate') {                                       // páginas: primero la red, si no hay, la copia
    e.respondWith(fetch(req, { cache: 'no-store' }).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put('index.html', c)); return r; }).catch(() => caches.match('index.html')));
    return;
  }
  // archivos de la app: primero la red (así cada actualización llega al recargar), si no hay, la copia
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req, { cache: 'no-store' }).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  // fuentes: copia local al instante y se refresca por detrás
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});

/* Notificaciones: la hoja de Google "despierta" a la app y aquí se pide el contenido del aviso */
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let items = [];
    try {
      const hit = await (await caches.open('mf-conf')).match('conf');
      const conf = hit ? await hit.json() : null;
      if (conf && conf.url) {
        const r = await fetch(conf.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: conf.token, pull: conf.dev }) });
        const j = await r.json(); items = (j && j.items) || [];
      }
    } catch (err) { /* sin conexión: se muestra un aviso genérico */ }
    if (!items.length) items = [{ id: 'mf', title: 'Mis Finanzas', body: 'Tienes avisos nuevos. Toca para verlos.' }];
    for (const it of items.slice(-3)) {
      await self.registration.showNotification(it.title || 'Mis Finanzas', { body: it.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: it.id || 'mf', renotify: true, requireInteraction: !!it.urgent, data: { url: './' } });
    }
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.startsWith(self.registration.scope));
    return w ? w.focus() : self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  }));
});
