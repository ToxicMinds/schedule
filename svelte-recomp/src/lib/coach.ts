// Daily Focus coaching engine.
//
// Turns the raw signals the app already collects (calories, protein, sleep,
// steps, water, weight trend, workouts — including watch/Health-Connect data)
// into a short, prioritised list of ACTIONABLE guidance framed toward the
// user's goal weight. The whole point is to answer "what should I focus on
// today to get to my goal — sustainably, with a body worth keeping" rather
// than parroting numbers the watch already shows.
//
// Pure + framework-free so it's trivially unit-testable and reusable.

export type Severity = 'bad' | 'warn' | 'good' | 'info';

export interface FocusItem {
  id: string;
  severity: Severity;
  icon: string;
  title: string;
  /** One actionable coaching sentence — a "do something", not a number. */
  msg: string;
  /** Optional compact metric shown on the right (e.g. "1850 / 2100 kcal"). */
  metric?: string;
  /** Optional in-app nav target (relative, base is prepended by the caller). */
  href?: string;
}

export interface CoachInput {
  goalKg: number;
  currentWeight: number | null;
  /** kg/week; positive = losing weight. Regression-smoothed, not point-to-point. */
  weeklyLossRate: number;
  weeksToGoal: number | string;
  /** True when weight has barely moved for weeks while still above goal. */
  plateau: boolean;
  /** Roughly how many weeks the plateau has lasted (for the copy). */
  plateauWeeks: number;

  /** Daily calorie target (from the TDEE-backed goal). null if not set yet. */
  calorieTarget: number | null;
  todayKcal: number | null;
  /** Sum of calories logged Monday..today (inclusive). */
  weekKcalSoFar: number;
  /** 1 (Mon) .. 7 (Sun) — days elapsed this week including today. */
  daysElapsedThisWeek: number;

  proteinTarget: number;
  todayProtein: number | null;

  sleepHours: number | null;
  /** Optional 1..5-ish subjective/derived quality; null if unknown. */
  sleepQuality: number | null;

  stepsToday: number | null;
  stepsWeekAvg: number | null;

  /** Hydration in LITRES (the user thinks in litres, not glasses). */
  waterToday: number;
  waterTarget: number;

  /** What today is, activity-wise, derived from the training plan. */
  dayKind: 'gym' | 'active' | 'rest';
  /** Human label for today's activity (e.g. "Badminton", "Heavy Lower Body"). */
  activityLabel: string;
  workoutDoneToday: boolean;

  /** Local hour 0..23 — lets nudges respect time of day. */
  hour: number;
}

const SEV_WEIGHT: Record<Severity, number> = { bad: 0, warn: 1, info: 2, good: 3 };

/**
 * Extract the TDEE-backed daily intake target the user committed to, which the
 * "Set as my goal" flow embeds into user_settings.goal_reason as
 * "...target intake ~2100 kcal/day...". Returns null when no such goal exists.
 */
export function parseCalorieTarget(goalReason: string | null | undefined): number | null {
  if (!goalReason) return null;
  const m = goalReason.match(/target intake\s*~?\s*([0-9]{3,5})\s*kcal/i);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return v > 0 ? v : null;
}

/** Suggested daily water target in LITRES — ~30 ml/kg of fluid, sane bounds. */
export function waterTargetLitres(weightKg: number | null): number {
  if (!weightKg || weightKg <= 0) return 3;
  const l = (weightKg * 30) / 1000; // 30 ml/kg
  const clamped = Math.max(2.5, Math.min(4, l));
  return Math.round(clamped / 0.25) * 0.25; // nearest 250 ml
}

export interface WeightTrend {
  /** kg/week; positive = losing. Least-squares slope, robust to daily noise. */
  rateKgPerWeek: number;
  /** Sustained near-flat trend over weeks while above goal. */
  plateau: boolean;
  plateauWeeks: number;
  /** Days of data the trend was fit over. */
  spanDays: number;
}

/**
 * Robust weight trend from recent weigh-ins. Point-to-point deltas are
 * dominated by day-to-day water fluctuation (a single 110.1 kg morning
 * followed by 112 kg is noise, not a 2 kg loss) — so we fit a least-squares
 * line over the last ~28 days and read its slope. Also flags a genuine
 * plateau (barely moving for weeks) so the coach can help BREAK it, which is
 * the whole point of the app for a stuck user.
 */
export function weightTrend(
  points: Array<{ date: string; weight: number }>,
  goalKg: number,
  windowDays = 28
): WeightTrend {
  const empty: WeightTrend = { rateKgPerWeek: 0, plateau: false, plateauWeeks: 0, spanDays: 0 };
  if (!points || points.length < 2) return empty;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const lastDate = new Date(sorted[sorted.length - 1].date).getTime();
  const cutoff = lastDate - windowDays * 86400000;
  const win = sorted.filter((p) => new Date(p.date).getTime() >= cutoff);
  if (win.length < 2) return empty;

  const t0 = new Date(win[0].date).getTime();
  const xs = win.map((p) => (new Date(p.date).getTime() - t0) / 86400000); // days
  const ys = win.map((p) => p.weight);
  const spanDays = xs[xs.length - 1];
  if (spanDays <= 0) return empty;

  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slopePerDay = den === 0 ? 0 : num / den; // kg/day (negative = losing)
  const rateKgPerWeek = -slopePerDay * 7;

  const currentWeight = ys[ys.length - 1];
  // Plateau: essentially flat (<0.3 kg/wk either way) over 2+ weeks of data,
  // while still above goal.
  const plateau = spanDays >= 14 && Math.abs(rateKgPerWeek) < 0.3 && currentWeight > goalKg;
  const plateauWeeks = plateau ? Math.round(spanDays / 7) : 0;
  return { rateKgPerWeek, plateau, plateauWeeks, spanDays };
}

/**
 * A rotating "movement snack" — something to do RIGHT NOW that changes
 * through the day (keyed by hour). On training/active days it's chair-friendly
 * mobility to prime the body before the session; on rest days it's a nudge to
 * get up and move (a short walk). Generic mobility/movement only — no medical
 * or loaded-exercise prescriptions.
 */
export function movementSnack(dayKind: 'gym' | 'active' | 'rest', hour: number): { icon: string; title: string; msg: string } {
  const prime = [
    'Stand up and do 10 slow bodyweight squats to wake the legs up.',
    'Seated: 10 thoracic rotations each side — twist gently, open the chest.',
    'Hip-flexor stretch: half-kneel each side 30s. Undoes hours of sitting.',
    '20 shoulder rolls back + 5 slow neck circles each way. Reset your posture.',
    'Deep squat hold 30s — sink into it, let the hips and ankles open.',
    'Standing hamstring reach 30s + 10 calf raises. Prep the posterior chain.',
    'Wrist + shoulder circles, then 10 band-free "pull-aparts" (arms wide). Prime for pulling.',
    'Ankle circles 10 each way + 5 slow lunges per leg. Get the joints ready.',
  ];
  const rest = [
    "Get up and walk for 5 minutes — even around the house. Break the sitting.",
    'Take the long way to refill your water. Steps are the easiest fat-loss lever.',
    'Stand, stretch tall, then a slow 2-minute walk. Every hour adds up.',
    'Do a lap outside if you can — 10 minutes of easy walking clears the head.',
    '10 squats + a short walk. Keep the body moving on your day off.',
    'Calves + hip-flexor stretch, then stroll for a few minutes.',
    'Set a 5-minute walk timer. Movement now, not just at the gym.',
    'Up on your feet — shoulder rolls, then a gentle walk to reset.',
  ];
  const list = dayKind === 'rest' ? rest : prime;
  const pick = list[((hour % 24) + list.length) % list.length];
  if (dayKind === 'gym' || dayKind === 'active') {
    return { icon: '🤸', title: 'Prime for later', msg: pick };
  }
  return { icon: '🚶', title: 'Move a little', msg: pick };
}

export function buildDailyFocus(i: CoachInput): FocusItem[] {
  const items: FocusItem[] = [];
  const evening = i.hour >= 17;
  const afternoon = i.hour >= 13;

  // — 1. Weight trend headline: is the pace right for a keepable body? —
  if (i.currentWeight != null) {
    const w = i.currentWeight;
    if (w <= i.goalKg) {
      items.push({
        id: 'weight-goal',
        severity: 'good',
        icon: '🎯',
        title: 'Goal weight reached',
        msg: `You're at ${w} kg — at or below your ${i.goalKg} kg target. Shift the mission from losing to recomp: hold calories near maintenance and let training reshape you.`,
      });
    } else {
      const rate = i.weeklyLossRate;
      const fast = w * 0.012; // >1.2%/wk risks muscle
      const lost = rate > 0;
      const metric = `${lost ? '−' : '+'}${Math.abs(rate).toFixed(2)} kg/wk`;
      if (i.plateau) {
        const forWk = i.plateauWeeks >= 2 ? `for ~${i.plateauWeeks} weeks` : 'for a while';
        items.push({
          id: 'weight-plateau',
          severity: 'warn',
          icon: '⚖️',
          title: 'Plateau — let\'s break it',
          msg: `You've hovered around ${w} kg ${forWk}. Judge fat loss by the weekly TREND, not the scale each morning (a 2 kg overnight swing is water, not fat). To move it, change ONE thing for 10–14 days: trim ~200 kcal/day, add ~2,000 steps, or tighten weekend logging — then reassess.`,
          metric,
        });
      } else if (!lost) {
        items.push({
          id: 'weight-up',
          severity: 'warn',
          icon: '📈',
          title: 'Trending up',
          msg: `The 4-week trend is drifting up, away from ${i.goalKg} kg. No panic — look at the week, not one weigh-in. Tighten logging and pick the deficit back up; you've done it before.`,
          metric,
        });
      } else if (rate > fast) {
        items.push({
          id: 'weight-fast',
          severity: 'warn',
          icon: '🐇',
          title: 'Dropping fast',
          msg: `${metric} is quick — good for the scale but watch the muscle you're training for. Keep protein high and don't deepen the deficit further.`,
          metric,
        });
      } else {
        const wk = typeof i.weeksToGoal === 'number' && i.weeksToGoal > 0 ? `~${i.weeksToGoal} wks to ${i.goalKg} kg` : `heading to ${i.goalKg} kg`;
        items.push({
          id: 'weight-ontrack',
          severity: 'good',
          icon: '📉',
          title: 'On a sustainable pace',
          msg: `${metric} is the sweet spot — fast enough to see it, slow enough to keep muscle. ${wk}. Keep doing exactly this.`,
          metric,
        });
      }
    }
  }

  // — 2. Weekly calorie margin: the "watch your budget" feature. —
  if (i.calorieTarget && i.calorieTarget > 0) {
    const target = i.calorieTarget;
    const days = Math.max(1, i.daysElapsedThisWeek);
    const avg = Math.round(i.weekKcalSoFar / days);
    const weekBudget = target * 7;
    const remaining = weekBudget - i.weekKcalSoFar;
    const daysLeft = 7 - days; // whole days after today
    const perDayLeft = daysLeft > 0 ? Math.round(remaining / daysLeft) : remaining;
    const overPerDay = avg - target;
    const metric = `${avg} / ${target} avg`;

    if (i.weekKcalSoFar <= 0) {
      // nothing logged this week yet — only nudge later in the day
      if (afternoon) {
        items.push({
          id: 'cal-log',
          severity: 'info',
          icon: '🍽️',
          title: 'Log your food',
          msg: `No calories logged this week yet. What isn't tracked drifts — a 20-second scan keeps your ${target} kcal target honest.`,
          href: '/recipes',
        });
      }
    } else if (overPerDay > target * 0.12) {
      items.push({
        id: 'cal-over',
        severity: overPerDay > target * 0.22 ? 'bad' : 'warn',
        icon: '🔥',
        title: 'Over your calorie budget',
        msg: daysLeft > 0
          ? `Averaging ${overPerDay} kcal/day over target. You've got ${Math.max(0, perDayLeft)} kcal/day for the next ${daysLeft} day${daysLeft === 1 ? '' : 's'} to save the week — lean, high-protein days from here.`
          : `You finished the week ~${overPerDay} kcal/day over. Not a failure — just reset tomorrow and protect the deficit.`,
        metric,
        href: '/recipes',
      });
    } else if (daysLeft > 0 && perDayLeft < target * 0.7) {
      items.push({
        id: 'cal-frontload',
        severity: 'warn',
        icon: '📊',
        title: 'Front-loaded your week',
        msg: `Only ~${Math.max(0, perDayLeft)} kcal/day left for the last ${daysLeft} day${daysLeft === 1 ? '' : 's'} to stay on budget. Bank a lighter day or two now so the weekend isn't a cliff.`,
        metric,
        href: '/recipes',
      });
    } else {
      items.push({
        id: 'cal-ontrack',
        severity: 'good',
        icon: '✅',
        title: 'Calories on budget',
        msg: `Averaging ${avg} kcal — right on your ${target} target. This is the discipline that gets you to ${i.goalKg} kg. Stay boring.`,
        metric,
      });
    }
  } else if (i.currentWeight != null) {
    items.push({
      id: 'cal-nogoal',
      severity: 'info',
      icon: '🧮',
      title: 'Set a real calorie target',
      msg: `You're logging weight but chasing no number. Open Body & Goals to get a TDEE-based daily calorie target — then every meal has a purpose.`,
    });
  }

  // — 3. Protein: the non-negotiable for a body worth keeping. —
  if (i.proteinTarget > 0) {
    const p = i.todayProtein;
    const target = i.proteinTarget;
    if (p == null || p <= 0) {
      if (afternoon) {
        items.push({
          id: 'protein-none',
          severity: 'warn',
          icon: '🥩',
          title: 'No protein logged yet',
          msg: `Aim for ${target} g today. In a deficit, protein is what decides whether you lose fat or muscle — front-load it at every meal.`,
          metric: `0 / ${target} g`,
          href: '/recipes',
        });
      }
    } else if (p < target * 0.6 && afternoon) {
      items.push({
        id: 'protein-low',
        severity: 'warn',
        icon: '🥩',
        title: 'Behind on protein',
        msg: `${Math.round(p)} g so far — you need ~${Math.max(0, Math.round(target - p))} g more. Make the next meal protein-first to protect muscle in your cut.`,
        metric: `${Math.round(p)} / ${target} g`,
        href: '/recipes',
      });
    } else if (p >= target * 0.9) {
      items.push({
        id: 'protein-hit',
        severity: 'good',
        icon: '💪',
        title: 'Protein locked in',
        msg: `${Math.round(p)} g of ${target} g — this is exactly how you keep muscle while the fat comes off. Great habit.`,
        metric: `${Math.round(p)} / ${target} g`,
      });
    }
  }

  // — 4. Sleep: recovery, cravings and fat-loss hormones. —
  if (i.sleepHours != null && i.sleepHours > 0) {
    const h = i.sleepHours;
    const metric = `${h.toFixed(1)} h`;
    if (h < 6) {
      items.push({
        id: 'sleep-low',
        severity: 'bad',
        icon: '😴',
        title: 'Under-slept',
        msg: `Only ${metric} last night. Short sleep spikes cortisol and hunger and blunts recovery — protect tonight: screens off early, aim for 7½ h+.`,
        metric,
      });
    } else if (h < 7) {
      items.push({
        id: 'sleep-ok',
        severity: 'warn',
        icon: '😴',
        title: 'Sleep a little short',
        msg: `${metric} is okay but not ideal for recovery and appetite control. An extra 30–45 min tonight makes tomorrow's deficit feel easier.`,
        metric,
      });
    } else {
      items.push({
        id: 'sleep-good',
        severity: 'good',
        icon: '🌙',
        title: 'Well recovered',
        msg: `${metric} of sleep — appetite hormones and recovery are on your side today. Good day to train hard.`,
        metric,
      });
    }
  }

  // — 5. Steps / NEAT: the easiest fat-loss lever there is. —
  {
    const avg = i.stepsWeekAvg;
    const today = i.stepsToday;
    if (avg != null && avg > 0 && avg < 6000) {
      items.push({
        id: 'steps-low-avg',
        severity: 'warn',
        icon: '🚶',
        title: 'Move more',
        msg: `Averaging ${Math.round(avg).toLocaleString()} steps/day. NEAT burns more than the gym — a 15-min walk after two meals closes most of the gap.`,
        metric: `${Math.round(avg).toLocaleString()}/day`,
      });
    } else if (today != null && today > 0 && today < 3000 && afternoon) {
      items.push({
        id: 'steps-low-today',
        severity: 'info',
        icon: '🚶',
        title: 'Low steps today',
        msg: `Only ${today.toLocaleString()} steps so far. A brisk 20-min walk now is free deficit and clears your head.`,
        metric: `${today.toLocaleString()}`,
      });
    } else if (avg != null && avg >= 8000) {
      items.push({
        id: 'steps-good',
        severity: 'good',
        icon: '🏃',
        title: 'Great daily movement',
        msg: `${Math.round(avg).toLocaleString()} steps/day average — this NEAT is quietly doing a huge share of your fat loss. Keep it up.`,
        metric: `${Math.round(avg).toLocaleString()}/day`,
      });
    }
  }

  // — 6. Water (litres): cheap appetite control + training support. —
  if (i.waterToday < i.waterTarget && afternoon) {
    const metric = `${i.waterToday.toFixed(1)} / ${i.waterTarget.toFixed(1)} L`;
    items.push({
      id: 'water-low',
      severity: 'info',
      icon: '💧',
      title: 'Hydrate',
      msg: `${metric} so far. Thirst masquerades as hunger — a glass before each meal curbs snacking and helps you train. Keep a bottle in sight.`,
      metric,
      href: '/recipes',
    });
  }

  // — 7. Today's activity + a rotating movement snack. —
  // Distinguish a true rest day from an ACTIVE day (badminton/cardio) that
  // has no gym "session" attached — the old logic wrongly called badminton
  // days "recovery".
  if (i.dayKind === 'gym' && !i.workoutDoneToday && !evening) {
    items.push({
      id: 'workout-today',
      severity: 'info',
      icon: '🏋️',
      title: `Training day — ${i.activityLabel || 'gym'}`,
      msg: `You've got a lifting session today. Eat protein beforehand, chase progressive overload, and log it — that record is what turns effort into a plan.`,
      href: '/workouts',
    });
  } else if (i.dayKind === 'gym' && i.workoutDoneToday) {
    items.push({
      id: 'workout-done',
      severity: 'good',
      icon: '✔️',
      title: 'Session logged',
      msg: `Training done and recorded. Now feed the recovery — protein and sleep are where the muscle is actually built.`,
    });
  } else if (i.dayKind === 'active') {
    items.push({
      id: 'active-today',
      severity: 'info',
      icon: '🏸',
      title: `${i.activityLabel || 'Active'} tonight`,
      msg: `Today is your ${(i.activityLabel || 'cardio').toLowerCase()} day — this IS your fat-loss cardio, not a rest day. Eat a bit lighter through the day, hydrate, and go move hard. It counts.`,
      href: '/workouts',
    });
  }
  // Movement snack — rotates through the day (see movementSnack). On
  // gym/active days it's priming mobility "until you get there"; on rest
  // days it's a nudge to get up and walk.
  {
    const snack = movementSnack(i.dayKind, i.hour);
    items.push({
      id: 'move-snack',
      severity: i.dayKind === 'rest' ? 'info' : 'info',
      icon: snack.icon,
      title: snack.title,
      msg: snack.msg,
    });
  }

  // Prioritise: worst-first, then a stable importance order within a severity.
  const order = [
    'weight-plateau', 'weight-up', 'weight-fast', 'weight-ontrack', 'weight-goal',
    'cal-over', 'cal-frontload', 'cal-ontrack', 'cal-log', 'cal-nogoal',
    'protein-none', 'protein-low', 'protein-hit',
    'sleep-low', 'sleep-ok', 'sleep-good',
    'steps-low-avg', 'steps-low-today', 'steps-good',
    'water-low',
    'workout-today', 'active-today', 'workout-done', 'move-snack', 'workout-rest',
  ];
  const rank = (id: string) => { const x = order.indexOf(id); return x < 0 ? 999 : x; };

  return items.sort((a, b) => {
    const s = SEV_WEIGHT[a.severity] - SEV_WEIGHT[b.severity];
    if (s !== 0) return s;
    return rank(a.id) - rank(b.id);
  });
}
