<script lang="ts">
  // Food AI recognition: take/upload a photo of a meal and/or type a
  // description of it, and a Gemini Vision-backed edge function
  // (estimate-food) identifies the food and estimates kcal/protein/
  // carbs/fat for the ACTUAL portion size (not a generic per-100g
  // figure like the barcode scanner gives) -- this is what makes it
  // meaningfully different from barcode scanning: it works for
  // home-cooked meals, restaurant food, anything without a packaging
  // barcode at all. A typed description is optional context that
  // refines the photo estimate (ingredients/cooking method/portion
  // that aren't obvious from the image alone -- "no oil, extra rice"),
  // or can be used entirely on its own with no photo at all, for
  // logging by description only. It's still just an estimate (an AI
  // guess, not a lab measurement), so results are shown as a starting
  // point to adjust, same as the barcode flow.
  let { onResult }: { onResult: (food: { name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; confidence: string }) => void } = $props();

  let open = $state(false);
  let analyzing = $state(false);
  let photoPreview = $state<string | null>(null);
  let description = $state('');
  let status = $state('');

  function onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    open = true;
    status = '';
    description = '';
    const reader = new FileReader();
    reader.onload = () => {
      photoPreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  function openDescribeOnly() {
    open = true;
    status = '';
    photoPreview = null;
    description = '';
  }

  async function analyze() {
    if (!photoPreview && !description.trim()) {
      status = 'Add a photo, a description, or both.';
      return;
    }
    analyzing = true;
    status = '';
    try {
      const { supabase } = await import('$lib/db/client');
      const { data, error } = await supabase.functions.invoke('estimate-food', {
        body: { image: photoPreview || undefined, description: description.trim() || undefined },
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
    description = '';
  }
</script>

<div class="flex gap2">
  <label class="btn bg_ bsm food-photo-btn">
    📸 Photo of food
    <input type="file" accept="image/*" capture="environment" onchange={onFile} style="display:none">
  </label>
  <button type="button" class="btn bg_ bsm" onclick={openDescribeOnly}>📝 Describe food</button>
</div>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="fp-overlay" onclick={closePreview}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="fp-box" onclick={(e) => e.stopPropagation()}>
      <button class="fp-close" onclick={closePreview} aria-label="Close">&times;</button>
      {#if photoPreview}
        <img src={photoPreview} alt="Food to analyze" class="fp-preview" />
      {/if}
      <label class="fp-desc-lbl" for="fp-desc">{photoPreview ? 'Add detail (optional) — helps accuracy' : 'Describe the food'}</label>
      <textarea id="fp-desc" class="fp-desc" rows="2" bind:value={description}
        placeholder={photoPreview ? 'e.g. no oil, extra rice, ~300g' : 'e.g. grilled chicken thigh, no skin, ~200g, with rice'}></textarea>
      <button class="btn bp bfl" style="margin-top:8px" onclick={analyze} disabled={analyzing}>{analyzing ? 'Analyzing…' : 'Analyze'}</button>
      {#if status}
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
  .fp-desc-lbl{display:block;font-size:11px;color:var(--muted);margin-top:10px;margin-bottom:4px}
  .fp-desc{width:100%;resize:vertical;font-family:inherit}
  .fp-status{font-size:13px;color:var(--amber2);text-align:center;margin-top:10px;line-height:1.5}
</style>
