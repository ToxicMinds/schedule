<script lang="ts">
  import { userId } from '$lib/stores/user';
  import { upsertRecord } from '$lib/stores/sync';
  import { liveWeights, liveGoal, liveLog, liveGoalReason, liveTracks } from '$lib/stores/live';
  import { GOAL_KG as DEFAULT_GOAL_KG } from '$lib/config';
  import { projectGoal, ACTIVITY_LABELS, type ActivityLevel } from '$lib/tdee';
  import db from '$lib/db/dexie';
  import ProgressPhotos from '$lib/components/ProgressPhotos.svelte';
  import MiniChart from '$lib/components/MiniChart.svelte';

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  const _goal = liveGoal();
  const _goalReason = liveGoalReason();
  const GOAL_KG = $derived($_goal ?? DEFAULT_GOAL_KG);

  // — Weight — live from IndexedDB (see live.ts).
  const _weights = liveWeights();
  const weights = $derived([...$_weights].sort((a, b) => a.date.localeCompare(b.date)).map((r: any) => ({ date: r.date?.slice(5), weight: r.weight })));
  let weightInput = $state('');
  let savingWeight = $state(false);

  async function saveWeight() {
    if (!uid || !weightInput) return;
    savingWeight = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const existing = await db.table('weights').where('[user_id+date]').equals([uid, today]).first();
      await upsertRecord('weights', {
        id: existing?.id || undefined,
        user_id: uid, date: today,
        weight: parseFloat(weightInput),
        created_at: new Date().toISOString(),
      });
      weightInput = '';
    } catch (e) { console.error('Weight save failed:', e);
    } finally { savingWeight = false; }
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
  const today = new Date().toISOString().slice(0, 10);
  const _todayLog = liveLog(today);
  const waterGlasses = $derived($_todayLog?.water_glasses ?? 0);

  async function toggleWater() {
    if (!uid) return;
    const next = Math.min(waterGlasses + 1, 12);
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
  let gender = $state<'male' | 'female'>('male');
  let height = $state('');
  let neck = $state('');
  let waist = $state('');
  let hip = $state('');
  let age = $state('');
  let activityLevel = $state<ActivityLevel>('moderate');
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
    return goalWeight.map((g) => ({
      ...g,
      ...projectGoal(
        { weightKg: latestWeight, heightCm: parseFloat(height), age: ageNum, gender, activityLevel },
        g.weight
      ),
    }));
  });

  let settingGoal = $state<string | null>(null);

  async function setAsGoal(scenario: NonNullable<typeof goalProjections>[number]) {
    if (!uid) return;
    settingGoal = scenario.label;
    const reason = `${scenario.label} (${scenario.bf}% body fat) — based on ${lbm}kg lean mass measured ${new Date().toISOString().slice(0, 10)}. `
      + `At your TDEE of ~${scenario.tdee} kcal/day and a moderate ~${scenario.dailyDeficitKcal} kcal deficit `
      + `(target intake ~${scenario.targetIntakeKcal} kcal/day), expect roughly ${scenario.weeksToGoal} weeks to reach it.`;
    try {
      await upsertRecord('user_settings', {
        user_id: uid, goal_kg: scenario.weight, goal_reason: reason,
        age: parseInt(age), activity_level: activityLevel,
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
        date: new Date().toISOString().slice(0, 10),
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
  let bfResult = $state<string | null>(null);
  let analyzing = $state(false);
  let photoFile = $state<string | null>(null);

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
    try {
      const { supabase } = await import('$lib/db/client');
      const { data, error } = await supabase.functions.invoke('estimate-bf', {
        body: { image: photoFile, gender },
      });
      if (error) throw error;
      bfResult = data?.estimate ?? 'Could not estimate';
    } catch (e: any) {
      console.error('Photo analysis failed:', e);
      bfResult = 'Photo analysis failed: ' + (e?.message || e?.context?.toString?.() || String(e)).slice(0, 200);
    } finally {
      analyzing = false;
    }
  }
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
    <div style="color:var(--muted);font-size:13px;text-align:center;margin-top:8px">Log one more weight to see the trend</div>
  {:else}
    <div style="color:var(--muted);font-size:13px;text-align:center;margin-top:8px">No weights logged yet</div>
  {/if}
</div>

<div class="card">
  <div class="card-lbl">Goal Progress</div>
  <div style="font-size:13px;color:var(--muted);margin-bottom:6px">Target weight: <strong style="color:var(--amber)">{GOAL_KG} kg</strong></div>
  <div class="pbar-wrap">
    <div class="pbar" style="width: {firstWeight && recentWeight ? Math.min(100, ((firstWeight - recentWeight) / (firstWeight - GOAL_KG)) * 100) : 0}%"></div>
  </div>
  <div class="flex jb" style="font-size:11px;color:var(--muted);margin-top:2px">
    <span>{firstWeight ? firstWeight + 'kg' : 'Start'}</span>
    <span>{GOAL_KG} kg goal</span>
  </div>
</div>

<div class="card">
  <div class="card-lbl">Water</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:6px">{waterGlasses} of 8 glasses today</div>
  <div class="water-drops">
    {#each Array(8) as _, i}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="drop {i < waterGlasses ? 'on' : ''}" onclick={i < waterGlasses ? removeWater : toggleWater} role="button" style="cursor:pointer">
        {i < waterGlasses ? '💧' : ''}
      </div>
    {/each}
  </div>
  {#if waterGlasses >= 8}
    <div style="font-size:12px;color:var(--green);margin-top:6px;text-align:center">✓ Hydration goal met!</div>
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
    <div style="font-size:11px;color:var(--muted);text-align:center">{bodyFatHistory.length} measurements &middot; latest {bodyFatHistory[bodyFatHistory.length - 1].value}%</div>
  </div>
{/if}

{#if goalWeight}
  <div class="card">
    <div class="card-lbl">Goal Projections</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">
      Based on {lbm} kg lean mass at {bodyFat}% body fat
      {#if !goalProjections}<br><span style="color:#ffd166">Enter your age above to see TDEE, calorie target, and a realistic timeline for each option.</span>{/if}
    </div>
    {#each (goalProjections ?? goalWeight) as g}
      <div class="gi" style="border-color:var(--border);flex-direction:column;align-items:stretch;gap:6px">
        <div class="flex jb ac">
          <div style="flex:1">
            <div style="font-weight:700;color:#fff;font-size:14px">{g.label} — {g.weight} kg</div>
            <div style="font-size:11px;color:var(--muted)">{g.desc} ({g.bf}% BF)</div>
          </div>
          <div style="text-align:right">
            {#if g.lose > 0}
              <div style="font-size:11px;color:var(--red)">{g.lose} kg to lose</div>
            {:else}
              <div style="font-size:11px;color:var(--green)">Achieved ✓</div>
            {/if}
          </div>
        </div>
        {#if 'tdee' in g}
          {@const gp = g as any}
          <div class="tdee-box">
            TDEE ~{gp.tdee} kcal/day &middot; target intake ~{gp.targetIntakeKcal} kcal/day ({gp.dailyDeficitKcal} kcal deficit)
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
  <div style="font-size:12px;color:var(--muted);margin-bottom:10px">
    Upload a front/side photo for AI body fat estimation
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
      <div style="color:var(--muted);font-size:13px;text-align:center;margin:8px 0">Analyzing...</div>
    {:else if bfResult}
      <div class="alert as">
        <b>BF% Estimate</b>
        {bfResult}
      </div>
    {/if}
  {/if}
</div>

<ProgressPhotos />
