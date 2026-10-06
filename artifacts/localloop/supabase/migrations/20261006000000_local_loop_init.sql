-- LocalLoop initial Supabase schema.
-- Apply once to the Supabase project configured for this app.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  username text,
  email text,
  avatar_url text,
  bio text,
  city text,
  interests text[] not null default '{}',
  role text not null default 'participant'
    check (role in ('participant', 'organizer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null;
create index if not exists profiles_city_idx on public.profiles (city);
create index if not exists profiles_role_idx on public.profiles (role);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  icon text,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text not null,
  cover_image_url text,
  location_name text not null,
  address text,
  city text not null,
  latitude double precision,
  longitude double precision,
  start_time timestamptz not null,
  end_time timestamptz,
  capacity integer,
  attendee_count integer not null default 0,
  is_online boolean not null default false,
  online_url text,
  status text not null default 'published'
    check (status in ('draft', 'published', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_capacity_positive check (capacity is null or capacity > 0),
  constraint events_attendee_count_nonnegative check (attendee_count >= 0),
  constraint events_end_after_start check (end_time is null or end_time > start_time),
  constraint events_online_url_required check (not is_online or online_url is not null)
);

create index if not exists events_city_start_idx
  on public.events (lower(city), start_time);
create index if not exists events_status_start_idx
  on public.events (status, start_time);
create index if not exists events_organizer_created_idx
  on public.events (organizer_id, created_at desc);
create index if not exists events_location_coords_idx
  on public.events (latitude, longitude)
  where latitude is not null and longitude is not null;

create table if not exists public.event_categories (
  event_id uuid not null references public.events (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (event_id, category_id)
);
create index if not exists event_categories_category_idx
  on public.event_categories (category_id, event_id);

create table if not exists public.event_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'going' check (status in ('going', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists event_attendees_user_status_idx
  on public.event_attendees (user_id, status, created_at desc);
create index if not exists event_attendees_event_status_idx
  on public.event_attendees (event_id, status, created_at);

create table if not exists public.saved_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists saved_events_user_created_idx
  on public.saved_events (user_id, created_at desc);

create table if not exists public.event_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  reported_by uuid not null references public.profiles (id) on delete cascade,
  reason text not null,
  description text,
  status text not null default 'pending'
    check (status in ('pending', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz not null default now()
);
create index if not exists event_reports_status_created_idx
  on public.event_reports (status, created_at);
create index if not exists event_reports_reporter_created_idx
  on public.event_reports (reported_by, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  message text not null,
  type text not null,
  read boolean not null default false,
  event_id uuid references public.events (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_unread_created_idx
  on public.notifications (user_id, read, created_at desc);

create or replace function public.localloop_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.localloop_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.localloop_protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and not public.localloop_is_admin() then
    raise exception 'Only an administrator can change account roles'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.localloop_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    new.email,
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists localloop_profiles_updated_at on public.profiles;
create trigger localloop_profiles_updated_at
  before update on public.profiles
  for each row execute function public.localloop_touch_updated_at();

drop trigger if exists localloop_profiles_protect_role on public.profiles;
create trigger localloop_profiles_protect_role
  before update on public.profiles
  for each row execute function public.localloop_protect_profile_role();

drop trigger if exists localloop_events_updated_at on public.events;
create trigger localloop_events_updated_at
  before update on public.events
  for each row execute function public.localloop_touch_updated_at();

drop trigger if exists localloop_auth_user_created on auth.users;
create trigger localloop_auth_user_created
  after insert on auth.users
  for each row execute function public.localloop_handle_new_user();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.events enable row level security;
alter table public.event_categories enable row level security;
alter table public.event_attendees enable row level security;
alter table public.saved_events enable row level security;
alter table public.event_reports enable row level security;
alter table public.notifications enable row level security;

drop policy if exists localloop_profiles_read_own_or_admin on public.profiles;
create policy localloop_profiles_read_own_or_admin
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.localloop_is_admin());

drop policy if exists localloop_profiles_update_own_or_admin on public.profiles;
create policy localloop_profiles_update_own_or_admin
  on public.profiles for update to authenticated
  using (id = auth.uid() or public.localloop_is_admin())
  with check (id = auth.uid() or public.localloop_is_admin());

drop policy if exists localloop_categories_read_public on public.categories;
create policy localloop_categories_read_public
  on public.categories for select to anon, authenticated
  using (true);

drop policy if exists localloop_categories_admin_manage on public.categories;
create policy localloop_categories_admin_manage
  on public.categories for all to authenticated
  using (public.localloop_is_admin())
  with check (public.localloop_is_admin());

drop policy if exists localloop_events_read_published_or_owner on public.events;
create policy localloop_events_read_published_or_owner
  on public.events for select to anon, authenticated
  using (status = 'published' or organizer_id = auth.uid() or public.localloop_is_admin());

drop policy if exists localloop_events_insert_self on public.events;
create policy localloop_events_insert_self
  on public.events for insert to authenticated
  with check (organizer_id = auth.uid());

drop policy if exists localloop_events_update_owner_or_admin on public.events;
create policy localloop_events_update_owner_or_admin
  on public.events for update to authenticated
  using (organizer_id = auth.uid() or public.localloop_is_admin())
  with check (organizer_id = auth.uid() or public.localloop_is_admin());

drop policy if exists localloop_events_delete_owner_or_admin on public.events;
create policy localloop_events_delete_owner_or_admin
  on public.events for delete to authenticated
  using (organizer_id = auth.uid() or public.localloop_is_admin());

drop policy if exists localloop_event_categories_read_visible_event on public.event_categories;
create policy localloop_event_categories_read_visible_event
  on public.event_categories for select to anon, authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and (e.status = 'published' or e.organizer_id = auth.uid() or public.localloop_is_admin())
    )
  );

drop policy if exists localloop_event_categories_insert_owner on public.event_categories;
create policy localloop_event_categories_insert_owner
  on public.event_categories for insert to authenticated
  with check (
    public.localloop_is_admin()
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.organizer_id = auth.uid()
    )
  );

drop policy if exists localloop_event_categories_delete_owner on public.event_categories;
create policy localloop_event_categories_delete_owner
  on public.event_categories for delete to authenticated
  using (
    public.localloop_is_admin()
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.organizer_id = auth.uid()
    )
  );

drop policy if exists localloop_attendees_read_self_owner_admin on public.event_attendees;
create policy localloop_attendees_read_self_owner_admin
  on public.event_attendees for select to authenticated
  using (
    user_id = auth.uid()
    or public.localloop_is_admin()
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.organizer_id = auth.uid()
    )
  );

drop policy if exists localloop_saved_events_read_self on public.saved_events;
create policy localloop_saved_events_read_self
  on public.saved_events for select to authenticated
  using (user_id = auth.uid() or public.localloop_is_admin());

drop policy if exists localloop_saved_events_insert_self on public.saved_events;
create policy localloop_saved_events_insert_self
  on public.saved_events for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists localloop_saved_events_delete_self on public.saved_events;
create policy localloop_saved_events_delete_self
  on public.saved_events for delete to authenticated
  using (user_id = auth.uid() or public.localloop_is_admin());

drop policy if exists localloop_reports_insert_self on public.event_reports;
create policy localloop_reports_insert_self
  on public.event_reports for insert to authenticated
  with check (
    reported_by = auth.uid()
    and exists (
      select 1 from public.events e
      where e.id = event_id and e.status = 'published'
    )
  );

drop policy if exists localloop_reports_read_reporter_admin on public.event_reports;
create policy localloop_reports_read_reporter_admin
  on public.event_reports for select to authenticated
  using (reported_by = auth.uid() or public.localloop_is_admin());

drop policy if exists localloop_reports_admin_manage on public.event_reports;
create policy localloop_reports_admin_manage
  on public.event_reports for update to authenticated
  using (public.localloop_is_admin())
  with check (public.localloop_is_admin());

drop policy if exists localloop_notifications_read_self on public.notifications;
create policy localloop_notifications_read_self
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists localloop_notifications_update_self on public.notifications;
create policy localloop_notifications_update_self
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.rsvp_to_event(p_event_id uuid)
returns public.event_attendees
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events%rowtype;
  v_attendee public.event_attendees%rowtype;
begin
  if v_user_id is null then
    raise exception 'Sign in to RSVP' using errcode = '28000';
  end if;

  select * into v_event
  from public.events
  where id = p_event_id
  for update;

  if not found or v_event.status <> 'published' then
    raise exception 'This event is not available for RSVP' using errcode = 'P0002';
  end if;
  if v_event.start_time <= now() then
    raise exception 'This event has already started' using errcode = '22023';
  end if;

  select * into v_attendee
  from public.event_attendees
  where event_id = p_event_id and user_id = v_user_id;

  if found and v_attendee.status = 'going' then
    return v_attendee;
  end if;

  if v_event.capacity is not null and v_event.attendee_count >= v_event.capacity then
    raise exception 'This event is full' using errcode = '23514';
  end if;

  insert into public.event_attendees (event_id, user_id, status)
  values (p_event_id, v_user_id, 'going')
  on conflict (event_id, user_id)
  do update set status = 'going'
  returning * into v_attendee;

  update public.events
  set attendee_count = attendee_count + 1
  where id = p_event_id;

  if v_event.organizer_id <> v_user_id then
    insert into public.notifications (user_id, title, message, type, event_id)
    values (
      v_event.organizer_id,
      'New event RSVP',
      'Someone joined ' || v_event.title || '.',
      'rsvp',
      p_event_id
    );
  end if;

  return v_attendee;
end;
$$;

create or replace function public.cancel_event_rsvp(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_organizer_id uuid;
  v_title text;
begin
  if v_user_id is null then
    raise exception 'Sign in to cancel an RSVP' using errcode = '28000';
  end if;

  select organizer_id, title into v_organizer_id, v_title
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  update public.event_attendees
  set status = 'cancelled'
  where event_id = p_event_id
    and user_id = v_user_id
    and status = 'going';

  if found then
    update public.events
    set attendee_count = greatest(attendee_count - 1, 0)
    where id = p_event_id;

    if v_organizer_id <> v_user_id then
      insert into public.notifications (user_id, title, message, type, event_id)
      values (
        v_organizer_id,
        'An attendee cancelled',
        'An attendee cancelled their RSVP for ' || v_title || '.',
        'rsvp_cancelled',
        p_event_id
      );
    end if;
    return true;
  end if;
  return false;
end;
$$;

grant execute on function public.rsvp_to_event(uuid) to authenticated;
grant execute on function public.cancel_event_rsvp(uuid) to authenticated;
grant execute on function public.localloop_is_admin() to anon, authenticated;

create or replace function public.set_event_categories(
  p_event_id uuid,
  p_category_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to edit event categories' using errcode = '28000';
  end if;
  if not public.localloop_is_admin()
     and not exists (
       select 1 from public.events
       where id = p_event_id and organizer_id = auth.uid()
     ) then
    raise exception 'You cannot edit categories for this event'
      using errcode = '42501';
  end if;

  delete from public.event_categories
  where event_id = p_event_id;

  insert into public.event_categories (event_id, category_id)
  select p_event_id, category_id
  from unnest(coalesce(p_category_ids, '{}'::uuid[])) as category_id
  on conflict (event_id, category_id) do nothing;
end;
$$;

grant execute on function public.set_event_categories(uuid, uuid[]) to authenticated;

create or replace view public.public_profiles as
select id, full_name, username, avatar_url, bio, city, interests, role, created_at
from public.profiles;
grant select on public.public_profiles to anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.categories, public.events, public.event_categories to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant insert, update, delete on public.events to authenticated;
grant insert, delete on public.event_categories to authenticated;
grant select on public.event_attendees to authenticated;
grant select, insert, delete on public.saved_events to authenticated;
grant select, insert, update on public.event_reports to authenticated;
grant select, update on public.notifications to authenticated;

insert into public.categories (name, description, icon)
values
  ('Technology', 'Meetups, talks, and hands-on technology sessions.', 'Code2'),
  ('Music', 'Live music, listening parties, and community performances.', 'Music2'),
  ('Sports', 'Group sports, outdoor activity, and friendly competition.', 'Dumbbell'),
  ('Education', 'Learning circles, talks, and peer-led skill sharing.', 'GraduationCap'),
  ('Art & Culture', 'Exhibitions, creative practice, and cultural gatherings.', 'Palette'),
  ('Food', 'Shared meals, tastings, and neighborhood food events.', 'Utensils'),
  ('Environment', 'Local conservation, gardening, and climate action.', 'Leaf'),
  ('Volunteering', 'Ways to support people and organizations nearby.', 'HandHeart'),
  ('Networking', 'Meet people and build community around shared work.', 'Users'),
  ('Workshop', 'Practical, hands-on sessions led by local hosts.', 'Hammer'),
  ('Health', 'Wellbeing, movement, and supportive community events.', 'HeartPulse'),
  ('Community', 'Gatherings that bring neighbors together.', 'House')
on conflict (name) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp']),
  ('event-images', 'event-images', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists localloop_public_media_read on storage.objects;
create policy localloop_public_media_read
  on storage.objects for select to anon, authenticated
  using (bucket_id in ('avatars', 'event-images'));

drop policy if exists localloop_avatars_insert_self on storage.objects;
create policy localloop_avatars_insert_self
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists localloop_avatars_update_self on storage.objects;
create policy localloop_avatars_update_self
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists localloop_avatars_delete_self on storage.objects;
create policy localloop_avatars_delete_self
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists localloop_event_images_insert_owner on storage.objects;
create policy localloop_event_images_insert_owner
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      (storage.foldername(name))[2] = 'draft'
      or exists (
        select 1 from public.events e
        where e.id::text = (storage.foldername(name))[2]
          and e.organizer_id = auth.uid()
      )
    )
  );

drop policy if exists localloop_event_images_update_owner on storage.objects;
create policy localloop_event_images_update_owner
  on storage.objects for update to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      (storage.foldername(name))[2] = 'draft'
      or exists (
        select 1 from public.events e
        where e.id::text = (storage.foldername(name))[2]
          and e.organizer_id = auth.uid()
      )
    )
  )
  with check (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      (storage.foldername(name))[2] = 'draft'
      or exists (
        select 1 from public.events e
        where e.id::text = (storage.foldername(name))[2]
          and e.organizer_id = auth.uid()
      )
    )
  );

drop policy if exists localloop_event_images_delete_owner on storage.objects;
create policy localloop_event_images_delete_owner
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      (storage.foldername(name))[2] = 'draft'
      or exists (
        select 1 from public.events e
        where e.id::text = (storage.foldername(name))[2]
          and e.organizer_id = auth.uid()
      )
    )
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'events'
    ) then
      alter publication supabase_realtime add table public.events;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'event_attendees'
    ) then
      alter publication supabase_realtime add table public.event_attendees;
    end if;
  end if;
end;
$$;
