import { writable, get } from 'svelte/store';
import { supabase } from '$lib/db/client';
import db from '$lib/db/dexie';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
export const syncStatus = writable<SyncStatus>('idle');
export const syncError = writable<string | null>(null);

const channels: RealtimeChannel[] = [];

const TABLES = ['alarms', 'daily_logs', 'checks', 'tracks', 'weights', 'steps', 'sessions', 'meal_plans', 'user_settings', 'workout_schedule', 'workout_sessions_custom', 'workout_logs', 'food_logs', 'biometrics'] as const;

function dexieTable(table: string) {
  return db.table(table);
}

function primaryKeyFor(table: string, record: Record<string, any>): any {
  switch (table) {
    case 'daily_logs': return [record.user_id, record.date];
    case 'checks':
    case 'tracks': return [record.id, record.user_id];
    case 'meal_plans': return [record.user_id, record.week_start];
    case 'user_settings': return record.user_id;
    case 'workout_schedule': return [record.user_id, record.day_of_week];
    case 'workout_sessions_custom': return [record.user_id, record.key];
    case 'workout_logs': return [record.user_id, record.date, record.exercise_name];
    case 'biometrics': return [record.user_id, record.date];
    default: return record.id;
  }
}

async function handleChange(payload: RealtimePostgresChangesPayload<Record<string, any>>) {
  const table = payload.table;
  const eventType = payload.eventType;

  try {
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const record = payload.new;
      await dexieTable(table).put(record);
    } else if (eventType === 'DELETE') {
      const record = payload.old;
      await dexieTable(table).delete(primaryKeyFor(table, record));
    }
  } catch (e) {
    console.warn(`Sync: error handling ${eventType} on ${table}:`, e);
  }
}

export async function initSync(uid: string) {
  syncStatus.set('syncing');

  try {
    // Fetch + subscribe to every table in parallel instead of sequentially
    // awaiting one at a time. The old sequential loop meant syncStatus
    // could flip to 'synced' as soon as the FIRST (fastest) table's
    // channel subscribed, well before a table further down the list (e.g.
    // meal_plans, 8th of 13) had actually finished its initial fetch --
    // any page relying on "$syncStatus === 'synced' -> reload" to refresh
    // its data could silently miss the update for that slower table
    // entirely. Doing this in parallel shrinks that race window from
    // "up to 12 sequential round-trips" to "one round-trip", and pages
    // should prefer live.ts's liveQuery-based helpers (which react to the
    // IndexedDB write itself, not to syncStatus) wherever possible anyway.
    await Promise.all(TABLES.map(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .select('*');

      if (error) throw error;

      if (data && data.length > 0) {
        await dexieTable(table).bulkPut(data as any[]);
      }

      const channel = supabase
        .channel(`${table}-sync-${uid}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table },
          (payload) => handleChange(payload as any)
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') syncStatus.set('synced');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            syncStatus.set('error');
          }
        });

      channels.push(channel);
    }));
  } catch (e: any) {
    syncStatus.set('error');
    syncError.set(e?.message || 'Sync failed');
    console.error('Sync init failed:', e);
  }
}

export async function upsertRecord(table: string, data: Record<string, any>) {
  const currentStatus = get(syncStatus);
  if (currentStatus !== 'synced' && currentStatus !== 'syncing') {
    syncStatus.set('syncing');
  }

  try {
    const upsertOptions: any = {};
    if (table === 'weights') upsertOptions.onConflict = 'user_id,date';
    else if (table === 'steps') upsertOptions.onConflict = 'user_id,date';
    else if (table === 'daily_logs') upsertOptions.onConflict = 'user_id,date';
    else if (table === 'checks') upsertOptions.onConflict = 'id';
    else if (table === 'tracks') upsertOptions.onConflict = 'id';
    else if (table === 'meal_plans') upsertOptions.onConflict = 'user_id,week_start';
    else if (table === 'user_settings') upsertOptions.onConflict = 'user_id';
    else if (table === 'workout_schedule') upsertOptions.onConflict = 'user_id,day_of_week';
    else if (table === 'workout_sessions_custom') upsertOptions.onConflict = 'user_id,key';
    else if (table === 'workout_logs') upsertOptions.onConflict = 'user_id,date,exercise_name';
    else if (table === 'food_logs') upsertOptions.onConflict = 'id';
    else if (table === 'biometrics') upsertOptions.onConflict = 'user_id,date';

    const { error } = await supabase.from(table).upsert(data, upsertOptions);

    if (error) {
      syncStatus.set('error');
      throw error;
    }

    // Defensive: Svelte 5 $state proxies (arrays/objects) can fail
    // IndexedDB's structured-clone algorithm ("could not be cloned") if a
    // caller accidentally passes a reactive value straight through. A
    // JSON round-trip guarantees a plain, clonable value at negligible cost
    // for these small records.
    await dexieTable(table).put(JSON.parse(JSON.stringify(data)));
    syncStatus.set('synced');
  } catch (e: any) {
    syncStatus.set('error');
    syncError.set(e?.message || 'Upsert failed');
    throw e;
  }
}

export function destroySync() {
  channels.forEach((ch) => ch.unsubscribe());
  channels.length = 0;
  syncStatus.set('idle');
}
