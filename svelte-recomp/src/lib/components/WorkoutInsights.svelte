<script lang="ts">
  // One place on the Train tab that reads what you've already logged and answers
  // the questions the raw log can't: which muscles are under the weekly volume
  // floor, which lifts have stalled, how consistent training has been, and
  // whether sleep is moving your gym output. All pure functions (unit-tested);
  // each card hides itself until there's enough data to say something honest.
  import { liveWorkoutLogs, liveWorkoutSessions, liveActivitySessions, liveBiometrics } from '$lib/stores/live';
  import { DEFAULT_SESSIONS } from '$lib/data/workoutPlanDefaults';
  import { muscleVolume } from '$lib/muscleVolume';
  import { liftStalls } from '$lib/liftStalls';
  import { sleepPerformance } from '$lib/sleepPerformance';
  import { trainingHeatmap } from '$lib/trainingHeatmap';

  const _logs = liveWorkoutLogs();
  const _sessions = liveWorkoutSessions();
  const _activity = liveActivitySessions();
  const _bio = liveBiometrics();

  const MUSCLE_GROUPS = ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Core'];

  // exercise name -> its free-text muscle string, from the user's sessions (or
  // the shipped defaults), same source the recovery grid uses.
  const exerciseMuscleMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const s of DEFAULT_SESSIONS) for (const ex of s.exercises) map.set(ex.name, ex.muscle);
    for (const s of ($_sessions as Map<string, any>).values()) for (const ex of s.exercises || []) map.set(ex.name, ex.muscle);
    return map;
  });
  function groupsFor(name: string): string[] {
    const text = (exerciseMuscleMap.get(name) || '').toLowerCase();
    return MUSCLE_GROUPS.filter((g) => text.includes(g.toLowerCase()));
  }

  const logs = $derived(($_logs as any[]).map((l) => ({ date: l.date, exercise_name: l.exercise_name, sets: l.sets || [] })));

  const volume = $derived(muscleVolume(logs, groupsFor, MUSCLE_GROUPS, { windowDays: 7 }));
  const stalls = $derived(liftStalls(logs, { stallAfter: 3, minSessions: 3 }));
  const sleep = $derived(($_bio as any[]).map((b) => ({ date: b.date, sleep_hours: b.sleep_hours })));
  const sleepPerf = $derived(sleepPerformance(sleep, logs));

  // Heatmap: one "session" mark per logged exercise-day + each watch activity.
  const heat = $derived.by(() => {
    const dates: string[] = [];
    for (const l of logs) if (l.date) dates.push(l.date);
    for (const a of ($_activity as any[])) if (a.date) dates.push(a.date);
    return trainingHeatmap(dates, { windowWeeks: 26 });
  });

  const heatColors = ['transparent', 'color-mix(in srgb,var(--amber) 28%,transparent)', 'color-mix(in srgb,var(--amber) 52%,transparent)', 'color-mix(in srgb,var(--amber) 76%,transparent)', 'var(--amber)'];
  const barColor = (status: string) => status === 'high' ? 'var(--red)' : status === 'optimal' ? 'var(--green,#2ecc71)' : status === 'low' ? 'var(--amber)' : 'var(--bg3)';
</script>

{#if volume.totalSets > 0}
  <div class="card">
    <div class="card-lbl">💪 Weekly muscle volume</div>
    {#if volume.headline}<div class="ins-head">{volume.headline}</div>{/if}
    <div class="mv-grid">
      {#each volume.perMuscle as m}
        <div class="mv-row">
          <span class="mv-name">{m.group}</span>
          <div class="mv-track">
            <div class="mv-fill" style="width:{Math.min(100, (m.sets / 20) * 100)}%;background:{barColor(m.status)}"></div>
          </div>
          <span class="mv-sets" class:low={m.status === 'low' || m.status === 'none'} class:high={m.status === 'high'}>{m.sets}</span>
        </div>
      {/each}
    </div>
    <div class="ins-foot">Sets logged in the last 7 days. Green ≈ 10–20/week (productive), amber = under, red = over.</div>
  </div>
{/if}

{#if stalls.lifts.length > 0}
  <div class="card">
    <div class="card-lbl">🏋️ Lift progress &amp; stalls</div>
    {#if stalls.headline}<div class="ins-head">{stalls.headline}</div>{/if}
    {#each stalls.lifts.slice(0, 6) as l}
      <div class="lift-row" class:stalled={l.stalled} class:good={l.progressing}>
        <div class="lift-top">
          <span class="lift-name">{l.exercise}</span>
          <span class="lift-tag">{l.progressing ? '📈 climbing' : l.stalled ? '⚠️ stalled' : '➡️ flat'}</span>
        </div>
        <div class="lift-sub">e1RM {l.currentBestE1RM}kg · {l.trendPct >= 0 ? '+' : ''}{l.trendPct}% · {l.suggestion}</div>
      </div>
    {/each}
  </div>
{/if}

{#if heat.daysTrained > 0}
  <div class="card">
    <div class="card-lbl">🔥 Training consistency</div>
    <div class="ins-head">{heat.daysTrained} training days in the last {heat.windowWeeks} weeks · {heat.activeWeeks} active weeks.</div>
    <div class="heat-scroll">
      <div class="heat-grid">
        {#each heat.weeks as week}
          <div class="heat-col">
            {#each week as cell}
              <div class="heat-cell" style="background:{heatColors[cell.level]}" title={cell.date ? `${cell.date}: ${cell.count} session${cell.count === 1 ? '' : 's'}` : ''}></div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
    <div class="heat-legend"><span>less</span>{#each heatColors as c}<div class="heat-cell" style="background:{c}"></div>{/each}<span>more</span></div>
  </div>
{/if}

{#if sleepPerf.headline}
  <div class="card">
    <div class="card-lbl">😴 Sleep → performance</div>
    <div class="ins-head">{sleepPerf.headline}</div>
    {#if sleepPerf.avgTonnageGoodSleep != null && sleepPerf.avgTonnagePoorSleep != null}
      <div class="sp-split">
        <div class="sp-box"><div class="sp-v good">{(sleepPerf.avgTonnageGoodSleep / 1000).toFixed(1)}t</div><div class="sp-l">after 7h+ sleep</div></div>
        <div class="sp-box"><div class="sp-v">{(sleepPerf.avgTonnagePoorSleep / 1000).toFixed(1)}t</div><div class="sp-l">under 6h sleep</div></div>
      </div>
    {/if}
    <div class="ins-foot">Average training tonnage (reps × load) on your logged days, split by the night's sleep.</div>
  </div>
{/if}

<style>
  .ins-head{font-size:0.8125rem;color:#fff;font-weight:600;line-height:1.45;margin-bottom:10px}
  .ins-foot{font-size:0.6875rem;color:var(--muted);line-height:1.4;margin-top:10px}
  .mv-grid{display:flex;flex-direction:column;gap:7px}
  .mv-row{display:grid;grid-template-columns:64px 1fr 26px;align-items:center;gap:8px}
  .mv-name{font-size:0.75rem;color:var(--muted);font-weight:600}
  .mv-track{height:8px;border-radius:5px;background:var(--bg3);overflow:hidden}
  .mv-fill{height:100%;border-radius:5px;transition:width .5s var(--ease)}
  .mv-sets{font-size:0.75rem;font-weight:800;color:#fff;text-align:right}
  .mv-sets.low{color:var(--amber)}
  .mv-sets.high{color:var(--red)}
  .lift-row{padding:8px 0;border-top:1px solid var(--border)}
  .lift-row:first-of-type{border-top:none}
  .lift-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .lift-name{font-size:0.8125rem;font-weight:700;color:#fff}
  .lift-tag{font-size:0.6875rem;font-weight:700;color:var(--muted)}
  .lift-row.stalled .lift-tag{color:var(--red)}
  .lift-row.good .lift-tag{color:var(--green,#2ecc71)}
  .lift-sub{font-size:0.6875rem;color:var(--muted);line-height:1.4;margin-top:2px}
  .heat-scroll{overflow-x:auto;padding-bottom:4px}
  .heat-grid{display:flex;gap:3px;min-width:min-content}
  .heat-col{display:flex;flex-direction:column;gap:3px}
  .heat-cell{width:11px;height:11px;border-radius:2px;border:1px solid var(--glass-brd)}
  .heat-legend{display:flex;align-items:center;gap:3px;margin-top:8px;font-size:0.625rem;color:var(--muted)}
  .heat-legend .heat-cell{width:10px;height:10px}
  .sp-split{display:flex;gap:10px;margin-top:6px}
  .sp-box{flex:1;background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:11px;padding:10px;text-align:center}
  .sp-v{font-size:1.125rem;font-weight:800;color:#fff}
  .sp-v.good{color:var(--green,#2ecc71)}
  .sp-l{font-size:0.625rem;color:var(--muted);margin-top:2px}
</style>
