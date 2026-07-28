<script lang="ts">
  // First-run setup.
  //
  // Everything asked here was previously either a hardcoded constant compiled
  // into the app or a form you had to refill on every visit. Four short steps,
  // each explaining WHY it's needed — a fitness app that demands your body
  // measurements without saying what it does with them has not earned them.
  //
  // Nothing is guessed silently: suggestions are shown as suggestions, and every
  // field can be changed later in Body & Goals.
  import { userId } from '$lib/stores/user';
  import { upsertRecord } from '$lib/stores/sync';
  import { todayYmd } from '$lib/date';
  import {
    ageFrom, suggestGoalKg, suggestActivityLevel, proteinTargetG,
    lbToKg, ftInToCm, type Sex, type Units, type ActivityLevel
  } from '$lib/profile';
  import { calcTdee, projectGoalWithTdee, ACTIVITY_LABELS } from '$lib/tdee';
  import { notify } from '$lib/stores/notices';

  let { onDone }: { onDone: () => void } = $props();

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  let step = $state(0);
  let saving = $state(false);
  let error = $state('');

  // — Step 1: who —
  let displayName = $state('');
  let sex = $state<Sex | ''>('');
  let birthYear = $state('');
  let units = $state<Units>('metric');

  // — Step 2: body —
  let heightCm = $state('');
  let heightFt = $state('');
  let heightIn = $state('');
  let weightInput = $state('');

  // — Step 3: training —
  let sessionsPerWeek = $state(3);
  let activityLevel = $state<ActivityLevel>('moderate');
  let activityTouched = $state(false);

  // — Step 4: goal —
  let goalInput = $state('');

  const currentYear = new Date().getFullYear();

  const heightInCm = $derived.by(() => {
    if (units === 'imperial') {
      const ft = parseFloat(heightFt), inch = parseFloat(heightIn) || 0;
      return ft > 0 ? Math.round(ftInToCm(ft, inch) * 10) / 10 : null;
    }
    const cm = parseFloat(heightCm);
    return cm > 0 ? cm : null;
  });

  const weightInKg = $derived.by(() => {
    const w = parseFloat(weightInput);
    if (!w || w <= 0) return null;
    return units === 'imperial' ? Math.round(lbToKg(w) * 100) / 100 : w;
  });

  const goalInKg = $derived.by(() => {
    const g = parseFloat(goalInput);
    if (!g || g <= 0) return null;
    return units === 'imperial' ? Math.round(lbToKg(g) * 100) / 100 : g;
  });

  const age = $derived(ageFrom(parseInt(birthYear, 10)));
  const suggestedGoal = $derived(suggestGoalKg(heightInCm));

  // Keep activity in step with the training question unless the user overrode it.
  $effect(() => {
    if (!activityTouched) activityLevel = suggestActivityLevel(sessionsPerWeek);
  });

  const canNext = $derived.by(() => {
    if (step === 0) return sex !== '' && age != null;
    if (step === 1) return heightInCm != null && weightInKg != null;
    if (step === 2) return true;
    return goalInKg != null;
  });

  // Live preview of what the numbers actually buy them — the reason to fill
  // this in at all.
  const preview = $derived.by(() => {
    if (!heightInCm || !weightInKg || !age || !sex || !goalInKg) return null;
    const tdee = calcTdee({
      weightKg: weightInKg, heightCm: heightInCm, age, gender: sex, activityLevel
    });
    const proj = projectGoalWithTdee(tdee, weightInKg, goalInKg);
    return { tdee, proj, protein: proteinTargetG(goalInKg, weightInKg) };
  });

  async function finish() {
    if (!uid || !canNext) return;
    saving = true;
    error = '';
    try {
      const p = preview;
      const reason = p
        ? `Cut to ${goalInKg} kg — maintenance ~${p.tdee} kcal, target intake ~${p.proj.targetIntakeKcal} kcal/day (${p.proj.dailyDeficitKcal} kcal deficit), ~${p.proj.weeksToGoal} weeks. Protein ~${p.protein} g/day to hold muscle.`
        : null;

      await upsertRecord('user_settings', {
        user_id: uid,
        display_name: displayName.trim() || null,
        sex,
        birth_year: parseInt(birthYear, 10),
        height_cm: heightInCm,
        activity_level: activityLevel,
        units,
        start_kg: weightInKg,
        goal_kg: goalInKg,
        goal_reason: reason,
        onboarded_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // Seed the first weigh-in so the trend has somewhere to start.
      if (weightInKg) {
        await upsertRecord('weights', {
          user_id: uid, date: todayYmd(), weight: weightInKg,
          created_at: new Date().toISOString()
        });
      }
      onDone();
    } catch (e: any) {
      error = e?.message || String(e);
      notify('Setup', `Could not save your profile: ${error}`);
    } finally {
      saving = false;
    }
  }
</script>

<div class="ob">
  <div class="ob-progress">
    {#each [0, 1, 2, 3] as s}
      <div class="ob-dot" class:on={s <= step}></div>
    {/each}
  </div>

  {#if step === 0}
    <h2 class="ob-h">Let's set up your plan</h2>
    <p class="ob-p">
      Four quick questions. They're what turn this from a logging app into one
      that can tell you whether you're losing fat or muscle.
    </p>

    <label class="flbl" for="ob-name">What should I call you? <span class="ob-opt">(optional)</span></label>
    <input id="ob-name" bind:value={displayName} placeholder="Your name" autocomplete="given-name">

    <label class="flbl" for="ob-sex">Sex</label>
    <div class="ob-hint">The calorie and body-fat formulas are different for men and women — this is used for the maths, nothing else.</div>
    <div class="tab-row" id="ob-sex">
      <button class="tab" class:on={sex === 'male'} onclick={() => sex = 'male'}>Male</button>
      <button class="tab" class:on={sex === 'female'} onclick={() => sex = 'female'}>Female</button>
    </div>

    <label class="flbl" for="ob-year">Year of birth</label>
    <div class="ob-hint">Metabolism falls with age, so your calorie target depends on it.</div>
    <input id="ob-year" type="number" inputmode="numeric" bind:value={birthYear}
      placeholder={String(currentYear - 30)} min="1900" max={currentYear - 13}>
    {#if birthYear && age == null}
      <div class="ob-err">That doesn't look like a valid year of birth.</div>
    {:else if age != null}
      <div class="ob-ok">You're {age}.</div>
    {/if}

    <label class="flbl" for="ob-units">Units</label>
    <div class="tab-row" id="ob-units">
      <button class="tab" class:on={units === 'metric'} onclick={() => units = 'metric'}>kg / cm</button>
      <button class="tab" class:on={units === 'imperial'} onclick={() => units = 'imperial'}>lb / ft</button>
    </div>

  {:else if step === 1}
    <h2 class="ob-h">Your body right now</h2>
    <p class="ob-p">The starting point everything is measured against. No judgement — this is just the first dot on the graph.</p>

    <label class="flbl" for="ob-height">Height</label>
    {#if units === 'imperial'}
      <div class="ob-row2">
        <input id="ob-height" type="number" inputmode="numeric" bind:value={heightFt} placeholder="ft">
        <input type="number" inputmode="numeric" bind:value={heightIn} placeholder="in">
      </div>
    {:else}
      <input id="ob-height" type="number" inputmode="decimal" bind:value={heightCm} placeholder="cm, e.g. 175">
    {/if}

    <label class="flbl" for="ob-weight">Current weight</label>
    <input id="ob-weight" type="number" inputmode="decimal" bind:value={weightInput}
      placeholder={units === 'imperial' ? 'lb' : 'kg'}>
    <div class="ob-hint">Logged as today's first weigh-in so your trend starts immediately.</div>

  {:else if step === 2}
    <h2 class="ob-h">How much do you train?</h2>
    <p class="ob-p">
      A starting estimate of how much you burn. It doesn't have to be right — the
      app learns your real maintenance from your own data within a few weeks and
      corrects itself.
    </p>

    <label class="flbl" for="ob-sessions">Sessions per week — gym, sport, anything sweaty</label>
    <input id="ob-sessions" type="range" min="0" max="10" bind:value={sessionsPerWeek}
      oninput={() => activityTouched = false}>
    <div class="ob-sessions">{sessionsPerWeek} {sessionsPerWeek === 1 ? 'session' : 'sessions'} a week</div>

    <label class="flbl" for="ob-activity">Activity level</label>
    <select id="ob-activity" bind:value={activityLevel} onchange={() => activityTouched = true}>
      {#each Object.entries(ACTIVITY_LABELS) as [key, label]}
        <option value={key}>{label}</option>
      {/each}
    </select>

  {:else}
    <h2 class="ob-h">What are you aiming for?</h2>
    <p class="ob-p">A target weight, so every calorie number has a purpose. You can change it whenever you like.</p>

    <label class="flbl" for="ob-goal">Goal weight</label>
    <input id="ob-goal" type="number" inputmode="decimal" bind:value={goalInput}
      placeholder={units === 'imperial' ? 'lb' : 'kg'}>
    {#if suggestedGoal && !goalInput}
      <button class="ob-suggest" onclick={() => goalInput = String(units === 'imperial' ? Math.round(suggestedGoal / 0.45359237) : suggestedGoal)}>
        Not sure? Use {units === 'imperial' ? `${Math.round(suggestedGoal / 0.45359237)} lb` : `${suggestedGoal} kg`} —
        the top of the healthy BMI range for your height. Tap to use it.
      </button>
      <div class="ob-hint">
        BMI ignores muscle entirely, so treat it as a starting marker rather than a
        verdict. Once you log body fat, the app targets composition instead.
      </div>
    {/if}

    {#if preview}
      <div class="ob-preview">
        <div class="ob-preview-h">Your plan</div>
        <div class="ob-pv"><span>Maintenance</span><strong>~{preview.tdee} kcal/day</strong></div>
        <div class="ob-pv"><span>Daily target</span><strong>{preview.proj.targetIntakeKcal} kcal</strong></div>
        <div class="ob-pv"><span>Protein</span><strong>{preview.protein} g/day</strong></div>
        {#if preview.proj.weeksToGoal > 0}
          <div class="ob-pv"><span>Estimated time</span><strong>~{preview.proj.weeksToGoal} weeks</strong></div>
        {/if}
        <div class="ob-preview-f">
          These start as formula estimates. The app replaces them with what your
          own results actually show.
        </div>
      </div>
    {/if}
  {/if}

  {#if error}<div class="ob-err">{error}</div>{/if}

  <div class="ob-nav">
    {#if step > 0}
      <button class="btn bg_ bfl" onclick={() => step--}>Back</button>
    {/if}
    {#if step < 3}
      <button class="btn bp bfl" disabled={!canNext} onclick={() => step++}>Continue</button>
    {:else}
      <button class="btn bp bfl" disabled={!canNext || saving} onclick={finish}>
        {saving ? 'Saving…' : 'Start'}
      </button>
    {/if}
  </div>
</div>

<style>
  .ob{padding:24px 20px 40px;max-width:460px;margin:0 auto}
  .ob-progress{display:flex;gap:6px;margin-bottom:24px}
  .ob-dot{flex:1;height:3px;border-radius:2px;background:var(--bg3);transition:background .3s var(--ease)}
  .ob-dot.on{background:var(--amber)}
  .ob-h{font-size:22px;font-weight:800;color:#fff;margin:0 0 8px;line-height:1.25}
  .ob-p{font-size:13px;color:var(--muted);line-height:1.55;margin:0 0 20px}
  .ob-hint{font-size:11px;color:var(--muted);line-height:1.45;margin:-2px 0 6px}
  .ob-opt{color:var(--muted);font-weight:400}
  .ob-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .ob-err{font-size:12px;color:var(--red);margin-top:6px;line-height:1.4}
  .ob-ok{font-size:12px;color:var(--green,#2ecc71);margin-top:6px}
  .ob-sessions{font-size:13px;font-weight:700;color:var(--amber);text-align:center;margin:4px 0 12px}
  .ob-suggest{display:block;width:100%;text-align:left;margin-top:8px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px;color:var(--amber);font-size:12px;line-height:1.45;cursor:pointer;font-family:inherit}
  .ob-preview{margin-top:18px;background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:14px}
  .ob-preview-h{font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.4px;margin-bottom:8px}
  .ob-pv{display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px;color:var(--muted)}
  .ob-pv strong{color:var(--amber);font-size:14px}
  .ob-preview-f{font-size:10.5px;color:var(--muted);line-height:1.45;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
  .ob-nav{display:flex;gap:8px;margin-top:24px}
</style>
