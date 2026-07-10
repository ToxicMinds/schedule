<script lang="ts">
  import { userId } from '$lib/stores/user';
  import { syncStatus } from '$lib/stores/sync';
  import { upsertRecord } from '$lib/stores/sync';
  import { liveGoal, liveWeights, liveLog, liveGoalReason } from '$lib/stores/live';
  import db from '$lib/db/dexie';
  import { GOAL_KG as DEFAULT_GOAL_KG } from '$lib/config';
  import ProgressPhotos from '$lib/components/ProgressPhotos.svelte';

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  const _goal = liveGoal();
  const _goalReason = liveGoalReason();
  const GOAL_KG = $derived($_goal ?? DEFAULT_GOAL_KG);
  let editingGoal = $state(false);
  let goalInput = $state('');

  async function saveGoal() {
    if (!uid || !goalInput) return;
    const g = parseFloat(goalInput);
    if (!g || g <= 0) return;
    try {
      await upsertRecord('user_settings', { user_id: uid, goal_kg: g, updated_at: new Date().toISOString() });
      editingGoal = false;
    } catch (e) { console.error('Goal save failed:', e); }
  }

  // — Weight —
  // Reads live from IndexedDB via liveWeights() (see live.ts) instead of
  // a one-shot load re-triggered from a $syncStatus effect -- the same
  // stale-until-reload race found and fixed for meal_plans/alarms
  // applies here too: once syncStatus settles to 'synced', a later
  // realtime push from another device wouldn't re-trigger this reload.
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

  // — Chart —
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

  // — Steps —
  let stepsInput = $state('');
  let savingSteps = $state(false);

  async function saveSteps() {
    if (!uid || !stepsInput) return;
    savingSteps = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      await upsertRecord('steps', {
        user_id: uid, date: today,
        count: parseInt(stepsInput),
        created_at: new Date().toISOString(),
      });
      stepsInput = '';
    } catch (e) { console.error('Steps save failed:', e);
    } finally { savingSteps = false; }
  }

  // — Water —
  // Reads live from IndexedDB via liveLog() instead of a one-shot load
  // that only ever ran once (guarded by `!waterLoaded`) -- so a water
  // count change made on another device would never appear here without
  // a manual reload.
  const today = new Date().toISOString().slice(0, 10);
  const _todayLog = liveLog(today);
  const waterGlasses = $derived($_todayLog?.water_glasses ?? 0);

  async function toggleWater() {
    if (!uid) return;
    const next = Math.min(waterGlasses + 1, 12);
    try {
      await upsertRecord('daily_logs', { user_id: uid, date: today, water_glasses: next });
    } catch (e) { console.error('Water save failed:', e); }
  }

  async function removeWater() {
    if (!uid || waterGlasses <= 0) return;
    const next = waterGlasses - 1;
    try {
      await upsertRecord('daily_logs', { user_id: uid, date: today, water_glasses: next });
    } catch (e) { console.error('Water save failed:', e); }
  }

  const recentWeight = $derived(weights.length > 0 ? weights[weights.length - 1].weight : null);
  const firstWeight = $derived(weights.length > 0 ? weights[0].weight : null);
  const kgLost = $derived(firstWeight && recentWeight ? (firstWeight - recentWeight).toFixed(1) : '--');
</script>

<div class="page-hd">Track</div>
<div class="page-sub">Weight, steps, water & body measurements</div>

<div class="srow">
  <div class="scard"><span class="sval">{kgLost}</span><span class="slbl">kg Lost</span></div>
  <div class="scard"><span class="sval">{recentWeight ?? '--'}</span><span class="slbl">kg Now</span></div>
  <div class="scard" style="cursor:pointer" onclick={() => { editingGoal = true; goalInput = GOAL_KG.toString(); }} role="button">
    {#if editingGoal}
      <input type="number" step="0.5" bind:value={goalInput} onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.key === 'Enter' && saveGoal()}
        onblur={saveGoal} style="width:100%;text-align:center;background:transparent;border:none;color:inherit;font-size:inherit;font-weight:inherit;padding:0" autofocus>
    {:else}
      <span class="sval">{GOAL_KG}</span>
    {/if}
    <span class="slbl">kg Goal ✎</span>
  </div>
</div>

{#if $_goalReason}
  <div class="note-box">💡 {$_goalReason}</div>
{:else}
  <div class="note-box warn">⚠️ This goal weight has no calculation behind it yet — head to the Plan page to set a real one based on your body composition and calorie needs.</div>
{/if}

<div class="card">
  <div class="card-lbl">Weight Log</div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="track-weight">Weight (kg)</label>
      <input id="track-weight" type="number" step="0.1" bind:value={weightInput} placeholder={recentWeight?.toString() || '116.0'} style="text-align:center">
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
  <div class="card-lbl">Steps</div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="track-steps">Daily steps</label>
      <input id="track-steps" type="number" bind:value={stepsInput} placeholder="9000" style="text-align:center">
    </div>
  </div>
  <button class="btn bp bfl" onclick={saveSteps} disabled={!stepsInput || savingSteps}>Log Steps</button>
</div>

<div class="card">
  <div class="card-lbl">Water</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:6px">{waterGlasses} of 8 glasses today</div>
  <div class="water-drops">
    {#each Array(8) as _, i}
      <div class="drop {i < waterGlasses ? 'on' : ''}" onclick={i < waterGlasses ? removeWater : toggleWater} role="button" style="cursor:pointer">
        {i < waterGlasses ? '💧' : ''}
      </div>
    {/each}
  </div>
  {#if waterGlasses >= 8}
    <div style="font-size:12px;color:var(--green);margin-top:6px;text-align:center">✓ Hydration goal met!</div>
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

<ProgressPhotos />
