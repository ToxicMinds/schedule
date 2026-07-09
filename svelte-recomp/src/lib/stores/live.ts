import { writable, type Writable } from 'svelte/store';
import { liveQuery } from 'dexie';
import db from '$lib/db/dexie';
import { userId } from './user';

let currentUid = '';

const alarmResults = writable<any[]>([]);
const weightResults = writable<any[]>([]);
const logResults = writable<Map<string, any>>(new Map());
const goalResult = writable<number | null>(null);
const scheduleResults = writable<any[]>([]);
const sessionResults = writable<Map<string, any>>(new Map());
const workoutLogResults = writable<any[]>([]);
const foodLogResults = writable<any[]>([]);
const mealPlanResults = writable<Map<string, any>>(new Map());

userId.subscribe((uid) => {
  if (!uid || uid === currentUid) return;
  currentUid = uid;

  liveQuery(() => db.table('alarms').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => alarmResults.set(data),
    error: () => alarmResults.set([])
  });

  liveQuery(() => db.table('weights').where('user_id').equals(uid).sortBy('date')).subscribe({
    next: (data) => weightResults.set(data),
    error: () => weightResults.set([])
  });

  liveQuery(() => db.table('daily_logs').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => {
      const map = new Map<string, any>();
      for (const row of data) map.set(row.date, row);
      logResults.set(map);
    },
    error: () => logResults.set(new Map())
  });

  liveQuery(() => db.table('user_settings').where('user_id').equals(uid).first()).subscribe({
    next: (data) => goalResult.set(data?.goal_kg ?? null),
    error: () => goalResult.set(null)
  });

  liveQuery(() => db.table('workout_schedule').where('user_id').equals(uid).sortBy('day_of_week')).subscribe({
    next: (data) => scheduleResults.set(data),
    error: () => scheduleResults.set([])
  });

  liveQuery(() => db.table('workout_sessions_custom').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => {
      const map = new Map<string, any>();
      for (const row of data) map.set(row.key, row);
      sessionResults.set(map);
    },
    error: () => sessionResults.set(new Map())
  });

  liveQuery(() => db.table('workout_logs').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => workoutLogResults.set(data),
    error: () => workoutLogResults.set([])
  });

  liveQuery(() => db.table('food_logs').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => foodLogResults.set(data),
    error: () => foodLogResults.set([])
  });

  // meal_plans previously used a manual db.table().get() call re-run from
  // a $effect keyed off $syncStatus === 'synced' -- but syncStatus can
  // already be 'synced' (from an earlier, faster table's initial sync)
  // by the time meal_plans' own initial fetch actually lands, so that
  // effect would never re-fire and the page would silently show stale/
  // empty data until a manual edit or full reload happened to re-trigger
  // it. liveQuery reacts directly to the IndexedDB write itself, so it
  // has no such race regardless of table fetch ordering/timing.
  liveQuery(() => db.table('meal_plans').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => {
      const map = new Map<string, any>();
      for (const row of data) map.set(row.week_start, row);
      mealPlanResults.set(map);
    },
    error: () => mealPlanResults.set(new Map())
  });
});

export function liveAlarms() {
  return { subscribe: alarmResults.subscribe };
}

export function liveLog(date: string) {
  const store: Writable<any> = writable(null);
  const unsub = logResults.subscribe((map) => {
    store.set(map.get(date) || null);
  });
  return { subscribe: store.subscribe };
}

export function liveWeights() {
  return { subscribe: weightResults.subscribe };
}

export function liveGoal() {
  return { subscribe: goalResult.subscribe };
}

export function liveSchedule() {
  return { subscribe: scheduleResults.subscribe };
}

export function liveWorkoutSessions() {
  return { subscribe: sessionResults.subscribe };
}

// All workout_logs rows for the current user (every date/exercise). Kept as
// a flat array so the UI can derive both "today's entry" and "most recent
// prior entry" (for progressive-overload prompts) per exercise without a
// separate query per exercise.
export function liveWorkoutLogs() {
  return { subscribe: workoutLogResults.subscribe };
}

// All food_logs rows for the current user (every date). Consumers filter
// by date client-side for daily totals.
export function liveFoodLogs() {
  return { subscribe: foodLogResults.subscribe };
}

// Meal plan for a specific week (keyed by week_start date string), reading
// live from IndexedDB so it never depends on syncStatus timing.
export function liveMealPlan(weekStart: string) {
  const store: Writable<Record<string, any>> = writable({});
  const unsub = mealPlanResults.subscribe((map) => {
    store.set(map.get(weekStart)?.plan ?? {});
  });
  return { subscribe: store.subscribe };
}

export function liveSession() {
  const store: Writable<any> = writable(null);
  const unsub = userId.subscribe(async (uid) => {
    if (!uid) return;
    const data = await db.table('sessions').where('user_id').equals(uid).toArray();
    store.set(data[0] || null);
  });
  return { subscribe: store.subscribe };
}
