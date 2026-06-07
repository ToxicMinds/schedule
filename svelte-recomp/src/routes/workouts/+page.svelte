<script lang="ts">
  import { workoutSchedule, workoutSessions, buildGroups } from '$lib/data/workouts';
  import VideoEmbed from '$lib/components/VideoEmbed.svelte';
  import Modal from '$lib/components/Modal.svelte';

  let sessionKey = $state<string | null>(null);
  let builderMode = $state(false);
  let selectedGroup = $state<string | null>(null);
  let weekOffset = $state(0);

  function getWeekDates(offset: number) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay() + 1 + offset * 7);
    return workoutSchedule.map((s, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return { ...s, date: d };
    });
  }

  const weekDays = $derived(getWeekDates(weekOffset));

  function closeModal() { sessionKey = null; }

  const modalOpen = $derived(sessionKey !== null);
</script>

<div class="page-hd">Workouts</div>
<div class="page-sub">Gym · Badminton · Recovery</div>

<div class="week-tabs">
  <button class="wtab" class:on={weekOffset === 0} onclick={() => weekOffset = 0}>This Week</button>
  <button class="wtab" class:on={weekOffset === 1} onclick={() => weekOffset = 1}>Next Week</button>
</div>

{#each weekDays as day}
  <div class="card" style="padding:10px 12px">
    <div class="flex jb ac" style="margin-bottom:4px">
      <div style="font-size:12px;color:var(--muted);font-weight:600">{day.date.toLocaleDateString('en-US', { month:'short', day:'numeric' })}</div>
      <div style="font-size:12px;font-weight:700">{day.day}</div>
    </div>
    {#if day.sess}
      <div style="font-size:13px;font-weight:600;color:var(--amber);margin-bottom:2px">{day.note}</div>
      <div style="font-size:11px;color:var(--muted)">{workoutSessions[day.sess]?.duration} &middot; {workoutSessions[day.sess]?.focus}</div>
    {:else}
      <div style="font-size:13px;color:var(--muted)">{day.note}</div>
    {/if}
  </div>
{/each}

<h3>Session Details</h3>
{#each Object.entries(workoutSessions) as [key, sess]}
  <div class="card" style="padding:12px;cursor:pointer" onclick={() => sessionKey = key}>
    <div class="flex jb ac">
      <div>
        <div style="font-weight:700;color:#fff;font-size:15px">{sess.name}</div>
        <div style="font-size:11px;color:var(--muted)">{sess.duration} &middot; {sess.focus}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" stroke="var(--muted)" fill="none" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </div>
  </div>
{/each}

<h3>Quick Builder</h3>
<button class="btn bg_ bfl" onclick={() => builderMode = !builderMode}>
  {builderMode ? 'Close Builder' : 'Build Custom Session'}
</button>

{#if builderMode}
  <div id="builder-muscles">
    {#each Object.entries(buildGroups) as [key, g]}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="muscle-btn" class:on={selectedGroup === key} onclick={() => selectedGroup = selectedGroup === key ? null : key}>
        <div class="muscle-icon">{g.icon}</div>
        <div class="muscle-name">{g.name}</div>
        <div class="muscle-count">{g.exercises.length} exercises</div>
      </div>
    {/each}
  </div>
  {#if selectedGroup && buildGroups[selectedGroup]}
    {#each buildGroups[selectedGroup].exercises as ex}
      <div class="ex-card">
        <div class="ex-name">{ex.name}</div>
        <div class="ex-muscle">{ex.muscle}</div>
        <div class="ex-sets-row">
          <div class="ex-set-box"><div class="label">W1</div><div class="value">{ex.sets}</div></div>
          <div class="ex-set-box w2"><div class="label">Rest</div><div class="value">{ex.rest}</div></div>
        </div>
        {#if ex.tip}
          <div class="ex-tip">{ex.tip}</div>
        {/if}
        <VideoEmbed vid={ex.vid} />
      </div>
    {/each}
  {/if}
{/if}

{#if sessionKey && workoutSessions[sessionKey]}
  <Modal open={modalOpen} onclose={() => sessionKey = null}>
    <div style="font-size:18px;font-weight:700;color:#fff;margin-bottom:4px">{workoutSessions[sessionKey].name}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">{workoutSessions[sessionKey].duration}</div>
    {#each workoutSessions[sessionKey].exercises as ex}
      <div class="ex-card" style="margin-bottom:10px;padding:12px">
        <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:2px">{ex.name}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">{ex.muscle}</div>
        <div class="ex-sets-row">
          <div class="ex-set-box"><div class="label">W1</div><div class="value">{ex.w1}</div></div>
          <div class="ex-set-box"><div class="label">W2</div><div class="value">{ex.w2}</div></div>
          <div class="ex-set-box"><div class="label">Rest</div><div class="value">{ex.rest}</div></div>
        </div>
        <div class="ex-tip">{ex.tip}</div>
        <VideoEmbed vid={ex.vid} />
      </div>
    {/each}
  </Modal>
{/if}

<style>
  #builder-muscles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
  .muscle-btn{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;padding:18px 12px;border:1px solid var(--border);background:var(--bg2);border-radius:12px;cursor:pointer;transition:all .15s}
  .muscle-btn:active{border-color:var(--amber)}
  .muscle-btn.on{border-color:var(--green);background:var(--gb)}
  .muscle-icon{font-size:32px}
  .muscle-name{font-size:14px;font-weight:700;color:#fff}
  .muscle-count{font-size:11px;color:var(--muted)}
</style>
