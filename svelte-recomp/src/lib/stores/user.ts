import { writable } from 'svelte/store';
import { supabase } from '$lib/db/client';
import type { User } from '@supabase/supabase-js';

export const user = writable<User | null>(null);
export const userId = writable<string>('');
export const authReady = writable(false);

let initPromise: Promise<void> | null = null;

// Real email/password accounts (not anonymous) so the SAME account/user_id
// can be used across multiple devices (iPhone + Android) and their data
// stays in sync via Supabase, instead of each device getting its own
// disposable local identity.
export async function initAuth() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
      user.set(session.user);
      userId.set(session.user.id);
    }

    supabase.auth.onAuthStateChange((_event, s) => {
      user.set(s?.user ?? null);
      userId.set(s?.user?.id ?? '');
    });

    authReady.set(true);
  })();

  return initPromise;
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getUserId(): Promise<string> {
  const uid = await new Promise<string>((resolve) => {
    const unsub = userId.subscribe((v) => {
      if (v) { unsub(); resolve(v); }
    });
  });
  return uid;
}

