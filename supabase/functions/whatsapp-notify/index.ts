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
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const TABLES: Record<string, string> = {
  booking: "bookings",
  storage: "storage_bookings",
  move: "move_bookings",
};

// Rently is India-only (IBS Hyderabad). Numbers are commonly saved as a bare 10-digit
// local number with no country code - Meta's API needs the full E.164 digits, so default
// to +91 when nothing else is present rather than silently failing to send.
function toE164(raw: string) {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length === 10 ? "91" + digits : digits;
}

async function sendWhatsAppText(token: string, phoneId: string, toRaw: string, body: string) {
  const to = toE164(toRaw);
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(raw.slice(0, 500));
  }
}

function bookingMessage(row: any, name: string) {
  const items = Array.isArray(row.items) ? row.items.join(", ") : "";
  return `Hi ${name || "there"}! Your Rently booking ${row.id} is confirmed.\n` +
    `Items: ${items}\n` +
    `Delivery: ${row.hostel_block} Room ${row.room_info}${row.delivery_slot ? ", slot " + row.delivery_slot : ""}\n` +
    `Your pickup code (show this at handover): ${row.pickup_otp}\n` +
    `Pay via UPI when ready: ${UPI_ID}. We'll mark it paid once received.`;
}

function storageMessage(row: any, name: string) {
  return `Hi ${name || "there"}! Your Rently storage request ${row.id} (${row.bag_size}) is confirmed.\n` +
    `Drop-off: ${row.drop_off_date}\n` +
    `Pay via UPI when ready: ${UPI_ID}. We'll mark it paid once received.`;
}

function moveMessage(row: any, name: string) {
  return `Hi ${name || "there"}! Your Rently ${row.move_type} request ${row.id} is scheduled for ${row.move_date}.\n` +
    `Our crew will reach out with pickup details.\n` +
    `Pay via UPI when ready: ${UPI_ID}. We'll mark it paid once received.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
  if (!token || !phoneId) return json({ sent: false, reason: "not_configured" });

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

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

  // scope the lookup to the caller's own row - a student should only ever trigger a
  // notification for their own booking, never someone else's by guessing an id.
  const { data: row, error: rowErr } = await supabase.from(table).select("*").eq("id", id).eq("student_id", uid).single();
  if (rowErr || !row) return json({ sent: false, reason: "not_found" }, 404);

  const name = profileData?.full_name || row.student_name || "";
  const message = kind === "booking" ? bookingMessage(row, name) : kind === "storage" ? storageMessage(row, name) : moveMessage(row, name);

  try {
    await sendWhatsAppText(token, phoneId, phone, message);
    return json({ sent: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("whatsapp-notify send failed:", detail);
    // TEMP: surfacing raw Meta API error in the response body for debugging -
    // remove the "detail" field once WhatsApp sending is confirmed working.
    return json({ sent: false, reason: "send_failed", detail });
  }
});
