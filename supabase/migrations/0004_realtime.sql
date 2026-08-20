-- Live updates. A family filling in a tree together is the whole product, and
-- "reload to see what your uncle just added" is not together. These tables now
-- publish their changes, and the app listens.
--
-- Row security still applies to what a subscriber RECEIVES for inserts and
-- updates. Delete events carry only the row's primary key — our ids are random
-- tokens with no meaning, and the app treats every event the same way: as a
-- nudge to refetch through the normal, policy-checked reads.

do $$ begin alter publication supabase_realtime add table public.trees;        exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tree_members; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.people;       exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.unions;       exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.child_links;  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.match_links;  exception when duplicate_object then null; end $$;
