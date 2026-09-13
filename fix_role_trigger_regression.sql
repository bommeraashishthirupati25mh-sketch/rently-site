-- Fixes a real regression the earlier privilege-escalation fix introduced:
-- prevent_role_self_escalation() reverted ANY role change unless is_admin()
-- was true. But auth.uid() is NULL outside of an authenticated API request
-- (SQL Editor, migrations, any direct Postgres connection all have no JWT),
-- so is_admin() was ALWAYS false there too -- meaning the trigger has been
-- silently blocking the documented "promote a user via SQL Editor"
-- workflow (see fix_partner_and_comments.sql's own instructions) this
-- whole time, not just the actual exploit.
--
-- Fix: only intervene when the change comes through an authenticated
-- session (auth.uid() is not null) that isn't already an admin. Direct SQL
-- access is already a trusted context -- only project owners have SQL
-- Editor access -- so it was never the thing this needed to guard against.
-- Re-verified after this change that the actual exploit (a non-admin
-- authenticated user self-promoting via the REST API) is still blocked.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;
