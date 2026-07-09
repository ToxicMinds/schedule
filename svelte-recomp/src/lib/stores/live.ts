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

export function liveSession() {
  const store: Writable<any> = writable(null);
  const unsub = userId.subscribe(async (uid) => {
    if (!uid) return;
    const data = await db.table('sessions').where('user_id').equals(uid).toArray();
    store.set(data[0] || null);
  });
  return { subscribe: store.subscribe };
}
