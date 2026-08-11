// The day-one plan, live. Mirrors stores/verdict.ts: one derived store the whole
// app shares, so the Today hero and anything else that wants to nudge a new user
// read the same numbers and can never disagree.
import { derived, type Readable } from 'svelte/store';
import { liveProfile, liveWeights, liveFoodLogs, liveWorkoutLogs, liveBiometrics } from './live';
import { dayOnePlan, type DayOnePlan } from '$lib/dayOne';

const _profile = liveProfile();
const _weights = liveWeights();
const _foodLogs = liveFoodLogs();
const _workoutLogs = liveWorkoutLogs();
const _bio = liveBiometrics();

export const dayOne: Readable<DayOnePlan | null> = derived(
  [_profile, _weights, _foodLogs, _workoutLogs, _bio],
  ([$profile, $weights, $foodLogs, $workoutLogs, $bio]) => {
    const weights = ($weights as any[]) ?? [];
    // liveWeights is unsorted; the LATEST weigh-in is what the projection runs off.
    let currentWeightKg: number | null = null;
    let latest = '';
    for (const w of weights) {
      if (w?.weight != null && w.date > latest) { latest = w.date; currentWeightKg = w.weight; }
    }
    return dayOnePlan({
      profile: $profile as any,
      currentWeightKg,
      weighInCount: weights.length,
      foodLogCount: (($foodLogs as any[]) ?? []).length,
      workoutLogCount: (($workoutLogs as any[]) ?? []).length,
      // Any biometric row at all means the watch has actually delivered something.
      hasWatchData: (($bio as any[]) ?? []).length > 0,
    });
  }
);
