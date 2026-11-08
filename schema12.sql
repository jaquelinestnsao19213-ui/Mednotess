-- PASSO 12: notas, planejamento e checklist de etapas nas tarefas do planejamento semanal
-- Seguro para executar mais de uma vez. NÃO apaga nem altera dados existentes.
-- Cole no Supabase > SQL Editor > New query > Run.

-- 1) Campo de notas na tarefa (texto longo; fica NULL nas tarefas antigas)
alter table public.study_tasks
  add column if not exists notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'study_tasks_notes_length' and conrelid = 'public.study_tasks'::regclass
  ) then
    alter table public.study_tasks
      add constraint study_tasks_notes_length check (notes is null or char_length(notes) <= 50000);
  end if;
end $$;

-- 2) Etapas (checklist). Ficam ligadas à TAREFA, não ao dia: mudar a data não perde nada.
create table if not exists public.study_task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.study_tasks(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null check (char_length(trim(text)) > 0 and char_length(text) <= 300),
  completed boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists study_task_steps_task_idx
  on public.study_task_steps (task_id, position);

-- 3) Segurança (RLS): só o dono lê e altera, e só em tarefas dele
alter table public.study_task_steps enable row level security;

drop policy if exists "study_task_steps: dono" on public.study_task_steps;
create policy "study_task_steps: dono" on public.study_task_steps
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.study_tasks t
      where t.id = task_id and t.user_id = auth.uid()
    )
  );
