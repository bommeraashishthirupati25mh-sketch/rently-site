-- The Circles page showed a hardcoded "Batch 2026" / "MBA" / "Hostel" tag
-- row that had nothing to do with the actual signed-in student -- it was
-- static placeholder text for every single user. This adds a real `batch`
-- field students can set from the Account page, and the Circles header
-- now shows their actual batch + hostel block (already collected), or a
-- prompt to fill them in if empty, instead of fake-looking fixed text.
alter table public.profiles add column if not exists batch text not null default '';
