const VAPID_PUBLIC_KEY = 'BDl0k_5i0K812VUVDdB8_KRD8bSdRVwgrlpax0ZSJbdwS1HTtj76gcOvefZuDDqatqLaQ-8hDLXwa5kVRPouGHM';

function b64ToUint8(b64: string): Uint8Array {
  const raw = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf;
}

export async function subscribeWebPush(uid: string): Promise<boolean> {
  if (!('PushManager' in window) || !('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(VAPID_PUBLIC_KEY),
      });
    }
    const { supabase } = await import('$lib/db/client');
    await supabase.from('push_subscriptions').upsert(
      { user_id: uid, subscription: sub.toJSON(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    return true;
  } catch (e) {
    console.warn('[Push] subscription failed:', e);
    return false;
  }
}
