-- PASSO 22: o link publicado mostra tudo que está dentro (cadernos, aulas, páginas e PDFs)
-- Só CRIA 3 funções novas. Nada do que você já escreveu é alterado ou apagado.
-- Quem recebe o link vê a página publicada e tudo que está dentro dela (somente leitura).
-- Cole no Supabase > SQL Editor > New query > Run (pode rodar mais de uma vez sem erro)
-- Antes de rodar este, rode o schema21.sql (se ainda não rodou).

-- 1) Índice: a página publicada + todas as páginas que estão dentro dela (sem o conteúdo, só títulos).
create or replace function public.get_shared_tree(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select p.id, p.parent_id, p.type, p.title, p.icon, p.position, 0 as depth
    from public.pages p
    where p.share_token is not null and p.share_token = p_token
    union all
    select c.id, c.parent_id, c.type, c.title, c.icon, c.position, t.depth + 1
    from public.pages c
    join tree t on c.parent_id = t.id
    where t.depth < 25
  )
  select case when count(*) = 0 then null else jsonb_build_object(
    'root', (select r.id from tree r where r.depth = 0 limit 1),
    'pages', jsonb_agg(
      jsonb_build_object('id', t.id, 'parent_id', t.parent_id, 'type', t.type, 'title', t.title, 'icon', t.icon, 'position', t.position)
      order by t.depth, t.position
    )
  ) end
  from tree t;
$$;

-- 2) Conteúdo de UMA página, só se ela estiver dentro do que foi publicado com aquele código.
create or replace function public.get_shared_page_in_tree(p_token text, p_page_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select p.id, 0 as depth
    from public.pages p
    where p.share_token is not null and p.share_token = p_token
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
  join tree t on t.id = pg.id
  where pg.id = p_page_id
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
  with recursive tree as (
    select p.id, 0 as depth
    from public.pages p
    where p.share_token is not null and p.share_token = p_token
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

revoke all on function public.get_shared_tree(text) from public;
revoke all on function public.get_shared_page_in_tree(text, uuid) from public;
revoke all on function public.get_shared_pdf_annotations(text, text) from public;
grant execute on function public.get_shared_tree(text) to anon, authenticated;
grant execute on function public.get_shared_page_in_tree(text, uuid) to anon, authenticated;
grant execute on function public.get_shared_pdf_annotations(text, text) to anon, authenticated;
