<script lang="ts">
  import { signIn, signUp } from '$lib/stores/user';

  let mode = $state<'login' | 'signup'>('login');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let err = $state('');

  async function submit() {
    err = '';
    if (!email.trim() || !password) { err = 'Enter an email and password.'; return; }
    busy = true;
    try {
      if (mode === 'login') await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
    } catch (e: any) {
      err = e?.message || 'Something went wrong.';
    } finally {
      busy = false;
    }
  }
</script>

<div id="auth-gate">
  <div class="auth-box">
    <div class="auth-logo">RecompOS</div>
    <div class="auth-sub">Sign in to sync your data across all your devices</div>

    {#if err}<div class="auth-err">{err}</div>{/if}

    <label class="flbl" for="auth-email">Email</label>
    <input id="auth-email" type="email" autocomplete="email" bind:value={email} placeholder="you@example.com" style="margin-bottom:12px">

    <label class="flbl" for="auth-pass">Password</label>
    <input id="auth-pass" type="password" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} bind:value={password} placeholder="••••••••" style="margin-bottom:16px">

    <button class="btn bp bfl" onclick={submit} disabled={busy}>
      {busy ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Create Account'}
    </button>

    <button class="auth-switch" onclick={() => { mode = mode === 'login' ? 'signup' : 'login'; err = ''; }}>
      {mode === 'login' ? "New here? Create an account" : 'Already have an account? Log in'}
    </button>
  </div>
</div>

<style>
  #auth-gate{display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:24px}
  .auth-box{width:100%;max-width:340px;background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:28px 22px;box-shadow:var(--shadow-sm)}
  .auth-logo{font-size:24px;font-weight:800;letter-spacing:-.5px;background:var(--grad-amber);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;text-align:center;margin-bottom:6px}
  .auth-sub{font-size:12px;color:var(--muted);text-align:center;margin-bottom:20px}
  .auth-err{background:var(--rb);color:var(--red);font-size:12px;font-weight:600;padding:8px 10px;border-radius:10px;margin-bottom:12px}
  .auth-switch{display:block;width:100%;text-align:center;background:none;border:none;color:var(--amber);font-size:12px;font-weight:600;margin-top:14px;cursor:pointer}
</style>
