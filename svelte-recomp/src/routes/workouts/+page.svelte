<script lang="ts">
  import { buildGroups } from '$lib/data/workouts';
  import { DEFAULT_SCHEDULE, DEFAULT_SESSIONS, type PlanDay, type PlanSession, type PlanExercise } from '$lib/data/workoutPlanDefaults';
  import VideoEmbed from '$lib/components/VideoEmbed.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import ExerciseMedia from '$lib/components/ExerciseMedia.svelte';
  import { userId } from '$lib/stores/user';
  import { upsertRecord, syncStatus } from '$lib/stores/sync';
  import { liveSchedule, liveWorkoutSessions, liveWorkoutLogs, liveSessionCompletions, liveGoalReason } from '$lib/stores/live';
  import type { WorkoutSet } from '$lib/db/dexie';
  import db from '$lib/db/dexie';
  import MiniChart from '$lib/components/MiniChart.svelte';
  import PlateWarmupCalc from '$lib/components/PlateWarmupCalc.svelte';
  import { sessionLoad, acuteChronicRatio, MUSCLE_RECOVERY_HOURS, recoveryState, exerciseModifier } from '$lib/readiness';
  import type { RecoveryStatus } from '$lib/readiness';
  import { syncAutoAlarms } from '$lib/autoAlarms';

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
  const _goalReason = liveGoalReason();
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

  const _completions = liveSessionCompletions();
  let completions = $derived([...$_completions]);

  // Auto-alarm sync is a deliberate, user-triggered action ONLY -- it
  // used to run automatically from a reactive $effect keyed on the
  // schedule, but that guard (a plain local variable) got reset every
  // time this page component remounted (e.g. navigating away and back),
  // so it silently re-ran and recreated alarms the user had just
  // manually deleted. Never again: this now only runs when explicitly
  // tapped.
  let syncingAlarms = $state(false);
  let alarmSyncMsg = $state('');
  async function syncAlarmsNow() {
    if (!uid) return;
    syncingAlarms = true;
    alarmSyncMsg = '';
    try {
      const count = await syncAutoAlarms(uid, schedule);
      alarmSyncMsg = `Synced ${count} alarm${count === 1 ? '' : 's'} ✓`;
      setTimeout(() => alarmSyncMsg = '', 4000);
    } catch (e: any) {
      alarmSyncMsg = 'Sync failed: ' + (e?.message || String(e));
    } finally {
      syncingAlarms = false;
    }
  }
  let markingComplete = $state(false);

  async function markComplete(key: string) {
    if (!uid) return;
    markingComplete = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      await upsertRecord('sessions', {
        user_id: uid, date: today, type: key,
        created_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Mark complete failed:', e);
    } finally { markingComplete = false; }
  }

  // Rolling 7-day window starting from TODAY (not calendar Monday) --
  // e.g. if today is Thursday, shows Thu→Wed instead of jumping back to
  // Monday of the current calendar week and including already-past days.
  function getWeekDates(offset: number, sched: PlanDay[]) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() + offset * 7);
    const byDow = new Map(sched.map((d) => [d.day_of_week, d]));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dow = d.getDay();
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

  // — Muscle recovery grid (Fitbod-style) —
  // Canonical muscle groups we track; every exercise's free-text "muscle"
  // field (e.g. "Quads · Glutes") is matched against these via substring
  // search to attribute logged sets to the right group(s).
  const MUSCLE_GROUPS = ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Core'];

  function groupsFor(muscleText: string): string[] {
    const text = (muscleText || '').toLowerCase();
    return MUSCLE_GROUPS.filter((g) => text.includes(g.toLowerCase()));
  }

  // Map every known exercise name -> its muscle text, built from all
  // sessions currently loaded (covers both default + user-edited plans).
  const exerciseMuscleMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const sess of sessions.values()) {
      for (const ex of sess.exercises) map.set(ex.name, ex.muscle);
    }
    return map;
  });

  interface MuscleExerciseHit { name: string; date: string; hoursAgo: number; sets: number }
  interface MuscleStatus {
    group: string; lastDate: string | null; hoursAgo: number | null;
    windowH: number; pct: number; readyInH: number;
    status: RecoveryStatus; exercises: MuscleExerciseHit[];
  }

  // Best available timestamp for WHEN a muscle was actually worked. Prefer
  // the log's real time (updated_at/created_at) so an evening session isn't
  // mis-counted as noon; fall back to midday of the log date only if no
  // timestamp exists. This was the core recovery bug: assuming every
  // workout happened at 12:00 inflated "hours ago" and kept muscles stuck
  // on "recovering".
  function logTimeMs(log: any): number {
    const iso = log.updated_at || log.created_at;
    if (iso) { const t = new Date(iso).getTime(); if (!isNaN(t)) return t; }
    return new Date(log.date + 'T12:00:00').getTime();
  }

  const muscleRecovery = $derived.by((): MuscleStatus[] => {
    const nowMs = Date.now();
    const lastMs = new Map<string, number>();       // group -> most recent train time
    const lastDate = new Map<string, string>();     // group -> date string
    const hits = new Map<string, MuscleExerciseHit[]>(); // group -> recent exercise hits (7d)

    for (const log of $_logs) {
      const muscleText = exerciseMuscleMap.get(log.exercise_name);
      if (!muscleText) continue;
      const tMs = logTimeMs(log);
      const hoursAgo = (nowMs - tMs) / 36e5;
      for (const g of groupsFor(muscleText)) {
        const prev = lastMs.get(g);
        if (prev == null || tMs > prev) { lastMs.set(g, tMs); lastDate.set(g, log.date); }
        if (hoursAgo <= 24 * 7) {
          const arr = hits.get(g) ?? [];
          arr.push({ name: log.exercise_name, date: log.date, hoursAgo, sets: log.sets?.length ?? 0 });
          hits.set(g, arr);
        }
      }
    }

    return MUSCLE_GROUPS.map((group) => {
      const base = MUSCLE_RECOVERY_HOURS[group] ?? 48;
      const tMs = lastMs.get(group);
      if (tMs == null) return { group, lastDate: null, hoursAgo: null, windowH: base, pct: 0, readyInH: 0, status: 'none' as const, exercises: [] };
      const hoursAgo = (nowMs - tMs) / 36e5;
      const exercises = (hits.get(group) ?? []).sort((a, b) => a.hoursAgo - b.hoursAgo);
      // Window scales with the MOST damaging exercise from the latest session
      // that hit this muscle: an RDL stretches the window, a leg extension
      // shortens it. (Falls back to base if the last hit is >7d old.)
      const latestDate = lastDate.get(group);
      const sameDayMods = exercises.filter((e) => e.date === latestDate).map((e) => exerciseModifier(e.name));
      const modifier = sameDayMods.length ? Math.max(...sameDayMods) : 1.0;
      const windowH = Math.round(base * modifier);
      const { status, pct, readyInH } = recoveryState(hoursAgo, windowH);
      return { group, lastDate: lastDate.get(group) ?? null, hoursAgo, windowH, pct, readyInH, status, exercises };
    });
  });

  let recoveryFlipped = $state(false);
  let recFrontH = $state(0);
  let recBackH = $state(0);
  // Short human phrase for a muscle's recovery: "Ready", "Ready in ~Xh",
  // or "Rest — Xh left" so the grid explains itself.
  function recoveryPhrase(m: MuscleStatus): string {
    if (m.status === 'none') return 'No data';
    if (m.status === 'ready') return 'Ready';
    if (m.readyInH >= 24) return `~${(m.readyInH / 24).toFixed(1)}d to go`;
    return `~${m.readyInH}h to go`;
  }
  function hoursAgoPhrase(h: number | null): string {
    if (h == null) return '—';
    if (h < 1) return 'just now';
    if (h < 24) return `${Math.round(h)}h ago`;
    return `${(h / 24).toFixed(1)}d ago`;
  }

  // — Training load balance (WHOOP-style acute:chronic ratio) —
  // Uses the validated session-RPE method (Foster et al. 2001): training
  // load = total sets logged that day × ~3 min/set × an assumed RPE of 7
  // (a reasonable default for logged working sets; we don't currently
  // capture subjective RPE per session). Compares the last 7 days'
  // average daily load to the last 28 days' -- a ratio consistently
  // above ~1.5 is a well-documented injury-risk signal in sports science.
  const trainingLoad = $derived.by(() => {
    const byDate = new Map<string, number>();
    for (const log of $_logs) {
      byDate.set(log.date, (byDate.get(log.date) ?? 0) + log.sets.length);
    }
    const loads = [...byDate.entries()].map(([date, setCount]) => ({ date, loadAU: sessionLoad(setCount, 7) }));
    return acuteChronicRatio(loads, today);
  });

  // — Insights & inspiration from the workout history —
  // The log already captures every set; this turns that raw history into a
  // few plain-language takeaways (volume trend, recent PRs, a neglected
  // muscle, training frequency) that feed straight back into the goal:
  // preserving/adding lean mass while dieting.
  let showInsights = $state(false);
  let showLoadHelp = $state(false);
  const historyInsights = $derived.by(() => {
    const logs = $_logs;
    if (!logs || logs.length === 0) return null;
    const nowMs = Date.now();
    const dayMs = 86400000;
    const tonnageOf = (log: any) => (log.sets || []).reduce((s: number, x: WorkoutSet) => s + (x.reps || 0) * (x.weight_kg || 0), 0);

    const dates = new Set(logs.map((l: any) => l.date));
    let totalTonnage = 0, totalSets = 0, vol7 = 0, volPrev7 = 0;
    const sessionDays14 = new Set<string>();
    const muscleSets14 = new Map<string, number>();

    for (const log of logs) {
      const tn = tonnageOf(log);
      totalTonnage += tn; totalSets += (log.sets?.length || 0);
      const ageDays = (nowMs - logTimeMs(log)) / dayMs;
      if (ageDays <= 7) vol7 += tn;
      else if (ageDays <= 14) volPrev7 += tn;
      if (ageDays <= 14) {
        sessionDays14.add(log.date);
        const mt = exerciseMuscleMap.get(log.exercise_name);
        if (mt) for (const g of groupsFor(mt)) muscleSets14.set(g, (muscleSets14.get(g) || 0) + (log.sets?.length || 0));
      }
    }
    const volDeltaPct = volPrev7 > 0 ? Math.round(((vol7 - volPrev7) / volPrev7) * 100) : null;
    const perWeek = Math.round((sessionDays14.size / 2) * 10) / 10;

    const exNames = [...new Set(logs.map((l: any) => l.exercise_name))];
    const recentPRs: Array<{ name: string; date: string; oneRM: number; weight_kg: number; reps: number }> = [];
    for (const name of exNames) {
      const pr = personalRecord(name);
      if (!pr) continue;
      const ageDays = (nowMs - new Date(pr.date + 'T12:00:00').getTime()) / dayMs;
      if (ageDays <= 14) recentPRs.push({ name, date: pr.date, oneRM: pr.best.oneRM, weight_kg: pr.best.weight_kg, reps: pr.best.reps });
    }
    recentPRs.sort((a, b) => b.oneRM - a.oneRM);

    const neglected = muscleRecovery
      .filter((m) => m.status === 'none' || (m.hoursAgo != null && m.hoursAgo > m.windowH * 1.6))
      .sort((a, b) => (b.hoursAgo ?? 1e9) - (a.hoursAgo ?? 1e9));

    let topMuscle: string | null = null, topSets = 0;
    for (const [g, c] of muscleSets14) if (c > topSets) { topSets = c; topMuscle = g; }

    return {
      totalSessions: dates.size, totalTonnage, totalSets,
      vol7, volPrev7, volDeltaPct, perWeek, sessions14: sessionDays14.size,
      recentPRs, neglected, topMuscle, topSets,
    };
  });

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

{#if $_goalReason}
  <div class="note-box">🏋️ <strong>Why you train:</strong> Resistance training protects lean mass while you diet, so the weight you lose comes from fat, not muscle. Your current plan — {$_goalReason}</div>
{:else}
  <div class="note-box warn">🏋️ Lifting preserves muscle in a calorie deficit. Set a body-composition goal in <strong>Today → Body &amp; Goals</strong> to see exactly how training fits your target.</div>
{/if}

<a class="btn bg_ bfl music-link" href="https://music.amazon.com/" target="_blank" rel="noopener noreferrer">
  🎵 Open Amazon Music
</a>

<div class="card">
  <div class="flex jb ac">
    <div>
      <div style="font-size:13px;font-weight:700;color:#fff">Gym &amp; Badminton Alarms</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">
        {#if alarmSyncMsg}{alarmSyncMsg}{:else}Creates/updates prep alarms from your weekly schedule. Only runs when you tap this — it will never silently recreate an alarm you've deleted.{/if}
      </div>
    </div>
    <button class="btn bg_ bsm" onclick={syncAlarmsNow} disabled={syncingAlarms} style="flex-shrink:0">
      {syncingAlarms ? 'Syncing…' : '🔔 Sync'}
    </button>
  </div>
</div>

<div class="flip-viewport" style="height:{recoveryFlipped ? recBackH : recFrontH}px">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="flip-inner" class:flipped={recoveryFlipped}>
    <div class="flip-face flip-front card" bind:clientHeight={recFrontH}>
      <div class="flex jb ac">
        <div class="card-lbl" style="margin-bottom:0">Muscle Recovery</div>
        <button class="flip-btn" onclick={() => recoveryFlipped = true}>Details ↻</button>
      </div>
      <div class="muscle-grid" style="margin-top:10px">
        {#each muscleRecovery as m}
          <div class="muscle-cell" class:ready={m.status === 'ready'} class:recovering={m.status === 'recovering'} class:fatigued={m.status === 'fatigued'} class:none={m.status === 'none'}>
            <div class="mc-name">{m.group}</div>
            <div class="mc-status">{recoveryPhrase(m)}</div>
            {#if m.status !== 'none'}
              <div class="mc-bar"><div class="mc-bar-fill" style="width:{m.pct}%"></div></div>
            {/if}
          </div>
        {/each}
      </div>
      <div class="mc-legend">🔴 Fatigued · 🟡 Recovering · 🟢 Ready — window scales with the exercise: a machine/isolation move recovers faster than a heavy compound.</div>
    </div>

    <div class="flip-face flip-back card" bind:clientHeight={recBackH}>
      <div class="flex jb ac">
        <div class="card-lbl" style="margin-bottom:0">What hit each muscle</div>
        <button class="flip-btn" onclick={() => recoveryFlipped = false}>Back ↩</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5">
        Recovery time isn't flat. Trained muscles doing habitual work rebuild in
        ~36–60h, not a blanket 72h. We scale each muscle's window by the most
        damaging move that hit it: heavy-eccentric compounds (RDL, deadlift,
        squat) take ~25% longer, while machine/isolation moves (leg extension,
        curls, pushdowns) take ~25% less. So an RDL genuinely needs ~72h for
        hamstrings, but a leg extension only ~45h for quads — same muscle,
        different damage.
      </div>
      <div style="margin-top:8px">
        {#each muscleRecovery.filter((m) => m.status !== 'none') as m}
          <div class="mrd-group">
            <div class="mrd-head">
              <span class="mrd-name">{m.group} <span class="mrd-ex-meta">· {m.windowH}h window</span></span>
              <span class="mrd-status" class:ready={m.status === 'ready'} class:recovering={m.status === 'recovering'} class:fatigued={m.status === 'fatigued'}>
                {recoveryPhrase(m)} · last {hoursAgoPhrase(m.hoursAgo)}
              </span>
            </div>
            <div class="mrd-exs">
              {#each Array.from(new Map(m.exercises.map((e) => [e.name, e])).values()) as ex}
                <span class="mrd-ex">{ex.name} <span class="mrd-ex-meta">· {ex.sets} set{ex.sets === 1 ? '' : 's'} · {hoursAgoPhrase(ex.hoursAgo)}</span></span>
              {:else}
                <span class="mrd-ex-meta">Trained, but no set detail logged</span>
              {/each}
            </div>
          </div>
        {:else}
          <div style="font-size:12px;color:var(--muted)">Log a workout to see which exercises drove each muscle's recovery.</div>
        {/each}
      </div>
    </div>
  </div>
</div>

{#if trainingLoad.zone !== 'no-data'}
  <div class="card">
    <div class="flex jb ac">
      <div class="card-lbl" style="margin-bottom:0">Training Load Balance</div>
      <button class="flip-btn" onclick={() => showLoadHelp = !showLoadHelp}>{showLoadHelp ? 'Hide ▲' : 'What is this? ▾'}</button>
    </div>
    <div class="load-gauge" style="margin-top:10px">
      <div class="load-track">
        <!-- Sweet-spot band (ratio 0.8–1.3) shaded on the 0–2.0 scale. -->
        <div class="load-sweet-band"></div>
        <div class="load-fill" class:undertrained={trainingLoad.zone === 'undertrained'} class:sweet={trainingLoad.zone === 'sweet-spot'} class:caution={trainingLoad.zone === 'caution'} class:risk={trainingLoad.zone === 'high-risk'}
          style="width:{Math.min(100, ((trainingLoad.ratio ?? 0) / 2) * 100)}%"></div>
      </div>
      <div class="load-ratio">{trainingLoad.ratio?.toFixed(2) ?? '--'}</div>
    </div>
    <div class="load-scale"><span>0</span><span>0.8</span><span>1.3</span><span>1.5</span><span>2.0+</span></div>
    <div class="load-label">
      {#if trainingLoad.zone === 'undertrained'}<b>Undertrained (&lt;0.8).</b> Room to push harder — add a little volume this week.
      {:else if trainingLoad.zone === 'sweet-spot'}<b>Sweet spot (0.8–1.3).</b> Well-balanced — this is exactly where you want to be.
      {:else if trainingLoad.zone === 'caution'}<b>Caution (1.3–1.5).</b> Ramping up fast — hold volume steady and prioritise recovery.
      {:else}<b>High risk (&gt;1.5).</b> Load is spiking vs your norm — ease off a session to avoid injury.{/if}
    </div>
    <div class="load-reason">Last 7 days: <b>{Math.round(trainingLoad.acuteAvg)}</b> AU/day · 28-day norm: <b>{Math.round(trainingLoad.chronicAvg)}</b> AU/day</div>
    {#if showLoadHelp}
      <div class="load-help">
        <p><b>What it is:</b> the <b>acute:chronic workload ratio</b> — this week's average training load ÷ your last-4-weeks average. It's a validated injury-risk signal from sports science (WHOOP uses the same idea).</p>
        <p><b>How load is estimated:</b> sets logged × ~3 min/set × effort (session-RPE method, Foster 2001). More sets / heavier weeks push the number up.</p>
        <p><b>What it should look like:</b> hover around <b>1.0</b> and stay inside <b>0.8–1.3</b>. That means you're progressing steadily without sudden spikes. Sitting below 0.8 for weeks means you're detraining; repeatedly above 1.5 is where injury risk climbs. The goal is a slow, steady climb — not big jumps.</p>
      </div>
    {/if}
  </div>
{/if}

{#if historyInsights}
  <div class="card">
    <div class="flex jb ac">
      <div class="card-lbl" style="margin-bottom:0">📈 Insights from your history</div>
      <button class="flip-btn" onclick={() => showInsights = !showInsights}>{showInsights ? 'Less ▲' : 'More ▾'}</button>
    </div>

    <div class="ins-stats">
      <div class="ins-stat"><span class="ins-val">{historyInsights.totalSessions}</span><span class="ins-lbl">sessions</span></div>
      <div class="ins-stat"><span class="ins-val">{Math.round(historyInsights.totalTonnage).toLocaleString()}</span><span class="ins-lbl">kg lifted</span></div>
      <div class="ins-stat"><span class="ins-val">{historyInsights.perWeek}</span><span class="ins-lbl">sessions/wk</span></div>
    </div>

    <div class="ins-list">
      {#if historyInsights.volDeltaPct !== null}
        <div class="ins-item" class:good={historyInsights.volDeltaPct >= 0} class:warn={historyInsights.volDeltaPct < 0}>
          {historyInsights.volDeltaPct >= 0 ? '📈' : '📉'}
          Weekly volume {historyInsights.volDeltaPct >= 0 ? 'up' : 'down'} <b>{Math.abs(historyInsights.volDeltaPct)}%</b> vs the week before
          ({Math.round(historyInsights.vol7).toLocaleString()} vs {Math.round(historyInsights.volPrev7).toLocaleString()} kg).
          {historyInsights.volDeltaPct >= 0 ? 'Progressive overload is working — this is what protects lean mass in a deficit.' : 'Dips are fine near a deep-diet week; just avoid a long slide.'}
        </div>
      {/if}
      {#if historyInsights.recentPRs.length > 0}
        <div class="ins-item good">🏆 Recent PR: <b>{historyInsights.recentPRs[0].name}</b> — {historyInsights.recentPRs[0].weight_kg}kg × {historyInsights.recentPRs[0].reps} (est. 1RM {Math.round(historyInsights.recentPRs[0].oneRM)}kg). Getting stronger while dieting = you're recomping, not just losing.</div>
      {/if}
      {#if historyInsights.neglected.length > 0}
        <div class="ins-item warn">🎯 Neglected: <b>{historyInsights.neglected.slice(0, 2).map((m) => m.group).join(' & ')}</b>{historyInsights.neglected[0].status === 'none' ? ' (never logged)' : ` (last ${hoursAgoPhrase(historyInsights.neglected[0].hoursAgo)})`}. Balanced training keeps physique proportional — slot {historyInsights.neglected.length > 1 ? 'them' : 'it'} in next.</div>
      {/if}
      {#if historyInsights.topMuscle}
        <div class="ins-item">💪 Most-trained lately: <b>{historyInsights.topMuscle}</b> ({historyInsights.topSets} sets / 14d).</div>
      {/if}

      {#if showInsights}
        <div class="ins-item">🗓️ <b>{historyInsights.sessions14}</b> sessions in the last 14 days. {historyInsights.perWeek >= 3 ? 'Great consistency — 3+/wk is the sweet spot for recomposition.' : 'Aim for 3+/week to maximise lean-mass retention while cutting.'}</div>
        {#if historyInsights.recentPRs.length > 1}
          <div class="ins-item good">🥈 Also PR'd: {historyInsights.recentPRs.slice(1, 4).map((p) => p.name).join(', ')}.</div>
        {/if}
        {#if $_goalReason}
          <div class="ins-item">🔗 Tied to your goal — {$_goalReason} Strength trend + volume above are the evidence your training is defending muscle as the scale drops.</div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<div class="week-tabs">
  <button class="wtab" class:on={weekOffset === 0} onclick={() => weekOffset = 0}>Next 7 Days</button>
  <button class="wtab" class:on={weekOffset === 1} onclick={() => weekOffset = 1}>Following 7 Days</button>
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
            <!-- Whole row is the tap target — no more hunting the tiny toggle. -->
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div class="log-row log-row-tap" role="button" tabindex="0"
              onclick={() => toggleLog(ex)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLog(ex); } }}>
              <div class="last-perf">
                {#if last}Last time ({last.date}): {fmtSets(last.sets)}{:else}No history yet{/if}
              </div>
              <span class="log-toggle">
                {expandedLog.has(ex.name) ? 'Hide log' : 'Log sets ✎'}
              </span>
            </div>
            {#if suggestion}
              <div class="suggestion-badge" class:up={suggestion.type === 'up'} class:deload={suggestion.type === 'deload'}>
                {suggestion.type === 'up' ? '📈' : suggestion.type === 'deload' ? '⚠️' : '➡️'} {suggestion.text}
              </div>
            {/if}
            {#if pr}
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <div class="pr-row pr-row-tap" role="button" tabindex="0"
                onclick={() => toggleHistory(ex.name)}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHistory(ex.name); } }}>
                <span class="pr-badge">🏆 PR: {pr.best.weight_kg}kg × {pr.best.reps} <span class="pr-date">({pr.date})</span></span>
                <span class="log-toggle">
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
  .log-row-tap,.pr-row-tap{cursor:pointer;border:1px solid var(--border);border-radius:10px;padding:9px 11px;-webkit-tap-highlight-color:transparent;transition:border-color .15s,background .15s}
  .log-row-tap:hover,.pr-row-tap:hover{border-color:var(--border2)}
  .log-row-tap:active,.pr-row-tap:active{border-color:var(--amber);background:rgba(255,176,32,.06)}
  .log-row-tap:focus-visible,.pr-row-tap:focus-visible{outline:none;border-color:var(--amber)}
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

  .muscle-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
  .muscle-cell{border-radius:10px;padding:8px 10px;background:var(--bg3);border:1px solid var(--border)}
  .muscle-cell.ready{background:rgba(46,204,113,.12);border-color:rgba(46,204,113,.3)}
  .muscle-cell.recovering{background:rgba(255,209,102,.12);border-color:rgba(255,209,102,.3)}
  .muscle-cell.fatigued{background:rgba(255,107,107,.12);border-color:rgba(255,107,107,.3)}
  .muscle-cell.none{opacity:.5}
  .mc-name{font-size:12px;font-weight:700;color:#fff}
  .mc-status{font-size:10px;color:var(--muted);margin-top:2px}
  .muscle-cell.ready .mc-status{color:var(--green,#2ecc71)}
  .muscle-cell.recovering .mc-status{color:#ffd166}
  .muscle-cell.fatigued .mc-status{color:#ff6b6b}
  .mc-bar{height:3px;border-radius:2px;background:var(--border2);margin-top:5px;overflow:hidden}
  .mc-bar-fill{height:100%;background:currentColor;opacity:.55}
  .muscle-cell.ready .mc-bar-fill{background:var(--green,#2ecc71);opacity:1}
  .muscle-cell.recovering .mc-bar-fill{background:#ffd166}
  .muscle-cell.fatigued .mc-bar-fill{background:#ff6b6b}
  .mc-legend{font-size:10px;color:var(--muted);margin-top:10px;line-height:1.4}

  /* Flip card (Muscle Recovery) — measured-height 3D flip so both faces
     size correctly on mobile. */
  .flip-viewport{position:relative;perspective:1200px;margin-bottom:12px;transition:height .45s var(--ease)}
  .flip-inner{position:relative;width:100%;transform-style:preserve-3d;transition:transform .5s var(--ease)}
  .flip-inner.flipped{transform:rotateY(180deg)}
  .flip-face{position:absolute;top:0;left:0;width:100%;backface-visibility:hidden;-webkit-backface-visibility:hidden;margin:0}
  .flip-back{transform:rotateY(180deg)}
  .flip-btn{font-size:11px;font-weight:700;color:var(--amber);background:none;border:none;cursor:pointer;padding:2px 4px}
  .mrd-group{padding:8px 0;border-bottom:1px solid var(--border)}
  .mrd-group:last-child{border-bottom:none}
  .mrd-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
  .mrd-name{font-size:13px;font-weight:700;color:#fff}
  .mrd-status{font-size:10px;color:var(--muted);text-align:right}
  .mrd-status.ready{color:var(--green,#2ecc71)}
  .mrd-status.recovering{color:#ffd166}
  .mrd-status.fatigued{color:#ff6b6b}
  .mrd-exs{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}
  .mrd-ex{font-size:11px;color:var(--text);background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:3px 7px}
  .mrd-ex-meta{color:var(--muted);font-size:10px}

  .load-gauge{display:flex;align-items:center;gap:10px}
  .load-track{flex:1;height:10px;background:var(--bg3);border-radius:5px;overflow:hidden;position:relative}
  .load-sweet-band{position:absolute;top:0;bottom:0;left:40%;width:25%;background:rgba(46,204,113,.18);border-left:1px dashed rgba(46,204,113,.5);border-right:1px dashed rgba(46,204,113,.5)}
  .load-fill{height:100%;transition:width .3s var(--ease);position:relative}
  .load-fill.undertrained{background:#60a5fa}
  .load-fill.sweet{background:var(--green,#2ecc71)}
  .load-fill.caution{background:#ffd166}
  .load-fill.risk{background:#ff6b6b}
  .load-ratio{font-size:16px;font-weight:800;color:#fff;min-width:40px;text-align:right}
  .load-scale{display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-top:3px;padding-right:50px}
  .load-label{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.45}
  .load-reason{font-size:11px;color:var(--muted);margin-top:6px}
  .load-help{margin-top:10px;padding:10px;background:var(--bg3);border-radius:10px;font-size:11.5px;color:var(--text);line-height:1.5}
  .load-help p{margin:0 0 8px}
  .load-help p:last-child{margin-bottom:0}

  .ins-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}
  .ins-stat{background:var(--bg3);border-radius:10px;padding:8px;text-align:center}
  .ins-val{display:block;font-size:17px;font-weight:800;color:var(--amber)}
  .ins-lbl{font-size:10px;color:var(--muted)}
  .ins-list{display:flex;flex-direction:column;gap:7px}
  .ins-item{font-size:11.5px;color:var(--text);line-height:1.45;background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:8px 10px}
  .ins-item.good{border-color:rgba(46,204,113,.3);background:rgba(46,204,113,.08)}
  .ins-item.warn{border-color:rgba(255,209,102,.3);background:rgba(255,209,102,.08)}
</style>
