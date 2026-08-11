<script lang="ts">
  // End-of-week digest for the Progress page: turns the week's raw logs into a
  // narrative verdict plus concrete, prioritised adjustments for next week — the
  // kind of thing a good coach would text you on Sunday night. Pure aggregation
  // lives in $lib/weeklyReview; this component only feeds it live data.
  import { liveWeights, liveFoodLogs, liveDailyLogs, liveSteps, liveBiometrics, liveWorkoutLogs, liveGoal } from '$lib/stores/live';
  import { weeklyReview } from '$lib/weeklyReview';
  import { adaptiveTdee } from '$lib/adaptiveTdee';
  import { todayYmd } from '$lib/date';
  import { nowTick } from '$lib/stores/refresh';

  const _weights = liveWeights();
  const _foodLogs = liveFoodLogs();
  const _dailyLogs = liveDailyLogs();
  const _steps = liveSteps();
  const _bio = liveBiometrics();
  const _workoutLogs = liveWorkoutLogs();
  const _goal = liveGoal();

  const today = $derived.by(() => { void $nowTick; return todayYmd(); });
  const goalKg = $derived($_goal ?? null);
  const proteinTargetG = $derived(goalKg ? Math.round(goalKg * 1.8) : 0);

  // Per-day intake (itemised food kcal+protein, quick-log kcal as fallback).
  const intake = $derived.by(() => {
    const byDate = new Map<string, { date: string; kcal: number; protein: number }>();
    for (const f of $_foodLogs as any[]) {
      const cur = byDate.get(f.date) ?? { date: f.date, kcal: 0, protein: 0 };
      cur.kcal += f.kcal || 0;
      cur.protein += f.protein_g || 0;
      byDate.set(f.date, cur);
    }
    for (const l of $_dailyLogs as any[]) {
      if (!byDate.has(l.date) && (l.kcal || 0) > 0) byDate.set(l.date, { date: l.date, kcal: l.kcal, protein: 0 });
    }
    return Array.from(byDate.values());
  });

  // Steps: keep only the latest reading per day.
  const steps = $derived.by(() => {
    const byDate = new Map<string, { count: number; at: string }>();
    for (const s of $_steps as any[]) {
      const prev = byDate.get(s.date);
      if (!prev || (s.created_at || '') >= prev.at) byDate.set(s.date, { count: s.count, at: s.created_at || '' });
    }
    return Array.from(byDate, ([date, v]) => ({ date, count: v.count }));
  });

  const sleep = $derived(($_bio as any[]).map((b) => ({ date: b.date, sleep_hours: b.sleep_hours ?? null })));
  const weights = $derived(($_weights as any[]).map((w) => ({ date: w.date, weight: w.weight })));

  const learnedTdee = $derived.by(() => {
    const t = adaptiveTdee({ intake: intake.map((i) => ({ date: i.date, kcal: i.kcal })), weights, asOf: today });
    return t.tdee;
  });

  const review = $derived(weeklyReview({
    today, weights, intake, steps, sleep,
    workouts: $_workoutLogs as any,
    learnedTdee, proteinTargetG, goalKg,
  }));

  const fmtBal = (n: number) => (n >= 0 ? `+${Math.round(n)}` : `${Math.round(n)}`);
</script>

<div class="card wr">
  <div class="card-lbl">📋 Weekly Review</div>
  <div class="wr-dates">{review.weekStart} → {review.weekEnd}</div>
  <div class="wr-headline">{review.headline}</div>

  <div class="wr-grid">
    <div class="wr-stat">
      <span class="wr-val" class:good={review.weightChangeKg != null && review.weightChangeKg < 0} class:bad={review.weightChangeKg != null && review.weightChangeKg > 0.2}>
        {review.weightChangeKg == null ? '—' : `${review.weightChangeKg > 0 ? '+' : ''}${review.weightChangeKg}`}
      </span>
      <span class="wr-lbl">kg this week</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val">{review.avgIntake ?? '—'}</span>
      <span class="wr-lbl">avg kcal · {review.intakeDays}d</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val" class:good={review.avgProtein != null && proteinTargetG > 0 && review.avgProtein >= proteinTargetG * 0.9}>{review.avgProtein ?? '—'}</span>
      <span class="wr-lbl">avg protein g</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val">{review.energyBalance == null ? '—' : fmtBal(review.energyBalance)}</span>
      <span class="wr-lbl">kcal vs maint.</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val">{review.sessions}</span>
      <span class="wr-lbl">lift days</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val" class:good={review.tonnageDeltaPct != null && review.tonnageDeltaPct >= 3} class:bad={review.tonnageDeltaPct != null && review.tonnageDeltaPct <= -10}>
        {review.tonnageDeltaPct == null ? '—' : `${review.tonnageDeltaPct > 0 ? '+' : ''}${review.tonnageDeltaPct}%`}
      </span>
      <span class="wr-lbl">volume vs last wk</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val">{review.avgSteps ? review.avgSteps.toLocaleString() : '—'}</span>
      <span class="wr-lbl">avg steps</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val">{review.avgSleep ?? '—'}</span>
      <span class="wr-lbl">avg sleep h</span>
    </div>
  </div>

  {#if review.wins.length}
    <div class="wr-sec">
      <div class="wr-sec-h wins">✓ What went well</div>
      {#each review.wins as w (w)}<div class="wr-line">{w}</div>{/each}
    </div>
  {/if}

  {#if review.adjustments.length}
    <div class="wr-sec">
      <div class="wr-sec-h adj">→ Next week</div>
      {#each review.adjustments as a (a)}<div class="wr-line">{a}</div>{/each}
    </div>
  {/if}
</div>

<style>
  .wr-dates{font-size:0.6875rem;color:var(--muted);margin-bottom:6px}
  .wr-headline{font-size:0.8125rem;font-weight:700;color:#fff;line-height:1.45;margin-bottom:12px}
  .wr-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}
  .wr-stat{display:flex;flex-direction:column;align-items:center;text-align:center;background:var(--bg3);border-radius:10px;padding:8px 4px}
  .wr-val{font-size:1rem;font-weight:800;color:#fff}
  .wr-val.good{color:#2ecc71}
  .wr-val.bad{color:#ff6b6b}
  .wr-lbl{font-size:0.6875rem;color:var(--muted);margin-top:2px;line-height:1.2}
  .wr-sec{margin-top:10px}
  .wr-sec-h{font-size:0.75rem;font-weight:800;margin-bottom:5px}
  .wr-sec-h.wins{color:#2ecc71}
  .wr-sec-h.adj{color:var(--amber)}
  .wr-line{font-size:0.7188rem;color:var(--text);line-height:1.5;padding:3px 0 3px 2px}
  @media (max-width:420px){.wr-grid{grid-template-columns:repeat(2,1fr)}}
</style>
