-- PASSO 17: busca global (cadernos por título e CONTEÚDO, flashcards e questões)
-- Só CRIA uma função nova. Não altera nem apaga tabelas, colunas ou dados.
-- A função respeita as regras de acesso (RLS): cada pessoa só encontra o que é dela.
-- Cole no Supabase > SQL Editor > New query > Run.

create or replace function public.search_study(term text, max_per_group int default 8)
returns table (kind text, id uuid, page_id uuid, title text, snippet text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  t text := btrim(coalesce(term, ''));
  pat text;
begin
  if char_length(t) < 2 then
    return;
  end if;
  pat := '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- 1) Cadernos/páginas: título e texto dentro do editor (só os trechos de texto, sem códigos do JSON)
  return query
  select 'caderno'::text, p.id, p.id, p.title,
         case when pos.n > 0 then substr(c.body, greatest(pos.n - 40, 1), 120) end
  from public.pages p
  cross join lateral (
    select coalesce(string_agg(x, ' '), '') as body
    from jsonb_array_elements_text(
      coalesce(jsonb_path_query_array(p.content, 'strict $.**.text'), '[]'::jsonb)
    ) x
  ) c
  cross join lateral (select position(lower(t) in lower(c.body)) as n) pos
  where p.title ilike pat or c.body ilike pat
  order by p.updated_at desc
  limit max_per_group;

  -- 2) Flashcards e questões salvos em Revisões
  return query
  select s.kind, s.id, s.page_id, left(s.question, 140),
         left(s.answer, 120)
  from public.study_cards s
  where s.question ilike pat or s.answer ilike pat or coalesce(s.explanation, '') ilike pat
  order by s.created_at desc
  limit max_per_group * 2;

  -- 3) Itens gerados pela assistente (só se essa tabela já existir no seu banco)
  if to_regclass('public.study_review_items') is not null then
    return query execute
      'select i.type, i.id, i.page_id, left(i.title, 140), left(i.back, 120)
         from public.study_review_items i
        where i.title ilike $1 or i.front ilike $1 or i.back ilike $1
        order by i.created_at desc
        limit $2'
    using pat, max_per_group * 2;
  end if;
end;
$$;

grant execute on function public.search_study(text, int) to authenticated;
