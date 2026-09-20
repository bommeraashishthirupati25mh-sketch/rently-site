# Getting WhatsApp messages delivering (about 10 minutes)

The code is finished and deployed. Every attempt is logged, and the admin dashboard now shows a
"WhatsApp messages" panel with the reason for any failure. The only thing stopping delivery is the
access token: every recent send failed with Meta error 190 (expired token).

## 1. Create a permanent token (once)
1. Meta Business Settings > Users > System users > Add. Name it `rently`, role Admin.
2. Add assets: give it your app, and your WhatsApp account, full control.
3. Generate new token: choose your app, set expiry to Never, tick `whatsapp_business_messaging`
   and `whatsapp_business_management`. Copy the token.

## 2. Store it
Supabase > Edge Functions > Secrets > set `WHATSAPP_TOKEN` to the new token. Keep
`WHATSAPP_PHONE_ID` as it is. No redeploy is needed.

## 3. Create the message templates
In PowerShell, from the project folder:

    $env:WHATSAPP_TOKEN="paste-token-here"; node supabase/whatsapp-templates/create-templates.mjs

Approval usually takes minutes to a few hours. Until a template is approved, the function falls back
to plain text, which only reaches people who messaged the number in the last 24 hours.

## 4. Test
Book something as a student whose Account page has a phone number saved. Check the
"WhatsApp messages" panel in the admin dashboard: the row should say `sent` or `delivered`.

If you are still on Meta's test number, each recipient must be added to the allowed list first
(error 131030 in the panel means this).

## Works without any of the above
Every pickup code now has a "Save on WhatsApp" button. It opens WhatsApp with the booking ID and
code ready to send to any chat, so students can keep the code even when the API is down.
