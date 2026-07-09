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
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ estimate: `${percent.toFixed(1)}%`, percent }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
