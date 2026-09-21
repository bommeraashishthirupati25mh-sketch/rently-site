// Creates Rently's WhatsApp message templates in Meta (they still need Meta's approval, usually minutes to a few hours).
//
// Run from the repo root. The token stays in your environment, never in a file or in chat:
//   PowerShell:  $env:WHATSAPP_TOKEN = "<permanent token>"; node supabase/whatsapp-templates/create-templates.mjs
//   bash:        WHATSAPP_TOKEN="<permanent token>" node supabase/whatsapp-templates/create-templates.mjs
//
// The parameter order here MUST match what supabase/functions/whatsapp-notify and whatsapp-reminders send.

const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "2025148634798207";
import readline from "node:readline/promises";
let TOKEN = (process.env.WHATSAPP_TOKEN || "").trim();
if (!TOKEN.startsWith("EAA")) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  TOKEN = (await rl.question("Paste your WhatsApp token, then press Enter: ")).trim().replace(/^["']+|["']+$/g, "");
  rl.close();
}
if (!TOKEN.startsWith("EAA")) { console.error("That does not look like a token (it should start with EAA)."); process.exit(1); }

const templates = [
  {
    name: "rently_booking_confirmed_v2",
    text: "Hi {{1}}, your Rently booking {{2}} is confirmed. Delivery: {{3}}. Your handover details are in My Rently on our site. Pay by UPI to {{4}} when ready and we will mark it paid once it arrives.",
    example: ["Rohan", "RNT-4821", "Hostel A room 214, Morning", "rently@upi"],
  },
  {
    name: "rently_storage_confirmed",
    text: "Hi {{1}}, your Rently storage request {{2}} ({{3}}) is confirmed. Drop-off date: {{4}}. Pay by UPI to {{5}} when ready and we will mark it paid once it arrives.",
    example: ["Rohan", "STG-3310", "small bag", "2026-10-05", "rently@upi"],
  },
  {
    name: "rently_move_confirmed",
    text: "Hi {{1}}, your Rently {{2}} request {{3}} is scheduled for {{4}}. Our crew will reach out with pickup details. Pay by UPI to {{5}} when ready and we will mark it paid once it arrives.",
    example: ["Rohan", "move-in", "MOV-2207", "2026-10-05", "rently@upi"],
  },
  {
    name: "rently_payment_reminder",
    text: "Hi {{1}}, quick reminder: your Rently {{2}} {{3}} is still marked unpaid. Pay by UPI to {{4}} and we will mark it received once it comes through. Already paid? Just reply here.",
    example: ["Rohan", "room-setup booking", "RNT-4821", "rently@upi"],
  },
];

for (const t of templates) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: t.name, language: "en", category: "UTILITY",
      components: [{ type: "BODY", text: t.text, example: { body_text: [t.example] } }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) console.log(`created  ${t.name}  status=${data.status}  id=${data.id}`);
  else if (data?.error?.error_subcode === 2388024) console.log(`exists   ${t.name}  (already created, fine)`);
  else console.log(`FAILED   ${t.name}  ${data?.error?.code}: ${data?.error?.error_user_msg || data?.error?.message}`);
}
console.log("\nCheck approval status in Meta: WhatsApp Manager > Message templates.");
