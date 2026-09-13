-- Manual UPI payment tracking: the platform shows a UPI ID/QR at
-- checkout (free, no gateway, no fees), the student pays directly via
-- their own UPI app, and an admin marks the booking paid after checking
-- their own bank/UPI app -- no automated verification is possible without
-- a paid gateway, which was explicitly ruled out.
alter table public.bookings add column if not exists payment_status text not null default 'Unpaid';
alter table public.bookings add constraint bookings_payment_status_check check (payment_status in ('Unpaid','Paid'));

alter table public.storage_bookings add column if not exists payment_status text not null default 'Unpaid';
alter table public.storage_bookings add constraint storage_bookings_payment_status_check check (payment_status in ('Unpaid','Paid'));

alter table public.move_bookings add column if not exists payment_status text not null default 'Unpaid';
alter table public.move_bookings add constraint move_bookings_payment_status_check check (payment_status in ('Unpaid','Paid'));

-- No RLS changes needed: admin's existing "can update status" policies on
-- all three tables have no column restriction, so they already cover
-- payment_status too.
