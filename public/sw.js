// Service worker del MD58 Club: la app abre aunque no haya señal (muestra lo último) y recibe notificaciones.
const CACHE = 'md58club-v1';
const BASE = ['/', '/estilos.css', '/app.js', '/vendor/qrcode.js', '/iconos/icono-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/panel') || u.pathname.startsWith('/caja')) return;
  if (e.request.mode === 'navigate') { e.respondWith(fetch(e.request).catch(() => caches.match('/'))); return; }
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { d = { cuerpo: e.data && e.data.text() }; }
  // Safari exige mostrar SIEMPRE una notificación por cada push (si no, revoca el permiso).
  e.waitUntil(self.registration.showNotification(d.titulo || 'MD58 Club', { body: d.cuerpo || '', icon: '/iconos/icono-192.png', badge: '/iconos/icono-192.png', data: { url: d.url || '/tarjeta' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/tarjeta';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { for (const c of cs) if ('focus' in c) { c.navigate(url); return c.focus(); } return self.clients.openWindow(url); }));
});
