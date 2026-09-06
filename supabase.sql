-- Run this file once in Supabase: SQL Editor > New query > paste > Run.
-- Enable Authentication > Providers > Anonymous sign-ins before opening ConnectChat.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 30),
  status text not null default '' check (char_length(status) <= 120),
  profile_image text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  created_at timestamptz not null default now()
);

create table if not exists public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null unique references public.chats(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 500),
  image text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (group_id, user_id)
);

create index if not exists messages_by_chat_created on public.messages(chat_id, created_at);
create index if not exists chat_members_by_user on public.chat_members(user_id);
create index if not exists group_members_by_user on public.group_members(user_id);

create or replace function public.is_chat_member(target_chat uuid, target_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.chat_members where chat_id = target_chat and user_id = target_user);
$$;

create or replace function public.is_group_member(target_group uuid, target_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.group_members where group_id = target_group and user_id = target_user);
$$;

create or replace function public.is_group_admin(target_group uuid, target_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.group_members where group_id = target_group and user_id = target_user and role in ('owner', 'admin'));
$$;

create or replace function public.create_direct_chat(target_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare target_chat uuid;
begin
  if auth.uid() is null or target_user = auth.uid() then raise exception 'Invalid chat member'; end if;
  if not exists (select 1 from public.profiles where id = target_user) then raise exception 'User not found'; end if;
  select first_member.chat_id into target_chat
  from public.chat_members first_member join public.chat_members second_member on second_member.chat_id = first_member.chat_id
  join public.chats on chats.id = first_member.chat_id
  where chats.kind = 'direct' and first_member.user_id = auth.uid() and second_member.user_id = target_user
  limit 1;
  if target_chat is null then
    insert into public.chats(kind) values ('direct') returning id into target_chat;
    insert into public.chat_members(chat_id, user_id) values (target_chat, auth.uid()), (target_chat, target_user);
  end if;
  return target_chat;
end;
$$;

create or replace function public.create_group(group_name text, group_description text, group_image text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare target_chat uuid; target_group uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if char_length(trim(group_name)) not between 3 and 80 or char_length(group_description) > 500 then raise exception 'Invalid group details'; end if;
  insert into public.chats(kind) values ('group') returning id into target_chat;
  insert into public.groups(chat_id, owner_id, name, description, image)
  values (target_chat, auth.uid(), trim(group_name), trim(group_description), coalesce(group_image, '')) returning id into target_group;
  insert into public.group_members(group_id, user_id, role) values (target_group, auth.uid(), 'owner');
  insert into public.chat_members(chat_id, user_id) values (target_chat, auth.uid());
  return target_group;
end;
$$;

create or replace function public.accept_join_request(request_id uuid, accept_request boolean)
returns void language plpgsql security definer set search_path = public as $$
declare request_row public.join_requests; group_chat uuid;
begin
  select * into request_row from public.join_requests where id = request_id and status = 'requested' for update;
  if request_row is null then raise exception 'Request not found'; end if;
  if not public.is_group_admin(request_row.group_id, auth.uid()) then raise exception 'Not allowed'; end if;
  update public.join_requests set status = case when accept_request then 'accepted' else 'declined' end, decided_at = now() where id = request_id;
  if accept_request then
    select chat_id into group_chat from public.groups where id = request_row.group_id;
    insert into public.group_members(group_id, user_id, role) values (request_row.group_id, request_row.user_id, 'member') on conflict do nothing;
    insert into public.chat_members(chat_id, user_id) values (group_chat, request_row.user_id) on conflict do nothing;
  end if;
end;
$$;

create or replace function public.manage_group_member(target_group uuid, target_user uuid, member_action text)
returns void language plpgsql security definer set search_path = public as $$
declare actor_role text; target_role text; group_chat uuid;
begin
  select role into actor_role from public.group_members where group_id = target_group and user_id = auth.uid();
  select role into target_role from public.group_members where group_id = target_group and user_id = target_user;
  if actor_role not in ('owner', 'admin') or target_role is null or target_role = 'owner' then raise exception 'Not allowed'; end if;
  if member_action in ('admin', 'member') and actor_role <> 'owner' then raise exception 'Only owners can change roles'; end if;
  if member_action = 'remove' and actor_role = 'admin' and target_role <> 'member' then raise exception 'Admins can only remove members'; end if;
  if member_action = 'remove' then
    select chat_id into group_chat from public.groups where id = target_group;
    delete from public.group_members where group_id = target_group and user_id = target_user;
    delete from public.chat_members where chat_id = group_chat and user_id = target_user;
  elsif member_action in ('admin', 'member') then
    update public.group_members set role = member_action where group_id = target_group and user_id = target_user;
  else
    raise exception 'Invalid member action';
  end if;
end;
$$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.chats, public.chat_members, public.messages, public.groups, public.group_members, public.join_requests to authenticated;
grant execute on function public.is_chat_member(uuid, uuid), public.is_group_member(uuid, uuid), public.is_group_admin(uuid, uuid), public.create_direct_chat(uuid), public.create_group(text, text, text), public.accept_join_request(uuid, boolean), public.manage_group_member(uuid, uuid, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.join_requests enable row level security;

create policy "profiles are discoverable" on public.profiles for select to authenticated using (true);
create policy "users create their profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "users update their profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "members see chats" on public.chats for select to authenticated using (public.is_chat_member(id, auth.uid()));
create policy "members see chat members" on public.chat_members for select to authenticated using (public.is_chat_member(chat_id, auth.uid()));
create policy "users mark chats read" on public.chat_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members see messages" on public.messages for select to authenticated using (public.is_chat_member(chat_id, auth.uid()));
create policy "members send messages" on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.is_chat_member(chat_id, auth.uid()));
create policy "users see group directory" on public.groups for select to authenticated using (true);
create policy "members see group members" on public.group_members for select to authenticated using (public.is_group_member(group_id, auth.uid()));
create policy "users see own requests" on public.join_requests for select to authenticated using (user_id = auth.uid() or public.is_group_admin(group_id, auth.uid()));
create policy "users request membership" on public.join_requests for insert to authenticated with check (user_id = auth.uid() and not public.is_group_member(group_id, auth.uid()));
create policy "admins update groups" on public.groups for update to authenticated using (public.is_group_admin(id, auth.uid())) with check (public.is_group_admin(id, auth.uid()));
create policy "owners delete groups" on public.groups for delete to authenticated using (owner_id = auth.uid());

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.chat_members;
alter publication supabase_realtime add table public.group_members;
alter publication supabase_realtime add table public.join_requests;