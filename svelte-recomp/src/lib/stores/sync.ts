import { writable, get } from 'svelte/store';
import { supabase } from '$lib/db/client';
import db from '$lib/db/dexie';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
export const syncStatus = writable<SyncStatus>('idle');
export const syncError = writable<string | null>(null);

const channels: RealtimeChannel[] = [];

const TABLES = ['alarms', 'daily_logs', 'checks', 'tracks', 'weights', 'steps', 'sessions'] as const;

function dexieTable(table: string) {
  return db.table(table);
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
      await dexieTable(table).delete(record.id);
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
        .select('*')
        .eq('user_id', uid);

      if (error) throw error;

      if (data && data.length > 0) {
        await dexieTable(table).bulkPut(data as any[]);
      }

      const channel = supabase
        .channel(`${table}-sync-${uid}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` },
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
    if (table === 'daily_logs') upsertOptions.onConflict = 'user_id,date';
    else if (table === 'checks') upsertOptions.onConflict = 'id,user_id';
    else if (table === 'tracks') upsertOptions.onConflict = 'id,user_id';

    const { error } = await supabase.from(table).upsert(data, upsertOptions);

    if (error) {
      syncStatus.set('error');
      throw error;
    }

    await dexieTable(table).put(data);
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
