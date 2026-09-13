-- Two things:
--
-- 1. An admin role-assignment UI needs to show WHICH email belongs to
--    which profile, but the client can't query auth.users directly (not
--    exposed via the API, by design -- it holds password hashes etc).
--    Standard fix: keep a denormalized copy of email on profiles itself,
--    populated at signup by the existing handle_new_user() trigger, and
--    backfilled for the 4 accounts that already exist.
alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email);
  return new;
end;
$$;

-- 2. Brand Supplier manifest: quantity of each item needed by date, with
-- NO student PII (no name, no room, no booking id) -- a supplier needs to
-- know what to dispatch and by when, not who it's for. Same
-- SECURITY DEFINER + WHERE-clause-gate pattern as get_item_demand().
create or replace function public.get_item_manifest()
returns table(item_id text, needed_by date, quantity bigint)
language sql
stable security definer
set search_path = public
as $$
  select unnest(items) as item_id, semester_start as needed_by, count(*) as quantity
  from public.bookings
  where status in ('Pending', 'Confirmed') and (is_partner() or is_admin())
  group by item_id, semester_start
  order by needed_by, item_id;
$$;

grant execute on function public.get_item_manifest() to authenticated;
