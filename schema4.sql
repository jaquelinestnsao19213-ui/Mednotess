-- PASSO 4 (módulos 1 e 2): disciplinas e assuntos
-- Só cria tabelas novas. Nada que já existe é alterado ou apagado.
-- Cole no Supabase (projeto NOVO) > SQL Editor > New query > Run

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#0f766e',
  icon text,
  -- caderno da disciplina (uma página que já existe no app).
  -- Se a página for apagada, a disciplina continua e só perde o vínculo.
  notebook_page_id uuid references public.pages(id) on delete set null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null,
  -- página do caderno ligada a este assunto (opcional)
  page_id uuid references public.pages(id) on delete set null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index subjects_user_idx on public.subjects (user_id, position);
create index topics_subject_idx on public.topics (subject_id, position);

alter table public.subjects enable row level security;
alter table public.topics enable row level security;

create policy "subjects: dono" on public.subjects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- o assunto só pode apontar para uma disciplina do próprio usuário
create policy "topics: dono" on public.topics
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.subjects s where s.id = subject_id and s.user_id = auth.uid())
  );
