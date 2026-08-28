const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

// Model FALLBACK CHAIN, tried in order. gemini-flash-latest is the accuracy
// pick for food vision, but its shared free tier is frequently overloaded and
// returns HTTP 503 "This model is currently experiencing high demand" -- with
// no retry and no fallback, a single overloaded response killed the whole
// request and the app told the user "analysis doesn't work / out of tokens".
// So we now (a) retry each model with backoff and (b) fall through to lighter
// models that are far less contended, instead of hard-failing on the first
// hiccup. "-latest" aliases (not pinned versions) so a retired model name
// can't silently break the path (that is exactly what broke gemini-2.5-flash).
const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'];
const MAX_ATTEMPTS_PER_MODEL = 2;

// CORS is required for any Supabase Edge Function called directly from a
// browser: the OPTIONS preflight and the real response both need these.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Overload / rate-limit / transient-server responses are worth retrying (same
// model) or falling through (next model). A retired-model 404 is not worth
// retrying but SHOULD fall through to the next model. Anything else (a real
// 400 bad request, an auth error) fails fast.
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
        // Network-level failure -- retry this model.
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
      if (verdict === 'next-model') break; // stop retrying this model, try the next
      // retry: exponential-ish backoff before the next attempt on this model
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
    // `image` is optional: a user can supply a photo, a free-text description
    // ("grilled chicken thigh, no skin, ~200g"), or both -- at least one is
    // required. Text-only requests skip the inlineData part entirely.
    const { image, description } = await req.json();
    const desc = typeof description === 'string' ? description.trim() : '';
    if (!image && !desc) {
      return new Response(JSON.stringify({ error: 'Provide a photo, a description, or both' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parts: Array<Record<string, unknown>> = [];

    if (image) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const mimeType = image.match(/^data:(image\/\w+);/)?.[1] || 'image/jpeg';

      const prompt = desc
        ? `You are a nutrition expert analyzing a photo of a meal or food item.
Identify what food(s) are in the photo and estimate the nutritional content for the ACTUAL portion size shown (not a generic per-100g figure -- look at the plate/bowl/container size to judge the real quantity).
The user also gave this description of the meal -- treat it as authoritative detail (ingredients, cooking method, portion, anything not obvious from the photo alone) and use it to refine the estimate: "${desc}"
Respond with ONLY valid JSON in exactly this format, no other text, no markdown code fences:
{"name": "short description of the food/meal", "kcal": <number>, "protein_g": <number>, "carbs_g": <number>, "fat_g": <number>, "confidence": "low"|"medium"|"high"}
If you cannot identify any food in the image, respond with:
{"error": "No food detected in this photo"}`
        : `You are a nutrition expert analyzing a photo of a meal or food item.
Identify what food(s) are in the photo and estimate the nutritional content for the ACTUAL portion size shown (not a generic per-100g figure -- look at the plate/bowl/container size to judge the real quantity).
Respond with ONLY valid JSON in exactly this format, no other text, no markdown code fences:
{"name": "short description of the food/meal", "kcal": <number>, "protein_g": <number>, "carbs_g": <number>, "fat_g": <number>, "confidence": "low"|"medium"|"high"}
If you cannot identify any food in the image, respond with:
{"error": "No food detected in this photo"}`;

      parts.push({ text: prompt }, { inlineData: { mimeType, data: base64Data } });
    } else {
      const prompt = `You are a nutrition expert. A user described a meal or food item they ate, with no photo available: "${desc}"
Estimate the nutritional content for the portion size implied by the description (assume a typical/reasonable portion if not specified).
Respond with ONLY valid JSON in exactly this format, no other text, no markdown code fences:
{"name": "short description of the food/meal", "kcal": <number>, "protein_g": <number>, "carbs_g": <number>, "fat_g": <number>, "confidence": "low"|"medium"|"high"}
If the description is too vague or unrelated to food to estimate anything, respond with:
{"error": "Couldn't estimate nutrition from that description -- try adding more detail (ingredients, portion size)"}`;
      parts.push({ text: prompt });
    }

    const gen = await generate(parts);

    // Surface real upstream failures honestly -- these have nothing to do with
    // photo quality. After retries + model fallback all failed, this is a
    // genuine outage, so say so specifically instead of blaming the picture.
    if (!gen.ok) {
      return new Response(JSON.stringify({ error: `Food recognition is temporarily unavailable: ${gen.errMsg}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Gemini occasionally wraps JSON in ```json ... ``` fences despite being
    // told not to (and despite responseMimeType) -- strip those defensively.
    const cleaned = gen.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({ error: 'Could not parse a nutrition estimate from this photo. Try a clearer, well-lit photo of the food.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (parsed.error) {
      return new Response(JSON.stringify({ error: parsed.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      name: parsed.name || 'Unknown food',
      kcal: Number(parsed.kcal) || 0,
      protein_g: Number(parsed.protein_g) || 0,
      carbs_g: Number(parsed.carbs_g) || 0,
      fat_g: Number(parsed.fat_g) || 0,
      confidence: parsed.confidence || 'medium',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
