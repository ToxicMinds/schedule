<script lang="ts">
  import { updateAvailable, checkingUpdate, swVersion, applyUpdate, checkForUpdate } from '$lib/stores/appUpdate';

  let flash = $state(false);
  function manualCheck() {
    if ($updateAvailable) { applyUpdate(); return; }
    checkForUpdate();
    flash = true;
    setTimeout(() => (flash = false), 1600);
  }
</script>

{#if $updateAvailable}
  <button class="upd upd-new" onclick={applyUpdate} title="A new version is ready — tap to update">
    <span class="upd-ico">↻</span>Update
  </button>
{:else}
  <button
    class="upd upd-ok"
    class:checking={$checkingUpdate}
    onclick={manualCheck}
    title={$swVersion ? `You're on the latest build (${$swVersion.slice(0, 8)}) — tap to re-check` : 'Up to date — tap to check for updates'}
  >
    <span class="upd-ico">{$checkingUpdate ? '⟳' : flash ? '✓' : '●'}</span>
  </button>
{/if}

<style>
  .upd{display:inline-flex;align-items:center;gap:3px;border:none;background:none;cursor:pointer;font-family:inherit;font-weight:700;padding:0;line-height:1}
  .upd-ok{width:16px;height:16px;justify-content:center;color:var(--green);font-size:9px;opacity:.65;transition:opacity .2s}
  .upd-ok:active{opacity:1}
  .upd-ok.checking .upd-ico{animation:updspin .8s linear infinite}
  .upd-new{font-size:10px;color:#1a1200;background:var(--grad-amber);border-radius:8px;padding:4px 8px;box-shadow:var(--shadow-glow);animation:updpulse 1.6s ease-in-out infinite}
  .upd-new:active{transform:scale(.94)}
  .upd-ico{font-size:11px;line-height:1}
  @keyframes updspin{to{transform:rotate(360deg)}}
  @keyframes updpulse{0%,100%{opacity:1}50%{opacity:.72}}
</style>
