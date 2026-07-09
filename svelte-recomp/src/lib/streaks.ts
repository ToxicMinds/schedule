// Pure date-math streak calculator (Noom/Lose-It-style adherence
// tracking), operating on a plain set of "logged" date strings
// (YYYY-MM-DD) -- no backend logic needed, everything is derived
// client-side from data already being collected.

export interface StreakResult {
  current: number;
  longest: number;
  // true if today hasn't been logged yet but yesterday was (so the
  // streak is still "alive", just needs today's entry to continue)
  atRisk: boolean;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * `graceDays` = how many consecutive missed days are tolerated without
 * breaking the streak (a "shield", so one bad day doesn't wipe out
 * weeks of progress -- this matters a lot for adherence/motivation).
 */
export function computeStreak(loggedDates: string[], today: string, graceDays = 1): StreakResult {
  const dates = [...new Set(loggedDates)].sort();
  if (dates.length === 0) return { current: 0, longest: 0, atRisk: false };

  // Longest streak ever, scanning forward with grace-day tolerance.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const gap = daysBetween(dates[i - 1], dates[i]);
    if (gap - 1 <= graceDays) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
  }

  // Current streak: walk backward from the most recent logged date,
  // only counting if it's within grace-days of "today".
  const lastLogged = dates[dates.length - 1];
  const gapToToday = daysBetween(lastLogged, today);
  if (gapToToday - 1 > graceDays) return { current: 0, longest, atRisk: false };

  let current = 1;
  for (let i = dates.length - 1; i > 0; i--) {
    const gap = daysBetween(dates[i - 1], dates[i]);
    if (gap - 1 <= graceDays) current += 1;
    else break;
  }
  const atRisk = lastLogged !== today && gapToToday >= 1;
  return { current, longest: Math.max(longest, current), atRisk };
}
