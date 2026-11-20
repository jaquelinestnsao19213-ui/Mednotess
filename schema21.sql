-- PASSO 21: publicar uma página para outras pessoas verem (somente leitura)
-- Só ADICIONA 2 colunas na tabela pages e cria 1 função. Nada do que você já escreveu é alterado ou apagado.
-- Quem recebe o link vê a página exata (texto, imagens, vídeos do YouTube etc.), mas não consegue editar,
-- nem ver as suas outras páginas. Para parar de compartilhar, basta clicar em "Parar de compartilhar" na página.
-- Cole no Supabase > SQL Editor > New query > Run (pode rodar mais de uma vez sem erro)

alter table public.pages add column if not exists share_token text;
alter table public.pages add column if not exists shared_at timestamptz;

create unique index if not exists pages_share_token_key on public.pages (share_token) where share_token is not null;

-- Devolve SOMENTE a página cujo código de compartilhamento foi informado (códigos têm 48 caracteres aleatórios).
-- Roda com permissão do banco para quem ainda não entrou no app conseguir abrir o link; nada além dessa página é exposto.
create or replace function public.get_shared_page(token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'type', p.type,
    'title', p.title,
    'icon', p.icon,
    'cover_url', p.cover_url,
    'props', p.props,
    'content', p.content
  )
  from public.pages p
  where p.share_token is not null and p.share_token = token
  limit 1;
$$;

revoke all on function public.get_shared_page(text) from public;
grant execute on function public.get_shared_page(text) to anon, authenticated;
