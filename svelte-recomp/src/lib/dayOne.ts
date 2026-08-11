// DAY ONE — what the app can honestly say before it has any data.
//
// The Pulse orb is the face of RecompOS, and on a brand-new account it rendered
// "—" at 0% fill with "-- kg lost" underneath. recompScore is RIGHT to return
// `insufficient` (it will not invent a verdict from nothing), but that left the
// single most prominent element in the app blank at the exact moment a new user
// decides whether to come back. Seven of the eight accounts that ever wrote a
// row wrote between one and four and never returned.
//
// The fix is not to fake the score. It is to answer a DIFFERENT question — one
// that IS fully answerable from what onboarding already collected: not "how is
// the recomp going" (unknowable on day one) but "what is the plan, and what do
// I do first". Height, age, sex, activity and goal give a real calorie target,
// a real protein target and a real date, with no logs at all.
//
// Once there is enough data for a genuine verdict, this disappears and the orb
// takes over — see TodayPulse.svelte.

// Explicit .ts extensions: scripts/selfcheck.js imports this module directly under
// node's type-stripping, which does not resolve extensionless specifiers. tsconfig
// sets rewriteRelativeImportExtensions, so the build rewrites these normally.
import { projectGoal, type ActivityLevel } from './tdee.ts';
import { ageFrom, type Profile } from './profile.ts';
import { shiftYmd } from './date.ts';

/** Protein per kg of GOAL bodyweight — the muscle-retention lever in a deficit. */
const PROTEIN_G_PER_KG = 1.8;

export interface FirstStep {
  key: 'weigh' | 'food' | 'train' | 'watch';
  label: string;
  hint: string;
  href: string;
  done: boolean;
}

export interface DayOnePlan {
  targetKcal: number;
  proteinG: number;
  maintenanceKcal: number;
  kgToLose: number;
  weeksToGoal: number;
  /** YYYY-MM-DD the projection lands on, so the goal is a date and not a vibe. */
  goalDate: string;
  goalKg: number;
  perWeekKg: number;
  headline: string;
  steps: FirstStep[];
  stepsDone: number;
}

export interface DayOneInput {
  profile: Partial<Profile> | null | undefined;
  currentWeightKg: number | null;
  weighInCount: number;
  foodLogCount: number;
  workoutLogCount: number;
  hasWatchData: boolean;
  now?: Date;
}

/**
 * The plan, or null when the profile can't support one (onboarding incomplete).
 * Never throws and never guesses a missing field — a partial profile returns
 * null rather than a projection built on an assumed height.
 */
export function dayOnePlan(input: DayOneInput): DayOnePlan | null {
  const p = input.profile;
  const now = input.now ?? new Date();
  const age = ageFrom(p?.birth_year, now);
  const heightCm = p?.height_cm ?? null;
  const sex = p?.sex ?? null;
  const goalKg = p?.goal_kg ?? null;
  // Fall back to the profile's start weight when they haven't weighed in yet:
  // onboarding asks for a weight, so this is a real number, not an assumption.
  const weightKg = input.currentWeightKg ?? p?.start_kg ?? null;

  if (!age || !heightCm || (sex !== 'male' && sex !== 'female') || !goalKg || !weightKg) return null;
  if (heightCm < 100 || heightCm > 250 || weightKg <= 0 || goalKg <= 0) return null;

  const activity = (p?.activity_level ?? 'moderate') as ActivityLevel;
  const proj = projectGoal({ weightKg, heightCm, age, gender: sex, activityLevel: activity }, goalKg);

  const perWeekKg = proj.weeksToGoal > 0 ? proj.kgToLose / proj.weeksToGoal : 0;
  const goalDate = shiftYmd(proj.weeksToGoal * 7, now);

  const steps: FirstStep[] = [
    {
      key: 'weigh', label: 'Log your first weigh-in', href: '/progress',
      hint: 'Same time each morning. Two weeks of dots is what turns the scale into a trend.',
      done: input.weighInCount > 0,
    },
    {
      key: 'food', label: 'Log one full day of food', href: '/recipes',
      hint: `One honest day tells the app what your ${proj.targetIntakeKcal} kcal actually looks like.`,
      done: input.foodLogCount > 0,
    },
    {
      key: 'train', label: 'Record one workout', href: '/workouts',
      hint: 'Your lifts are the proof the weight coming off is fat and not muscle.',
      done: input.workoutLogCount > 0,
    },
    {
      key: 'watch', label: 'Connect your watch', href: '/progress',
      hint: 'Sleep and heart rate turn the daily verdict from a guess into a reading.',
      done: input.hasWatchData,
    },
  ];

  const stepsDone = steps.filter((s) => s.done).length;

  const headline =
    proj.kgToLose <= 0
      ? `You're at your goal weight. Hold ${Math.round(proj.tdee)} kcal a day and keep the lifts heavy.`
      : `${fmtKg(proj.kgToLose)} kg to go. At ${fmtKg(perWeekKg)} kg a week that's about ${proj.weeksToGoal} week${proj.weeksToGoal === 1 ? '' : 's'}.`;

  return {
    targetKcal: proj.targetIntakeKcal,
    proteinG: Math.round(goalKg * PROTEIN_G_PER_KG),
    maintenanceKcal: proj.tdee,
    kgToLose: proj.kgToLose,
    weeksToGoal: proj.weeksToGoal,
    goalDate,
    goalKg,
    perWeekKg,
    headline,
    steps,
    stepsDone,
  };
}

function fmtKg(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}

/** "2026-11-04" -> "4 Nov". A date makes a goal real in a way "12 weeks" never does. */
export function goalDateLabel(ymdStr: string): string {
  const [y, m, d] = ymdStr.split('-').map(Number);
  if (!y || !m || !d) return ymdStr;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}
