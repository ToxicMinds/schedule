// TDEE (Total Daily Energy Expenditure) and deficit/surplus math --
// Mifflin-St Jeor formula (the current gold-standard BMR equation,
// more accurate than the older Harris-Benedict formula for most people).
// This exists so a "goal weight" is never just a bare number again: it
// comes with an actual calorie target and a realistic timeline attached.

export interface TdeeInput {
  weightKg: number;
  heightCm: number;
  age: number;
  gender: 'male' | 'female';
  activityLevel: ActivityLevel;
}

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,      // desk job, little/no exercise
  light: 1.375,        // light exercise 1-3 days/week
  moderate: 1.55,      // moderate exercise 3-5 days/week (matches ~3 lifting + 2 badminton nights)
  active: 1.725,       // hard exercise 6-7 days/week
  very_active: 1.9,    // very hard exercise + physical job
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary (desk job, little exercise)',
  light: 'Light (exercise 1-3 days/week)',
  moderate: 'Moderate (3-5 days/week — matches your gym + badminton schedule)',
  active: 'Active (hard exercise 6-7 days/week)',
  very_active: 'Very active (hard exercise + physical job)',
};

export function calcBmr({ weightKg, heightCm, age, gender }: Omit<TdeeInput, 'activityLevel'>): number {
  // Mifflin-St Jeor: BMR = 10W + 6.25H - 5A + (5 for men, -161 for women)
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return gender === 'male' ? base + 5 : base - 161;
}

export function calcTdee(input: TdeeInput): number {
  return Math.round(calcBmr(input) * ACTIVITY_MULTIPLIERS[input.activityLevel]);
}

export interface GoalProjection {
  targetKg: number;
  kgToLose: number;
  tdee: number;
  dailyDeficitKcal: number;
  targetIntakeKcal: number;
  weeksToGoal: number;
}

/**
 * A moderate, sustainable deficit (~20% below TDEE, capped at 750
 * kcal/day) targeting roughly 0.5-0.75kg/week loss -- fast enough to see
 * progress, conservative enough to preserve muscle during a recomp
 * (aggressive deficits risk losing the muscle mass being trained for).
 */
export function projectGoal(current: TdeeInput, targetKg: number): GoalProjection {
  const tdee = calcTdee(current);
  const kgToLose = Math.max(0, current.weightKg - targetKg);
  const dailyDeficitKcal = Math.min(750, Math.round(tdee * 0.2));
  const targetIntakeKcal = tdee - dailyDeficitKcal;
  // ~7700 kcal per kg of fat, standard approximation.
  const weeksToGoal = kgToLose > 0 ? Math.ceil((kgToLose * 7700) / (dailyDeficitKcal * 7)) : 0;
  return { targetKg, kgToLose, tdee, dailyDeficitKcal, targetIntakeKcal, weeksToGoal };
}
