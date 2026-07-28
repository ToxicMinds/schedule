/**
 * Safe-area floor for the Android shell.
 *
 * THE BUG: the top bar (and the Update button in it) rendered underneath the
 * status bar / camera cutout, where it could not be tapped.
 *
 * WHY: three things line up badly.
 *   1. `targetSdkVersion 36` — since Android 15 the system FORCES edge-to-edge,
 *      so the activity draws behind the status bar whether it asks to or not.
 *   2. Capacitor's `android.adjustMarginsForEdgeToEdge` defaults to `"disable"`
 *      and this app never set it, so the bridge adds no compensating margin.
 *   3. Android's WebView does not populate `env(safe-area-inset-top)` the way
 *      iOS does. It reports 0px.
 *
 * So `--st` collapsed to 0 and the bar sat at y=0, under the status bar.
 *
 * THE FIX: floor the inset on Android only. `max()` means a device that DOES
 * report a real inset still wins — this only rescues the 0px case, so it stays
 * correct if a future Capacitor or WebView starts reporting insets properly.
 *
 * Deliberately not fixed by setting `adjustMarginsForEdgeToEdge: "auto"` in
 * capacitor.config.json: that is a native change needing an APK rebuild, and it
 * would then double up with this padding. One or the other, not both — this one
 * ships over the air.
 */

// ponytail: Android status bars are 24dp, but cutout devices size them taller
// (~32-40dp). CSS px == dp in the WebView, so this is a real measurement, not a
// magic number. If a device still clips, this is the single knob to turn.
const STATUS_BAR_FLOOR_PX = 34;

// The gesture pill. Same root cause, smaller consequence — the bottom nav sits
// slightly under it rather than being swallowed by it.
const NAV_BAR_FLOOR_PX = 16;

export async function applySafeAreaFallback(): Promise<void> {
  if (typeof document === 'undefined') return;

  try {
    const { Capacitor } = await import('@capacitor/core');
    // iOS reports insets correctly and the browser has no system bars to clear,
    // so both would only gain dead space from this.
    if (!Capacitor?.isNativePlatform?.()) return;
    if (Capacitor.getPlatform?.() !== 'android') return;
  } catch {
    // No Capacitor bundled (plain web build) — nothing to compensate for.
    return;
  }

  const root = document.documentElement;
  root.style.setProperty('--st', `max(env(safe-area-inset-top, 0px), ${STATUS_BAR_FLOOR_PX}px)`);
  root.style.setProperty('--sb', `max(env(safe-area-inset-bottom, 0px), ${NAV_BAR_FLOOR_PX}px)`);
  root.dataset.safeAreaFloor = 'android';
}
