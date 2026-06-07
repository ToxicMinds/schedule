<script lang="ts">
  import { liveAlarms } from '$lib/stores/live';
  import { upsertRecord } from '$lib/stores/sync';
  import { userId } from '$lib/stores/user';

  const dayIdx = new Date().getDay();
  const today = new Date().toISOString().slice(0, 10);
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const _alarms = liveAlarms();

  let weight = $state('');
  let kcal = $state('');
  let steps = $state('');
  let saving = $state(false);
  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  async function quickLog() {
    if (!uid) return;
    saving = true;
    try {
      const data: Record<string, any> = { user_id: uid, date: today };
      if (weight) data.weight = parseFloat(weight);
      if (kcal) data.kcal = parseInt(kcal);
      if (steps) data.steps = parseInt(steps);
      await upsertRecord('daily_logs', data);
      weight = ''; kcal = ''; steps = '';
    } catch (e) {
      console.error('Log failed:', e);
    } finally {
      saving = false;
    }
  }
</script>

<div class="page-hd">{greeting}</div>
<div class="page-sub">{dayName} &middot; {dateStr}</div>

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
      <input id="ql-weight" type="number" step="0.1" bind:value={weight} placeholder="116.0" style="text-align:center">
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

<div class="srow">
  <div class="scard"><span class="sval">17.5</span><span class="slbl">kg Lost</span></div>
  <div class="scard"><span class="sval">116</span><span class="slbl">kg Now</span></div>
  <div class="scard"><span class="sval">30</span><span class="slbl">Weeks to Goal</span></div>
  <div class="scard"><span class="sval">97</span><span class="slbl">kg Goal</span></div>
</div>
