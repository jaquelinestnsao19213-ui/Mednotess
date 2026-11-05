-- PASSO 3: capa das páginas + armazenamento de imagens e PDFs
-- Cole no Supabase (projeto NOVO) > SQL Editor > New query > Run

alter table public.pages add column if not exists cover_url text;

insert into storage.buckets (id, name, public)
values ('files', 'files', true)
on conflict (id) do nothing;

create policy "files_enviar_propria_pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "files_apagar_propria_pasta" on storage.objects
  for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
