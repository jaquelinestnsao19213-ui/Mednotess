-- PASSO 14: imagens coladas, ampliadas e desenhadas no editor
-- As imagens usam o bucket "files", que o schema2.sql já cria. Se você JÁ rodou o schema2.sql,
-- NÃO precisa rodar este arquivo. Ele só garante (sem dar erro se já existir) o bucket e as permissões.
-- Cole no Supabase > SQL Editor > New query > Run

insert into storage.buckets (id, name, public)
values ('files', 'files', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'files_enviar_propria_pasta') then
    create policy "files_enviar_propria_pasta" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'files_apagar_propria_pasta') then
    create policy "files_apagar_propria_pasta" on storage.objects
      for delete to authenticated
      using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
