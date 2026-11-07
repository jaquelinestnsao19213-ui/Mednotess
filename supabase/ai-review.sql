-- Create persistent, private study material generated from page assistants.
-- Run this file only in the Supabase SQL Editor.

create table if not exists public.study_review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_id uuid references public.pages(id) on delete set null,
  page_title text not null default '',
  type text not null check (type in ('flashcard', 'question')),
  title text not null,
  front text not null,
  back text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null default '',
  explanation text not null default '',
  status text not null default 'new' check (status in ('new', 'review')),
  last_reviewed_at timestamptz,
  next_review_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_review_items_owner_due_idx
  on public.study_review_items (user_id, next_review_at, type);
create index if not exists study_review_items_page_idx
  on public.study_review_items (user_id, page_id, created_at desc);

alter table public.study_review_items enable row level security;

drop policy if exists "study_review_items: dono" on public.study_review_items;
create policy "study_review_items: dono" on public.study_review_items
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.study_review_items to authenticated;
