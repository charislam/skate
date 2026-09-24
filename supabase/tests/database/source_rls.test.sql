begin;

select plan(16);

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

insert into public.source (id, type, url, notes)
values (900000001, 'web_scrape', 'https://example.test/source', null);

select ok(has_column_privilege('authenticated', 'public.source', 'type', 'select'), 'authenticated can select source type');
select ok(has_column_privilege('authenticated', 'public.source', 'url', 'select'), 'authenticated can select source url');
select ok(has_column_privilege('authenticated', 'public.source', 'notes', 'select'), 'authenticated can select source notes');

set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

select is((select count(*)::integer from public.source), 0, 'member cannot read sources');
select throws_ok(
  $$insert into public.source (type, url, notes) values ('web_scrape', 'https://example.test/member', null)$$,
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
  select type || '|' || url || '|' || coalesce(notes, '<null>')
  from public.source where id = 900000001
), 'web_scrape|https://example.test/source|<null>', 'source reader can select source columns');
select throws_ok(
  $$insert into public.source (type, url, notes) values ('web_scrape', 'https://example.test/reader', null)$$,
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
  $$insert into public.source (type, url, notes) values ('web_scrape', 'https://example.test/writer', null)$$,
  'source writer can insert sources'
);
update public.source set url = 'https://example.test/updated' where id = 900000001;
reset role;
select is((select url from public.source where id = 900000001), 'https://example.test/updated', 'source writer can update sources');
set local role authenticated;
delete from public.source where id = 900000001;
reset role;
select is((select count(*)::integer from public.source where id = 900000001), 0, 'source writer can delete sources');

select * from finish();
rollback;
