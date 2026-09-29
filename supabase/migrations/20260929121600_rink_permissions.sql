alter table public.role
  add column rink_read boolean not null default false,
  add column rink_write boolean not null default false,
  add column skate_session_read boolean not null default false,
  add column skate_session_write boolean not null default false;

update public.role
set rink_read = true,
    rink_write = true,
    skate_session_read = true,
    skate_session_write = true
where name = 'owner';

update public.role
set rink_read = true,
    skate_session_read = true
where name = 'member';

create table public.rink (
  id bigint generated always as identity primary key,
  name text not null,
  foreign_id text not null unique,
  url text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rink_foreign_id_provider check (starts_with(foreign_id, 'tor_'))
);

create trigger rink_set_updated_at
before update on public.rink
for each row execute function public.set_updated_at();

alter table public.rink enable row level security;
revoke all on table public.rink from public, anon, authenticated;
revoke all on sequence public.rink_id_seq from public, anon, authenticated;
grant usage on sequence public.rink_id_seq to authenticated;
grant select (id, foreign_id, name, url, address, created_at, updated_at)
  on public.rink to authenticated;
grant insert (name, foreign_id, url, address) on public.rink to authenticated;
grant update (name, foreign_id, url, address) on public.rink to authenticated;
grant delete on public.rink to authenticated;

create function private.has_rink_permission(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public."user" as app_user
    join public.role as app_role on app_role.id = app_user.role_id
    where app_user.id = (select auth.uid())
      and case permission_name
        when 'rink_read' then app_role.rink_read
        when 'rink_write' then app_role.rink_write
        when 'skate_session_read' then app_role.skate_session_read
        when 'skate_session_write' then app_role.skate_session_write
        else false
      end
  );
$$;

revoke all on function private.has_rink_permission(text) from public, anon, authenticated;
grant execute on function private.has_rink_permission(text) to authenticated;

create policy rink_select on public.rink for select to authenticated
using (
  private.has_rink_permission('rink_read')
  or private.has_rink_permission('rink_write')
);
create policy rink_insert on public.rink for insert to authenticated
with check (private.has_rink_permission('rink_write'));
create policy rink_update on public.rink for update to authenticated
using (private.has_rink_permission('rink_write'))
with check (private.has_rink_permission('rink_write'));
create policy rink_delete on public.rink for delete to authenticated
using (private.has_rink_permission('rink_write'));
