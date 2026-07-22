<script lang="ts">
  import { recipes } from '$lib/data/recipes';
  import { userId } from '$lib/stores/user';
  import { upsertRecord, syncStatus } from '$lib/stores/sync';
  import { liveFoodLogs, liveWeights, liveGoalReason, liveGoal } from '$lib/stores/live';
  import { START_KG, GOAL_KG as DEFAULT_GOAL_KG } from '$lib/config';
  import Modal from '$lib/components/Modal.svelte';
  import MiniChart from '$lib/components/MiniChart.svelte';
  import { swipeActions } from '$lib/actions/swipe';
  import BarcodeScanner from '$lib/components/BarcodeScanner.svelte';
  import FoodPhotoAnalyzer from '$lib/components/FoodPhotoAnalyzer.svelte';
  import db from '$lib/db/dexie';

  let selected = $state<typeof recipes[number] | null>(null);
  let method: 'stovetop' | 'instantPot' = $state('stovetop');

  const catOrder = ['protein', 'veg', 'dairy', 'dry'] as const;
  const catLabel: Record<string, string> = { protein: 'Protein', veg: 'Vegetables', dairy: 'Dairy', dry: 'Pantry' };

  const today = new Date();

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  // — Nutrition / food log — real macro tracking (protein/carbs/fat), not
  // just the single kcal number on the Today page. Protein target is the
  // evidence-based ~1.8 g per kg of GOAL bodyweight (not total bodyweight):
  // for someone carrying significant fat mass, scaling to total weight
  // overestimates need. 1.8 g/kg of goal weight converges with both the
  // g/kg-lean-mass approach (Helms 2014) and clinical adjusted-body-weight,
  // and sits mid-range of the 1.6–2.4 g/kg deficit guideline (Morton 2018
  // saturation ~1.6; ISSN 2017) — enough to protect muscle, without the
  // protein-industry-inflated 2.2–3.1 numbers that apply to lean athletes.
  const _foodLogs = liveFoodLogs();
  const _weights = liveWeights();
  const _goal = liveGoal();
  const todayStr = today.toISOString().slice(0, 10);

  const currentWeightKg = $derived.by(() => {
    const rows = $_weights;
    return rows.length > 0 ? rows[rows.length - 1].weight : START_KG;
  });
  const goalKg = $derived($_goal ?? DEFAULT_GOAL_KG);
  const proteinTargetG = $derived(Math.round(goalKg * 1.8));

  const todayFoods = $derived(
    $_foodLogs
      .filter((f: any) => f.date === todayStr)
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

  // — Plan target banner — surface WHY the plan is what it is, right where
  // food is logged. goal_reason (set on the Plan flow) already embeds the
  // TDEE, deficit and calorie target narrative; the protein target is the
  // ~2g/kg recomp guideline. Shown together so the daily log is always
  // read against the plan, not in isolation.
  const _goalReason = liveGoalReason();

  // — Food history — past days grouped, newest first, each with its daily
  // totals. All dates already live in liveFoodLogs (IndexedDB); the page
  // previously only ever rendered today, so this is purely a display gap.
  const historyByDay = $derived.by(() => {
    const byDate = new Map<string, any[]>();
    for (const f of $_foodLogs) {
      if (f.date === todayStr) continue; // today shown separately above
      if (!byDate.has(f.date)) byDate.set(f.date, []);
      byDate.get(f.date)!.push(f);
    }
    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, foods]) => ({
        date,
        foods: foods.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')),
        totals: foods.reduce(
          (t, f) => ({
            kcal: t.kcal + (f.kcal || 0),
            protein: t.protein + (f.protein_g || 0),
            carbs: t.carbs + (f.carbs_g || 0),
            fat: t.fat + (f.fat_g || 0),
          }),
          { kcal: 0, protein: 0, carbs: 0, fat: 0 }
        ),
      }));
  });

  // — Calorie/protein trend over time — daily kcal totals across ALL logged
  // days (incl. today), oldest→newest, for the MiniChart. What's the point
  // of tracking without seeing the trend.
  const kcalTrend = $derived.by(() => {
    const byDate = new Map<string, number>();
    for (const f of $_foodLogs) byDate.set(f.date, (byDate.get(f.date) || 0) + (f.kcal || 0));
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, kcal]) => ({ date, value: Math.round(kcal) }));
  });
  const proteinTrend = $derived.by(() => {
    const byDate = new Map<string, number>();
    for (const f of $_foodLogs) byDate.set(f.date, (byDate.get(f.date) || 0) + (f.protein_g || 0));
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, p]) => ({ date, value: Math.round(p) }));
  });
  let trendMetric = $state<'kcal' | 'protein'>('kcal');

  // — Frequent foods — the meals you log again and again. Grouped by
  // name, most-logged first, so a single tap re-logs the exact same
  // entry with zero typing. Uses each name's most recent macros
  // (portions can drift over time).
  const frequentFoods = $derived.by(() => {
    const byName = new Map<string, { count: number; last: any; lastAt: string }>();
    for (const f of $_foodLogs) {
      const key = f.name?.trim();
      if (!key) continue;
      const cur = byName.get(key);
      const at = f.created_at || '';
      if (!cur) byName.set(key, { count: 1, last: f, lastAt: at });
      else {
        cur.count++;
        if (at >= cur.lastAt) { cur.last = f; cur.lastAt = at; }
      }
    }
    return [...byName.values()]
      .filter((v) => v.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  });

  let showHistory = $state(false);

  let foodName = $state('');
  let foodKcal = $state('');
  let foodProtein = $state('');
  let foodCarbs = $state('');
  let foodFat = $state('');
  let addingFood = $state(false);
  let foodMsg = $state('');
  let foodSwipeOffsets = $state<Record<string, number>>({});
  let repeatingId = $state<string | null>(null);

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

  // Photo analysis (Gemini Vision) estimates the ACTUAL portion size
  // shown in the photo, unlike the barcode scanner's fixed per-100g
  // figures -- still just an AI estimate, so prefilled for review/
  // adjustment rather than auto-submitted.
  function applyPhotoFood(food: { name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; confidence: string }) {
    foodName = `${food.name} (AI estimate, ${food.confidence} confidence)`;
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
      const name = foodName.trim();
      const kcal = parseFloat(foodKcal) || 0;
      const protein_g = parseFloat(foodProtein) || 0;
      const carbs_g = parseFloat(foodCarbs) || 0;
      const fat_g = parseFloat(foodFat) || 0;
      await upsertRecord('food_logs', {
        id: crypto.randomUUID(), user_id: uid, date: todayStr, name,
        kcal, protein_g, carbs_g, fat_g,
        created_at: new Date().toISOString(),
      });
      foodName = ''; foodKcal = ''; foodProtein = ''; foodCarbs = ''; foodFat = '';
    } catch (e: any) {
      foodMsg = 'Save failed: ' + (e?.message || String(e)).slice(0, 150);
    } finally {
      addingFood = false;
    }
  }

  // Instantly re-logs an already-saved food entry as a new entry for
  // today -- the one-tap "redo" for meals you eat again (esp. when you
  // cook once and eat the same thing across several days) without
  // retyping macros.
  async function repeatFood(f: any) {
    if (!uid) return;
    repeatingId = f.id;
    try {
      await upsertRecord('food_logs', {
        id: crypto.randomUUID(), user_id: uid, date: todayStr, name: f.name,
        kcal: f.kcal || 0, protein_g: f.protein_g || 0, carbs_g: f.carbs_g || 0, fat_g: f.fat_g || 0,
        created_at: new Date().toISOString(),
      });
    } catch (e: any) {
      foodMsg = 'Repeat failed: ' + (e?.message || String(e)).slice(0, 150);
    } finally {
      repeatingId = null;
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

{#if $_goalReason}
  <div class="note-box">🎯 <strong>Your plan:</strong> {$_goalReason}</div>
{:else}
  <div class="note-box warn">🎯 No calorie/protein plan set yet — open <strong>Today → Body &amp; Goals</strong> to calculate your target from body composition, so this log can be read against a real plan.</div>
{/if}

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
    <div class="flex gap2" style="margin-bottom:4px">
      <BarcodeScanner onResult={applyScannedFood} />
      <FoodPhotoAnalyzer onResult={applyPhotoFood} />
    </div>
    <div class="scan-note">Barcode scans give per-100g values; photo analysis estimates your actual portion. Both are starting points — adjust before adding.</div>
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
            <button type="button" class="fi-repeat" onclick={() => repeatFood(f)} disabled={repeatingId === f.id} title="Log this again">
              {repeatingId === f.id ? '…' : '⟳'}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div style="font-size:12px;color:var(--muted);text-align:center;padding:10px 0">No food logged today yet.</div>
  {/if}
</div>

{#if frequentFoods.length > 0}
  <div class="card">
    <div class="card-lbl">🔁 Frequent Foods — one-tap re-log</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">The meals you log most — tap to re-log today, no retyping.</div>
    {#each frequentFoods as ff}
      <div class="freq-row">
        <div class="freq-main">
          <div class="fi-name">{ff.last.name}</div>
          <div class="fi-macros">{Math.round(ff.last.kcal)} kcal &middot; P{Math.round(ff.last.protein_g)} C{Math.round(ff.last.carbs_g)} F{Math.round(ff.last.fat_g)} &middot; logged {ff.count}×</div>
        </div>
        <button type="button" class="fi-repeat" onclick={() => repeatFood(ff.last)} disabled={repeatingId === ff.last.id} title="Log this again">
          {repeatingId === ff.last.id ? '…' : '⟳'}
        </button>
      </div>
    {/each}
  </div>
{/if}

{#if kcalTrend.length >= 2}
  <div class="card">
    <div class="flex jb ac">
      <div class="card-lbl" style="margin-bottom:0">📈 Intake Trend</div>
      <div class="flex gap2">
        <button class="tab {trendMetric === 'kcal' ? 'on' : ''}" style="padding:3px 10px;font-size:11px" onclick={() => trendMetric = 'kcal'}>kcal</button>
        <button class="tab {trendMetric === 'protein' ? 'on' : ''}" style="padding:3px 10px;font-size:11px" onclick={() => trendMetric = 'protein'}>protein</button>
      </div>
    </div>
    <div style="margin-top:10px">
      {#if trendMetric === 'kcal'}
        <MiniChart data={kcalTrend} color="var(--amber)" unit=" kcal" />
      {:else}
        <MiniChart data={proteinTrend} color="var(--green, #2ecc71)" unit="g" />
      {/if}
    </div>
    <div style="font-size:11px;color:var(--muted);text-align:center">Daily {trendMetric === 'kcal' ? 'calories' : 'protein (g)'} over {kcalTrend.length} logged days</div>
  </div>
{/if}

{#if historyByDay.length > 0}
  <div class="card">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="flex jb ac" style="cursor:pointer" onclick={() => showHistory = !showHistory} role="button">
      <div class="card-lbl" style="margin-bottom:0">🗓️ Food History ({historyByDay.length} days)</div>
      <span style="color:var(--muted);font-size:13px">{showHistory ? '▲' : '▼'}</span>
    </div>
    {#if showHistory}
      <div style="margin-top:10px">
        {#each historyByDay as day}
          <div class="hist-day">
            <div class="flex jb ac">
              <div style="font-size:13px;font-weight:700;color:#fff">{new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
              <div style="font-size:11px;color:var(--amber);font-weight:600">{Math.round(day.totals.kcal)} kcal &middot; P{Math.round(day.totals.protein)}</div>
            </div>
            {#each day.foods as f}
              <div class="hist-item">
                <span class="hist-name">{f.name}</span>
                <div class="flex ac gap2">
                  <span class="hist-macros">{Math.round(f.kcal)}kcal</span>
                  <button type="button" class="fi-repeat fi-repeat-sm" onclick={() => repeatFood(f)} disabled={repeatingId === f.id} title="Re-log today">
                    {repeatingId === f.id ? '…' : '⟳'}
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<div class="page-hd">Recipes</div>
<div class="page-sub">{recipes.length} recipes &middot; a rotating variety to keep the week fresh</div>

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
      <span class="badge ba">{r.p}g protein</span>
      {#if r.kid}<span class="badge bk">👶 Kid-friendly</span>{/if}
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
