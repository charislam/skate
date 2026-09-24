create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create function private.has_source_permission(permission_name text)
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
        when 'source_read' then app_role.source_read
        when 'source_write' then app_role.source_write
        else false
      end
  );
$$;

revoke all on function private.has_source_permission(text) from public, anon, authenticated;
grant execute on function private.has_source_permission(text) to authenticated;

grant select (id, type, url, notes, created_at, updated_at) on public.source to authenticated;
grant insert (type, url, notes) on public.source to authenticated;
grant update (type, url, notes) on public.source to authenticated;
grant delete on public.source to authenticated;

create policy source_select
on public.source
for select
to authenticated
using (
  private.has_source_permission('source_read')
  or private.has_source_permission('source_write')
);

create policy source_insert
on public.source
for insert
to authenticated
with check (private.has_source_permission('source_write'));

create policy source_update
on public.source
for update
to authenticated
using (private.has_source_permission('source_write'))
with check (private.has_source_permission('source_write'));

create policy source_delete
on public.source
for delete
to authenticated
using (private.has_source_permission('source_write'));
