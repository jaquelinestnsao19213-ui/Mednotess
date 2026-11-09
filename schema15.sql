-- PASSO 15: vários conteúdos por assunto (vincular páginas de qualquer caderno a uma disciplina)
-- Só cria uma tabela nova. Nada do que você já escreveu é alterado ou apagado.
-- Cole no Supabase > SQL Editor > New query > Run (pode rodar mais de uma vez sem erro)

create table if not exists public.topic_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  -- a página continua morando no caderno dela; aqui é só o atalho (se a página for apagada, o atalho some)
  page_id uuid not null references public.pages(id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (topic_id, page_id)
);

create index if not exists topic_pages_topic_idx on public.topic_pages (topic_id, position);
create index if not exists topic_pages_page_idx on public.topic_pages (page_id);

alter table public.topic_pages enable row level security;

-- As consultas abaixo já respeitam a segurança das outras tabelas: só enxergam o que é seu.
drop policy if exists "topic_pages: dono" on public.topic_pages;
create policy "topic_pages: dono" on public.topic_pages
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.topics t where t.id = topic_id)
    and exists (select 1 from public.pages p where p.id = page_id)
  );
