<script lang="ts">
  import type { FocusItem, Severity } from '$lib/coach';
  import { cardNav } from '$lib/actions/cardNav';
  import { base } from '$app/paths';

  let { items = [] as FocusItem[] } = $props();

  let expanded = $state(false);

  // severity → accent color + soft background (distinct warn yellow so it
  // doesn't blur into the purple "amber" brand accent).
  const COLORS: Record<Severity, { c: string; bg: string }> = {
    bad:  { c: 'var(--red)',   bg: 'var(--rb)' },
    warn: { c: '#ffd166',      bg: 'rgba(255,209,102,.12)' },
    good: { c: 'var(--green)', bg: 'var(--gb)' },
    info: { c: 'var(--blue)',  bg: 'var(--bb)' },
  };

  const hero = $derived(items[0] ?? null);
  const rest = $derived(items.slice(1));
  const shown = $derived(expanded ? rest : rest.slice(0, 3));
  const hiddenCount = $derived(Math.max(0, rest.length - shown.length));
</script>

{#if hero}
  <div class="focus-wrap">
    <div class="focus-hd">
      <span class="focus-title">Today's Focus</span>
      <span class="focus-dot" style="background:{COLORS[hero.severity].c}"></span>
    </div>

    <!-- Hero: the single most important thing right now -->
    {#if hero.href}
      <div class="hero card-tap" style="--ac:{COLORS[hero.severity].c};--abg:{COLORS[hero.severity].bg}" use:cardNav={base + hero.href}>
        {@render heroBody(hero)}
      </div>
    {:else}
      <div class="hero" style="--ac:{COLORS[hero.severity].c};--abg:{COLORS[hero.severity].bg}">
        {@render heroBody(hero)}
      </div>
    {/if}

    <!-- Everything else, compact -->
    {#each shown as it (it.id)}
      {#if it.href}
        <div class="pill card-tap" style="--ac:{COLORS[it.severity].c};--abg:{COLORS[it.severity].bg}" use:cardNav={base + it.href}>
          {@render pillBody(it)}
        </div>
      {:else}
        <div class="pill" style="--ac:{COLORS[it.severity].c};--abg:{COLORS[it.severity].bg}">
          {@render pillBody(it)}
        </div>
      {/if}
    {/each}

    {#if hiddenCount > 0 || (expanded && rest.length > 3)}
      <button class="more-btn" onclick={() => (expanded = !expanded)}>
        {expanded ? 'Show less ▲' : `${hiddenCount} more insight${hiddenCount === 1 ? '' : 's'} ▼`}
      </button>
    {/if}
  </div>
{/if}

{#snippet heroBody(it: FocusItem)}
  <div class="hero-top">
    <span class="hero-icon">{it.icon}</span>
    <div class="f1">
      <div class="hero-title">{it.title}</div>
      {#if it.metric}<div class="hero-metric">{it.metric}</div>{/if}
    </div>
  </div>
  <div class="hero-msg">{it.msg}</div>
{/snippet}

{#snippet pillBody(it: FocusItem)}
  <span class="pill-icon">{it.icon}</span>
  <div class="f1">
    <div class="pill-title">{it.title}{#if it.metric}<span class="pill-metric">{it.metric}</span>{/if}</div>
    <div class="pill-msg">{it.msg}</div>
  </div>
{/snippet}

<style>
  .focus-wrap { margin-bottom: 16px; }
  .focus-hd { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
  .focus-title { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.2px; color: var(--muted); }
  .focus-dot { width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 10px currentColor; animation: pulse 2.4s var(--ease) infinite; }
  @keyframes pulse { 0%,100% { opacity: .55; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.15); } }

  .hero {
    position: relative; overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--ac) 45%, var(--border));
    border-left: 3px solid var(--ac);
    background:
      linear-gradient(135deg, var(--abg), transparent 65%),
      linear-gradient(180deg, var(--bg2), color-mix(in srgb, var(--bg2) 92%, black));
    border-radius: 16px; padding: 15px 16px; margin-bottom: 8px;
    box-shadow: var(--shadow-sm);
  }
  .hero-top { display: flex; align-items: center; gap: 12px; }
  .hero-icon { font-size: 26px; line-height: 1; filter: drop-shadow(0 0 8px color-mix(in srgb, var(--ac) 60%, transparent)); }
  .hero-title { font-size: 15px; font-weight: 800; color: var(--text); letter-spacing: -.2px; }
  .hero-metric { font-size: 12px; font-weight: 700; color: var(--ac); margin-top: 1px; }
  .hero-msg { font-size: 13px; line-height: 1.5; color: var(--text); opacity: .92; margin-top: 9px; }

  .pill {
    display: flex; align-items: flex-start; gap: 11px;
    background: linear-gradient(90deg, var(--abg), transparent 80%);
    border: 1px solid var(--border); border-left: 3px solid var(--ac);
    border-radius: 12px; padding: 11px 13px; margin-bottom: 7px;
  }
  .pill-icon { font-size: 18px; line-height: 1.2; }
  .pill-title { font-size: 13px; font-weight: 700; color: var(--text); display: flex; align-items: baseline; gap: 8px; }
  .pill-metric { font-size: 11px; font-weight: 700; color: var(--ac); }
  .pill-msg { font-size: 12px; line-height: 1.45; color: var(--muted); margin-top: 2px; }

  .more-btn {
    width: 100%; background: transparent; border: 1px dashed var(--border2);
    border-radius: 10px; padding: 8px; color: var(--muted); font-size: 11.5px;
    font-weight: 700; cursor: pointer; font-family: inherit; margin-top: 2px;
    -webkit-tap-highlight-color: transparent;
  }
  .more-btn:active { transform: scale(.98); border-color: var(--amber); }
</style>
