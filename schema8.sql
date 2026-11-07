-- PASSO 8: assistente também no Planejamento semanal + anexos nas conversas
-- Só adiciona colunas novas; não apaga nada. Rode DEPOIS do schema7.sql.
-- Cole no Supabase > SQL Editor > New query > Run.

alter table public.chat_conversations
  add column if not exists scope text not null default 'home';

alter table public.chat_messages
  add column if not exists attachments jsonb;

create index if not exists chat_conversations_scope_idx
  on public.chat_conversations (user_id, scope, updated_at desc);
