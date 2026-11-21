-- Histórico de versões das páginas (cadernos).
-- Só cria uma tabela nova: não altera `pages` nem nenhuma tabela existente.

create table if not exists public.page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text,
  content jsonb,
  origin text not null default 'auto'
    check (origin in ('auto','manual','restore')),
  created_at timestamptz not null default now()
);

create index if not exists page_versions_page_idx
  on public.page_versions (page_id, created_at desc);

alter table public.page_versions enable row level security;

create policy "ver minhas versoes" on public.page_versions
  for select using (auth.uid() = user_id);
create policy "criar minhas versoes" on public.page_versions
  for insert with check (auth.uid() = user_id);
create policy "apagar minhas versoes" on public.page_versions
  for delete using (auth.uid() = user_id);
