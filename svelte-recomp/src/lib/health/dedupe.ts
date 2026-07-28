/**
 * Multi-source de-duplication for Health Connect reads.
 *
 * THE BUG THIS EXISTS TO FIX: Health Connect is a shared store that several
 * apps write the SAME real-world event into. On a Pixel with a OnePlus watch
 * you typically have at least two writers of steps — the phone's own step
 * counter (Google Fit / Fitbit / Digital Wellbeing) and OHealth mirroring the
 * watch — plus sometimes a third from a manual import. Health Connect's own
 * `aggregate()` API resolves this using the user's app-priority list, but this
 * plugin only exposes raw `readRecords()`, which returns EVERY record from
 * EVERY source. Naively summing them double-counts: 8k real steps reads as
 * ~15k, active calories inflate the same way, and a night of sleep written by
 * both the watch and the phone counts twice.
 *
 * The fix is to pick ONE source per day per signal rather than summing across
 * them. `metadata.dataOrigin` (the writing app's package name) is already in
 * every record the plugin returns, so this is a group-by. Which source wins is
 * a real calibration decision, not a detail — see `pickOriginByDay`.
 *
 * Pure (no Dexie / Capacitor) so it's unit-testable — see selfcheck.js.
 */

export interface OriginPick<T> {
  /** The winning source's package name (e.g. "com.oneplus.health.international"). */
  origin: string;
  /** Summed value of the winning source's records for this day. */
  total: number;
  /** Only the winning source's records. */
  records: T[];
  /** Every source seen for this day and its total — for diagnostics/UI. */
  candidates: Record<string, number>;
}

/**
 * Group records by local day, then keep only ONE source's records per day.
 *
 * Selection rule, in order:
 *   1. `preferred`, if that source wrote anything at all that day. The user's
 *      watch is the source they actually compare the app against, so once we
 *      know which package that is, it wins — even on a day it recorded less
 *      than the phone (a short-wear day should read low, not be silently
 *      replaced by the phone's number).
 *   2. Otherwise the source with the highest total. For steps/distance/calories
 *      the fuller record is virtually always the real one; a secondary writer
 *      typically holds a partial slice.
 *
 * Ties break on package name so the result is deterministic across syncs
 * (an unstable pick would make the same day's number flip run to run).
 */
export function pickOriginByDay<T>(
  records: T[],
  opts: {
    dayOf: (r: T) => string;
    valueOf: (r: T) => number;
    originOf: (r: T) => string;
    preferred?: string | null;
  }
): Record<string, OriginPick<T>> {
  const { dayOf, valueOf, originOf, preferred } = opts;

  // day -> origin -> { total, records }
  const byDay: Record<string, Record<string, { total: number; records: T[] }>> = {};
  for (const r of records) {
    const day = dayOf(r);
    if (!day) continue;
    const origin = originOf(r) || 'unknown';
    const v = Number(valueOf(r));
    const bucket = (byDay[day] = byDay[day] || {});
    const cell = (bucket[origin] = bucket[origin] || { total: 0, records: [] });
    cell.records.push(r);
    if (isFinite(v)) cell.total += v;
  }

  const out: Record<string, OriginPick<T>> = {};
  for (const [day, origins] of Object.entries(byDay)) {
    const names = Object.keys(origins);
    if (names.length === 0) continue;

    const candidates: Record<string, number> = {};
    for (const n of names) candidates[n] = origins[n].total;

    let winner: string;
    if (preferred && origins[preferred]) {
      winner = preferred;
    } else {
      winner = names.reduce((best, n) => {
        const d = origins[n].total - origins[best].total;
        // Deterministic tie-break — otherwise object key order decides, and the
        // same day can report different numbers on consecutive syncs.
        if (d > 0) return n;
        if (d < 0) return best;
        return n < best ? n : best;
      }, names[0]);
    }

    out[day] = {
      origin: winner,
      total: origins[winner].total,
      records: origins[winner].records,
      candidates
    };
  }
  return out;
}

/**
 * Count how many distinct sources wrote each signal, so the UI can be honest
 * about WHY a number changed ("2 sources found, using your watch") instead of
 * silently picking one.
 */
export function countOrigins<T>(records: T[], originOf: (r: T) => string): string[] {
  const set = new Set<string>();
  for (const r of records) {
    const o = originOf(r);
    if (o) set.add(o);
  }
  return [...set].sort();
}

/**
 * Linear-interpolated percentile of a numeric sample (p in 0..1).
 * Used for resting HR: the old code took the single LOWEST heart-rate sample of
 * the day, which is one deep-sleep outlier and reads several bpm below what a
 * watch calls resting HR. The 5th percentile of the day's samples is a far
 * closer match to how wearables actually derive RHR.
 */
export function percentile(values: number[], p: number): number | null {
  const s = values.filter((v) => isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  if (s.length === 1) return s[0];
  const idx = (s.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// Brand knowledge (which package is a watch, what each brand's setup involves)
// lives in ./watches. It replaced a hand-maintained regex here that notably
// omitted Samsung, so a Galaxy Watch user silently fell through to "whichever
// source logged more" and could have the phone chosen over the watch.
// Consumers import from ./watches directly rather than re-exporting through
// here, so this module stays purely about de-duplication maths.
