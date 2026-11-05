-- PASSO 5: planejamento semanal de estudos
-- Seguro para executar uma vez em um projeto Supabase que já contém schema4.sql.
-- Cole no Supabase > SQL Editor > New query > Run.

create table if not exists public.study_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  title text not null check (char_length(trim(title)) > 0),
  topic text,
  time_label text not null check (char_length(trim(time_label)) > 0),
  scheduled_date date not null,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists study_tasks_user_date_idx
  on public.study_tasks (user_id, scheduled_date, time_label);

alter table public.study_tasks enable row level security;

drop policy if exists "study_tasks: dono" on public.study_tasks;
create policy "study_tasks: dono" on public.study_tasks
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      subject_id is null
      or exists (
        select 1 from public.subjects s
        where s.id = subject_id and s.user_id = auth.uid()
      )
    )
  );
