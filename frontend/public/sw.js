// Service worker de Codex Manager: hace que la app abra al instante (y sin red
// muestre la última interfaz). Nunca cachea /api: los datos siempre son en vivo.
const SHELL = 'cm-shell-v7';
const ASSETS = 'cm-assets-v7';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => ![SHELL, ASSETS].includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/art/')) {
    // JS/CSS con hash e ilustraciones de esta versión: primero la caché.
    event.respondWith(caches.open(ASSETS).then(async cache => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }
  if (event.request.mode === 'navigate') {
    // Navegación: primero la red (para recibir la versión nueva), la caché si no hay conexión.
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) caches.open(SHELL).then(cache => cache.put('/', response.clone()));
      return response;
    }).catch(() => caches.match('/')));
  }
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Codex Manager', {
    body: data.body || 'Tienes novedades en tus proyectos.', icon: '/icons/icon-192.png', badge: '/icons/favicon-32.png',
    tag: data.tag || 'cm-update', data: {url: data.url || '/'},
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(async clients => {
    const client = clients.find(item => new URL(item.url).origin === self.location.origin);
    if (client) { await client.navigate(target.href); return client.focus(); }
    return self.clients.openWindow(target.href);
  }));
});
