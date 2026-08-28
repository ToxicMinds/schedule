// Body-photo analysis, shared by every entry point.
//
// THE FIX THIS ENABLES: body analysis used to live in two disconnected halves.
// Progress Photos (Storage + before/after slider) never ran any AI, and the
// "Photo Estimate" card ran estimate-bf but (a) threw the photo away and (b)
// only wrote a physique_snapshots row -- it NEVER wrote a body_fat `tracks`
// entry, so the AI-estimated body-fat % never reached the composition / TDEE
// engine that turns bf% + weight into lean mass and calorie targets.
//
// This module is the single path both flows now call. It:
//   1. calls estimate-bf,
//   2. saves a physique_snapshot (optionally linked to the Storage photo it
//      came from, so the retroactive backfill can dedupe on storage_path), and
//   3. writes a body_fat `tracks` row -- which is what makes a photo actually
//      "do the TDEE analysis" the way a typed measurement does.

import { supabase } from '$lib/db/client';
import { upsertRecord } from '$lib/stores/sync';
import { todayYmd } from '$lib/date';

export type Region = { key: string; label: string; score: number; note: string };

export interface AnalyzeResult {
  estimate: string;
  percent: number | null;
  regions: Region[];
  summary: string | null;
  error?: string;
}

export type SnapshotSource = 'manual' | 'progress' | 'backfill';

/** Call the estimate-bf edge function on a data-URL image. */
export async function analyzeBodyPhoto(imageDataUrl: string, gender: string): Promise<AnalyzeResult> {
  const { data, error } = await supabase.functions.invoke('estimate-bf', {
    body: { image: imageDataUrl, gender },
  });
  if (error) return { estimate: 'Analysis failed', percent: null, regions: [], summary: null, error: error.message || String(error) };
  if (data?.error) return { estimate: 'Analysis failed', percent: null, regions: [], summary: null, error: data.error };
  const percent = typeof data?.percent === 'number' ? data.percent : null;
  return {
    estimate: data?.estimate ?? 'Could not estimate',
    percent,
    regions: Array.isArray(data?.regions) ? data.regions : [],
    summary: data?.summary ?? null,
  };
}

export interface SaveSnapshotArgs {
  uid: string;
  date?: string;
  percent: number;
  regions: Region[];
  summary: string | null;
  /** Storage object path of the progress photo, when this came from one. */
  storagePath?: string | null;
  source: SnapshotSource;
}

/**
 * Persist an analysis: a physique_snapshots row PLUS a body_fat track. The
 * track is what feeds recomp/TDEE; without it a photo estimate is a dead end.
 * Uses a deterministic track id per date so re-analysis never duplicates the
 * day's body-fat reading.
 */
export async function saveAnalysis(args: SaveSnapshotArgs): Promise<{ ok: boolean; error?: string }> {
  const date = args.date || todayYmd();
  try {
    const row: Record<string, unknown> = {
      user_id: args.uid,
      date,
      bf_percent: args.percent,
      regions: args.regions,
      summary: args.summary,
      source: args.source,
    };
    if (args.storagePath) row.storage_path = args.storagePath;

    let { error: snapErr } = await supabase.from('physique_snapshots').insert(row);
    // Resilience: the storage_path/source columns arrive in a migration. If the
    // app is deployed before that migration lands, Postgres/PostgREST rejects
    // the unknown columns (42703 / PGRST204). Rather than fail the whole save,
    // retry with just the original columns -- the snapshot + body_fat track
    // still persist; only photo-linking/dedupe is degraded until the migration.
    if (snapErr && /column|schema cache|storage_path|source/i.test(snapErr.message || '')) {
      const legacy = { user_id: args.uid, date, bf_percent: args.percent, regions: args.regions, summary: args.summary };
      ({ error: snapErr } = await supabase.from('physique_snapshots').insert(legacy));
    }
    if (snapErr) throw snapErr;

    // The half that was missing: make the AI reading a real body_fat measurement
    // so composition (lean/fat split) and the goal/TDEE projection pick it up.
    await upsertRecord('tracks', {
      id: `bfphoto_${date}`,
      user_id: args.uid,
      date,
      name: 'body_fat',
      value: parseFloat(args.percent.toFixed(1)),
      unit: '%',
      created_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** storage_paths that already have a snapshot, so a backfill can skip them. */
export async function analyzedStoragePaths(uid: string): Promise<Set<string>> {
  const done = new Set<string>();
  const { data } = await supabase
    .from('physique_snapshots')
    .select('storage_path')
    .eq('user_id', uid)
    .not('storage_path', 'is', null);
  for (const r of data || []) if (r.storage_path) done.add(r.storage_path as string);
  return done;
}
