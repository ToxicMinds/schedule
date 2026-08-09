<script lang="ts">
  // The visual half of the app's voice (see stores/toast.ts). Renders the queue
  // as a stack of glass cards that slide up from above the bottom nav, each with
  // its own auto-dismiss timer. Tap to dismiss early. Tones borrow the same
  // palette as the Fuel coach and the verdict aura, so a green line always means
  // the same thing everywhere.
  import { toasts, dismissToast, type Toast } from '$lib/stores/toast';
  import { onDestroy } from 'svelte';

  // One timer per toast id, cleared on dismiss/destroy so nothing leaks.
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  $effect(() => {
    for (const t of $toasts) {
      if (t.ttl > 0 && !timers.has(t.id)) {
        timers.set(t.id, setTimeout(() => close(t.id), t.ttl));
      }
    }
    // Drop timers for toasts that are already gone.
    for (const [id, handle] of timers) {
      if (!$toasts.some((t) => t.id === id)) {
        clearTimeout(handle);
        timers.delete(id);
      }
    }
  });

  function close(id: number) {
    const h = timers.get(id);
    if (h) { clearTimeout(h); timers.delete(id); }
    dismissToast(id);
  }

  onDestroy(() => {
    for (const h of timers.values()) clearTimeout(h);
    timers.clear();
  });
</script>

<div class="toast-wrap" aria-live="polite">
  {#each $toasts as t (t.id)}
    <button class="toast toast-{t.tone}" onclick={() => close(t.id)} aria-label="Dismiss notification">
      <span class="toast-icon">{t.icon}</span>
      <span class="toast-text">
        <span class="toast-title">{t.title}</span>
        {#if t.body}<span class="toast-body">{t.body}</span>{/if}
      </span>
      <span class="toast-x" aria-hidden="true">&times;</span>
    </button>
  {/each}
</div>

<style>
  .toast-wrap{position:fixed;left:12px;right:12px;bottom:calc(var(--nav-h) + var(--sb) + 12px);z-index:120;display:flex;flex-direction:column;gap:8px;pointer-events:none}
  .toast{--tc:var(--blue,#60a5fa);pointer-events:auto;width:100%;text-align:left;font-family:inherit;display:flex;align-items:flex-start;gap:11px;padding:12px 13px;border-radius:14px;cursor:pointer;
    background:color-mix(in srgb, var(--tc) 14%, var(--bg2));
    border:1px solid color-mix(in srgb, var(--tc) 45%, transparent);
    box-shadow:0 10px 30px rgba(0,0,0,.38), 0 0 0 1px rgba(255,255,255,.02) inset;
    backdrop-filter:blur(16px) saturate(150%);-webkit-backdrop-filter:blur(16px) saturate(150%);
    animation:toast-in .32s cubic-bezier(.2,.9,.25,1)}
  .toast:active{transform:scale(.98)}
  .toast-good{--tc:var(--green,#2ecc71)}
  .toast-ok{--tc:var(--blue,#60a5fa)}
  .toast-warn{--tc:var(--amber,#f5a623)}
  .toast-bad{--tc:#ff6b6b}
  .toast-icon{font-size:1.25rem;line-height:1.2;flex-shrink:0;filter:drop-shadow(0 0 8px color-mix(in srgb,var(--tc) 60%,transparent))}
  .toast-text{flex:1;min-width:0;display:flex;flex-direction:column}
  .toast-title{font-size:0.8125rem;font-weight:800;color:#fff;line-height:1.35}
  .toast-body{font-size:0.72rem;color:var(--text);line-height:1.45;margin-top:2px;opacity:.92}
  .toast-x{flex-shrink:0;color:var(--muted);font-size:1.2rem;line-height:1;opacity:.7}
  @keyframes toast-in{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
  @media (prefers-reduced-motion: reduce){.toast{animation:none}}
</style>
