// Self-check for the pure logic behind the health-sync fixes.
//
// Run: node scripts/selfcheck.js
//
// These are the calculations where a silent regression corrupts real numbers
// rather than just breaking a screen — cross-source de-duplication (steps
// double-counting), watch-session muscle load (badminton recovery), local
// calendar dates (logs filed on the wrong day). No framework: plain asserts,
// so it runs anywhere Node does and fails loudly in one line.
//
// The .ts modules are imported directly — Node strips TypeScript types natively
// (22.18+), so no build step, no test runner and no transform is needed to
// exercise pure logic. Requires Node 22.18 or newer.

import assert from 'node:assert/strict';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}

const { pickOriginByDay, percentile } = await import('../src/lib/health/dedupe.ts');
const { preferredSource: guessWatchOrigin } = await import('../src/lib/health/watches.ts');
const { ymd, todayYmd, mondayOf, shiftYmd } = await import('../src/lib/date.ts');
const { foldDailyFocus } = await import('../src/lib/coach.ts');
const { sessionMuscleLoad, sessionRpe, activityLoadAU, buildActivitySessions } =
  await import('../src/lib/health/exercise.ts');
const { calcBmr, calcTdee, projectGoalWithTdee } = await import('../src/lib/tdee.ts');
const { adaptiveTdee, targetIntakeForLoss, KCAL_PER_KG } = await import('../src/lib/adaptiveTdee.ts');
const { computeReadiness, recoveryState, acuteChronicRatio, sessionLoad, exerciseModifier } =
  await import('../src/lib/readiness.ts');
const { estOneRM, bestE1RM, strengthTrend } = await import('../src/lib/strength.ts');
const { weightTrend, parseCalorieTarget, waterTargetLitres } = await import('../src/lib/coach.ts');

// --- Today's Focus folds into three topics --------------------------------

const fi = (id, severity = 'info') => ({ id, severity, icon: '*', title: id, msg: id });

check('focus folds into at most three topics, weight becomes the headline', () => {
  const { headline, groups } = foldDailyFocus([
    fi('weight-up', 'warn'), fi('cal-over', 'bad'), fi('protein-low', 'warn'),
    fi('water-low'), fi('sleep-low', 'bad'), fi('steps-good', 'good'),
    fi('workout-today'), fi('strength-hold', 'good'), fi('move-snack'),
  ]);
  assert.equal(headline.id, 'weight-up', 'weight is the outcome, not a topic');
  assert.ok(groups.length <= 3, `expected <=3 topics, got ${groups.length}`);
  assert.deepEqual(groups.map((g) => g.key).sort(), ['fuel', 'recover', 'train']);
});

check('each topic leads with its most severe item and counts the rest', () => {
  const { groups } = foldDailyFocus([
    fi('cal-over', 'bad'), fi('protein-low', 'warn'), fi('water-low', 'info'),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].lead.id, 'cal-over', 'worst-first survives the fold');
  assert.equal(groups[0].more, 2, 'the two it stands in for are counted');
});

check('worst topic sorts first regardless of reading order', () => {
  const { groups } = foldDailyFocus([
    fi('cal-ontrack', 'good'), fi('sleep-low', 'bad'),
  ]);
  assert.equal(groups[0].key, 'recover', 'a bad Recover outranks a good Fuel');
});

check('an unmapped coach id is still shown, never silently dropped', () => {
  const { groups } = foldDailyFocus([fi('brand-new-section', 'bad')]);
  const all = groups.flatMap((g) => [g.lead.id]);
  assert.ok(all.includes('brand-new-section'),
    'a new coach section must not vanish just because it has no topic yet');
});

check('no weight item means the worst topic supplies the headline', () => {
  const { headline, groups } = foldDailyFocus([fi('sleep-low', 'bad'), fi('cal-over', 'bad')]);
  assert.equal(headline, null, 'headline is weight-only by design');
  assert.ok(groups.length > 0, 'the card must never render headless');
});

check('an empty feed folds to nothing rather than throwing', () => {
  const { headline, groups } = foldDailyFocus([]);
  assert.equal(headline, null);
  assert.deepEqual(groups, []);
});

console.log('\ndedupe — cross-source de-duplication');

const WATCH = 'com.oneplus.health.international';
const PHONE = 'com.google.android.apps.fitness';

check('picks ONE source per day instead of summing (the double-count bug)', () => {
  // The exact real-world shape: the same day's steps written by both the phone
  // and the watch. Summing gives 15200; the truth is one of them, not both.
  const records = [
    { day: '2026-07-27', v: 8200, o: WATCH },
    { day: '2026-07-27', v: 7000, o: PHONE }
  ];
  const out = pickOriginByDay(records, {
    dayOf: (r) => r.day,
    valueOf: (r) => r.v,
    originOf: (r) => r.o,
    preferred: WATCH
  });
  assert.equal(out['2026-07-27'].total, 8200, 'must not sum across sources');
  assert.equal(out['2026-07-27'].origin, WATCH);
  assert.equal(out['2026-07-27'].records.length, 1);
});

check('preferred source wins even on a low-wear day', () => {
  // A short-wear day should read low, not be silently replaced by the phone.
  const records = [
    { day: 'd', v: 1200, o: WATCH },
    { day: 'd', v: 9000, o: PHONE }
  ];
  const out = pickOriginByDay(records, {
    dayOf: (r) => r.day, valueOf: (r) => r.v, originOf: (r) => r.o, preferred: WATCH
  });
  assert.equal(out.d.total, 1200);
});

check('falls back to the fullest source when there is no preference', () => {
  const records = [
    { day: 'd', v: 1200, o: WATCH },
    { day: 'd', v: 9000, o: PHONE }
  ];
  const out = pickOriginByDay(records, {
    dayOf: (r) => r.day, valueOf: (r) => r.v, originOf: (r) => r.o, preferred: null
  });
  assert.equal(out.d.origin, PHONE);
});

check('multiple records from the winning source still sum', () => {
  const records = [
    { day: 'd', v: 300, o: WATCH },
    { day: 'd', v: 500, o: WATCH },
    { day: 'd', v: 9000, o: PHONE }
  ];
  const out = pickOriginByDay(records, {
    dayOf: (r) => r.day, valueOf: (r) => r.v, originOf: (r) => r.o, preferred: WATCH
  });
  assert.equal(out.d.total, 800, 'within one source, records are additive');
});

check('ties break deterministically (same answer every sync)', () => {
  const mk = (order) => pickOriginByDay(order, {
    dayOf: (r) => r.day, valueOf: (r) => r.v, originOf: (r) => r.o, preferred: null
  }).d.origin;
  const a = [{ day: 'd', v: 100, o: 'b.app' }, { day: 'd', v: 100, o: 'a.app' }];
  assert.equal(mk(a), mk([...a].reverse()), 'insertion order must not change the winner');
});

check('days are independent — a source missing one day does not lose the day', () => {
  const records = [
    { day: 'mon', v: 500, o: PHONE },
    { day: 'tue', v: 900, o: WATCH }
  ];
  const out = pickOriginByDay(records, {
    dayOf: (r) => r.day, valueOf: (r) => r.v, originOf: (r) => r.o, preferred: WATCH
  });
  assert.equal(out.mon.total, 500, 'preferred source absent → best available wins');
  assert.equal(out.tue.total, 900);
});

console.log('\npercentile — resting HR derivation');

check('p05 ignores the single lowest outlier the old code used', () => {
  // One 41bpm deep-sleep dip among normal sleeping values. min() would report
  // 41 as resting HR; the 5th percentile stays near the real resting band.
  const samples = [41, 55, 56, 57, 58, 58, 59, 60, 61, 62];
  assert.equal(Math.min(...samples), 41);
  const p5 = percentile(samples, 0.05);
  assert.ok(p5 > 45, `p05 should reject the outlier, got ${p5}`);
});

check('percentile handles empty and single-value input', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([60], 0.05), 60);
});

check('guessWatchOrigin finds the OEM watch app, not the phone', () => {
  assert.equal(guessWatchOrigin([PHONE, WATCH]), WATCH);
  assert.equal(guessWatchOrigin([PHONE]), null, 'phone-only user gets no false watch');
});

console.log('\ndate — local calendar (logs must not land on the wrong day)');

check('ymd uses LOCAL date, not UTC', () => {
  // 00:30 local on the 27th. toISOString() would say the 26th anywhere east of
  // UTC — that is exactly the bug that filed morning food under yesterday.
  const d = new Date(2026, 6, 27, 0, 30, 0);
  assert.equal(ymd(d), '2026-07-27');
  assert.equal(d.getDate(), 27);
});

check('ymd pads month and day', () => {
  assert.equal(ymd(new Date(2026, 0, 5)), '2026-01-05');
});

check('todayYmd matches the device calendar', () => {
  const n = new Date();
  assert.equal(todayYmd(), ymd(n));
});

check('mondayOf treats Sunday as the end of the week, not the start', () => {
  assert.equal(mondayOf(new Date(2026, 6, 27)), '2026-07-27'); // Monday itself
  assert.equal(mondayOf(new Date(2026, 6, 26)), '2026-07-20'); // Sunday → previous Monday
  assert.equal(mondayOf(new Date(2026, 6, 29)), '2026-07-27'); // Wednesday
});

check('shiftYmd crosses month boundaries correctly', () => {
  assert.equal(shiftYmd(-2, new Date(2026, 7, 1)), '2026-07-30');
});

console.log('\nexercise — watch sessions as training load');

const BADMINTON = 2;
const STRENGTH = 70;

check('badminton loads the muscles it actually works', () => {
  const load = sessionMuscleLoad({ exercise_type: BADMINTON, duration_min: 60 });
  for (const m of ['Quads', 'Calves', 'Glutes', 'Shoulders', 'Core']) {
    assert.ok(load[m] > 0, `badminton should load ${m}, got ${load[m]}`);
  }
  assert.ok(load.Quads > load.Shoulders, 'lunging should cost the quads more than the shoulder');
});

check('a longer match costs more recovery than a short one', () => {
  const short = sessionMuscleLoad({ exercise_type: BADMINTON, duration_min: 20 });
  const long = sessionMuscleLoad({ exercise_type: BADMINTON, duration_min: 120 });
  assert.ok(long.Quads > short.Quads, 'duration must scale the load');
  // ...but within sane bounds, so a marathon session can't claim an absurd cost.
  assert.ok(long.Quads / short.Quads <= 3.1, 'scaling must stay clamped');
});

check('lifting sessions are NOT muscle-mapped (would double-count logged sets)', () => {
  assert.deepEqual(sessionMuscleLoad({ exercise_type: STRENGTH, duration_min: 60 }), {},
    'the watch cannot know which muscles a lifting session hit');
  assert.deepEqual(sessionMuscleLoad({ exercise_type: 81, duration_min: 60 }), {});
});

check('unknown activity types degrade to no claim rather than a wrong one', () => {
  assert.deepEqual(sessionMuscleLoad({ exercise_type: 9999, duration_min: 60 }), {});
});

check('RPE prefers real heart rate over the activity-type guess', () => {
  const hard = sessionRpe({ kind: 'sport', avg_hr: 165 });
  const easy = sessionRpe({ kind: 'sport', avg_hr: 95 });
  assert.ok(hard > easy, 'a higher heart rate must mean a harder session');
  assert.equal(sessionRpe({ kind: 'sport', avg_hr: null }), 7, 'falls back to type default');
});

check('training load scales with both duration and intensity', () => {
  const a = activityLoadAU({ kind: 'sport', duration_min: 90, avg_hr: 155 });
  const b = activityLoadAU({ kind: 'sport', duration_min: 45, avg_hr: 155 });
  assert.equal(a, b * 2, 'twice the time at the same intensity is twice the load');
  assert.ok(activityLoadAU({ kind: 'mind', duration_min: 60, avg_hr: null }) <
            activityLoadAU({ kind: 'sport', duration_min: 60, avg_hr: null }),
            'yoga must not cost the same as a match');
});

console.log('\nexercise — session de-duplication');

const iso = (h, m = 0) => new Date(2026, 6, 27, h, m).toISOString();
const session = (startH, endH, type = BADMINTON) => ({
  startTime: iso(startH), endTime: iso(endH), exerciseType: type
});

check('two back-to-back matches both survive (the old rule deleted one)', () => {
  // 18:00-18:40 and 18:45-19:25. The old "same type, starts within 5 min" rule
  // was fine here, but "starts within 5 min" DID delete genuine pairs — this
  // asserts distinct, non-overlapping sessions are always kept.
  const out = buildActivitySessions({
    uid: 'u',
    exercises: [
      { startTime: iso(18, 0), endTime: iso(18, 40), exerciseType: BADMINTON },
      { startTime: iso(18, 45), endTime: iso(19, 25), exerciseType: BADMINTON }
    ]
  });
  assert.equal(out.length, 2, 'two real matches must both count');
});

check('the same match written twice collapses to one', () => {
  // A true duplicate: OHealth writing it once automatically and once manually,
  // covering essentially the same window.
  const out = buildActivitySessions({
    uid: 'u',
    exercises: [
      { startTime: iso(18, 0), endTime: iso(19, 30), exerciseType: BADMINTON },
      { startTime: iso(18, 2), endTime: iso(19, 28), exerciseType: BADMINTON }
    ]
  });
  assert.equal(out.length, 1, 'overlapping copies of one match must merge');
  assert.equal(out[0].duration_min, 90, 'the fuller record wins');
});

check('different activities at the same time are not merged', () => {
  const out = buildActivitySessions({
    uid: 'u',
    exercises: [
      { startTime: iso(18, 0), endTime: iso(19, 0), exerciseType: BADMINTON },
      { startTime: iso(18, 0), endTime: iso(19, 0), exerciseType: 56 }
    ]
  });
  assert.equal(out.length, 2, 'badminton and a run are different sessions');
});

check('calories are pro-rated by overlap, not double-counted', () => {
  const out = buildActivitySessions({
    uid: 'u',
    exercises: [{ startTime: iso(18, 0), endTime: iso(19, 0), exerciseType: BADMINTON }],
    // A two-hour bucket, half of which falls inside the session.
    activeCals: [{ startTime: iso(18, 0), endTime: iso(20, 0), energy: { value: 800 } }]
  });
  assert.equal(out[0].active_kcal, 400, 'only the overlapping slice counts');
});

check('session dates use the LOCAL day', () => {
  const out = buildActivitySessions({
    uid: 'u',
    exercises: [{ startTime: iso(0, 30), endTime: iso(1, 30), exerciseType: BADMINTON }]
  });
  assert.equal(out[0].date, '2026-07-27', 'a 00:30 session belongs to that local day');
});

// ————————————————————————————————————————————————————————————————
// The physiology math. This is the app's actual product — every number it
// shows you is one of these functions. None of it had a test before; the only
// check was that it compiled. A wrong calorie target or a wrong "your quads
// are recovered" is worse than no app at all, because you act on it.
// ————————————————————————————————————————————————————————————————

console.log('\ntdee — calorie targets');

check('Mifflin-St Jeor matches the published formula', () => {
  // 80kg, 180cm, 30y male: 10(80) + 6.25(180) − 5(30) + 5 = 1780
  assert.equal(calcBmr({ weightKg: 80, heightCm: 180, age: 30, gender: 'male' }), 1780);
  // Same body, female: −161 instead of +5 → 1614
  assert.equal(calcBmr({ weightKg: 80, heightCm: 180, age: 30, gender: 'female' }), 1614);
});

check('BMR falls with age and rises with mass', () => {
  const young = calcBmr({ weightKg: 80, heightCm: 180, age: 25, gender: 'male' });
  const old = calcBmr({ weightKg: 80, heightCm: 180, age: 55, gender: 'male' });
  assert.ok(young > old);
  const heavy = calcBmr({ weightKg: 120, heightCm: 180, age: 25, gender: 'male' });
  assert.ok(heavy > young);
});

check('activity multiplier is applied', () => {
  const base = { weightKg: 80, heightCm: 180, age: 30, gender: 'male' };
  const sed = calcTdee({ ...base, activityLevel: 'sedentary' });
  const act = calcTdee({ ...base, activityLevel: 'active' });
  assert.equal(sed, Math.round(1780 * 1.2));
  assert.ok(act > sed);
});

check('deficit is capped at 750 kcal however big the TDEE', () => {
  // 20% of 5000 would be 1000 — an unsafe cut. Must clamp.
  const p = projectGoalWithTdee(5000, 140, 90);
  assert.equal(p.dailyDeficitKcal, 750);
  assert.equal(p.targetIntakeKcal, 4250);
});

check('goal projection is arithmetically consistent', () => {
  const p = projectGoalWithTdee(2500, 100, 90);
  assert.equal(p.kgToLose, 10);
  assert.equal(p.dailyDeficitKcal, 500);
  assert.equal(p.targetIntakeKcal, 2000);
  // 10kg × 7700 / (500 × 7) = 22 weeks
  assert.equal(p.weeksToGoal, Math.ceil((10 * 7700) / (500 * 7)));
});

check('already at goal → no deficit timeline', () => {
  const p = projectGoalWithTdee(2500, 85, 90);
  assert.equal(p.kgToLose, 0);
  assert.equal(p.weeksToGoal, 0);
});

console.log('\nadaptiveTdee — learned maintenance');

// Build a clean 28-day window: eating 2000/day, losing 0.5 kg/week.
// Energy balance says true maintenance = 2000 + (0.5/7 × 7700) = 2550.
function series(days, kcal, startKg, kgPerWeek) {
  const intake = [], weights = [];
  for (let i = 0; i < days; i++) {
    const date = shiftYmd(-(days - 1 - i), new Date(2026, 5, 30));
    intake.push({ date, kcal });
    weights.push({ date, weight: +(startKg - (kgPerWeek * i) / 7).toFixed(2) });
  }
  return { intake, weights };
}

check('recovers true maintenance from intake + weight trend', () => {
  const { intake, weights } = series(28, 2000, 100, 0.5);
  const r = adaptiveTdee({ intake, weights, asOf: intake[intake.length - 1].date });
  assert.ok(r.tdee != null, 'should have enough data');
  assert.ok(Math.abs(r.tdee - 2550) <= 15, `expected ~2550, got ${r.tdee}`);
  assert.equal(r.confidence, 'high');
});

check('weight GAIN implies maintenance below intake', () => {
  const { intake, weights } = series(28, 3000, 100, -0.5); // gaining
  const r = adaptiveTdee({ intake, weights, asOf: intake[intake.length - 1].date });
  assert.ok(r.tdee < 3000, `gaining on 3000 means burning less, got ${r.tdee}`);
});

check('refuses to guess without enough logged days', () => {
  const { intake, weights } = series(28, 2000, 100, 0.5);
  const r = adaptiveTdee({ intake: intake.slice(0, 5), weights, asOf: intake[27].date });
  assert.equal(r.tdee, null);
  assert.equal(r.confidence, 'insufficient');
});

check('unlogged days are excluded, not averaged in as near-fasts', () => {
  // This is the dangerous failure: blank days dragging mean intake down makes
  // the app tell you to eat even less.
  const { intake, weights } = series(28, 2000, 100, 0.5);
  const withBlanks = intake.map((d, i) => (i % 3 === 0 ? { ...d, kcal: 120 } : d));
  const r = adaptiveTdee({ intake: withBlanks, weights, asOf: intake[27].date });
  assert.ok(r.meanIntake >= 1900, `blank days must not drag the mean, got ${r.meanIntake}`);
});

check('implausible results are downgraded rather than shown', () => {
  // Losing 3 kg/week on 2000 kcal implies a ~5300 kcal burn — not credible.
  const { intake, weights } = series(28, 2000, 130, 4);
  const r = adaptiveTdee({ intake, weights, asOf: intake[27].date });
  assert.ok(r.tdee === null || (r.tdee >= 1200 && r.tdee <= 5500),
    `out-of-range TDEE must be suppressed, got ${r.tdee}`);
});

check('loss target never recommends an unsafe intake', () => {
  assert.equal(targetIntakeForLoss(1800, 2), 1500, 'must floor at 1500');
  assert.equal(targetIntakeForLoss(2550, 0.5), 2550 - Math.round((0.5 * KCAL_PER_KG) / 7));
});

console.log('\nreadiness — recovery and training load');

check('readiness weights HRV and sleep, and works with partial data', () => {
  const hist = [{ date: 'd1', hrv: 60, resting_hr: 55 }];
  const sleepOnly = computeReadiness({ date: 'd', sleep_hours: 8 }, hist);
  assert.ok(sleepOnly.score > 0, 'sleep alone must still produce a score');
  const bad = computeReadiness({ date: 'd', sleep_hours: 4 }, hist);
  assert.ok(bad.score < sleepOnly.score, 'less sleep must score lower');
});

check('readiness returns null with nothing logged', () => {
  assert.equal(computeReadiness(undefined, []), null);
  assert.equal(computeReadiness({ date: 'd' }, []), null, 'an empty entry is not a score');
});

check('HRV below personal baseline lowers readiness', () => {
  const hist = [{ date: 'a', hrv: 80 }, { date: 'b', hrv: 80 }];
  const low = computeReadiness({ date: 'd', hrv: 40 }, hist);
  const high = computeReadiness({ date: 'd', hrv: 90 }, hist);
  assert.ok(low.score < high.score);
});

check('recovery percentage tracks elapsed time against the window', () => {
  assert.equal(recoveryState(0, 60).status, 'fatigued');
  assert.equal(recoveryState(30, 60).status, 'recovering');
  assert.equal(recoveryState(60, 60).status, 'ready');
  assert.equal(recoveryState(90, 60).pct, 100, 'must clamp at 100%');
  assert.equal(recoveryState(30, 60).readyInH, 30);
  assert.equal(recoveryState(null, 60).status, 'none');
});

check('high-eccentric lifts need longer recovery than isolation work', () => {
  assert.ok(exerciseModifier('Romanian Deadlift') > exerciseModifier('Barbell Row'));
  assert.ok(exerciseModifier('Leg Extension') < exerciseModifier('Barbell Row'));
});

check('ACWR flags a genuine training spike', () => {
  // 28 steady days, then a hard last week — the classic injury-risk pattern.
  const loads = [];
  for (let i = 27; i >= 0; i--) {
    loads.push({ date: shiftYmd(-i, new Date(2026, 5, 30)), loadAU: i < 7 ? 600 : 100 });
  }
  const r = acuteChronicRatio(loads, ymd(new Date(2026, 5, 30)));
  assert.ok(r.ratio > 1.5, `spike should read high-risk, got ${r.ratio}`);
  assert.equal(r.zone, 'high-risk');
});

check('ACWR stays in the sweet spot for steady training', () => {
  const loads = [];
  for (let i = 27; i >= 0; i--) {
    loads.push({ date: shiftYmd(-i, new Date(2026, 5, 30)), loadAU: 300 });
  }
  const r = acuteChronicRatio(loads, ymd(new Date(2026, 5, 30)));
  assert.equal(r.zone, 'sweet-spot');
});

check('ACWR admits when there is not enough history', () => {
  const r = acuteChronicRatio([{ date: '2026-06-30', loadAU: 300 }], '2026-06-30');
  assert.equal(r.zone, 'no-data');
  assert.equal(r.ratio, null);
});

check('session load scales with sets and effort', () => {
  assert.equal(sessionLoad(10, 7), 10 * 3 * 7);
  assert.ok(sessionLoad(10, 9) > sessionLoad(10, 5));
});

console.log('\nstrength — the muscle-retention verdict');

check('Epley e1RM levels different rep ranges', () => {
  assert.ok(estOneRM(10, 80) > estOneRM(10, 70), 'more load at equal reps = higher max');
  assert.ok(estOneRM(10, 80) > 80, 'ten reps implies a higher max than the load lifted');
  assert.ok(estOneRM(8, 100) > estOneRM(5, 100), 'more reps at equal load = higher max');
  // Standard Epley is w × (1 + reps/30), so a true single reads ~3.3% high.
  // Harmless here because the app only ever compares e1RM against e1RM — the
  // bias is identical on both sides. Worth knowing before quoting it as a 1RM.
  assert.ok(Math.abs(estOneRM(1, 100) - 103.33) < 0.01);
});

check('bestE1RM ignores incomplete sets', () => {
  assert.equal(bestE1RM([{ reps: null, weight_kg: 100 }, { reps: 5, weight_kg: null }]), null);
  assert.equal(bestE1RM([{ reps: 5, weight_kg: 100 }, { reps: 1, weight_kg: 90 }]),
    estOneRM(5, 100), 'the best set wins, not the heaviest');
  assert.equal(bestE1RM([]), null);
});

const NOW = new Date(2026, 5, 30).getTime();
const dayAgo = (n) => shiftYmd(-n, new Date(2026, 5, 30));

check('rising lifts read as muscle retained', () => {
  const logs = [
    { date: dayAgo(30), exercise_name: 'Bench', sets: [{ reps: 5, weight_kg: 80 }] },
    { date: dayAgo(5), exercise_name: 'Bench', sets: [{ reps: 5, weight_kg: 90 }] },
    { date: dayAgo(30), exercise_name: 'Squat', sets: [{ reps: 5, weight_kg: 100 }] },
    { date: dayAgo(5), exercise_name: 'Squat', sets: [{ reps: 5, weight_kg: 110 }] }
  ];
  const t = strengthTrend(logs, { asOf: NOW });
  assert.equal(t.direction, 'up');
  assert.equal(t.comparableLifts, 2);
  assert.ok(t.avgPct > 0);
});

check('falling lifts read as muscle at risk', () => {
  const logs = [
    { date: dayAgo(30), exercise_name: 'Bench', sets: [{ reps: 5, weight_kg: 90 }] },
    { date: dayAgo(5), exercise_name: 'Bench', sets: [{ reps: 5, weight_kg: 78 }] },
    { date: dayAgo(30), exercise_name: 'Squat', sets: [{ reps: 5, weight_kg: 110 }] },
    { date: dayAgo(5), exercise_name: 'Squat', sets: [{ reps: 5, weight_kg: 95 }] }
  ];
  const t = strengthTrend(logs, { asOf: NOW });
  assert.equal(t.direction, 'down');
  assert.ok(t.topMover, 'should name the worst lift');
});

check('refuses a verdict off a single lift', () => {
  const logs = [
    { date: dayAgo(30), exercise_name: 'Bench', sets: [{ reps: 5, weight_kg: 80 }] },
    { date: dayAgo(5), exercise_name: 'Bench', sets: [{ reps: 5, weight_kg: 90 }] }
  ];
  assert.equal(strengthTrend(logs, { asOf: NOW }).direction, 'insufficient');
});

check('a lift trained in only one window is not comparable', () => {
  const logs = [
    { date: dayAgo(5), exercise_name: 'Bench', sets: [{ reps: 5, weight_kg: 90 }] },
    { date: dayAgo(5), exercise_name: 'Squat', sets: [{ reps: 5, weight_kg: 110 }] }
  ];
  assert.equal(strengthTrend(logs, { asOf: NOW }).comparableLifts, 0);
});

console.log('\ncoach — trend reading and targets');

check('weight trend uses regression, not first-vs-last', () => {
  // Steady 0.5 kg/week loss with heavy daily water noise. A point-to-point
  // read would be dominated by the noise; the slope must see through it.
  const pts = [];
  for (let i = 27; i >= 0; i--) {
    const noise = (i % 3) - 1; // ±1 kg of water swing
    pts.push({ date: dayAgo(i), weight: +(100 - (0.5 * (27 - i)) / 7 + noise).toFixed(1) });
  }
  const t = weightTrend(pts, 90);
  assert.ok(Math.abs(t.rateKgPerWeek - 0.5) < 0.25, `expected ~0.5, got ${t.rateKgPerWeek}`);
  assert.ok(t.spanDays >= 27);
});

check('a flat month above goal is called a plateau', () => {
  const pts = [];
  for (let i = 27; i >= 0; i--) pts.push({ date: dayAgo(i), weight: 100 + ((i % 2) * 0.1) });
  const t = weightTrend(pts, 90);
  assert.equal(t.plateau, true);
  assert.ok(t.plateauWeeks >= 2);
});

check('two weigh-ins are never called a plateau', () => {
  const t = weightTrend([{ date: dayAgo(1), weight: 100 }, { date: dayAgo(0), weight: 100 }], 90);
  assert.equal(t.plateau, false, 'a 1-day span cannot establish a plateau');
});

check('losing weight is a positive rate', () => {
  const pts = [];
  for (let i = 27; i >= 0; i--) pts.push({ date: dayAgo(i), weight: 100 - (27 - i) * 0.1 });
  assert.ok(weightTrend(pts, 90).rateKgPerWeek > 0, 'sign convention: positive = losing');
});

check('calorie target is parsed back out of the goal narrative', () => {
  assert.equal(parseCalorieTarget('Cut to 90kg — target intake ~2100 kcal/day, high protein.'), 2100);
  assert.equal(parseCalorieTarget('no numbers here'), null);
  assert.equal(parseCalorieTarget(null), null);
});

check('water target scales with bodyweight inside sane bounds', () => {
  assert.equal(waterTargetLitres(null), 3, 'unknown weight gets a sane default');
  assert.ok(waterTargetLitres(60) >= 2.5, 'floor');
  assert.ok(waterTargetLitres(150) <= 4, 'ceiling');
  assert.ok(waterTargetLitres(100) > waterTargetLitres(60));
});

console.log('\nrecomp — the fat-or-muscle verdict');

const { recompVerdict, measuredComposition, leanMass, fatMass } =
  await import('../src/lib/recomp.ts');

const trend = (dir, pct, lifts = 3) => ({
  direction: dir, avgPct: pct, liftsUp: 0, liftsDown: 0,
  comparableLifts: lifts, topMover: { name: 'Squat', pct }, windowDays: 21
});

check('lean and fat mass split out of weight and body fat', () => {
  assert.equal(leanMass(100, 30), 70);
  assert.equal(fatMass(100, 30), 30);
});

check('measured composition separates fat loss from lean loss', () => {
  // 100kg @ 30% → 30kg fat / 70kg lean.  94kg @ 26% → 24.44 fat / 69.56 lean.
  // So 5.56kg of fat lost and only 0.44kg of lean — a well-run cut.
  const c = measuredComposition([
    { date: '2026-04-01', bfPct: 30, weightKg: 100 },
    { date: '2026-06-01', bfPct: 26, weightKg: 94 }
  ]);
  assert.ok(Math.abs(c.fatKg - 5.56) < 0.05, `fat lost ${c.fatKg}`);
  assert.ok(Math.abs(c.leanKg - 0.44) < 0.05, `lean lost ${c.leanKg}`);
  assert.ok(c.fatShare > 0.9);
});

check('composition refuses a window too short to beat measurement noise', () => {
  assert.equal(measuredComposition([
    { date: '2026-06-01', bfPct: 30, weightKg: 100 },
    { date: '2026-06-10', bfPct: 28, weightKg: 98 }
  ]), null, 'under 21 days is noise, not a measurement');
  assert.equal(measuredComposition([{ date: '2026-06-01', bfPct: 30, weightKg: 100 }]), null);
  assert.equal(measuredComposition(undefined), null);
});

check('measured lean GAIN while fat falls is called recomp', () => {
  const v = recompVerdict({
    weightRateKgPerWeek: 0.2, trendSpanDays: 60, currentWeightKg: 96,
    bodyFat: [
      { date: '2026-04-01', bfPct: 30, weightKg: 100 },
      { date: '2026-06-01', bfPct: 25, weightKg: 96 }
    ]
  });
  assert.equal(v.direction, 'recomp');
  assert.ok(v.composition.leanKg < 0, 'negative lean loss means lean was gained');
});

check('losing mostly lean mass raises the alarm', () => {
  // 100kg @ 30% → 30 fat / 70 lean.  92kg @ 29% → 26.68 fat / 65.32 lean.
  // 3.3kg fat vs 4.7kg lean — the cut is taking muscle.
  const v = recompVerdict({
    weightRateKgPerWeek: 1.0, trendSpanDays: 60, currentWeightKg: 92,
    bodyFat: [
      { date: '2026-04-01', bfPct: 30, weightKg: 100 },
      { date: '2026-06-01', bfPct: 29, weightKg: 92 }
    ]
  });
  assert.equal(v.direction, 'muscle-risk');
  assert.ok(v.levers.length > 0, 'a bad verdict must come with what to change');
});

check('measured data outranks the strength proxy', () => {
  // Strength says "up", but the scan says most of the loss was lean. Trust the
  // measurement — this is the case where a proxy would give false comfort.
  const v = recompVerdict({
    weightRateKgPerWeek: 1.0, trendSpanDays: 60, currentWeightKg: 92,
    strength: trend('up', 5),
    bodyFat: [
      { date: '2026-04-01', bfPct: 30, weightKg: 100 },
      { date: '2026-06-01', bfPct: 29, weightKg: 92 }
    ]
  });
  assert.equal(v.direction, 'muscle-risk');
});

check('losing weight with strength holding reads as fat loss', () => {
  const v = recompVerdict({
    weightRateKgPerWeek: 0.6, trendSpanDays: 28, currentWeightKg: 100,
    strength: trend('holding', 0.2)
  });
  assert.equal(v.direction, 'fat-loss');
});

check('losing weight with strength falling flags muscle risk', () => {
  const v = recompVerdict({
    weightRateKgPerWeek: 1.2, trendSpanDays: 28, currentWeightKg: 100,
    strength: trend('down', -6)
  });
  assert.equal(v.direction, 'muscle-risk');
  assert.ok(v.levers.some((l) => /deficit/i.test(l)), 'must suggest easing the deficit');
});

check('flat weight with rising strength is recomp', () => {
  const v = recompVerdict({
    weightRateKgPerWeek: 0.02, trendSpanDays: 30, currentWeightKg: 90,
    strength: trend('up', 6)
  });
  assert.equal(v.direction, 'recomp');
});

check('gaining without strength gains is called fat gain', () => {
  const v = recompVerdict({
    weightRateKgPerWeek: -0.4, trendSpanDays: 30, currentWeightKg: 100,
    strength: trend('holding', 0)
  });
  assert.equal(v.direction, 'fat-gain');
});

check('never claims muscle retention without evidence', () => {
  // The dangerous false positive: losing fast, nothing logged. Must NOT
  // reassure — an unearned "you're keeping muscle" keeps someone cutting.
  const v = recompVerdict({
    weightRateKgPerWeek: 1.5, trendSpanDays: 30, currentWeightKg: 100
  });
  assert.equal(v.direction, 'insufficient');
  assert.notEqual(v.direction, 'fat-loss');
  assert.ok(v.levers.length > 0, 'must say what to log');
});

check('says so plainly when the trend is too short', () => {
  const v = recompVerdict({
    weightRateKgPerWeek: 2, trendSpanDays: 5, currentWeightKg: 100,
    strength: trend('up', 5)
  });
  assert.equal(v.direction, 'insufficient');
  assert.equal(v.confidence, 'low');
});

check('an over-fast cut is flagged as a lever', () => {
  const v = recompVerdict({
    weightRateKgPerWeek: 2.0, trendSpanDays: 28, currentWeightKg: 100,
    strength: trend('holding', 0)
  });
  assert.ok(v.levers.some((l) => /bodyweight per week/i.test(l)),
    'losing 2% of bodyweight a week must be called out');
});

check('poor protein adherence becomes a named lever', () => {
  const v = recompVerdict({
    weightRateKgPerWeek: 0.6, trendSpanDays: 28, currentWeightKg: 100,
    strength: trend('holding', 0),
    proteinTargetG: 160, proteinDaysHit: 2, proteinDaysLogged: 12
  });
  assert.ok(v.levers.some((l) => /protein/i.test(l)));
  assert.ok(v.evidence.some((e) => e.label === 'Protein target' && e.verdict === 'bad'));
});

check('too little logging to judge protein is not counted against you', () => {
  const v = recompVerdict({
    weightRateKgPerWeek: 0.6, trendSpanDays: 28, currentWeightKg: 100,
    strength: trend('holding', 0),
    proteinDaysHit: 0, proteinDaysLogged: 2
  });
  assert.ok(!v.evidence.some((e) => e.label === 'Protein target'),
    'two logged days is not an adherence verdict');
});

check('every verdict carries evidence the user can check', () => {
  const v = recompVerdict({
    weightRateKgPerWeek: 0.6, trendSpanDays: 28, currentWeightKg: 100,
    strength: trend('holding', 0), liftingSessions14: 6
  });
  assert.ok(v.evidence.length >= 3);
  assert.ok(v.headline && v.detail, 'never a bare label with no explanation');
});

console.log('\nprofile — making it work for anyone');

const { ageFrom, isComplete, missingFields, suggestGoalKg, proteinTargetG: profileProtein,
        kgToLb, lbToKg, ftInToCm, cmToFtIn, suggestActivityLevel } =
  await import('../src/lib/profile.ts');

const AT = new Date(2026, 0, 1);

check('age is derived from birth year, so it never goes stale', () => {
  assert.equal(ageFrom(1990, AT), 36);
  assert.equal(ageFrom(1990, new Date(2027, 0, 1)), 37, 'same record, a year later');
});

check('implausible birth years are rejected, not fed to the calorie formula', () => {
  assert.equal(ageFrom(2025, AT), null, 'a 1-year-old is not a user');
  assert.equal(ageFrom(1700, AT), null);
  assert.equal(ageFrom(null), null);
  assert.equal(ageFrom(undefined), null);
});

check('a profile is only complete when TDEE can actually be computed', () => {
  const full = { height_cm: 180, birth_year: 1990, sex: 'male', goal_kg: 80 };
  assert.equal(isComplete(full), true);
  assert.equal(isComplete({ ...full, height_cm: null }), false);
  assert.equal(isComplete({ ...full, sex: null }), false);
  assert.equal(isComplete({ ...full, goal_kg: null }), false);
  assert.equal(isComplete({ ...full, birth_year: null }), false);
  assert.equal(isComplete(null), false);
});

check('nonsense heights do not count as complete', () => {
  const base = { birth_year: 1990, sex: 'male', goal_kg: 80 };
  assert.equal(isComplete({ ...base, height_cm: 40 }), false);
  assert.equal(isComplete({ ...base, height_cm: 300 }), false);
});

check('missing fields are named specifically', () => {
  const m = missingFields({ height_cm: 180 });
  assert.ok(m.includes('year of birth'));
  assert.ok(m.includes('sex'));
  assert.ok(!m.includes('height'));
  assert.equal(missingFields({ height_cm: 180, birth_year: 1990, sex: 'male', goal_kg: 80 }).length, 0);
});

check('goal suggestion uses BMI 24.9 for the given height', () => {
  // 1.8m → 24.9 × 3.24 = 80.7 → 81
  assert.equal(suggestGoalKg(180), 81);
  assert.equal(suggestGoalKg(160), Math.round(24.9 * 1.6 * 1.6));
  assert.equal(suggestGoalKg(null), null, 'no height, no suggestion');
});

check('protein scales to GOAL weight, not current weight', () => {
  // Someone at 130kg aiming for 85kg needs protein for the body they're
  // building, not the fat they're carrying.
  assert.equal(profileProtein(85, 130), Math.round(85 * 1.8));
  assert.equal(profileProtein(null, 130), Math.round(130 * 1.8), 'falls back to current');
  assert.equal(profileProtein(null, null), 0);
});

check('unit conversions round-trip without drift', () => {
  assert.ok(Math.abs(lbToKg(kgToLb(100)) - 100) < 1e-9);
  assert.ok(Math.abs(kgToLb(100) - 220.462) < 0.01);
  const { ft, inch } = cmToFtIn(180);
  assert.equal(ft, 5);
  assert.equal(inch, 11);
  assert.ok(Math.abs(ftInToCm(5, 11) - 180.34) < 0.01);
});

check('activity level tracks training frequency', () => {
  assert.equal(suggestActivityLevel(0), 'sedentary');
  assert.equal(suggestActivityLevel(2), 'light');
  assert.equal(suggestActivityLevel(4), 'moderate');
  assert.equal(suggestActivityLevel(7), 'active');
  assert.equal(suggestActivityLevel(10), 'very_active');
});

check('no hardcoded personal constants remain in config', async () => {
  const cfg = await import('../src/lib/config.ts');
  assert.equal(cfg.GOAL_KG, 0, 'GOAL_KG must not carry one person\'s target');
  assert.equal(cfg.START_KG, 0, 'START_KG must not carry one person\'s weight');
});

console.log('\nplanTemplates — a week that isn\'t one person\'s week');

const { buildSchedule, describeSchedule, PLAN_TEMPLATES } =
  await import('../src/lib/data/planTemplates.ts');

check('every template produces a full, valid week', () => {
  for (const t of PLAN_TEMPLATES) {
    const days = buildSchedule({ templateId: t.id, sportName: 'Badminton', sportDays: [3, 5] });
    assert.equal(days.length, 7, `${t.id} must cover all 7 days`);
    assert.deepEqual(days.map((d) => d.day_of_week), [0, 1, 2, 3, 4, 5, 6]);
  }
});

check('lifting days match what the template promises', () => {
  for (const t of PLAN_TEMPLATES) {
    const days = buildSchedule({ templateId: t.id, sportName: 'Badminton', sportDays: [3, 5] });
    const lifts = days.filter((d) => d.session_key).length;
    assert.equal(lifts, t.liftDays, `${t.id} promised ${t.liftDays} gym days, produced ${lifts}`);
  }
});

check('lifting is kept off the days either side of a sport night', () => {
  // Sport on Wed(3) and Fri(5). Tue and Thu sit directly against those nights —
  // squatting heavy then means either playing fatigued or lifting on dead legs.
  const days = buildSchedule({ templateId: 'gym-sport', sportName: 'Badminton', sportDays: [3, 5] });
  const liftDows = days.filter((d) => d.session_key).map((d) => d.day_of_week);
  assert.ok(!liftDows.includes(4), 'Thursday sits between both sport nights');
  assert.ok(liftDows.includes(1), 'Monday is the furthest day from both');
});

check('sport never collides with a gym session', () => {
  const days = buildSchedule({ templateId: 'gym-sport', sportName: 'Football', sportDays: [2, 6] });
  for (const d of days) {
    if ([2, 6].includes(d.day_of_week)) {
      assert.equal(d.session_key, null, 'a sport day must not also be a gym day');
      assert.ok(d.note.includes('Football'), 'the sport is named, not assumed');
    }
  }
});

check('the user\'s own sport name and time are used, never a hardcoded club', () => {
  const days = buildSchedule({
    templateId: 'gym-sport', sportName: 'Squash', sportDays: [1], sportTime: '6–7pm'
  });
  const sportDay = days.find((d) => d.day_of_week === 1);
  assert.ok(sportDay.note.includes('Squash'));
  assert.ok(sportDay.note.includes('6–7pm'));
  const all = JSON.stringify(days);
  assert.ok(!/NTC|Badminton/i.test(all), 'no trace of the original owner\'s schedule');
});

check('gym-only templates produce no sport days', () => {
  const days = buildSchedule({ templateId: 'gym3', sportName: 'Badminton', sportDays: [3, 5] });
  assert.ok(!days.some((d) => d.label === 'Cardio & Agility'),
    'a gym-only template must ignore sport days entirely');
});

check('every week keeps at least one real rest day', () => {
  for (const t of PLAN_TEMPLATES) {
    const days = buildSchedule({ templateId: t.id, sportName: 'X', sportDays: [1, 2, 3, 4] });
    assert.ok(days.some((d) => d.label === 'Rest'), `${t.id} left no rest day`);
  }
});

check('the 4-day split alternates lower and upper', () => {
  const days = buildSchedule({ templateId: 'gym4' });
  const keys = days.filter((d) => d.session_key).map((d) => d.session_key);
  assert.equal(keys.length, 4);
  assert.deepEqual(keys, ['lower', 'upper', 'lower', 'upper']);
});

check('an unknown template id falls back rather than producing a broken week', () => {
  const days = buildSchedule({ templateId: 'nonsense' });
  assert.equal(days.length, 7);
  assert.ok(days.some((d) => d.session_key));
});

check('the summary describes what was actually built', () => {
  const days = buildSchedule({ templateId: 'gym-sport', sportName: 'Tennis', sportDays: [3, 5] });
  const s = describeSchedule(days);
  assert.ok(s.includes('Gym:'));
  assert.ok(s.includes('Sport:'));
  assert.ok(/rest day/.test(s));
});

console.log('\nwatches — any brand, not just one');

const { WATCH_BRANDS, brandForPackage, preferredSource, setupHelp, brandById, sourceLabel } =
  await import('../src/lib/health/watches.ts');

const SAMSUNG = 'com.samsung.android.shealth';
const ONEPLUS = 'com.oneplus.health.international';
const PHONE_SRC = 'com.google.android.apps.fitness';
const GARMIN = 'com.garmin.android.apps.connectmobile';

check('Samsung is recognised — the gap that broke the old regex', () => {
  const b = brandForPackage(SAMSUNG);
  assert.ok(b, 'Samsung Health must be a known source');
  assert.equal(b.id, 'samsung');
});

check('the major brands all resolve', () => {
  assert.equal(brandForPackage(ONEPLUS).id, 'oneplus');
  assert.equal(brandForPackage(GARMIN).id, 'garmin');
  assert.equal(brandForPackage('com.fitbit.FitbitMobile').id, 'fitbit');
  assert.equal(brandForPackage(PHONE_SRC).id, 'phone');
  assert.equal(brandForPackage('com.unknown.app'), null, 'unknown stays unknown, not mislabelled');
});

check('a watch always beats the phone', () => {
  assert.equal(preferredSource([PHONE_SRC, SAMSUNG]), SAMSUNG);
  assert.equal(preferredSource([PHONE_SRC, ONEPLUS]), ONEPLUS);
  assert.equal(preferredSource([SAMSUNG, PHONE_SRC]), SAMSUNG, 'order must not matter');
});

check('the declared brand wins over the heuristic', () => {
  // Two watches in the store (an old one and a new one). The user's own answer
  // decides — they know what is on their wrist.
  assert.equal(preferredSource([ONEPLUS, SAMSUNG], 'samsung'), SAMSUNG);
  assert.equal(preferredSource([ONEPLUS, SAMSUNG], 'oneplus'), ONEPLUS);
});

check('a declared brand that is absent falls back instead of returning nothing', () => {
  // They said Garmin but only Samsung data is present — still prefer the watch
  // that IS there rather than giving up and letting the phone win.
  assert.equal(preferredSource([PHONE_SRC, SAMSUNG], 'garmin'), SAMSUNG);
});

check('phone-only users get no false watch', () => {
  assert.equal(preferredSource([PHONE_SRC]), null,
    'null correctly hands over to the "most data wins" rule');
  assert.equal(preferredSource([]), null);
});

check('every brand has usable setup steps and a Health Connect mention', () => {
  for (const b of WATCH_BRANDS) {
    assert.ok(b.setup.length >= 2, `${b.id} needs real steps`);
    assert.ok(b.name && b.companionApp && b.emoji, `${b.id} missing display fields`);
    const joined = b.setup.join(' ').toLowerCase();
    if (b.id !== 'phone') {
      assert.ok(joined.includes('health connect'), `${b.id} must say where the switch is`);
    }
  }
});

check('setup help degrades gracefully for an unknown or missing brand', () => {
  const h = setupHelp(null);
  assert.ok(h.steps.length > 0, 'never leave a user with no instructions');
  assert.ok(h.title.length > 0);
  assert.equal(setupHelp('nonsense').steps.length, brandById('other').setup.length);
});

check('source labels distinguish watch from phone', () => {
  assert.ok(/watch/i.test(sourceLabel(SAMSUNG)));
  assert.ok(/phone/i.test(sourceLabel(PHONE_SRC)));
  assert.equal(sourceLabel('com.mystery.app'), 'com.mystery.app',
    'unknown packages are shown honestly, not hidden');
});

check('brand ids are unique', () => {
  const ids = WATCH_BRANDS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
});

console.log(
  failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
