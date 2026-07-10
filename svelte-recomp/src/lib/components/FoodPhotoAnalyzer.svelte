<script lang="ts">
  // Food photo recognition: take/upload a photo of a meal, and a Gemini
  // Vision-backed edge function (estimate-food) identifies the food and
  // estimates kcal/protein/carbs/fat for the ACTUAL portion size shown
  // (not a generic per-100g figure like the barcode scanner gives) --
  // this is what makes it meaningfully different from barcode scanning:
  // it works for home-cooked meals, restaurant food, anything without
  // a packaging barcode at all. It's still just an estimate (an AI
  // guess from a photo, not a lab measurement), so results are shown
  // as a starting point to adjust, same as the barcode flow.
  let { onResult }: { onResult: (food: { name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; confidence: string }) => void } = $props();

  let open = $state(false);
  let analyzing = $state(false);
  let photoPreview = $state<string | null>(null);
  let status = $state('');

  function onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    open = true;
    status = '';
    const reader = new FileReader();
    reader.onload = () => {
      photoPreview = reader.result as string;
      analyzePhoto(photoPreview);
    };
    reader.readAsDataURL(file);
  }

  async function analyzePhoto(dataUrl: string) {
    analyzing = true;
    status = '';
    try {
      const { supabase } = await import('$lib/db/client');
      const { data, error } = await supabase.functions.invoke('estimate-food', {
        body: { image: dataUrl },
      });
      if (error) throw error;
      if (data?.error) {
        status = data.error;
        return;
      }
      onResult(data);
      status = `Identified: ${data.name} (${data.confidence} confidence) — adjust the numbers if needed, then Add.`;
      closePreview();
    } catch (e: any) {
      status = 'Analysis failed: ' + (e?.message || String(e)).slice(0, 200);
    } finally {
      analyzing = false;
    }
  }

  function closePreview() {
    open = false;
    photoPreview = null;
  }
</script>

<label class="btn bg_ bsm food-photo-btn">
  📸 Photo of food
  <input type="file" accept="image/*" capture="environment" onchange={onFile} style="display:none">
</label>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="fp-overlay" onclick={closePreview}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="fp-box" onclick={(e) => e.stopPropagation()}>
      <button class="fp-close" onclick={closePreview} aria-label="Close">&times;</button>
      {#if photoPreview}
        <img src={photoPreview} alt="Food to analyze" class="fp-preview" />
      {/if}
      {#if analyzing}
        <div class="fp-status">Analyzing photo…</div>
      {:else if status}
        <div class="fp-status">{status}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .food-photo-btn{display:inline-block;cursor:pointer}
  .fp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:250;display:flex;align-items:center;justify-content:center;padding:20px}
  .fp-box{position:relative;width:100%;max-width:400px;background:var(--bg2);border-radius:16px;padding:16px}
  .fp-close{position:fixed;top:calc(var(--st) + 14px);right:14px;width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.25);color:#fff;font-size:26px;cursor:pointer;z-index:260;display:flex;align-items:center;justify-content:center}
  .fp-preview{width:100%;border-radius:10px;max-height:320px;object-fit:cover}
  .fp-status{font-size:13px;color:var(--amber2);text-align:center;margin-top:10px;line-height:1.5}
</style>
