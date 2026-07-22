/**
 * Exercise-session intelligence (pure, testable).
 *
 * The OnePlus watch (via OHealth → Health Connect) records every workout and
 * badminton match as an `ExerciseSession` with a start/end and an
 * `exerciseType` code, plus separate `ActiveCaloriesBurned` / `Distance`
 * records over the same window. This module turns those raw Health Connect
 * records into normalized `ActivitySession` rows the app can show and coach on:
 * it labels the activity, matches the calories/distance that overlap each
 * session, and de-dupes overlapping duplicates (OHealth sometimes writes the
 * same match twice, or a manual + auto copy).
 *
 * It is deliberately free of Dexie / Capacitor imports so it can be unit
 * tested and reused on any platform.
 */

export type ActivityKind = 'sport' | 'cardio' | 'strength' | 'mind' | 'other';

export interface ActivitySession {
  id: string;
  user_id: string;
  date: string; // YMD of the session start (local)
  exercise_type: number;
  label: string;
  emoji: string;
  kind: ActivityKind;
  start: string; // ISO
  end: string; // ISO
  duration_min: number;
  active_kcal: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  source: 'watch';
  updated_at: string;
}

type Meta = { label: string; emoji: string; kind: ActivityKind };

/**
 * Health Connect `ExerciseSessionRecord.EXERCISE_TYPE_*` codes → friendly meta.
 * (Values are the stable androidx.health.connect exercise-type integers.)
 */
export const EXERCISE_TYPES: Record<number, Meta> = {
  0: { label: 'Workout', emoji: '🏋️', kind: 'other' },
  2: { label: 'Badminton', emoji: '🏸', kind: 'sport' },
  4: { label: 'Baseball', emoji: '⚾', kind: 'sport' },
  5: { label: 'Basketball', emoji: '🏀', kind: 'sport' },
  8: { label: 'Cycling', emoji: '🚴', kind: 'cardio' },
  9: { label: 'Cycling (indoor)', emoji: '🚴', kind: 'cardio' },
  10: { label: 'Boot camp', emoji: '🥾', kind: 'cardio' },
  11: { label: 'Boxing', emoji: '🥊', kind: 'sport' },
  13: { label: 'Calisthenics', emoji: '🤸', kind: 'strength' },
  14: { label: 'Cricket', emoji: '🏏', kind: 'sport' },
  16: { label: 'Dancing', emoji: '💃', kind: 'cardio' },
  25: { label: 'Elliptical', emoji: '🏃', kind: 'cardio' },
  26: { label: 'Exercise class', emoji: '🧎', kind: 'cardio' },
  27: { label: 'Fencing', emoji: '🤺', kind: 'sport' },
  31: { label: 'Frisbee', emoji: '🥏', kind: 'sport' },
  32: { label: 'Golf', emoji: '⛳', kind: 'sport' },
  33: { label: 'Breathing', emoji: '🧘', kind: 'mind' },
  34: { label: 'Gymnastics', emoji: '🤸', kind: 'sport' },
  35: { label: 'Handball', emoji: '🤾', kind: 'sport' },
  36: { label: 'HIIT', emoji: '🔥', kind: 'cardio' },
  37: { label: 'Hiking', emoji: '🥾', kind: 'cardio' },
  38: { label: 'Ice hockey', emoji: '🏒', kind: 'sport' },
  39: { label: 'Ice skating', emoji: '⛸️', kind: 'sport' },
  44: { label: 'Martial arts', emoji: '🥋', kind: 'sport' },
  46: { label: 'Paddling', emoji: '🛶', kind: 'cardio' },
  48: { label: 'Pilates', emoji: '🧘', kind: 'mind' },
  50: { label: 'Racquetball', emoji: '🎾', kind: 'sport' },
  51: { label: 'Rock climbing', emoji: '🧗', kind: 'strength' },
  53: { label: 'Rowing', emoji: '🚣', kind: 'cardio' },
  54: { label: 'Rowing machine', emoji: '🚣', kind: 'cardio' },
  55: { label: 'Rugby', emoji: '🏉', kind: 'sport' },
  56: { label: 'Running', emoji: '🏃', kind: 'cardio' },
  57: { label: 'Treadmill', emoji: '🏃', kind: 'cardio' },
  58: { label: 'Sailing', emoji: '⛵', kind: 'sport' },
  60: { label: 'Skating', emoji: '⛸️', kind: 'sport' },
  61: { label: 'Skiing', emoji: '⛷️', kind: 'sport' },
  62: { label: 'Snowboarding', emoji: '🏂', kind: 'sport' },
  64: { label: 'Soccer', emoji: '⚽', kind: 'sport' },
  65: { label: 'Softball', emoji: '🥎', kind: 'sport' },
  66: { label: 'Squash', emoji: '🎾', kind: 'sport' },
  68: { label: 'Stair climbing', emoji: '🪜', kind: 'cardio' },
  69: { label: 'Stair machine', emoji: '🪜', kind: 'cardio' },
  70: { label: 'Strength training', emoji: '🏋️', kind: 'strength' },
  71: { label: 'Stretching', emoji: '🤸', kind: 'mind' },
  72: { label: 'Surfing', emoji: '🏄', kind: 'sport' },
  73: { label: 'Swimming', emoji: '🏊', kind: 'cardio' },
  74: { label: 'Swimming (pool)', emoji: '🏊', kind: 'cardio' },
  75: { label: 'Table tennis', emoji: '🏓', kind: 'sport' },
  76: { label: 'Tennis', emoji: '🎾', kind: 'sport' },
  78: { label: 'Volleyball', emoji: '🏐', kind: 'sport' },
  79: { label: 'Walking', emoji: '🚶', kind: 'cardio' },
  80: { label: 'Water polo', emoji: '🤽', kind: 'sport' },
  81: { label: 'Weightlifting', emoji: '🏋️', kind: 'strength' },
  83: { label: 'Yoga', emoji: '🧘', kind: 'mind' }
};

export function describeExercise(type: number): Meta {
  return EXERCISE_TYPES[type] || { label: 'Workout', emoji: '💪', kind: 'other' };
}

function ymdLocal(d: string | number | Date): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** ms of overlap between [aS,aE] and [bS,bE]. */
function overlapMs(aS: number, aE: number, bS: number, bE: number): number {
  return Math.max(0, Math.min(aE, bE) - Math.max(aS, bS));
}

type Interval = { startTime: any; endTime: any };

/**
 * Sum a metric (via `pick`) across records that overlap [start,end]. When a
 * record only partially overlaps we pro-rate it by the fraction of the record
 * that falls inside the session — so a day-long "active calories" bucket
 * contributes only its overlapping slice.
 */
function sumOverlap(
  start: number,
  end: number,
  records: Interval[],
  pick: (r: any) => number | null | undefined
): number | null {
  let total = 0;
  let any = false;
  for (const r of records) {
    const rS = new Date(r.startTime).getTime();
    const rE = new Date(r.endTime).getTime();
    const ov = overlapMs(start, end, rS, rE);
    if (ov <= 0) continue;
    const val = Number(pick(r));
    if (!isFinite(val)) continue;
    const span = Math.max(1, rE - rS);
    total += val * (ov / span);
    any = true;
  }
  return any ? total : null;
}

export interface BuildInput {
  uid: string;
  exercises: any[];
  activeCals?: any[];
  totalCals?: any[];
  distances?: any[];
  hrSeries?: any[];
  now?: number;
}

/**
 * Normalize raw Health Connect records into `ActivitySession` rows, matching
 * calories/distance/HR by time overlap and de-duplicating near-identical
 * sessions (same type, starts within 5 min → keep the longer one).
 */
export function buildActivitySessions(input: BuildInput): ActivitySession[] {
  const { uid, exercises } = input;
  const activeCals = input.activeCals || [];
  const totalCals = input.totalCals || [];
  const distances = input.distances || [];
  const hrSeries = input.hrSeries || [];
  const nowISO = new Date(input.now ?? Date.now()).toISOString();

  const raw: ActivitySession[] = [];
  for (const ex of exercises) {
    const start = new Date(ex.startTime).getTime();
    const end = new Date(ex.endTime).getTime();
    if (!isFinite(start) || !isFinite(end) || end <= start) continue;
    const durMin = Math.round((end - start) / 60000);
    if (durMin < 1) continue;

    const type = Number(ex.exerciseType) || 0;
    const meta = describeExercise(type);

    // Prefer active calories; fall back to total.
    let kcal = sumOverlap(start, end, activeCals, (r) => r?.energy?.value);
    if (kcal == null) kcal = sumOverlap(start, end, totalCals, (r) => r?.energy?.value);

    const distM = sumOverlap(start, end, distances, (r) => r?.distance?.value);

    // Average HR from any heart-rate series samples inside the window.
    let hrSum = 0;
    let hrN = 0;
    for (const series of hrSeries) {
      for (const s of series?.samples || []) {
        const t = new Date(s.time).getTime();
        if (t >= start && t <= end) {
          const bpm = Number(s.beatsPerMinute);
          if (bpm > 0) {
            hrSum += bpm;
            hrN++;
          }
        }
      }
    }

    raw.push({
      id: `${new Date(start).toISOString()}::${type}`,
      user_id: uid,
      date: ymdLocal(start),
      exercise_type: type,
      label: (ex.title && String(ex.title).trim()) || meta.label,
      emoji: meta.emoji,
      kind: meta.kind,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      duration_min: durMin,
      active_kcal: kcal != null ? Math.round(kcal) : null,
      distance_m: distM != null ? Math.round(distM) : null,
      avg_hr: hrN ? Math.round(hrSum / hrN) : null,
      source: 'watch',
      updated_at: nowISO
    });
  }

  // De-dupe: same type + starts within 5 min → keep the longer session.
  raw.sort((a, b) => a.start.localeCompare(b.start));
  const kept: ActivitySession[] = [];
  for (const s of raw) {
    const dup = kept.find(
      (k) =>
        k.exercise_type === s.exercise_type &&
        Math.abs(new Date(k.start).getTime() - new Date(s.start).getTime()) <= 5 * 60000
    );
    if (!dup) {
      kept.push(s);
      continue;
    }
    if (s.duration_min > dup.duration_min) {
      kept[kept.indexOf(dup)] = s;
    }
  }
  return kept;
}

/** Total active calories from watch sessions on a given day. */
export function dayActiveKcal(sessions: ActivitySession[], date: string): number {
  return sessions
    .filter((s) => s.date === date && s.active_kcal != null)
    .reduce((sum, s) => sum + (s.active_kcal || 0), 0);
}

/** The most significant watch session for a day (longest duration). */
export function primaryActivity(
  sessions: ActivitySession[],
  date: string
): ActivitySession | null {
  const day = sessions.filter((s) => s.date === date);
  if (!day.length) return null;
  return day.reduce((best, s) => (s.duration_min > best.duration_min ? s : best), day[0]);
}
