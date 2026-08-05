const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL = 'gemini-2.5-flash';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { image, gender } = await req.json();
    if (!image || !gender) {
      return new Response(JSON.stringify({ error: 'Missing image or gender' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
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
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    );

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    // Preferred path: the model returns structured JSON (bf% + per-region
    // breakdown). Parse it defensively; fall back to the legacy number-only
    // behaviour if anything is off, so the estimate never hard-fails.
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
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        estimate: `${percent.toFixed(1)}%`,
        percent,
        regions,
        summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 160) : null,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Legacy fallback: a bare number in the text.
    const percent = parseFloat(text);
    if (isNaN(percent) || percent < 3 || percent > 60) {
      return new Response(JSON.stringify({ estimate: text || 'Could not estimate', regions: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ estimate: `${percent.toFixed(1)}%`, percent, regions: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
