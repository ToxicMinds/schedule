import Dexie from 'dexie';

export interface Alarm {
  id: string; user_id: string; title: string; message: string;
  time: string; days: number[]; enabled: boolean;
  created_at: string;
}

export interface DailyLog {
  user_id: string; date: string; kcal?: number;
  water_glasses?: number; evening_checks?: Record<string, boolean>;
}

export interface Weight {
  id: number; user_id: string; date: string; weight: number;
  created_at: string;
}

export interface Step {
  id: number; user_id: string; date: string; count: number;
  created_at: string;
}

export interface Session {
  id: number; user_id: string; date: string; type: string;
  created_at: string;
}

export interface CheckItem {
  id: string; date: string; user_id: string;
  text: string; done: boolean;
}

export interface TrackEntry {
  id: string; date: string; user_id: string;
  name: string; value: number; unit: string;
}

export interface MealPlan {
  user_id: string; week_start: string;
  plan: Record<string, any>; created_at: string;
}

const db = new Dexie('recompos');

db.version(1).stores({
  alarms: 'id, user_id, enabled',
  daily_logs: '&[user_id+date], user_id, date',
  weights: '++id, user_id, date',
  steps: '++id, user_id, date',
  sessions: '++id, user_id, date',
  checks: '&[id+user_id], id, date, user_id',
  tracks: '&[id+user_id], id, date, name, user_id',
  meal_plans: '&[user_id+week_start], user_id, week_start',
});

// v2: add compound [user_id+date] index to weights/steps so we can look up
// "does today's entry already exist" locally (offline-first) instead of
// round-tripping to Supabase before every save.
db.version(2).stores({
  weights: '++id, user_id, date, [user_id+date]',
  steps: '++id, user_id, date, [user_id+date]',
});

export default db;

export async function initDB() {
  await db.open();
}
