// Weekly muscle-group VOLUME balance.
//
// The app already has a Fitbod-style muscle *recovery* grid (how long since a
// muscle was worked). That answers "what's fresh to train today" — but not the
// question that decides whether a muscle actually grows: am I giving it enough
// HARD SETS PER WEEK? The hypertrophy literature converges on ~10 working sets
// per muscle per week as a productive floor (MEV≈8-10) and ~20 as the ceiling
// where returns flatten and junk volume/recovery cost climb (MAV≈18-22). This
// module counts a rolling week of working sets per muscle group and grades each
// against that range, so under- and over-trained muscles are named.
//
// Pure — no Svelte/Dexie — so it's unit-tested in selfcheck.js.

import type { StrengthLog } from './strength';

export type VolumeStatus = 'none' | 'low' | 'optimal' | 'high';

export interface MuscleVolume {
  group: string;
  sets: number;          // working sets this window
  status: VolumeStatus;
  /** How far from the nearest edge of the optimal band, in sets (0 when inside). */
  gap: number;
}

export interface VolumeReport {
  windowDays: number;
  perMuscle: MuscleVolume[];
  undertrained: string[]; // groups below the floor (incl. never trained)
  overreaching: string[]; // groups above the ceiling
  totalSets: number;
  headline: string | null;
}

/** Productive weekly working-set band per muscle (sets). */
export const SET_FLOOR = 10;
export const SET_CEILING = 20;
/** Below this, a muscle is essentially maintenance/neglected, not growing. */
export const SET_MIN_STIMULUS = 6;

function statusFor(sets: number): VolumeStatus {
  if (sets === 0) return 'none';
  if (sets < SET_MIN_STIMULUS) return 'low';
  if (sets > SET_CEILING) return 'high';
  if (sets >= SET_FLOOR) return 'optimal';
  return 'low'; // between MIN_STIMULUS and FLOOR — some stimulus, still under target
}

/** A working set: both reps and a positive load logged (bodyweight moves that
 *  log reps with null weight still count as a set — reps present is enough). */
function isWorkingSet(s: { reps: number | null; weight_kg: number | null }): boolean {
  return s != null && s.reps != null && s.reps > 0;
}

/**
 * @param logs        Every logged session (date, exercise_name, sets).
 * @param groupsFor   Resolver: exercise name -> the muscle groups it trains.
 *                    A compound counts toward EACH group it hits (that's how
 *                    weekly volume is actually accrued).
 * @param groups      The canonical group list to grade (so an untouched muscle
 *                    still shows up as neglected rather than silently missing).
 * @param opts.windowDays  Rolling window, default 7.
 * @param opts.asOf   ISO/YMD "today"; defaults to the latest log date.
 */
export function muscleVolume(
  logs: StrengthLog[],
  groupsFor: (exerciseName: string, muscleText?: string) => string[],
  groups: string[],
  opts: { windowDays?: number; asOf?: string } = {},
): VolumeReport {
  const windowDays = opts.windowDays ?? 7;
  const dates = logs.map((l) => l.date).filter(Boolean).sort();
  const asOf = opts.asOf || dates[dates.length - 1];
  const counts = new Map<string, number>();
  for (const g of groups) counts.set(g, 0);

  if (asOf) {
    const cutoff = shiftDays(asOf, -(windowDays - 1));
    for (const log of logs) {
      if (!log.date || log.date < cutoff || log.date > asOf) continue;
      const working = (log.sets || []).filter(isWorkingSet).length;
      if (working === 0) continue;
      for (const g of groupsFor(log.exercise_name)) {
        if (counts.has(g)) counts.set(g, (counts.get(g) || 0) + working);
      }
    }
  }

  const perMuscle: MuscleVolume[] = groups.map((group) => {
    const sets = counts.get(group) || 0;
    const status = statusFor(sets);
    const gap = status === 'low' || status === 'none' ? Math.max(0, SET_FLOOR - sets)
      : status === 'high' ? sets - SET_CEILING : 0;
    return { group, sets, status, gap };
  });

  const undertrained = perMuscle.filter((m) => m.status === 'none' || m.status === 'low').map((m) => m.group);
  const overreaching = perMuscle.filter((m) => m.status === 'high').map((m) => m.group);
  const totalSets = perMuscle.reduce((a, m) => a + m.sets, 0);

  let headline: string | null = null;
  if (totalSets === 0) headline = null;
  else if (undertrained.length > 0) {
    const worst = perMuscle.filter((m) => m.status !== 'high').sort((a, b) => a.sets - b.sets).slice(0, 2).map((m) => m.group);
    headline = `Under the ~${SET_FLOOR}-set weekly floor: ${worst.join(' & ')}. Add a set or two there.`;
  } else if (overreaching.length > 0) {
    headline = `${overreaching.join(' & ')} above ~${SET_CEILING} sets — plenty; make sure recovery keeps up.`;
  } else {
    headline = 'Every muscle is inside the productive weekly range. Hold this.';
  }

  return { windowDays, perMuscle, undertrained, overreaching, totalSets, headline };
}

function shiftDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}
