create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  avatar text not null default '🛹' check (avatar in ('🛹', '🧢', '🦊', '🐈', '🌵', '🍊', '🎧', '🌀')),
  created_at timestamptz not null default now()
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friend_requests_not_self check (requester_id <> addressee_id),
  constraint friend_requests_unique_pair unique (requester_id, addressee_id)
);

create table if not exists public.friendships (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint friendships_ordered_pair check (user_a < user_b)
);

create table if not exists public.spots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  source_id text,
  name text not null,
  note text not null default '',
  types text[] not null default '{}',
  has_photo boolean not null default false,
  photo_path text,
  lng double precision not null check (lng between -180 and 180),
  lat double precision not null check (lat between -90 and 90),
  created_at timestamptz not null default now(),
  constraint spots_source_id_unique unique (owner_id, source_id)
);

create index if not exists spots_owner_created_idx on public.spots (owner_id, created_at desc);
create index if not exists friend_requests_addressee_idx on public.friend_requests (addressee_id, created_at desc);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, avatar)
  values (
    new.id,
    lower(new.raw_user_meta_data ->> 'username'),
    coalesce(new.raw_user_meta_data ->> 'avatar', '🛹')
  );
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup
after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

insert into public.profiles (id, username, avatar)
select distinct on (lower(raw_user_meta_data ->> 'username'))
  id,
  lower(raw_user_meta_data ->> 'username'),
  coalesce(raw_user_meta_data ->> 'avatar', '🛹')
from auth.users
where raw_user_meta_data ->> 'username' ~ '^[a-z0-9_]{3,20}$'
order by lower(raw_user_meta_data ->> 'username'), created_at, id
on conflict do nothing;

create or replace function public.send_friend_request(target_username text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  new_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  select id into target_id
  from public.profiles
  where username = lower(trim(target_username));

  if target_id is null then
    raise exception 'そのIDは見つかりません';
  end if;
  if target_id = auth.uid() then
    raise exception '自分自身には申請できません';
  end if;
  if exists (
    select 1 from public.friendships
    where user_a = least(auth.uid(), target_id)
      and user_b = greatest(auth.uid(), target_id)
  ) then
    raise exception 'すでに友達です';
  end if;
  if exists (
    select 1 from public.friend_requests
    where (requester_id = auth.uid() and addressee_id = target_id)
       or (requester_id = target_id and addressee_id = auth.uid())
  ) then
    raise exception '友達申請がすでにあります';
  end if;

  insert into public.friend_requests (requester_id, addressee_id)
  values (auth.uid(), target_id)
  returning id into new_request_id;

  return new_request_id;
end;
$$;

create or replace function public.respond_to_friend_request(request_id uuid, accept_request boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.friend_requests%rowtype;
begin
  select * into request_row
  from public.friend_requests
  where id = request_id and addressee_id = auth.uid()
  for update;

  if not found then
    raise exception '友達申請が見つかりません';
  end if;

  if accept_request then
    insert into public.friendships (user_a, user_b)
    values (least(request_row.requester_id, request_row.addressee_id), greatest(request_row.requester_id, request_row.addressee_id))
    on conflict do nothing;
  end if;

  delete from public.friend_requests where id = request_id;
end;
$$;

create or replace function public.remove_friend(friend_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  delete from public.friendships
  where user_a = least(auth.uid(), friend_user_id)
    and user_b = greatest(auth.uid(), friend_user_id);
end;
$$;

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.spots enable row level security;

create policy "profiles are searchable by signed-in users"
on public.profiles for select to authenticated using (true);
create policy "users update their own profile"
on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "participants read friend requests"
on public.friend_requests for select to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy "requesters cancel their requests"
on public.friend_requests for delete to authenticated using (requester_id = auth.uid());

create policy "friends read their friendship"
on public.friendships for select to authenticated
using (user_a = auth.uid() or user_b = auth.uid());

create policy "spots are readable by their owner and accepted friends"
on public.spots for select to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.friendships
    where (user_a = auth.uid() and user_b = owner_id)
       or (user_b = auth.uid() and user_a = owner_id)
  )
);
create policy "users add their own spots"
on public.spots for insert to authenticated with check (owner_id = auth.uid());
create policy "users update their own spots"
on public.spots for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "users delete their own spots"
on public.spots for delete to authenticated using (owner_id = auth.uid());

grant select on public.profiles, public.friend_requests, public.friendships, public.spots to authenticated;
grant update (avatar) on public.profiles to authenticated;
grant insert, update, delete on public.spots to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.respond_to_friend_request(uuid, boolean) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spot-photos', 'spot-photos', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

create policy "owners and friends read spot photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'spot-photos'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or exists (
      select 1 from public.friendships
      where (user_a = auth.uid() and user_b::text = split_part(name, '/', 1))
         or (user_b = auth.uid() and user_a::text = split_part(name, '/', 1))
    )
  )
);
create policy "users upload their own spot photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'spot-photos' and split_part(name, '/', 1) = auth.uid()::text);
create policy "users delete their own spot photos"
on storage.objects for delete to authenticated
using (bucket_id = 'spot-photos' and split_part(name, '/', 1) = auth.uid()::text);
