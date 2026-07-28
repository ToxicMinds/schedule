/**
 * Health Connect integration (native Android only).
 *
 * When RecompOS runs inside its Capacitor Android shell, this reads the
 * OnePlus Watch data that OHealth mirrors into Health Connect (steps, sleep,
 * resting heart rate, HRV) and writes it into the app's own `steps` and
 * `biometrics` tables. That makes the Daily Readiness card and step stats
 * light up with real watch data using the exact same data path as manual entry.
 *
 * In a normal browser (the PWA / desktop) everything here no-ops, so the web
 * build is completely unaffected.
 */
import { writable } from 'svelte/store';
import db from '$lib/db/dexie';
import { supabase } from '$lib/db/client';
import { upsertRecord } from '$lib/stores/sync';
import { buildActivitySessions } from './exercise';
import { type RecordType, READ_TYPES, READ_PERMISSION, readTypesKey } from './permissions';
import { pickOriginByDay, countOrigins, percentile, guessWatchOrigin } from './dedupe';
import { notify } from '$lib/stores/notices';

// Health Connect sleep-stage codes counted as actually asleep
// (2 SLEEPING, 4 LIGHT, 5 DEEP, 6 REM). Awake / out-of-bed / awake-in-bed excluded.
const ASLEEP_STAGES = new Set([2, 4, 5, 6]);

// Keyed on the SET of types we request, so adding a record type earns exactly
// one fresh prompt instead of being blocked forever by an old "already asked"
// flag. See readTypesKey().
const PERM_ASKED_KEY = readTypesKey();

/** User-chosen preferred data source (package name), or null for auto-detect. */
const SOURCE_PREF_KEY = 'hc-preferred-source';

function readPref(): string | null {
  try {
    return localStorage.getItem(SOURCE_PREF_KEY);
  } catch {
    return null;
  }
}

/** Persist the source the user wants trusted when several write the same signal. */
export function setPreferredSource(pkg: string | null) {
  try {
    if (pkg) localStorage.setItem(SOURCE_PREF_KEY, pkg);
    else localStorage.removeItem(SOURCE_PREF_KEY);
  } catch {
    /* ignore */
  }
}

export type HealthConnectState = {
  available: boolean;
  native: boolean;
  syncing: boolean;
  lastSync: string | null;
  lastError: string | null;
  lastResult: { days: number; steps: number; sleep: number; hr: number; workouts: number } | null;
  /** Read-permission strings actually granted at the last sync (null = unknown). */
  grantedPerms: string[] | null;
  /** Every app that wrote data we read (package names) — usually >1, which is
   *  exactly why de-duplication is needed. Lets the UI explain the numbers. */
  sources: string[];
  /** The source actually trusted for daily totals (auto-detected or user-set). */
  activeSource: string | null;
  /** True when the user pinned `activeSource` by hand rather than auto-detect. */
  sourcePinned: boolean;
};

export const healthConnect = writable<HealthConnectState>({
  available: false,
  native: false,
  syncing: false,
  lastSync: null,
  lastError: null,
  lastResult: null,
  grantedPerms: null,
  sources: [],
  activeSource: null,
  sourcePinned: false
});

function ymd(d: string | number | Date): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function startOfDaysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/** Lazily resolve the native plugin (dynamic import keeps it out of SSR/prerender). */
async function getNative(): Promise<{ Capacitor: any; HealthConnect: any } | null> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor?.isNativePlatform?.()) return null;
    const { HealthConnect } = await import('@kiwi-health/capacitor-health-connect');
    return { Capacitor, HealthConnect };
  } catch {
    return null;
  }
}

async function readAll(
  HealthConnect: any,
  type: RecordType,
  startISO: string,
  endISO: string
): Promise<any[]> {
  try {
    const { records } = await HealthConnect.readRecords({
      type,
      // The plugin types this as Date but the Capacitor JSON bridge needs
      // ISO strings (Kotlin does Instant.parse).
      timeRangeFilter: { type: 'between', startTime: startISO, endTime: endISO }
    });
    return records || [];
  } catch (e: any) {
    // Never fatal — one unreadable type must not stop the rest of the sync.
    // But it MUST be visible: an empty result here is exactly how "my workouts
    // never appear" looked for weeks.
    notify('Health Connect', `Could not read ${type}: ${e?.message || e}`, {
      level: 'warn',
      hint: `Open Health Connect and confirm RecompOS is allowed to read ${type}.`
    });
    return [];
  }
}

type DayAgg = {
  steps: number | null;
  sleep_hours: number | null;
  resting_hr: number | null;
  hrv: number | null;
};

/** Minutes actually asleep in a SleepSession, from its stages when present. */
function sleepMinutes(s: any): number {
  if (Array.isArray(s.stages) && s.stages.length) {
    let mins = 0;
    for (const st of s.stages) {
      if (ASLEEP_STAGES.has(Number(st.stage))) {
        mins += (new Date(st.endTime).getTime() - new Date(st.startTime).getTime()) / 60000;
      }
    }
    if (mins > 0) return mins;
  }
  return (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000;
}

const originOf = (r: any) => String(r?.metadata?.dataOrigin || 'unknown');

/**
 * Collapse raw Health Connect records into one row per day.
 *
 * The critical correctness rule here is that we pick ONE source per signal per
 * day rather than summing across sources — see dedupe.ts. Summing was why the
 * app's numbers never matched the watch: the phone's step counter and the
 * watch's mirrored steps were being added together.
 */
function aggregate(
  steps: any[],
  sleeps: any[],
  hrSeries: any[],
  restingHr: any[],
  hrv: any[],
  preferred: string | null
): Record<string, DayAgg> {
  // — Steps: one source per day, summed within that source only. —
  const stepPick = pickOriginByDay(steps, {
    dayOf: (r) => ymd(r.startTime),
    valueOf: (r) => Number(r.count) || 0,
    originOf,
    preferred
  });
  const stepsByDay: Record<string, number> = {};
  for (const [day, pick] of Object.entries(stepPick)) stepsByDay[day] = pick.total;

  // — Sleep: attribute a night to the WAKE day (endTime) so it reads as
  // "today's" readiness after you get up. Pick one source, then take that
  // source's LONGEST session for the day — the main night. Summing every
  // session would fold afternoon naps into "last night's sleep", and summing
  // across sources counted the same night twice when both the watch and the
  // phone recorded it. —
  const sleepPick = pickOriginByDay(sleeps, {
    dayOf: (s) => ymd(s.endTime),
    valueOf: sleepMinutes,
    originOf,
    preferred
  });
  const sleepMinByDay: Record<string, number> = {};
  for (const [day, pick] of Object.entries(sleepPick)) {
    const longest = pick.records.reduce(
      (best: number, s: any) => Math.max(best, sleepMinutes(s)),
      0
    );
    if (longest > 0) sleepMinByDay[day] = longest;
  }

  // — Resting HR / HRV: averaged per day within the winning source. —
  const rhrPick = pickOriginByDay(restingHr, {
    dayOf: (r) => ymd(r.time),
    valueOf: (r) => Number(r.beatsPerMinute) || 0,
    originOf,
    preferred
  });
  const hrvPick = pickOriginByDay(hrv, {
    dayOf: (r) => ymd(r.time),
    valueOf: (r) => Number(r.heartRateVariabilityMillis) || 0,
    originOf,
    preferred
  });

  // — Fallback resting HR from the raw heart-rate series. The old code used the
  // single LOWEST sample of the day, which is one deep-sleep outlier and reads
  // several bpm under what the watch calls resting HR. The 5th percentile
  // tracks a wearable's own RHR far more closely. —
  const hrSamplesByDay: Record<string, number[]> = {};
  for (const series of hrSeries) {
    for (const sample of series.samples || []) {
      const day = ymd(sample.time);
      const bpm = Number(sample.beatsPerMinute);
      if (!bpm) continue;
      (hrSamplesByDay[day] = hrSamplesByDay[day] || []).push(bpm);
    }
  }

  const avg = (arr?: number[]) =>
    arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const days = new Set<string>([
    ...Object.keys(stepsByDay),
    ...Object.keys(sleepMinByDay),
    ...Object.keys(rhrPick),
    ...Object.keys(hrvPick),
    ...Object.keys(hrSamplesByDay)
  ]);

  const byDay: Record<string, DayAgg> = {};
  for (const day of days) {
    // A real RestingHeartRate record always beats a percentile guess.
    const rhrRecords = rhrPick[day]?.records ?? [];
    const rhrDirect = rhrRecords.length
      ? avg(rhrRecords.map((r: any) => Number(r.beatsPerMinute)).filter((n: number) => n > 0))
      : null;
    const rhrDerived = hrSamplesByDay[day] ? percentile(hrSamplesByDay[day], 0.05) : null;
    const restingHrVal =
      rhrDirect != null ? Math.round(rhrDirect) : rhrDerived != null ? Math.round(rhrDerived) : null;

    const hrvRecords = hrvPick[day]?.records ?? [];
    const hrvVal = hrvRecords.length
      ? avg(
          hrvRecords
            .map((r: any) => Number(r.heartRateVariabilityMillis))
            .filter((n: number) => n > 0)
        )
      : null;

    byDay[day] = {
      steps: stepsByDay[day] != null ? Math.round(stepsByDay[day]) : null,
      sleep_hours:
        sleepMinByDay[day] != null ? Math.round((sleepMinByDay[day] / 60) * 10) / 10 : null,
      resting_hr: restingHrVal,
      hrv: hrvVal != null ? Math.round(hrvVal * 10) / 10 : null
    };
  }
  return byDay;
}

/** Steps: write via Supabase upsert then keep a single Dexie row per day. */
async function pushSteps(uid: string, date: string, count: number) {
  const { data, error } = await supabase
    .from('steps')
    .upsert({ user_id: uid, date, count }, { onConflict: 'user_id,date' })
    .select()
    .single();
  if (error) throw error;
  // The Dexie `steps` table has an auto-increment key, so a keyless put would
  // create duplicates. Replace any existing rows for this day with the single
  // authoritative Supabase row (which carries a stable id).
  try {
    await db.table('steps').where('[user_id+date]').equals([uid, date]).delete();
  } catch {
    /* index may be missing on very old dbs; ignore */
  }
  if (data) await db.table('steps').put(data);
}

/** Biometrics: merge with any existing row so we never wipe a manual value. */
async function pushBiometrics(uid: string, date: string, agg: DayAgg) {
  if (agg.sleep_hours == null && agg.resting_hr == null && agg.hrv == null) return false;
  let prev: any = null;
  try {
    prev = await db.table('biometrics').get([uid, date]);
  } catch {
    prev = null;
  }
  await upsertRecord('biometrics', {
    user_id: uid,
    date,
    sleep_hours: agg.sleep_hours != null ? agg.sleep_hours : (prev?.sleep_hours ?? null),
    sleep_quality: prev?.sleep_quality ?? null,
    resting_hr: agg.resting_hr != null ? agg.resting_hr : (prev?.resting_hr ?? null),
    hrv: agg.hrv != null ? agg.hrv : (prev?.hrv ?? null),
    updated_at: new Date().toISOString()
  });
  return true;
}

/**
 * Watch workouts: replace this user's cached activity sessions with the freshly
 * read set. Local-only (native-derived, no Supabase table). We clear the window
 * and re-put so deleted/edited watch sessions don't linger.
 */
async function pushActivitySessions(
  uid: string,
  sessions: { id: string; date: string }[],
  sinceYmd: string
): Promise<number> {
  try {
    const stale = await db
      .table('activity_sessions')
      .where('[user_id+date]')
      .between([uid, sinceYmd], [uid, '\uffff'])
      .primaryKeys();
    if (stale.length) await db.table('activity_sessions').bulkDelete(stale);
  } catch {
    /* index may be missing on very old dbs; ignore */
  }
  if (sessions.length) {
    try {
      await db.table('activity_sessions').bulkPut(sessions);
    } catch (e) {
      console.warn('[HealthConnect] activity put failed', e);
    }
  }
  return sessions.length;
}

type PermCheck = { ok: boolean; granted: Set<string> };

async function ensurePermissions(HealthConnect: any): Promise<PermCheck> {
  const { availability } = await HealthConnect.checkAvailability();
  healthConnect.update((s) => ({ ...s, available: availability === 'Available' }));
  if (availability === 'NotSupported') return { ok: false, granted: new Set() };

  const check = await HealthConnect.checkHealthPermissions({ read: READ_TYPES, write: [] });
  if (check.hasAllPermissions) {
    return { ok: true, granted: new Set(check.grantedPermissions || []) };
  }

  // Only auto-prompt once PER TYPE SET so we don't nag after a decline — but do
  // ask again when we start requesting a type the user was never shown.
  const asked = typeof localStorage !== 'undefined' && localStorage.getItem(PERM_ASKED_KEY);
  if (asked) {
    const granted = new Set<string>(check.grantedPermissions || []);
    return { ok: granted.size > 0, granted };
  }
  try {
    localStorage.setItem(PERM_ASKED_KEY, '1');
  } catch {
    /* ignore */
  }

  try {
    await HealthConnect.requestHealthPermissions({ read: READ_TYPES, write: [] });
  } catch (e) {
    // A cancelled or suppressed dialog is not fatal — we still hold whatever was
    // granted before, and the re-check below finds it.
    console.warn('[HealthConnect] permission request did not complete', e);
  }

  // CRITICAL: never trust the dialog's own return value. It comes from
  // PermissionController.parseResult(), which reports what THAT dialog granted —
  // and Health Connect returns an empty set whenever it declines to re-show the
  // prompt (Android stops re-prompting once the user has answered). The old code
  // treated that empty set as "nothing is granted", threw
  // "Health Connect permission not granted", and threw away permissions the app
  // genuinely held — so pressing Sync could take working data away. Re-checking
  // is the only authoritative answer.
  const after = await HealthConnect.checkHealthPermissions({ read: READ_TYPES, write: [] });
  const granted = new Set<string>(after.grantedPermissions || []);
  return { ok: after.hasAllPermissions || granted.size > 0, granted };
}

/**
 * Open the Health Connect settings screen for this app.
 *
 * This is the ONLY reliable recovery once Android has stopped showing the
 * permission dialog (it refuses to re-prompt after the user has answered, so an
 * in-app "try again" button can be a no-op forever). The UI offers this whenever
 * a signal reads "not allowed".
 */
export async function openHealthConnectSettings(): Promise<boolean> {
  const native = await getNative();
  if (!native) return false;
  try {
    await native.HealthConnect.openHealthConnectSetting();
    // The user may toggle permissions while we're backgrounded — forget the
    // "already asked" flag so the next sync re-reads the real grant state.
    localStorage.removeItem(PERM_ASKED_KEY);
    return true;
  } catch (e) {
    console.warn('[HealthConnect] could not open settings', e);
    return false;
  }
}

let running = false;

/**
 * Read Health Connect and sync into the app. No-ops off native.
 * @param force  when true, prompts for permissions even if previously asked.
 */
export async function syncHealthConnect(
  uid: string,
  opts: { days?: number; force?: boolean } = {}
): Promise<HealthConnectState> {
  const native = await getNative();
  healthConnect.update((s) => ({ ...s, native: !!native }));
  if (!native) return getState();
  if (running) return getState();
  running = true;
  healthConnect.update((s) => ({ ...s, syncing: true, lastError: null }));

  const { HealthConnect } = native;
  try {
    if (opts.force) {
      try {
        localStorage.removeItem(PERM_ASKED_KEY);
      } catch {
        /* ignore */
      }
    }
    const { ok, granted } = await ensurePermissions(HealthConnect);
    // Record exactly what's granted so the UI can show a per-signal breakdown
    // ("steps: OK, sleep: not granted") even before any data lands.
    healthConnect.update((s) => ({ ...s, grantedPerms: Array.from(granted) }));
    if (!ok) throw new Error('Health Connect permission not granted');

    const nDays = opts.days ?? 14;
    const startISO = startOfDaysAgo(nDays).toISOString();
    const endISO = new Date().toISOString();

    // CRITICAL: only read record types the user actually granted. Reading an
    // ungranted type throws inside the plugin's unguarded native coroutine and
    // HARD-CRASHES the app (see READ_PERMISSION note). This gate degrades the
    // feature gracefully instead — grant steps only, you get steps only.
    const canRead = (t: RecordType) => granted.has(READ_PERMISSION[t]);
    const read = (t: RecordType) => (canRead(t) ? readAll(HealthConnect, t, startISO, endISO) : Promise.resolve([]));

    const [steps, sleeps, hrSeries, restingHr, hrv, exercises, activeCals, totalCals, distances] =
      await Promise.all([
        read('Steps'),
        read('SleepSession'),
        read('HeartRateSeries'),
        read('RestingHeartRate'),
        read('HeartRateVariabilityRmssd'),
        read('ExerciseSession'),
        read('ActiveCaloriesBurned'),
        read('TotalCaloriesBurned'),
        read('Distance')
      ]);

    // Which apps are writing into Health Connect? Usually more than one, and
    // that is precisely why the app's numbers didn't match the watch — the old
    // code summed every source's copy of the same day. Prefer the user's pinned
    // source, else auto-detect the watch, else fall back to "most data wins"
    // inside pickOriginByDay.
    const sources = countOrigins(
      [...steps, ...sleeps, ...restingHr, ...hrv, ...exercises, ...activeCals, ...totalCals, ...distances],
      originOf
    );
    const pinned = readPref();
    const preferred = pinned && sources.includes(pinned) ? pinned : guessWatchOrigin(sources);
    healthConnect.update((s) => ({
      ...s,
      sources,
      activeSource: preferred,
      sourcePinned: !!pinned && sources.includes(pinned)
    }));

    const byDay = aggregate(steps, sleeps, hrSeries, restingHr, hrv, preferred);
    const dates = Object.keys(byDay).sort();

    // Watch workouts (badminton, runs, strength sessions) → activity_sessions.
    // Calories/distance are restricted to the trusted source for the same
    // double-counting reason: with two writers, a 400 kcal match reported ~800.
    const fromPreferred = (rows: any[]) =>
      preferred ? rows.filter((r) => originOf(r) === preferred) : rows;
    const activity = buildActivitySessions({
      uid,
      exercises,
      activeCals: fromPreferred(activeCals),
      totalCals: fromPreferred(totalCals),
      distances: fromPreferred(distances),
      hrSeries
    });
    let workoutDays = 0;
    try {
      workoutDays = await pushActivitySessions(uid, activity, ymd(startOfDaysAgo(nDays)));
    } catch (e: any) {
      notify('Health Connect', `Could not save watch workouts: ${e?.message || e}`, { level: 'warn' });
    }

    let stepDays = 0;
    let sleepDays = 0;
    let hrDays = 0;
    for (const date of dates) {
      const agg = byDay[date];
      if (agg.steps != null) {
        try {
          await pushSteps(uid, date, agg.steps);
          stepDays++;
        } catch (e: any) {
          notify('Health Connect', `Could not save steps for ${date}: ${e?.message || e}`, { level: 'warn' });
        }
      }
      try {
        const wrote = await pushBiometrics(uid, date, agg);
        if (wrote) {
          if (agg.sleep_hours != null) sleepDays++;
          if (agg.resting_hr != null || agg.hrv != null) hrDays++;
        }
      } catch (e: any) {
        notify('Health Connect', `Could not save sleep/HR for ${date}: ${e?.message || e}`, { level: 'warn' });
      }
    }

    const result = { days: dates.length, steps: stepDays, sleep: sleepDays, hr: hrDays, workouts: workoutDays };
    const now = new Date().toISOString();
    try {
      localStorage.setItem('hc-last-sync', now);
    } catch {
      /* ignore */
    }
    healthConnect.update((s) => ({
      ...s,
      syncing: false,
      lastSync: now,
      lastResult: result,
      lastError: null
    }));
  } catch (e: any) {
    notify('Health Connect', e?.message || 'Sync failed', {
      hint: 'Tap Sync again, or open Health Connect permissions from the Readiness card.'
    });
    healthConnect.update((s) => ({
      ...s,
      syncing: false,
      lastError: e?.message || 'Health Connect sync failed'
    }));
  } finally {
    running = false;
  }
  return getState();
}

let _state: HealthConnectState;
healthConnect.subscribe((s) => (_state = s));
function getState(): HealthConnectState {
  return _state;
}

/** True only when running inside the native Android shell. */
export async function isNativeHealth(): Promise<boolean> {
  return !!(await getNative());
}
