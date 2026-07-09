<script lang="ts">
  // Progress photo log with before/after slider comparison (Noom-style).
  // Photos are stored in Supabase Storage under a private, per-user
  // folder (progress-photos/{uid}/{date}-{angle}.jpg) with RLS scoping
  // read/write to the owning user only; metadata (date/angle) lives in
  // the progress_photos table so we can list/query without hitting
  // Storage's listing API. Photos are captured or picked via the
  // standard file input `capture` attribute (opens the camera directly
  // on mobile) -- no extra camera-permission UI needed beyond what the
  // browser already provides for <input type=file capture>.
  import { userId } from '$lib/stores/user';
  import { supabase } from '$lib/db/client';

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  let photos = $state<Array<{ id: string; date: string; angle: string; url: string; storagePath: string }>>([]);
  let loading = $state(true);
  let uploading = $state(false);
  let uploadMsg = $state('');
  let angle = $state<'front' | 'side' | 'back'>('front');

  let compareA = $state<string | null>(null);
  let compareB = $state<string | null>(null);
  let sliderPct = $state(50);

  async function loadPhotos() {
    if (!uid) return;
    loading = true;
    const { data, error } = await supabase
      .from('progress_photos')
      .select('id, date, angle, storage_path')
      .eq('user_id', uid)
      .order('date', { ascending: true });
    if (error) { console.error('Load photos failed:', error); loading = false; return; }
    const withUrls = await Promise.all(
      (data || []).map(async (row) => {
        const { data: signed } = await supabase.storage
          .from('progress-photos')
          .createSignedUrl(row.storage_path, 60 * 60); // 1hr, plenty for a viewing session
        return { id: row.id, date: row.date, angle: row.angle, url: signed?.signedUrl || '', storagePath: row.storage_path };
      })
    );
    photos = withUrls;
    loading = false;
    // Default comparison: oldest vs newest for the currently selected angle.
    const forAngle = photos.filter((p) => p.angle === angle);
    if (forAngle.length >= 2) {
      compareA = forAngle[0].id;
      compareB = forAngle[forAngle.length - 1].id;
    }
  }

  $effect(() => { if (uid) loadPhotos(); });

  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !uid) return;
    uploading = true;
    uploadMsg = '';
    try {
      const today = new Date().toISOString().slice(0, 10);
      const path = `${uid}/${today}-${angle}-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('progress-photos').upload(path, file, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from('progress_photos').insert({
        user_id: uid, date: today, angle, storage_path: path,
      });
      if (dbErr) throw dbErr;
      uploadMsg = 'Saved ✓';
      await loadPhotos();
    } catch (e: any) {
      uploadMsg = 'Upload failed: ' + (e?.message || String(e));
    } finally {
      uploading = false;
      input.value = '';
    }
  }

  async function deletePhoto(id: string, storagePath: string) {
    try {
      await supabase.storage.from('progress-photos').remove([storagePath]);
      await supabase.from('progress_photos').delete().eq('id', id);
      await loadPhotos();
    } catch (e) { console.error('Delete photo failed:', e); }
  }

  const angleFiltered = $derived(photos.filter((p) => p.angle === angle));
  const photoA = $derived(photos.find((p) => p.id === compareA));
  const photoB = $derived(photos.find((p) => p.id === compareB));

  let sliderDragging = $state(false);
  let sliderBoxWidth = $state(0);
  function onSliderMove(e: PointerEvent, container: HTMLElement) {
    if (!sliderDragging) return;
    const rect = container.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    sliderPct = Math.max(0, Math.min(100, pct));
  }
</script>

<div class="card">
  <div class="card-lbl">Progress Photos</div>

  <div class="angle-tabs">
    {#each ['front', 'side', 'back'] as a}
      <button class="tab" class:on={angle === a} onclick={() => angle = a as typeof angle}>{a}</button>
    {/each}
  </div>

  <label class="btn bp bfl photo-add-btn">
    {uploading ? 'Uploading…' : `📸 Add ${angle} photo`}
    <input type="file" accept="image/*" capture="user" onchange={handleFile} disabled={uploading} style="display:none">
  </label>
  {#if uploadMsg}
    <div style="font-size:12px;text-align:center;margin-top:6px;color:{uploadMsg.startsWith('Upload failed') ? 'var(--red)' : 'var(--green)'}">{uploadMsg}</div>
  {/if}

  {#if loading}
    <div style="font-size:12px;color:var(--muted);text-align:center;padding:12px 0">Loading photos…</div>
  {:else if angleFiltered.length === 0}
    <div style="font-size:12px;color:var(--muted);text-align:center;padding:12px 0">No {angle} photos yet — add your first one above.</div>
  {:else if angleFiltered.length === 1}
    <div class="single-photo">
      <img src={angleFiltered[0].url} alt="Progress {angle}" />
      <div class="photo-date">{angleFiltered[0].date}</div>
    </div>
  {:else}
    <div class="compare-pickers">
      <select bind:value={compareA}>
        {#each angleFiltered as p}<option value={p.id}>{p.date}</option>{/each}
      </select>
      <span class="vs">vs</span>
      <select bind:value={compareB}>
        {#each angleFiltered as p}<option value={p.id}>{p.date}</option>{/each}
      </select>
    </div>
    {#if photoA && photoB}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="slider-box"
        bind:clientWidth={sliderBoxWidth}
        onpointerdown={() => sliderDragging = true}
        onpointerup={() => sliderDragging = false}
        onpointerleave={() => sliderDragging = false}
        onpointermove={(e) => onSliderMove(e, e.currentTarget)}
      >
        <img src={photoB.url} alt="After ({photoB.date})" class="slide-img" />
        <div class="slide-clip" style="width:{sliderPct}%">
          <img src={photoA.url} alt="Before ({photoA.date})" class="slide-img" style="width:{sliderBoxWidth}px" />
        </div>
        <div class="slide-handle" style="left:{sliderPct}%"></div>
        <div class="slide-label left">{photoA.date}</div>
        <div class="slide-label right">{photoB.date}</div>
      </div>
      <input type="range" min="0" max="100" bind:value={sliderPct} class="slide-range">
    {/if}
  {/if}

  {#if angleFiltered.length > 0}
    <div class="photo-thumbs">
      {#each angleFiltered as p}
        <div class="thumb-wrap">
          <img src={p.url} alt={p.date} class="thumb" />
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <span class="thumb-rm" onclick={() => deletePhoto(p.id, p.storagePath)} role="button">✕</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .angle-tabs{display:flex;gap:6px;margin-bottom:10px}
  .angle-tabs .tab{text-transform:capitalize}
  .photo-add-btn{display:block;text-align:center;cursor:pointer}
  .single-photo{text-align:center;margin-top:10px}
  .single-photo img{max-width:100%;border-radius:12px;max-height:320px;object-fit:contain}
  .photo-date{font-size:11px;color:var(--muted);margin-top:4px}
  .compare-pickers{display:flex;align-items:center;gap:8px;margin-top:10px}
  .compare-pickers select{flex:1}
  .vs{font-size:11px;color:var(--muted)}
  .slider-box{position:relative;margin-top:10px;border-radius:12px;overflow:hidden;aspect-ratio:3/4;max-height:400px;background:#000;touch-action:none}
  .slide-img{width:100%;height:100%;object-fit:cover;display:block}
  .slide-clip{position:absolute;top:0;left:0;height:100%;overflow:hidden}
  .slide-clip img{max-width:none;height:100%;object-fit:cover}
  .slide-handle{position:absolute;top:0;bottom:0;width:3px;background:#fff;transform:translateX(-50%);box-shadow:0 0 6px rgba(0,0,0,.5)}
  .slide-label{position:absolute;bottom:8px;font-size:10px;font-weight:700;color:#fff;background:rgba(0,0,0,.6);padding:3px 7px;border-radius:6px}
  .slide-label.left{left:8px}
  .slide-label.right{right:8px}
  .slide-range{margin-top:8px}
  .photo-thumbs{display:flex;gap:8px;overflow-x:auto;margin-top:10px;padding-bottom:4px}
  .thumb-wrap{position:relative;flex-shrink:0}
  .thumb{width:56px;height:56px;object-fit:cover;border-radius:8px}
  .thumb-rm{position:absolute;top:-4px;right:-4px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer}
</style>
