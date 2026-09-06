-- Run this file once AFTER supabase.sql in Supabase SQL Editor.
-- It adds secure site-wide administration. Do not put an admin password in JavaScript.

alter table public.profiles
  add column if not exists role text not null default 'user' check (role in ('user', 'site_admin')),
  add column if not exists is_blocked boolean not null default false;

create or replace function public.is_site_admin(target_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = target_user and role = 'site_admin' and not is_blocked);
$$;

create or replace function public.is_active_user(target_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = target_user and not is_blocked);
$$;

create or replace function public.create_direct_chat(target_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare target_chat uuid;
begin
  if auth.uid() is null or target_user = auth.uid() then raise exception 'Invalid chat member'; end if;
  if not public.is_active_user(auth.uid()) or not public.is_active_user(target_user) then raise exception 'Blocked accounts cannot use chats'; end if;
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
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'Blocked accounts cannot create groups'; end if;
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
  if not public.is_active_user(auth.uid()) then raise exception 'Blocked accounts cannot manage groups'; end if;
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
  if not public.is_active_user(auth.uid()) then raise exception 'Blocked accounts cannot manage groups'; end if;
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

create or replace function public.admin_search_users(search_term text default '')
returns table (id uuid, username text, status text, profile_image text, role text, is_blocked boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_site_admin(auth.uid()) then raise exception 'Admin access required'; end if;
  return query
    select p.id, p.username, p.status, p.profile_image, p.role, p.is_blocked
    from public.profiles p
    where search_term = '' or p.username ilike '%' || replace(replace(search_term, '%', '\\%'), '_', '\\_') || '%' escape '\\'
    order by p.username
    limit 50;
end;
$$;

create or replace function public.set_account_blocked(target_user uuid, blocked boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_site_admin(auth.uid()) then raise exception 'Admin access required'; end if;
  if target_user = auth.uid() then raise exception 'You cannot block your own account'; end if;
  update public.profiles set is_blocked = blocked where id = target_user and role <> 'site_admin';
  if not found then raise exception 'Account not found or protected'; end if;
end;
$$;

grant execute on function public.is_site_admin(uuid), public.is_active_user(uuid), public.create_direct_chat(uuid), public.admin_search_users(text), public.set_account_blocked(uuid, boolean) to authenticated;

revoke update on public.profiles from authenticated;
grant update (status, profile_image) on public.profiles to authenticated;

drop policy if exists "users create their profile" on public.profiles;
drop policy if exists "active users create their profile" on public.profiles;
create policy "active users create their profile" on public.profiles for insert to authenticated with check (id = auth.uid() and not is_blocked and role = 'user');

drop policy if exists "profiles are discoverable" on public.profiles;
drop policy if exists "active users discover profiles" on public.profiles;
create policy "profiles are discoverable" on public.profiles for select to authenticated using (true);

drop policy if exists "users update their profile" on public.profiles;
drop policy if exists "active users update their profile" on public.profiles;
create policy "active users update their profile" on public.profiles for update to authenticated using (id = auth.uid() and public.is_active_user(auth.uid())) with check (id = auth.uid() and role in ('user', 'site_admin') and not is_blocked);

drop policy if exists "members see chats" on public.chats;
drop policy if exists "active members see chats" on public.chats;
create policy "active members see chats" on public.chats for select to authenticated using (public.is_active_user(auth.uid()) and public.is_chat_member(id, auth.uid()));
drop policy if exists "members see chat members" on public.chat_members;
drop policy if exists "active members see chat members" on public.chat_members;
create policy "active members see chat members" on public.chat_members for select to authenticated using (public.is_active_user(auth.uid()) and public.is_chat_member(chat_id, auth.uid()));
drop policy if exists "users mark chats read" on public.chat_members;
drop policy if exists "active users mark chats read" on public.chat_members;
create policy "active users mark chats read" on public.chat_members for update to authenticated using (user_id = auth.uid() and public.is_active_user(auth.uid())) with check (user_id = auth.uid() and public.is_active_user(auth.uid()));
drop policy if exists "members see messages" on public.messages;
drop policy if exists "active members see messages" on public.messages;
create policy "active members see messages" on public.messages for select to authenticated using (public.is_active_user(auth.uid()) and public.is_chat_member(chat_id, auth.uid()));
drop policy if exists "users see group directory" on public.groups;
drop policy if exists "active users see group directory" on public.groups;
create policy "active users see group directory" on public.groups for select to authenticated using (public.is_active_user(auth.uid()));
drop policy if exists "members see group members" on public.group_members;
drop policy if exists "active members see group members" on public.group_members;
create policy "active members see group members" on public.group_members for select to authenticated using (public.is_active_user(auth.uid()) and public.is_group_member(group_id, auth.uid()));
drop policy if exists "users see own requests" on public.join_requests;
drop policy if exists "active users see requests" on public.join_requests;
create policy "active users see requests" on public.join_requests for select to authenticated using (public.is_active_user(auth.uid()) and (user_id = auth.uid() or public.is_group_admin(group_id, auth.uid())));
drop policy if exists "admins update groups" on public.groups;
drop policy if exists "active admins update groups" on public.groups;
create policy "active admins update groups" on public.groups for update to authenticated using (public.is_active_user(auth.uid()) and public.is_group_admin(id, auth.uid())) with check (public.is_active_user(auth.uid()) and public.is_group_admin(id, auth.uid()));
drop policy if exists "owners delete groups" on public.groups;
drop policy if exists "active owners delete groups" on public.groups;
create policy "active owners delete groups" on public.groups for delete to authenticated using (public.is_active_user(auth.uid()) and owner_id = auth.uid());

drop policy if exists "members send messages" on public.messages;
drop policy if exists "active members send messages" on public.messages;
create policy "active members send messages" on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and public.is_active_user(auth.uid()) and public.is_chat_member(chat_id, auth.uid())
);

drop policy if exists "users request membership" on public.join_requests;
drop policy if exists "active users request membership" on public.join_requests;
create policy "active users request membership" on public.join_requests for insert to authenticated with check (
  user_id = auth.uid() and public.is_active_user(auth.uid()) and not public.is_group_member(group_id, auth.uid())
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;

-- After you create your first profile, replace YOUR_USERNAME and run this one statement:
-- update public.profiles set role = 'site_admin' where username = 'YOUR_USERNAME';