-- Persist conversations from the page-specific AI assistant.
-- Run this file only in the Supabase SQL Editor after public.pages exists.

create table if not exists public.page_assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_id uuid references public.pages(id) on delete set null,
  page_title text not null default '',
  title text not null default 'Nova conversa',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists page_assistant_conversations_user_page_idx
  on public.page_assistant_conversations (user_id, page_id, updated_at desc);

alter table public.page_assistant_conversations enable row level security;
drop policy if exists "page_assistant_conversations: dono" on public.page_assistant_conversations;
create policy "page_assistant_conversations: dono" on public.page_assistant_conversations
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
grant select, insert, update, delete on public.page_assistant_conversations to authenticated;
