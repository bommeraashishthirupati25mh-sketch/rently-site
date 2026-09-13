-- Restricts deleting Circles posts and comments to admins only (previously
-- the policy also let the original author delete their own post/comment;
-- that's being removed per request -- admin is now the only one who can).
drop policy if exists "circles: author or admin can delete" on public.circles_posts;
create policy "circles: admin can delete"
  on public.circles_posts for delete
  using (is_admin());

drop policy if exists "circle_comments: author or admin can delete" on public.circle_comments;
create policy "circle_comments: admin can delete"
  on public.circle_comments for delete
  using (is_admin());
