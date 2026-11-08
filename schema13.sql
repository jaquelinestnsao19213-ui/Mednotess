-- PASSO 13: guarda no histórico da conversa os cartões das atividades criadas pela assistente
-- Só adiciona uma coluna nova; não apaga nem altera nada. Seguro para rodar mais de uma vez.
-- Cole no Supabase > SQL Editor > New query > Run.

alter table public.chat_messages
  add column if not exists actions jsonb;
