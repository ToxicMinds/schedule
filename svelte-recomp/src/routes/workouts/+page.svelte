<script lang="ts">
  import { buildGroups } from '$lib/data/workouts';
  import { DEFAULT_SCHEDULE, DEFAULT_SESSIONS, type PlanDay, type PlanSession, type PlanExercise } from '$lib/data/workoutPlanDefaults';
  import VideoEmbed from '$lib/components/VideoEmbed.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import ExerciseMedia from '$lib/components/ExerciseMedia.svelte';
  import { userId } from '$lib/stores/user';
  import { upsertRecord, syncStatus } from '$lib/stores/sync';
  import { liveSchedule, liveWorkoutSessions, liveWorkoutLogs } from '$lib/stores/live';
  import type { WorkoutSet } from '$lib/db/dexie';
  import db from '$lib/db/dexie';
  import MiniChart from '$lib/components/MiniChart.svelte';
  import PlateWarmupCalc from '$lib/components/PlateWarmupCalc.svelte';

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

  // — Workout logging: actual weight × reps performed per set, per
  // exercise, per day. Powers "last time" progressive-overload prompts
  // and a running tonnage (volume) total for today's session.
  const _logs = liveWorkoutLogs();
  const today = new Date().toISOString().slice(0, 10);

  function lastLogFor(name: string) {
    const rows = $_logs.filter((r: any) => r.exercise_name === name && r.date < today);
    if (rows.length === 0) return null;
    return rows.reduce((a: any, b: any) => (a.date > b.date ? a : b));
  }

  function todayLogFor(name: string) {
    return $_logs.find((r: any) => r.exercise_name === name && r.date === today) || null;
  }

  function parseSetsCount(w1: string): number {
    const m = /^(\d+)/.exec(w1 || '');
    return m ? parseInt(m[1], 10) : 3;
  }

  let expandedLog = $state<Set<string>>(new Set());
  let logDrafts = $state<Record<string, WorkoutSet[]>>({});
  let logSavedMsg = $state<Record<string, string>>({});

  function fmtSets(sets: WorkoutSet[]): string {
    const parts = sets
      .filter((s) => s.reps != null || s.weight_kg != null)
      .map((s) => `${s.reps ?? '–'}×${s.weight_kg ?? '–'}kg`);
    return parts.length ? parts.join(' · ') : '—';
  }

  function toggleLog(ex: PlanExercise) {
    const set = new Set(expandedLog);
    if (set.has(ex.name)) {
      set.delete(ex.name);
    } else {
      set.add(ex.name);
      if (!logDrafts[ex.name]) {
        const t = todayLogFor(ex.name);
        const last = lastLogFor(ex.name);
        const count = parseSetsCount(ex.w1);
        let seed: WorkoutSet[];
        if (t) seed = t.sets.map((s: WorkoutSet) => ({ ...s }));
        else if (last) seed = last.sets.map((s: WorkoutSet) => ({ ...s })); // start from last time's numbers
        else seed = Array.from({ length: count }, () => ({ reps: null, weight_kg: null }));
        logDrafts = { ...logDrafts, [ex.name]: seed };
      }
    }
    expandedLog = set;
  }

  function updateSetField(name: string, idx: number, field: 'reps' | 'weight_kg', raw: string) {
    const val = raw === '' ? null : Number(raw);
    const sets = logDrafts[name].map((s, i) => (i === idx ? { ...s, [field]: val } : s));
    logDrafts = { ...logDrafts, [name]: sets };
  }

  function addSetRow(name: string) {
    logDrafts = { ...logDrafts, [name]: [...logDrafts[name], { reps: null, weight_kg: null }] };
  }

  function removeSetRow(name: string, idx: number) {
    logDrafts = { ...logDrafts, [name]: logDrafts[name].filter((_, i) => i !== idx) };
  }

  async function saveLog(ex: PlanExercise) {
    if (!uid) return;
    const sets = (logDrafts[ex.name] || []).filter((s) => s.reps != null || s.weight_kg != null);
    try {
      await upsertRecord('workout_logs', {
        user_id: uid, date: today, exercise_name: ex.name,
        session_key: sessionKey, sets, updated_at: new Date().toISOString(),
      });
      logSavedMsg = { ...logSavedMsg, [ex.name]: 'Logged ✓' };
      setTimeout(() => { const m = { ...logSavedMsg }; delete m[ex.name]; logSavedMsg = m; }, 2500);
    } catch (e: any) {
      logSavedMsg = { ...logSavedMsg, [ex.name]: `Error: ${e?.message || e}` };
    }
  }

  // Today's total tonnage (Σ weight × reps across every logged set today),
  // shown as a running badge in the open session modal.
  const todayVolume = $derived(
    $_logs
      .filter((r: any) => r.date === today)
      .reduce((sum: number, r: any) => sum + r.sets.reduce((s: number, set: WorkoutSet) => s + (set.reps || 0) * (set.weight_kg || 0), 0), 0)
  );

  // — Personal records + per-exercise progress chart —
  // Epley formula estimated 1RM: weight × (1 + reps/30). Used to compare
  // sets of different rep ranges on a level footing for "best ever".
  function estOneRM(reps: number, weight: number): number {
    return weight * (1 + reps / 30);
  }

  function bestSetOf(sets: WorkoutSet[]): { reps: number; weight_kg: number; oneRM: number } | null {
    const valid = sets.filter((s) => s.reps != null && s.weight_kg != null) as Array<{ reps: number; weight_kg: number }>;
    if (valid.length === 0) return null;
    return valid.reduce((best, s) => {
      const rm = estOneRM(s.reps, s.weight_kg);
      return rm > estOneRM(best.reps, best.weight_kg) ? { ...s, oneRM: rm } : { ...best, oneRM: estOneRM(best.reps, best.weight_kg) };
    }, { ...valid[0], oneRM: estOneRM(valid[0].reps, valid[0].weight_kg) });
  }

  function historyFor(name: string) {
    return $_logs
      .filter((r: any) => r.exercise_name === name)
      .map((r: any) => ({ date: r.date, best: bestSetOf(r.sets) }))
      .filter((r: any) => r.best)
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
  }

  function personalRecord(name: string) {
    const hist = historyFor(name);
    if (hist.length === 0) return null;
    return hist.reduce((pr: any, h: any) => (h.best.oneRM > pr.best.oneRM ? h : pr));
  }

  // — Auto-progression suggestion (Fitbod/Strong-style) —
  // Rule-based, no ML: parse the exercise's target rep range from its w1
  // field (e.g. "4 × 6-8" -> min 6, max 8). Compare every set from the
  // most recent logged session against that range:
  //   - every set met/beat the TOP of the range -> suggest weight up
  //   - every set met at least the BOTTOM of the range -> hold weight,
  //     push for more reps
  //   - any set fell more than 2 reps short of the bottom (a near-miss/
  //     failure signal) -> suggest a 10% deload
  // This mirrors the well-established progressive-overload heuristic
  // used by Fitbod/Strong, without needing any external ML service.
  function parseRepRange(w1: string): { min: number; max: number } | null {
    const m = /(\d+)\s*-\s*(\d+)/.exec(w1 || '');
    if (m) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
    const single = /×\s*(\d+)/.exec(w1 || '') || /x\s*(\d+)/i.exec(w1 || '');
    if (single) return { min: parseInt(single[1], 10), max: parseInt(single[1], 10) };
    return null;
  }

  interface ProgressionSuggestion { type: 'up' | 'hold' | 'deload'; text: string; }

  function progressionSuggestion(ex: PlanExercise): ProgressionSuggestion | null {
    const last = lastLogFor(ex.name);
    if (!last) return null;
    const sets = last.sets.filter((s: WorkoutSet) => s.reps != null && s.weight_kg != null) as Array<{ reps: number; weight_kg: number }>;
    if (sets.length === 0) return null;
    const range = parseRepRange(ex.w1);
    if (!range) return null;

    const topWeight = Math.max(...sets.map((s) => s.weight_kg));
    const allHitTop = sets.every((s) => s.reps >= range.max);
    const allHitBottom = sets.every((s) => s.reps >= range.min);
    const anyBigMiss = sets.some((s) => s.reps <= range.min - 3);

    if (anyBigMiss) {
      const deload = Math.round((topWeight * 0.9) / 2.5) * 2.5;
      return { type: 'deload', text: `Missed reps badly last time — try ${deload}kg to reset, then build back up.` };
    }
    if (allHitTop) {
      // Simple flat bump rather than rounding to a fixed plate increment
      // (rounding could actually undershoot the current weight for
      // lighter dumbbell/kettlebell loads, e.g. 28kg + 1.25 rounding down
      // to 28.75 -- barely a jump at all). A straightforward +2.5kg for
      // bar work / +1kg for lighter loads reads clearly and is always a
      // genuine increase over last time.
      const bump = topWeight >= 60 ? 2.5 : 1;
      const next = Math.round((topWeight + bump) * 10) / 10;
      return { type: 'up', text: `Hit the top of your rep range — try ${next}kg next time.` };
    }
    if (allHitBottom) {
      return { type: 'hold', text: `Same weight (${topWeight}kg) — aim for ${range.max} reps this time.` };
    }
    return { type: 'hold', text: `Stick with ${topWeight}kg and focus on clean reps.` };
  }

  let expandedHistory = $state<Set<string>>(new Set());
  function toggleHistory(name: string) {
    const set = new Set(expandedHistory);
    set.has(name) ? set.delete(name) : set.add(name);
    expandedHistory = set;
  }

  // — Rest timer —
  // Parses e.g. "120-150s" or "60s" or "2 min" into a starting seconds
  // count; runs a simple countdown with a vibration + chime on completion.
  let restTimer = $state<{ name: string; remaining: number; total: number } | null>(null);
  let restInterval: ReturnType<typeof setInterval> | null = null;

  function parseRestSeconds(rest: string): number {
    const s = (rest || '').toLowerCase();
    const rangeMatch = /(\d+)\s*-\s*(\d+)/.exec(s);
    if (rangeMatch) return parseInt(rangeMatch[2], 10);
    const minMatch = /(\d+)\s*min/.exec(s);
    if (minMatch) return parseInt(minMatch[1], 10) * 60;
    const secMatch = /(\d+)\s*s/.exec(s);
    if (secMatch) return parseInt(secMatch[1], 10);
    return 60;
  }

  function startRestTimer(ex: PlanExercise) {
    if (restInterval) clearInterval(restInterval);
    const total = parseRestSeconds(ex.rest);
    restTimer = { name: ex.name, remaining: total, total };
    restInterval = setInterval(() => {
      if (!restTimer) return;
      const remaining = restTimer.remaining - 1;
      if (remaining <= 0) {
        if (restInterval) clearInterval(restInterval);
        restInterval = null;
        restTimer = { ...restTimer, remaining: 0 };
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([200, 100, 200]);
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          osc.frequency.value = 880;
          osc.connect(ctx.destination);
          osc.start();
          setTimeout(() => osc.stop(), 300);
        } catch {}
        setTimeout(() => { restTimer = null; }, 3000);
      } else {
        restTimer = { ...restTimer, remaining };
      }
    }, 1000);
  }

  function cancelRestTimer() {
    if (restInterval) clearInterval(restInterval);
    restInterval = null;
    restTimer = null;
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
      {#if todayVolume > 0}
        <div class="vol-badge">Today's volume: <b>{todayVolume.toLocaleString()} kg</b> lifted</div>
      {/if}
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

          {#if !editingSession}
            {@const last = lastLogFor(ex.name)}
            {@const pr = personalRecord(ex.name)}
            {@const suggestion = progressionSuggestion(ex)}
            <div class="log-row">
              <div class="last-perf">
                {#if last}Last time ({last.date}): {fmtSets(last.sets)}{:else}No history yet{/if}
              </div>
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <span class="log-toggle" onclick={() => toggleLog(ex)} role="button">
                {expandedLog.has(ex.name) ? 'Hide log' : 'Log sets ✎'}
              </span>
            </div>
            {#if suggestion}
              <div class="suggestion-badge" class:up={suggestion.type === 'up'} class:deload={suggestion.type === 'deload'}>
                {suggestion.type === 'up' ? '📈' : suggestion.type === 'deload' ? '⚠️' : '➡️'} {suggestion.text}
              </div>
            {/if}
            {#if pr}
              <div class="pr-row">
                <span class="pr-badge">🏆 PR: {pr.best.weight_kg}kg × {pr.best.reps} <span class="pr-date">({pr.date})</span></span>
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <span class="log-toggle" onclick={() => toggleHistory(ex.name)} role="button">
                  {expandedHistory.has(ex.name) ? 'Hide chart' : 'Progress 📈'}
                </span>
              </div>
            {/if}
            {#if expandedHistory.has(ex.name)}
              {@const hist = historyFor(ex.name)}
              <div class="history-chart">
                <MiniChart data={hist.map((h) => ({ date: h.date, value: h.best.oneRM }))} color="var(--green, #2ecc71)" />
                <div class="hc-label">Estimated 1-rep max over time (Epley formula)</div>
              </div>
            {/if}
            {#if expandedLog.has(ex.name)}
              {@const last = lastLogFor(ex.name)}
              {@const bestSet = last ? bestSetOf(last.sets) : null}
              <div class="log-form">
                {#each logDrafts[ex.name] || [] as set, si}
                  <div class="log-set-row">
                    <span class="set-idx">Set {si + 1}</span>
                    <input type="number" inputmode="decimal" placeholder="kg" value={set.weight_kg ?? ''}
                      onchange={(e) => updateSetField(ex.name, si, 'weight_kg', (e.target as HTMLInputElement).value)} />
                    <span class="x">×</span>
                    <input type="number" inputmode="numeric" placeholder="reps" value={set.reps ?? ''}
                      onchange={(e) => updateSetField(ex.name, si, 'reps', (e.target as HTMLInputElement).value)} />
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <span class="rm-set" onclick={() => removeSetRow(ex.name, si)} role="button">✕</span>
                  </div>
                {/each}
                <div class="flex gap2" style="margin-top:6px">
                  <button class="btn bg_ bsm" onclick={() => addSetRow(ex.name)}>+ Set</button>
                  <button class="btn bg_ bsm" onclick={() => startRestTimer(ex)}>⏱ Rest {parseRestSeconds(ex.rest)}s</button>
                  <button class="btn bp bsm" onclick={() => saveLog(ex)}>Save log</button>
                </div>
                {#if logSavedMsg[ex.name]}
                  <div class="log-msg" class:err={logSavedMsg[ex.name].startsWith('Error')}>{logSavedMsg[ex.name]}</div>
                {/if}
                <PlateWarmupCalc targetKg={bestSet?.weight_kg ?? 40} />
              </div>
            {/if}
          {/if}
        </div>
      {/each}
      {#if editingSession}
        <button class="btn bg_ bfl" onclick={() => addExercise(sessionKey)}>+ Add exercise</button>
      {/if}
    {/if}
  </Modal>
{/if}

{#if restTimer}
  <div class="rest-widget">
    <div class="rest-name">Resting: {restTimer.name}</div>
    <div class="rest-count">{restTimer.remaining}s</div>
    <div class="rest-bar-track"><div class="rest-bar-fill" style="width:{(1 - restTimer.remaining / restTimer.total) * 100}%"></div></div>
    <button class="btn bg_ bsm" onclick={cancelRestTimer}>Cancel</button>
  </div>
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
  .day-edit input,.day-edit select{background:var(--bg3);border:1px solid var(--border2);border-radius:8px;color:#fff;padding:6px 8px;font-size:16px;margin-bottom:6px}

  .phase-hd{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--amber);margin:14px 0 6px 2px}

  .value-input{width:100%;text-align:center;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;color:#fff;font-size:16px;font-weight:700;padding:3px}
  .tip-input{width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;color:var(--text);font-size:16px;padding:6px 8px;margin-top:8px;resize:vertical}

  .vol-badge{font-size:12px;color:var(--green,#2ecc71);background:var(--gb,rgba(46,204,113,.1));border-radius:8px;padding:6px 10px;margin-bottom:10px}
  .log-row{display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px}
  .last-perf{font-size:11px;color:var(--muted);flex:1}
  .log-toggle{font-size:11px;font-weight:700;color:var(--amber);cursor:pointer;white-space:nowrap}
  .log-form{margin-top:8px;padding:8px;background:var(--bg3);border-radius:8px}
  .log-set-row{display:flex;align-items:center;gap:6px;margin-bottom:6px}
  .log-set-row .set-idx{font-size:11px;color:var(--muted);width:44px;flex-shrink:0}
  .log-set-row input{width:100%;background:var(--bg2);border:1px solid var(--border2);border-radius:6px;color:#fff;font-size:16px;padding:4px 6px;text-align:center}
  .log-set-row .x{color:var(--muted);font-size:11px}
  .log-set-row .rm-set{color:var(--muted);cursor:pointer;font-size:12px;padding:0 2px}
  .log-msg{font-size:11px;color:var(--green,#2ecc71);margin-top:6px}
  .log-msg.err{color:#ff6b6b}

  .pr-row{display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:8px}
  .pr-badge{font-size:11px;font-weight:700;color:#ffd166;background:rgba(255,209,102,.1);border-radius:8px;padding:4px 8px}
  .suggestion-badge{font-size:12px;font-weight:600;color:var(--blue);background:rgba(96,165,250,.1);border-radius:8px;padding:6px 9px;margin-top:6px;line-height:1.4}
  .suggestion-badge.up{color:var(--green,#2ecc71);background:rgba(46,204,113,.1)}
  .suggestion-badge.deload{color:#ff6b6b;background:rgba(255,107,107,.1)}
  .pr-date{font-weight:400;color:var(--muted)}
  .history-chart{margin-top:8px;padding:8px;background:var(--bg3);border-radius:8px}
  .hc-label{font-size:10px;color:var(--muted);text-align:center;margin-top:2px}

  .rest-widget{position:fixed;left:16px;right:16px;bottom:calc(70px + var(--sb));background:var(--bg2);border:1px solid var(--amber);border-radius:14px;padding:12px 14px;box-shadow:var(--shadow-md);z-index:260;display:flex;align-items:center;gap:10px}
  .rest-name{font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rest-count{font-size:20px;font-weight:800;color:var(--amber);min-width:44px;text-align:center}
  .rest-bar-track{position:absolute;left:0;bottom:0;height:3px;width:100%;background:var(--border2);border-radius:0 0 14px 14px;overflow:hidden}
  .rest-bar-fill{height:100%;background:var(--amber);transition:width 1s linear}
</style>
