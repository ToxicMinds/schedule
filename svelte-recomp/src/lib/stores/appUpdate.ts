import { writable } from 'svelte/store';

// — App update / "am I on the latest deploy?" —
//
// Drives the tiny indicator in the top bar. The service worker uses a
// controlled-update model (see service-worker.ts): a new deploy installs a
// new worker that WAITS instead of auto-activating, so the current session
// keeps working (and stays logged in). This store watches for that waiting
// worker and lets the user apply the update on their own terms.

export const updateAvailable = writable(false);
export const checkingUpdate = writable(false);
export const swVersion = writable<string>('');

let reg: ServiceWorkerRegistration | null = null;
let userTriggeredReload = false;

function markAvailable() {
  updateAvailable.set(true);
}

function watchInstalling(worker: ServiceWorker | null) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    // A worker reaching "installed" while another worker already controls
    // the page means this is an UPDATE (not a first install) that is now
    // waiting — surface it.
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      markAvailable();
    }
  });
}

async function refreshVersion() {
  try {
    const controller = navigator.serviceWorker.controller;
    if (!controller) return;
    const version: string = await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => resolve(e.data?.version ?? '');
      controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
      setTimeout(() => reject(new Error('timeout')), 2000);
    });
    if (version) swVersion.set(version);
  } catch {
    /* version display is best-effort */
  }
}

// Wire everything up. Safe to call once from the root layout after the
// service worker has been registered.
export function initAppUpdate() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  navigator.serviceWorker.ready.then((registration) => {
    reg = registration;

    // A new worker was already downloaded and is waiting from a previous
    // deploy we haven't applied yet.
    if (registration.waiting && navigator.serviceWorker.controller) {
      markAvailable();
    }

    // A new worker started installing (deploy landed while app is open).
    registration.addEventListener('updatefound', () => {
      watchInstalling(registration.installing);
    });

    refreshVersion();
  }).catch(() => {});

  // When the (user-triggered) new worker takes control, reload exactly
  // once to swap onto the fresh assets. Guarded so it only ever fires
  // after an explicit "Update" tap — never as an ambient loop (a prior
  // attempt to reload on every controllerchange caused an infinite loop
  // and was reverted; this stays deliberate).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!userTriggeredReload) return;
    userTriggeredReload = false;
    location.reload();
  });

  // Proactively poll for a new deploy when the app regains focus and on a
  // gentle interval, so the badge appears without the user reopening.
  const check = () => checkForUpdate();
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  setInterval(check, 60_000);
}

export async function checkForUpdate() {
  if (!reg) return;
  checkingUpdate.set(true);
  try {
    await reg.update();
    if (reg.waiting && navigator.serviceWorker.controller) markAvailable();
  } catch {
    /* offline or transient — ignore */
  } finally {
    checkingUpdate.set(false);
  }
}

// Apply a waiting update: tell it to activate, then the controllerchange
// listener above reloads once onto the new version. localStorage (and thus
// the Supabase auth session) survives the reload, so the user stays signed in.
export function applyUpdate() {
  if (!reg) { location.reload(); return; }
  userTriggeredReload = true;
  if (reg.waiting) {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  } else {
    // No waiting worker cached the flag but still reload to be safe.
    location.reload();
  }
}
