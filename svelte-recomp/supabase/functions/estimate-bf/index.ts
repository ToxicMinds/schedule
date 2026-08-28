const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

// Model FALLBACK CHAIN, tried in order (see estimate-food for the full
// rationale): the primary vision model's free tier is frequently overloaded
// (HTTP 503 "high demand"), so retry + fall through to lighter models instead
// of hard-failing. This matters doubly here because the retroactive backfill
// fires many requests in a row, and a single transient overload used to abort.
const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'];
const MAX_ATTEMPTS_PER_MODEL = 2;

// CORS: this function is called directly from the browser via
// supabase.functions.invoke, which sends Content-Type + Authorization headers
// and therefore triggers a preflight. Without an OPTIONS handler + these
// headers the browser silently blocks every call (it worked via curl, which is
// exactly how this bug hid). Both the preflight and the real response need them.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function classify(status: number, msg: string): 'retry' | 'next-model' | 'fatal' {
  const m = (msg || '').toLowerCase();
  const transient =
    status === 429 || status === 500 || status === 503 ||
    m.includes('high demand') || m.includes('overloaded') ||
    m.includes('unavailable') || m.includes('try again') ||
    m.includes('exhaust') || m.includes('rate limit');
  if (transient) return 'retry';
  if (status === 404 || m.includes('not found') || m.includes('not supported')) return 'next-model';
  return 'fatal';
}

async function generate(
  parts: Array<Record<string, unknown>>,
): Promise<{ ok: true; text: string } | { ok: false; errMsg: string; status: number }> {
  let lastErr = 'temporarily unavailable';
  let lastStatus = 0;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      let response: Response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { responseMimeType: 'application/json' },
            }),
          },
        );
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        lastStatus = 0;
        await sleep(400 * (attempt + 1));
        continue;
      }
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        const text = (result?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        return { ok: true, text };
      }
      const msg = result?.error?.message || `Gemini API error (HTTP ${response.status})`;
      lastErr = msg;
      lastStatus = response.status;
      const verdict = classify(response.status, msg);
      if (verdict === 'fatal') return { ok: false, errMsg: msg, status: response.status };
      if (verdict === 'next-model') break;
      await sleep(500 * (attempt + 1));
    }
  }
  return { ok: false, errMsg: lastErr, status: lastStatus };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const { image, gender } = await req.json();
    if (!image || !gender) {
      return new Response(JSON.stringify({ error: 'Missing image or gender' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = image.match(/^data:(image\/\w+);/)?.[1] || 'image/jpeg';

    const prompt = `You are a physique and body-composition coach analysing a single photo.
Gender: ${gender}
Judge from visible muscle definition, muscularity, vascularity, body shape and fat distribution.

Return ONLY minified JSON (no markdown, no prose) in exactly this shape:
{"percent": <number, estimated body-fat % 3-60>,
 "regions": [
   {"key":"shoulders","label":"Shoulders","score":<0-100>,"note":"<=6 words"},
   {"key":"chest","label":"Chest","score":<0-100>,"note":"<=6 words"},
   {"key":"arms","label":"Arms","score":<0-100>,"note":"<=6 words"},
   {"key":"back","label":"Back","score":<0-100>,"note":"<=6 words"},
   {"key":"core","label":"Core","score":<0-100>,"note":"<=6 words"},
   {"key":"legs","label":"Legs","score":<0-100>,"note":"<=6 words"}
 ],
 "summary":"<one <=14-word coaching line>"}
"score" = how lean/developed that region looks (higher is better). If a region is not visible in the photo, still give your best estimate. Be realistic and consistent.`;

    const gen = await generate([{ text: prompt }, { inlineData: { mimeType, data: base64Data } }]);

    if (!gen.ok) {
      return new Response(JSON.stringify({ error: `Body analysis is temporarily unavailable: ${gen.errMsg}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const text = gen.text;

    // Preferred path: structured JSON (bf% + per-region breakdown). Parse
    // defensively; fall back to legacy number-only behaviour so it never hard-fails.
    let parsed: any = null;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
    } catch { /* not JSON — handled below */ }

    if (parsed && typeof parsed.percent === 'number') {
      const percent = parsed.percent;
      const regions = Array.isArray(parsed.regions)
        ? parsed.regions
            .filter((r: any) => r && typeof r.score === 'number')
            .map((r: any) => ({
              key: String(r.key || r.label || '').toLowerCase().slice(0, 20),
              label: String(r.label || r.key || '').slice(0, 24),
              score: Math.max(0, Math.min(100, Math.round(r.score))),
              note: String(r.note || '').slice(0, 60),
            }))
        : [];
      if (isNaN(percent) || percent < 3 || percent > 60) {
        return new Response(JSON.stringify({ estimate: 'Could not estimate', regions, summary: parsed.summary || null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        estimate: `${percent.toFixed(1)}%`,
        percent,
        regions,
        summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 160) : null,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Legacy fallback: a bare number in the text.
    const percent = parseFloat(text);
    if (isNaN(percent) || percent < 3 || percent > 60) {
      return new Response(JSON.stringify({ estimate: text || 'Could not estimate', regions: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ estimate: `${percent.toFixed(1)}%`, percent, regions: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
