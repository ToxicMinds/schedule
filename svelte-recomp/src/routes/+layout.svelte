<script lang="ts">
  import '../app.css';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import { syncStatus } from '$lib/stores/sync';
  import { user } from '$lib/stores/user';
  import { initAuth } from '$lib/stores/user';
  import { initSync, destroySync } from '$lib/stores/sync';

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
  #topbar{background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:calc(var(--st)+10px) 16px 10px;min-height:calc(var(--st)+var(--top-h));z-index:50;flex-shrink:0}
  #topbar-title{font-size:17px;font-weight:700;color:#fff;letter-spacing:-.3px}
  .icn-btn{width:34px;height:34px;border-radius:50%;border:none;background:var(--bg3);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;font-size:16px}
  #pages{flex:1;overflow-y:auto;overflow-x:hidden;padding:16px 16px calc(var(--nav-h)+24px+var(--sb))}
  #sync-dot{width:8px;height:8px;border-radius:50%;background:var(--border2);margin-left:6px;flex-shrink:0;transition:background .4s}
  #sync-dot.synced{background:var(--green)}
  #sync-dot.syncing{background:var(--amber);animation:pulse 1s infinite}
  #sync-dot.error{background:var(--red)}
  #app{display:flex;flex-direction:column;height:100vh;height:100dvh}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
</style>
