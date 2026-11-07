-- PASSO 9: materiais de revisão e repetição espaçada
-- Rode no Supabase SQL Editor.

create table if not exists public.study_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_id uuid references public.pages(id) on delete cascade,
  page_title text,
  subject_id uuid references public.subjects(id) on delete set null,
  subject_name text,
  type text not null check (type in ('flashcard', 'question')),
  title text not null,
  prompt text not null,
  answer text not null,
  options jsonb,
  correct_option text,
  explanation text,
  due_at timestamptz,
  interval_days integer not null default 1,
  ease double precision not null default 2.5,
  mastery integer not null default 0,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_review_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  material_id uuid not null references public.study_materials(id) on delete cascade,
  correct boolean not null,
  score integer not null default 0,
  reviewed_at timestamptz not null default now()
);

create index if not exists study_materials_user_due_idx on public.study_materials (user_id, next_review_at, type, created_at desc);
create index if not exists study_materials_page_idx on public.study_materials (user_id, page_id, created_at desc);
create index if not exists study_review_logs_material_idx on public.study_review_logs (material_id, reviewed_at desc);

alter table public.study_materials enable row level security;
alter table public.study_review_logs enable row level security;

drop policy if exists "study_materials: dono" on public.study_materials;
create policy "study_materials: dono" on public.study_materials
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "study_review_logs: dono" on public.study_review_logs;
create policy "study_review_logs: dono" on public.study_review_logs
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
