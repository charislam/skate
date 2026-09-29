begin;

select no_plan();

insert into public.role (
  id, name, rink_read, rink_write, skate_session_read, skate_session_write
) values
  ('00000000-0000-0000-0000-000000000901', 'pgtap_rink_reader', true, false, true, false),
  ('00000000-0000-0000-0000-000000000902', 'pgtap_rink_writer', false, true, false, true);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000901', 'pgtap-rink-reader@example.test'),
  ('00000000-0000-0000-0000-000000000902', 'pgtap-rink-writer@example.test');

update public."user"
set role_id = id
where id in (
  '00000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000902'
);

insert into public.rink (id, name, foreign_id) overriding system value
values (880000001, 'Persistence Test Rink', 'tor_pgtap_persistence');
insert into public.source (id, name, type, url, rink_id, updated_at)
values (880000001, 'Persistence Test Source', 'web_scrape', 'https://example.test/persist', 880000001, '2026-09-29T00:00:00Z');
insert into public.skating_session (rink_id, source_id, start, "end", audience)
values (880000001, 880000001, '2026-09-29 09:00', '2026-09-29 10:00', 'general');

select ok(
  (select rink_read and rink_write and skate_session_read and skate_session_write from public.role where name = 'owner'),
  'owner has rink and skating-session read/write permissions'
);
select ok(
  (select rink_read and not rink_write and skate_session_read and not skate_session_write from public.role where name = 'member'),
  'member has read and no write permissions'
);
select ok(
  has_column_privilege('authenticated', 'public.rink', 'name', 'insert')
    and not has_column_privilege('authenticated', 'public.rink', 'id', 'insert')
    and not has_column_privilege('authenticated', 'public.rink', 'updated_at', 'update'),
  'rink identity and audit columns are not writable'
);
select ok(
  has_column_privilege('authenticated', 'public.skating_session', 'start', 'insert')
    and not has_column_privilege('authenticated', 'public.skating_session', 'id', 'insert')
    and not has_column_privilege('authenticated', 'public.skating_session', 'created_at', 'update'),
  'session identity and audit columns are not writable'
);
select ok(not has_table_privilege('anon', 'public.rink', 'select'), 'anonymous callers cannot read rinks');
select ok(not has_table_privilege('anon', 'public.skating_session', 'select'), 'anonymous callers cannot read skating sessions');
select ok(
  not has_function_privilege('anon', 'public.persist_scraped_sessions(bigint,timestamptz,bigint,timestamptz,jsonb,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.persist_scraped_sessions(bigint,timestamptz,bigint,timestamptz,jsonb,jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.persist_scraped_sessions(bigint,timestamptz,bigint,timestamptz,jsonb,jsonb)', 'execute'),
  'only the service role can execute the persistence RPC'
);

select throws_ok(
  $$insert into public.rink (name, foreign_id) values ('Bad Prefix', 'torXbad')$$,
  '23514', null, 'rink provider prefix is literal and required'
);
select throws_ok(
  $$insert into public.rink (id, name, foreign_id) values (880000099, 'Explicit ID', 'tor_pgtap_explicit')$$,
  '428C9', null, 'rink identity IDs cannot be supplied explicitly'
);
select throws_ok(
  $$insert into public.rink (name, foreign_id) values ('Duplicate Provider ID', 'tor_pgtap_persistence')$$,
  '23505', null, 'rink foreign IDs are unique'
);
select throws_ok(
  $$insert into public.skating_session (rink_id, source_id, start, "end", audience) values (880000001, 880000001, '2026-09-29 11:00', '2026-09-29 10:00', 'general')$$,
  '23514', null, 'session end must follow its start'
);
select throws_ok(
  $$insert into public.skating_session (rink_id, source_id, start, "end", audience) values (880000001, 880000001, '2026-09-29 11:00', '2026-09-29 12:00', 'unknown')$$,
  '23514', null, 'session audience is constrained to the supported enum'
);
select throws_ok(
  $$insert into public.skating_session (id, rink_id, source_id, start, "end", audience) values (880000099, 880000001, 880000001, '2026-09-29 11:00', '2026-09-29 12:00', 'general')$$,
  '428C9', null, 'session identity IDs cannot be supplied explicitly'
);
select throws_ok(
  $$insert into public.skating_session (rink_id, source_id, start, "end", audience) values (880000001, 880000001, '2026-09-29 09:00', '2026-09-29 10:00', 'general')$$,
  '23505', null, 'source/start/audience is unique'
);
select throws_ok(
  $$delete from public.rink where id = 880000001$$,
  '23503', null, 'source association restricts rink deletion'
);

set local role service_role;
select is(
  (public.persist_scraped_sessions(
    880000001,
    '2026-09-29T00:00:00Z',
    880000001,
    '2026-09-29T12:00:00Z',
    '[{"start":"2026-09-29T09:00:00","end":"2026-09-29T10:00:00","audience":"general","is_cancelled":false,"certainty":"certain"}]'::jsonb,
    '[]'::jsonb
  ) ->> 'unchanged')::integer,
  1,
  'transactional persistence reports identical sessions as unchanged'
);
select is(
  (public.persist_scraped_sessions(
    880000001,
    (select updated_at from public.source where id = 880000001),
    880000001,
    '2026-09-29T12:01:00Z',
    '[]'::jsonb,
    '["2026-09-29"]'::jsonb
  ) ->> 'missingMarkedUncertain')::integer,
  1,
  'resolved empty days mark missing sessions uncertain'
);
select is(
  (select certainty from public.skating_session where source_id = 880000001),
  'uncertain',
  'reconciliation preserves the missing session and marks uncertainty'
);
select throws_ok(
  $$select public.persist_scraped_sessions(880000001, '2026-09-29T00:00:00Z', 880000001, '2026-09-29T12:02:00Z', '[]'::jsonb, '[]'::jsonb)$$,
  'P0001', 'SourceChanged', 'stale source versions are rejected'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000901';
select is((select count(*)::integer from public.rink where id = 880000001), 1, 'rink reader can read the test rink');
select is((select count(*)::integer from public.skating_session where source_id = 880000001), 1, 'session reader can read the test skating session');
select throws_ok(
  $$insert into public.skating_session (rink_id, source_id, start, "end", audience) values (880000001, 880000001, '2026-09-29 11:00', '2026-09-29 12:00', 'family')$$,
  '42501', null, 'session reader cannot write sessions'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000902';
select is((select count(*)::integer from public.rink where id = 880000001), 1, 'rink writer can read with explicit read permission false');
select is((select count(*)::integer from public.skating_session where source_id = 880000001), 1, 'session writer can read with explicit read permission false');
select lives_ok(
  $$update public.skating_session set certainty = 'uncertain' where source_id = 880000001$$,
  'session writer can update sessions'
);
reset role;

delete from public.source where id = 880000001;
select is((select count(*)::integer from public.skating_session where source_id = 880000001), 0, 'deleting a source cascades to its skating sessions');

select * from finish();
rollback;
