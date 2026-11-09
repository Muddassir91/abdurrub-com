-- CFoh! trials and access control. Run once in the Supabase SQL editor, after schema.sql.
--
-- Every account gets a profile row with a 30-day trial. The owner (an email in
-- public.admins) can see every profile and extend or block access from the
-- in-app admin page. Users can only ever read their own row.

create table if not exists public.profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  email          text,
  trial_ends_at  timestamptz not null default (now() + interval '30 days'),
  access_status  text not null default 'trial' check (access_status in ('trial', 'active', 'blocked')),
  plan           text,
  notes          text,
  source         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_seen_at   timestamptz
);

create table if not exists public.admins (
  email text primary key
);

-- The owner. Add more rows for other admins.
insert into public.admins (email) values ('m.a.rab2012@gmail.com') on conflict do nothing;

-- Create the profile automatically when an account is created.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email) values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Back-fill accounts that existed before this script ran.
insert into public.profiles (user_id, email)
select id, email from auth.users
on conflict (user_id) do nothing;

-- Helper the app calls on sign-in to record activity (and to self-heal a missing row).
create or replace function public.touch_profile()
returns public.profiles language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  insert into public.profiles (user_id, email) values (auth.uid(), (auth.jwt() ->> 'email'))
  on conflict (user_id) do update set last_seen_at = now(), email = coalesce(public.profiles.email, excluded.email)
  returning * into p;
  return p;
end $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

alter table public.profiles enable row level security;
alter table public.admins enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles for select to authenticated using (auth.uid() = user_id);

drop policy if exists "profiles: admin read all" on public.profiles;
create policy "profiles: admin read all" on public.profiles for select to authenticated using (public.is_admin());

drop policy if exists "profiles: admin update all" on public.profiles;
create policy "profiles: admin update all" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins: read own membership" on public.admins;
create policy "admins: read own membership" on public.admins for select to authenticated using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

grant execute on function public.touch_profile() to authenticated;
grant execute on function public.is_admin() to authenticated;
