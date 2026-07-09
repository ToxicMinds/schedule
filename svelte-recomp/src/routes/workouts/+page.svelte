<script lang="ts">
  import { buildGroups } from '$lib/data/workouts';
  import { DEFAULT_SCHEDULE, DEFAULT_SESSIONS, type PlanDay, type PlanSession, type PlanExercise } from '$lib/data/workoutPlanDefaults';
  import VideoEmbed from '$lib/components/VideoEmbed.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import ExerciseMedia from '$lib/components/ExerciseMedia.svelte';
  import { userId } from '$lib/stores/user';
  import { upsertRecord, syncStatus } from '$lib/stores/sync';
  import { liveSchedule, liveWorkoutSessions } from '$lib/stores/live';
  import db from '$lib/db/dexie';

  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  let sessionKey = $state<string | null>(null);
  let builderMode = $state(false);
  let selectedGroup = $state<string | null>(null);
  let weekOffset = $state(0);

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  // — Live, editable schedule + sessions (replaces the old hardcoded
  // workouts.ts constants). Auto-seeds the badminton-aware default plan
  // the first time a user opens this page with nothing saved yet, same
  // pattern used for seeding the evening checklist on the Today page.
  const _schedule = liveSchedule();
  const _sessions = liveWorkoutSessions();
  let seeded = $state(false);

  async function seedPlanIfEmpty() {
    if (!uid || seeded) return;
    const existingDays = await db.table('workout_schedule').where('user_id').equals(uid).count();
    if (existingDays === 0) {
      for (const s of DEFAULT_SESSIONS) {
        await upsertRecord('workout_sessions_custom', { user_id: uid, ...s, updated_at: new Date().toISOString() });
      }
      for (const d of DEFAULT_SCHEDULE) {
        await upsertRecord('workout_schedule', { user_id: uid, ...d, updated_at: new Date().toISOString() });
      }
    }
    seeded = true;
  }

  $effect(() => { if (uid) seedPlanIfEmpty(); });

  const schedule = $derived<PlanDay[]>($_schedule.length > 0 ? $_schedule : DEFAULT_SCHEDULE);
  const sessions = $derived<Map<string, PlanSession>>(
    $_sessions.size > 0 ? $_sessions : new Map(DEFAULT_SESSIONS.map((s) => [s.key, s]))
  );

  let completions = $state<Array<{ id: number; date: string; type: string }>>([]);
  let markingComplete = $state(false);

  async function loadCompletions() {
    if (!uid) return;
    const rows = await db.table('sessions').where('user_id').equals(uid).toArray();
    completions = rows
      .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 10);
  }

  $effect(() => { if (uid) loadCompletions(); });
  $effect(() => { if ($syncStatus === 'synced' && uid) loadCompletions(); });

  async function markComplete(key: string) {
    if (!uid) return;
    markingComplete = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      await upsertRecord('sessions', {
        user_id: uid, date: today, type: key,
        created_at: new Date().toISOString(),
      });
      await loadCompletions();
    } catch (e) { console.error('Mark complete failed:', e);
    } finally { markingComplete = false; }
  }

  function getWeekDates(offset: number, sched: PlanDay[]) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay() + 1 + offset * 7); // Monday of the target week
    // Build Mon->Sun order from the day_of_week-keyed schedule
    const byDow = new Map(sched.map((d) => [d.day_of_week, d]));
    const order = [1, 2, 3, 4, 5, 6, 0];
    return order.map((dow, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const entry = byDow.get(dow) || { day_of_week: dow, label: DAY_NAMES[dow], session_key: null, note: '' };
      return { ...entry, date: d, dayName: DAY_NAMES[dow] };
    });
  }

  const weekDays = $derived(getWeekDates(weekOffset, schedule));

  function closeModal() { sessionKey = null; }
  const modalOpen = $derived(sessionKey !== null);

  // — Editing: day schedule (label / note / which session) —
  let editingDow = $state<number | null>(null);
  let editLabel = $state('');
  let editNote = $state('');
  let editSessionKey = $state<string>('');

  function startEditDay(d: PlanDay) {
    editingDow = d.day_of_week;
    editLabel = d.label;
    editNote = d.note;
    editSessionKey = d.session_key || '';
  }

  async function saveEditDay() {
    if (editingDow === null || !uid) return;
    try {
      await upsertRecord('workout_schedule', {
        user_id: uid, day_of_week: editingDow,
        label: editLabel, note: editNote,
        session_key: editSessionKey || null,
        updated_at: new Date().toISOString(),
      });
      editingDow = null;
    } catch (e) { console.error('Day save failed:', e); }
  }

  // — Editing: session name/duration/focus + exercises —
  let editingSession = $state(false);

  async function saveSessionField(key: string, field: keyof PlanSession, value: string) {
    const sess = sessions.get(key);
    if (!sess || !uid) return;
    try {
      await upsertRecord('workout_sessions_custom', {
        user_id: uid, ...sess, [field]: value, updated_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Session save failed:', e); }
  }

  async function saveExerciseField(key: string, idx: number, field: keyof PlanExercise, value: string) {
    const sess = sessions.get(key);
    if (!sess || !uid) return;
    const exercises = sess.exercises.map((e, i) => i === idx ? { ...e, [field]: value } : e);
    try {
      await upsertRecord('workout_sessions_custom', {
        user_id: uid, ...sess, exercises, updated_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Exercise save failed:', e); }
  }

  async function removeExercise(key: string, idx: number) {
    const sess = sessions.get(key);
    if (!sess || !uid) return;
    const exercises = sess.exercises.filter((_, i) => i !== idx);
    try {
      await upsertRecord('workout_sessions_custom', {
        user_id: uid, ...sess, exercises, updated_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Exercise remove failed:', e); }
  }

  async function addExercise(key: string) {
    const sess = sessions.get(key);
    if (!sess || !uid) return;
    const exercises = [...sess.exercises, {
      phase: 'New Phase', name: 'New Exercise', muscle: '', w1: '3 × 10', w2: '3 × 10', rest: '60s', tip: ''
    }];
    try {
      await upsertRecord('workout_sessions_custom', {
        user_id: uid, ...sess, exercises, updated_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Exercise add failed:', e); }
  }
</script>

<div class="page-hd">Workouts</div>
<div class="page-sub">Gym · Badminton · Recovery</div>

<div class="week-tabs">
  <button class="wtab" class:on={weekOffset === 0} onclick={() => weekOffset = 0}>This Week</button>
  <button class="wtab" class:on={weekOffset === 1} onclick={() => weekOffset = 1}>Next Week</button>
</div>

{#each weekDays as day}
  <div class="card" style="padding:10px 12px">
    <div class="flex jb ac" style="margin-bottom:4px">
      <div style="font-size:12px;color:var(--muted);font-weight:600">{day.date.toLocaleDateString('en-US', { month:'short', day:'numeric' })}</div>
      <div class="flex ac gap2">
        <div style="font-size:12px;font-weight:700">{day.dayName}</div>
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <span style="cursor:pointer;color:var(--muted);font-size:13px" onclick={() => startEditDay(day)} role="button">✎</span>
      </div>
    </div>
    {#if editingDow === day.day_of_week}
      <div class="day-edit">
        <label class="flbl" for="edit-label-{day.day_of_week}">Label</label>
        <input id="edit-label-{day.day_of_week}" bind:value={editLabel} placeholder="e.g. Heavy Lower Body">
        <label class="flbl" for="edit-note-{day.day_of_week}">Note</label>
        <input id="edit-note-{day.day_of_week}" bind:value={editNote} placeholder="e.g. Badminton NTC 7-9pm">
        <label class="flbl" for="edit-sess-{day.day_of_week}">Session</label>
        <select id="edit-sess-{day.day_of_week}" bind:value={editSessionKey}>
          <option value="">— None (rest/cardio day) —</option>
          {#each [...sessions.entries()] as [k, s]}
            <option value={k}>{s.name}</option>
          {/each}
        </select>
        <div class="flex gap2" style="margin-top:6px">
          <button class="btn bp bsm" onclick={saveEditDay}>Save</button>
          <button class="btn bg_ bsm" onclick={() => editingDow = null}>Cancel</button>
        </div>
      </div>
    {:else if day.session_key && sessions.get(day.session_key)}
      <div style="font-size:13px;font-weight:600;color:var(--amber);margin-bottom:2px">{day.label}</div>
      <div style="font-size:11px;color:var(--muted)">{sessions.get(day.session_key)?.duration} &middot; {sessions.get(day.session_key)?.focus}</div>
      {#if day.note}<div style="font-size:11px;color:var(--muted);margin-top:2px">{day.note}</div>{/if}
    {:else}
      <div style="font-size:13px;font-weight:600">{day.label}</div>
      <div style="font-size:12px;color:var(--muted)">{day.note}</div>
    {/if}
  </div>
{/each}

<h3>Session Details</h3>
{#each [...sessions.entries()] as [key, sess]}
  <div class="card" style="padding:12px">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="flex jb ac" style="cursor:pointer" onclick={() => sessionKey = key}>
      <div>
        <div style="font-weight:700;color:#fff;font-size:15px">{sess.name}</div>
        <div style="font-size:11px;color:var(--muted)">{sess.duration} &middot; {sess.focus}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" stroke="var(--muted)" fill="none" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </div>
    <button class="btn bg_ bsm" style="margin-top:8px" onclick={() => markComplete(key)} disabled={markingComplete}>Mark Complete ✓</button>
  </div>
{/each}

{#if completions.length > 0}
  <h3>Recent Completions</h3>
  <div class="card">
    {#each completions as c}
      <div class="gi" style="padding:5px 0">
        <div class="gn">{sessions.get(c.type)?.name ?? c.type}</div>
        <div style="color:var(--muted);font-size:12px">{c.date}</div>
      </div>
    {/each}
  </div>
{/if}

<h3>Quick Builder</h3>
<button class="btn bg_ bfl" onclick={() => builderMode = !builderMode}>
  {builderMode ? 'Close Builder' : 'Build Custom Session'}
</button>

{#if builderMode}
  <div id="builder-muscles">
    {#each Object.entries(buildGroups) as [key, g]}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="muscle-btn" class:on={selectedGroup === key} onclick={() => selectedGroup = selectedGroup === key ? null : key}>
        <div class="muscle-icon">{g.icon}</div>
        <div class="muscle-name">{g.name}</div>
        <div class="muscle-count">{g.exercises.length} exercises</div>
      </div>
    {/each}
  </div>
  {#if selectedGroup && buildGroups[selectedGroup]}
    {#each buildGroups[selectedGroup].exercises as ex}
      <div class="ex-card">
        <div class="flex gap3">
          <ExerciseMedia name={ex.name} />
          <div class="f1">
            <div class="ex-name">{ex.name}</div>
            <div class="ex-muscle">{ex.muscle}</div>
            <div class="ex-sets-row">
              <div class="ex-set-box"><div class="label">Sets</div><div class="value">{ex.sets}</div></div>
              <div class="ex-set-box w2"><div class="label">Rest</div><div class="value">{ex.rest}</div></div>
            </div>
          </div>
        </div>
        {#if ex.tip}
          <div class="ex-tip">{ex.tip}</div>
        {/if}
        <VideoEmbed vid={ex.vid} />
      </div>
    {/each}
  {/if}
{/if}

{#if sessionKey && sessions.get(sessionKey)}
  {@const sess = sessions.get(sessionKey)}
  <Modal open={modalOpen} onclose={() => { sessionKey = null; editingSession = false; }}>
    {#if sess}
      <div class="flex jb ac" style="margin-bottom:4px">
        {#if editingSession}
          <input value={sess.name} onchange={(e) => saveSessionField(sessionKey, 'name', (e.target as HTMLInputElement).value)}
            style="font-size:16px;font-weight:700;background:transparent;border:1px solid var(--border2);border-radius:6px;color:#fff;padding:4px 6px;flex:1">
        {:else}
          <div style="font-size:18px;font-weight:700;color:#fff">{sess.name}</div>
        {/if}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <span style="cursor:pointer;color:var(--amber);font-size:13px;margin-left:8px" onclick={() => editingSession = !editingSession} role="button">
          {editingSession ? 'Done ✓' : 'Edit ✎'}
        </span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">{sess.duration}</div>
      <button class="btn bp bfl" style="margin-bottom:12px" onclick={() => sessionKey && markComplete(sessionKey)} disabled={markingComplete}>Mark Complete ✓</button>

      {#each sess.exercises as ex, i}
        {#if i === 0 || sess.exercises[i-1].phase !== ex.phase}
          <div class="phase-hd">{ex.phase}</div>
        {/if}
        <div class="ex-card" style="margin-bottom:10px;padding:12px">
          <div class="flex gap3">
            <ExerciseMedia name={ex.name} />
            <div class="f1">
              {#if editingSession}
                <input value={ex.name} onchange={(e) => saveExerciseField(sessionKey, i, 'name', (e.target as HTMLInputElement).value)}
                  style="font-size:14px;font-weight:700;background:transparent;border:1px solid var(--border2);border-radius:6px;color:#fff;padding:3px 5px;width:100%;margin-bottom:3px">
                <input value={ex.muscle} onchange={(e) => saveExerciseField(sessionKey, i, 'muscle', (e.target as HTMLInputElement).value)}
                  style="font-size:11px;background:transparent;border:1px solid var(--border2);border-radius:6px;color:var(--muted);padding:3px 5px;width:100%;margin-bottom:6px">
              {:else}
                <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:2px">{ex.name}</div>
                <div style="font-size:11px;color:var(--muted);margin-bottom:6px">{ex.muscle}</div>
              {/if}
              <div class="ex-sets-row">
                <div class="ex-set-box">
                  <div class="label">W1</div>
                  {#if editingSession}
                    <input value={ex.w1} onchange={(e) => saveExerciseField(sessionKey, i, 'w1', (e.target as HTMLInputElement).value)} class="value-input">
                  {:else}<div class="value">{ex.w1}</div>{/if}
                </div>
                <div class="ex-set-box">
                  <div class="label">W2</div>
                  {#if editingSession}
                    <input value={ex.w2} onchange={(e) => saveExerciseField(sessionKey, i, 'w2', (e.target as HTMLInputElement).value)} class="value-input">
                  {:else}<div class="value">{ex.w2}</div>{/if}
                </div>
                <div class="ex-set-box">
                  <div class="label">Rest</div>
                  {#if editingSession}
                    <input value={ex.rest} onchange={(e) => saveExerciseField(sessionKey, i, 'rest', (e.target as HTMLInputElement).value)} class="value-input">
                  {:else}<div class="value">{ex.rest}</div>{/if}
                </div>
              </div>
            </div>
          </div>
          {#if editingSession}
            <textarea value={ex.tip} onchange={(e) => saveExerciseField(sessionKey, i, 'tip', (e.target as HTMLTextAreaElement).value)}
              class="tip-input" rows="2"></textarea>
            <button class="btn bd bsm" style="margin-top:6px" onclick={() => removeExercise(sessionKey, i)}>Remove exercise</button>
          {:else}
            <div class="ex-tip">{ex.tip}</div>
          {/if}
          <VideoEmbed vid={ex.vid} />
        </div>
      {/each}
      {#if editingSession}
        <button class="btn bg_ bfl" onclick={() => addExercise(sessionKey)}>+ Add exercise</button>
      {/if}
    {/if}
  </Modal>
{/if}

<style>
  #builder-muscles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
  .muscle-btn{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;padding:18px 12px;border:1px solid var(--border);background:var(--bg2);border-radius:12px;cursor:pointer;transition:all .15s}
  .muscle-btn:active{border-color:var(--amber)}
  .muscle-btn.on{border-color:var(--green);background:var(--gb)}
  .muscle-icon{font-size:32px}
  .muscle-name{font-size:14px;font-weight:700;color:#fff}
  .muscle-count{font-size:11px;color:var(--muted)}

  .day-edit{display:flex;flex-direction:column;gap:2px;margin-top:4px}
  .day-edit input,.day-edit select{background:var(--bg3);border:1px solid var(--border2);border-radius:8px;color:#fff;padding:6px 8px;font-size:13px;margin-bottom:6px}

  .phase-hd{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--amber);margin:14px 0 6px 2px}

  .value-input{width:100%;text-align:center;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;color:#fff;font-size:12px;font-weight:700;padding:3px}
  .tip-input{width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;color:var(--text);font-size:12px;padding:6px 8px;margin-top:8px;resize:vertical}
</style>
