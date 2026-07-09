<script lang="ts">
  import { recipes } from '$lib/data/recipes';
  import { userId } from '$lib/stores/user';
  import { upsertRecord, syncStatus } from '$lib/stores/sync';
  import { liveFoodLogs, liveWeights } from '$lib/stores/live';
  import { START_KG } from '$lib/config';
  import db from '$lib/db/dexie';

  let selected = $state<typeof recipes[number] | null>(null);
  let method: 'stovetop' | 'instantPot' = $state('stovetop');

  const catOrder = ['protein', 'veg', 'dairy', 'dry'] as const;
  const catLabel: Record<string, string> = { protein: 'Protein', veg: 'Vegetables', dairy: 'Dairy', dry: 'Pantry' };

  // — Weekly meal plan —
  const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function mondayOf(d: Date): string {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // shift Sunday back to previous Monday
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    return monday.toISOString().slice(0, 10);
  }

  const weekStart = mondayOf(new Date());

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  let plan = $state<Record<string, number | null>>({});
  let planLoaded = $state(false);

  async function loadPlan() {
    if (!uid) return;
    const row = await db.table('meal_plans').get({ user_id: uid, week_start: weekStart });
    plan = row?.plan ?? {};
    planLoaded = true;
  }

  $effect(() => { if (uid && !planLoaded) loadPlan(); });
  $effect(() => { if ($syncStatus === 'synced' && uid && planLoaded) loadPlan(); });

  async function setDayRecipe(dayIdx: number, recipeId: string) {
    const next = { ...plan, [dayIdx]: recipeId ? parseInt(recipeId) : null };
    plan = next;
    try {
      await upsertRecord('meal_plans', {
        user_id: uid, week_start: weekStart, plan: next,
        created_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Meal plan save failed:', e); }
  }

  // — Nutrition / food log — real macro tracking (protein/carbs/fat), not
  // just the single kcal number on the Today page. Protein target uses
  // the common recomp guideline of ~2g per kg of current bodyweight.
  const _foodLogs = liveFoodLogs();
  const _weights = liveWeights();
  const today = new Date().toISOString().slice(0, 10);

  const currentWeightKg = $derived.by(() => {
    const rows = $_weights;
    return rows.length > 0 ? rows[rows.length - 1].weight : START_KG;
  });
  const proteinTargetG = $derived(Math.round(currentWeightKg * 2));

  const todayFoods = $derived(
    $_foodLogs
      .filter((f: any) => f.date === today)
      .sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''))
  );

  const todayTotals = $derived(
    todayFoods.reduce(
      (t: any, f: any) => ({
        kcal: t.kcal + (f.kcal || 0),
        protein: t.protein + (f.protein_g || 0),
        carbs: t.carbs + (f.carbs_g || 0),
        fat: t.fat + (f.fat_g || 0),
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 }
    )
  );

  let foodName = $state('');
  let foodKcal = $state('');
  let foodProtein = $state('');
  let foodCarbs = $state('');
  let foodFat = $state('');
  let addingFood = $state(false);
  let foodMsg = $state('');

  async function addFood() {
    if (!uid) { foodMsg = 'Not signed in — please sign back in.'; return; }
    if (!foodName.trim()) { foodMsg = 'Enter a food name first.'; return; }
    addingFood = true;
    foodMsg = '';
    try {
      const id = crypto.randomUUID();
      await upsertRecord('food_logs', {
        id, user_id: uid, date: today, name: foodName.trim(),
        kcal: parseFloat(foodKcal) || 0,
        protein_g: parseFloat(foodProtein) || 0,
        carbs_g: parseFloat(foodCarbs) || 0,
        fat_g: parseFloat(foodFat) || 0,
        created_at: new Date().toISOString(),
      });
      foodName = ''; foodKcal = ''; foodProtein = ''; foodCarbs = ''; foodFat = '';
    } catch (e: any) {
      foodMsg = 'Save failed: ' + (e?.message || String(e)).slice(0, 150);
    } finally {
      addingFood = false;
    }
  }

  async function removeFood(id: string) {
    await db.table('food_logs').delete(id);
    syncStatus.set('syncing');
    const { error } = await (await import('$lib/db/client')).supabase
      .from('food_logs').delete().eq('id', id).eq('user_id', uid);
    if (error) console.error('Food delete failed:', error);
    syncStatus.set('synced');
  }
</script>

<div class="page-hd">Nutrition</div>
<div class="page-sub">Real food + macro tracking &middot; not just calories</div>

<div class="card">
  <div class="card-lbl">Today's Totals</div>
  <div class="macro-grid">
    <div class="macro-box"><div class="mv">{Math.round(todayTotals.kcal)}</div><div class="ml">kcal</div></div>
    <div class="macro-box"><div class="mv" class:over={todayTotals.protein >= proteinTargetG}>{Math.round(todayTotals.protein)}g</div><div class="ml">protein</div></div>
    <div class="macro-box"><div class="mv">{Math.round(todayTotals.carbs)}g</div><div class="ml">carbs</div></div>
    <div class="macro-box"><div class="mv">{Math.round(todayTotals.fat)}g</div><div class="ml">fat</div></div>
  </div>
  <div class="protein-bar-track">
    <div class="protein-bar-fill" style="width:{Math.min(100, (todayTotals.protein / proteinTargetG) * 100)}%"></div>
  </div>
  <div class="protein-bar-label">{Math.round(todayTotals.protein)}g / {proteinTargetG}g protein target (~2g/kg bodyweight)</div>

  <div class="food-form">
    <input placeholder="Food name (e.g. Chicken breast 200g)" bind:value={foodName} style="margin-bottom:6px">
    <div class="food-form-row">
      <input type="number" inputmode="decimal" placeholder="kcal" bind:value={foodKcal}>
      <input type="number" inputmode="decimal" placeholder="protein g" bind:value={foodProtein}>
      <input type="number" inputmode="decimal" placeholder="carbs g" bind:value={foodCarbs}>
      <input type="number" inputmode="decimal" placeholder="fat g" bind:value={foodFat}>
    </div>
    <button class="btn bp bfl" style="margin-top:8px" onclick={addFood} disabled={addingFood}>{addingFood ? 'Adding…' : 'Add Food'}</button>
    {#if foodMsg}
      <div style="font-size:12px;text-align:center;margin-top:6px;color:{foodMsg.startsWith('Save failed') ? 'var(--red)' : 'var(--green)'}">{foodMsg}</div>
    {/if}
  </div>

  {#if todayFoods.length > 0}
    <div class="food-list">
      {#each todayFoods as f}
        <div class="food-item">
          <div class="fi-main">
            <div class="fi-name">{f.name}</div>
            <div class="fi-macros">{Math.round(f.kcal)} kcal &middot; P{Math.round(f.protein_g)} C{Math.round(f.carbs_g)} F{Math.round(f.fat_g)}</div>
          </div>
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <span class="fi-rm" onclick={() => removeFood(f.id)} role="button">✕</span>
        </div>
      {/each}
    </div>
  {:else}
    <div style="font-size:12px;color:var(--muted);text-align:center;padding:10px 0">No food logged today yet.</div>
  {/if}
</div>

<div class="page-hd">Batch Cook</div>
<div class="page-sub">{recipes.length} chicken curry recipes &middot; Cook Sunday, eat all week</div>

<div class="card">
  <div class="card-lbl">This Week's Plan</div>
  {#each DAYS_FULL as dayName, i}
    <div class="flex jb ac gap2" style="padding:5px 0">
      <div style="font-size:13px;width:80px;flex-shrink:0">{dayName}</div>
      <select style="flex:1" value={plan[i] ?? ''} onchange={(e) => setDayRecipe(i, (e.target as HTMLSelectElement).value)}>
        <option value="">— none —</option>
        {#each recipes as r}
          <option value={r.id}>{r.e} {r.name}</option>
        {/each}
      </select>
    </div>
  {/each}
</div>

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
<div class="moverlay" class:open={selected !== null} onclick={() => selected = null}>
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
