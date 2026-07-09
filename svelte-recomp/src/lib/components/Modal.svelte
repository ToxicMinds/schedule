<script lang="ts">
  let { open = false, onclose, children }: {
    open?: boolean;
    onclose?: () => void;
    children?: import('svelte').Snippet;
  } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="moverlay" class:open onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="mbox" onclick={(e) => e.stopPropagation()}>
    <div class="mhandle"></div>
    {#if children}{@render children()}{/if}
  </div>
</div>
