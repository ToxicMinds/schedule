<script lang="ts">
  import { liveAlarms, liveWeights, liveLog, liveGoal } from '$lib/stores/live';
  import { upsertRecord, syncStatus } from '$lib/stores/sync';
  import { userId } from '$lib/stores/user';
  import db from '$lib/db/dexie';
  import { DEFAULT_CHECKS } from '$lib/data/checklist';
  import { GOAL_KG as DEFAULT_GOAL_KG } from '$lib/config';

  const dayIdx = new Date().getDay();
  const today = new Date().toISOString().slice(0, 10);
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const _alarms = liveAlarms();
  const _weights = liveWeights();
  const _todayLog = liveLog(today);
  const _goal = liveGoal();
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

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  let weight = $state('');
  let kcal = $state('');
  let steps = $state('');
  let saving = $state(false);
  let saveMsg = $state('');

  const firstWeight = $derived.by(() => {
    const w = $_weights;
    return w.length > 0 ? w[0].weight : null;
  });
  const recentWeight = $derived.by(() => {
    const w = $_weights;
    return w.length > 0 ? w[w.length - 1].weight : null;
  });
  const kgLost = $derived(firstWeight && recentWeight ? (firstWeight - recentWeight).toFixed(1) : '--');


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
    if (!uid) { saveMsg = 'Not signed in — please sign back in.'; return; }
    if (!weight && !kcal && !steps) { saveMsg = 'Enter at least one value first.'; return; }
    saving = true;
    saveMsg = '';
    try {
      if (weight) {
        const existing = await db.table('weights').where('[user_id+date]').equals([uid, today]).first();
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
      saveMsg = 'Saved ✓';
      setTimeout(() => { saveMsg = ''; }, 3000);
    } catch (e: any) {
      console.error('Log failed:', e);
      saveMsg = 'Save failed: ' + (e?.message || e?.error_description || String(e)).slice(0, 150);
    } finally {
      saving = false;
    }
  }

  const todayKcal = $derived($_todayLog?.kcal ?? null);
  const todaySteps = $derived($_todayLog?.steps ?? null);
  const todayWater = $derived($_todayLog?.water_glasses ?? 0);

  // — Evening checklist —
  let checks = $state<Array<{ id: string; text: string; done: boolean }>>([]);
  let newCheckText = $state('');
  let checksLoaded = $state(false);

  async function loadChecks() {
    if (!uid) return;
    const rows = await db.table('checks')
      .where('user_id').equals(uid)
      .and((r: any) => r.date === today)
      .toArray();

    if (rows.length === 0) {
      // Seed today's checklist from the defaults the first time it's opened today
      const seeded = DEFAULT_CHECKS.map((text) => ({
        id: crypto.randomUUID(), user_id: uid, date: today, text, done: false,
        created_at: new Date().toISOString(),
      }));
      for (const item of seeded) await upsertRecord('checks', item);
      checks = seeded.map((r) => ({ id: r.id, text: r.text, done: r.done }));
    } else {
      checks = rows
        .sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''))
        .map((r: any) => ({ id: r.id, text: r.text, done: r.done }));
    }
    checksLoaded = true;
  }

  $effect(() => { if (uid && !checksLoaded) loadChecks(); });
  $effect(() => { if ($syncStatus === 'synced' && uid && checksLoaded) loadChecks(); });

  async function toggleCheck(item: { id: string; text: string; done: boolean }) {
    const next = !item.done;
    checks = checks.map((c) => (c.id === item.id ? { ...c, done: next } : c));
    try {
      await upsertRecord('checks', {
        id: item.id, user_id: uid, date: today, text: item.text, done: next,
      });
    } catch (e) { console.error('Check toggle failed:', e); }
  }

  async function addCheck() {
    if (!uid || !newCheckText.trim()) return;
    const item = {
      id: crypto.randomUUID(), user_id: uid, date: today,
      text: newCheckText.trim(), done: false, created_at: new Date().toISOString(),
    };
    checks = [...checks, { id: item.id, text: item.text, done: item.done }];
    newCheckText = '';
    try { await upsertRecord('checks', item); }
    catch (e) { console.error('Add check failed:', e); }
  }

  async function removeCheck(item: { id: string; text: string; done: boolean }) {
    checks = checks.filter((c) => c.id !== item.id);
    try {
      await db.table('checks').delete([item.id, uid]);
      syncStatus.set('syncing');
      const { error } = await (await import('$lib/db/client')).supabase
        .from('checks').delete().eq('id', item.id).eq('user_id', uid);
      if (error) console.error('Check delete failed:', error);
      syncStatus.set('synced');
    } catch (e) { console.error('Check delete failed:', e); }
  }
</script>

<div class="page-hd">{greeting}</div>
<div class="page-sub">{dayName} &middot; {dateStr}</div>

<div class="srow">
  <div class="scard"><span class="sval">{kgLost}</span><span class="slbl">kg Lost</span></div>
  <div class="scard"><span class="sval">{recentWeight ?? '--'}</span><span class="slbl">kg Now</span></div>
  <div class="scard"><span class="sval">{weeksToGoal}</span><span class="slbl">{weeksToGoal === '--' ? 'Weeks to Goal' : 'Weeks to Goal'}</span></div>
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
  <button class="btn bp bfl" onclick={quickLog} disabled={saving}>{saving ? 'Saving…' : 'Save Today ✓'}</button>
  {#if saveMsg}
    <div style="font-size:12px;text-align:center;margin-top:6px;color:{saveMsg.startsWith('Saved') ? 'var(--green)' : 'var(--red)'}">{saveMsg}</div>
  {/if}
</div>

<div class="card">
  <div class="card-lbl">Evening Checklist</div>
  {#each checks as item}
    <div class="gi" style="padding:6px 0;cursor:pointer" onclick={() => toggleCheck(item)} role="button">
      <div class="gn" style="display:flex;align-items:center;gap:8px">
        <span style="width:18px;height:18px;border-radius:5px;border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;background:{item.done ? 'var(--green)' : 'transparent'};flex-shrink:0">
          {#if item.done}<span style="color:#0e1117;font-size:12px;font-weight:900">✓</span>{/if}
        </span>
        <span style="text-decoration:{item.done ? 'line-through' : 'none'};color:{item.done ? 'var(--muted)' : 'inherit'}">{item.text}</span>
      </div>
      <button class="icn-btn" style="width:24px;height:24px;font-size:11px" onclick={(e) => { e.stopPropagation(); removeCheck(item); }} title="Remove">✕</button>
    </div>
  {/each}
  {#if checks.length === 0}
    <div style="color:var(--muted);font-size:13px">No checklist items yet</div>
  {/if}
  <div class="flex gap2" style="margin-top:8px">
    <input type="text" bind:value={newCheckText} placeholder="Add an item..." style="flex:1" onkeydown={(e) => e.key === 'Enter' && addCheck()}>
    <button class="btn bg_ bsm" onclick={addCheck} disabled={!newCheckText.trim()}>Add</button>
  </div>
</div>
