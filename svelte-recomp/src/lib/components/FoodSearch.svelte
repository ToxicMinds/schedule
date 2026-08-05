<script lang="ts">
  // A combined food search: it looks in TWO places at once.
  //   1. "Your foods" — everything you've logged before (deduped by name,
  //      most-used first), matched instantly from IndexedDB. Picking one fills
  //      the exact portion/macros you saved, because it's your own entry.
  //   2. The Open Food Facts database (3M+ products, keyless) for anything you
  //      haven't logged yet. Those values are per-100g, so the form flags them
  //      "adjust portion" the same way a barcode scan does.
  // Typing filters your own foods with zero latency; the online search is
  // debounced and only fires for queries of 2+ characters.
  type Food = { name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  type MyFood = Food & { count: number };

  let {
    myFoods,
    onPick,
  }: {
    myFoods: MyFood[];
    onPick: (food: Food, per100g: boolean) => void;
  } = $props();

  let query = $state('');
  let open = $state(false);
  let offResults = $state<Food[]>([]);
  let searching = $state(false);
  let offError = $state('');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let reqId = 0;

  const q = $derived(query.trim().toLowerCase());

  // Instant, local matches from the user's own history.
  const myMatches = $derived.by(() => {
    if (!q) return [] as MyFood[];
    return myFoods.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 6);
  });

  async function searchOff(term: string) {
    const id = ++reqId;
    searching = true;
    offError = '';
    try {
      const url =
        `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(term)}` +
        `&search_simple=1&action=process&json=1&page_size=20` +
        `&fields=product_name,brands,nutriments`;
      const res = await fetch(url);
      const data = await res.json();
      if (id !== reqId) return; // a newer keystroke already superseded this
      const rows: Food[] = [];
      for (const p of data.products || []) {
        const name = (p.product_name || '').trim();
        const n = p.nutriments || {};
        const kcal = n['energy-kcal_100g'];
        if (!name || kcal == null) continue; // skip products with no usable macros
        const brand = (p.brands || '').split(',')[0].trim();
        rows.push({
          name: brand ? `${name} · ${brand}` : name,
          kcal: Math.round(kcal),
          protein_g: Math.round(n['proteins_100g'] ?? 0),
          carbs_g: Math.round(n['carbohydrates_100g'] ?? 0),
          fat_g: Math.round(n['fat_100g'] ?? 0),
        });
        if (rows.length >= 12) break;
      }
      offResults = rows;
    } catch (e: any) {
      if (id !== reqId) return;
      offError = 'Online search unavailable — check connection.';
      offResults = [];
    } finally {
      if (id === reqId) searching = false;
    }
  }

  $effect(() => {
    const term = query.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (term.length < 2) { offResults = []; searching = false; return; }
    debounceTimer = setTimeout(() => searchOff(term), 350);
  });

  function pickMine(f: MyFood) {
    onPick({ name: f.name, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g }, false);
    reset();
  }
  function pickOff(f: Food) {
    onPick(f, true);
    reset();
  }
  function reset() {
    query = '';
    offResults = [];
    open = false;
  }
</script>

<div class="fsearch">
  <input
    class="fsearch-input"
    placeholder="🔍 Search your foods or the database…"
    bind:value={query}
    onfocus={() => open = true}
    autocomplete="off"
  />

  {#if open && q}
    <div class="fsearch-panel">
      {#if myMatches.length > 0}
        <div class="fsearch-sec">Your foods</div>
        {#each myMatches as f}
          <button type="button" class="fsearch-row" onclick={() => pickMine(f)}>
            <span class="fsearch-nm">{f.name}</span>
            <span class="fsearch-mac">{Math.round(f.kcal)} kcal · P{Math.round(f.protein_g)}</span>
          </button>
        {/each}
      {/if}

      <div class="fsearch-sec">
        Database{#if searching} <span class="fsearch-spin">searching…</span>{/if}
      </div>
      {#if offError}
        <div class="fsearch-empty">{offError}</div>
      {:else if offResults.length > 0}
        {#each offResults as f}
          <button type="button" class="fsearch-row" onclick={() => pickOff(f)}>
            <span class="fsearch-nm">{f.name}</span>
            <span class="fsearch-mac">{f.kcal} kcal · P{f.protein_g} <em>/100g</em></span>
          </button>
        {/each}
      {:else if !searching && q.length >= 2}
        <div class="fsearch-empty">No matches — type below to add it manually.</div>
      {:else if q.length < 2}
        <div class="fsearch-empty">Keep typing to search the database…</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .fsearch{position:relative;margin-bottom:8px}
  .fsearch-input{width:100%}
  .fsearch-panel{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:60;background:var(--bg2);border:1px solid var(--glass-brd);border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.4);max-height:320px;overflow-y:auto;padding:4px}
  .fsearch-sec{font-size:0.625rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:8px 10px 4px}
  .fsearch-spin{font-weight:600;text-transform:none;letter-spacing:0;color:var(--amber)}
  .fsearch-row{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;background:none;border:none;text-align:left;padding:9px 10px;border-radius:9px;cursor:pointer;font-family:inherit;color:var(--text)}
  .fsearch-row:hover,.fsearch-row:active{background:var(--glass-2)}
  .fsearch-nm{font-size:0.8125rem;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fsearch-mac{font-size:0.6875rem;color:var(--muted);white-space:nowrap;flex-shrink:0}
  .fsearch-mac em{opacity:.7;font-style:normal}
  .fsearch-empty{font-size:0.75rem;color:var(--muted);padding:8px 10px 10px}
</style>
