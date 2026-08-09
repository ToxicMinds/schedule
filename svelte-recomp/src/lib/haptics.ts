// ── HAPTICS ───────────────────────────────────────────────────────────────
// The app's sense of touch. It already SPEAKS (toasts) and GLOWS (verdict
// aura); this is the third channel — a short, physical buzz on the exact same
// moments that matter, so a PR or a new low is felt, not just seen.
//
// Design rules that keep it premium instead of annoying:
//   1. A tiny, DISTINCT vocabulary that mirrors the verdict language — a light
//      tick for navigation, a rising pattern for success, a hard triple for a
//      celebration. Same colour = meaning mapping, now in the fingertips.
//   2. Fires only on genuine events, never on every state change.
//   3. User can switch it off (Settings), and it silences itself entirely
//      under prefers-reduced-motion. Absent hardware (desktop) is a no-op.

export type Haptic =
  | 'tap'        // lightest — nav taps, minor selects
  | 'select'     // a hair firmer — a choice landed
  | 'impact'     // a single confident thud — gesture threshold crossed
  | 'success'    // rising two-beat — protein hit, target reached
  | 'warning'    // one firm nudge — over budget, at-risk
  | 'error'      // stutter — something went wrong
  | 'celebrate'; // triple crescendo — a PR, a new low

// Patterns in milliseconds (single number = one buzz; array = buzz/pause/…).
// Kept short so they read as texture, not as a phone ringing.
export const PATTERNS: Record<Haptic, number | number[]> = {
  tap: 8,
  select: 12,
  impact: 26,
  success: [14, 38, 24],
  warning: [22, 60, 22],
  error: [30, 45, 30, 45, 30],
  celebrate: [12, 28, 18, 28, 36],
};

// Enabled by default — this is a phone-first app and the whole point is that it
// feels native. Persisted to localStorage so the choice survives reloads.
let enabled = true;

export function hapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(v: boolean): void {
  enabled = v;
  try {
    localStorage.setItem('haptics', v ? '1' : '0');
  } catch {
    /* storage disabled — keep the in-memory value */
  }
}

/** Read the saved preference once at boot. Safe to call before paint. */
export function initHaptics(): void {
  try {
    const s = localStorage.getItem('haptics');
    if (s !== null) enabled = s === '1';
  } catch {
    /* storage disabled — default stays on */
  }
}

function reducedMotion(): boolean {
  return (
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Fire a named haptic. No-ops silently when disabled, reduced-motion, or on
 *  hardware/platforms without the Vibration API (e.g. desktop, iOS Safari). */
export function haptic(kind: Haptic): void {
  if (!enabled) return;
  if (reducedMotion()) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* some WebViews throw if called without a user gesture — ignore */
  }
}

/** Map a verdict/toast tone to the haptic that speaks the same meaning, so the
 *  buzz you feel always agrees with the colour you see. */
export function toneHaptic(tone: 'good' | 'ok' | 'warn' | 'bad'): Haptic {
  return tone === 'good' ? 'success'
    : tone === 'warn' ? 'warning'
    : tone === 'bad' ? 'error'
    : 'select';
}
