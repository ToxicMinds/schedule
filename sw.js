// RecompOS Service Worker
// Version: 3.0 — fixes 404 issues and adds notification support

const CACHE = 'recompos-v3';
const SHELL = ['./','./index.html','./manifest.json','./sw.js','./icon.svg'];

// ── INSTALL: cache app shell ─────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing v3...');
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => {
        console.log('[SW] Shell cached.');
        return self.skipWaiting(); // Activate immediately — don't wait for old SW
      })
      .catch(err => console.warn('[SW] Cache failed (non-fatal):', err))
  );
});

// ── ACTIVATE: clean old caches ───────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => {
          console.log('[SW] Removing old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim()) // Take control of all pages immediately
  );
});

// ── FETCH: serve from cache, fall back to network ────────
self.addEventListener('fetch', event => {
  const req = event.request;

  // Skip non-GET and non-http requests
  if (req.method !== 'GET') return;
  if (!req.url.startsWith('http')) return;

  // Skip external resources (fonts, CDN icons etc.) — let them hit the network
  const url = new URL(req.url);
  const isAppOrigin = url.hostname === 'toxicminds.github.io' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  if (!isAppOrigin) return; // Don't intercept external CDN calls

  if (req.mode === 'navigate') {
    // Page navigation: try network first, fall back to cached index
    event.respondWith(
      fetch(req)
        .catch(() => caches.match('./index.html')
          .then(r => r || new Response('<h1>Offline</h1><p>Open the app when connected once to cache it.</p>', {
            headers: {'Content-Type': 'text/html'}
          }))
        )
    );
    return;
  }

  // All other app assets: cache-first strategy
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      return fetch(req)
        .then(response => {
          if (!response || !response.ok) return response;
          // Cache successful responses
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
          return response;
        })
        .catch(() => {
          // Offline fallback for navigation
          if (req.mode === 'navigate') return caches.match('./index.html');
        });
    })
  );
});

// ── NOTIFICATION CLICK ───────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // Focus existing window if open
        for (const client of clients) {
          if (client.url.includes('/schedule/') && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open the app
        if (self.clients.openWindow) {
          return self.clients.openWindow('/schedule/');
        }
      })
  );
});

// ── ALARM SCHEDULER ──────────────────────────────────────
// Receives alarm schedules from the main thread and fires
// notifications at the right time (best-effort in SW context)
const pending = new Map();

self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'SCHEDULE_ALARMS') return;

  // Clear existing scheduled alarms
  pending.forEach(tid => clearTimeout(tid));
  pending.clear();

  const now = Date.now();
  const alarms = event.data.alarms || [];

  alarms.forEach(alarm => {
    const delay = alarm.fireAt - now;
    if (delay <= 0 || delay > 86400000) return; // Only within 24 hours

    const tid = setTimeout(async () => {
      pending.delete(alarm.id);
      try {
        await self.registration.showNotification(alarm.title, {
          body: alarm.msg,
          icon: './icon.svg',
          badge: './icon.svg',
          vibrate: [300, 100, 300, 100, 300],
          tag: alarm.id,
          requireInteraction: true,
          data: { url: '/schedule/' }
        });
      } catch (err) {
        console.warn('[SW] Alarm notification failed:', err);
      }
    }, delay);

    pending.set(alarm.id, tid);
  });

  console.log(`[SW] Scheduled ${pending.size} alarm(s) for today.`);
});
