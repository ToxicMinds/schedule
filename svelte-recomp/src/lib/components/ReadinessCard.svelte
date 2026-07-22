<script lang="ts">
  // Daily readiness score card (Oura/WHOOP-style, no wearable needed).
  // Manual inputs: sleep hours, sleep quality (1-5), resting HR, HRV
  // (optional -- most people won't have this without a wearable, but
  // some fitness watches/apps expose it and the formula uses it if
  // present). See $lib/readiness.ts for the scoring formula + citations.
  import { userId } from '$lib/stores/user';
  import { upsertRecord } from '$lib/stores/sync';
  import { liveBiometrics } from '$lib/stores/live';
  import { computeReadiness } from '$lib/readiness';
  import { healthConnect, syncHealthConnect } from '$lib/health/healthConnect';

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  const hc = healthConnect;
  function agoLabel(iso: string | null): string {
    if (!iso) return '';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }
  // Manual tap = an explicit "sync everything now" — force:true re-requests any
  // permissions not yet granted (e.g. Exercise after you first only allowed
  // steps/sleep) so a freshly-played badminton session can actually come in.
  // The silent auto-sync on launch stays force:false so it never nags.
  async function resync() { if (uid) await syncHealthConnect(uid, { force: true }); }

  const today = new Date().toISOString().slice(0, 10);
  const _bio = liveBiometrics();

  const todayEntry = $derived($_bio.find((b: any) => b.date === today));
  const recentHistory = $derived($_bio.filter((b: any) => b.date < today).slice(-14));
  const readiness = $derived(computeReadiness(todayEntry, recentHistory));

  let editing = $state(false);
  let sleepHours = $state('');
  let sleepQuality = $state('3');
  let restingHr = $state('');
  let hrv = $state('');
  let saveMsg = $state('');

  function startEdit() {
    sleepHours = todayEntry?.sleep_hours != null ? String(todayEntry.sleep_hours) : '';
    sleepQuality = todayEntry?.sleep_quality != null ? String(todayEntry.sleep_quality) : '3';
    restingHr = todayEntry?.resting_hr != null ? String(todayEntry.resting_hr) : '';
    hrv = todayEntry?.hrv != null ? String(todayEntry.hrv) : '';
    editing = true;
  }

  async function save() {
    if (!uid) return;
    try {
      await upsertRecord('biometrics', {
        user_id: uid, date: today,
        sleep_hours: sleepHours ? parseFloat(sleepHours) : null,
        sleep_quality: sleepQuality ? parseInt(sleepQuality, 10) : null,
        resting_hr: restingHr ? parseInt(restingHr, 10) : null,
        hrv: hrv ? parseFloat(hrv) : null,
        updated_at: new Date().toISOString(),
      });
      editing = false;
      saveMsg = 'Saved ✓';
      setTimeout(() => saveMsg = '', 2000);
    } catch (e: any) {
      saveMsg = 'Save failed: ' + (e?.message || String(e));
    }
  }
</script>

<div class="card">
  <div class="flex jb ac" style="margin-bottom:4px">
    <div class="card-lbl" style="margin-bottom:0">Daily Readiness</div>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <span class="edit-link" onclick={startEdit} role="button">{todayEntry ? 'Edit ✎' : 'Log today ✎'}</span>
  </div>

  {#if editing}
    <label class="flbl" for="ready-sleep">Sleep (hours)</label>
    <input id="ready-sleep" type="number" inputmode="decimal" step="0.5" bind:value={sleepHours} placeholder="e.g. 7.5" style="margin-bottom:10px">
    <label class="flbl" for="ready-quality">Sleep quality (1-5)</label>
    <input id="ready-quality" type="range" min="1" max="5" bind:value={sleepQuality} style="margin-bottom:10px">
    <label class="flbl" for="ready-rhr">Resting heart rate (optional)</label>
    <input id="ready-rhr" type="number" inputmode="numeric" bind:value={restingHr} placeholder="e.g. 58" style="margin-bottom:10px">
    <label class="flbl" for="ready-hrv">HRV in ms (optional, if you track it)</label>
    <input id="ready-hrv" type="number" inputmode="decimal" bind:value={hrv} placeholder="e.g. 65" style="margin-bottom:10px">
    <div class="flex gap2">
      <button class="btn bg_ bfl" onclick={() => editing = false}>Cancel</button>
      <button class="btn bp bfl" onclick={save}>Save</button>
    </div>
  {:else if readiness}
    <div class="ready-row">
      <div class="ready-ring" style="--pct:{readiness.score}" class:great={readiness.label==='Great'} class:good={readiness.label==='Good'} class:fair={readiness.label==='Fair'} class:low={readiness.label==='Low'}>
        <span>{readiness.score}</span>
      </div>
      <div class="f1">
        <div class="ready-label">{readiness.label}</div>
        {#each readiness.factors as f}<div class="ready-factor">{f}</div>{/each}
      </div>
    </div>
  {:else}
    <div style="font-size:12px;color:var(--muted);text-align:center;padding:8px 0">Log sleep/HR to see your readiness score.</div>
  {/if}
  {#if saveMsg}
    <div style="font-size:12px;text-align:center;margin-top:6px;color:{saveMsg.startsWith('Save failed') ? 'var(--red)' : 'var(--green)'}">{saveMsg}</div>
  {/if}

  {#if $hc.native || $hc.lastSync}
    <div class="watch-src">
      <span class="f1">
        ⌚ From your OnePlus watch{#if $hc.lastSync} · synced {agoLabel($hc.lastSync)}{/if}
        <br><span class="watch-detail">Steps &amp; sleep → today's coaching · sleep + heart rate → this readiness score · workouts → activity feed{#if $hc.lastResult} · {$hc.lastResult.sleep}d sleep · {$hc.lastResult.hr}d HR{#if $hc.lastResult.workouts} · {$hc.lastResult.workouts} workout{$hc.lastResult.workouts === 1 ? '' : 's'}{/if}{/if}</span>
        {#if $hc.lastError}<br><span class="watch-detail" style="color:var(--red)">{$hc.lastError}</span>{/if}
      </span>
      <button class="watch-sync" onclick={resync} disabled={$hc.syncing}>{$hc.syncing ? 'Syncing…' : 'Sync'}</button>
    </div>
  {:else}
    <div class="watch-src">
      <span class="f1">
        ⌚ Watch &amp; health data
        <br><span class="watch-detail">Steps &amp; sleep → today's coaching · sleep + heart rate → this readiness score. Auto-sync from your OnePlus watch runs in the installed app; on the web, log sleep &amp; HR above and steps on Today.</span>
      </span>
    </div>
  {/if}
</div>

<style>
  .edit-link{font-size:12px;font-weight:700;color:var(--amber);cursor:pointer}
  .ready-row{display:flex;align-items:center;gap:14px}
  .ready-ring{width:64px;height:64px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff;background:conic-gradient(var(--ring-color,#888) calc(var(--pct) * 1%), var(--bg3) 0)}
  .ready-ring span{background:var(--bg2);width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center}
  .ready-ring.great{--ring-color:#2ecc71}
  .ready-ring.good{--ring-color:#60a5fa}
  .ready-ring.fair{--ring-color:#ffd166}
  .ready-ring.low{--ring-color:#ff6b6b}
  .ready-label{font-size:15px;font-weight:800;color:#fff;margin-bottom:2px}
  .ready-factor{font-size:11px;color:var(--muted)}
  .watch-src{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;color:var(--muted)}
  .watch-detail{font-size:10.5px;color:var(--muted);opacity:.85}
  .watch-sync{flex-shrink:0;background:var(--bg3);border:1px solid var(--border);color:var(--amber);font-size:11px;font-weight:700;border-radius:8px;padding:5px 12px;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent}
  .watch-sync:active{transform:scale(.96)}
  .watch-sync:disabled{opacity:.5}
</style>
