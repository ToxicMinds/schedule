<script lang="ts">
  import { userId } from '$lib/stores/user';
  import { syncStatus } from '$lib/stores/sync';
  import { upsertRecord } from '$lib/stores/sync';
  import db from '$lib/db/dexie';

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  // — Measurements —
  let gender = $state<'male' | 'female'>('male');
  let height = $state('');
  let neck = $state('');
  let waist = $state('');
  let hip = $state('');
  let bodyFat = $state<number | null>(null);
  let lbm = $state<number | null>(null);

  function calcNavy() {
    const h = parseFloat(height);
    const n = parseFloat(neck);
    const w = parseFloat(waist);
    const hp = parseFloat(hip);
    if (!h || !n || !w || h < 100 || h > 250) return;
    if (gender === 'female' && (!hp || hp < 40)) return;
    if (n < 20 || w < 40 || (gender === 'female' && hp < 40)) return;

    let bf: number;
    if (gender === 'male') {
      const log = Math.log10(w - n) * 0.19077;
      const logH = Math.log10(h) * 0.15456;
      bf = 495 / (1.0324 - log + logH) - 450;
    } else {
      const log = Math.log10(w + hp - n) * 0.35004;
      const logH = Math.log10(h) * 0.22100;
      bf = 495 / (1.29579 - log + logH) - 450;
    }
    bodyFat = Math.max(3, Math.min(60, parseFloat(bf.toFixed(1))));
    lbm = null;
  }

  // — Weight & LBM from latest log —
  let latestWeight = $state<number | null>(null);

  async function loadWeight() {
    if (!uid) return;
    const data = await db.table('weights')
      .where('user_id').equals(uid)
      .reverse().sortBy('date');
    if (data.length > 0) latestWeight = data[data.length - 1].weight;
  }

  $effect(() => { if (uid) loadWeight(); });
  $effect(() => { if ($syncStatus === 'synced' && uid) loadWeight(); });

  $effect(() => {
    if (latestWeight && bodyFat) {
      lbm = parseFloat((latestWeight * (1 - bodyFat / 100)).toFixed(1));
    }
  });

  // — Goal scenarios —
  type Scenario = { label: string; bf: string; desc: string };
  const scenarios: Scenario[] = [
    { label: 'Lean', bf: '10', desc: 'Athlete — visible abs, vascular' },
    { label: 'Fit', bf: '14', desc: 'Fit — defined, lean physique' },
    { label: 'Healthy', bf: '18', desc: 'Healthy — good shape, comfortable' },
  ];
  const femaleScenarios: Scenario[] = [
    { label: 'Lean', bf: '18', desc: 'Athlete — very defined' },
    { label: 'Fit', bf: '23', desc: 'Fit — toned, athletic' },
    { label: 'Healthy', bf: '28', desc: 'Healthy — good shape' },
  ];
  const activeScenarios = $derived(gender === 'male' ? scenarios : femaleScenarios);
  const goalWeight = $derived.by(() => {
    if (!lbm || !bodyFat) return null;
    return activeScenarios.map((s) => ({
      label: s.label, desc: s.desc,
      bf: parseInt(s.bf),
      weight: parseFloat((lbm / (1 - parseInt(s.bf) / 100)).toFixed(1)),
      lose: latestWeight ? parseFloat((latestWeight - lbm / (1 - parseInt(s.bf) / 100)).toFixed(1)) : 0,
    }));
  });

  // — Save measurement —
  async function saveMeasurement() {
    if (!uid || !bodyFat) return;
    try {
      await upsertRecord('tracks', {
        id: crypto.randomUUID(),
        user_id: uid,
        date: new Date().toISOString().slice(0, 10),
        name: 'body_fat',
        value: bodyFat,
        unit: '%',
        created_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Save measurement failed:', e); }
  }

  // — Photo upload —
  let bfResult = $state<string | null>(null);
  let analyzing = $state(false);
  let photoFile = $state<string | null>(null);

  function onPhoto(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      photoFile = reader.result as string;
      analyzePhoto();
    };
    reader.readAsDataURL(file);
  }

  async function analyzePhoto() {
    if (!photoFile || !uid) return;
    analyzing = true;
    bfResult = null;
    try {
      const { supabase } = await import('$lib/db/client');
      const { data, error } = await supabase.functions.invoke('estimate-bf', {
        body: { image: photoFile, gender },
      });
      if (error) throw error;
      bfResult = data?.estimate ?? 'Could not estimate';
    } catch (e) {
      console.error('Photo analysis failed:', e);
      bfResult = 'Photo analysis failed — edge function not deployed yet';
    } finally {
      analyzing = false;
    }
  }
</script>

<div class="page-hd">Plan</div>
<div class="page-sub">Body composition & goals</div>

{#if bodyFat !== null}
  <div class="srow">
    <div class="scard"><span class="sval">{bodyFat}%</span><span class="slbl">Body Fat</span></div>
    <div class="scard"><span class="sval">{lbm ?? '--'} kg</span><span class="slbl">Lean Mass</span></div>
    <div class="scard"><span class="sval">{latestWeight ?? '--'} kg</span><span class="slbl">Weight</span></div>
  </div>
{/if}

<div class="card">
  <div class="card-lbl">Body Measurements</div>
  <div class="flex gap2" style="margin-bottom:10px">
    <button class="tab {gender === 'male' ? 'on' : ''}" onclick={() => { gender = 'male'; bodyFat = null; }}>Male</button>
    <button class="tab {gender === 'female' ? 'on' : ''}" onclick={() => { gender = 'female'; bodyFat = null; }}>Female</button>
  </div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="plan-height">Height (cm)</label>
      <input id="plan-height" type="number" bind:value={height} placeholder="180" oninput={calcNavy}>
    </div>
    <div class="f1">
      <label class="flbl" for="plan-neck">Neck (cm)</label>
      <input id="plan-neck" type="number" step="0.5" bind:value={neck} placeholder="40" oninput={calcNavy}>
    </div>
  </div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="plan-waist">Waist (cm)</label>
      <input id="plan-waist" type="number" step="0.5" bind:value={waist} placeholder="95" oninput={calcNavy}>
    </div>
    {#if gender === 'female'}
      <div class="f1">
        <label class="flbl" for="plan-hip">Hip (cm)</label>
        <input id="plan-hip" type="number" step="0.5" bind:value={hip} placeholder="100" oninput={calcNavy}>
      </div>
    {/if}
  </div>
  {#if bodyFat !== null}
    <button class="btn bp bfl" onclick={saveMeasurement}>Save {bodyFat}%</button>
  {/if}
</div>

{#if goalWeight}
  <div class="card">
    <div class="card-lbl">Goal Projections</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">
      Based on {lbm} kg lean mass at {bodyFat}% body fat
    </div>
    {#each goalWeight as g}
      <div class="gi" style="border-color:var(--border)">
        <div style="flex:1">
          <div style="font-weight:700;color:#fff;font-size:14px">{g.label} — {g.weight} kg</div>
          <div style="font-size:11px;color:var(--muted)">{g.desc} ({g.bf}% BF)</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:700;color:var(--amber)">{g.weight} kg</div>
          {#if g.lose > 0}
            <div style="font-size:11px;color:var(--red)">{g.lose} kg to lose</div>
          {:else}
            <div style="font-size:11px;color:var(--green)">Achieved ✓</div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

<div class="card">
  <div class="card-lbl">Photo Estimate (Gemini Vision)</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:10px">
    Upload a front/side photo for AI body fat estimation
  </div>
  {#if !photoFile}
    <label class="btn bg_ bfl" style="text-align:center;cursor:pointer">
      Upload Photo
      <input type="file" accept="image/*" capture="environment" onchange={onPhoto} style="display:none">
    </label>
  {:else}
    <div class="chart-box">
      <img src={photoFile} alt="Uploaded" style="width:100%;border-radius:6px">
    </div>
    {#if analyzing}
      <div style="color:var(--muted);font-size:13px;text-align:center;margin:8px 0">Analyzing...</div>
    {:else if bfResult}
      <div class="alert as">
        <b>BF% Estimate</b>
        {bfResult}
      </div>
    {/if}
  {/if}
</div>
