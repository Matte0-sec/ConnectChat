-- Run this once in Supabase SQL Editor when upgrading an existing anonymous setup.
-- Enable Authentication > Providers > Email and disable Confirm email after running this migration.

alter table public.profiles
  add column if not exists role text not null default 'user' check (role in ('user', 'site_admin')),
  add column if not exists is_blocked boolean not null default false;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, trim(new.raw_user_meta_data ->> 'username'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

revoke insert on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant update (status, profile_image) on public.profiles to authenticated;
drop policy if exists "users create their profile" on public.profiles;
drop policy if exists "active users create their profile" on public.profiles;
