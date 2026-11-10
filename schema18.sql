-- PASSO 18: Central de Avaliações (provas, simulados e planejamento até a data)
-- Só CRIA uma tabela nova (study_exams). Nada do que você já escreveu é alterado ou apagado.
-- Cada pessoa vê somente as próprias avaliações (RLS).
-- Cole no Supabase > SQL Editor > New query > Run (pode rodar mais de uma vez sem erro)

create table if not exists public.study_exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  kind text not null default 'prova',
  exam_date date not null,
  topic_ids uuid[] not null default '{}',   -- assuntos cobrados na avaliação
  planned_at timestamptz,                    -- quando o cronograma foi enviado ao Planejamento
  created_at timestamptz not null default now()
);

create index if not exists study_exams_user_date_idx on public.study_exams (user_id, exam_date);

alter table public.study_exams enable row level security;

drop policy if exists "study_exams: dono" on public.study_exams;
create policy "study_exams: dono" on public.study_exams
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
