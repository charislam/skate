alter table public.role
  add column admin_read boolean not null default false,
  add column admin_write boolean not null default false;

update public.role set admin_read = true, admin_write = true where name = 'owner';

create function private.has_admin_access()
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
      and (app_role.admin_read or app_role.admin_write)
  );
$$;

revoke all on function private.has_admin_access() from public, anon, authenticated;
grant execute on function private.has_admin_access() to authenticated;

create function public.has_admin_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.has_admin_access();
$$;

revoke all on function public.has_admin_access() from public, anon, authenticated;
grant execute on function public.has_admin_access() to authenticated;
