-- Two things families asked for once they could find each other.
--
-- 1. A phone number on a person. The entire point of rediscovering a relative
--    is being able to reach them.
alter table public.people add column if not exists phone text not null default '';

-- 2. What a CONFIRMED match actually unlocks. Matching itself only ever sees
--    the thin discovery slice (names, years — never contact details). But once
--    both families have agreed two records are the same person, the trees are
--    linked, and members of either tree may read the other's full people rows —
--    which is what puts a found cousin's phone number on screen.
--
--    The policy leans on match_links' own row security: is_tree_member limits
--    the check to links that involve one of the caller's trees, and only
--    confirmed ones count. Proposed or declined links unlock nothing.
drop policy if exists people_read_linked on public.people;
create policy people_read_linked on public.people
  for select using (
    exists (
      select 1
      from public.match_links ml
      where ml.status = 'confirmed'
        and (ml.tree_a = people.tree_id or ml.tree_b = people.tree_id)
        and (public.is_tree_member(ml.tree_a) or public.is_tree_member(ml.tree_b))
    )
  );

-- The discovery views deliberately do NOT gain the phone column. Contact
-- details are never part of the matching slice.
