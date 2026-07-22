<script lang="ts">
  import { liveAlarms, liveWeights, liveLog, liveGoal, liveActivityDates, liveGoalReason, liveMealPlan, liveSchedule, liveWorkoutSessions, liveSessionCompletions, liveSteps, liveFoodLogs, liveBiometrics } from '$lib/stores/live';
  import { upsertRecord } from '$lib/stores/sync';
  import { userId } from '$lib/stores/user';
  import db from '$lib/db/dexie';
  import { GOAL_KG as DEFAULT_GOAL_KG } from '$lib/config';
  import { recipes } from '$lib/data/recipes';
  import { DEFAULT_SCHEDULE, DEFAULT_SESSIONS } from '$lib/data/workoutPlanDefaults';
  import { base } from '$app/paths';
  import { cardNav } from '$lib/actions/cardNav';
  import { computeStreak } from '$lib/streaks';
  import { buildDailyFocus, parseCalorieTarget, waterTargetLitres, weightTrend } from '$lib/coach';
  import ReadinessCard from '$lib/components/ReadinessCard.svelte';
  import DailyFocus from '$lib/components/DailyFocus.svelte';
  import BodyGoals from '$lib/components/BodyGoals.svelte';

  const dayIdx = new Date().getDay();
  const today = new Date().toISOString().slice(0, 10);
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const _alarms = liveAlarms();
  const _weights = liveWeights();
  const _todayLog = liveLog(today);
  const _goal = liveGoal();
  const _goalReason = liveGoalReason();
  const GOAL_KG = $derived($_goal ?? DEFAULT_GOAL_KG);

  // — Today's meal plan (from the Nutrition/Recipes page's weekly plan) —
  // meal_plans rows are keyed by week_start (that week's Monday), so we
  // just need this week's Monday and today's day-of-week index to look
  // up the same plan the Recipes page reads/writes.
  function mondayOf(d: Date): string {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    return monday.toISOString().slice(0, 10);
  }
  const _todayMealPlan = liveMealPlan(mondayOf(new Date()));
  const todayRecipe = $derived.by(() => {
    const recipeId = $_todayMealPlan?.[dayIdx];
    return recipeId ? recipes.find((r) => r.id === recipeId) ?? null : null;
  });

  // — Today's gym session (from the Workouts page's weekly schedule) —
  const _schedule = liveSchedule();
  const _sessions = liveWorkoutSessions();
  const _completions = liveSessionCompletions();
  const todaySchedule = $derived.by(() => {
    const sched = $_schedule.length > 0 ? $_schedule : DEFAULT_SCHEDULE;
    return sched.find((d: any) => d.day_of_week === dayIdx) ?? null;
  });
  const todaySession = $derived.by(() => {
    if (!todaySchedule?.session_key) return null;
    const sessions = $_sessions.size > 0 ? $_sessions : new Map(DEFAULT_SESSIONS.map((s) => [s.key, s]));
    return sessions.get(todaySchedule.session_key) ?? null;
  });
  const todaySessionDone = $derived(
    !!todaySchedule?.session_key && $_completions.some((c: any) => c.date === today && c.type === todaySchedule.session_key)
  );
  let markingSessionDone = $state(false);
  async function markTodaySessionComplete() {
    if (!uid || !todaySchedule?.session_key || todaySessionDone) return;
    markingSessionDone = true;
    try {
      await upsertRecord('sessions', {
        user_id: uid, date: today, type: todaySchedule.session_key,
        created_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Mark complete failed:', e);
    } finally { markingSessionDone = false; }
  }

  // Streak: consecutive days with ANY logged activity (weigh-in, food,
  // workout, or the quick-log card), with a 1-day "shield" so a single
  // missed day doesn't wipe out weeks of consistency (Noom/Lose It-style
  // adherence mechanic -- loss aversion is a genuinely effective nudge).
  const _activityDates = liveActivityDates();
  const streak = $derived(computeStreak($_activityDates, today, 1));

  let editingGoal = $state(false);
  let goalInput = $state('');
  let showBodyGoals = $state(false);

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

  const _steps = liveSteps();
  const todayKcal = $derived($_todayLog?.kcal ?? null);
  // Steps live in their own `steps` table (field `count`), NOT on
  // daily_logs — the old `$_todayLog?.steps` always read undefined so
  // steps never displayed. Take the most recent entry logged today.
  const todaySteps = $derived.by(() => {
    const t = [...$_steps].filter((s: any) => s.date === today);
    if (t.length === 0) return null;
    const latest = t.sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''))[t.length - 1];
    return latest?.count ?? null;
  });
  const todayWater = $derived($_todayLog?.water_glasses ?? 0);
  const waterGoalL = $derived(waterTargetLitres(recentWeight));

  // Water logging surfaced on Today (was buried under Body & Goals). Each
  // tap = one 250 ml glass; stored as water_glasses, shown/targeted in L.
  async function addWater() {
    if (!uid) return;
    const next = Math.min(todayWater + 1, 20);
    try { await upsertRecord('daily_logs', { user_id: uid, date: today, water_glasses: next }); }
    catch (e) { console.error('Water save failed:', e); }
  }
  async function removeWater() {
    if (!uid || todayWater <= 0) return;
    try { await upsertRecord('daily_logs', { user_id: uid, date: today, water_glasses: todayWater - 1 }); }
    catch (e) { console.error('Water save failed:', e); }
  }

  // — Daily Focus coaching layer —
  // Derive prioritised, actionable guidance from every signal the app
  // collects (calories, protein, sleep, steps, water, weight trend, training —
  // including watch/Health-Connect data) framed toward the goal weight.
  const _foodLogs = liveFoodLogs();
  const _biometrics = liveBiometrics();

  // Per-day calorie + protein totals from the detailed food log (the same
  // source the Nutrition page trusts). Falls back to the quick-logged single
  // kcal number on daily_logs for days with no itemised food.
  const foodByDate = $derived.by(() => {
    const m = new Map<string, { kcal: number; protein: number }>();
    for (const f of $_foodLogs) {
      const cur = m.get(f.date) ?? { kcal: 0, protein: 0 };
      cur.kcal += f.kcal || 0;
      cur.protein += f.protein_g || 0;
      m.set(f.date, cur);
    }
    return m;
  });

  const coachTodayKcal = $derived.by(() => {
    const fromFood = foodByDate.get(today)?.kcal ?? 0;
    if (fromFood > 0) return fromFood;
    return $_todayLog?.kcal ?? null;
  });
  const coachTodayProtein = $derived(foodByDate.get(today)?.protein ?? null);

  const weekMonday = $derived(mondayOf(new Date()));
  const daysElapsedThisWeek = $derived(dayIdx === 0 ? 7 : dayIdx); // Mon=1..Sun=7
  const weekKcalSoFar = $derived.by(() => {
    let sum = 0;
    for (const [date, v] of foodByDate) {
      if (date >= weekMonday && date <= today) sum += v.kcal;
    }
    // include today's quick-logged kcal if no itemised food covers it
    if ((foodByDate.get(today)?.kcal ?? 0) === 0 && $_todayLog?.kcal) sum += $_todayLog.kcal;
    return sum;
  });

  // Steps: latest reading per day, averaged over days with data in the last 7.
  const stepsWeekAvg = $derived.by(() => {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const byDate = new Map<string, { count: number; at: string }>();
    for (const s of $_steps as any[]) {
      if (s.date < cutoff) continue;
      const prev = byDate.get(s.date);
      if (!prev || (s.created_at || '') >= prev.at) byDate.set(s.date, { count: s.count, at: s.created_at || '' });
    }
    if (byDate.size === 0) return null;
    let sum = 0;
    for (const v of byDate.values()) sum += v.count;
    return sum / byDate.size;
  });

  // Last night's sleep: most recent biometric with sleep in the last 2 days.
  const lastSleep = $derived.by(() => {
    const yday = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const rows = ($_biometrics as any[])
      .filter((b) => b.sleep_hours != null && b.date >= yday && b.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    return rows.length ? rows[rows.length - 1] : null;
  });

  // Robust weight trend (regression over ~28d) — kills daily water-weight
  // noise that made point-to-point deltas read as "dropping too fast".
  const wTrend = $derived(
    weightTrend(($_weights as any[]).map((w) => ({ date: w.date, weight: w.weight })), GOAL_KG)
  );

  // What KIND of day is today? A gym session, an ACTIVE day (badminton/
  // cardio with no barbell session), or a true rest day. Badminton days have
  // session_key === null but are NOT rest — the old logic mislabelled them.
  const dayInfo = $derived.by(() => {
    const lbl = (todaySchedule?.label || '').toLowerCase();
    const note = (todaySchedule?.note || '').toLowerCase();
    if (todaySession) return { kind: 'gym' as const, label: todaySession.name };
    const hay = `${lbl} ${note}`;
    if (/badminton|cardio|agility|walk|run|swim|sport|tennis|cycl/.test(hay)) {
      const label = /badminton/.test(hay) ? 'Badminton' : (todaySchedule?.label || 'Active');
      return { kind: 'active' as const, label };
    }
    return { kind: 'rest' as const, label: 'Rest' };
  });

  // Movement snack rotates through the day — tick the hour so it refreshes
  // without a reload (the user asked for hourly-updating suggestions).
  let nowHour = $state(new Date().getHours());
  $effect(() => {
    const t = setInterval(() => { nowHour = new Date().getHours(); }, 10 * 60 * 1000);
    return () => clearInterval(t);
  });

  const GLASS_L = 0.25; // each logged "glass" = 250 ml

  const focusItems = $derived(
    buildDailyFocus({
      goalKg: GOAL_KG,
      currentWeight: recentWeight,
      weeklyLossRate: wTrend.rateKgPerWeek,
      plateau: wTrend.plateau,
      plateauWeeks: wTrend.plateauWeeks,
      trendSpanDays: wTrend.spanDays,
      totalLostKg: firstWeight != null && recentWeight != null ? +(firstWeight - recentWeight).toFixed(1) : null,
      weeksToGoal,
      calorieTarget: parseCalorieTarget($_goalReason),
      todayKcal: coachTodayKcal,
      weekKcalSoFar,
      daysElapsedThisWeek,
      proteinTarget: Math.round(GOAL_KG * 1.8),
      todayProtein: coachTodayProtein,
      sleepHours: lastSleep?.sleep_hours ?? null,
      sleepQuality: lastSleep?.sleep_quality ?? null,
      stepsToday: todaySteps,
      stepsWeekAvg,
      waterToday: todayWater * GLASS_L,
      waterTarget: waterTargetLitres(recentWeight),
      dayKind: dayInfo.kind,
      activityLabel: dayInfo.label,
      workoutDoneToday: todaySessionDone,
      hour: nowHour,
    })
  );</script>

<div class="page-hd">{greeting}</div>
<div class="flex jb ac">
  <div class="page-sub" style="margin-bottom:0">{dayName} &middot; {dateStr}</div>
  {#if streak.current > 0}
    <div class="streak-badge" class:risk={streak.atRisk}>
      🔥 {streak.current} day{streak.current === 1 ? '' : 's'}{#if streak.atRisk} · log today!{/if}
    </div>
  {/if}
</div>
<div style="margin-bottom:18px"></div>

<DailyFocus items={focusItems} />

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

{#if $_goalReason}
  <div class="note-box">💡 {$_goalReason}</div>
{:else}
  <div class="note-box warn">⚠️ This goal weight has no calculation behind it yet — open <strong>Body &amp; Goals</strong> below to set a real one based on your body composition and calorie needs.</div>
{/if}

<ReadinessCard />

<div class="card">
  <div class="flex jb ac" style="margin-bottom:8px">
    <div class="card-lbl" style="margin-bottom:0">💧 Water</div>
    <div style="font-size:13px;font-weight:700;color:var(--blue)">{(todayWater * 0.25).toFixed(2)} <span style="opacity:.6;font-weight:400">/ {waterGoalL.toFixed(1)} L</span></div>
  </div>
  <div class="flex gap2 ac">
    <button class="btn bg_ bsm" onclick={removeWater} disabled={todayWater <= 0} aria-label="Remove a glass" style="min-width:44px">−</button>
    <div class="f1" style="height:10px;background:var(--bg3);border-radius:6px;overflow:hidden">
      <div style="height:100%;width:{Math.min(100, (todayWater * 0.25 / waterGoalL) * 100)}%;background:var(--blue);border-radius:6px;transition:width .2s"></div>
    </div>
    <button class="btn bp bsm" onclick={addWater} aria-label="Add a 250 ml glass" style="min-width:44px">+</button>
  </div>
  <div style="font-size:11px;color:var(--muted);margin-top:6px;text-align:center">
    {#if todayWater * 0.25 >= waterGoalL}✓ Hydration goal met{:else}Tap + for each 250 ml glass{/if}
  </div>
</div>

{#if todayKcal !== null || todaySteps !== null}
  <div class="card" use:cardNav={`${base}/recipes`}>
    <div class="flex jb ac">
      <div class="card-lbl" style="margin-bottom:0">Today's Stats</div>
      <span class="card-link">Nutrition →</span>
    </div>
    <div class="flex gap2" style="font-size:13px;margin-top:10px">
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
        <div style="font-weight:700;color:var(--blue);font-size:18px">{(todayWater * 0.25).toFixed(1)}<span style="font-size:11px">L</span></div>
        <div style="font-size:10px;color:var(--muted)">water</div>
      </div>
    </div>
  </div>
{/if}

<div class="card" use:cardNav={`${base}/recipes`}>
  <div class="flex jb ac">
    <div class="card-lbl" style="margin-bottom:0">🍗 Today's Meal</div>
    <span class="card-link">Nutrition →</span>
  </div>
  {#if todayRecipe}
    <div class="gi" style="padding:5px 0">
      <div class="gn"><strong>{todayRecipe.e} {todayRecipe.name}</strong></div>
      <div style="color:var(--amber);font-weight:600">{todayRecipe.k} kcal</div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin:-2px 0 4px 0">{todayRecipe.p}p &middot; {todayRecipe.c}c &middot; {todayRecipe.f}f</div>
  {:else}
    <div style="color:var(--muted);font-size:13px">No meal planned for today — set one on the Nutrition page</div>
  {/if}
</div>

<div class="card" use:cardNav={`${base}/workouts`}>
  <div class="flex jb ac">
    <div class="card-lbl" style="margin-bottom:0">🏋️ Today's Gym Session</div>
    <span class="card-link">Gym →</span>
  </div>
  {#if todaySession}
    <div class="gi" style="padding:5px 0">
      <div class="gn"><strong>{todaySession.name}</strong></div>
      <div style="color:var(--amber);font-weight:600">{todaySession.duration}</div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin:-2px 0 8px 0">{todaySession.focus}</div>
    {#if todaySessionDone}
      <div style="font-size:12px;color:var(--green);font-weight:600">✓ Marked complete for today</div>
    {:else}
      <button class="btn bg_ bsm" onclick={markTodaySessionComplete} disabled={markingSessionDone}>{markingSessionDone ? 'Saving…' : 'Mark Complete ✓'}</button>
    {/if}
  {:else}
    <div style="color:var(--muted);font-size:13px">{todaySchedule?.note || 'No session scheduled for today'}</div>
  {/if}
</div>

<div class="card" use:cardNav={`${base}/alarms`}>
  <div class="flex jb ac">
    <div class="card-lbl" style="margin-bottom:0">Today's Schedule</div>
    <span class="card-link">Alarms →</span>
  </div>
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

<div class="card" style="margin-top:14px">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="flex jb ac" style="cursor:pointer" onclick={() => showBodyGoals = !showBodyGoals} role="button">
    <div class="card-lbl" style="margin-bottom:0">📊 Body &amp; Goals</div>
    <span style="color:var(--muted);font-size:13px">{showBodyGoals ? 'Hide ▲' : 'Body fat, weight chart, projections ▼'}</span>
  </div>
</div>
{#if showBodyGoals}
  <BodyGoals />
{/if}
