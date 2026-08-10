// ── IN-APP APK UPDATER ──────────────────────────────────────────────────────
// A native update (a new plugin, a new permission) means a new APK. Without
// this, that meant opening a browser, downloading a file and hunting for it in
// a file manager. With it, it's a single "Update" tap inside the app: we hand
// the release APK to Android's installer (see ApkInstallerPlugin), which does a
// true in-place update because every build is signed with the same key.
//
// HOW WE KNOW AN UPDATE EXISTS: the app carries the build number it EXPECTS to
// be running (LATEST_NATIVE_BUILD). We read the build number actually installed
// via @capacitor/app. If installed < expected, a newer APK is out and we offer
// it. Bump LATEST_NATIVE_BUILD in lockstep with versionCode in
// android/app/build.gradle whenever a native change ships.

import { writable } from 'svelte/store';

// Keep this EQUAL to `versionCode` in android/app/build.gradle. When a native
// change ships, bump both together — that's the whole trigger for the prompt.
export const LATEST_NATIVE_BUILD = 2;

// The stable, rolling download link the CI release always publishes to.
export const APK_URL =
  'https://github.com/ToxicMinds/schedule/releases/download/recompos-app-latest/recompos.apk';

export interface UpdateState {
  available: boolean;
  installedBuild: number | null;
  latestBuild: number;
  busy: boolean;
  error: string | null;
}

export const updateState = writable<UpdateState>({
  available: false,
  installedBuild: null,
  latestBuild: LATEST_NATIVE_BUILD,
  busy: false,
  error: null,
});

// Resolve the native bits lazily (same pattern as haptics/Health Connect) so
// nothing touches the Capacitor bridge during prerender.
async function nativeBits(): Promise<{
  isNative: boolean;
  getBuild: () => Promise<number | null>;
  install: (url: string) => Promise<void>;
} | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    const isNative = !!Capacitor?.isNativePlatform?.();
    if (!isNative) return { isNative: false, getBuild: async () => null, install: async () => {} };

    const { App } = await import('@capacitor/app');
    const ApkInstaller = registerPlugin<{
      installFromUrl(options: { url: string }): Promise<void>;
    }>('ApkInstaller');

    return {
      isNative: true,
      getBuild: async () => {
        try {
          const info = await App.getInfo();
          const n = parseInt(String(info.build), 10);
          return Number.isFinite(n) ? n : null;
        } catch {
          return null;
        }
      },
      install: (url: string) => ApkInstaller.installFromUrl({ url }),
    };
  } catch {
    return null;
  }
}

/** Check whether a newer native build is available. Safe to call anywhere; it
 *  no-ops off-device. Updates the `updateState` store. */
export async function checkForNativeUpdate(): Promise<void> {
  const bits = await nativeBits();
  if (!bits || !bits.isNative) return;
  const installedBuild = await bits.getBuild();
  updateState.update((s) => ({
    ...s,
    installedBuild,
    latestBuild: LATEST_NATIVE_BUILD,
    available: installedBuild != null && installedBuild < LATEST_NATIVE_BUILD,
  }));
}

/** Download + launch the installer for the latest APK. One tap for the user;
 *  Android takes over from there (and asks once to allow installs). */
export async function installNativeUpdate(): Promise<void> {
  const bits = await nativeBits();
  if (!bits || !bits.isNative) return;
  updateState.update((s) => ({ ...s, busy: true, error: null }));
  try {
    await bits.install(APK_URL);
    // Control now passes to Android's installer UI; leave busy=true so the
    // button stays disabled behind the system prompt.
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    updateState.update((s) => ({ ...s, busy: false, error: msg }));
  }
}
