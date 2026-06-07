<script lang="ts">
  import { liveAlarms, liveWeights, liveLog } from '$lib/stores/live';
  import { upsertRecord } from '$lib/stores/sync';
  import { userId } from '$lib/stores/user';

  const dayIdx = new Date().getDay();
  const today = new Date().toISOString().slice(0, 10);
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const _alarms = liveAlarms();
  const _weights = liveWeights();
  const _todayLog = liveLog(today);

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  let weight = $state('');
  let kcal = $state('');
  let steps = $state('');
  let saving = $state(false);

  const firstWeight = $derived.by(() => {
    const w = $_weights;
    return w.length > 0 ? w[0].weight : null;
  });
  const recentWeight = $derived.by(() => {
    const w = $_weights;
    return w.length > 0 ? w[w.length - 1].weight : null;
  });
  const kgLost = $derived(firstWeight && recentWeight ? (firstWeight - recentWeight).toFixed(1) : '--');

  const GOAL_KG = 97;

  function weeklyLoss(): number {
    const w = $_weights;
    if (w.length < 2) return 0;
    const last7 = w.filter((r: any) => {
      const daysAgo = (Date.now() - new Date(r.created_at || r.date).getTime()) / 86400000;
      return daysAgo <= 14;
    });
    if (last7.length < 2) return 0;
    const oldest = last7[0].weight;
    const newest = last7[last7.length - 1].weight;
    const diff = oldest - newest;
    const days = last7.length > 1 ? (new Date(last7[last7.length - 1].date).getTime() - new Date(last7[0].date).getTime()) / 86400000 : 1;
    return days > 0 ? (diff / days) * 7 : 0;
  }

  const weeksToGoal = $derived.by(() => {
    if (!recentWeight || recentWeight <= GOAL_KG) return 0;
    const wl = weeklyLoss();
    if (wl <= 0) return '--';
    return Math.ceil((recentWeight - GOAL_KG) / wl);
  });

  async function quickLog() {
    if (!uid) return;
    saving = true;
    try {
      if (weight) {
        const { data: existing } = await (await import('$lib/db/client')).supabase
          .from('weights').select('id').eq('user_id', uid).eq('date', today).maybeSingle();
        await upsertRecord('weights', {
          id: existing?.id || undefined,
          user_id: uid, date: today, weight: parseFloat(weight),
          created_at: new Date().toISOString(),
        });
      }
      if (kcal) {
        await upsertRecord('daily_logs', { user_id: uid, date: today, kcal: parseInt(kcal) });
      }
      if (steps) {
        await upsertRecord('steps', {
          user_id: uid, date: today, count: parseInt(steps),
          created_at: new Date().toISOString(),
        });
      }
      weight = ''; kcal = ''; steps = '';
    } catch (e) {
      console.error('Log failed:', e);
    } finally {
      saving = false;
    }
  }

  const todayKcal = $derived($_todayLog?.kcal ?? null);
  const todaySteps = $derived($_todayLog?.steps ?? null);
  const todayWater = $derived($_todayLog?.water_glasses ?? 0);
</script>

<div class="page-hd">{greeting}</div>
<div class="page-sub">{dayName} &middot; {dateStr}</div>

<div class="srow">
  <div class="scard"><span class="sval">{kgLost}</span><span class="slbl">kg Lost</span></div>
  <div class="scard"><span class="sval">{recentWeight ?? '--'}</span><span class="slbl">kg Now</span></div>
  <div class="scard"><span class="sval">{weeksToGoal}</span><span class="slbl">{weeksToGoal === '--' ? 'Weeks to Goal' : 'Weeks to Goal'}</span></div>
  <div class="scard"><span class="sval">{GOAL_KG}</span><span class="slbl">kg Goal</span></div>
</div>

{#if todayKcal !== null || todaySteps !== null}
  <div class="card">
    <div class="card-lbl">Today's Stats</div>
    <div class="flex gap2" style="font-size:13px">
      {#if todayKcal !== null}
        <div class="f1" style="background:var(--bg3);border-radius:8px;padding:8px;text-align:center">
          <div style="font-weight:700;color:var(--amber);font-size:18px">{todayKcal}</div>
          <div style="font-size:10px;color:var(--muted)">kcal</div>
        </div>
      {/if}
      {#if todaySteps !== null}
        <div class="f1" style="background:var(--bg3);border-radius:8px;padding:8px;text-align:center">
          <div style="font-weight:700;color:var(--green);font-size:18px">{todaySteps.toLocaleString()}</div>
          <div style="font-size:10px;color:var(--muted)">steps</div>
        </div>
      {/if}
      <div class="f1" style="background:var(--bg3);border-radius:8px;padding:8px;text-align:center">
        <div style="font-weight:700;color:var(--blue);font-size:18px">{todayWater}</div>
        <div style="font-size:10px;color:var(--muted)">water</div>
      </div>
    </div>
  </div>
{/if}

<div class="card">
  <div class="card-lbl">Today's Schedule</div>
  {#each $_alarms as alarm}
    {#if alarm.enabled && alarm.days?.includes(dayIdx)}
      <div class="gi" style="padding:5px 0">
        <div class="gn"><strong>{alarm.title}</strong></div>
        <div style="color:var(--amber);font-weight:600">{alarm.time}</div>
      </div>
      {#if alarm.message}
        <div style="font-size:12px;color:var(--muted);margin:-2px 0 4px 0">{alarm.message}</div>
      {/if}
    {/if}
  {/each}
  {#if $_alarms.length === 0}
    <div style="color:var(--muted);font-size:13px">No alarms for today</div>
  {/if}
</div>

<div class="card">
  <div class="card-lbl">Quick Log</div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="ql-weight">Weight (kg)</label>
      <input id="ql-weight" type="number" step="0.1" bind:value={weight} placeholder={recentWeight?.toString() || '116.0'} style="text-align:center">
    </div>
    <div class="f1">
      <label class="flbl" for="ql-kcal">Kcal</label>
      <input id="ql-kcal" type="number" bind:value={kcal} placeholder="2300" style="text-align:center">
    </div>
    <div class="f1">
      <label class="flbl" for="ql-steps">Steps</label>
      <input id="ql-steps" type="number" bind:value={steps} placeholder="9000" style="text-align:center">
    </div>
  </div>
  <button class="btn bp bfl" onclick={quickLog} disabled={saving}>Save Today ✓</button>
</div>
