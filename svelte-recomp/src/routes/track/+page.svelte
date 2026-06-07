<script lang="ts">
  import { userId } from '$lib/stores/user';
  import { syncStatus } from '$lib/stores/sync';
  import { upsertRecord } from '$lib/stores/sync';
  import db from '$lib/db/dexie';

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  let weights = $state<Array<{date: string; weight: number}>>([]);
  let weightInput = $state('');
  let savingWeight = $state(false);

  async function loadWeights() {
    if (!uid) return;
    const data = await db.table('weights')
      .where('user_id').equals(uid)
      .reverse().sortBy('date');
    weights = data.map((r: any) => ({ date: r.date?.slice(0,5), weight: r.weight }));
  }

  $effect(() => { if (uid) loadWeights(); });
  $effect(() => { if ($syncStatus === 'synced' && uid) loadWeights(); });

  async function saveWeight() {
    if (!uid || !weightInput) return;
    savingWeight = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: existing } = await (await import('$lib/db/client')).supabase
        .from('weights').select('id').eq('user_id', uid).eq('date', today).maybeSingle();
      await upsertRecord('weights', {
        id: existing?.id || undefined,
        user_id: uid, date: today,
        weight: parseFloat(weightInput),
        created_at: new Date().toISOString(),
      });
      weightInput = '';
      await loadWeights();
    } catch (e) { console.error('Weight save failed:', e);
    } finally { savingWeight = false; }
  }

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

  const recentWeight = $derived(weights.length > 0 ? weights[weights.length - 1].weight : null);
  const firstWeight = $derived(weights.length > 0 ? weights[0].weight : null);
  const kgLost = $derived(firstWeight && recentWeight ? (firstWeight - recentWeight).toFixed(1) : '--');
</script>

<div class="page-hd">Track</div>
<div class="page-sub">Weight, steps & body measurements</div>

<div class="srow">
  <div class="scard"><span class="sval">{kgLost}</span><span class="slbl">kg Lost</span></div>
  <div class="scard"><span class="sval">{recentWeight ?? '--'}</span><span class="slbl">kg Now</span></div>
  <div class="scard"><span class="sval">97</span><span class="slbl">kg Goal</span></div>
</div>

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
  <div class="card-lbl">Goal</div>
  <div style="font-size:13px;color:var(--muted);margin-bottom:6px">Target weight: <strong style="color:var(--amber)">97 kg</strong></div>
  <div class="pbar-wrap">
    <div class="pbar" style="width: {firstWeight && recentWeight ? Math.min(100, ((firstWeight - recentWeight) / (firstWeight - 97)) * 100) : 0}%"></div>
  </div>
  <div class="flex jb" style="font-size:11px;color:var(--muted);margin-top:2px">
    <span>{firstWeight ? firstWeight + 'kg' : 'Start'}</span>
    <span>97 kg goal</span>
  </div>
</div>
