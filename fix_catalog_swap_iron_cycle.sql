-- Iron and cycle are against hostel rules on the pilot campus (fire-safety
-- ban on heating appliances; no personal vehicles in hostel rooms). Swapped
-- for three hostel-safe items the user picked: an extension board (same
-- "everyday electrical utility" niche as the iron, no heating element), a
-- padded study chair, and a foldable wardrobe organizer.
--
-- Existing bookings that already reference 'iron'/'cycle' item ids are left
-- untouched -- the app's ITEM_DEFS lookup already falls back to the raw id
-- if a key is missing, so historical records just display "iron"/"cycle"
-- as plain text instead of crashing.
delete from public.inventory where item_id in ('iron', 'cycle');

insert into public.inventory (item_id, name, category, price, stock) values
  ('extension_board', 'Extension board', 'care', 150, 60),
  ('chair', 'Study chair', 'study', 600, 30),
  ('wardrobe', 'Wardrobe organizer', 'store', 400, 35);
