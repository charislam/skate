create function private.has_permission(permission_name text)
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
        when 'admin_read' then app_role.admin_read
        when 'admin_write' then app_role.admin_write
        when 'rink_read' then app_role.rink_read
        when 'rink_write' then app_role.rink_write
        when 'skate_session_read' then app_role.skate_session_read
        when 'skate_session_write' then app_role.skate_session_write
        else false
      end
  );
$$;

revoke all on function private.has_permission(text) from public, anon, authenticated;
grant execute on function private.has_permission(text) to authenticated;

alter policy source_select on public.source
using (
  private.has_permission('source_read')
  or private.has_permission('source_write')
);
alter policy source_insert on public.source
with check (private.has_permission('source_write'));
alter policy source_update on public.source
using (private.has_permission('source_write'))
with check (private.has_permission('source_write'));
alter policy source_delete on public.source
using (private.has_permission('source_write'));

alter policy rink_select on public.rink
using (
  private.has_permission('rink_read')
  or private.has_permission('rink_write')
);
alter policy rink_insert on public.rink
with check (private.has_permission('rink_write'));
alter policy rink_update on public.rink
using (private.has_permission('rink_write'))
with check (private.has_permission('rink_write'));
alter policy rink_delete on public.rink
using (private.has_permission('rink_write'));

alter policy skating_session_select on public.skating_session
using (
  private.has_permission('skate_session_read')
  or private.has_permission('skate_session_write')
);
alter policy skating_session_insert on public.skating_session
with check (private.has_permission('skate_session_write'));
alter policy skating_session_update on public.skating_session
using (private.has_permission('skate_session_write'))
with check (private.has_permission('skate_session_write'));
alter policy skating_session_delete on public.skating_session
using (private.has_permission('skate_session_write'));

create or replace function private.has_admin_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.has_permission('admin_read')
      or private.has_permission('admin_write');
$$;

drop function private.has_source_permission(text);
drop function private.has_rink_permission(text);
