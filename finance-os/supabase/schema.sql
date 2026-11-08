-- CFoh! cloud schema. Run once in the Supabase SQL editor (Dashboard -> SQL -> New query).
-- One row per workspace, one private file per workspace. Every row and file is
-- readable and writable only by the user who owns it (row-level security).

create table if not exists public.workspaces (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  business_name text not null,
  owner_name    text not null,
  template      text not null default 'blank',
  version       integer not null default 0,
  saved_at      timestamptz,
  encrypted     boolean not null default false,
  salt          text,
  iv            text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists workspaces_user_id_idx on public.workspaces (user_id);

alter table public.workspaces enable row level security;

drop policy if exists "workspaces: owner can do everything" on public.workspaces;
create policy "workspaces: owner can do everything"
  on public.workspaces
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Private bucket for the SQLite images: <user_id>/<workspace_id>.sqlite
insert into storage.buckets (id, name, public, file_size_limit)
values ('workspaces', 'workspaces', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "workspace files: owner read" on storage.objects;
create policy "workspace files: owner read"
  on storage.objects for select to authenticated
  using (bucket_id = 'workspaces' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "workspace files: owner insert" on storage.objects;
create policy "workspace files: owner insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'workspaces' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "workspace files: owner update" on storage.objects;
create policy "workspace files: owner update"
  on storage.objects for update to authenticated
  using (bucket_id = 'workspaces' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'workspaces' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "workspace files: owner delete" on storage.objects;
create policy "workspace files: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'workspaces' and (storage.foldername(name))[1] = auth.uid()::text);

-- Recommended Auth settings (Dashboard -> Authentication -> Providers -> Email):
--   Enable email provider; keep "Confirm email" ON for public sign-ups.
--   Dashboard -> Authentication -> URL configuration:
--   Site URL  https://abdurrub.com/cfoh/   and add it to Redirect URLs.
