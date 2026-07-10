<script lang="ts">
  import { recipes } from '$lib/data/recipes';
  import { userId } from '$lib/stores/user';
  import { upsertRecord, syncStatus } from '$lib/stores/sync';
  import { liveFoodLogs, liveWeights, liveMealPlan } from '$lib/stores/live';
  import { START_KG } from '$lib/config';
  import Modal from '$lib/components/Modal.svelte';
  import { swipeActions } from '$lib/actions/swipe';
  import BarcodeScanner from '$lib/components/BarcodeScanner.svelte';
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

  // Rolling 7-day window starting TODAY (not calendar Monday) -- matches
  // the same fix applied to the Gym page's week view. Meal plans are
  // still stored per calendar week (week_start = that week's Monday,
  // plan keyed by day-of-week 0-6) since that's a sensible storage unit,
  // but a rolling display window starting today can span two calendar
  // weeks (e.g. today Thursday -> window runs Thu..Wed, crossing into
  // next week's Monday), so we load both weeks' plans and merge them.
  const today = new Date();
  const rollingDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
  const thisWeekStart = mondayOf(today);
  const nextWeekStart = mondayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  // Reads live from IndexedDB (see live.ts) instead of a one-shot
  // db.table().get() re-triggered from a $syncStatus effect -- that old
  // pattern had a real race: syncStatus can flip to 'synced' from an
  // earlier, faster table's sync well before meal_plans' own fetch has
  // landed, so the reload effect would never re-fire and this page would
  // silently show empty/stale data (this is very likely why "data isn't
  // syncing across devices" was reported -- meal_plans specifically was
  // also missing from the realtime publication, compounding it further).
  const _planThisWeek = liveMealPlan(thisWeekStart);
  const _planNextWeek = liveMealPlan(nextWeekStart);

  async function setDayRecipe(date: Date, recipeId: string) {
    const weekStart = mondayOf(date);
    const dayIdx = date.getDay();
    const currentPlan = weekStart === thisWeekStart ? $_planThisWeek : $_planNextWeek;
    const next = { ...currentPlan, [dayIdx]: recipeId ? parseInt(recipeId) : null };
    try {
      await upsertRecord('meal_plans', {
        user_id: uid, week_start: weekStart, plan: next,
        created_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Meal plan save failed:', e); }
  }

  function planFor(date: Date): number | null {
    const weekStart = mondayOf(date);
    const p = weekStart === thisWeekStart ? $_planThisWeek : $_planNextWeek;
    return p?.[date.getDay()] ?? null;
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
  let foodSwipeOffsets = $state<Record<string, number>>({});

  // Barcode scanner fills these fields with per-100g values from Open
  // Food Facts -- the user still needs to adjust for their actual
  // portion size before saving, so we prefill rather than auto-submit.
  function applyScannedFood(food: { name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }) {
    foodName = food.name + ' (per 100g — adjust portion)';
    foodKcal = String(Math.round(food.kcal));
    foodProtein = String(Math.round(food.protein_g));
    foodCarbs = String(Math.round(food.carbs_g));
    foodFat = String(Math.round(food.fat_g));
  }

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
    <BarcodeScanner onResult={applyScannedFood} />
    <div class="scan-note">Scans fill per-100g values — adjust the numbers for your actual portion before adding.</div>
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
        <div class="swipe-row">
          <div class="swipe-actions">
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div class="swipe-delete" onclick={() => removeFood(f.id)} role="button">Delete</div>
          </div>
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div class="food-item swipe-content"
            style="transform:translateX({foodSwipeOffsets[f.id] ?? 0}px)"
            use:swipeActions={{
              onOffset: (px) => foodSwipeOffsets = { ...foodSwipeOffsets, [f.id]: px },
              onSettle: () => {}
            }}
          >
            <div class="fi-main">
              <div class="fi-name">{f.name}</div>
              <div class="fi-macros">{Math.round(f.kcal)} kcal &middot; P{Math.round(f.protein_g)} C{Math.round(f.carbs_g)} F{Math.round(f.fat_g)}</div>
            </div>
          </div>
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
  <div class="card-lbl">Next 7 Days</div>
  {#each rollingDays as date, i}
    <div class="flex jb ac gap2" style="padding:5px 0">
      <div style="font-size:13px;width:80px;flex-shrink:0">
        {i === 0 ? 'Today' : DAYS_FULL[date.getDay()]}
        <div style="font-size:10px;color:var(--muted)">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
      </div>
      <select style="flex:1" value={planFor(date) ?? ''} onchange={(e) => setDayRecipe(date, (e.target as HTMLSelectElement).value)}>
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

<Modal open={selected !== null} onclose={() => selected = null}>
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
</Modal>
