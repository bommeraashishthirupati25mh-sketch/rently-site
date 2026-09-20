import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const UPI_ID = "ashish261105--3@okaxis";
const GRAPH_VERSION = "v21.0";
const REMINDER_AFTER_DAYS = 2;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const KIND_LABEL: Record<string, string> = { bookings: "room-setup booking", storage_bookings: "storage request", move_bookings: "move request" };
const KIND_LOG: Record<string, string> = { bookings: "reminder_booking", storage_bookings: "reminder_storage", move_bookings: "reminder_move" };

function toE164(raw: string) {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length === 10 ? "91" + digits : digits;
}
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

// Approved template first (reaches students outside the 24-hour window); plain text only as a fallback.
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
      .from(table).select("id, student_id, student_name")
      .eq("payment_status", "Unpaid").eq("whatsapp_reminder_sent", false).lt("created_at", cutoff);
    if (error || !rows) continue;

    for (const row of rows) {
      tried++;
      if (!row.student_id) { skippedNoPhone++; continue; }
      const { data: profileData } = await supabase.from("profiles").select("phone").eq("id", row.student_id).single();
      const phone = (profileData?.phone || "").trim();
      if (!phone) { skippedNoPhone++; continue; }

      const label = KIND_LABEL[table] || "request";
      const name = clean(row.student_name || "there");
      const text = `Hi ${name}, quick reminder: your Rently ${label} ${row.id} is still marked unpaid.\nPay via UPI: ${UPI_ID} and we'll mark it received once it comes through.\nAlready paid? Just reply here or check with the admin.`;
      const result = await sendWhatsApp(token, phoneId, phone, { name: "rently_payment_reminder", params: [name, label, row.id, UPI_ID] }, text);

      await supabase.from("whatsapp_log").insert({
        kind: KIND_LOG[table] || "reminder", ref_id: row.id, student_id: row.student_id, via: result.via, ok: result.ok,
        wa_message_id: result.id ?? null, error_code: result.code ?? null, error: result.error ?? null,
      });
      if (result.ok) {
        await supabase.from(table).update({ whatsapp_reminder_sent: true }).eq("id", row.id);
        sent++;
      } else {
        console.error("reminder send failed for", table, row.id, result.code, result.error);
        failed++;
      }
    }
  }

  return json({ ran: true, tried, sent, skippedNoPhone, failed });
});
