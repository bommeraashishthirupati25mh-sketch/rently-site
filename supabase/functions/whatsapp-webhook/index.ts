import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Receives Meta's delivery-status callbacks so whatsapp_log shows whether a message that Meta ACCEPTED
// was actually delivered (sent / delivered / read / failed, with the failure reason).
// Configure in Meta: WhatsApp > Configuration > Webhook. Callback URL = this function's URL,
// Verify token = the WHATSAPP_VERIFY_TOKEN secret, then subscribe to the "messages" field.
// Optional but recommended: set WHATSAPP_APP_SECRET (App settings > Basic) to verify Meta's signature.

async function validSignature(body: string, header: string | null, secret: string) {
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const hex = Array.from(mac).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === header.slice(7);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const verify = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    if (verify && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === verify) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (appSecret && !(await validSignature(raw, req.headers.get("x-hub-signature-256"), appSecret))) {
    return new Response("Bad signature", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return new Response("ok", { status: 200 });
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = JSON.parse(raw);
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const s of change?.value?.statuses ?? []) {
          const err = Array.isArray(s.errors) && s.errors[0] ? `${s.errors[0].code}: ${s.errors[0].title || s.errors[0].message || ""}` : null;
          await supabase.from("whatsapp_log")
            .update({ delivery_status: s.status ?? null, delivery_error: err, updated_at: new Date().toISOString() })
            .eq("wa_message_id", s.id);
        }
      }
    }
  } catch (e) {
    console.error("whatsapp-webhook parse failed:", e instanceof Error ? e.message : e);
  }
  // Always 200 so Meta doesn't retry endlessly on our own parsing problems.
  return new Response("ok", { status: 200 });
});
