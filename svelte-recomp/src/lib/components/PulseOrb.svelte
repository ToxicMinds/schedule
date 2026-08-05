<script lang="ts">
  // The living orb, extracted so every page speaks the same visual language.
  // Colour/meaning comes from an ancestor .tone-* class (--band/--band2); this
  // component only draws the ring, the breathing core and a slow premium sheen.
  let { pct = 0, value = '', label = '', breath = '5s', size = 172 } = $props<{
    pct?: number; value?: string | number; label?: string; breath?: string; size?: number;
  }>();
  const clamped = $derived(Math.max(0, Math.min(100, pct)));
</script>

<div class="orb" style="--pct:{clamped}; --breath:{breath}; --sz:{size}px">
  <div class="orb-core">
    <span class="orb-val">{value}</span>
    {#if label}<span class="orb-lbl">{label}</span>{/if}
  </div>
</div>

<style>
  .orb{
    position:relative;width:var(--sz);height:var(--sz);border-radius:50%;
    display:grid;place-items:center;
    /* progress arc: the verdict colour up to --pct, a faint remainder after */
    background:conic-gradient(from -90deg,
      var(--band) calc(var(--pct)*1%),
      color-mix(in srgb,var(--band) 12%,transparent) 0);
    box-shadow:
      0 0 46px color-mix(in srgb,var(--band) 45%,transparent),
      inset 0 0 28px color-mix(in srgb,var(--band) 22%,transparent);
    animation:orb-breathe var(--breath,5s) var(--ease) infinite alternate;
  }
  /* slow-spinning specular sheen sweeping the ring — the "premium" catch-light */
  .orb::before{
    content:'';position:absolute;inset:0;border-radius:50%;pointer-events:none;
    background:conic-gradient(from 0deg,transparent 0 62%,rgba(255,255,255,.55) 74%,transparent 86%);
    -webkit-mask:radial-gradient(farthest-side,transparent calc(50% - 17px),#000 calc(50% - 16px));
    mask:radial-gradient(farthest-side,transparent calc(50% - 17px),#000 calc(50% - 16px));
    mix-blend-mode:overlay;opacity:.9;
    animation:orb-spin 6s linear infinite;
  }
  .orb-core{
    position:relative;z-index:1;
    width:calc(var(--sz) - 34px);height:calc(var(--sz) - 34px);border-radius:50%;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
    background:radial-gradient(circle at 50% 34%, color-mix(in srgb,var(--band) 20%,var(--bg2)), var(--bg) 82%);
    border:1px solid var(--glass-brd);
    box-shadow:inset 0 1px 0 var(--glass-hi), inset 0 0 22px rgba(0,0,0,.35);
  }
  .orb-val{font-size:2.7rem;font-weight:900;line-height:1;letter-spacing:-1.5px;
    background:linear-gradient(160deg,#fff,var(--band2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .orb-lbl{font-size:0.64rem;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--band2);text-align:center;padding:0 8px;text-wrap:balance}

  @keyframes orb-breathe{
    0%{transform:scale(1);filter:brightness(1)}
    100%{transform:scale(1.035);filter:brightness(1.13)}
  }
  @keyframes orb-spin{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){
    .orb{animation:none}
    .orb::before{animation:none;opacity:.4}
  }
</style>
