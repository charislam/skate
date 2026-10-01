begin;
select no_plan();

select ok(has_table_privilege('anon', 'public.calendar_session', 'select'), 'anonymous API role can read the calendar projection');
select ok(has_table_privilege('authenticated', 'public.calendar_session', 'select'), 'authenticated API role can read the calendar projection');
select ok(not has_table_privilege('anon', 'public.calendar_session', 'insert') and not has_table_privilege('authenticated', 'public.calendar_session', 'update'), 'API roles cannot write through the projection');
select ok(not has_table_privilege('anon', 'public.skating_session', 'select') and not has_table_privilege('anon', 'public.rink', 'select'), 'anonymous base-table access remains denied');
select is(
  (select array_agg(attname::text order by attnum)::text from pg_attribute where attrelid = 'public.calendar_session'::regclass and attnum > 0 and not attisdropped),
  '{id,start,end,audience,is_cancelled,certainty,rink_id,rink_name,rink_address,rink_url}',
  'projection exposes only the documented fields'
);
select is(
  (select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'public.calendar_session'::regclass and attname = 'rink_id' and not attisdropped),
  'text',
  'rink identifiers are exposed without bigint precision loss'
);
select ok(
  (select relowner = 'calendar_projection_owner'::regrole from pg_class where oid = 'public.calendar_session'::regclass)
    and not pg_has_role('anon', 'calendar_projection_owner', 'member')
    and not pg_has_role('authenticated', 'calendar_projection_owner', 'member'),
  'projection has a dedicated owner that API roles cannot assume'
);
select ok(
  (select not rolsuper and not rolbypassrls and not rolcanlogin from pg_roles where rolname = 'calendar_projection_owner')
    and not has_schema_privilege('calendar_projection_owner', 'public', 'create'),
  'projection owner is restricted and cannot create schema objects'
);
select * from finish();
rollback;
