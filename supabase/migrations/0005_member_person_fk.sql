-- Deleting a person must not leave anyone's "this is me" pointing at nothing.
--
-- tree_members.person_id had no foreign key, so removing a person stranded any
-- member row that claimed it — and an account with a stranded claim computes no
-- relationship labels at all, which reads as the whole feature silently dying.
-- Clear any existing strays, then let the database keep it clean from now on.

update public.tree_members m
set person_id = null
where person_id is not null
  and not exists (select 1 from public.people p where p.id = m.person_id);

do $$ begin
  alter table public.tree_members
    add constraint tree_members_person_fk
    foreign key (person_id) references public.people (id) on delete set null;
exception when duplicate_object then null; end $$;
