<script lang="ts">
  let { vid = '' }: { vid?: string } = $props();

  let open = $state(false);
  let failed = $state(false);
  let online = $state(true);

  function openVideo() {
    failed = false;
    online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    open = true;
  }
  function closeVideo() { open = false; failed = false; }
  function onIframeError() { failed = true; }

  const embedUrl = $derived(vid ? `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0` : '');
  const watchUrl = $derived(vid ? `https://www.youtube.com/watch?v=${vid}` : '');

  // Exercise cards live inside the bottom-sheet Modal, whose box slides in
  // via `transform: translateY(...)`. Any CSS transform on an ancestor
  // creates a new containing block for `position: fixed` descendants, so
  // without this the overlay below renders relative to the (scrolled)
  // modal box instead of the viewport — it ends up positioned off-screen.
  // Moving the node to <body> on mount sidesteps that entirely.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

{#if vid}
  <button class="watch-btn" onclick={openVideo} title="Requires an internet connection">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    Watch full video (online)
  </button>
{/if}

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="video-overlay" class:open onclick={closeVideo} use:portal>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="video-box" onclick={(e) => e.stopPropagation()}>
    <button class="video-close" onclick={closeVideo}>&times;</button>
    {#if open}
      {#if !online}
        <div class="video-fallback">
          <p>No internet connection — video can't play offline.</p>
          <p class="hint">Use the exercise photos above for offline reference.</p>
        </div>
      {:else if failed}
        <div class="video-fallback">
          <p>Cannot play video here.</p>
          <a href={watchUrl} target="_blank" rel="noopener noreferrer">Open on YouTube instead ↗</a>
        </div>
      {:else}
        <iframe
          id="video-embed"
          src={embedUrl}
          allow="autoplay; encrypted-media"
          allowfullscreen
          title="Exercise video"
          onerror={onIframeError}
        ></iframe>
      {/if}
    {/if}
  </div>
</div>

<style>
  #video-embed{width:100%;height:100%;border:none}
  .video-fallback{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6rem;height:100%;padding:2rem;text-align:center;color:var(--text2, #aaa)}
  .video-fallback a{color:var(--amber, #f5a623);font-weight:600}
  .video-fallback .hint{font-size:.85rem;opacity:.8}
</style>
