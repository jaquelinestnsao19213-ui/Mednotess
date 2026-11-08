-- PASSO 9: Revisões (flashcards e questões) + histórico completo da assistente das páginas
-- Cria 1 tabela nova e adiciona 1 coluna nova; não altera nem apaga nada que já existe.
-- Rode DEPOIS do schema8.sql. Cole no Supabase > SQL Editor > New query > Run.

create table if not exists public.study_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_id uuid references public.pages(id) on delete set null,
  source_title text not null default '',
  kind text not null check (kind in ('flashcard', 'question')),
  question text not null,
  answer text not null,
  explanation text,
  options jsonb,
  correct_index int,
  -- controle de revisão (repetição espaçada)
  due_at timestamptz not null default now(),
  interval_days int not null default 0,
  ease numeric not null default 2.5,
  reps int not null default 0,
  lapses int not null default 0,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists study_cards_user_due_idx on public.study_cards (user_id, due_at);
create index if not exists study_cards_page_idx on public.study_cards (page_id);

alter table public.study_cards enable row level security;

drop policy if exists "study_cards: dono" on public.study_cards;
create policy "study_cards: dono" on public.study_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- guarda os cartões e sugestões que a assistente gerou dentro de cada mensagem do histórico
alter table public.chat_messages
  add column if not exists meta jsonb;
