/// <reference types="@sveltejs/kit" />
import { build, files, prerendered, version } from '$service-worker';

const CACHE = `recompos-${version}`;
const ASSETS = [...build, ...files, ...prerendered];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || !url.protocol.startsWith('http')) return;
  if (url.hostname.includes('supabase.co')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/').then((r) => r || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } }))
      )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});

const localTimers = new Map<string, number>();

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type !== 'SCHEDULE_ALARMS') return;

  localTimers.forEach((t) => clearTimeout(t));
  localTimers.clear();

  const now = Date.now();
  (event.data.alarms as Array<{ id: string; title: string; msg: string; fireAt: number }>).forEach((alarm) => {
    const delay = alarm.fireAt - now;
    if (delay <= 0 || delay > 86400000) return;
    const tid = setTimeout(async () => {
      localTimers.delete(alarm.id);
      try {
        await self.registration.showNotification(alarm.title, {
          body: alarm.msg || '',
          icon: '/icon.svg',
          badge: '/icon.svg',
          vibrate: [300, 100, 300],
          tag: `local-${alarm.id}`,
          requireInteraction: true
        });
      } catch {}
    }, delay);
    localTimers.set(alarm.id, tid);
  });
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload: { title?: string; body?: string; tag?: string };
  try { payload = event.data.json(); }
  catch { payload = { title: 'RecompOS', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'RecompOS', {
      body: payload.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      vibrate: [300, 100, 300, 100, 300],
      requireInteraction: true,
      tag: payload.tag || 'recompos',
      data: { url: '/' },
      actions: [
        { action: 'open', title: 'Open app' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes('/') && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
