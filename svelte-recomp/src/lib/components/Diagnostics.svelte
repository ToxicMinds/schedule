<script lang="ts">
  // "What's actually wrong right now?" — one place, on the device.
  //
  // Every subsystem that used to fail into console.warn now reports here (see
  // stores/notices.ts). The badge only appears when something has genuinely
  // gone wrong, so it stays ignorable until it matters.
  import { notices, unreadCount, clearNotices, markNoticesRead } from '$lib/stores/notices';
  import { healthConnect } from '$lib/health/healthConnect';
  import { syncStatus, syncError } from '$lib/stores/sync';
  import { lastRefresh } from '$lib/stores/refresh';
  import Modal from '$lib/components/Modal.svelte';

  let open = $state(false);

  function show() {
    open = true;
    markNoticesRead();
  }

  function ago(ms: number | null): string {
    if (!ms) return 'never';
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  }

  function when(at: number): string {
    return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<button class="diag-btn" class:alert={$unreadCount > 0} onclick={show} title="App status">
  {$unreadCount > 0 ? '⚠' : 'ⓘ'}
  {#if $unreadCount > 0}<span class="diag-count">{$unreadCount > 9 ? '9+' : $unreadCount}</span>{/if}
</button>

<Modal {open} onclose={() => (open = false)}>
  <div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:10px">App status</div>

  <div class="diag-grid">
    <div class="diag-row">
      <span class="diag-k">Cloud sync</span>
      <span class="diag-v" class:ok={$syncStatus === 'synced'} class:bad={$syncStatus === 'error'}>
        {$syncStatus}
      </span>
    </div>
    <div class="diag-row">
      <span class="diag-k">Last full refresh</span>
      <span class="diag-v">{ago($lastRefresh)}</span>
    </div>
    <div class="diag-row">
      <span class="diag-k">Watch data</span>
      <span class="diag-v" class:ok={$healthConnect.lastSync && !$healthConnect.lastError} class:bad={!!$healthConnect.lastError}>
        {$healthConnect.native ? ($healthConnect.lastError ? 'error' : ago($healthConnect.lastSync ? Date.parse($healthConnect.lastSync) : null)) : 'web — not available'}
      </span>
    </div>
    {#if $healthConnect.sources.length}
      <div class="diag-row">
        <span class="diag-k">Health sources</span>
        <span class="diag-v">{$healthConnect.sources.length} found</span>
      </div>
    {/if}
  </div>

  {#if $syncError}
    <div class="diag-note">{$syncError}</div>
  {/if}

  <div style="font-size:12px;font-weight:700;color:var(--muted);margin:14px 0 6px">
    RECENT PROBLEMS
  </div>

  {#if $notices.length === 0}
    <div class="diag-empty">Nothing has gone wrong. When something does, it shows up here instead of failing quietly.</div>
  {:else}
    <div class="diag-list">
      {#each $notices as n (n.id)}
        <div class="diag-item diag-{n.level}">
          <div class="diag-item-hd">
            <span class="diag-src">{n.source}</span>
            <span class="diag-time">{when(n.at)}</span>
          </div>
          <div class="diag-msg">{n.message}</div>
          {#if n.hint}<div class="diag-hint">{n.hint}</div>{/if}
        </div>
      {/each}
    </div>
    <button class="btn bg_ bfl" style="margin-top:10px" onclick={clearNotices}>Clear</button>
  {/if}
</Modal>

<style>
  .diag-btn{position:relative;width:36px;height:36px;border-radius:50%;border:1px solid var(--border);background:var(--bg3);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;transition:all .2s var(--ease)}
  .diag-btn:active{transform:scale(.9)}
  .diag-btn.alert{border-color:var(--red);color:var(--red)}
  .diag-count{position:absolute;top:-3px;right:-3px;background:var(--red);color:#fff;font-size:9px;font-weight:800;border-radius:999px;padding:1px 4px;line-height:1.3}
  .diag-grid{display:flex;flex-direction:column;gap:2px}
  .diag-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12.5px}
  .diag-k{color:var(--muted)}
  .diag-v{font-weight:700;color:var(--text)}
  .diag-v.ok{color:var(--green,#2ecc71)}
  .diag-v.bad{color:var(--red)}
  .diag-note{margin-top:10px;font-size:11.5px;color:var(--amber);line-height:1.45}
  .diag-empty{font-size:12px;color:var(--muted);line-height:1.5}
  .diag-list{display:flex;flex-direction:column;gap:8px;max-height:45vh;overflow-y:auto}
  .diag-item{border-left:3px solid var(--border);padding:6px 0 6px 10px}
  .diag-item.diag-error{border-left-color:var(--red)}
  .diag-item.diag-warn{border-left-color:var(--amber)}
  .diag-item-hd{display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);margin-bottom:2px}
  .diag-src{font-weight:700}
  .diag-msg{font-size:12px;color:var(--text);line-height:1.4;word-break:break-word}
  .diag-hint{font-size:11px;color:var(--muted);margin-top:3px;line-height:1.4}
</style>
