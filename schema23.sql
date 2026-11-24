-- PASSO 23: link único para compartilhar um ASSUNTO inteiro (ex.: "Prova prática" com as 5 aulas e páginas dentro)
-- Só ADICIONA 2 colunas na tabela topics e cria 1 função nova; as 3 funções do link publicado são atualizadas
-- para também entenderem o link de assunto. Nada do que você já escreveu é alterado ou apagado.
-- Os links de PÁGINA que você já enviou continuam funcionando do mesmo jeito.
-- Cole no Supabase > SQL Editor > New query > Run (pode rodar mais de uma vez sem erro)
-- Antes de rodar este, rode o schema21.sql, o schema22.sql, o schema15.sql e o schema16.sql (se ainda não rodou).

alter table public.topics add column if not exists share_token text;
alter table public.topics add column if not exists shared_at timestamptz;

create unique index if not exists topics_share_token_key on public.topics (share_token) where share_token is not null;

-- 0) Quais páginas "abrem" um link: a própria página publicada OU todas as páginas ligadas ao assunto
--    publicado (e aos subassuntos dele). Função interna: não é liberada para ninguém de fora.
create or replace function public.shared_root_pages(p_token text)
returns table(page_id uuid, ord int)
language sql
stable
security definer
set search_path = public
as $$
  with recursive tp(id, d) as (
    select t.id, 0 from public.topics t where t.share_token is not null and t.share_token = p_token
    union
    select c.id, tp.d + 1 from public.topics c join tp on c.parent_id = tp.id where tp.d < 25
  ),
  found as (
    select p.id as pid, coalesce(p.position, 0)::int as ord
    from public.pages p
    where p.share_token is not null and p.share_token = p_token
    union all
    select t.page_id, tp.d * 1000
    from public.topics t join tp on tp.id = t.id
    where t.page_id is not null
    union all
    select l.page_id, tp.d * 1000 + l.position + 1
    from public.topic_pages l join tp on tp.id = l.topic_id
  )
  select f.pid, min(f.ord)::int
  from found f
  group by f.pid;
$$;

-- 1) Índice: o que foi publicado + tudo que está dentro (sem o conteúdo, só títulos).
create or replace function public.get_shared_tree(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with recursive roots as (
    select r.page_id, r.ord from public.shared_root_pages(p_token) r
  ),
  tree as (
    select p.id, p.parent_id, p.type, p.title, p.icon, p.position, 0 as depth, r.ord as ord, true as is_root
    from public.pages p
    join roots r on r.page_id = p.id
    union all
    select c.id, c.parent_id, c.type, c.title, c.icon, c.position, t.depth + 1, 0, false
    from public.pages c
    join tree t on c.parent_id = t.id
    where t.depth < 25
  ),
  uniq as (
    select distinct on (t.id) t.id, t.parent_id, t.type, t.title, t.icon, t.position, t.depth, t.ord, t.is_root
    from tree t
    order by t.id, t.depth
  )
  select case when count(*) = 0 then null else jsonb_build_object(
    'root', (select p.id from public.pages p where p.share_token is not null and p.share_token = p_token limit 1),
    'title', (select tp.name from public.topics tp where tp.share_token is not null and tp.share_token = p_token limit 1),
    'pages', jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'parent_id', case when u.is_root then null else u.parent_id end,
        'type', u.type,
        'title', u.title,
        'icon', u.icon,
        'position', case when u.is_root then u.ord else u.position end
      )
      order by u.depth, case when u.is_root then u.ord else u.position end
    )
  ) end
  from uniq u;
$$;

-- 2) Conteúdo de UMA página, só se ela estiver dentro do que foi publicado com aquele código.
create or replace function public.get_shared_page_in_tree(p_token text, p_page_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with recursive roots as (
    select r.page_id from public.shared_root_pages(p_token) r
  ),
  tree as (
    select p.id, 0 as depth
    from public.pages p
    join roots r on r.page_id = p.id
    union all
    select c.id, t.depth + 1
    from public.pages c
    join tree t on c.parent_id = t.id
    where t.depth < 25
  )
  select jsonb_build_object(
    'id', pg.id,
    'type', pg.type,
    'title', pg.title,
    'icon', pg.icon,
    'cover_url', pg.cover_url,
    'props', pg.props,
    'content', pg.content
  )
  from public.pages pg
  where pg.id = p_page_id
    and exists (select 1 from tree t where t.id = pg.id)
  limit 1;
$$;

-- 3) Os seus comentários e marcações num PDF, para o visitante ver (só leitura),
--    e somente de PDFs que realmente estão dentro do que foi publicado.
create or replace function public.get_shared_pdf_annotations(p_token text, p_doc_url text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with recursive roots as (
    select r.page_id from public.shared_root_pages(p_token) r
  ),
  tree as (
    select p.id, 0 as depth
    from public.pages p
    join roots r on r.page_id = p.id
    union all
    select c.id, t.depth + 1
    from public.pages c
    join tree t on c.parent_id = t.id
    where t.depth < 25
  )
  select coalesce(jsonb_agg(jsonb_build_object('page_number', a.page_number, 'data', a.data)), '[]'::jsonb)
  from public.pdf_annotations a
  where length(p_doc_url) > 10
    and a.doc_url = p_doc_url
    and strpos(a.doc_url, a.user_id::text) > 0
    and exists (
      select 1
      from tree t
      join public.pages pg on pg.id = t.id
      where strpos(pg.content::text, p_doc_url) > 0
    );
$$;

revoke all on function public.shared_root_pages(text) from public;
revoke all on function public.get_shared_tree(text) from public;
revoke all on function public.get_shared_page_in_tree(text, uuid) from public;
revoke all on function public.get_shared_pdf_annotations(text, text) from public;
grant execute on function public.get_shared_tree(text) to anon, authenticated;
grant execute on function public.get_shared_page_in_tree(text, uuid) to anon, authenticated;
grant execute on function public.get_shared_pdf_annotations(text, text) to anon, authenticated;
