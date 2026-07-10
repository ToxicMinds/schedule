t GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL = 'gemini-flash-lite-latest';

// Required for any Supabase Edge Function called directly from a browser
// (fetch/supabase.functions.invoke from a web app is a cross-origin
// request): the browser sends a CORS preflight OPTIONS request first,
// and without these headers on BOTH the OPTIONS response and the real
// response, the browser blocks the request entirely before it ever
// reaches this function -- which is exactly what was happening here
// (confirmed via real browser testing: "No 'Access-Control-Allow-Origin'
// header is present on the requested resource"). A raw curl/server-side
// call works fine regardless, since CORS is a browser-only mechanism --
// which is why this bug was easy to miss without testing through an
// actual browser.
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
    const { image, gender } = await req.json();
    if (!image || !gender) {
      return new Response(JSON.stringify({ error: 'Missing image or gender' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = image.match(/^data:(image\/\w+);/)?.[1] || 'image/jpeg';

    const prompt = `You are a body composition expert. Estimate the body fat percentage of the person in this photo.
Gender: ${gender}
Analyze based on visible muscle definition, vascularity, body shape, and fat distribution.
Respond with ONLY a number (the estimated body fat percentage), e.g. "15.2". Be realistic.`;

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
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    const percent = parseFloat(text);
    if (isNaN(percent) || percent < 3 || percent > 60) {
      return new Response(JSON.stringify({ estimate: text || 'Could not estimate' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ estimate: `${percent.toFixed(1)}%`, percent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
