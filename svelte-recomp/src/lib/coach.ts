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
  /** kg/week; positive = losing weight. */
  weeklyLossRate: number;
  weeksToGoal: number | string;

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

  waterToday: number;
  waterTarget: number;

  hasSessionToday: boolean;
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

/** Suggested daily water target (glasses) — ~35 ml/kg, 250 ml/glass, sane bounds. */
export function waterTargetGlasses(weightKg: number | null): number {
  if (!weightKg || weightKg <= 0) return 8;
  return Math.max(8, Math.min(14, Math.round((weightKg * 35) / 250)));
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
      const slow = w * 0.0025; // <0.25%/wk ~ stalled
      const metric = `${rate > 0 ? '−' : ''}${Math.abs(rate).toFixed(2)} kg/wk`;
      if (rate <= slow) {
        items.push({
          id: 'weight-stall',
          severity: 'warn',
          icon: '⚖️',
          title: 'Weight has stalled',
          msg: `Barely moving toward ${i.goalKg} kg. Nudge one lever, not five: trim ~150 kcal/day or add ~2,000 steps. Give it 10 days before changing again.`,
          metric,
        });
      } else if (rate > fast) {
        items.push({
          id: 'weight-fast',
          severity: 'warn',
          icon: '🐇',
          title: 'Dropping too fast',
          msg: `${metric} is great for the scale but risks the muscle you're training for. Don't deepen the deficit — eat to target and keep protein high.`,
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

  // — 6. Water: cheap appetite control + training support. —
  if (i.waterToday < i.waterTarget && afternoon) {
    items.push({
      id: 'water-low',
      severity: 'info',
      icon: '💧',
      title: 'Hydrate',
      msg: `${i.waterToday}/${i.waterTarget} glasses. Thirst masquerades as hunger — a glass before each meal curbs snacking and helps you train.`,
      metric: `${i.waterToday}/${i.waterTarget}`,
      href: '/recipes',
    });
  }

  // — 7. Training / recovery for today. —
  if (i.hasSessionToday && !i.workoutDoneToday && !evening) {
    items.push({
      id: 'workout-today',
      severity: 'info',
      icon: '🏋️',
      title: 'Training day',
      msg: `You've got a session scheduled. Eat protein beforehand, chase progressive overload, and log it — that record is what turns effort into a plan.`,
      href: '/workouts',
    });
  } else if (i.hasSessionToday && i.workoutDoneToday) {
    items.push({
      id: 'workout-done',
      severity: 'good',
      icon: '✔️',
      title: 'Session logged',
      msg: `Training done and recorded. Now feed the recovery — protein and sleep are where the muscle is actually built.`,
    });
  } else if (!i.hasSessionToday) {
    items.push({
      id: 'workout-rest',
      severity: 'info',
      icon: '🧘',
      title: 'Recovery day',
      msg: `No session today — that's by design. Walk, hydrate and sleep well; muscle is rebuilt on rest days, not just in the gym.`,
    });
  }

  // Prioritise: worst-first, then a stable importance order within a severity.
  const order = [
    'weight-stall', 'weight-fast', 'weight-ontrack', 'weight-goal',
    'cal-over', 'cal-frontload', 'cal-ontrack', 'cal-log', 'cal-nogoal',
    'protein-none', 'protein-low', 'protein-hit',
    'sleep-low', 'sleep-ok', 'sleep-good',
    'steps-low-avg', 'steps-low-today', 'steps-good',
    'water-low',
    'workout-today', 'workout-done', 'workout-rest',
  ];
  const rank = (id: string) => { const x = order.indexOf(id); return x < 0 ? 999 : x; };

  return items.sort((a, b) => {
    const s = SEV_WEIGHT[a.severity] - SEV_WEIGHT[b.severity];
    if (s !== 0) return s;
    return rank(a.id) - rank(b.id);
  });
}
