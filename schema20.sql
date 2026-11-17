-- PASSO 20: texto dos PDFs para a busca inteligente (página por página)
-- Só CRIA uma tabela nova (pdf_chunks). Nada do que você já escreveu é alterado ou apagado.
-- Guarda o texto de cada página dos PDFs anexados, para achar o trecho e dizer em qual página ele está.
-- Cada pessoa vê somente os próprios PDFs (RLS).
-- Cole no Supabase > SQL Editor > New query > Run (pode rodar mais de uma vez sem erro)

create table if not exists public.pdf_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_id uuid references public.pages(id) on delete cascade,  -- página do caderno onde o PDF está anexado
  file_url text not null,
  file_name text not null,
  page_number int not null check (page_number > 0),             -- página do PDF (a primeira é 1)
  content text not null default '',                              -- texto original da página do PDF
  content_fold text not null default '',                         -- o mesmo texto sem acentos e em minúsculas (para buscar)
  created_at timestamptz not null default now(),
  unique (user_id, file_url, page_number)
);

create index if not exists pdf_chunks_user_file_idx on public.pdf_chunks (user_id, file_url);
create index if not exists pdf_chunks_user_page_idx on public.pdf_chunks (user_id, page_id);

alter table public.pdf_chunks enable row level security;

drop policy if exists "pdf_chunks: dono" on public.pdf_chunks;
create policy "pdf_chunks: dono" on public.pdf_chunks
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
