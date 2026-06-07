import { writable } from 'svelte/store';
import { supabase } from '$lib/db/client';
import type { User } from '@supabase/supabase-js';

export const user = writable<User | null>(null);
export const userId = writable<string>('');

let initPromise: Promise<void> | null = null;

export async function initAuth() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
      user.set(session.user);
      userId.set(session.user.id);
      return;
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.error('Auth init failed:', error);
      initPromise = null;
      return;
    }
    if (data.user) {
      user.set(data.user);
      userId.set(data.user.id);
    }
  })();

  return initPromise;
}

export async function getUserId(): Promise<string> {
  const uid = await new Promise<string>((resolve) => {
    const unsub = userId.subscribe((v) => {
      if (v) { unsub(); resolve(v); }
    });
  });
  return uid;
}
