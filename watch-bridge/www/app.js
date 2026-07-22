/* RecompOS Watch Sync — Capacitor bridge
 *
 * Reads Health Connect (steps, sleep, heart rate, HRV) on the phone and
 * upserts it into the SAME Supabase project the RecompOS PWA uses, into the
 * EXISTING `steps` and `biometrics` tables — so the web app's "Daily
 * Readiness" card and step stats light up automatically, no PWA changes.
 *
 * Auth is the user's own RecompOS email/password, so Supabase RLS
 * (auth.uid() = user_id) keeps everything scoped to their account.
 */

// Same public values the PWA ships (anon/publishable key — safe in client).
const SUPABASE_URL = 'https://jerbhsasccvjelkkphgu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_H8G1aDyFJFLmgxrTc8qKeA_kxyXRLyk';

const READ_TYPES = ['Steps', 'SleepSession', 'HeartRateSeries', 'RestingHeartRate', 'HeartRateVariabilityRmssd'];
// Health Connect sleep-stage codes that count as actually asleep
// (2 SLEEPING, 4 LIGHT, 5 DEEP, 6 REM). 1 AWAKE / 3 OUT_OF_BED / 7 AWAKE_IN_BED excluded.
const ASLEEP_STAGES = new Set([2, 4, 5, 6]);

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
const HC = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.HealthConnect;
const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// —— tiny DOM helpers ——
const $ = (id) => document.getElementById(id);
function log(msg, kind) {
  const el = $('log');
  const t = new Date().toLocaleTimeString();
  const prefix = kind === 'err' ? '✗ ' : kind === 'ok' ? '✓ ' : '· ';
  el.textContent = `[${t}] ${prefix}${msg}\n` + el.textContent;
}
function setDot(id, cls) { const d = $(id); d.className = 'dot' + (cls ? ' ' + cls : ''); }

// —— date helpers (LOCAL calendar day) ——
function ymd(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function startOfDaysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// —— Health Connect ——
async function refreshHcStatus() {
  if (!HC) {
    $('hc-status').textContent = 'Health Connect: install the app on your phone';
    setDot('hc-dot', 'warn');
    return 'NotNative';
  }
  try {
    const { availability } = await HC.checkAvailability();
    if (availability === 'Available') { $('hc-status').textContent = 'Health Connect: available'; setDot('hc-dot', 'ok'); }
    else if (availability === 'NotInstalled') { $('hc-status').textContent = 'Health Connect: not installed (tap Grant)'; setDot('hc-dot', 'warn'); }
    else { $('hc-status').textContent = 'Health Connect: not supported (Android 9+ needed)'; setDot('hc-dot', 'err'); }
    return availability;
  } catch (e) {
    $('hc-status').textContent = 'Health Connect: error';
    setDot('hc-dot', 'err');
    log('checkAvailability failed: ' + (e.message || e), 'err');
    return 'Error';
  }
}

async function ensurePermissions() {
  if (!HC) { log('Not running inside the installed app — Health Connect unavailable.', 'err'); return false; }
  const avail = await refreshHcStatus();
  if (avail === 'NotSupported') { log('This device does not support Health Connect.', 'err'); return false; }
  try {
    const check = await HC.checkHealthPermissions({ read: READ_TYPES, write: [] });
    if (check.hasAllPermissions) { log('Health Connect permissions already granted.', 'ok'); return true; }
    log('Requesting Health Connect permissions…');
    const res = await HC.requestHealthPermissions({ read: READ_TYPES, write: [] });
    if (res.hasAllPermissions) { log('All permissions granted.', 'ok'); return true; }
    log('Some permissions were not granted. Granted: ' + (res.grantedPermissions || []).length, 'err');
    return (res.grantedPermissions || []).length > 0; // partial is still usable
  } catch (e) {
    log('Permission request failed: ' + (e.message || e), 'err');
    return false;
  }
}

async function readAll(type, startISO, endISO) {
  try {
    const { records } = await HC.readRecords({
      type,
      timeRangeFilter: { type: 'between', startTime: startISO, endTime: endISO },
    });
    return records || [];
  } catch (e) {
    log(`readRecords(${type}) failed: ${e.message || e}`, 'err');
    return [];
  }
}

// —— aggregation ——
function aggregate(steps, sleeps, hrSeries, restingHr, hrv) {
  const stepsByDay = {};        // date -> total count
  const sleepMinByDay = {};     // date -> asleep minutes
  const rhrByDay = {};          // date -> [bpm]
  const hrvByDay = {};          // date -> [ms]
  const hrMinByDay = {};        // date -> min bpm (resting fallback)

  for (const r of steps) {
    const day = ymd(r.startTime);
    stepsByDay[day] = (stepsByDay[day] || 0) + (Number(r.count) || 0);
  }

  for (const s of sleeps) {
    // Attribute a night's sleep to the WAKE day (endTime) so it shows as
    // "today's" readiness after you wake up.
    const day = ymd(s.endTime);
    let mins = 0;
    if (Array.isArray(s.stages) && s.stages.length) {
      for (const st of s.stages) {
        if (ASLEEP_STAGES.has(Number(st.stage))) {
          mins += (new Date(st.endTime) - new Date(st.startTime)) / 60000;
        }
      }
    }
    if (mins === 0) { // no stage detail — fall back to total session duration
      mins = (new Date(s.endTime) - new Date(s.startTime)) / 60000;
    }
    sleepMinByDay[day] = (sleepMinByDay[day] || 0) + mins;
  }

  for (const r of restingHr) {
    const day = ymd(r.time);
    (rhrByDay[day] = rhrByDay[day] || []).push(Number(r.beatsPerMinute));
  }

  for (const r of hrv) {
    const day = ymd(r.time);
    (hrvByDay[day] = hrvByDay[day] || []).push(Number(r.heartRateVariabilityMillis));
  }

  for (const series of hrSeries) {
    for (const sample of (series.samples || [])) {
      const day = ymd(sample.time);
      const bpm = Number(sample.beatsPerMinute);
      if (!bpm) continue;
      hrMinByDay[day] = hrMinByDay[day] === undefined ? bpm : Math.min(hrMinByDay[day], bpm);
    }
  }

  const avg = (arr) => arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const days = new Set([
    ...Object.keys(stepsByDay), ...Object.keys(sleepMinByDay),
    ...Object.keys(rhrByDay), ...Object.keys(hrvByDay), ...Object.keys(hrMinByDay),
  ]);

  const byDay = {};
  for (const day of days) {
    const restingHrVal = rhrByDay[day] ? Math.round(avg(rhrByDay[day]))
      : (hrMinByDay[day] !== undefined ? Math.round(hrMinByDay[day]) : null); // fallback: min HR of the day
    byDay[day] = {
      steps: stepsByDay[day] != null ? Math.round(stepsByDay[day]) : null,
      sleep_hours: sleepMinByDay[day] != null ? Math.round((sleepMinByDay[day] / 60) * 10) / 10 : null,
      resting_hr: restingHrVal,
      hrv: hrvByDay[day] ? Math.round(avg(hrvByDay[day]) * 10) / 10 : null,
    };
  }
  return byDay;
}

// —— Supabase writes ——
async function pushToSupabase(uid, byDay) {
  const dates = Object.keys(byDay).sort();
  if (!dates.length) { log('No data found in the selected window.', 'warn'); return { days: 0, steps: 0, sleep: 0, hr: 0 }; }

  // Steps -> `steps` table (unique user_id,date)
  const stepRows = dates.filter((d) => byDay[d].steps != null)
    .map((d) => ({ user_id: uid, date: d, count: byDay[d].steps }));
  if (stepRows.length) {
    const { error } = await sb.from('steps').upsert(stepRows, { onConflict: 'user_id,date' });
    if (error) log('steps upsert error: ' + error.message, 'err'); else log(`Synced ${stepRows.length} step-day(s).`, 'ok');
  }

  // Biometrics -> merge with existing so we never wipe a manually-set sleep_quality
  const bioDates = dates.filter((d) => byDay[d].sleep_hours != null || byDay[d].resting_hr != null || byDay[d].hrv != null);
  let sleepN = 0, hrN = 0;
  if (bioDates.length) {
    const { data: existing } = await sb.from('biometrics').select('*')
      .eq('user_id', uid).gte('date', bioDates[0]).lte('date', bioDates[bioDates.length - 1]);
    const exMap = {};
    for (const row of (existing || [])) exMap[row.date] = row;

    const bioRows = bioDates.map((d) => {
      const cur = byDay[d];
      const prev = exMap[d] || {};
      if (cur.sleep_hours != null) sleepN++;
      if (cur.resting_hr != null || cur.hrv != null) hrN++;
      return {
        user_id: uid, date: d,
        sleep_hours: cur.sleep_hours != null ? cur.sleep_hours : (prev.sleep_hours ?? null),
        sleep_quality: prev.sleep_quality ?? null,
        resting_hr: cur.resting_hr != null ? cur.resting_hr : (prev.resting_hr ?? null),
        hrv: cur.hrv != null ? cur.hrv : (prev.hrv ?? null),
        updated_at: new Date().toISOString(),
      };
    });
    const { error } = await sb.from('biometrics').upsert(bioRows, { onConflict: 'user_id,date' });
    if (error) log('biometrics upsert error: ' + error.message, 'err'); else log(`Synced ${bioRows.length} biometric day(s).`, 'ok');
  }

  return { days: dates.length, steps: stepRows.length, sleep: sleepN, hr: hrN };
}

// —— main sync ——
let syncing = false;
async function sync() {
  if (syncing) return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { log('Please sign in first.', 'err'); return; }
  if (!HC) { log('Health Connect is only available in the installed Android app.', 'err'); return; }

  syncing = true;
  $('sync-btn').disabled = true;
  $('sync-btn').textContent = 'Syncing…';
  try {
    const okPerms = await ensurePermissions();
    if (!okPerms) { log('Cannot sync without Health Connect permissions.', 'err'); return; }

    const nDays = parseInt($('days').value, 10) || 7;
    const start = startOfDaysAgo(nDays);
    const end = new Date();
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    log(`Reading Health Connect for the last ${nDays} days…`);

    const [steps, sleeps, hrSeries, restingHr, hrv] = await Promise.all([
      readAll('Steps', startISO, endISO),
      readAll('SleepSession', startISO, endISO),
      readAll('HeartRateSeries', startISO, endISO),
      readAll('RestingHeartRate', startISO, endISO),
      readAll('HeartRateVariabilityRmssd', startISO, endISO),
    ]);
    log(`Read: ${steps.length} step rec, ${sleeps.length} sleep, ${hrSeries.length} HR series, ${restingHr.length} RHR, ${hrv.length} HRV.`);

    const byDay = aggregate(steps, sleeps, hrSeries, restingHr, hrv);
    const uid = session.user.id;
    const res = await pushToSupabase(uid, byDay);

    $('s-days').textContent = res.days;
    $('s-steps').textContent = res.steps;
    $('s-sleep').textContent = res.sleep;
    $('s-hr').textContent = res.hr;
    localStorage.setItem('lastSync', new Date().toISOString());
    log('Sync complete. Open RecompOS to see your readiness & steps update.', 'ok');
  } catch (e) {
    log('Sync failed: ' + (e.message || e), 'err');
  } finally {
    syncing = false;
    $('sync-btn').disabled = false;
    $('sync-btn').textContent = 'Sync now';
  }
}

// —— auth UI ——
function showSignedIn(email) {
  $('auth-status').textContent = email || 'Signed in';
  setDot('auth-dot', 'ok');
  $('login-card').classList.add('hidden');
  $('sync-card').classList.remove('hidden');
}
function showSignedOut() {
  $('auth-status').textContent = 'Signed out';
  setDot('auth-dot', '');
  $('login-card').classList.remove('hidden');
  $('sync-card').classList.add('hidden');
}

async function login() {
  const email = $('email').value.trim();
  const pass = $('pass').value;
  if (!email || !pass) { $('login-msg').textContent = 'Enter email and password.'; return; }
  $('login-btn').disabled = true; $('login-btn').textContent = 'Signing in…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  $('login-btn').disabled = false; $('login-btn').textContent = 'Sign in';
  if (error) { $('login-msg').textContent = error.message; log('Sign-in failed: ' + error.message, 'err'); return; }
  $('login-msg').textContent = '';
  log('Signed in as ' + data.user.email, 'ok');
  showSignedIn(data.user.email);
  sync(); // auto-sync right after login
}

// —— wire up ——
$('login-btn').addEventListener('click', login);
$('pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('sync-btn').addEventListener('click', sync);
$('perm-btn').addEventListener('click', ensurePermissions);
$('signout-btn').addEventListener('click', async () => { await sb.auth.signOut(); showSignedOut(); log('Signed out.'); });

(async function init() {
  log(isNative ? 'Running in the installed app.' : 'Running in a browser (Health Connect needs the installed app).');
  await refreshHcStatus();
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    showSignedIn(session.user.email);
    const last = localStorage.getItem('lastSync');
    if (last) log('Last sync: ' + new Date(last).toLocaleString());
    sync(); // auto-sync on launch when already signed in
  } else {
    showSignedOut();
  }
})();
