// Recomp Quality Score — the app's one-glance answer to its own founding
// question: "is the weight coming off fat, or muscle — and am I doing this
// right?"
//
// Every screen already computes a PIECE of the answer (weight trend, strength
// retention, protein, readiness) but nothing fuses them into a single verdict
// with the ONE thing to fix next. That's what this does: a 0-100 score, a band,
// and the single highest-leverage lever, from data the app already has. Pure +
// unit-tested; no Svelte/Dexie.

export interface RecompInput {
  /** Weight-trend slope in kg/week; POSITIVE = losing (matches weightTrend.rateKgPerWeek). */
  weeklyLossRateKg: number | null;
  currentWeightKg: number | null;
  goalKg: number | null;
  /** From strengthTrend(): are the main lifts holding while fat comes off? */
  strength: { direction: 'up' | 'holding' | 'down' | 'insufficient'; avgPct: number } | null;
  /** Mean of recent days' (protein / target), as a 0-100 percentage. */
  proteinAdherencePct: number | null;
  /** Daily readiness score 0-100 (recovery/sustainability), if available. */
  readinessScore: number | null;
}

export interface RecompComponent {
  key: 'fatloss' | 'muscle' | 'protein' | 'recovery';
  name: string;
  score: number; // 0-100
  weight: number; // relative importance
  note: string;
}

export type RecompBand = 'dialed-in' | 'on-track' | 'mixed' | 'off-track' | 'insufficient';

export interface RecompScore {
  score: number; // 0-100
  band: RecompBand;
  headline: string;
  components: RecompComponent[];
  /** The single most valuable thing to change next, or null when dialed in. */
  topLever: { title: string; msg: string } | null;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/**
 * Score the fat-loss PACE. The evidence-based sweet spot for retaining muscle in
 * a deficit is ~0.5-1.0% of bodyweight lost per week: fast enough to see real
 * progress, slow enough that most of it is fat. Too slow (a stall) and too fast
 * (muscle at risk) both score down; maintaining at/below goal scores as success.
 */
function fatLossScore(pctPerWeek: number | null, atGoal: boolean): { score: number; note: string } {
  if (pctPerWeek == null) return { score: 60, note: 'Not enough weigh-ins to read a pace yet.' };

  // pctPerWeek is positive when losing.
  if (atGoal) {
    // At/under goal, holding steady (±0.35%/wk) is the win.
    const drift = Math.abs(pctPerWeek);
    if (drift <= 0.35) return { score: 100, note: 'Holding at goal — maintenance dialed in.' };
    if (pctPerWeek > 0) return { score: 80, note: 'Still drifting down past goal — ease the deficit.' };
    return { score: 70, note: 'Creeping up past goal — tighten intake a little.' };
  }

  if (pctPerWeek <= -0.3) return { score: 25, note: 'Weight is trending UP — the deficit has slipped.' };
  if (pctPerWeek < 0.15) return { score: 45, note: 'Essentially stalled — nudge the deficit to restart loss.' };
  if (pctPerWeek < 0.4) return { score: 78, note: 'Losing, a touch slow — fine if it feels sustainable.' };
  if (pctPerWeek <= 1.0) return { score: 100, note: 'Textbook fat-loss pace (~0.5-1%/wk).' };
  if (pctPerWeek <= 1.5) return { score: 62, note: 'Fast — protect muscle with protein + heavy lifting.' };
  return { score: 40, note: 'Very fast — high muscle-loss risk; add ~200 kcal.' };
}

function muscleScore(s: RecompInput['strength']): { score: number; note: string; known: boolean } {
  if (!s || s.direction === 'insufficient') {
    return { score: 60, note: 'Log a few weeks of lifts to prove muscle is holding.', known: false };
  }
  if (s.direction === 'up') return { score: 100, note: `Lifts climbing (+${s.avgPct}%) — building/keeping muscle.`, known: true };
  if (s.direction === 'holding') return { score: 85, note: 'Lifts holding steady — muscle is staying.', known: true };
  // down: scale by how much strength slipped.
  const drop = Math.abs(s.avgPct);
  const score = clamp(60 - drop * 6);
  return { score, note: `Lifts down ${drop}% — muscle may be leaving, not just fat.`, known: true };
}

/**
 * Fuse the pieces into one score. Components with no data are dropped and the
 * remaining weights are renormalised (same approach as the readiness score), so
 * a brand-new user still gets an honest partial verdict instead of a fake zero.
 */
export function recompScore(input: RecompInput): RecompScore {
  const atGoal =
    input.currentWeightKg != null && input.goalKg != null && input.currentWeightKg <= input.goalKg + 0.2;

  const pctPerWeek =
    input.weeklyLossRateKg != null && input.currentWeightKg && input.currentWeightKg > 0
      ? (input.weeklyLossRateKg / input.currentWeightKg) * 100
      : null;

  const fl = fatLossScore(pctPerWeek, atGoal);
  const ms = muscleScore(input.strength);

  const components: RecompComponent[] = [];
  // Fat loss and muscle are the two halves of "recomp"; protein is the biggest
  // controllable lever for muscle retention; recovery gates sustainability.
  components.push({ key: 'fatloss', name: 'Fat-loss pace', score: Math.round(fl.score), weight: 0.3, note: fl.note });
  components.push({ key: 'muscle', name: 'Muscle retention', score: Math.round(ms.score), weight: 0.3, note: ms.note });

  if (input.proteinAdherencePct != null) {
    const p = clamp(input.proteinAdherencePct);
    const note =
      p >= 90 ? 'Protein on point — muscle has what it needs.' :
      p >= 70 ? 'Protein close — push every meal to hit target.' :
      'Protein short — the #1 fix for keeping muscle in a cut.';
    components.push({ key: 'protein', name: 'Protein adherence', score: Math.round(p), weight: 0.25, note });
  }
  if (input.readinessScore != null) {
    const r = clamp(input.readinessScore);
    const note =
      r >= 70 ? 'Recovered — you can train hard and hold the deficit.' :
      r >= 45 ? 'Recovery is average — protect sleep to keep progress.' :
      'Under-recovered — poor sleep/stress will stall fat loss.';
    components.push({ key: 'recovery', name: 'Recovery', score: Math.round(r), weight: 0.15, note });
  }

  const known = components.filter((c) => !(c.key === 'muscle' && !ms.known));
  // Need at least the two core signals with real data to give a verdict.
  const haveCore = pctPerWeek != null && ms.known;
  const totalW = components.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(components.reduce((s, c) => s + (c.weight / totalW) * c.score, 0));

  if (!haveCore && known.length < 3) {
    return {
      score,
      band: 'insufficient',
      headline: 'Keep logging — a full recomp verdict needs a couple of weeks of weight and lifts.',
      components,
      topLever: {
        title: 'Log the basics daily',
        msg: 'Weigh in most mornings and record your main lifts. Two weeks of dots turns guesswork into a real "fat vs muscle" read.',
      },
    };
  }

  const band: RecompBand =
    score >= 80 ? 'dialed-in' : score >= 65 ? 'on-track' : score >= 45 ? 'mixed' : 'off-track';

  // The top lever is the lowest-scoring component with a concrete action.
  const lowest = [...components].sort((a, b) => a.score - b.score)[0];
  const topLever = band === 'dialed-in' ? null : leverFor(lowest, pctPerWeek);

  const headline =
    band === 'dialed-in' ? 'Dialed in — fat is leaving and muscle is staying. Hold the line.' :
    band === 'on-track' ? 'On track — the recomp is working; one tweak to tidy up.' :
    band === 'mixed' ? 'Mixed signals — you are losing weight but the quality needs work.' :
    'Off track — weight change is happening the wrong way. Fix the lever below first.';

  return { score, band, headline, components, topLever };
}

function leverFor(c: RecompComponent, pctPerWeek: number | null): { title: string; msg: string } {
  switch (c.key) {
    case 'protein':
      return { title: 'Raise protein first', msg: 'Front-load protein at every meal (~1.8 g/kg of goal weight). In a deficit it is the single biggest determinant of whether you lose fat or muscle.' };
    case 'muscle':
      return { title: 'Protect your strength', msg: 'Keep the load heavy — drop reps, not weight — and hit protein hard. Holding strength is the proof the scale drop is fat, not muscle.' };
    case 'recovery':
      return { title: 'Fix recovery', msg: 'Prioritise sleep (7.5 h+) and manage stress. Under-recovery raises hunger and cortisol and quietly stalls fat loss.' };
    case 'fatloss':
    default:
      if (pctPerWeek != null && pctPerWeek > 1.0)
        return { title: 'Slow the cut down', msg: 'You are losing too fast for muscle to keep up. Add ~200 kcal/day (ideally protein/carbs around training) to bring the pace into the 0.5-1%/wk zone.' };
      return { title: 'Restart the loss', msg: 'The trend has stalled. Change ONE thing for 10-14 days: trim ~200 kcal/day, add ~2,000 steps, or tighten weekend logging — then reassess.' };
  }
}
