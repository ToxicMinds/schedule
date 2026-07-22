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
import { type RecordType, READ_TYPES, READ_PERMISSION } from './permissions';

// Health Connect sleep-stage codes counted as actually asleep
// (2 SLEEPING, 4 LIGHT, 5 DEEP, 6 REM). Awake / out-of-bed / awake-in-bed excluded.
const ASLEEP_STAGES = new Set([2, 4, 5, 6]);

const PERM_ASKED_KEY = 'hc-perms-asked-v2';

export type HealthConnectState = {
  available: boolean;
  native: boolean;
  syncing: boolean;
  lastSync: string | null;
  lastError: string | null;
  lastResult: { days: number; steps: number; sleep: number; hr: number; workouts: number } | null;
  /** Read-permission strings actually granted at the last sync (null = unknown). */
  grantedPerms: string[] | null;
};

export const healthConnect = writable<HealthConnectState>({
  available: false,
  native: false,
  syncing: false,
  lastSync: null,
  lastError: null,
  lastResult: null,
  grantedPerms: null
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
  } catch (e) {
    console.warn(`[HealthConnect] readRecords(${type}) failed`, e);
    return [];
  }
}

type DayAgg = {
  steps: number | null;
  sleep_hours: number | null;
  resting_hr: number | null;
  hrv: number | null;
};

function aggregate(
  steps: any[],
  sleeps: any[],
  hrSeries: any[],
  restingHr: any[],
  hrv: any[]
): Record<string, DayAgg> {
  const stepsByDay: Record<string, number> = {};
  const sleepMinByDay: Record<string, number> = {};
  const rhrByDay: Record<string, number[]> = {};
  const hrvByDay: Record<string, number[]> = {};
  const hrMinByDay: Record<string, number> = {};

  for (const r of steps) {
    const day = ymd(r.startTime);
    stepsByDay[day] = (stepsByDay[day] || 0) + (Number(r.count) || 0);
  }

  for (const s of sleeps) {
    // Attribute a night's sleep to the wake day (endTime) so it reads as
    // "today's" readiness after you wake up.
    const day = ymd(s.endTime);
    let mins = 0;
    if (Array.isArray(s.stages) && s.stages.length) {
      for (const st of s.stages) {
        if (ASLEEP_STAGES.has(Number(st.stage))) {
          mins += (new Date(st.endTime).getTime() - new Date(st.startTime).getTime()) / 60000;
        }
      }
    }
    if (mins === 0) {
      mins = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000;
    }
    sleepMinByDay[day] = (sleepMinByDay[day] || 0) + mins;
  }

  for (const r of restingHr) {
    const day = ymd(r.time);
    (rhrByDay[day] = rhrByDay[day] || []).push(Number(r.beatsPerMinute));
  }

  for (const r of hrv) {
    const day = ymd(r.time);
    (hrvByDay[day] = hrvByDay[day] || []).push(Number(r.heartRateVariabilityMillis));
  }

  for (const series of hrSeries) {
    for (const sample of series.samples || []) {
      const day = ymd(sample.time);
      const bpm = Number(sample.beatsPerMinute);
      if (!bpm) continue;
      hrMinByDay[day] = hrMinByDay[day] === undefined ? bpm : Math.min(hrMinByDay[day], bpm);
    }
  }

  const avg = (arr?: number[]) =>
    arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const days = new Set<string>([
    ...Object.keys(stepsByDay),
    ...Object.keys(sleepMinByDay),
    ...Object.keys(rhrByDay),
    ...Object.keys(hrvByDay),
    ...Object.keys(hrMinByDay)
  ]);

  const byDay: Record<string, DayAgg> = {};
  for (const day of days) {
    const restingHrVal =
      rhrByDay[day] != null
        ? Math.round(avg(rhrByDay[day])!)
        : hrMinByDay[day] !== undefined
          ? Math.round(hrMinByDay[day])
          : null;
    byDay[day] = {
      steps: stepsByDay[day] != null ? Math.round(stepsByDay[day]) : null,
      sleep_hours:
        sleepMinByDay[day] != null ? Math.round((sleepMinByDay[day] / 60) * 10) / 10 : null,
      resting_hr: restingHrVal,
      hrv: hrvByDay[day] ? Math.round(avg(hrvByDay[day])! * 10) / 10 : null
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

  // Only auto-prompt once so we don't nag on every launch after a decline.
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
  const res = await HealthConnect.requestHealthPermissions({ read: READ_TYPES, write: [] });
  const granted = new Set<string>(res.grantedPermissions || []);
  return { ok: res.hasAllPermissions || granted.size > 0, granted };
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

    const byDay = aggregate(steps, sleeps, hrSeries, restingHr, hrv);
    const dates = Object.keys(byDay).sort();

    // Watch workouts (badminton, runs, strength sessions) → activity_sessions.
    const activity = buildActivitySessions({
      uid,
      exercises,
      activeCals,
      totalCals,
      distances,
      hrSeries
    });
    let workoutDays = 0;
    try {
      workoutDays = await pushActivitySessions(uid, activity, ymd(startOfDaysAgo(nDays)));
    } catch (e) {
      console.warn('[HealthConnect] activity sync failed', e);
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
        } catch (e) {
          console.warn('[HealthConnect] step push failed', date, e);
        }
      }
      try {
        const wrote = await pushBiometrics(uid, date, agg);
        if (wrote) {
          if (agg.sleep_hours != null) sleepDays++;
          if (agg.resting_hr != null || agg.hrv != null) hrDays++;
        }
      } catch (e) {
        console.warn('[HealthConnect] biometric push failed', date, e);
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
    console.warn('[HealthConnect] sync failed', e);
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
