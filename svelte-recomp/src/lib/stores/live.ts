import { writable, type Writable } from 'svelte/store';
import db from '$lib/db/dexie';
import { userId } from './user';

export function liveAlarms() {
  const store: Writable<any[]> = writable([]);
  const unsub = userId.subscribe(async (uid) => {
    if (!uid) return;
    const data = await db.table('alarms').where('user_id').equals(uid).toArray();
    store.set(data);
  });
  return { subscribe: store.subscribe };
}

export function liveLog(date: string) {
  const store: Writable<any> = writable(null);
  const unsub = userId.subscribe(async (uid) => {
    if (!uid) return;
    const data = await db.table('daily_logs').get({ user_id: uid, date });
    store.set(data || null);
  });
  return { subscribe: store.subscribe };
}

export function liveWeights() {
  const store: Writable<any[]> = writable([]);
  const unsub = userId.subscribe(async (uid) => {
    if (!uid) return;
    const data = await db.table('weights').where('user_id').equals(uid).reverse().sortBy('date');
    store.set(data);
  });
  return { subscribe: store.subscribe };
}
