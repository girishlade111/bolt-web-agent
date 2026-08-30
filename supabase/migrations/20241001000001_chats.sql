-- Chat history + file snapshots, keyed by session ID (no auth yet, user_id nullable for future migration)
-- Keep IndexedDB as local cache; Postgres is source of truth for cross-device sync.

create extension if not exists "pgcrypto";

create table if not exists public.chats (
  id text primary key,
  session_id text not null,
  user_id uuid null references auth.users(id) on delete set null,
  url_id text,
  description text,
  messages jsonb not null default '[]'::jsonb,
  file_snapshot jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chats_session_id on public.chats(session_id);
create index if not exists idx_chats_user_id on public.chats(user_id) where user_id is not null;
create index if not exists idx_chats_url_id on public.chats(url_id) where url_id is not null;
create index if not exists idx_chats_updated_at on public.chats(updated_at desc);

-- updated_at trigger
create or replace function public.handle_chats_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_chats_updated_at on public.chats;
create trigger trg_chats_updated_at
  before update on public.chats
  for each row execute function public.handle_chats_updated_at();

-- RLS: session-scoped for anon (no auth), service_role bypasses. user_id stays null until auth added.
alter table public.chats enable row level security;

drop policy if exists "chats_select_own_session" on public.chats;
create policy "chats_select_own_session" on public.chats
  for select to anon, authenticated
  using (
    session_id = coalesce(current_setting('app.session_id', true), session_id)
    or auth.role() = 'service_role'
  );

drop policy if exists "chats_insert_own_session" on public.chats;
create policy "chats_insert_own_session" on public.chats
  for insert to anon, authenticated
  with check (
    session_id = coalesce(current_setting('app.session_id', true), session_id)
    or auth.role() = 'service_role'
  );

drop policy if exists "chats_update_own_session" on public.chats;
create policy "chats_update_own_session" on public.chats
  for update to anon, authenticated
  using (session_id = coalesce(current_setting('app.session_id', true), session_id) or auth.role() = 'service_role')
  with check (session_id = coalesce(current_setting('app.session_id', true), session_id) or auth.role() = 'service_role');

drop policy if exists "chats_delete_own_session" on public.chats;
create policy "chats_delete_own_session" on public.chats
  for delete to anon, authenticated
  using (session_id = coalesce(current_setting('app.session_id', true), session_id) or auth.role() = 'service_role');

-- Future migration to user auth is additive: backfill user_id from session → user mapping, then create policy:
-- create policy "chats_user_owns" on public.chats for all to authenticated using (auth.uid() = user_id);
-- No column drop/rename needed because user_id already exists as nullable.
