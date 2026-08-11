<script lang="ts">
  import { todayYmd } from '$lib/date';
  import { userId } from '$lib/stores/user';
  import { upsertRecord } from '$lib/stores/sync';
  import { liveWeights, liveGoal, liveLog, liveGoalReason, liveTracks, liveFoodLogs, liveDailyLogs, liveProfile } from '$lib/stores/live';
  import { ageFrom } from '$lib/profile';
  import { projectGoal, projectGoalWithTdee, ACTIVITY_LABELS, type ActivityLevel } from '$lib/tdee';
  import { waterTargetLitres } from '$lib/coach';
  import { speak } from '$lib/stores/toast';
  import { haptic } from '$lib/haptics';
  import { adaptiveTdee } from '$lib/adaptiveTdee';
  import db from '$lib/db/dexie';
  import ProgressPhotos from '$lib/components/ProgressPhotos.svelte';
  import MiniChart from '$lib/components/MiniChart.svelte';

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  const _goal = liveGoal();
  const _goalReason = liveGoalReason();
  const GOAL_KG = $derived($_goal ?? 0);

  // — Weight — live from IndexedDB (see live.ts).
  const _weights = liveWeights();
  const weights = $derived([...$_weights].sort((a, b) => a.date.localeCompare(b.date)).map((r: any) => ({ date: r.date?.slice(5), weight: r.weight })));

  // Learned (adaptive) maintenance from the user's own intake vs weight trend.
  const _foodLogs = liveFoodLogs();
  const _dailyLogs = liveDailyLogs();
  const learnedBurn = $derived.by(() => {
    const intakeByDate = new Map<string, number>();
    for (const f of $_foodLogs as any[]) {
      intakeByDate.set(f.date, (intakeByDate.get(f.date) ?? 0) + (f.kcal || 0));
    }
    for (const l of $_dailyLogs as any[]) {
      if (!intakeByDate.has(l.date) && (l.kcal || 0) > 0) intakeByDate.set(l.date, l.kcal);
    }
    const intake = Array.from(intakeByDate, ([date, kcal]) => ({ date, kcal }));
    const wts = ($_weights as any[]).map((w) => ({ date: w.date, weight: w.weight }));
    return adaptiveTdee({ intake, weights: wts });
  });
  let weightInput = $state('');
  let savingWeight = $state(false);

  async function saveWeight() {
    if (!uid || !weightInput) return;
    haptic('tap');
    savingWeight = true;
    try {
      const today = todayYmd();
      const w = parseFloat(weightInput);
      const existing = await db.table('weights').where('[user_id+date]').equals([uid, today]).first();
      // The lowest weight logged BEFORE today's entry — so we can tell if this
      // reading is a genuine new low and say so out loud.
      const priorLow = ($_weights as any[])
        .filter((r) => r.date !== today)
        .reduce((lo: number | null, r) => (lo == null || r.weight < lo ? r.weight : lo), null as number | null);
      const startKg = $_profile?.start_kg ?? null;
      await upsertRecord('weights', {
        id: existing?.id || undefined,
        user_id: uid, date: today,
        weight: w,
        created_at: new Date().toISOString(),
      });
      announceWeight(w, priorLow, startKg);
      weightInput = '';
    } catch (e) { console.error('Weight save failed:', e);
    } finally { savingWeight = false; }
  }

  // The app talks back on a weigh-in: hitting goal is the headline; a new low
  // (only meaningful when cutting) is celebrated with how far you've come.
  function announceWeight(w: number, priorLow: number | null, startKg: number | null) {
    const goal = GOAL_KG;
    if (goal > 0 && w <= goal + 0.05 && (priorLow == null || priorLow > goal + 0.05)) {
      speak(`goal-reached-${w}`, 'Goal weight reached 🎯', {
        tone: 'good', icon: '🎯', ttl: 10000,
        body: `${w.toFixed(1)} kg — you did the thing. Time to talk maintenance so it stays off.`,
      });
      return;
    }
    // New low, and clearly moving the right way (a cut). Needs prior history so
    // the very first weigh-in isn't announced as a "low".
    if (priorLow != null && w < priorLow - 0.05 && (goal === 0 || w > goal)) {
      const fromStart = startKg != null && startKg > w ? ` — down ${(startKg - w).toFixed(1)} kg from ${startKg.toFixed(1)}` : '';
      speak(`low-${w}`, `New low: ${w.toFixed(1)} kg 📉`, {
        tone: 'good', icon: '📉',
        body: `Lowest you've logged${fromStart}. The trend is your friend — keep the protein high.`,
      });
    }
  }

  // — Weight chart —
  const pad = { t: 20, r: 16, b: 24, l: 40 };
  const chartW = 340, chartH = 160;
  const plotW = chartW - pad.l - pad.r, plotH = chartH - pad.t - pad.b;

  function chartPath(data: Array<{date: string; weight: number}>): string {
    if (data.length < 2) return '';
    const pts = data.slice(-30);
    const mn = Math.min(...pts.map(p => p.weight)) - 1;
    const mx = Math.max(...pts.map(p => p.weight)) + 1;
    const rng = mx - mn || 1;
    return pts.map((p, i) => {
      const x = pad.l + (i / (pts.length - 1)) * plotW;
      const y = pad.t + (1 - (p.weight - mn) / rng) * plotH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  function chartArea(data: Array<{date: string; weight: number}>): string {
    if (data.length < 2) return '';
    const pts = data.slice(-30);
    const mn = Math.min(...pts.map(p => p.weight)) - 1;
    const mx = Math.max(...pts.map(p => p.weight)) + 1;
    const rng = mx - mn || 1;
    const path = pts.map((p, i) => {
      const x = pad.l + (i / (pts.length - 1)) * plotW;
      const y = pad.t + (1 - (p.weight - mn) / rng) * plotH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `${path}L${pad.l + plotW},${pad.t + plotH}L${pad.l},${pad.t + plotH}Z`;
  }

  function chartLabels(data: Array<{date: string; weight: number}>): Array<{x: number; y: number; label: string}> {
    if (data.length < 2) return [];
    const pts = data.slice(-30);
    return pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 5)) === 0).map((p, i, a) => {
      const x = pad.l + (i / (a.length - 1 || 1)) * plotW;
      return { x, y: pad.t + plotH + 14, label: p.date };
    });
  }

  // — Water — live from IndexedDB.
  const today = todayYmd();
  const _todayLog = liveLog(today);
  const waterGlasses = $derived($_todayLog?.water_glasses ?? 0);

  async function toggleWater() {
    if (!uid) return;
    const next = Math.min(waterGlasses + 1, 20);
    try { await upsertRecord('daily_logs', { user_id: uid, date: today, water_glasses: next }); }
    catch (e) { console.error('Water save failed:', e); }
  }
  async function removeWater() {
    if (!uid || waterGlasses <= 0) return;
    const next = waterGlasses - 1;
    try { await upsertRecord('daily_logs', { user_id: uid, date: today, water_glasses: next }); }
    catch (e) { console.error('Water save failed:', e); }
  }

  const recentWeight = $derived(weights.length > 0 ? weights[weights.length - 1].weight : null);
  const firstWeight = $derived(weights.length > 0 ? weights[0].weight : null);

  // ————————————————————————————————————————————————————————————
  // Body composition (formerly the Plan page)
  // ————————————————————————————————————————————————————————————
  // Seeded from the saved profile rather than blank. These were previously
  // local-only state, so height, age and sex had to be retyped on EVERY visit
  // and nothing outside this component could ever read them — which meant the
  // TDEE engine only worked while you happened to be filling in this form.
  const _profile = liveProfile();
  let gender = $state<'male' | 'female'>('male');
  let height = $state('');
  let neck = $state('');
  let waist = $state('');
  let hip = $state('');
  let age = $state('');
  let activityLevel = $state<ActivityLevel>('moderate');
  let profileSeeded = $state(false);

  $effect(() => {
    const p = $_profile;
    if (!p || profileSeeded) return;
    if (p.sex === 'male' || p.sex === 'female') gender = p.sex;
    if (p.height_cm) height = String(p.height_cm);
    const a = ageFrom(p.birth_year);
    if (a != null) age = String(a);
    if (p.activity_level) activityLevel = p.activity_level;
    profileSeeded = true;
  });
  let bodyFat = $state<number | null>(null);
  let lbm = $state<number | null>(null);

  function calcNavy() {
    const h = parseFloat(height);
    const n = parseFloat(neck);
    const w = parseFloat(waist);
    const hp = parseFloat(hip);
    if (!h || !n || !w || h < 100 || h > 250) return;
    if (gender === 'female' && (!hp || hp < 40)) return;
    if (n < 20 || w < 40 || (gender === 'female' && hp < 40)) return;

    let bf: number;
    if (gender === 'male') {
      const log = Math.log10(w - n) * 0.19077;
      const logH = Math.log10(h) * 0.15456;
      bf = 495 / (1.0324 - log + logH) - 450;
    } else {
      const log = Math.log10(w + hp - n) * 0.35004;
      const logH = Math.log10(h) * 0.22100;
      bf = 495 / (1.29579 - log + logH) - 450;
    }
    bodyFat = Math.max(3, Math.min(60, parseFloat(bf.toFixed(1))));
    lbm = null;
  }

  const latestWeight = $derived.by(() => {
    const sorted = [...$_weights].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.length > 0 ? sorted[sorted.length - 1].weight : null;
  });

  const waterL = $derived(waterGlasses * 0.25);
  const waterGoalL = $derived(waterTargetLitres(latestWeight));
  const dropsGoal = $derived(Math.round(waterGoalL / 0.25));

  $effect(() => {
    if (latestWeight && bodyFat) {
      lbm = parseFloat((latestWeight * (1 - bodyFat / 100)).toFixed(1));
    }
  });

  type Scenario = { label: string; bf: string; desc: string };
  const scenarios: Scenario[] = [
    { label: 'Lean', bf: '10', desc: 'Athlete — visible abs, vascular' },
    { label: 'Fit', bf: '14', desc: 'Fit — defined, lean physique' },
    { label: 'Healthy', bf: '18', desc: 'Healthy — good shape, comfortable' },
  ];
  const femaleScenarios: Scenario[] = [
    { label: 'Lean', bf: '18', desc: 'Athlete — very defined' },
    { label: 'Fit', bf: '23', desc: 'Fit — toned, athletic' },
    { label: 'Healthy', bf: '28', desc: 'Healthy — good shape' },
  ];
  const activeScenarios = $derived(gender === 'male' ? scenarios : femaleScenarios);
  const goalWeight = $derived.by(() => {
    if (!lbm || !bodyFat) return null;
    const lbmVal = lbm;
    const wt = latestWeight;
    return activeScenarios.map((s) => ({
      label: s.label, desc: s.desc,
      bf: parseInt(s.bf),
      weight: parseFloat((lbmVal / (1 - parseInt(s.bf) / 100)).toFixed(1)),
      lose: wt ? parseFloat((wt - lbmVal / (1 - parseInt(s.bf) / 100)).toFixed(1)) : 0,
    }));
  });

  const goalProjections = $derived.by(() => {
    if (!goalWeight || !latestWeight || !height || !age) return null;
    const ageNum = parseInt(age);
    if (!ageNum || ageNum < 10 || ageNum > 100) return null;
    const useLearned = learnedBurn.tdee != null && (learnedBurn.confidence === 'high' || learnedBurn.confidence === 'medium');
    return goalWeight.map((g) => ({
      ...g,
      ...(useLearned
        ? projectGoalWithTdee(learnedBurn.tdee as number, latestWeight, g.weight)
        : projectGoal(
            { weightKg: latestWeight, heightCm: parseFloat(height), age: ageNum, gender, activityLevel },
            g.weight
          )),
      learned: useLearned,
    }));
  });

  let settingGoal = $state<string | null>(null);

  async function setAsGoal(scenario: NonNullable<typeof goalProjections>[number]) {
    if (!uid) return;
    settingGoal = scenario.label;
    const src = (scenario as any).learned
      ? `your real maintenance of ~${scenario.tdee} kcal/day (learned from ${learnedBurn.loggedDays} days of your own logs)`
      : `your TDEE of ~${scenario.tdee} kcal/day`;
    const reason = `${scenario.label} (${scenario.bf}% body fat) — based on ${lbm}kg lean mass measured ${todayYmd()}. `
      + `At ${src} and a moderate ~${scenario.dailyDeficitKcal} kcal deficit `
      + `(target intake ~${scenario.targetIntakeKcal} kcal/day), expect roughly ${scenario.weeksToGoal} weeks to reach it.`;
    try {
      await upsertRecord('user_settings', {
        user_id: uid, goal_kg: scenario.weight, goal_reason: reason,
        // Persist the body fields too, so the profile stays the single source of
        // truth and these never have to be retyped. birth_year rather than age:
        // a stored age goes stale and silently shifts every calorie target.
        birth_year: parseInt(age) > 0 ? new Date().getFullYear() - parseInt(age) : null,
        height_cm: parseFloat(height) || null,
        sex: gender,
        activity_level: activityLevel,
        updated_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Set goal failed:', e);
    } finally { settingGoal = null; }
  }

  async function saveMeasurement() {
    if (!uid || !bodyFat) return;
    try {
      await upsertRecord('tracks', {
        id: crypto.randomUUID(),
        user_id: uid,
        date: todayYmd(),
        name: 'body_fat',
        value: bodyFat,
        unit: '%',
        created_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Save measurement failed:', e); }
  }

  // — Body-fat measurement history (NEW) — tracks table, name='body_fat'.
  const _tracks = liveTracks();
  const bodyFatHistory = $derived(
    [...$_tracks]
      .filter((t: any) => t.name === 'body_fat')
      .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
      .map((t: any) => ({ date: t.date, value: t.value }))
  );

  // — Photo BF estimate —
  type Region = { key: string; label: string; score: number; note: string };
  type Snapshot = { id: string; date: string; bf_percent: number | null; regions: Region[]; summary: string | null; created_at: string };
  let bfResult = $state<string | null>(null);
  let analyzing = $state(false);
  let photoFile = $state<string | null>(null);
  let lastRegions = $state<Region[]>([]);
  let lastSummary = $state<string | null>(null);
  let snapshots = $state<Snapshot[]>([]);
  let snapSaveMsg = $state('');

  function onPhoto(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { photoFile = reader.result as string; analyzePhoto(); };
    reader.readAsDataURL(file);
  }

  async function analyzePhoto() {
    if (!photoFile || !uid) return;
    analyzing = true;
    bfResult = null;
    lastRegions = [];
    lastSummary = null;
    snapSaveMsg = '';
    try {
      const { supabase } = await import('$lib/db/client');
      const { data, error } = await supabase.functions.invoke('estimate-bf', {
        body: { image: photoFile, gender },
      });
      if (error) throw error;
      bfResult = data?.estimate ?? 'Could not estimate';
      lastRegions = Array.isArray(data?.regions) ? data.regions : [];
      lastSummary = data?.summary ?? null;
      // Persist a snapshot so each new photo builds a comparable history. Only
      // save when we actually got a body-fat number + a region breakdown.
      if (typeof data?.percent === 'number' && lastRegions.length > 0) {
        await saveSnapshot(data.percent, lastRegions, lastSummary);
      }
    } catch (e: any) {
      console.error('Photo analysis failed:', e);
      bfResult = 'Photo analysis failed: ' + (e?.message || e?.context?.toString?.() || String(e)).slice(0, 200);
    } finally {
      analyzing = false;
    }
  }

  async function saveSnapshot(percent: number, regions: Region[], summary: string | null) {
    try {
      const { supabase } = await import('$lib/db/client');
      const { error } = await supabase.from('physique_snapshots').insert({
        user_id: uid, date: todayYmd(), bf_percent: percent, regions, summary,
      });
      if (error) throw error;
      snapSaveMsg = 'Saved to your physique history ✓';
      await loadSnapshots();
    } catch (e: any) {
      snapSaveMsg = 'Could not save snapshot: ' + (e?.message || String(e)).slice(0, 120);
    }
  }

  async function loadSnapshots() {
    if (!uid) return;
    try {
      const { supabase } = await import('$lib/db/client');
      const { data, error } = await supabase
        .from('physique_snapshots')
        .select('id, date, bf_percent, regions, summary, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: true });
      if (error) throw error;
      snapshots = (data as Snapshot[]) || [];
    } catch (e) {
      console.error('Load snapshots failed:', e);
    }
  }

  $effect(() => { if (uid) loadSnapshots(); });

  // The two most recent snapshots, newest last, drive the comparison.
  const latestSnap = $derived(snapshots.length > 0 ? snapshots[snapshots.length - 1] : null);
  const prevSnap = $derived(snapshots.length > 1 ? snapshots[snapshots.length - 2] : null);

  // Per-region change vs the previous snapshot: score delta + direction. Only
  // regions present in both snapshots are comparable.
  const regionDeltas = $derived.by(() => {
    if (!latestSnap) return [] as Array<Region & { delta: number | null }>;
    const prevByKey = new Map((prevSnap?.regions || []).map((r) => [r.key, r.score]));
    return latestSnap.regions.map((r) => {
      const before = prevByKey.get(r.key);
      return { ...r, delta: before == null ? null : r.score - before };
    });
  });

  // Headline "most improved" and "needs focus" for the comparison card.
  const mostImproved = $derived.by(() => {
    const withDelta = regionDeltas.filter((r) => r.delta != null && (r.delta as number) > 0);
    return withDelta.sort((a, b) => (b.delta as number) - (a.delta as number))[0] || null;
  });
  const needsFocus = $derived.by(() => {
    // Prefer the biggest regression; if nothing regressed, the lowest-scoring region.
    const regressed = regionDeltas.filter((r) => r.delta != null && (r.delta as number) < 0)
      .sort((a, b) => (a.delta as number) - (b.delta as number))[0];
    if (regressed) return regressed;
    return [...regionDeltas].sort((a, b) => a.score - b.score)[0] || null;
  });
</script>

<!-- Why this plan — surfaced right beside body/goal tracking -->
{#if $_goalReason}
  <div class="note-box">💡 <strong>Why this plan:</strong> {$_goalReason}</div>
{:else}
  <div class="note-box warn">⚠️ No calorie/protein plan yet — measure your body composition below and tap <strong>Set as my goal</strong> to generate a TDEE-backed target.</div>
{/if}

<div class="card">
  <div class="card-lbl">Weight</div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="bg-weight">Weight (kg)</label>
      <input id="bg-weight" type="number" step="0.1" bind:value={weightInput} placeholder={recentWeight?.toString() || '116.0'} style="text-align:center">
    </div>
  </div>
  <button class="btn bp bfl" onclick={saveWeight} disabled={!weightInput || savingWeight}>Log Weight</button>

  {#if weights.length >= 2}
    <div class="chart-box">
      <svg viewBox="0 0 {chartW} {chartH}" width="100%" height={chartH}>
        <path d={chartArea(weights)} fill="var(--ab)" />
        <path d={chartPath(weights)} stroke="var(--amber)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        {#each chartLabels(weights) as lbl}
          <text x={lbl.x} y={lbl.y} fill="var(--muted)" font-size="9" text-anchor="middle">{lbl.label}</text>
        {/each}
      </svg>
    </div>
  {:else if weights.length === 1}
    <div style="color:var(--muted);font-size:0.8125rem;text-align:center;margin-top:8px">Log one more weight to see the trend</div>
  {:else}
    <div style="color:var(--muted);font-size:0.8125rem;text-align:center;margin-top:8px">No weights logged yet</div>
  {/if}
</div>

<div class="card">
  <div class="card-lbl">Goal Progress</div>
  <div style="font-size:0.8125rem;color:var(--muted);margin-bottom:6px">Target weight: <strong style="color:var(--amber)">{GOAL_KG} kg</strong></div>
  <div class="pbar-wrap">
    <div class="pbar" style="width: {firstWeight && recentWeight ? Math.min(100, ((firstWeight - recentWeight) / (firstWeight - GOAL_KG)) * 100) : 0}%"></div>
  </div>
  <div class="flex jb" style="font-size:0.6875rem;color:var(--muted);margin-top:2px">
    <span>{firstWeight ? firstWeight + 'kg' : 'Start'}</span>
    <span>{GOAL_KG} kg goal</span>
  </div>
</div>

<div class="card">
  <div class="card-lbl">Water</div>
  <div style="font-size:0.75rem;color:var(--muted);margin-bottom:6px">{waterL.toFixed(2)} of {waterGoalL.toFixed(1)} L today <span style="opacity:.6">· tap a drop = 250 ml</span></div>
  <div class="water-drops">
    {#each Array(dropsGoal) as _, i}
      <div class="drop {i < waterGlasses ? 'on' : ''}" onclick={i < waterGlasses ? removeWater : toggleWater} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (i < waterGlasses ? removeWater : toggleWater)(); } }} style="cursor:pointer">
        {i < waterGlasses ? '💧' : ''}
      </div>
    {/each}
  </div>
  {#if waterL >= waterGoalL}
    <div style="font-size:0.75rem;color:var(--green);margin-top:6px;text-align:center">✓ Hydration goal met!</div>
  {/if}
</div>

{#if bodyFat !== null}
  <div class="srow">
    <div class="scard"><span class="sval">{bodyFat}%</span><span class="slbl">Body Fat</span></div>
    <div class="scard"><span class="sval">{lbm ?? '--'} kg</span><span class="slbl">Lean Mass</span></div>
    <div class="scard"><span class="sval">{latestWeight ?? '--'} kg</span><span class="slbl">Weight</span></div>
  </div>
{/if}

<div class="card">
  <div class="card-lbl">Body Measurements</div>
  <div class="flex gap2" style="margin-bottom:10px">
    <button class="tab {gender === 'male' ? 'on' : ''}" onclick={() => { gender = 'male'; bodyFat = null; }}>Male</button>
    <button class="tab {gender === 'female' ? 'on' : ''}" onclick={() => { gender = 'female'; bodyFat = null; }}>Female</button>
  </div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="bg-height">Height (cm)</label>
      <input id="bg-height" type="number" bind:value={height} placeholder="180" oninput={calcNavy}>
    </div>
    <div class="f1">
      <label class="flbl" for="bg-neck">Neck (cm)</label>
      <input id="bg-neck" type="number" step="0.5" bind:value={neck} placeholder="40" oninput={calcNavy}>
    </div>
  </div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="bg-waist">Waist (cm)</label>
      <input id="bg-waist" type="number" step="0.5" bind:value={waist} placeholder="95" oninput={calcNavy}>
    </div>
    {#if gender === 'female'}
      <div class="f1">
        <label class="flbl" for="bg-hip">Hip (cm)</label>
        <input id="bg-hip" type="number" step="0.5" bind:value={hip} placeholder="100" oninput={calcNavy}>
      </div>
    {/if}
  </div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="bg-age">Age</label>
      <input id="bg-age" type="number" bind:value={age} placeholder="35">
    </div>
  </div>
  <label class="flbl" for="bg-activity">Activity level</label>
  <select id="bg-activity" bind:value={activityLevel} style="margin-bottom:8px">
    {#each Object.entries(ACTIVITY_LABELS) as [key, label]}
      <option value={key}>{label}</option>
    {/each}
  </select>
  {#if bodyFat !== null}
    <button class="btn bp bfl" onclick={saveMeasurement}>Save {bodyFat}%</button>
  {/if}
</div>

{#if bodyFatHistory.length >= 2}
  <div class="card">
    <div class="card-lbl">Body Fat History</div>
    <MiniChart data={bodyFatHistory} color="var(--blue)" />
    <div style="font-size:0.6875rem;color:var(--muted);text-align:center">{bodyFatHistory.length} measurements &middot; latest {bodyFatHistory[bodyFatHistory.length - 1].value}%</div>
  </div>
{/if}

{#if goalWeight}
  <div class="card">
    <div class="card-lbl">Goal Projections</div>
    <div style="font-size:0.75rem;color:var(--muted);margin-bottom:10px">
      Based on {lbm} kg lean mass at {bodyFat}% body fat
      {#if !goalProjections}<br><span style="color:#ffd166">Enter your age above to see TDEE, calorie target, and a realistic timeline for each option.</span>{/if}
    </div>
    {#if learnedBurn.tdee != null && (learnedBurn.confidence === 'high' || learnedBurn.confidence === 'medium')}
      <div class="note-box" style="margin-bottom:10px">
        🧠 <strong>Learned from your data:</strong> your real maintenance is ~{learnedBurn.tdee} kcal/day
        (from {learnedBurn.loggedDays} logged days{#if learnedBurn.weightRateKgPerWeek !== 0} · {learnedBurn.weightRateKgPerWeek > 0 ? 'losing' : 'gaining'} ~{Math.abs(learnedBurn.weightRateKgPerWeek).toFixed(2)} kg/wk{/if}).
        The targets below use this real number, not a textbook formula — so they self-correct to what your body's actually doing.
      </div>
    {/if}
    {#each (goalProjections ?? goalWeight) as g}
      <div class="gi" style="border-color:var(--border);flex-direction:column;align-items:stretch;gap:6px">
        <div class="flex jb ac">
          <div style="flex:1">
            <div style="font-weight:700;color:#fff;font-size:0.875rem">{g.label} — {g.weight} kg</div>
            <div style="font-size:0.6875rem;color:var(--muted)">{g.desc} ({g.bf}% BF)</div>
          </div>
          <div style="text-align:right">
            {#if g.lose > 0}
              <div style="font-size:0.6875rem;color:var(--red)">{g.lose} kg to lose</div>
            {:else}
              <div style="font-size:0.6875rem;color:var(--green)">Achieved ✓</div>
            {/if}
          </div>
        </div>
        {#if 'tdee' in g}
          {@const gp = g as any}
          <div class="tdee-box">
            {(g as any).learned ? 'Your real burn' : 'TDEE'} ~{gp.tdee} kcal/day &middot; target intake ~{gp.targetIntakeKcal} kcal/day ({gp.dailyDeficitKcal} kcal deficit)
            {#if gp.weeksToGoal > 0}<br>~{gp.weeksToGoal} weeks at this rate{/if}
          </div>
        {/if}
        <button class="btn bg_ bsm" onclick={() => setAsGoal(g as any)} disabled={settingGoal === g.label || !('tdee' in g)}>
          {settingGoal === g.label ? 'Setting…' : $_goal === g.weight ? 'Current goal ✓' : 'Set as my goal'}
        </button>
      </div>
    {/each}
  </div>
{/if}

<div class="card">
  <div class="card-lbl">Photo Estimate (Gemini Vision)</div>
  <div style="font-size:0.75rem;color:var(--muted);margin-bottom:10px">
    A front/side photo estimates body fat and rates each region.
  </div>
  {#if !photoFile}
    <label class="btn bg_ bfl" style="text-align:center;cursor:pointer">
      Upload Photo
      <input type="file" accept="image/*" capture="environment" onchange={onPhoto} style="display:none">
    </label>
  {:else}
    <div class="chart-box">
      <img src={photoFile} alt="Uploaded" style="width:100%;border-radius:6px">
    </div>
    {#if analyzing}
      <div style="color:var(--muted);font-size:0.8125rem;text-align:center;margin:8px 0">Analyzing…</div>
    {:else if bfResult}
      <div class="alert as">
        <b>BF% Estimate</b>
        {bfResult}
      </div>
      {#if lastRegions.length > 0}
        <div class="phys-grid">
          {#each regionDeltas as r}
            <div class="phys-cell">
              <div class="phys-top">
                <span class="phys-lbl">{r.label}</span>
                {#if r.delta != null && r.delta !== 0}
                  <span class="phys-delta" class:up={r.delta > 0} class:down={r.delta < 0}>{r.delta > 0 ? '▲' : '▼'}{Math.abs(r.delta)}</span>
                {/if}
              </div>
              <div class="phys-bar"><div class="phys-fill" style="width:{r.score}%"></div></div>
              <div class="phys-note">{r.note}</div>
            </div>
          {/each}
        </div>
      {/if}
      {#if snapSaveMsg}
        <div style="font-size:0.6875rem;text-align:center;margin-top:8px;color:{snapSaveMsg.startsWith('Could not') ? 'var(--red)' : 'var(--green)'}">{snapSaveMsg}</div>
      {/if}
      <label class="btn bg_ bfl" style="text-align:center;cursor:pointer;margin-top:10px">
        Take another photo
        <input type="file" accept="image/*" capture="environment" onchange={onPhoto} style="display:none">
      </label>
    {/if}
  {/if}
</div>

{#if latestSnap}
  <div class="card">
    <div class="card-lbl">Physique — where you're winning &amp; what needs work</div>
    {#if prevSnap}
      <div class="phys-cmp">
        {#if mostImproved}
          <div class="phys-cmp-row good">
            <span class="phys-cmp-tag">📈 Most improved</span>
            <span class="phys-cmp-val">{mostImproved.label}{#if mostImproved.delta != null} <em>+{mostImproved.delta}</em>{/if}</span>
          </div>
        {/if}
        {#if needsFocus}
          <div class="phys-cmp-row focus">
            <span class="phys-cmp-tag">🎯 Needs focus</span>
            <span class="phys-cmp-val">{needsFocus.label}{#if needsFocus.delta != null && needsFocus.delta < 0} <em>{needsFocus.delta}</em>{/if}</span>
          </div>
        {/if}
      </div>
      <div class="phys-cmp-meta">Compared with {prevSnap.date} → {latestSnap.date}</div>
    {:else}
      <div style="font-size:0.75rem;color:var(--muted)">
        First snapshot saved on {latestSnap.date}. Add another photo later to see where you're improving.
      </div>
    {/if}
    {#if latestSnap.summary}
      <div class="note-box" style="margin-top:10px">💬 {latestSnap.summary}</div>
    {/if}
    {#if snapshots.length >= 2}
      <div class="phys-trend">
        <span class="phys-trend-lbl">Body fat</span>
        <span class="phys-trend-val">{snapshots[0].bf_percent}% → {latestSnap.bf_percent}% <em>({snapshots.length} snapshots)</em></span>
      </div>
    {/if}
  </div>
{/if}

<ProgressPhotos />

<style>
  .phys-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
  .phys-cell{background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:11px;padding:9px 10px}
  .phys-top{display:flex;align-items:center;justify-content:space-between;gap:6px}
  .phys-lbl{font-size:0.75rem;font-weight:700;color:#fff}
  .phys-delta{font-size:0.625rem;font-weight:800}
  .phys-delta.up{color:var(--green)}
  .phys-delta.down{color:var(--red)}
  .phys-bar{height:6px;border-radius:4px;background:var(--bg3);overflow:hidden;margin:6px 0 5px}
  .phys-fill{height:100%;border-radius:4px;background:var(--grad-amber);transition:width .5s var(--ease)}
  .phys-note{font-size:0.625rem;color:var(--muted);line-height:1.35}
  .phys-cmp{display:flex;flex-direction:column;gap:8px;margin-top:4px}
  .phys-cmp-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:11px;border:1px solid var(--glass-brd)}
  .phys-cmp-row.good{background:color-mix(in srgb,var(--green) 12%,transparent)}
  .phys-cmp-row.focus{background:color-mix(in srgb,var(--amber) 12%,transparent)}
  .phys-cmp-tag{font-size:0.6875rem;font-weight:800;color:var(--muted)}
  .phys-cmp-val{font-size:0.875rem;font-weight:800;color:#fff}
  .phys-cmp-val em{font-style:normal;font-weight:700;font-size:0.75rem;color:var(--muted)}
  .phys-cmp-meta{font-size:0.625rem;color:var(--muted);text-align:center;margin-top:8px}
  .phys-trend{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
  .phys-trend-lbl{font-size:0.6875rem;font-weight:700;color:var(--muted)}
  .phys-trend-val{font-size:0.8125rem;font-weight:800;color:#fff}
  .phys-trend-val em{font-style:normal;font-weight:600;font-size:0.6875rem;color:var(--muted)}
</style>
