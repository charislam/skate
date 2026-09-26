begin;

select plan(36);

insert into public.role (id, name, source_read, source_write)
values
  ('00000000-0000-0000-0000-000000000101', 'pgtap_source_reader', true, false),
  ('00000000-0000-0000-0000-000000000102', 'pgtap_source_writer', false, true);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000001', 'pgtap-source-member@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'pgtap-source-reader@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'pgtap-source-writer@example.test');

update public."user"
set role_id = case id
  when '00000000-0000-0000-0000-000000000002'::uuid then '00000000-0000-0000-0000-000000000101'::uuid
  when '00000000-0000-0000-0000-000000000003'::uuid then '00000000-0000-0000-0000-000000000102'::uuid
  else role_id
end
where id in (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003'
);

insert into public.source (id, name, type, url, notes)
values (900000001, 'Example Source', 'web_scrape', 'https://example.test/source', null);

select ok(has_column_privilege('authenticated', 'public.source', 'type', 'select'), 'authenticated can select source type');
select ok(has_column_privilege('authenticated', 'public.source', 'url', 'select'), 'authenticated can select source url');
select ok(has_column_privilege('authenticated', 'public.source', 'notes', 'select'), 'authenticated can select source notes');
select ok(has_column_privilege('authenticated', 'public.source', 'enabled', 'select'), 'authenticated can select source enabled');
select ok(has_column_privilege('authenticated', 'public.source', 'last_fetched', 'select'), 'authenticated can select source last_fetched');
select ok(has_column_privilege('authenticated', 'public.source', 'name', 'select'), 'authenticated can select source name');
select ok(has_column_privilege('authenticated', 'public.source', 'name', 'insert'), 'authenticated can insert source name');
select ok(has_column_privilege('authenticated', 'public.source', 'name', 'update'), 'authenticated can update source name');
select ok(not has_function_privilege('anon', 'public.list_source_page(text,text,boolean,text,text,text,jsonb)', 'execute'), 'anonymous callers cannot execute source listing RPC');
select ok(has_column_privilege('authenticated', 'public.source', 'enabled', 'insert'), 'authenticated can insert source enabled');
select ok(not has_column_privilege('authenticated', 'public.source', 'last_fetched', 'insert'), 'authenticated cannot insert source last_fetched');
select ok(has_column_privilege('authenticated', 'public.source', 'enabled', 'update'), 'authenticated can update source enabled');
select ok(not has_column_privilege('authenticated', 'public.source', 'last_fetched', 'update'), 'authenticated cannot update source last_fetched');

set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

select is((select count(*)::integer from public.source), 0, 'member cannot read sources');
select is((select count(*)::integer from public.list_source_page(null, null, null, null, 'name', 'asc', null)), 0, 'source listing RPC preserves member RLS');
select throws_ok(
  $$insert into public.source (name, type, url, notes) values ('Member Source', 'web_scrape', 'https://example.test/member', null)$$,
  '42501', null, 'member cannot insert sources'
);
update public.source set url = 'https://example.test/member' where id = 900000001;
reset role;
select is((select url from public.source where id = 900000001), 'https://example.test/source', 'member cannot update sources');
set local role authenticated;
delete from public.source where id = 900000001;
reset role;
select is((select count(*)::integer from public.source where id = 900000001), 1, 'member cannot delete sources');
set local role authenticated;

set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';

select is((select count(*)::integer from public.source), 1, 'source reader can read sources');
select is((
  select name || '|' || type || '|' || url || '|' || coalesce(notes, '<null>') || '|' || enabled::text || '|' || coalesce(last_fetched::text, '<null>')
  from public.source where id = 900000001
), 'Example Source|web_scrape|https://example.test/source|<null>|true|<null>', 'source reader can select source columns');
select set_config('pg_trgm.word_similarity_threshold', '0.7', true);
select is((select count(*)::integer from public.list_source_page(null, null, null, null, 'name', 'asc', null)), 1, 'source listing RPC reads through source reader RLS');
select is(current_setting('pg_trgm.word_similarity_threshold'), '0.7', 'source listing RPC restores the caller trigram threshold');
select is((select id || '|' || name from public.list_source_page(null, null, null, null, 'name', 'asc', null)), '900000001|Example Source', 'source listing RPC returns bigint IDs as text and includes source names');
select throws_ok(
  $$insert into public.source (name, type, url, notes) values ('Reader Source', 'web_scrape', 'https://example.test/reader', null)$$,
  '42501', null, 'source reader cannot insert sources'
);
update public.source set url = 'https://example.test/reader' where id = 900000001;
reset role;
select is((select url from public.source where id = 900000001), 'https://example.test/source', 'source reader cannot update sources');
set local role authenticated;
delete from public.source where id = 900000001;
reset role;
select is((select count(*)::integer from public.source where id = 900000001), 1, 'source reader cannot delete sources');
set local role authenticated;

set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

select is((select count(*)::integer from public.source), 1, 'source writer can select sources for updates');
select lives_ok(
  $$insert into public.source (name, type, url, notes) values ('  Writer Source  ', 'web_scrape', 'https://example.test/writer', null)$$,
  'source writer can insert sources'
);
select is((select name from public.source where url = 'https://example.test/writer'), 'Writer Source', 'source name is trimmed at the write boundary');
select lives_ok(
  $$update public.source set name = 'Renamed Example Source' where id = 900000001$$,
  'source writer can update source name'
);
select is((select name from public.source where id = 900000001), 'Renamed Example Source', 'source writer can change source name');
update public.source set url = 'https://example.test/updated' where id = 900000001;
update public.source set enabled = false where id = 900000001;
select throws_ok(
  $$update public.source set last_fetched = now() where id = 900000001$$,
  '42501', null, 'source writer cannot update last_fetched'
);
select throws_ok(
  $$insert into public.source (name, type, url, last_fetched) values ('Last Fetched Source', 'web_scrape', 'https://example.test/last-fetched', now())$$,
  '42501', null, 'source writer cannot insert last_fetched'
);
reset role;
select is((select url from public.source where id = 900000001), 'https://example.test/updated', 'source writer can update sources');
select is((select enabled from public.source where id = 900000001), false, 'source writer can update enabled');
set local role authenticated;
delete from public.source where id = 900000001;
reset role;
select is((select count(*)::integer from public.source where id = 900000001), 0, 'source writer can delete sources');

select * from finish();
rollback;
