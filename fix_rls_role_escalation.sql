-- Security fix: any signed-in student can currently grant themselves admin
-- or transporter access.
--
-- The "profiles: update own" policy only checks that a user is updating
-- their OWN row (auth.uid() = id) -- it does not restrict which COLUMNS
-- they can change. Since `role` is a normal column on that same row, any
-- authenticated user can run (via the same Supabase client already used by
-- the site, no special tools needed):
--
--   supabase.from('profiles').update({ role: 'admin' }).eq('id', <own id>)
--
-- ...and immediately gain the admin dashboard, every student's bookings,
-- and staff-only update rights, since is_admin()/is_transporter() just
-- check profiles.role for the current user.
--
-- This adds a trigger that silently reverts any attempt to change `role`
-- unless the person making the change is already an admin. It doesn't
-- touch any existing app behavior -- no code in the site currently sets
-- `role` at all (it's only ever set by hand in the SQL editor), so nothing
-- legitimate breaks.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_role_self_escalation on public.profiles;
create trigger prevent_role_self_escalation
  before update on public.profiles
  for each row
  execute function public.prevent_role_self_escalation();
