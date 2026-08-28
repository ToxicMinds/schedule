<script lang="ts">
  import { userId } from '$lib/stores/user';
  import { upsertRecord, syncStatus } from '$lib/stores/sync';
  import { liveFoodLogs, liveWeights, liveGoalReason, liveGoal, liveCustomRecipes } from '$lib/stores/live';
  import { parseCalorieTarget, goalSummary, goalDirection } from '$lib/coach';
  import { liveProfile } from '$lib/stores/live';
  import { proteinTargetG as calcProteinTarget } from '$lib/profile';
  import Modal from '$lib/components/Modal.svelte';
  import MiniChart from '$lib/components/MiniChart.svelte';
  import { swipeActions } from '$lib/actions/swipe';
  import BarcodeScanner from '$lib/components/BarcodeScanner.svelte';
  import FoodPhotoAnalyzer from '$lib/components/FoodPhotoAnalyzer.svelte';
  import NutritionInsights from '$lib/components/NutritionInsights.svelte';
  import FoodSearch from '$lib/components/FoodSearch.svelte';
  import { evaluateFood } from '$lib/foodCoach';
  import { speak } from '$lib/stores/toast';
  import { haptic } from '$lib/haptics';
  import db from '$lib/db/dexie';
  import { todayYmd, shiftYmd } from '$lib/date';
  import { frequentFoods, repeatDay, groupIntoMeals } from '$lib/quickAdd';
  import { nowTick } from '$lib/stores/refresh';
  import PageHero from '$lib/components/PageHero.svelte';

  // The modal renders both built-in and generated recipes, so it works on a
  // normalised shape rather than the static Recipe type specifically.
  type ViewRecipe = {
    id: string | number; name: string; e: string; t: number;
    k: number; p: number; c: number; f: number;
    desc: string; ing: Array<{ n: string; a: string; cat: string }>;
    prep: string[]; steps: string[]; instantPot: string[];
    kid?: boolean; custom?: boolean; coachNote?: string; batch?: number;
  };
  let selected = $state<ViewRecipe | null>(null);
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
  const todayStr = todayYmd();

  const _profile = liveProfile();
  const currentWeightKg = $derived.by(() => {
    const rows = $_weights;
    return rows.length > 0 ? rows[rows.length - 1].weight : ($_profile?.start_kg ?? null);
  });
  const goalKg = $derived($_goal ?? null);
  // Falls back to current weight when no goal is set, so the target is never 0
  // (which used to make the progress bar divide by zero and render NaN).
  const proteinTargetG = $derived(Math.max(1, calcProteinTarget(goalKg, currentWeightKg)));

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

  // Frequent foods used to be computed here AND rendered in a card near the
  // bottom of the page, below the log form and today's list — so the cheapest
  // action in the app sat furthest from the thumb. It now comes from the shared,
  // tested frequentFoods() and renders in the Quick add card at the very top,
  // next to the two things that didn't exist at all: repeat-yesterday and meals.

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

  // Every food name you've ever logged, deduped and ranked by how often you
  // use it — the library FoodSearch matches against instantly. Picking one is
  // your own exact entry, so it fills as-is (no "per 100g" caveat).
  const myFoodLibrary = $derived.by(() => {
    const byName = new Map<string, { count: number; last: any; lastAt: string }>();
    for (const f of $_foodLogs) {
      const key = f.name?.trim();
      if (!key) continue;
      const cur = byName.get(key);
      const at = f.created_at || '';
      if (!cur) byName.set(key, { count: 1, last: f, lastAt: at });
      else { cur.count++; if (at >= cur.lastAt) { cur.last = f; cur.lastAt = at; } }
    }
    return [...byName.values()]
      .sort((a, b) => b.count - a.count)
      .map((v) => ({
        name: v.last.name,
        kcal: v.last.kcal ?? 0,
        protein_g: v.last.protein_g ?? 0,
        carbs_g: v.last.carbs_g ?? 0,
        fat_g: v.last.fat_g ?? 0,
        count: v.count,
      }));
  });

  // FoodSearch pick: an online (per-100g) hit routes through the scan handler
  // so it inherits the "adjust portion" prompt; your own logged food fills the
  // exact values you saved before.
  function applySearchFood(food: { name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }, per100g: boolean) {
    if (per100g) { applyScannedFood(food); return; }
    foodName = food.name;
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

  // ── QUICK ADD ─────────────────────────────────────────────────────────────
  // All three shortcuts are derived from the user's own food_logs (quickAdd.ts):
  // the staples they log constantly, yesterday's day, and yesterday's meals.
  const quickFoods = $derived(frequentFoods($_foodLogs as any[], 6));
  const yesterdayStr = $derived(shiftYmd(-1, new Date($nowTick)));
  const yesterdayLeft = $derived(repeatDay($_foodLogs as any[], yesterdayStr, todayStr));
  const yesterdayMeals = $derived(groupIntoMeals($_foodLogs as any[], yesterdayStr));

  let quickBusy = $state('');
  let quickMsg = $state('');

  /** Log a whole set of foods in one tap. Writes sequentially so a mid-way
   *  failure leaves the earlier rows saved rather than rolling the lot back —
   *  a partially logged meal is recoverable, a silently dropped one is not. */
  async function quickAddFoods(foods: Array<{ name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }>, what: string) {
    if (!uid) { quickMsg = 'Not signed in.'; return; }
    if (quickBusy || foods.length === 0) return;
    haptic('tap');
    quickBusy = what;
    quickMsg = '';
    const before = { kcal: todayTotals.kcal, protein: todayTotals.protein };
    let added = 0;
    try {
      for (const f of foods) {
        await upsertRecord('food_logs', {
          id: crypto.randomUUID(), user_id: uid, date: todayStr, name: f.name,
          kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g,
          created_at: new Date().toISOString(),
        });
        added++;
      }
      announceFood(before, {
        kcal: before.kcal + foods.reduce((s, f) => s + f.kcal, 0),
        protein: before.protein + foods.reduce((s, f) => s + f.protein_g, 0),
      });
      quickMsg = added === 1 ? 'Added' : `Added ${added}`;
    } catch (e: any) {
      quickMsg = added > 0 ? `Added ${added}, then failed` : 'Failed — try again';
      console.error('Quick add failed:', e);
    } finally {
      quickBusy = '';
      setTimeout(() => { quickMsg = ''; }, 2500);
    }
  }

  async function addFood() {
    if (!uid) { foodMsg = 'Not signed in — please sign back in.'; return; }
    if (!foodName.trim()) { foodMsg = 'Enter a food name first.'; return; }
    haptic('tap');
    addingFood = true;
    foodMsg = '';
    try {
      const name = foodName.trim();
      const kcal = parseFloat(foodKcal) || 0;
      const protein_g = parseFloat(foodProtein) || 0;
      const carbs_g = parseFloat(foodCarbs) || 0;
      const fat_g = parseFloat(foodFat) || 0;
      const before = { kcal: todayTotals.kcal, protein: todayTotals.protein };
      await upsertRecord('food_logs', {
        id: crypto.randomUUID(), user_id: uid, date: todayStr, name,
        kcal, protein_g, carbs_g, fat_g,
        created_at: new Date().toISOString(),
      });
      announceFood(before, { kcal, protein: protein_g });
      foodName = ''; foodKcal = ''; foodProtein = ''; foodCarbs = ''; foodFat = '';
    } catch (e: any) {
      foodMsg = 'Save failed: ' + (e?.message || String(e)).slice(0, 150);
    } finally {
      addingFood = false;
    }
  }

  // Speak the moment an entry tips a threshold: protein target just hit, or the
  // calorie budget just crossed into the red (only nagged when cutting). The
  // per-day keys mean each milestone is celebrated once, not on every bite.
  function announceFood(
    before: { kcal: number; protein: number },
    added: { kcal: number; protein: number }
  ) {
    const afterProtein = before.protein + added.protein;
    const afterKcal = before.kcal + added.kcal;
    const dir = goalDirection(currentWeightKg, goalKg ?? 0);

    if (proteinTargetG > 0 && before.protein < proteinTargetG && afterProtein >= proteinTargetG) {
      speak(`protein-hit-${todayStr}`, 'Protein target hit 💪', {
        tone: 'good', icon: '💪',
        body: 'That’s the muscle-protecting lever locked in for today. Nicely done.',
      });
    }

    if (todayCalTarget && dir !== 'gain' && before.kcal <= todayCalTarget && afterKcal > todayCalTarget) {
      const over = Math.round(afterKcal - todayCalTarget);
      speak(`over-budget-${todayStr}`, `${over} kcal over budget`, {
        tone: 'bad', icon: '⚠️', ttl: 8000,
        body: afterProtein >= proteinTargetG - 5
          ? 'Protein’s in, so call it here — a daily overshoot is exactly what stalls the scale.'
          : 'You’re over for the day. If you eat more, make it pure lean protein — nothing else.',
      });
    }
  }

  // Instantly re-logs an already-saved food entry as a new entry for
  // today -- the one-tap "redo" for meals you eat again (esp. when you
  // cook once and eat the same thing across several days) without
  // retyping macros.
  async function repeatFood(f: any) {
    if (!uid) return;
    haptic('tap');
    repeatingId = f.id;
    try {
      const before = { kcal: todayTotals.kcal, protein: todayTotals.protein };
      await upsertRecord('food_logs', {
        id: crypto.randomUUID(), user_id: uid, date: todayStr, name: f.name,
        kcal: f.kcal || 0, protein_g: f.protein_g || 0, carbs_g: f.carbs_g || 0, fat_g: f.fat_g || 0,
        created_at: new Date().toISOString(),
      });
      announceFood(before, { kcal: f.kcal || 0, protein: f.protein_g || 0 });
    } catch (e: any) {
      foodMsg = 'Repeat failed: ' + (e?.message || String(e)).slice(0, 150);
    } finally {
      repeatingId = null;
    }
  }

  // — Recipe generation —
  // The hardcoded 19 recipes were never a technical limit: the app is online by
  // definition. This asks for a recipe built around what you actually want AND
  // the macro gap you actually have left today, then keeps it.
  const _customRecipes = liveCustomRecipes();
  let recipeAsk = $state('');
  let generating = $state(false);
  let genMsg = $state('');
  let showGenerator = $state(false);

  const IDEAS = [
    'high-protein, 20 minutes, one pan',
    'chicken + whatever veg, Indian, batch of 4',
    'vegetarian, 500 kcal, filling',
    'no cooking — assemble only',
    'kid-friendly, freezes well',
    'paneer, Instant Pot, low oil'
  ];

  const todayCalTarget = $derived(parseCalorieTarget($_goalReason));

  // — Live food coach — the running totals turned into one honest, actionable
  // line that refreshes the instant a new entry lands (it reads todayTotals,
  // which is reactive). It answers "what's spare, what do I eat next, and is
  // today why the scale isn't moving" instead of just showing the numbers.
  const avgKcal7d = $derived.by(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6); // today + 6 prior = 7-day window
    const cutYmd = cutoff.toISOString().slice(0, 10);
    const byDate = new Map<string, number>();
    for (const f of $_foodLogs) {
      if (f.date < cutYmd) continue;
      byDate.set(f.date, (byDate.get(f.date) || 0) + (f.kcal || 0));
    }
    if (byDate.size < 3) return null; // too little data to claim a trend
    let sum = 0;
    for (const v of byDate.values()) sum += v;
    return sum / byDate.size;
  });

  const foodEval = $derived(
    evaluateFood({
      calorieTarget: todayCalTarget,
      kcalSoFar: todayTotals.kcal,
      proteinTarget: proteinTargetG,
      proteinSoFar: todayTotals.protein,
      carbsSoFar: todayTotals.carbs,
      fatSoFar: todayTotals.fat,
      mealsLogged: todayFoods.length,
      hour: new Date().getHours(),
      direction: goalDirection(currentWeightKg, goalKg ?? 0),
      avgKcal7d,
    })
  );

  // Normalise a saved row (Postgres column names) into the render shape.
  function toView(r: any): ViewRecipe {
    return {
      id: r.id, name: r.name, e: r.e, t: r.t,
      k: r.k, p: r.p, c: r.c, f: r.f, batch: r.batch,
      desc: r.descr ?? '', ing: r.ing ?? [],
      prep: r.prep ?? [], steps: r.steps ?? [], instantPot: r.instant_pot ?? [],
      kid: r.kid, custom: true, coachNote: r.coach_note ?? ''
    };
  }

  const customRecipes = $derived(
    [...$_customRecipes]
      .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
      .map(toView)
  );

  async function generateRecipe() {
    const ask = recipeAsk.trim();
    if (!ask) { genMsg = 'Say what you feel like eating.'; return; }
    if (!uid) { genMsg = 'Not signed in — please sign back in.'; return; }
    generating = true;
    genMsg = '';
    try {
      const { supabase } = await import('$lib/db/client');
      const { data, error } = await supabase.functions.invoke('generate-recipe', {
        body: {
          request: ask,
          proteinTarget: proteinTargetG,
          kcalTarget: todayCalTarget,
          proteinSoFar: Math.round(todayTotals.protein),
          kcalSoFar: Math.round(todayTotals.kcal),
          // Don't serve the same dinner twice in a week.
          avoid: customRecipes.slice(0, 6).map((r) => r.name)
        }
      });
      if (error) throw error;
      if (data?.error) { genMsg = data.error; return; }

      await upsertRecord('recipes_custom', {
        id: crypto.randomUUID(), user_id: uid,
        name: data.name, e: data.e, t: data.t,
        k: data.k, p: data.p, c: data.c, f: data.f, batch: data.batch,
        descr: data.desc ?? '', ing: data.ing ?? [],
        prep: data.prep ?? [], steps: data.steps ?? [], instant_pot: data.instantPot ?? [],
        kid: !!data.kid, coach_note: data.coachNote ?? '', request: ask,
        created_at: new Date().toISOString()
      });
      recipeAsk = '';
      genMsg = '';
      // Open it straight away — you asked for a recipe, you want to read it.
      selected = { ...data, id: 'new', desc: data.desc, custom: true };
    } catch (e: any) {
      genMsg = 'Could not generate: ' + (e?.message || String(e)).slice(0, 180);
    } finally {
      generating = false;
    }
  }

  async function deleteCustomRecipe(id: string) {
    try {
      await db.table('recipes_custom').delete(id);
      const { supabase } = await import('$lib/db/client');
      const { error } = await supabase.from('recipes_custom').delete().eq('id', id).eq('user_id', uid);
      if (error) console.error('Recipe delete failed:', error);
    } catch (e) { console.error('Recipe delete failed:', e); }
  }

  // Log a cooked portion straight into today's food log — the point of a recipe
  // in a tracking app is that eating it costs one tap, not a retype of macros.
  let loggingRecipe = $state(false);
  async function logRecipePortion(r: ViewRecipe) {
    if (!uid) return;
    haptic('tap');
    loggingRecipe = true;
    try {
      const before = { kcal: todayTotals.kcal, protein: todayTotals.protein };
      await upsertRecord('food_logs', {
        id: crypto.randomUUID(), user_id: uid, date: todayStr,
        name: `${r.name} (1 portion)`,
        kcal: r.k, protein_g: r.p, carbs_g: r.c, fat_g: r.f,
        created_at: new Date().toISOString()
      });
      announceFood(before, { kcal: r.k, protein: r.p });
      selected = null;
    } catch (e: any) {
      genMsg = 'Log failed: ' + (e?.message || String(e)).slice(0, 150);
    } finally {
      loggingRecipe = false;
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

  // ── FUEL hero ── protein is the lever that decides whether a deficit costs
  // fat or muscle, so it leads. The orb fills with today's protein vs target.
  const proteinPct = $derived(proteinTargetG ? Math.round((todayTotals.protein / proteinTargetG) * 100) : 0);
  const fuelPct = $derived(Math.min(100, proteinPct));
  const fuelTone: 'good' | 'ok' | 'warn' | 'bad' | 'na' = $derived(
    !proteinTargetG ? 'na'
    : proteinPct >= 100 ? 'good'
    : proteinPct >= 65 ? 'ok'
    : proteinPct >= 35 ? 'warn'
    : 'bad'
  );
  const fuelStory = $derived.by(() => {
    if (!proteinTargetG) return 'Set a goal to see targets';
    const left = Math.max(0, Math.round(proteinTargetG - todayTotals.protein));
    if (proteinPct >= 100) return 'Protein target hit 💪';
    if (todayFoods.length === 0) return 'Log a protein-forward meal';
    return `${left}g protein to go`;
  });
</script>

<PageHero title="Fuel" sub="Protein-first fuel"
  tone={fuelTone} pct={fuelPct}
  orbValue={`${Math.round(todayTotals.protein)}g`}
  orbLabel={proteinTargetG ? `of ${proteinTargetG}g protein` : 'protein today'}
  story={fuelStory}
  stats={[
    { v: Math.round(todayTotals.kcal), l: todayCalTarget ? `of ${todayCalTarget} kcal` : 'kcal today' },
    { v: `${Math.round(todayTotals.carbs)}g`, l: 'carbs' },
    { v: `${Math.round(todayTotals.fat)}g`, l: 'fat' }
  ]} />

{#if quickFoods.length > 0 || yesterdayLeft.length > 0 || yesterdayMeals.length > 0}
  <!-- QUICK ADD. Logging is this app's dominant interaction (5-8 entries a day,
       every day) and every one of them used to mean typing a name and waiting on
       a network search. People eat the same things, so all of this is derived
       from the user's own history — no new table, no new sync surface. -->
  <div class="card">
    <div class="flex jb ac">
      <div class="card-lbl" style="margin-bottom:0">Quick add</div>
      {#if quickMsg}<div class="qa-msg">{quickMsg}</div>{/if}
    </div>

    {#if quickFoods.length > 0}
      <div class="qa-chips">
        {#each quickFoods as f (f.name)}
          <button class="qa-chip" disabled={!!quickBusy} onclick={() => quickAddFoods([f], f.name)}>
            <b>{f.name}</b>
            <em>{Math.round(f.kcal)} kcal · {Math.round(f.protein_g)}g P</em>
          </button>
        {/each}
      </div>
    {/if}

    {#if yesterdayLeft.length > 0}
      <button class="btn bg_ bfl qa-repeat" disabled={!!quickBusy}
        onclick={() => quickAddFoods(yesterdayLeft, 'yesterday')}>
        ↺ Repeat yesterday · {yesterdayLeft.length} item{yesterdayLeft.length === 1 ? '' : 's'}, {Math.round(yesterdayLeft.reduce((s, f) => s + f.kcal, 0))} kcal
      </button>
    {/if}

    {#if yesterdayMeals.length > 0}
      <div class="qa-meals">
        {#each yesterdayMeals as m (m.key)}
          <button class="qa-meal" disabled={!!quickBusy} onclick={() => quickAddFoods(m.items, m.label.toLowerCase())}>
            <span class="qa-meal-top"><b>{m.label}</b><span>{m.kcal} kcal · {m.protein_g}g P</span></span>
            <em>{m.items.map((i) => i.name).join(' · ')}</em>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<div class="card">
  <div class="card-lbl">Log food</div>
  <div class="food-form">
    <FoodSearch myFoods={myFoodLibrary} onPick={applySearchFood} />
    <div class="flex gap2" style="margin-bottom:4px">
      <BarcodeScanner onResult={applyScannedFood} />
      <FoodPhotoAnalyzer onResult={applyPhotoFood} />
    </div>
    <div class="scan-note">Search above, scan, snap, or type it in below.</div>
    <input placeholder="Food name (e.g. Chicken breast 200g)" bind:value={foodName} style="margin-bottom:6px">
    <div class="food-form-row">
      <input type="number" inputmode="decimal" placeholder="kcal" bind:value={foodKcal}>
      <input type="number" inputmode="decimal" placeholder="protein g" bind:value={foodProtein}>
      <input type="number" inputmode="decimal" placeholder="carbs g" bind:value={foodCarbs}>
      <input type="number" inputmode="decimal" placeholder="fat g" bind:value={foodFat}>
    </div>
    <button class="btn bp bfl" style="margin-top:8px" onclick={addFood} disabled={addingFood}>{addingFood ? 'Adding…' : 'Add Food'}</button>
    {#if foodMsg}
      <div style="font-size:0.75rem;text-align:center;margin-top:6px;color:{foodMsg.startsWith('Save failed') ? 'var(--red)' : 'var(--green)'}">{foodMsg}</div>
    {/if}
  </div>

  {#if todayFoods.length > 0}
    <div class="food-list">
      {#each todayFoods as f}
        <div class="swipe-row">
          <div class="swipe-actions">
            <div class="swipe-delete" onclick={() => removeFood(f.id)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeFood(f.id); } }}>Delete</div>
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
    <div style="font-size:0.75rem;color:var(--muted);text-align:center;padding:10px 0">No food logged today yet.</div>
  {/if}
</div>

{#if foodEval.tone !== 'na'}
  <div class="card coach-card coach-{foodEval.tone}">
    <div class="coach-hd">
      <span class="coach-dot"></span>
      <span class="coach-title">{foodEval.headline}</span>
    </div>
    <div class="coach-body">{foodEval.detail}</div>
  </div>
{/if}

{#if $_goalReason}
  <div class="note-box">🎯 {goalSummary($_goalReason)}</div>
{:else}
  <div class="note-box warn">🎯 No plan yet — set one in <strong>Progress → Body &amp; Goals</strong>.</div>
{/if}

{#if kcalTrend.length >= 2}
  <div class="card">
    <div class="flex jb ac">
      <div class="card-lbl" style="margin-bottom:0">📈 Intake Trend</div>
      <div class="flex gap2">
        <button class="tab {trendMetric === 'kcal' ? 'on' : ''}" style="padding:3px 10px;font-size:0.6875rem" onclick={() => trendMetric = 'kcal'}>kcal</button>
        <button class="tab {trendMetric === 'protein' ? 'on' : ''}" style="padding:3px 10px;font-size:0.6875rem" onclick={() => trendMetric = 'protein'}>protein</button>
      </div>
    </div>
    <div style="margin-top:10px">
      {#if trendMetric === 'kcal'}
        <MiniChart data={kcalTrend} color="var(--amber)" unit=" kcal" />
      {:else}
        <MiniChart data={proteinTrend} color="var(--green, #2ecc71)" unit="g" />
      {/if}
    </div>
    <div style="font-size:0.6875rem;color:var(--muted);text-align:center">Daily {trendMetric === 'kcal' ? 'calories' : 'protein (g)'} over {kcalTrend.length} logged days</div>
  </div>
{/if}

{#if historyByDay.length > 0}
  <div class="card">
    <div class="flex jb ac" style="cursor:pointer" onclick={() => showHistory = !showHistory} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showHistory = !showHistory; } }}>
      <div class="card-lbl" style="margin-bottom:0">🗓️ Food History ({historyByDay.length} days)</div>
      <span style="color:var(--muted);font-size:0.8125rem">{showHistory ? '▲' : '▼'}</span>
    </div>
    {#if showHistory}
      <div style="margin-top:10px">
        {#each historyByDay as day}
          <div class="hist-day">
            <div class="flex jb ac">
              <div style="font-size:0.8125rem;font-weight:700;color:#fff">{new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
              <div style="font-size:0.6875rem;color:var(--amber);font-weight:600">{Math.round(day.totals.kcal)} kcal &middot; P{Math.round(day.totals.protein)}</div>
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
<div class="page-sub">Ask for anything &middot; written around today's remaining macros</div>

<div class="card gen-card">
  <div class="card-lbl">🧑‍🍳 Cook something new</div>
  <div class="gen-sub">
    Describe what you feel like — ingredients, cuisine, time, equipment, who's eating.
    It's written around the
    {#if todayCalTarget}{Math.max(0, todayCalTarget - Math.round(todayTotals.kcal))} kcal and {/if}
    {Math.max(0, proteinTargetG - Math.round(todayTotals.protein))}g of protein you still have left today.
  </div>
  <textarea class="gen-input" rows="2" bind:value={recipeAsk}
    placeholder="e.g. chicken and spinach, Indian, 30 min, Instant Pot, enough for 4"></textarea>
  <div class="gen-ideas">
    {#each IDEAS as idea}
      <button type="button" class="gen-chip" onclick={() => recipeAsk = idea}>{idea}</button>
    {/each}
  </div>
  <button class="btn bp bfl" style="margin-top:8px" onclick={generateRecipe} disabled={generating}>
    {generating ? 'Writing your recipe…' : 'Generate recipe'}
  </button>
  {#if genMsg}<div class="gen-msg">{genMsg}</div>{/if}
</div>

{#if customRecipes.length > 0}
  <h3>Your recipes</h3>
  {#each customRecipes as r (r.id)}
    <div class="rcard" onclick={() => selected = r} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = r; } }}>
      <div class="flex jb ac">
        <div style="min-width:0">
          <div style="font-weight:700;color:#fff;font-size:0.9375rem">{r.e} {r.name}</div>
          <div style="font-size:0.6875rem;color:var(--muted);margin-top:2px">{r.desc}</div>
        </div>
        <div style="text-align:right;font-size:0.75rem;flex-shrink:0">
          <div style="color:var(--amber);font-weight:700">{r.k} kcal</div>
          <div style="color:var(--muted)">{r.p}p &middot; {r.c}c &middot; {r.f}f</div>
        </div>
      </div>
      <div class="flex gap2 ac" style="margin-top:8px">
        <span class="badge bg">{r.t} min</span>
        <span class="badge ba">{r.p}g protein</span>
        {#if r.kid}<span class="badge bk">👶 Kid-friendly</span>{/if}
        <button type="button" class="rcard-del" onclick={(ev) => { ev.stopPropagation(); deleteCustomRecipe(String(r.id)); }} aria-label="Delete recipe">✕</button>
      </div>
    </div>
  {/each}
{:else}
  <!-- The 19 built-ins used to carry a new user through this space. With them
       gone the area under the generator is blank, so the empty state has to do
       their whole job: say what happens, and start it in one tap. -->
  <div class="rcard rcard-empty">
    <div style="font-weight:700;color:#fff;font-size:0.9375rem">No recipes yet</div>
    <div style="font-size:0.75rem;color:var(--muted);margin-top:4px">
      Describe a meal above and it gets written around your remaining macros for
      today — then saved here for one-tap logging. Or start from one of these:
    </div>
    <div class="flex gap2" style="flex-wrap:wrap;margin-top:10px">
      {#each IDEAS as idea}
        <button
          type="button"
          class="gen-chip"
          disabled={generating}
          onclick={() => { recipeAsk = idea; showGenerator = true; generateRecipe(); }}
        >{idea}</button>
      {/each}
    </div>
  </div>
{/if}

<Modal open={selected !== null} onclose={() => selected = null}>
  {#if selected}
    <div style="font-size:1.25rem;font-weight:700;color:#fff;margin-bottom:4px">{selected.e} {selected.name}</div>
    <div style="font-size:0.75rem;color:var(--muted);margin-bottom:8px">
      {selected.k} kcal &middot; {selected.p}g protein &middot; {selected.c}g carbs &middot; {selected.f}g fat &middot; {selected.t} min
      {#if selected.batch}&middot; makes {selected.batch}{/if}
    </div>
    {#if selected.coachNote}<div class="note-box" style="margin-bottom:10px">🎯 {selected.coachNote}</div>{/if}

    <button class="btn bp bfl" style="margin-bottom:12px" onclick={() => logRecipePortion(selected!)} disabled={loggingRecipe}>
      {loggingRecipe ? 'Logging…' : `Log 1 portion (${selected.k} kcal · ${selected.p}g protein)`}
    </button>

    <h3>Ingredients</h3>
    {#each catOrder as cat}
      {#if selected.ing.some((i) => i.cat === cat)}
        <div style="font-size:0.6875rem;color:var(--muted);margin:6px 0 3px">{catLabel[cat]}</div>
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
      <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);margin-bottom:8px">PREP</div>
      {#each selected.prep as step, i}
        <div class="gi" style="padding:5px 0"><div class="gn">{i+1}. {step}</div></div>
      {/each}
      <hr style="border:none;border-top:1px solid var(--border);margin:8px 0">
      <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);margin-bottom:8px">{method === 'instantPot' ? 'INSTANT POT' : 'STOVETOP'}</div>
      {#each (method === 'instantPot' ? selected.instantPot : selected.steps) as step, i}
        <div class="gi" style="padding:5px 0"><div class="gn">{i+1}. {step}</div></div>
      {/each}
    </div>
  {/if}
</Modal>


<!-- Weekly eating patterns: below the daily logging actions -->
<NutritionInsights />

<style>
  /* Quick add — the taps that replace typing. Chips scroll horizontally so six
     staples fit one thumb-reach row on a 360px phone. */
  .qa-msg{font-size:0.6875rem;font-weight:800;color:var(--green)}
  .qa-chips{display:flex;gap:6px;overflow-x:auto;padding:2px 0 8px;margin:0 -2px;
    scrollbar-width:none;-webkit-overflow-scrolling:touch}
  .qa-chips::-webkit-scrollbar{display:none}
  .qa-chip{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-start;gap:1px;
    max-width:170px;text-align:left;cursor:pointer;
    background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:13px;
    padding:8px 11px;transition:transform .18s var(--ease)}
  .qa-chip:active{transform:scale(.94)}
  .qa-chip:disabled{opacity:.5}
  .qa-chip b{font-size:0.75rem;font-weight:800;color:var(--text);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .qa-chip em{font-style:normal;font-size:0.6875rem;color:var(--muted);white-space:nowrap}
  .qa-repeat{margin-bottom:8px}
  .qa-meals{display:flex;flex-direction:column;gap:6px}
  .qa-meal{display:flex;flex-direction:column;gap:2px;text-align:left;width:100%;cursor:pointer;
    background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:13px;
    padding:9px 11px;transition:transform .18s var(--ease)}
  .qa-meal:active{transform:scale(.985)}
  .qa-meal:disabled{opacity:.5}
  .qa-meal-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
  .qa-meal-top b{font-size:0.8125rem;font-weight:800;color:var(--text)}
  .qa-meal-top span{font-size:0.6875rem;font-weight:700;color:var(--muted);flex-shrink:0}
  .qa-meal em{font-style:normal;font-size:0.6875rem;line-height:1.4;color:var(--muted);
    display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .gen-card{border:1px solid color-mix(in srgb, var(--amber) 45%, transparent)}
  .gen-sub{font-size:0.6875rem;color:var(--muted);line-height:1.45;margin-bottom:8px}
  .gen-input{width:100%;resize:vertical;font-family:inherit}
  .gen-ideas{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .rcard-empty{border-style:dashed;cursor:default}
  .gen-chip{background:var(--bg3);border:1px solid var(--border);color:var(--muted);font-size:0.6875rem;border-radius:999px;padding:4px 10px;cursor:pointer;font-family:inherit}
  .gen-chip:disabled{opacity:.5;cursor:default}
  .gen-chip:active{transform:scale(.97)}
  .gen-msg{font-size:0.75rem;color:var(--amber);text-align:center;margin-top:8px;line-height:1.45}
  .rcard-del{margin-left:auto;background:none;border:none;color:var(--muted);font-size:0.875rem;cursor:pointer;padding:2px 6px;font-family:inherit}

  /* Live food coach — talks to you after every entry. Tone drives the accent. */
  .coach-card{--coach:var(--blue,#60a5fa);border:1px solid color-mix(in srgb, var(--coach) 40%, transparent);background:color-mix(in srgb, var(--coach) 8%, var(--bg2))}
  .coach-good{--coach:var(--green,#2ecc71)}
  .coach-ok{--coach:var(--blue,#60a5fa)}
  .coach-warn{--coach:var(--amber,#f5a623)}
  .coach-bad{--coach:#ff6b6b}
  .coach-hd{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .coach-dot{width:8px;height:8px;border-radius:50%;background:var(--coach);flex-shrink:0;box-shadow:0 0 10px var(--coach)}
  .coach-title{font-size:0.8125rem;font-weight:800;color:#fff}
  .coach-body{font-size:0.75rem;color:var(--text);line-height:1.5}
</style>
