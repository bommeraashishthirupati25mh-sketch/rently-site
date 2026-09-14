-- Support 2-3 photos per product listing instead of just one. Adds an
-- array column alongside the existing scalar image_url (kept only for
-- any external reference; the app no longer writes to it) and backfills
-- any image already set so nothing already uploaded gets lost.
alter table public.inventory add column if not exists image_urls text[] not null default '{}';

update public.inventory
set image_urls = array[image_url]
where image_url is not null and image_urls = '{}';

alter table public.inventory add constraint inventory_image_urls_max_check check (coalesce(array_length(image_urls, 1), 0) <= 3);
