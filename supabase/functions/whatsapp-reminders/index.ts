import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const UPI_ID = "ashish261105--3@okaxis";
const GRAPH_VERSION = "v21.0";
const REMINDER_AFTER_DAYS = 2;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const KIND_LABEL: Record<string, string> = { bookings: "room-setup booking", storage_bookings: "storage request", move_bookings: "move request" };

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
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${errText.slice(0, 300)}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return json({ error: "Unauthorized" }, 401);

  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!token || !phoneId || !supabaseUrl || !serviceKey) return json({ ran: false, reason: "not_configured" });

  const supabase = createClient(supabaseUrl, serviceKey);
  const cutoff = new Date(Date.now() - REMINDER_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let tried = 0, sent = 0, skippedNoPhone = 0, failed = 0;

  for (const table of ["bookings", "storage_bookings", "move_bookings"]) {
    const { data: rows, error } = await supabase
      .from(table)
      .select("id, student_id, student_name")
      .eq("payment_status", "Unpaid")
      .eq("whatsapp_reminder_sent", false)
      .lt("created_at", cutoff);
    if (error || !rows) continue;

    for (const row of rows) {
      tried++;
      if (!row.student_id) { skippedNoPhone++; continue; }
      const { data: profileData } = await supabase.from("profiles").select("phone").eq("id", row.student_id).single();
      const phone = (profileData?.phone || "").trim();
      if (!phone) { skippedNoPhone++; continue; }

      const label = KIND_LABEL[table] || "request";
      const message = `Hi ${row.student_name || "there"}, quick reminder: your Rently ${label} ${row.id} is still marked unpaid.\n` +
        `Pay via UPI: ${UPI_ID} and we'll mark it received once it comes through.\n` +
        `Already paid? Just reply here or check with the admin.`;

      try {
        await sendWhatsAppText(token, phoneId, phone, message);
        await supabase.from(table).update({ whatsapp_reminder_sent: true }).eq("id", row.id);
        sent++;
      } catch (e) {
        console.error("reminder send failed for", table, row.id, e instanceof Error ? e.message : e);
        failed++;
      }
    }
  }

  return json({ ran: true, tried, sent, skippedNoPhone, failed });
});
