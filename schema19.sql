-- PASSO 19: Mapas mentais (guardados no banco, com salvamento automático)
-- Só CRIA uma tabela nova (mind_maps). Nada do que você já escreveu é alterado ou apagado.
-- Cada pessoa vê somente os próprios mapas (RLS).
-- Cole no Supabase > SQL Editor > New query > Run (pode rodar mais de uma vez sem erro)

create table if not exists public.mind_maps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Novo mapa mental' check (char_length(trim(title)) > 0),
  doc jsonb not null default '{}'::jsonb,      -- nós, setas, posições, estilos e vínculos com as anotações
  source_page_ids uuid[] not null default '{}', -- anotações usadas como fonte (para atualizar com a IA)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mind_maps_user_updated_idx on public.mind_maps (user_id, updated_at desc);

alter table public.mind_maps enable row level security;

drop policy if exists "mind_maps: dono" on public.mind_maps;
create policy "mind_maps: dono" on public.mind_maps
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
