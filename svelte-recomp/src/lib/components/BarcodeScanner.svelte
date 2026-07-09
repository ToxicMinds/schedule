<script lang="ts">
  // Barcode -> food macros lookup, replicating MyFitnessPal's premium
  // barcode-scan feature for free, using two things everyone's browser
  // already ships and the fully free/keyless Open Food Facts database:
  //   1. The native `BarcodeDetector` Web API (Chrome/Android/Edge) reads
  //      a barcode from the live camera feed with zero dependencies.
  //   2. https://world.openfoodfacts.org/api/v0/product/{barcode}.json
  //      returns per-100g macros for 3M+ products, no API key required.
  // iOS Safari does not implement BarcodeDetector (as of this writing),
  // so we fall back to manual barcode entry there -- still faster than
  // typing out full nutrition info by hand, and the lookup/macro-fill
  // logic is identical either way.
  let { onResult }: { onResult: (food: { name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; per100g: boolean }) => void } = $props();

  let open = $state(false);
  let scanning = $state(false);
  let manualCode = $state('');
  let status = $state('');
  let videoEl: HTMLVideoElement | undefined = $state();
  let stream: MediaStream | null = null;
  let detectorSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  let stopFlag = false;

  async function lookupBarcode(code: string) {
    status = 'Looking up…';
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
      const data = await res.json();
      if (data.status !== 1 || !data.product) {
        status = `No product found for barcode ${code}.`;
        return;
      }
      const p = data.product;
      const n = p.nutriments || {};
      const name = p.product_name || p.generic_name || `Barcode ${code}`;
      onResult({
        name,
        kcal: n['energy-kcal_100g'] ?? 0,
        protein_g: n['proteins_100g'] ?? 0,
        carbs_g: n['carbohydrates_100g'] ?? 0,
        fat_g: n['fat_100g'] ?? 0,
        per100g: true,
      });
      status = `Found: ${name} (values per 100g — adjust for your portion)`;
      closeScanner();
    } catch (e: any) {
      status = 'Lookup failed: ' + (e?.message || String(e));
    }
  }

  async function startScanner() {
    open = true;
    stopFlag = false;
    if (!detectorSupported) return; // manual-entry UI shown instead
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoEl) { videoEl.srcObject = stream; await videoEl.play(); }
      scanning = true;
      const Detector = (window as any).BarcodeDetector;
      const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const loop = async () => {
        if (stopFlag || !videoEl) return;
        try {
          const codes = await detector.detect(videoEl);
          if (codes.length > 0) {
            stopFlag = true;
            await lookupBarcode(codes[0].rawValue);
            return;
          }
        } catch { /* transient decode errors are normal, keep looping */ }
        requestAnimationFrame(loop);
      };
      loop();
    } catch (e: any) {
      status = 'Camera access failed: ' + (e?.message || String(e));
    }
  }

  function closeScanner() {
    stopFlag = true;
    scanning = false;
    open = false;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }
</script>

<button class="btn bg_ bsm" onclick={startScanner}>📷 Scan barcode</button>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="scan-overlay" onclick={closeScanner}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="scan-box" onclick={(e) => e.stopPropagation()}>
      <button class="scan-close" onclick={closeScanner} aria-label="Close">&times;</button>
      {#if detectorSupported}
        <video bind:this={videoEl} muted playsinline class="scan-video"></video>
        <div class="scan-hint">Point the camera at a barcode</div>
      {:else}
        <div class="scan-manual">
          <div class="scan-hint">Your browser doesn't support live barcode scanning — enter the number printed under the barcode instead.</div>
          <input type="text" inputmode="numeric" placeholder="e.g. 3017620422003" bind:value={manualCode}>
          <button class="btn bp bfl" style="margin-top:8px" onclick={() => lookupBarcode(manualCode)} disabled={!manualCode.trim()}>Look up</button>
        </div>
      {/if}
      {#if status}<div class="scan-status">{status}</div>{/if}
    </div>
  </div>
{/if}

<style>
  .scan-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:250;display:flex;align-items:center;justify-content:center;padding:20px}
  .scan-box{position:relative;width:100%;max-width:400px;background:var(--bg2);border-radius:16px;padding:16px}
  .scan-close{position:fixed;top:calc(var(--st) + 14px);right:14px;width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.25);color:#fff;font-size:26px;cursor:pointer;z-index:260;display:flex;align-items:center;justify-content:center}
  .scan-video{width:100%;border-radius:10px;background:#000;aspect-ratio:4/3;object-fit:cover}
  .scan-hint{font-size:12px;color:var(--muted);text-align:center;margin-top:8px}
  .scan-manual input{margin-top:6px}
  .scan-status{font-size:12px;color:var(--amber);text-align:center;margin-top:10px}
</style>
