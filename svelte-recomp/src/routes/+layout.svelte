<script lang="ts">
  import '../app.css';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import { syncStatus } from '$lib/stores/sync';
  import { user } from '$lib/stores/user';
  import { initAuth } from '$lib/stores/user';
  import { initSync, destroySync } from '$lib/stores/sync';
  import { subscribeWebPush } from '$lib/push';

  let { children }: { children: import('svelte').Snippet } = $props();
  let loading = $state(true);

  $effect(() => {
    let cancelled = false;

    (async () => {
      await initAuth();
      if (cancelled) return;

      const unsub = user.subscribe((u) => {
        if (u && !cancelled) {
          initSync(u.id);
          subscribeWebPush(u.id);
        }
      });
      unsub();

      loading = false;
    })();

    return () => {
      cancelled = true;
      destroySync();
    };
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
      <button class="icn-btn" onclick={toggleTheme} title="Toggle theme">☀️</button>
    </div>
  </div>

  <main id="pages">
    {#if loading}
      <div style="padding:40px;text-align:center;color:var(--muted)">Loading...</div>
    {:else}
      {@render children()}
    {/if}
  </main>

  <BottomNav />
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
</style>
