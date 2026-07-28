// Generate a recipe on demand, to the user's own spec.
//
// WHY THIS EXISTS: the app shipped a hardcoded array of 19 recipes in
// src/lib/data/recipes.ts. But the app is online by definition (the APK is a
// thin shell that loads the live site), so a frozen list was never a technical
// constraint — it just meant the same 19 meals forever, none of which adapt to
// what's in your fridge, how much time you have tonight, or the protein you
// still need to hit today. This returns a fresh recipe built around the user's
// ACTUAL macro gap and constraints, in the EXACT same shape as the static
// recipes, so it renders through the existing recipe modal with no UI rework.
//
// Same Gemini + CORS pattern as estimate-food (see that file for why the CORS
// headers are mandatory for browser-invoked edge functions).
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL = 'gemini-flash-latest';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Asking for structured output natively is far more reliable than begging for
// JSON in the prompt and then stripping code fences off the answer.
const RECIPE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    e: { type: 'STRING', description: 'A single emoji representing the dish' },
    t: { type: 'INTEGER', description: 'Total time in minutes' },
    k: { type: 'INTEGER', description: 'kcal PER PORTION' },
    p: { type: 'INTEGER', description: 'protein grams PER PORTION' },
    c: { type: 'INTEGER', description: 'carb grams PER PORTION' },
    f: { type: 'INTEGER', description: 'fat grams PER PORTION' },
    batch: { type: 'INTEGER', description: 'How many portions the recipe makes' },
    desc: { type: 'STRING', description: 'One appetising sentence' },
    ing: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          n: { type: 'STRING', description: 'Ingredient name' },
          a: { type: 'STRING', description: 'Amount for the WHOLE batch, e.g. "800g"' },
          cat: { type: 'STRING', description: 'One of: protein, veg, dairy, dry' },
        },
        required: ['n', 'a', 'cat'],
      },
    },
    prep: { type: 'ARRAY', items: { type: 'STRING' } },
    steps: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Stovetop/oven method' },
    instantPot: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Instant Pot method' },
    kid: { type: 'BOOLEAN' },
    coachNote: {
      type: 'STRING',
      description: 'One sentence on how this fits the stated macro goal',
    },
  },
  required: ['name', 'e', 't', 'k', 'p', 'c', 'f', 'batch', 'desc', 'ing', 'prep', 'steps', 'instantPot'],
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const request = typeof body.request === 'string' ? body.request.trim() : '';
    const proteinTarget = Number(body.proteinTarget) || null;
    const kcalTarget = Number(body.kcalTarget) || null;
    const proteinSoFar = Number(body.proteinSoFar) || 0;
    const kcalSoFar = Number(body.kcalSoFar) || 0;
    const avoid: string[] = Array.isArray(body.avoid) ? body.avoid.slice(0, 40) : [];

    if (!request) {
      return new Response(JSON.stringify({ error: 'Tell me what you feel like eating.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The macro gap is the whole point: a recipe that ignores what you've
    // already eaten today is just a recipe, not a coach.
    const gapLines: string[] = [];
    if (proteinTarget) {
      const gap = Math.max(0, Math.round(proteinTarget - proteinSoFar));
      gapLines.push(
        `The user still needs about ${gap}g of protein today (target ${proteinTarget}g, ${Math.round(proteinSoFar)}g eaten). Design the portion so ONE serving makes a serious dent in that gap.`
      );
    }
    if (kcalTarget) {
      const gap = Math.round(kcalTarget - kcalSoFar);
      gapLines.push(
        gap > 0
          ? `They have about ${gap} kcal left in today's budget (target ${kcalTarget}, ${Math.round(kcalSoFar)} eaten). A single portion must fit comfortably inside that.`
          : `They have already met today's ${kcalTarget} kcal budget, so keep the portion genuinely light.`
      );
    }

    const prompt = `You are a body-recomposition chef. Create ONE recipe for someone in a calorie deficit who lifts weights — high protein, high satiety, real food, genuinely delicious. Not diet food.

WHAT THEY ASKED FOR: "${request}"

${gapLines.join('\n')}

HARD RULES:
- Macros (k, p, c, f) are PER PORTION, not for the whole batch. They must be arithmetically consistent with the ingredients divided by "batch". Protein should be a high share of calories.
- "ing" amounts are for the WHOLE batch. Every ingredient's "cat" must be exactly one of: protein, veg, dairy, dry.
- Give BOTH methods: "steps" (stovetop/oven) and "instantPot" (pressure cooker). If the dish genuinely cannot be pressure-cooked, use the instantPot array to explain how to adapt it using SAUTÉ mode instead — never leave it empty.
- "prep" is the mise-en-place done before cooking starts.
- Steps must be specific and followable: real times, real temperatures, real pan sizes. "Cook until done" is useless.
- Respect any allergy, dislike, equipment or time constraint stated in the request.
${avoid.length ? `- They have recently eaten these, so make it clearly different: ${avoid.join(', ')}.` : ''}
- Set "kid": true only if a small child would happily eat it.
- "coachNote": one sentence on how this serves their goal.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RECIPE_SCHEMA,
            temperature: 1.0, // variety is the entire point — don't return the same dish every time
          },
        }),
      }
    );

    const result = await response.json();

    // Surface real upstream failures honestly (quota, model retired, overload)
    // rather than blaming the user's request — see estimate-food for the
    // production outage this style of masking previously hid.
    if (!response.ok) {
      const upstreamMsg = result?.error?.message || `Gemini API error (HTTP ${response.status})`;
      return new Response(
        JSON.stringify({ error: `Recipe generation is temporarily unavailable: ${upstreamMsg}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const text = (result?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(
        JSON.stringify({ error: 'The recipe came back malformed. Try again, or reword your request.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const num = (v: unknown, fallback = 0) => {
      const n = Number(v);
      return isFinite(n) && n >= 0 ? Math.round(n) : fallback;
    };
    const strArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

    // Normalise to exactly the shape src/lib/data/recipes.ts uses, so the
    // existing recipe card + modal render it with no special-casing.
    const CATS = new Set(['protein', 'veg', 'dairy', 'dry']);
    const recipe = {
      name: String(parsed.name || 'Untitled recipe'),
      e: String(parsed.e || '🍽️').slice(0, 4),
      t: num(parsed.t, 30),
      k: num(parsed.k),
      p: num(parsed.p),
      c: num(parsed.c),
      f: num(parsed.f),
      batch: Math.max(1, num(parsed.batch, 1)),
      desc: String(parsed.desc || ''),
      ing: (Array.isArray(parsed.ing) ? parsed.ing : []).map((i: any) => ({
        n: String(i?.n || ''),
        a: String(i?.a || ''),
        // Anything unexpected lands in "dry" — the modal groups by category and
        // would silently drop an ingredient with an unknown one.
        cat: CATS.has(String(i?.cat)) ? String(i.cat) : 'dry',
        pr: 0,
      })).filter((i: any) => i.n),
      prep: strArray(parsed.prep),
      steps: strArray(parsed.steps),
      instantPot: strArray(parsed.instantPot),
      kid: parsed.kid === true,
      coachNote: String(parsed.coachNote || ''),
    };

    if (!recipe.ing.length || !recipe.steps.length) {
      return new Response(
        JSON.stringify({ error: 'That came back incomplete. Try again with a bit more detail.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(recipe), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
