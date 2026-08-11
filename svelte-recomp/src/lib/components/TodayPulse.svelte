<script lang="ts">
  // ── PULSE ─────────────────────────────────────────────────────────────────
  // The face of RecompOS. Not a card in a stack — the single living element the
  // whole app is built around. One orb answers the only question that matters in
  // a body recomposition: "am I losing fat while keeping muscle, and what do I do
  // today?"  Its FILL is the recomp score, its COLOUR is today's verdict, it
  // BREATHES at your recovery cadence (calm when you're well-recovered, quicker
  // when you're run-down), and it speaks ONE narrated sentence. A watch face for
  // your physique. Everything else on the page is a footnote to this.
  //
  // The verdict itself is computed ONCE in $lib/stores/verdict and shared, so
  // this orb and the app-wide background aura can never disagree.
  import { type RecompBand } from '$lib/recompScore';
  import { todayVerdict } from '$lib/stores/verdict';
  import { dayOne } from '$lib/stores/dayOne';
  import { goalDateLabel } from '$lib/dayOne';
  import { base } from '$app/paths';
  import PulseOrb from './PulseOrb.svelte';

  let { greeting = 'Today', sub = '', streak = 0, atRisk = false,
        kgLost = '--', kgNow = '--', weeks = '--' } = $props<{
    greeting?: string; sub?: string; streak?: number; atRisk?: boolean;
    kgLost?: string | number; kgNow?: string | number; weeks?: string | number;
  }>();

  const result = $derived($todayVerdict.result);
  const tone = $derived($todayVerdict.tone);
  const breath = $derived($todayVerdict.breath);
  const insufficient = $derived(result.band === 'insufficient');
  const pct = $derived(insufficient ? 0 : result.score);

  // Show the day-one plan only while there is no real verdict to show. The
  // moment recompScore can answer honestly, the orb goes back to the score —
  // this never competes with a real reading.
  const plan = $derived($dayOne);
  const showPlan = $derived(insufficient && plan != null);
  const planPct = $derived(plan ? (plan.stepsDone / plan.steps.length) * 100 : 0);

  function bandLabel(b: RecompBand): string {
    return b === 'dialed-in' ? 'Dialed in'
      : b === 'on-track' ? 'On track'
      : b === 'mixed' ? 'Mixed signals'
      : b === 'off-track' ? 'Off track'
      : 'Warming up';
  }
</script>

<section class="pulse-hero glass tone-{tone}">

  <header class="ph-top">
    <div>
      <div class="ph-hi">{greeting}</div>
      <div class="ph-sub">{sub}</div>
    </div>
    {#if streak > 0}
      <div class="ph-streak" class:risk={atRisk}>🔥 {streak}{#if atRisk} · log!{/if}</div>
    {/if}
  </header>

  <div class="ph-orb-wrap">
    <PulseOrb
      pct={showPlan ? planPct : pct}
      value={showPlan ? `${plan!.stepsDone}/${plan!.steps.length}` : insufficient ? '—' : result.score}
      label={showPlan ? 'First week' : bandLabel(result.band)}
      breath={breath} />
  </div>

  <p class="ph-story">{showPlan ? plan!.headline : result.headline}</p>

  {#if showPlan}
    <!-- Day one. The verdict is genuinely unknowable, but the PLAN is not: these
         numbers come straight from the height/age/sex/activity/goal onboarding
         already collected, so a brand-new account gets a real, personal answer
         instead of a blank orb. -->
    <div class="ph-stats">
      <div><b>{plan!.targetKcal}</b><span>kcal/day</span></div>
      <div><b>{plan!.proteinG}g</b><span>protein</span></div>
      <div><b>{goalDateLabel(plan!.goalDate)}</b><span>goal {plan!.goalKg}kg</span></div>
    </div>

    <ol class="ph-steps">
      {#each plan!.steps as s}
        <li class:done={s.done}>
          <a href={base + s.href}>
            <span class="ph-step-tick" aria-hidden="true">{s.done ? '✓' : ''}</span>
            <span class="ph-step-txt">
              <b>{s.label}</b>
              <em>{s.hint}</em>
            </span>
          </a>
        </li>
      {/each}
    </ol>
  {:else}
    <div class="ph-stats">
      <div><b>{kgLost}</b><span>kg lost</span></div>
      <div><b>{kgNow}</b><span>kg now</span></div>
      <div><b>{weeks}</b><span>wks to goal</span></div>
    </div>
  {/if}
</section>

<style>
  .pulse-hero{
    position:relative;border-radius:26px;padding:20px 20px 18px;margin-bottom:14px;
    overflow:hidden;
  }
  /* a soft coloured aura bleeding from behind the orb, tinted by the verdict */
  .pulse-hero::after{
    content:'';position:absolute;top:-30%;left:50%;transform:translateX(-50%);
    width:120%;height:130%;pointer-events:none;z-index:0;
    background:radial-gradient(closest-side, color-mix(in srgb,var(--band) 34%,transparent), transparent 72%);
    filter:blur(6px);
  }
  .ph-top,.ph-orb-wrap,.ph-story,.ph-stats{position:relative;z-index:1}

  .ph-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px}
  .ph-hi{font-size:1.5rem;font-weight:900;letter-spacing:-.6px;line-height:1.05;
    background:linear-gradient(120deg,var(--text),var(--band2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .ph-sub{font-size:0.72rem;color:var(--muted);margin-top:2px}
  .ph-streak{flex-shrink:0;font-size:0.72rem;font-weight:800;color:var(--amber);
    background:var(--ab);border:1px solid color-mix(in srgb,var(--amber) 40%,transparent);
    padding:5px 10px;border-radius:999px}
  .ph-streak.risk{color:var(--red);background:var(--rb);border-color:color-mix(in srgb,var(--red) 40%,transparent)}

  .ph-orb-wrap{display:flex;justify-content:center;padding:6px 0 2px}

  .ph-story{text-align:center;font-size:0.94rem;font-weight:650;line-height:1.42;
    color:var(--text);margin:12px 6px 4px;text-wrap:balance}

  .ph-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
  .ph-stats>div{display:flex;flex-direction:column;align-items:center;gap:1px;
    background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:14px;padding:9px 4px}
  .ph-stats b{font-size:1.1rem;font-weight:900;letter-spacing:-.4px;color:var(--text)}
  .ph-stats span{font-size:0.6875rem;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--muted)}

  /* Day-one checklist. Four taps, each one a real first action — this is what
     occupies the space the empty orb used to leave blank. */
  .ph-steps{position:relative;z-index:1;list-style:none;margin:14px 0 0;padding:0;
    display:flex;flex-direction:column;gap:6px}
  .ph-steps a{display:flex;align-items:flex-start;gap:10px;text-decoration:none;
    background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:14px;
    padding:10px 12px;transition:transform .18s var(--ease),border-color .18s var(--ease)}
  .ph-steps a:active{transform:scale(.985)}
  .ph-step-tick{flex-shrink:0;width:20px;height:20px;border-radius:50%;margin-top:1px;
    border:1.5px solid var(--glass-brd);display:flex;align-items:center;justify-content:center;
    font-size:0.6875rem;font-weight:900;color:var(--bg)}
  .ph-steps li.done .ph-step-tick{background:var(--green);border-color:var(--green)}
  .ph-steps li.done a{border-color:color-mix(in srgb,var(--green) 34%,transparent)}
  .ph-steps li.done .ph-step-txt b{text-decoration:line-through;color:var(--muted)}
  .ph-step-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
  .ph-step-txt b{font-size:0.8125rem;font-weight:800;color:var(--text)}
  .ph-step-txt em{font-style:normal;font-size:0.6875rem;line-height:1.4;color:var(--muted)}
</style>
