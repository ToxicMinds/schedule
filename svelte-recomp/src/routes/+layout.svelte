<script lang="ts">
  import '../app.css';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import AuthGate from '$lib/components/AuthGate.svelte';
  import { syncStatus } from '$lib/stores/sync';
  import { user, authReady, initAuth, signOut } from '$lib/stores/user';
  import { initSync, destroySync } from '$lib/stores/sync';
  import { subscribeWebPush } from '$lib/push';
  import { playAlarmMelody } from '$lib/alarmSound';

  let { children }: { children: import('svelte').Snippet } = $props();
  let crashMsg = $state<string | null>(null);
  let syncStarted = false;

  $effect(() => {
    initAuth();
  });

  $effect(() => {
    const u = $user;
    if (u && !syncStarted) {
      syncStarted = true;
      initSync(u.id);
      subscribeWebPush(u.id);
    } else if (!u && syncStarted) {
      syncStarted = false;
      destroySync();
    }
  });

  // Global safety net: catch any error that escapes normal event handlers or
  // async code (these never trigger <svelte:boundary>, which only catches
  // errors thrown *during rendering*). Without this, an uncaught error here
  // just silently swallows a button tap with no feedback — which reads to a
  // user as "the app crashed/froze". Surface it instead of hiding it.
  $effect(() => {
    function onError(e: ErrorEvent) {
      console.error('Uncaught error:', e.error || e.message);
      crashMsg = (e.error?.message || e.message || 'Unknown error').slice(0, 200);
    }
    function onRejection(e: PromiseRejectionEvent) {
      console.error('Unhandled rejection:', e.reason);
      crashMsg = (e.reason?.message || String(e.reason) || 'Unknown error').slice(0, 200);
    }
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  });

  // Register the service worker for real (it previously existed on disk but
  // was never registered anywhere, so offline caching + push never actually
  // worked). The SW itself activates aggressively (skipWaiting + claim, see
  // service-worker.ts) -- but that only affects *future* fetches; an
  // already-open or backgrounded PWA keeps running whatever JS is already
  // loaded in memory. On iOS specifically, backgrounding a standalone PWA
  // and reopening it often just resumes the exact same in-memory page
  // instead of a real navigation/reload -- so "hard reload" or clearing
  // Safari's cache from Settings does NOT guarantee you're running the
  // latest deployed code, only a full force-quit (swipe away in the app
  // switcher) + reopen reliably does. Rather than rely on users knowing
  // that, actively check for a waiting update whenever the app becomes
  // visible again, and force a real reload the moment a new version takes
  // over -- this is the fix for "I did a hard reload and still don't see
  // the fix" reports.
  $effect(() => {
    if (!('serviceWorker' in navigator)) return;
    let reg: ServiceWorkerRegistration | undefined;

    navigator.serviceWorker.register('/service-worker.js', { type: 'module' }).then((r) => {
      reg = r;
    }).catch((e) => {
      console.error('SW registration failed:', e);
    });

    // Fires once a NEW service worker has taken control of this page --
    // at that point the currently-loaded JS bundle may reference stale
    // chunk URLs, so force a real reload to fetch the current app shell.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });

    function checkForUpdate() {
      reg?.update().catch(() => {});
    }
    // Check immediately, and again every time the app is foregrounded
    // (covers the "reopened from background without a real reload" case).
    checkForUpdate();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
  });

  // Plays a short synthesized melody (see $lib/alarmSound.ts) whenever
  // the service worker tells us an alarm just fired -- the system
  // notification's own sound is a short, generic ping with no way to
  // attach a custom sound file via the Web Notification API, so this
  // gives a fuller "this is an alarm, not just a ping" experience
  // whenever the app is actually open (foreground/background tab) or
  // gets opened by tapping the notification.
  $effect(() => {
    if (!('serviceWorker' in navigator)) return;
    function onMessage(e: MessageEvent) {
      if (e.data?.type === 'PLAY_ALARM_SOUND') playAlarmMelody();
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  });

  $effect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  });

  function toggleTheme() {
    const html = document.documentElement;
    const isLight = html.getAttribute('data-theme') === 'light';
    html.toggleAttribute('data-theme', !isLight);
    localStorage.setItem('theme', isLight ? 'dark' : 'light');
  }
</script>

<div id="app">
  {#if !$authReady}
    <div style="padding:40px;text-align:center;color:var(--muted)">Loading...</div>
  {:else if !$user}
    <AuthGate />
  {:else}
  <div id="topbar">
    <div class="flex ac gap2">
      <div id="topbar-title">RecompOS</div>
      <div id="sync-dot"
        class:synced={$syncStatus === 'synced'}
        class:syncing={$syncStatus === 'syncing'}
        class:error={$syncStatus === 'error'}
        title={$syncStatus}
      ></div>
    </div>
    <div class="flex ac gap2">
      <button class="icn-btn" onclick={signOut} title="Sign out">⎋</button>
      <button class="icn-btn" onclick={toggleTheme} title="Toggle theme">☀️</button>
    </div>
  </div>

  <main id="pages">
    <svelte:boundary onerror={(e) => { console.error('Render error:', e); crashMsg = (e as any)?.message || String(e); }}>
      {@render children()}
      {#snippet failed(error, reset)}
        <div class="crash-box">
          <div style="font-size:32px;margin-bottom:8px">⚠️</div>
          <div style="font-weight:700;color:#fff;margin-bottom:6px">Something broke on this screen</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:14px;word-break:break-word">{String((error as any)?.message || error)}</div>
          <button class="btn bp bfl" onclick={() => { crashMsg = null; reset(); }}>Try again</button>
          <button class="btn bg_ bfl" style="margin-top:8px" onclick={() => location.assign('/')}>Go to Today</button>
        </div>
      {/snippet}
    </svelte:boundary>
  </main>

  {#if crashMsg}
    <div class="crash-toast" role="alert">
      <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{crashMsg}</div>
      <button onclick={() => crashMsg = null}>&times;</button>
    </div>
  {/if}

  <BottomNav />
  {/if}
</div>

<style>
#topbar{background:linear-gradient(180deg,var(--bg2),color-mix(in srgb,var(--bg2) 94%, black));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:calc(var(--st)+10px) 18px 12px;min-height:calc(var(--st)+var(--top-h));z-index:50;flex-shrink:0}
#topbar-title{font-size:18px;font-weight:800;letter-spacing:-.4px;background:var(--grad-amber);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.icn-btn{width:36px;height:36px;border-radius:50%;border:1px solid var(--border);background:var(--bg3);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s var(--ease);font-size:16px}
.icn-btn:active{transform:scale(.9);border-color:var(--amber)}
#pages{flex:1;overflow-y:auto;overflow-x:hidden;padding:18px 16px calc(var(--nav-h)+28px+var(--sb))}
#sync-dot{width:8px;height:8px;border-radius:50%;background:var(--border2);margin-left:6px;flex-shrink:0;transition:background .4s;box-shadow:0 0 0 3px transparent}
  #sync-dot.synced{background:var(--green);box-shadow:0 0 0 3px var(--gb)}
  #sync-dot.syncing{background:var(--amber);animation:pulse 1s infinite}
  #sync-dot.error{background:var(--red);box-shadow:0 0 0 3px var(--rb)}
  #app{display:flex;flex-direction:column;height:100vh;height:100dvh}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  #pages > :global(*){animation:fadeUp .35s var(--ease)}
  .crash-box{text-align:center;padding:40px 20px}
  .crash-toast{position:fixed;left:12px;right:12px;bottom:calc(var(--nav-h)+var(--sb)+12px);z-index:100;background:var(--red);color:#fff;font-size:12px;font-weight:600;padding:10px 12px;border-radius:12px;display:flex;align-items:center;gap:8px;box-shadow:0 8px 24px rgba(0,0,0,.3)}
  .crash-toast button{background:none;border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;opacity:.8}
</style>
