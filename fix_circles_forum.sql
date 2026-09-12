-- Upgrades Circles from "comments bolted onto 3 hardcoded feed items" into
-- an actual community forum: students can create posts (Announcement,
-- Event, or Marketplace/buy-sell listing), comment on any post, and reply
-- to a specific comment (threaded, not just a flat list).

-- Widen circles_posts to cover marketplace-style listings, matching the
-- original "buy/sell board" vision, not just Announcement/Event.
alter table public.circles_posts drop constraint if exists circles_posts_kind_check;
alter table public.circles_posts add constraint circles_posts_kind_check
  check (kind = any (array['Announcement'::text, 'Event'::text, 'Marketplace'::text]));

-- Freeform short detail line (a price, a specific time-of-day like
-- "9-11 PM", etc). Deliberately NOT for storing "Today"/"Tomorrow" style
-- relative-day text -- that goes stale exactly like the semester-date bug
-- did. The app computes the relative-day label from event_date at render
-- time instead, so authors never need to type a day-relative word here.
alter table public.circles_posts add column if not exists meta text not null default '';

-- Threaded replies: a comment can optionally reply to another comment
-- instead of the post directly.
alter table public.circle_comments add column if not exists parent_comment_id
  bigint references public.circle_comments(id) on delete cascade;

-- Now that real posts exist (rather than post_id just being a loose
-- string key into a hardcoded client-side array), enforce that every
-- comment actually points at a real post.
alter table public.circle_comments drop constraint if exists circle_comments_post_id_fkey;
alter table public.circle_comments add constraint circle_comments_post_id_fkey
  foreign key (post_id) references public.circles_posts(id) on delete cascade;

-- One real example Marketplace listing so the new post kind has content
-- to point at right away (a price doesn't go stale the way a relative
-- date would, so this is safe to seed without an expiry concern).
insert into public.circles_posts (id, author_id, author_name, kind, title, body, meta)
values ('CIR-0003', null, 'Rently Team', 'Marketplace', 'Cycle', 'Single-speed campus cycle, available to rent.', '₹100/week')
on conflict (id) do nothing;
