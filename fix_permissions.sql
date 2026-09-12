-- Fix: grant EXECUTE on the role-check helper functions used inside RLS policies.
-- Without this, every query against profiles/bookings/storage_bookings/move_bookings
-- fails with "permission denied for function is_admin" for ALL users, logged in or not.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_admin', 'is_transporter')
  loop
    execute format('grant execute on function %s to authenticated, anon;', r.sig);
  end loop;
end $$;

-- Optional cleanup: remove the throwaway diagnostic account created while testing this fix.
-- Safe to skip if you'd rather delete it by hand in Authentication > Users.
delete from auth.users where email like 'rently-diag-%@example.com';

-- New columns for the hostel-block routing + delivery-slot features added to the site.
-- All additive and nullable, so existing rows are unaffected.
alter table public.profiles         add column if not exists hostel_block text;
alter table public.bookings         add column if not exists hostel_block text;
alter table public.bookings         add column if not exists delivery_slot text;
alter table public.storage_bookings add column if not exists hostel_block text;
alter table public.move_bookings    add column if not exists hostel_block text;

