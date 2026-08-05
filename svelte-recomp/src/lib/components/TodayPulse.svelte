<script lang="ts">
  // ── PULSE ─────────────────────────────────────────────────────────────────
  // The face of RecompOS. Not a card in a stack — the single living element the
  // whole app is built around. One orb answers the only question that matters in
  // a body recomposition: "am I losing fat while keeping muscle, and what do I do
  // today?"  Its FILL is the recomp score, its COLOUR is today's verdict, it
  // BREATHES at your recovery cadence (calm when you're well-recovered, quicker
  // when you're run-down), and it speaks ONE narrated sentence. A watch face for
  // your physique. Everything else on the page is a footnote to this.
  import { liveWeights, liveGoal, liveWorkoutLogs, liveFoodLogs, liveBiometrics } from '$lib/stores/live';
  import { weightTrend } from '$lib/coach';
  import { strengthTrend } from '$lib/strength';
  import { computeReadiness } from '$lib/readiness';
  import { recompScore, type RecompBand } from '$lib/recompScore';
  import { todayYmd, shiftYmd } from '$lib/date';
  import { nowTick } from '$lib/stores/refresh';

  let { greeting = 'Today', sub = '', streak = 0, atRisk = false,
        kgLost = '--', kgNow = '--', weeks = '--' } = $props<{
    greeting?: string; sub?: string; streak?: number; atRisk?: boolean;
    kgLost?: string | number; kgNow?: string | number; weeks?: string | number;
  }>();

  const _weights = liveWeights();
  const _goal = liveGoal();
  const _workoutLogs = liveWorkoutLogs();
  const _foodLogs = liveFoodLogs();
  const _bio = liveBiometrics();

  const today = $derived.by(() => { void $nowTick; return todayYmd(); });
  const goalKg = $derived($_goal ?? null);
  const currentWeight = $derived(($_weights as any[]).length ? ($_weights as any[])[($_weights as any[]).length - 1].weight : null);
  const proteinTargetG = $derived(goalKg ? Math.round(goalKg * 1.8) : 0);
  const trend = $derived(weightTrend(($_weights as any[]).map((w) => ({ date: w.date, weight: w.weight })), goalKg ?? 0));
  const strength = $derived(strengthTrend($_workoutLogs as any));

  const proteinAdherencePct = $derived.by(() => {
    if (!proteinTargetG) return null;
    const cutoff = shiftYmd(-7, new Date($nowTick));
    const byDate = new Map<string, number>();
    for (const f of $_foodLogs as any[]) {
      if (f.date < cutoff) continue;
      byDate.set(f.date, (byDate.get(f.date) ?? 0) + (f.protein_g || 0));
    }
    if (byDate.size === 0) return null;
    let sum = 0;
    for (const g of byDate.values()) sum += Math.min(100, (g / proteinTargetG) * 100);
    return sum / byDate.size;
  });

  const readinessScore = $derived.by(() => {
    void $nowTick;
    const todayBio = ($_bio as any[]).find((b) => b.date === today);
    const history = ($_bio as any[]).filter((b) => b.date < today).slice(-14);
    return computeReadiness(todayBio, history)?.score ?? null;
  });

  const result = $derived(recompScore({
    weeklyLossRateKg: trend.rateKgPerWeek,
    currentWeightKg: currentWeight,
    goalKg,
    strength: { direction: strength.direction, avgPct: strength.avgPct },
    proteinAdherencePct,
    readinessScore,
  }));

  const insufficient = $derived(result.band === 'insufficient');
  const pct = $derived(insufficient ? 0 : result.score);

  // Breathing cadence: well-recovered → slow, calm breaths; run-down → quicker.
  // Maps readiness 0..100 to ~3.4s..6.8s. No biometrics yet → a neutral 5s.
  const breath = $derived(readinessScore == null ? 5 : (3.4 + (readinessScore / 100) * 3.4).toFixed(2));

  function bandLabel(b: RecompBand): string {
    return b === 'dialed-in' ? 'Dialed in'
      : b === 'on-track' ? 'On track'
      : b === 'mixed' ? 'Mixed signals'
      : b === 'off-track' ? 'Off track'
      : 'Warming up';
  }
</script>

<section class="pulse-hero glass" style="--pct:{pct}; --breath:{breath}s"
  class:dialed={result.band==='dialed-in'} class:ontrack={result.band==='on-track'}
  class:mixed={result.band==='mixed'} class:off={result.band==='off-track'} class:na={insufficient}>

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
    <div class="ph-orb">
      <div class="ph-orb-core">
        <span class="ph-score">{insufficient ? '—' : result.score}</span>
        <span class="ph-band">{bandLabel(result.band)}</span>
      </div>
    </div>
  </div>

  <p class="ph-story">{result.headline}</p>

  <div class="ph-stats">
    <div><b>{kgLost}</b><span>kg lost</span></div>
    <div><b>{kgNow}</b><span>kg now</span></div>
    <div><b>{weeks}</b><span>wks to goal</span></div>
  </div>
</section>

<style>
  .pulse-hero{
    position:relative;border-radius:26px;padding:20px 20px 18px;margin-bottom:14px;
    overflow:hidden;
    /* the verdict colour, defaulted to a warm neutral, overridden per band */
    --band:#8b98ba; --band2:#c8d1e8;
  }
  .pulse-hero.dialed{--band:#34d399;--band2:#6ee7b7}
  .pulse-hero.ontrack{--band:#60a5fa;--band2:#93c5fd}
  .pulse-hero.mixed{--band:#fbbf24;--band2:#fcd34d}
  .pulse-hero.off{--band:#fb7185;--band2:#fda4af}
  .pulse-hero.na{--band:#8b98ba;--band2:#b8c2dc}
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
  .ph-orb{
    width:172px;height:172px;border-radius:50%;display:grid;place-items:center;
    /* progress ring painted from the verdict colour up to --pct, rest faint */
    background:
      conic-gradient(var(--band) calc(var(--pct)*1%), color-mix(in srgb,var(--band) 12%,transparent) 0);
    box-shadow:0 0 44px color-mix(in srgb,var(--band) 45%,transparent),
      inset 0 0 26px color-mix(in srgb,var(--band) 22%,transparent);
    animation:pulse-breathe var(--breath,5s) var(--ease) infinite alternate;
  }
  .ph-orb-core{
    width:138px;height:138px;border-radius:50%;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:2px;
    background:radial-gradient(circle at 50% 38%, color-mix(in srgb,var(--band) 18%,var(--bg2)), var(--bg));
    border:1px solid var(--glass-brd);
    box-shadow:inset 0 1px 0 var(--glass-hi);
  }
  .ph-score{font-size:3rem;font-weight:900;line-height:1;letter-spacing:-1.5px;
    background:linear-gradient(160deg,#fff,var(--band2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .ph-band{font-size:0.66rem;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--band2)}

  .ph-story{text-align:center;font-size:0.94rem;font-weight:650;line-height:1.42;
    color:var(--text);margin:12px 6px 4px;text-wrap:balance}

  .ph-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
  .ph-stats>div{display:flex;flex-direction:column;align-items:center;gap:1px;
    background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:14px;padding:9px 4px}
  .ph-stats b{font-size:1.1rem;font-weight:900;letter-spacing:-.4px;color:var(--text)}
  .ph-stats span{font-size:0.62rem;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--muted)}

  @keyframes pulse-breathe{
    0%{transform:scale(1);filter:brightness(1)}
    100%{transform:scale(1.035);filter:brightness(1.12)}
  }
  @media (prefers-reduced-motion:reduce){.ph-orb{animation:none}}
</style>
