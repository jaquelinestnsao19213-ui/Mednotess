-- PASSO 6: biblioteca de links externos do Canva e Google Drive
-- Executar no Supabase > SQL Editor > New query > Run.
-- Cria uma tabela nova; não altera nem remove os dados existentes.

create table if not exists public.resource_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('canva', 'drive')),
  title text not null check (char_length(trim(title)) > 0),
  url text not null check (url ~* '^https?://'),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resource_links_owner_provider_idx
  on public.resource_links (user_id, provider, created_at desc);

alter table public.resource_links enable row level security;

drop policy if exists "resource_links: dono" on public.resource_links;
create policy "resource_links: dono" on public.resource_links
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
