const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// gemini-2.5-flash was retired by Google ("no longer available to new
// users") -- every call silently 404'd and got swallowed into a generic
// "take a better photo" message, hiding the real cause entirely. Using
// the "-latest" alias avoids repeating this: Google keeps it pointed at
// whichever current model is actually being served, instead of a pinned
// name that can be retired later.
const MODEL = 'gemini-flash-lite-latest';

// CORS is required for any Supabase Edge Function called directly from
// a browser (see the estimate-bf function -- this exact omission caused
// a real bug there: the function worked perfectly when tested via curl,
// but every browser call was silently blocked by a missing preflight
// response, since CORS is a browser-only enforcement mechanism). Both
// the OPTIONS preflight and the real response need these headers.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const { image } = await req.json();
    if (!image) {
      return new Response(JSON.stringify({ error: 'Missing image' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = image.match(/^data:(image\/\w+);/)?.[1] || 'image/jpeg';

    const prompt = `You are a nutrition expert analyzing a photo of a meal or food item.
Identify what food(s) are in the photo and estimate the nutritional content for the ACTUAL portion size shown (not a generic per-100g figure -- look at the plate/bowl/container size to judge the real quantity).
Respond with ONLY valid JSON in exactly this format, no other text, no markdown code fences:
{"name": "short description of the food/meal", "kcal": <number>, "protein_g": <number>, "carbs_g": <number>, "fat_g": <number>, "confidence": "low"|"medium"|"high"}
If you cannot identify any food in the image, respond with:
{"error": "No food detected in this photo"}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64Data } },
            ],
          }],
        }),
      }
    );

    const result = await response.json();

    // Surface real upstream failures (quota exceeded, model deprecated,
    // transient overload) as an honest, specific message -- these have
    // nothing to do with photo quality, and silently relabeling them as
    // "take a better picture" hid a real production outage before.
    if (!response.ok) {
      const upstreamMsg = result?.error?.message || `Gemini API error (HTTP ${response.status})`;
      return new Response(JSON.stringify({ error: `Food recognition is temporarily unavailable: ${upstreamMsg}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const text = (result?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    // Gemini occasionally wraps JSON in ```json ... ``` fences despite
    // being told not to -- strip those defensively before parsing.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

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
