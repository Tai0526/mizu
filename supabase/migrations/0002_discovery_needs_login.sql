-- The discovery views deliberately see past row-level security so matching can
-- compare names across families — but only for people who are signed in.
--
-- Supabase's default privileges quietly grant SELECT on anything new in the
-- public schema to the anon role as well, which made these views readable with
-- nothing but the project's public key. Caught by a smoke test: an
-- unauthenticated request returned live names. Revoke it.

revoke all on public.trees_discovery       from anon;
revoke all on public.people_discovery      from anon;
revoke all on public.unions_discovery      from anon;
revoke all on public.child_links_discovery from anon;
