<script lang="ts">
  // Generic small line+area chart for any {date, value} series. Extracted
  // from the Track page's weight chart so it can be reused for per-exercise
  // progress (top-set weight over time) without duplicating the SVG math.
  let { data = [], color = 'var(--amber)', height = 110 }: {
    data?: Array<{ date: string; value: number }>;
    color?: string;
    height?: number;
  } = $props();

  const pad = { t: 10, r: 10, b: 20, l: 10 };
  const chartW = 300;
  const chartH = height;
  const plotW = chartW - pad.l - pad.r;
  const plotH = chartH - pad.t - pad.b;

  function scaled(pts: Array<{ date: string; value: number }>) {
    const mn = Math.min(...pts.map((p) => p.value)) - 1;
    const mx = Math.max(...pts.map((p) => p.value)) + 1;
    const rng = mx - mn || 1;
    return pts.map((p, i) => ({
      x: pad.l + (i / (pts.length - 1 || 1)) * plotW,
      y: pad.t + (1 - (p.value - mn) / rng) * plotH,
      ...p,
    }));
  }

  const linePath = $derived.by(() => {
    if (data.length < 2) return '';
    const pts = scaled(data);
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  });

  const areaPath = $derived.by(() => {
    if (data.length < 2) return '';
    const pts = scaled(data);
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return `${line}L${pad.l + plotW},${pad.t + plotH}L${pad.l},${pad.t + plotH}Z`;
  });

  const labels = $derived.by(() => {
    if (data.length < 2) return [];
    const pts = scaled(data);
    const step = Math.max(1, Math.floor(pts.length / 4));
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  });
</script>

{#if data.length < 2}
  <div class="mc-empty">Log at least 2 sessions to see a trend chart.</div>
{:else}
  <svg viewBox="0 0 {chartW} {chartH}" width="100%" height={chartH}>
    <path d={areaPath} fill={color} opacity="0.15" />
    <path d={linePath} stroke={color} stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    {#each labels as lbl}
      <circle cx={lbl.x} cy={lbl.y} r="2.5" fill={color} />
      <text x={lbl.x} y={chartH - 4} font-size="8" fill="var(--muted)" text-anchor="middle">{lbl.date.slice(5)}</text>
    {/each}
  </svg>
{/if}

<style>
  .mc-empty{font-size:11px;color:var(--muted);text-align:center;padding:16px 0}
</style>
