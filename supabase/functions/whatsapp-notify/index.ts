import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const UPI_ID = "ashish261105--3@okaxis";
const GRAPH_VERSION = "v21.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const TABLES: Record<string, string> = { booking: "bookings", storage: "storage_bookings", move: "move_bookings" };

// Rently is India-only (IBS Hyderabad). Numbers are commonly saved as a bare 10-digit local number,
// but Meta needs full E.164 digits, so default to +91 when no country code is present.
function toE164(raw: string) {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length === 10 ? "91" + digits : digits;
}

// Template parameters can't contain newlines, tabs or long runs of spaces.
function clean(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "-";
}

type Sent = { ok: boolean; via: "template" | "text"; id?: string; code?: number; error?: string };

async function callGraph(token: string, phoneId: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true as const, id: data?.messages?.[0]?.id as string | undefined };
  const e = data?.error ?? {};
  return { ok: false as const, code: e.code as number | undefined, message: String(e.error_data?.details || e.message || `HTTP ${res.status}`).slice(0, 300) };
}

// Business-initiated messages only reach a student outside Meta's 24-hour window as an APPROVED TEMPLATE.
// Try the template first. If it is not created/approved yet (Meta error codes 132xxx), fall back to plain text,
// which is delivered only inside the 24-hour window or to test recipients.
async function sendWhatsApp(token: string, phoneId: string, toRaw: string, template: { name: string; params: string[] }, text: string): Promise<Sent> {
  const to = toE164(toRaw);
  const t = await callGraph(token, phoneId, {
    to, type: "template",
    template: { name: template.name, language: { code: "en" }, components: [{ type: "body", parameters: template.params.map(p => ({ type: "text", text: clean(p) })) }] },
  });
  if (t.ok) return { ok: true, via: "template", id: t.id };
  if (t.code && t.code >= 132000 && t.code < 133000) {
    const x = await callGraph(token, phoneId, { to, type: "text", text: { body: text } });
    return x.ok ? { ok: true, via: "text", id: x.id } : { ok: false, via: "text", code: x.code, error: x.message };
  }
  return { ok: false, via: "template", code: t.code, error: t.message };
}

function bookingMessage(row: any, name: string) {
  const items = Array.isArray(row.items) ? row.items.join(", ") : "";
  const delivery = `${row.hostel_block} room ${row.room_info}${row.delivery_slot ? ", " + row.delivery_slot : ""}`;
  return {
    template: { name: "rently_booking_confirmed", params: [name, row.id, delivery, row.pickup_otp, UPI_ID] },
    text: `Hi ${name}! Your Rently booking ${row.id} is confirmed.\nItems: ${items}\nDelivery: ${delivery}\nYour pickup code (show this at handover): ${row.pickup_otp}\nPay via UPI when ready: ${UPI_ID}. We'll mark it paid once received.`,
  };
}
function storageMessage(row: any, name: string) {
  const size = row.bag_size === "trunk" ? "trunk" : "small bag";
  return {
    template: { name: "rently_storage_confirmed", params: [name, row.id, size, row.drop_off_date, UPI_ID] },
    text: `Hi ${name}! Your Rently storage request ${row.id} (${size}) is confirmed.\nDrop-off: ${row.drop_off_date}\nPay via UPI when ready: ${UPI_ID}. We'll mark it paid once received.`,
  };
}
function moveMessage(row: any, name: string) {
  return {
    template: { name: "rently_move_confirmed", params: [name, row.move_type, row.id, row.move_date, UPI_ID] },
    text: `Hi ${name}! Your Rently ${row.move_type} request ${row.id} is scheduled for ${row.move_date}.\nOur crew will reach out with pickup details.\nPay via UPI when ready: ${UPI_ID}. We'll mark it paid once received.`,
  };
}

async function logAttempt(kind: string, refId: string, studentId: string, r: Sent) {
  try {
    const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    await createClient(url, key).from("whatsapp_log").insert({
      kind, ref_id: refId, student_id: studentId, via: r.via, ok: r.ok, wa_message_id: r.id ?? null, error_code: r.code ?? null, error: r.error ?? null,
    });
  } catch (e) {
    console.error("whatsapp_log insert failed:", e instanceof Error ? e.message : e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
  if (!token || !phoneId) return json({ sent: false, reason: "not_configured" });

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }

  const kind = payload?.kind;
  const id = typeof payload?.id === "string" ? payload.id : "";
  const table = TABLES[kind];
  if (!table || !id) return json({ error: "Unknown kind or missing id." }, 400);

  const authHeader = req.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authHeader || !supabaseUrl || !supabaseAnonKey) return json({ sent: false, reason: "unauthenticated" }, 401);

  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return json({ sent: false, reason: "unauthenticated" }, 401);

  const { data: profileData } = await supabase.from("profiles").select("phone, full_name").eq("id", uid).single();
  const phone = (profileData?.phone || "").trim();
  if (!phone) return json({ sent: false, reason: "no_phone" });

  // scope the lookup to the caller's own row - a student can only trigger a message about their own booking.
  const { data: row, error: rowErr } = await supabase.from(table).select("*").eq("id", id).eq("student_id", uid).single();
  if (rowErr || !row) return json({ sent: false, reason: "not_found" }, 404);

  const name = clean(profileData?.full_name || row.student_name || "there");
  const msg = kind === "booking" ? bookingMessage(row, name) : kind === "storage" ? storageMessage(row, name) : moveMessage(row, name);

  const result = await sendWhatsApp(token, phoneId, phone, msg.template, msg.text);
  await logAttempt(kind, id, uid, result);
  if (result.ok) return json({ sent: true, via: result.via });
  console.error("whatsapp-notify send failed:", result.code, result.error);
  return json({ sent: false, reason: "send_failed", detail: `${result.code ?? "?"}: ${result.error ?? ""}` });
});
