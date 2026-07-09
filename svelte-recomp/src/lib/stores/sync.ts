import { writable, get } from 'svelte/store';
import { supabase } from '$lib/db/client';
import db from '$lib/db/dexie';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
export const syncStatus = writable<SyncStatus>('idle');
export const syncError = writable<string | null>(null);

const channels: RealtimeChannel[] = [];

const TABLES = ['alarms', 'daily_logs', 'checks', 'tracks', 'weights', 'steps', 'sessions', 'meal_plans'] as const;

function dexieTable(table: string) {
  return db.table(table);
}

function primaryKeyFor(table: string, record: Record<string, any>): any {
  switch (table) {
    case 'daily_logs': return [record.user_id, record.date];
    case 'checks':
    case 'tracks': return [record.id, record.user_id];
    case 'meal_plans': return [record.user_id, record.week_start];
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
    for (const table of TABLES) {
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
    }
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
