/**
 * Health Connect record types + their Android read-permission strings.
 *
 * Kept in a pure module (no Dexie/Capacitor imports) so the crash-critical
 * invariant is unit-testable: the native plugin's readRecords() runs in an
 * UNGUARDED coroutine, so calling it for a record type whose permission is not
 * granted throws a SecurityException that escapes the coroutine and
 * HARD-CRASHES the app (it never rejects the JS promise). We must therefore
 * only ever read the types the user actually granted — `grantedReadTypes`
 * computes exactly that from Health Connect's granted-permission list.
 *
 * Keep READ_PERMISSION in sync with android/app/src/main/AndroidManifest.xml.
 */
export type RecordType =
  | 'Steps'
  | 'SleepSession'
  | 'HeartRateSeries'
  | 'RestingHeartRate'
  | 'HeartRateVariabilityRmssd'
  | 'ExerciseSession'
  | 'ActiveCaloriesBurned'
  | 'TotalCaloriesBurned'
  | 'Distance';

export const READ_TYPES: RecordType[] = [
  'Steps',
  'SleepSession',
  'HeartRateSeries',
  'RestingHeartRate',
  'HeartRateVariabilityRmssd',
  'ExerciseSession',
  'ActiveCaloriesBurned',
  'TotalCaloriesBurned',
  'Distance'
];

export const READ_PERMISSION: Record<RecordType, string> = {
  Steps: 'android.permission.health.READ_STEPS',
  SleepSession: 'android.permission.health.READ_SLEEP',
  HeartRateSeries: 'android.permission.health.READ_HEART_RATE',
  RestingHeartRate: 'android.permission.health.READ_RESTING_HEART_RATE',
  HeartRateVariabilityRmssd: 'android.permission.health.READ_HEART_RATE_VARIABILITY',
  ExerciseSession: 'android.permission.health.READ_EXERCISE',
  ActiveCaloriesBurned: 'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  TotalCaloriesBurned: 'android.permission.health.READ_TOTAL_CALORIES_BURNED',
  Distance: 'android.permission.health.READ_DISTANCE'
};

/** True only if this record type's read permission is in the granted set. */
export function canRead(type: RecordType, granted: Set<string> | string[]): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return set.has(READ_PERMISSION[type]);
}

/** The subset of READ_TYPES that are safe to read (permission granted). */
export function grantedReadTypes(granted: Set<string> | string[]): RecordType[] {
  const set = granted instanceof Set ? granted : new Set(granted);
  return READ_TYPES.filter((t) => set.has(READ_PERMISSION[t]));
}
