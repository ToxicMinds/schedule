// Auto-generates "prep" alarms from the weekly gym/badminton schedule,
// so the user doesn't have to manually create an alarm for every
// training day. Each auto-managed alarm is tagged with a deterministic
// `auto_key` (e.g. "auto-gym-1") rather than relying on the alarm's own
// `id` (a uuid column, which can't hold a stable human-readable string)
// -- a unique index on (user_id, auto_key) lets upsert() update the
// existing row in place instead of creating duplicates every time the
// schedule changes, and lets us find + remove the right row for days
// that no longer have a scheduled time.
import type { PlanDay } from './data/workoutPlanDefaults';
import db from './db/dexie';
import { supabase } from './db/client';

const PREP_MINUTES_BEFORE = 45;

function subtractMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m - minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function autoKeyFor(dayOfWeek: number): string {
  return `auto-gym-${dayOfWeek}`;
}

/**
 * Regenerates every auto-managed alarm from the current schedule. Safe
 * to call any time the schedule changes (e.g. after an edit on the
 * Workouts page) -- it fully reconciles: updates times/titles for days
 * that still have a scheduled time, and deletes auto alarms for days
 * that no longer do.
 */
export async function syncAutoAlarms(uid: string, schedule: PlanDay[]) {
  let count = 0;

  for (const day of schedule) {
    const autoKey = autoKeyFor(day.day_of_week);
    if (day.time) {
      const isBadminton = day.label.toLowerCase().includes('cardio') || (day.note || '').toLowerCase().includes('badminton');
      // Badminton times are already given as the "leave now" alert time
      // (e.g. 18:15 for a 7pm match) -- gym session times are the actual
      // training start time, so we subtract the prep window from those.
      const alarmTime = isBadminton ? day.time : subtractMinutes(day.time, PREP_MINUTES_BEFORE);
      const title = isBadminton ? `🏸 Badminton tonight` : `🏋 ${day.label} in ${PREP_MINUTES_BEFORE} min`;
      const message = isBadminton
        ? day.note || 'Time to head to NTC'
        : `Session starts at ${day.time} — ${day.note || ''}`.trim();

      const { error } = await supabase.from('alarms').upsert(
        {
          id: crypto.randomUUID(), user_id: uid, auto_key: autoKey,
          title, message, time: alarmTime, days: [day.day_of_week], enabled: true,
        },
        { onConflict: 'user_id,auto_key' }
      );
      if (error) { console.error('Auto-alarm upsert failed:', error); continue; }
      count++;
    } else {
      // No scheduled time for this day (rest day) -- remove any
      // previously auto-generated alarm for it.
      const { data: existing } = await supabase.from('alarms').select('id').eq('user_id', uid).eq('auto_key', autoKey).maybeSingle();
      if (existing) {
        await db.table('alarms').delete(existing.id);
        await supabase.from('alarms').delete().eq('id', existing.id);
      }
    }
  }

  // Pull the freshly upserted/removed rows back into Dexie so the
  // Alarms page (which reads live from IndexedDB) reflects them
  // immediately without waiting for the next realtime round-trip.
  const { data: fresh } = await supabase.from('alarms').select('*').eq('user_id', uid);
  if (fresh) await db.table('alarms').bulkPut(fresh);

  return count;
}
