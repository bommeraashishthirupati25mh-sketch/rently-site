-- Real production bug: the `authenticated` Postgres role was missing the
-- base UPDATE grant on bookings, storage_bookings, and move_bookings --
-- while `anon` (Supabase's default) had it on every table, including
-- these three. RLS policies on these tables were correctly written
-- (is_admin() / is_transporter() gating who can change status/payment),
-- but a base GRANT sits BELOW row-level security -- Postgres checks it
-- first, and denies with "permission denied for table X" before RLS
-- policies are even evaluated if it's missing. This silently broke every
-- "Mark paid" button, every status dropdown, and pickup-OTP delivery
-- confirmation for any REAL logged-in admin/transporter session.
--
-- Never caught earlier because all admin-dashboard testing this project
-- used a client-side role fake (see project memory: temporarily
-- hardcoding profile.role in loadProfile()) -- which doesn't touch real
-- Postgres grants, only local React state. A real UPDATE attempt was
-- never actually exercised until a genuine admin account hit it.
--
-- Likely cause: an earlier security-hardening pass (fix_permissions.sql /
-- fix_rls_role_escalation.sql) revoked or re-granted table privileges and
-- missed UPDATE on these three specifically.
grant update on public.bookings to authenticated;
grant update on public.storage_bookings to authenticated;
grant update on public.move_bookings to authenticated;
