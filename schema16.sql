-- PASSO 16: subassuntos (assunto dentro de assunto) nas disciplinas
-- Só acrescenta uma coluna opcional. Nada do que você já escreveu é alterado ou apagado.
-- Cole no Supabase > SQL Editor > New query > Run (pode rodar mais de uma vez sem erro)

-- Se um assunto principal for excluído, os subassuntos dele NÃO são apagados: viram assuntos principais.
alter table public.topics
  add column if not exists parent_id uuid references public.topics(id) on delete set null;

create index if not exists topics_parent_idx on public.topics (parent_id);
