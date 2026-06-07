<script lang="ts">
  let { vid = '' }: { vid?: string } = $props();

  let open = $state(false);

  function openVideo() { open = true; }
  function closeVideo() { open = false; }

  const embedUrl = $derived(vid ? `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0` : '');
</script>

{#if vid}
  <button class="watch-btn" onclick={openVideo}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    Watch
  </button>
{/if}

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="video-overlay" class:open onpointerdown={closeVideo}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="video-box" onclick={(e) => e.stopPropagation()}>
    <button class="video-close" onclick={closeVideo}>&times;</button>
    {#if open}
      <iframe id="video-embed" src={embedUrl} allow="autoplay; encrypted-media" allowfullscreen title="Exercise video"></iframe>
    {/if}
  </div>
</div>

<style>
  #video-embed{width:100%;height:100%;border:none}
</style>
