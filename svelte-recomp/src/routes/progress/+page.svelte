<script lang="ts">
  // The Progress tab: one screen that answers "is this working?"
  //
  // Everything here is derived from data the app was ALREADY collecting — weigh-ins,
  // logged sets, body-fat measurements, food. None of it needed new input; it just
  // had nowhere to be read together. See $lib/recomp.ts for the reasoning.
  import { liveWeights, liveWorkoutLogs, liveTracks, liveFoodLogs, liveGoal, liveGoalReason, liveActivitySessions } from '$lib/stores/live';
  import { weightTrend, parseCalorieTarget } from '$lib/coach';
  import { strengthTrend } from '$lib/strength';
  import { recompVerdict, verdictTone, leanMass, fatMass, type BodyFatPoint } from '$lib/recomp';
  import { liveProfile } from '$lib/stores/live';
  import { proteinTargetG as calcProteinTarget } from '$lib/profile';
  import { nowTick } from '$lib/stores/refresh';
  import { shiftYmd } from '$lib/date';
  import MiniChart from '$lib/components/MiniChart.svelte';
  import { base } from '$app/paths';

  const _weights = liveWeights();
  const _logs = liveWorkoutLogs();
  const _tracks = liveTracks();
  const _foodLogs = liveFoodLogs();
  const _goal = liveGoal();
  const _goalReason = liveGoalReason();
  const _activity = liveActivitySessions();

  const _profile = liveProfile();
  const goalKg = $derived($_goal ?? null);

  const weightPoints = $derived(
    ($_weights as any[]).map((w) => ({ date: w.date, weight: w.weight }))
  );
  const trend = $derived(weightTrend(weightPoints, goalKg ?? 0));
  const strength = $derived(strengthTrend($_logs as any, { asOf: $nowTick }));
  const currentWeight = $derived(weightPoints.length ? weightPoints[weightPoints.length - 1].weight : null);
  // Falls back to current weight when no goal is set, so this is never 0 (which
  // would make the adherence comparison below trivially true).
  const proteinTargetG = $derived(Math.max(1, calcProteinTarget(goalKg, currentWeight)));

  // Body-fat readings live in `tracks` (name='body_fat'). Each needs the
  // bodyweight from the same day to become a composition point — we take the
  // nearest weigh-in, since the two are rarely logged at the same moment.
  const bodyFatPoints = $derived.by((): BodyFatPoint[] => {
    const weights = weightPoints;
    if (!weights.length) return [];
    const nearestWeight = (date: string): number | null => {
      let best: { d: number; w: number } | null = null;
      const t = new Date(date + 'T12:00:00').getTime();
      for (const w of weights) {
        const d = Math.abs(new Date(w.date + 'T12:00:00').getTime() - t);
        if (!best || d < best.d) best = { d, w: w.weight };
      }
      // A weigh-in more than 10 days from the measurement isn't the same body.
      return best && best.d <= 10 * 86400000 ? best.w : null;
    };
    return ($_tracks as any[])
      .filter((t) => t.name === 'body_fat' && t.value > 0)
      .map((t) => {
        const w = nearestWeight(t.date);
        return w ? { date: t.date, bfPct: t.value, weightKg: w } : null;
      })
      .filter(Boolean) as BodyFatPoint[];
  });

  // Protein adherence over the last 14 days.
  const proteinAdherence = $derived.by(() => {
    const cutoff = shiftYmd(-14);
    const byDate = new Map<string, number>();
    for (const f of $_foodLogs as any[]) {
      if (f.date < cutoff) continue;
      byDate.set(f.date, (byDate.get(f.date) ?? 0) + (f.protein_g || 0));
    }
    let hit = 0;
    for (const g of byDate.values()) if (g >= proteinTargetG * 0.9) hit++;
    return { logged: byDate.size, hit };
  });

  const liftingSessions14 = $derived.by(() => {
    const cutoff = shiftYmd(-14);
    const days = new Set<string>();
    for (const l of $_logs as any[]) if (l.date >= cutoff) days.add(l.date);
    return days.size;
  });

  const verdict = $derived(
    recompVerdict({
      weightRateKgPerWeek: trend.rateKgPerWeek,
      trendSpanDays: trend.spanDays,
      currentWeightKg: currentWeight,
      strength,
      bodyFat: bodyFatPoints,
      proteinTargetG,
      proteinDaysHit: proteinAdherence.hit,
      proteinDaysLogged: proteinAdherence.logged,
      liftingSessions14
    })
  );

  const tone = $derived(verdictTone(verdict.direction));

  // Composition over time, when body fat has been measured more than once —
  // the chart that actually matters on a recomp: fat mass falling while lean
  // mass stays flat.
  const compositionSeries = $derived.by(() => {
    const pts = [...bodyFatPoints].sort((a, b) => a.date.localeCompare(b.date));
    return {
      fat: pts.map((p) => ({ date: p.date, value: +fatMass(p.weightKg, p.bfPct).toFixed(1) })),
      lean: pts.map((p) => ({ date: p.date, value: +leanMass(p.weightKg, p.bfPct).toFixed(1) }))
    };
  });

  const sportSessions14 = $derived.by(() => {
    const cutoff = shiftYmd(-14);
    return ($_activity as any[]).filter((a) => a.date >= cutoff && a.kind !== 'strength').length;
  });

  const calorieTarget = $derived(parseCalorieTarget($_goalReason));
</script>

<div class="page-hd">Progress</div>
<div class="page-sub">Is the weight coming off fat, or muscle?</div>

<div class="card verdict-card verdict-{tone}">
  <div class="verdict-tone-bar"></div>
  <div class="verdict-head">{verdict.headline}</div>
  <div class="verdict-detail">{verdict.detail}</div>
  <div class="verdict-conf">
    Confidence: <strong>{verdict.confidence}</strong>
    {#if verdict.confidence !== 'high'}
      · more data sharpens this
    {/if}
  </div>
</div>

{#if verdict.composition && verdict.composition.fatShare != null}
  <div class="card">
    <div class="card-lbl">Measured body composition</div>
    <div class="comp-split">
      <div class="comp-box">
        <div class="comp-v good">{verdict.composition.fatKg > 0 ? '−' : '+'}{Math.abs(verdict.composition.fatKg).toFixed(1)} kg</div>
        <div class="comp-l">fat</div>
      </div>
      <div class="comp-box">
        <div class="comp-v" class:bad={verdict.composition.leanKg > 0.5}>
          {verdict.composition.leanKg > 0 ? '−' : '+'}{Math.abs(verdict.composition.leanKg).toFixed(1)} kg
        </div>
        <div class="comp-l">lean mass</div>
      </div>
      <div class="comp-box">
        <div class="comp-v">{Math.round(verdict.composition.fatShare * 100)}%</div>
        <div class="comp-l">of loss was fat</div>
      </div>
    </div>
    <div class="comp-bar">
      <div class="comp-bar-fat" style="width:{Math.round(verdict.composition.fatShare * 100)}%"></div>
    </div>
    <div class="comp-foot">
      Over {verdict.composition.spanDays} days. A well-run cut keeps this bar at 75% or above.
    </div>
  </div>

  {#if compositionSeries.fat.length >= 2}
    <div class="card">
      <div class="card-lbl">Fat mass vs lean mass</div>
      <MiniChart data={compositionSeries.fat} color="var(--red)" unit=" kg fat" />
      <div style="margin-top:12px"></div>
      <MiniChart data={compositionSeries.lean} color="var(--green, #2ecc71)" unit=" kg lean" />
      <div class="comp-foot">
        The shape you want: the red line falling, the green line flat or rising.
      </div>
    </div>
  {/if}
{/if}

<div class="card">
  <div class="card-lbl">The evidence</div>
  {#each verdict.evidence as e}
    <div class="ev-row">
      <span class="ev-label">{e.label}</span>
      <span class="ev-value ev-{e.verdict}">{e.value}</span>
    </div>
  {/each}
  <div class="ev-foot">
    Every claim above is derived from what you logged — nothing is assumed.
  </div>
</div>

{#if verdict.levers.length > 0}
  <div class="card">
    <div class="card-lbl">What to change</div>
    {#each verdict.levers as lever, i}
      <div class="lever">
        <span class="lever-n">{i + 1}</span>
        <span class="lever-t">{lever}</span>
      </div>
    {/each}
  </div>
{/if}

<div class="card">
  <div class="card-lbl">Last 14 days</div>
  <div class="stat-grid">
    <div class="stat">
      <div class="stat-v">{liftingSessions14}</div>
      <div class="stat-l">lifting sessions</div>
    </div>
    <div class="stat">
      <div class="stat-v">{sportSessions14}</div>
      <div class="stat-l">sport / cardio</div>
    </div>
    <div class="stat">
      <div class="stat-v">{proteinAdherence.hit}<span class="stat-sub">/{proteinAdherence.logged || 0}</span></div>
      <div class="stat-l">protein days hit</div>
    </div>
    <div class="stat">
      <div class="stat-v">{calorieTarget ?? '—'}</div>
      <div class="stat-l">kcal target</div>
    </div>
  </div>
</div>

{#if bodyFatPoints.length < 2}
  <div class="note-box warn">
    📏 <strong>Measure body fat to get a direct answer.</strong>
    Right now the verdict is inferred from weight and strength. Two body-fat
    measurements a month apart turn that inference into an actual measurement of
    how much fat and how much muscle you've lost.
    <a href="{base}/#body-goals" class="nb-link">Measure it in Body &amp; Goals →</a>
  </div>
{/if}

<style>
  .verdict-card{position:relative;overflow:hidden}
  .verdict-tone-bar{position:absolute;left:0;top:0;bottom:0;width:4px}
  .verdict-good .verdict-tone-bar{background:var(--green,#2ecc71)}
  .verdict-warn .verdict-tone-bar{background:var(--amber)}
  .verdict-bad .verdict-tone-bar{background:var(--red)}
  .verdict-neutral .verdict-tone-bar{background:var(--border2)}
  .verdict-head{font-size:19px;font-weight:800;color:#fff;line-height:1.25;margin-bottom:8px;padding-left:10px}
  .verdict-detail{font-size:13px;color:var(--text);line-height:1.55;padding-left:10px}
  .verdict-conf{font-size:10.5px;color:var(--muted);margin-top:10px;padding-left:10px;text-transform:lowercase}

  .comp-split{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
  .comp-box{text-align:center}
  .comp-v{font-size:17px;font-weight:800;color:var(--text)}
  .comp-v.good{color:var(--green,#2ecc71)}
  .comp-v.bad{color:var(--red)}
  .comp-l{font-size:10px;color:var(--muted);margin-top:2px}
  .comp-bar{height:8px;border-radius:999px;background:var(--red);overflow:hidden}
  .comp-bar-fat{height:100%;background:var(--green,#2ecc71)}
  .comp-foot{font-size:10.5px;color:var(--muted);margin-top:8px;line-height:1.45;text-align:center}

  .ev-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12.5px}
  .ev-label{color:var(--muted)}
  .ev-value{font-weight:700;text-align:right}
  .ev-good{color:var(--green,#2ecc71)}
  .ev-warn{color:var(--amber)}
  .ev-bad{color:var(--red)}
  .ev-neutral{color:var(--muted)}
  .ev-foot{font-size:10.5px;color:var(--muted);margin-top:8px;line-height:1.4}

  .lever{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border)}
  .lever:last-child{border-bottom:none}
  .lever-n{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:var(--ab);color:var(--amber);font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center}
  .lever-t{font-size:12.5px;line-height:1.5;color:var(--text)}

  .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .stat{text-align:center}
  .stat-v{font-size:19px;font-weight:800;color:var(--amber)}
  .stat-sub{font-size:12px;color:var(--muted);font-weight:600}
  .stat-l{font-size:9.5px;color:var(--muted);margin-top:2px;line-height:1.3}

  .nb-link{display:block;margin-top:8px;color:var(--amber);font-weight:700;font-size:12px;text-decoration:none}
</style>
