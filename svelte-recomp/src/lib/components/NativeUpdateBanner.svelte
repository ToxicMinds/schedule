<script lang="ts">
  // Native APK update prompt. Only ever shows on-device when the installed
  // build is behind LATEST_NATIVE_BUILD. One tap downloads the signed APK and
  // hands it to Android's installer for a true in-place update — no uninstall,
  // no browser, no file manager, no data loss. See stores/nativeUpdate.
  import { onMount } from 'svelte';
  import {
    updateState,
    checkForNativeUpdate,
    installNativeUpdate,
  } from '$lib/stores/nativeUpdate';
  import { haptic } from '$lib/haptics';

  let dismissed = $state(false);

  onMount(() => {
    checkForNativeUpdate();
  });

  function update() {
    haptic('impact');
    installNativeUpdate();
  }
</script>

{#if $updateState.available && !dismissed}
  <div class="nu-wrap" role="status" aria-live="polite">
    <div class="nu-card">
      <div class="nu-ico">↑</div>
      <div class="nu-body">
        <div class="nu-title">New version ready</div>
        <div class="nu-sub">
          {#if $updateState.error}
            <span class="nu-err">{$updateState.error}</span>
          {:else if $updateState.busy}
            Downloading update…
          {:else}
            Installs right over the app — nothing to delete, nothing lost.
          {/if}
        </div>
      </div>
      <div class="nu-actions">
        <button class="nu-btn" onclick={update} disabled={$updateState.busy}>
          {$updateState.busy ? 'Updating…' : 'Update'}
        </button>
        <button
          class="nu-x"
          onclick={() => (dismissed = true)}
          disabled={$updateState.busy}
          aria-label="Later"
          title="Later"
        >&times;</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .nu-wrap{
    position:fixed;
    left:0;right:0;
    bottom:calc(var(--nav-h,64px) + var(--sb) + 12px);
    display:flex;justify-content:center;
    padding:0 12px;
    z-index:60;
    pointer-events:none;
    animation:nuIn .28s cubic-bezier(.2,.9,.3,1);
  }
  .nu-card{
    pointer-events:auto;
    display:flex;align-items:center;gap:12px;
    width:100%;max-width:440px;
    padding:12px 12px 12px 14px;
    background:color-mix(in srgb,var(--bg2) 78%,transparent);
    backdrop-filter:blur(20px) saturate(150%);
    -webkit-backdrop-filter:blur(20px) saturate(150%);
    border:1px solid var(--glass-brd);
    border-radius:16px;
    box-shadow:0 10px 34px rgba(0,0,0,.45), var(--shadow-glow);
  }
  .nu-ico{
    flex-shrink:0;
    width:34px;height:34px;border-radius:11px;
    display:flex;align-items:center;justify-content:center;
    font-size:1.1rem;font-weight:800;color:#1a1200;
    background:var(--grad-amber);
    box-shadow:var(--shadow-glow);
    animation:nuBob 1.8s ease-in-out infinite;
  }
  .nu-body{flex:1;min-width:0}
  .nu-title{font-weight:800;font-size:0.875rem;letter-spacing:-.2px;color:var(--text)}
  .nu-sub{font-size:0.75rem;color:var(--text-dim,#9aa4af);margin-top:1px;line-height:1.25}
  .nu-err{color:var(--red,#fb7185)}
  .nu-actions{flex-shrink:0;display:flex;align-items:center;gap:6px}
  .nu-btn{
    border:none;cursor:pointer;font-family:inherit;font-weight:800;
    font-size:0.8125rem;color:#1a1200;
    background:var(--grad-amber);
    border-radius:11px;padding:9px 14px;min-height:40px;
    box-shadow:var(--shadow-glow);
    transition:transform .12s;
  }
  .nu-btn:active{transform:scale(.94)}
  .nu-btn:disabled{opacity:.7;cursor:default}
  .nu-x{
    border:none;background:none;cursor:pointer;
    color:var(--text-dim,#9aa4af);font-size:1.4rem;line-height:1;
    width:36px;height:36px;border-radius:9px;
    display:flex;align-items:center;justify-content:center;
  }
  .nu-x:active{background:var(--glass-brd)}
  @keyframes nuIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  @keyframes nuBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
</style>
