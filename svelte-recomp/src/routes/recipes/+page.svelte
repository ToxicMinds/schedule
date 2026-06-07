<script lang="ts">
  import { recipes } from '$lib/data/recipes';

  let selected = $state<typeof recipes[number] | null>(null);
  let method: 'stovetop' | 'instantPot' = $state('stovetop');

  const catOrder = ['protein', 'veg', 'dairy', 'dry'] as const;
  const catLabel: Record<string, string> = { protein: 'Protein', veg: 'Vegetables', dairy: 'Dairy', dry: 'Pantry' };
</script>

<div class="page-hd">Batch Cook</div>
<div class="page-sub">{recipes.length} chicken curry recipes &middot; Cook Sunday, eat all week</div>

{#each recipes as r}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="rcard" onclick={() => selected = r}>
    <div class="flex jb ac">
      <div>
        <div style="font-weight:700;color:#fff;font-size:15px">{r.e} {r.name}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">{r.desc}</div>
      </div>
      <div style="text-align:right;font-size:12px">
        <div style="color:var(--amber);font-weight:700">{r.k} kcal</div>
        <div style="color:var(--muted)">{r.p}p &middot; {r.c}c &middot; {r.f}f</div>
      </div>
    </div>
    <div class="flex gap2" style="margin-top:8px">
      <span class="badge bg">{r.t} min</span>
      <span class="badge ba">{r.batch} servings</span>
    </div>
  </div>
{/each}

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="moverlay" class:open={selected !== null} onpointerdown={() => selected = null}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="mbox" onclick={(e) => e.stopPropagation()}>
    <div class="mhandle"></div>
    {#if selected}
      <div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:4px">{selected.e} {selected.name}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">{selected.k} kcal &middot; {selected.p}g protein &middot; {selected.c}g carbs &middot; {selected.f}g fat &middot; {selected.t} min</div>

      <h3>Ingredients</h3>
      {#each catOrder as cat}
        {#if selected.ing.some(i => i.cat === cat)}
          <div style="font-size:11px;color:var(--muted);margin:6px 0 3px">{catLabel[cat]}</div>
          {#each selected.ing.filter(i => i.cat === cat) as ing}
            <div class="gi" style="padding:5px 0">
              <div class="gn">{ing.n}</div>
              <div class="gp">{ing.a}</div>
            </div>
          {/each}
        {/if}
      {/each}

      <h3>Method</h3>
      <div class="tab-row">
        <button class="tab" class:on={method === 'stovetop'} onclick={() => method = 'stovetop'}>Stovetop</button>
        <button class="tab" class:on={method === 'instantPot'} onclick={() => method = 'instantPot'}>Instant Pot</button>
      </div>

      <div class="card" style="margin-bottom:0">
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px">PREP</div>
        {#each selected.prep as step, i}
          <div class="gi" style="padding:5px 0"><div class="gn">{i+1}. {step}</div></div>
        {/each}
        <hr style="border:none;border-top:1px solid var(--border);margin:8px 0">
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px">{method === 'instantPot' ? 'INSTANT POT' : 'STOVETOP'}</div>
        {#each (method === 'instantPot' ? selected.instantPot : selected.steps) as step, i}
          <div class="gi" style="padding:5px 0"><div class="gn">{i+1}. {step}</div></div>
        {/each}
      </div>
    {/if}
  </div>
</div>
