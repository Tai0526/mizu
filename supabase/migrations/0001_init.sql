-- ═══════════════════════════════════════════════════════════════════════════
-- Mizu — initial schema
--
-- Run this once in the Supabase SQL editor. It is written to be safe to re-run.
--
-- Two ideas shape the whole file:
--
--  1. A family tree is private. Only people who have been added to a tree can
--     read the records in it, and that is enforced by the database rather than
--     by the app — a check in the browser is a suggestion, not a rule.
--
--  2. Matching needs to see across families, or the central feature cannot
--     work. So a deliberately thin slice — names, years, sex, birthplace and
--     the shape of the relationships — is exposed through the *_discovery
--     views below. Photos, notes and who-is-whom are never in that slice, and
--     a tree can opt out entirely with trees.discoverable = false.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tables ─────────────────────────────────────────────────────────────────

create table if not exists public.trees (
  id           text primary key,
  name         text not null,
  description  text not null default '',
  -- When false the tree is invisible to matching. Everything else still works;
  -- it simply never appears as somebody else's suggestion.
  discoverable boolean not null default true,
  created_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table if not exists public.tree_members (
  id           text primary key,
  tree_id      text not null references public.trees (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  display_name text not null default '',
  role         text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  -- Which node in this tree the member says is themselves.
  person_id    text,
  created_at   timestamptz not null default now(),
  unique (tree_id, user_id)
);

create table if not exists public.people (
  id          text primary key,
  tree_id     text not null references public.trees (id) on delete cascade,
  given_name  text not null default '',
  family_name text not null default '',
  other_names text not null default '',
  sex         text not null default 'unknown' check (sex in ('male', 'female', 'unknown')),
  birth_year  integer,
  birth_place text not null default '',
  death_year  integer,
  living      boolean not null default true,
  photo_url   text,
  notes       text not null default '',
  claimed_by  uuid references auth.users (id) on delete set null,
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A couple. Either partner may be null: that is how a single parent, or a
-- sibling group whose parents nobody can name, is recorded without inventing
-- fictional people.
create table if not exists public.unions (
  id         text primary key,
  tree_id    text not null references public.trees (id) on delete cascade,
  partner_a  text references public.people (id) on delete set null,
  partner_b  text references public.people (id) on delete set null,
  status     text not null default 'married'
             check (status in ('married', 'partners', 'engaged', 'separated', 'divorced', 'widowed')),
  year       integer,
  created_at timestamptz not null default now()
);

create table if not exists public.child_links (
  id         text primary key,
  tree_id    text not null references public.trees (id) on delete cascade,
  union_id   text not null references public.unions (id) on delete cascade,
  person_id  text not null references public.people (id) on delete cascade,
  relation   text not null default 'biological'
             check (relation in ('biological', 'adopted', 'step', 'fostered')),
  created_at timestamptz not null default now(),
  -- One birth union per person. This is the invariant the whole graph rests on.
  unique (person_id)
);

-- "These two records are the same human." Proposed by one side, confirmed by
-- the other. Nothing is merged: a confirmed link only lets each side see across.
create table if not exists public.match_links (
  id           text primary key,
  person_a     text not null references public.people (id) on delete cascade,
  tree_a       text not null references public.trees (id) on delete cascade,
  person_b     text not null references public.people (id) on delete cascade,
  tree_b       text not null references public.trees (id) on delete cascade,
  status       text not null default 'proposed' check (status in ('proposed', 'confirmed', 'declined')),
  score        integer not null default 0,
  reasons      text[] not null default '{}',
  proposed_by  uuid not null references auth.users (id) on delete cascade,
  responded_by uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists people_tree_idx       on public.people (tree_id);
create index if not exists people_family_idx     on public.people (lower(family_name));
create index if not exists unions_tree_idx       on public.unions (tree_id);
create index if not exists child_links_tree_idx  on public.child_links (tree_id);
create index if not exists child_links_union_idx on public.child_links (union_id);
create index if not exists members_user_idx      on public.tree_members (user_id);
create index if not exists match_tree_a_idx      on public.match_links (tree_a);
create index if not exists match_tree_b_idx      on public.match_links (tree_b);

-- ── Membership helpers ─────────────────────────────────────────────────────
--
-- These are SECURITY DEFINER on purpose. A policy on tree_members that queries
-- tree_members would recurse forever; routing the check through a function that
-- runs as the owner breaks the cycle.

create or replace function public.is_tree_member(t text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.tree_members m
    where m.tree_id = t and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_tree(t text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.tree_members m
    where m.tree_id = t
      and m.user_id = auth.uid()
      and m.role in ('owner', 'editor')
  );
$$;

-- ── Row-level security ─────────────────────────────────────────────────────

alter table public.trees        enable row level security;
alter table public.tree_members enable row level security;
alter table public.people       enable row level security;
alter table public.unions       enable row level security;
alter table public.child_links  enable row level security;
alter table public.match_links  enable row level security;

drop policy if exists trees_read   on public.trees;
drop policy if exists trees_insert on public.trees;
drop policy if exists trees_update on public.trees;
drop policy if exists trees_delete on public.trees;

create policy trees_read on public.trees
  for select using (is_tree_member(id) or created_by = auth.uid());
create policy trees_insert on public.trees
  for insert with check (created_by = auth.uid());
create policy trees_update on public.trees
  for update using (can_edit_tree(id) or created_by = auth.uid());
create policy trees_delete on public.trees
  for delete using (created_by = auth.uid());

drop policy if exists members_read   on public.tree_members;
drop policy if exists members_insert on public.tree_members;
drop policy if exists members_update on public.tree_members;
drop policy if exists members_delete on public.tree_members;

create policy members_read on public.tree_members
  for select using (user_id = auth.uid() or is_tree_member(tree_id));
-- You may add yourself to a tree you created, and an editor may add others.
create policy members_insert on public.tree_members
  for insert with check (
    user_id = auth.uid()
    or can_edit_tree(tree_id)
    or exists (select 1 from public.trees t where t.id = tree_id and t.created_by = auth.uid())
  );
create policy members_update on public.tree_members
  for update using (user_id = auth.uid() or can_edit_tree(tree_id));
create policy members_delete on public.tree_members
  for delete using (user_id = auth.uid() or can_edit_tree(tree_id));

-- people / unions / child_links all follow the same rule: readable by members
-- of the tree, writable by editors of it.
do $$
declare
  t text;
begin
  foreach t in array array['people', 'unions', 'child_links'] loop
    execute format('drop policy if exists %I_read   on public.%I', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);

    execute format(
      'create policy %I_read on public.%I for select using (is_tree_member(tree_id))', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert with check (can_edit_tree(tree_id))', t, t);
    execute format(
      'create policy %I_update on public.%I for update using (can_edit_tree(tree_id))', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete using (can_edit_tree(tree_id))', t, t);
  end loop;
end $$;

drop policy if exists match_read   on public.match_links;
drop policy if exists match_insert on public.match_links;
drop policy if exists match_update on public.match_links;

-- Both sides of a proposed link can see it — that is the whole point — and
-- either side can answer it.
create policy match_read on public.match_links
  for select using (is_tree_member(tree_a) or is_tree_member(tree_b));
create policy match_insert on public.match_links
  for insert with check (
    proposed_by = auth.uid() and (can_edit_tree(tree_a) or can_edit_tree(tree_b))
  );
create policy match_update on public.match_links
  for update using (can_edit_tree(tree_a) or can_edit_tree(tree_b));

-- ── Discovery ──────────────────────────────────────────────────────────────
--
-- The thin slice that matching is allowed to compare across families. Note what
-- is absent: photo_url, notes, claimed_by, created_by. A name and a year are
-- enough to spot that two families wrote down the same grandmother; everything
-- private stays behind the policies above.
--
-- These views are owned by postgres and deliberately NOT security_invoker, so
-- they see past the row policies — that is the exception being granted, and it
-- is limited to trees whose owners left discoverable on.

drop view if exists public.people_discovery;
drop view if exists public.unions_discovery;
drop view if exists public.child_links_discovery;
drop view if exists public.trees_discovery;

create view public.trees_discovery as
  select id, name, created_at
  from public.trees
  where discoverable;

create view public.people_discovery as
  select p.id, p.tree_id, p.given_name, p.family_name, p.other_names,
         p.sex, p.birth_year, p.birth_place, p.death_year, p.living, p.created_at
  from public.people p
  join public.trees t on t.id = p.tree_id
  where t.discoverable;

create view public.unions_discovery as
  select u.id, u.tree_id, u.partner_a, u.partner_b, u.status, u.year, u.created_at
  from public.unions u
  join public.trees t on t.id = u.tree_id
  where t.discoverable;

create view public.child_links_discovery as
  select c.id, c.tree_id, c.union_id, c.person_id, c.relation, c.created_at
  from public.child_links c
  join public.trees t on t.id = c.tree_id
  where t.discoverable;

grant select on public.trees_discovery       to authenticated;
grant select on public.people_discovery      to authenticated;
grant select on public.unions_discovery      to authenticated;
grant select on public.child_links_discovery to authenticated;

-- ── Photo storage ──────────────────────────────────────────────────────────
--
-- Paths carry a random id, and the bucket is public so an <img> tag works
-- without a signing round trip on every card. The trade is real and worth
-- stating plainly: anybody who has the exact URL can see that photo. If that is
-- not acceptable for your family, flip `public` to false here and switch
-- uploadPhoto() in the app to createSignedUrl().

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists photos_read   on storage.objects;
drop policy if exists photos_write  on storage.objects;
drop policy if exists photos_update on storage.objects;
drop policy if exists photos_delete on storage.objects;

create policy photos_read on storage.objects
  for select using (bucket_id = 'photos');
create policy photos_write on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');
-- Replacing or removing a photo is for whoever uploaded it, not any signed-in
-- account — without the owner check, one stranger could wipe another family's
-- pictures.
create policy photos_update on storage.objects
  for update to authenticated using (bucket_id = 'photos' and owner = auth.uid());
create policy photos_delete on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and owner = auth.uid());
