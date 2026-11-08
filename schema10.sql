-- PASSO 10: revisão interativa (quiz, flashcards, relatório e histórico de desempenho)
-- Só adiciona colunas e cria 1 tabela nova; não altera nem apaga nada que já existe.
-- Rode DEPOIS do schema9.sql. Cole no Supabase > SQL Editor > New query > Run.

-- assunto, conceito-chave e comentário por alternativa de cada questão/cartão
alter table public.study_cards add column if not exists topic text;
alter table public.study_cards add column if not exists concept text;
alter table public.study_cards add column if not exists option_notes jsonb;

-- uma linha por quiz ou sessão de flashcards concluída, com o relatório completo
create table if not exists public.review_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mode text not null check (mode in ('quiz', 'flashcards')),
  title text not null default '',
  total int not null default 0,
  correct int not null default 0,
  wrong int not null default 0,
  percent int not null default 0,
  seconds int not null default 0,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists review_attempts_user_idx
  on public.review_attempts (user_id, created_at desc);

alter table public.review_attempts enable row level security;

drop policy if exists "review_attempts: dono" on public.review_attempts;
create policy "review_attempts: dono" on public.review_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
