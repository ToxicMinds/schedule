const CACHE = 'recompos-v5';
const SHELL = ['./', './index.html', './manifest.json', './sw.js', './icon.svg', './css/style.css', './js/utils.js', './js/config.js', './js/recipes.js', './js/workout-data.js', './js/sync.js', './js/alarms.js', './js/meals.js', './js/tracker.js', './js/app.js'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache pre-fill failed (non-fatal):', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  const url = new URL(req.url);
  const isSupabase = url.hostname.includes('supabase.co');
  if (isSupabase) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then(r =>
          r || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } })
        )
      )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(response => {
        if (response?.ok) {
          caches.open(CACHE).then(c => c.put(req, response.clone())).catch(() => {});
        }
        return response;
      }).catch(() => cached);
    })
  );
});

self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'RecompOS', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'RecompOS', {
      body: payload.body || '',
      icon: './icon.svg',
      badge: './icon.svg',
      vibrate: [300, 100, 300, 100, 300],
      requireInteraction: true,
      tag: payload.tag || 'recompos',
      data: { url: '/schedule/' },
      actions: [
        { action: 'open',    title: 'Open app' },
        { action: 'dismiss', title: 'Dismiss'  },
      ],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes('/schedule/') && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/schedule/');
    })
  );
});

const localTimers = new Map();
self.addEventListener('message', event => {
  if (event.data?.type !== 'SCHEDULE_ALARMS') return;
  localTimers.forEach(t => clearTimeout(t));
  localTimers.clear();
  const now = Date.now();
  (event.data.alarms || []).forEach(alarm => {
    const delay = alarm.fireAt - now;
    if (delay <= 0 || delay > 86400000) return;
    const tid = setTimeout(async () => {
      localTimers.delete(alarm.id);
      try {
        await self.registration.showNotification(alarm.title, {
          body: alarm.msg || '',
          icon: './icon.svg',
          badge: './icon.svg',
          vibrate: [300, 100, 300],
          tag: `local-${alarm.id}`,
          requireInteraction: true,
        });
      } catch (e) { console.warn('[SW] Local alarm failed:', e); }
    }, delay);
    localTimers.set(alarm.id, tid);
  });
  console.log(`[SW] ${localTimers.size} local alarm(s) queued.`);
});
