<script lang="ts">
  // The living hero, generalised for every page. Same DNA as Today's Pulse:
  // a breathing orb (the page's ONE metric), a colour-coded verdict, one
  // narrated sentence, and a tight stat trio — so each tab opens with a single
  // glanceable story instead of a wall of cards.
  import PulseOrb from './PulseOrb.svelte';

  type Tone = 'good' | 'ok' | 'warn' | 'bad' | 'na';
  let {
    title, sub = '', badge = '', tone = 'na', pct = 0,
    orbValue = '', orbLabel = '', story = '', breath = '5s',
    stats = []
  } = $props<{
    title: string; sub?: string; badge?: string; tone?: Tone; pct?: number;
    orbValue?: string | number; orbLabel?: string; story?: string; breath?: string;
    stats?: Array<{ v: string | number; l: string }>;
  }>();
</script>

<section class="phero glass tone-{tone}">
  <header class="phero-top">
    <div>
      <div class="phero-title">{title}</div>
      {#if sub}<div class="phero-sub">{sub}</div>{/if}
    </div>
    {#if badge}<div class="phero-badge">{badge}</div>{/if}
  </header>

  <div class="phero-orb"><PulseOrb {pct} value={orbValue} label={orbLabel} {breath} /></div>

  {#if story}<p class="phero-story">{story}</p>{/if}

  {#if stats.length}
    <div class="phero-stats">
      {#each stats as s}
        <div><b>{s.v}</b><span>{s.l}</span></div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .phero{position:relative;border-radius:26px;padding:20px 20px 18px;margin-bottom:14px;overflow:hidden}
  .phero::after{
    content:'';position:absolute;top:-28%;left:50%;transform:translateX(-50%);
    width:120%;height:130%;pointer-events:none;z-index:0;
    background:radial-gradient(closest-side, color-mix(in srgb,var(--band) 32%,transparent), transparent 72%);
    filter:blur(6px);
  }
  .phero-top,.phero-orb,.phero-story,.phero-stats{position:relative;z-index:1}

  .phero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:4px}
  .phero-title{font-size:1.5rem;font-weight:900;letter-spacing:-.6px;line-height:1.05;
    background:linear-gradient(120deg,var(--text),var(--band2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .phero-sub{font-size:0.72rem;color:var(--muted);margin-top:2px}
  .phero-badge{flex-shrink:0;font-size:0.7rem;font-weight:800;color:var(--band2);
    background:color-mix(in srgb,var(--band) 16%,transparent);
    border:1px solid color-mix(in srgb,var(--band) 40%,transparent);
    padding:5px 10px;border-radius:999px;white-space:nowrap}

  .phero-orb{display:flex;justify-content:center;padding:8px 0 2px}
  .phero-story{text-align:center;font-size:0.94rem;font-weight:650;line-height:1.42;color:var(--text);margin:12px 6px 4px;text-wrap:balance}

  .phero-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
  .phero-stats>div{display:flex;flex-direction:column;align-items:center;gap:1px;
    background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:14px;padding:9px 4px}
  .phero-stats b{font-size:1.1rem;font-weight:900;letter-spacing:-.4px;color:var(--text)}
  .phero-stats span{font-size:0.6rem;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--muted);text-align:center}
</style>
