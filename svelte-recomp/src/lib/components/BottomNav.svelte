<script lang="ts">
  import { page } from '$app/stores';
  import { base } from '$app/paths';

  const tabs = [
    { id: '/', label: 'Today', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { id: '/recipes', label: 'Food', icon: 'M12 6V2m0 4a4 4 0 100 8 4 4 0 000-8zm0 0V2m0 0l-2 2m2-2l2 2M3 12h4m10 0h4' },
    { id: '/workouts', label: 'Gym', icon: 'M7 11V7a4 4 0 018 0v4M3 15h18M5 15v4a1 1 0 001 1h12a1 1 0 001-1v-4' },
    { id: '/alarms', label: 'Alarms', icon: 'M12 2v4m0 4a4 4 0 100 8 4 4 0 000-8zm0 0V2m0 0l-2 2m2-2l2 2M3 12h4m10 0h4' },
  ];

  const currentPath = $derived($page.url.pathname);
</script>

<nav id="bottom-nav">
  {#each tabs as tab}
    <a href={base + tab.id} class="nb" class:active={currentPath === base + tab.id}>
      <svg viewBox="0 0 24 24"><path d={tab.icon}/></svg>
      {tab.label}
    </a>
  {/each}
</nav>

<style>
  #bottom-nav{background:linear-gradient(0deg,var(--bg2),color-mix(in srgb,var(--bg2) 94%, black));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid var(--border);display:flex;align-items:flex-start;height:calc(var(--nav-h)+var(--sb));padding:6px 6px var(--sb);flex-shrink:0;z-index:50;box-shadow:0 -4px 20px rgba(0,0,0,.15)}
  .nb{flex:1;height:calc(var(--nav-h) - 6px);border:none;background:none;color:var(--muted);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:9px;font-weight:700;letter-spacing:.2px;transition:color .2s var(--ease),transform .2s var(--ease);text-decoration:none;border-radius:12px;position:relative}
  .nb:active{transform:scale(.92)}
  .nb svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s var(--ease)}
  .nb.active{color:var(--amber)}
  .nb.active svg{transform:translateY(-1px) scale(1.08)}
  .nb.active::before{content:'';position:absolute;top:2px;width:32px;height:32px;border-radius:10px;background:var(--ab);z-index:-1}
</style>
