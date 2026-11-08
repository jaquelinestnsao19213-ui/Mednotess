-- PASSO 11: revisão direcionada aos pontos fracos + evolução do desempenho
-- Só adiciona colunas e cria 1 tabela nova; não altera nem apaga nada que já existe.
-- Rode DEPOIS do schema10.sql. Cole no Supabase > SQL Editor > New query > Run.
-- Pode rodar mais de uma vez sem problema.

-- cada tentativa passa a guardar de onde veio (para consultar o material original de novo)
-- e se é uma revisão direcionada, de qual atividade ela nasceu e em que nível de dificuldade
alter table public.review_attempts add column if not exists name text not null default '';
alter table public.review_attempts add column if not exists source_page_ids jsonb not null default '[]'::jsonb;
alter table public.review_attempts add column if not exists source_pdfs jsonb not null default '[]'::jsonb;
alter table public.review_attempts add column if not exists kind text not null default 'original';
alter table public.review_attempts add column if not exists difficulty int;
alter table public.review_attempts add column if not exists focus_topics jsonb not null default '[]'::jsonb;
alter table public.review_attempts add column if not exists parent_attempt_id uuid
  references public.review_attempts(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'review_attempts_kind_check') then
    alter table public.review_attempts
      add constraint review_attempts_kind_check check (kind in ('original', 'focused'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'review_attempts_difficulty_check') then
    alter table public.review_attempts
      add constraint review_attempts_difficulty_check check (difficulty is null or difficulty between 1 and 3);
  end if;
end $$;

-- uma linha por resposta: é daqui que sai a evolução de cada assunto ao longo das atividades
create table if not exists public.review_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  attempt_id uuid not null references public.review_attempts(id) on delete cascade,
  card_id uuid references public.study_cards(id) on delete set null,
  topic text not null,
  topic_key text not null,
  concept text,
  correct boolean not null,
  chosen text,
  seconds int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists review_answers_user_topic_idx
  on public.review_answers (user_id, topic_key, created_at);
create index if not exists review_answers_attempt_idx
  on public.review_answers (attempt_id);

alter table public.review_answers enable row level security;

-- só o dono lê e grava, e a resposta só pode ser ligada a uma tentativa que também é dele
drop policy if exists "review_answers: dono" on public.review_answers;
create policy "review_answers: dono" on public.review_answers
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.review_attempts a where a.id = attempt_id and a.user_id = auth.uid())
  );

-- traz para a evolução os relatórios que você já tinha antes desta atualização (roda só para tentativas sem respostas)
insert into public.review_answers (user_id, attempt_id, card_id, topic, topic_key, concept, correct, chosen, seconds, created_at)
select
  at.user_id,
  at.id,
  (select c.id from public.study_cards c where c.id::text = a->>'cardId'),
  coalesce(nullif(trim(a->>'topic'), ''), 'Geral'),
  trim(regexp_replace(
    translate(lower(coalesce(nullif(trim(a->>'topic'), ''), 'Geral')),
      'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
    '[^a-z0-9]+', ' ', 'g')),
  nullif(a->>'concept', ''),
  coalesce((a->>'correct')::boolean, false),
  nullif(a->>'chosen', ''),
  coalesce((a->>'seconds')::int, 0),
  at.created_at
from public.review_attempts at
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(at.report->'answers') = 'array' then at.report->'answers' else '[]'::jsonb end
) as a
where not exists (select 1 from public.review_answers ra where ra.attempt_id = at.id);
