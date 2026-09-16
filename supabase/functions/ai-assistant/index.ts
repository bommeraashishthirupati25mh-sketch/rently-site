import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const SITE_FACTS = `Rently is a room-rental pilot for one hostel campus. Students rent a room-setup bundle
(delivered on move-in day, collected on move-out day), can request semester storage for their break, and can
book move-in/move-out transport. There is Circles, a campus community feed (announcements, events, a small
marketplace) separate from bookings. Payment is manual: after booking, the student pays via a shown UPI ID and
an admin marks it paid once received - there is no card/online-gateway checkout, and there never will be one, so
never suggest paying by card or any gateway. Prices scale linearly with how long the student's chosen semester
date range is, relative to the standard 3-month (90-day) baseline price. Deposits are not currently collected
separately from the booking price; if something is damaged or lost, it's assessed at pickup and charged based on
the item's listed rental value, always explained before payment is requested. Only answer questions about
Rently, the items in the catalog given to you, pricing, storage, moves, Circles, or how the app works. If asked
about anything unrelated, or asked to do something outside answering questions (like changing a booking), say
you can help with questions but the student should use the site's own forms for actions, and mention where.
Never invent a booking id, price, or policy detail that isn't given to you in this context. Keep answers short
(2-4 sentences) and plain, no markdown headers, friendly but not gushing, no emoji unless the student uses one first.`;

function buildChatPrompt(context: Record<string, unknown>) {
  const catalog = Array.isArray(context.catalog) ? context.catalog : [];
  const catalogLines = catalog
    .map((it: any) => `- ${it.name} (id: ${it.id}): Rs ${it.price} for the ${context.semesterBaselineDays ?? 90}-day baseline, scales with chosen dates`)
    .join("\n");
  const bundleLine = context.bundlePrice != null ? `Full bundle (all ${catalog.length} items together): Rs ${context.bundlePrice} at the baseline length.` : "";
  const storageLine = context.storageSmallPrice != null
    ? `Storage (flat, doesn't scale with dates): small bag (<=40L/10kg) Rs ${context.storageSmallPrice} per semester break; trunk/large box (<=100L/25kg) Rs ${context.storageTrunkPrice} per semester break.`
    : "";
  const moveLine = context.movePrice != null ? `Move-in or move-out transport (flat, per trip): Rs ${context.movePrice}.` : "";
  const semLine = context.semesterLabel ? `This student's current chosen semester window: ${context.semesterLabel}.` : "";
  const roleLine = context.role ? `This student's account role: ${context.role}.` : "";
  const myBookings = Array.isArray(context.myBookingsSummary) && context.myBookingsSummary.length
    ? `This student's own bookings right now: ${JSON.stringify(context.myBookingsSummary)}`
    : "This student has no bookings yet.";
  const myStorage = Array.isArray(context.myStorageSummary) && context.myStorageSummary.length
    ? `Storage requests: ${JSON.stringify(context.myStorageSummary)}` : "";
  const myMoves = Array.isArray(context.myMovesSummary) && context.myMovesSummary.length
    ? `Move requests: ${JSON.stringify(context.myMovesSummary)}` : "";
  return `${SITE_FACTS}

Current catalog and prices:
${catalogLines}
${bundleLine}
${storageLine}
${moveLine}
${semLine}
${roleLine}
${myBookings}
${myStorage}
${myMoves}`;
}

function buildAdvisorPrompt(context: Record<string, unknown>) {
  const catalog = Array.isArray(context.catalog) ? context.catalog : [];
  const catalogLines = catalog
    .map((it: any) => `- id: "${it.id}", name: "${it.name}", price: Rs ${it.price} at baseline, description: ${it.desc || ""}`)
    .join("\n");
  return `You are Rently's room-setup advisor. A student will describe their situation (budget, what they
already own, how they live). Recommend which items from the catalog below they should add to their room-setup
bundle, and explain briefly why. Only ever use item ids that appear in this catalog - never invent one. If
their budget can't fit everything they want, prioritize what matters most for a functional hostel room and say
what you left out and why. If they mention something not in the catalog (e.g. a fridge), say Rently doesn't
carry that item rather than inventing one.

Catalog:
${catalogLines}
${context.bundlePrice != null ? `Full bundle price at baseline: Rs ${context.bundlePrice}.` : ""}`;
}

async function callGemini(apiKey: string, systemInstruction: string, contents: { role: string; parts: { text: string }[] }[], responseSchema?: object) {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
  };
  if (responseSchema) {
    (body.generationConfig as Record<string, unknown>).responseMimeType = "application/json";
    (body.generationConfig as Record<string, unknown>).responseSchema = responseSchema;
  }
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
  return text;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "AI is not configured yet - missing GEMINI_API_KEY." }, 500);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const mode = payload?.mode;
  const message = typeof payload?.message === "string" ? payload.message.slice(0, 1000) : "";
  const context = payload?.context && typeof payload.context === "object" ? payload.context : {};
  const history = Array.isArray(payload?.history) ? payload.history.slice(-10) : [];

  if (!message.trim()) return json({ error: "Message is required." }, 400);

  try {
    if (mode === "chat") {
      const contents = [
        ...history
          .filter((h: any) => h && typeof h.text === "string" && (h.role === "user" || h.role === "model"))
          .map((h: any) => ({ role: h.role, parts: [{ text: String(h.text).slice(0, 1000) }] })),
        { role: "user", parts: [{ text: message }] },
      ];
      const reply = await callGemini(apiKey, buildChatPrompt(context), contents);
      return json({ reply: reply.trim() || "Sorry, I couldn't come up with an answer for that. Try rephrasing?" });
    }

    if (mode === "advisor") {
      const schema = {
        type: "object",
        properties: {
          recommended_item_ids: { type: "array", items: { type: "string" } },
          reasoning: { type: "string" },
        },
        required: ["recommended_item_ids", "reasoning"],
      };
      const raw = await callGemini(apiKey, buildAdvisorPrompt(context), [{ role: "user", parts: [{ text: message }] }], schema);
      let parsed: { recommended_item_ids?: unknown; reasoning?: unknown };
      try {
        parsed = JSON.parse(raw);
      } catch {
        return json({ error: "AI returned something we couldn't parse. Try again." }, 502);
      }
      const validIds = Array.isArray(context.catalog) ? new Set(context.catalog.map((it: any) => it.id)) : new Set();
      const recommended = Array.isArray(parsed.recommended_item_ids)
        ? parsed.recommended_item_ids.filter((id: unknown) => typeof id === "string" && validIds.has(id))
        : [];
      return json({
        recommended_item_ids: recommended,
        reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      });
    }

    return json({ error: "Unknown mode." }, 400);
  } catch (e) {
    console.error("ai-assistant error:", e instanceof Error ? e.message : e);
    return json({ error: "AI request failed. Please try again in a moment." }, 502);
  }
});
