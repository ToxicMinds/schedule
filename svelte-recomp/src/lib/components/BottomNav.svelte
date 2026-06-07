<script lang="ts">
  import { page } from '$app/stores';
  import { base } from '$app/paths';

  const tabs = [
    { id: '/', label: 'Today', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { id: '/alarms', label: 'Alarms', icon: 'M12 2v4m0 4a4 4 0 100 8 4 4 0 000-8zm0 0V2m0 0l-2 2m2-2l2 2M3 12h4m10 0h4' },
    { id: '/recipes', label: 'Food', icon: 'M12 6V2m0 4a4 4 0 100 8 4 4 0 000-8zm0 0V2m0 0l-2 2m2-2l2 2M3 12h4m10 0h4' },
    { id: '/track', label: 'Track', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    { id: '/workouts', label: 'Gym', icon: 'M7 11V7a4 4 0 018 0v4M3 15h18M5 15v4a1 1 0 001 1h12a1 1 0 001-1v-4' },
    { id: '/plan', label: 'Plan', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
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
  #bottom-nav{background:var(--bg2);border-top:1px solid var(--border);display:flex;align-items:flex-start;height:calc(var(--nav-h)+var(--sb));padding-bottom:var(--sb);flex-shrink:0;z-index:50}
  .nb{flex:1;height:var(--nav-h);border:none;background:none;color:var(--muted);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:9px;font-weight:600;letter-spacing:.2px;transition:color .15s;text-decoration:none}
  .nb svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .nb.active{color:var(--amber)}
</style>
