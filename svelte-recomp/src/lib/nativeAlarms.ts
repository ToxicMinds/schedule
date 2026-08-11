// Alarms that fire when the app is CLOSED.
//
// The old path was the service worker's setTimeout + showNotification. On the web
// that is merely unreliable; inside the Capacitor APK it is dead on arrival:
// Android's WebView implements neither the Notifications API nor the Push API, so
// `self.registration.showNotification()` throws and the catch swallows it. On top of
// that the SW's setTimeout only survives while the SW does — Android freezes it
// within minutes of the app going to background — and the scheduler capped delays at
// 24h anyway, so nothing further out was ever armed.
//
// The OS is the only thing that can wake a sleeping phone, so on native we hand the
// schedule to AlarmManager via @capacitor/local-notifications and let Android own it.
// Each alarm/day pair becomes ONE repeating weekly notification, so the schedule
// survives reboots (the plugin registers a BOOT_COMPLETED receiver) and needs no
// re-arming from JS.
//
// Web keeps the service-worker path — see scheduleAlarms() in routes/alarms/+page.svelte.

export interface AlarmRow {
  id: string;
  title: string;
  message?: string | null;
  time: string; // "HH:MM"
  days?: number[] | null; // JS getDay(): 0 = Sunday
  enabled?: boolean;
}

/** Android needs its own high-importance channel or alarms arrive silently and
 *  without a heads-up banner — IMPORTANCE_DEFAULT does not wake the screen. */
const CHANNEL_ID = 'recompos-alarms';

/** Capacitor notification ids must be 32-bit ints, but our alarms are uuids. Hash
 *  (uuid + weekday) to a stable positive int so re-scheduling REPLACES the previous
 *  entry for that slot instead of stacking a duplicate every launch. */
export function notificationId(alarmId: string, day: number): number {
  let h = 5381;
  const s = `${alarmId}:${day}`;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h % 2147483647;
}

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/**
 * Hand the whole alarm list to Android. Returns false when this isn't the native
 * app (or the user refused notification permission), so the caller can fall back to
 * the service-worker path rather than silently scheduling nothing.
 */
export async function scheduleNativeAlarms(alarms: AlarmRow[]): Promise<boolean> {
  if (!isNativeApp()) return false;

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') {
      console.warn('[alarms] notification permission denied — no alarms will fire');
      return false;
    }

    // Android 12+ downgrades us to an INEXACT alarm (delivered whenever the OS feels
    // like it, often 15+ min late) unless exact alarms are allowed. USE_EXACT_ALARM
    // in the manifest auto-grants this on Android 13+; on 12 the user has to allow it,
    // so deep-link them to that settings screen once rather than shipping late alarms.
    try {
      const exact = await LocalNotifications.checkExactNotificationSetting();
      if (exact.exact_alarm === 'prompt') await LocalNotifications.changeExactNotificationSetting();
    } catch { /* older plugin/OS: exact-alarm API absent, nothing to ask for */ }

    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Alarms & reminders',
      description: 'Weigh-ins, meals, training prep',
      importance: 5, // IMPORTANCE_HIGH — heads-up banner + sound
      visibility: 1, // VISIBILITY_PUBLIC — readable on the lock screen
      sound: 'default',
      vibration: true,
    });

    // Clear what we armed last time. Anything still pending that isn't in the new
    // schedule (deleted or disabled alarm) would otherwise keep firing forever.
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }

    const notifications = [];
    for (const a of alarms) {
      if (!a.enabled || !a.days?.length) continue;
      const [h, m] = a.time.split(':').map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) continue;

      for (const day of a.days) {
        notifications.push({
          id: notificationId(a.id, day),
          title: a.title,
          body: a.message || '',
          channelId: CHANNEL_ID,
          // Weekday is 1-indexed from Sunday in Capacitor; JS getDay() is 0-indexed
          // from Sunday. Off by one here and every alarm fires a day early.
          schedule: { on: { weekday: day + 1, hour: h, minute: m }, allowWhileIdle: true },
        });
      }
    }

    if (notifications.length > 0) await LocalNotifications.schedule({ notifications });
    console.log(`[alarms] armed ${notifications.length} native alarm(s)`);
    return true;
  } catch (e) {
    console.error('[alarms] native scheduling failed:', e);
    return false;
  }
}
