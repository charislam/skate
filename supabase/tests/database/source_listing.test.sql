begin;

select plan(17);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000031', 'pgtap-source-listing@example.test');
update public."user"
set role_id = (select id from public.role where name = 'owner')
where id = '00000000-0000-0000-0000-000000000031';

insert into public.source (id, name, type, url, enabled, last_fetched, created_at, updated_at)
values
  (990000001, 'Alpha', 'web_scrape', 'https://example.test/alpha', true, null, '2026-09-25T10:00:00.123456Z', '2026-09-25T10:00:00.123456Z'),
  (990000002, 'Beta', 'web_scrape', 'https://example.test/beta', false, null, '2026-09-25T10:00:00.123456Z', '2026-09-25T10:00:00.123457Z'),
  (990000003, 'Gamma', 'web_scrape', 'https://example.test/gamma', true, '2026-09-25T10:00:00.123456Z', '2026-09-25T10:00:00.123455Z', '2026-09-25T10:00:00.123458Z'),
  (990000004, 'Delta', 'web_scrape', 'https://example.test/delta', false, null, '2026-09-25T10:00:00.123457Z', '2026-09-25T10:00:00.123459Z');

set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000031';

select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'name', 'asc', null)),
  array['Alpha', 'Beta', 'Delta', 'Gamma']::text[],
  'name ascending uses database order'
);
select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'name', 'asc', '{"_tag":"Name","name":"Alpha"}'::jsonb)),
  array['Beta', 'Delta', 'Gamma']::text[],
  'name cursor uses an exclusive ascending boundary'
);
select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'name', 'desc', '{"_tag":"Name","name":"Gamma"}'::jsonb)),
  array['Delta', 'Beta', 'Alpha']::text[],
  'name cursor uses an exclusive descending boundary'
);
select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'enabled', 'asc', null)),
  array['Beta', 'Delta', 'Alpha', 'Gamma']::text[],
  'enabled ascending sorts false before true and name within groups'
);
select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'enabled', 'desc', null)),
  array['Gamma', 'Alpha', 'Delta', 'Beta']::text[],
  'enabled descending reverses both group and name order'
);
select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'last_fetched', 'asc', null)),
  array['Alpha', 'Beta', 'Delta', 'Gamma']::text[],
  'oldest last-fetched order places nulls first and breaks ties by ID'
);
select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'last_fetched', 'asc', '{"_tag":"LastFetchedNull","id":"990000002"}'::jsonb)),
  array['Delta', 'Gamma']::text[],
  'ascending null cursor continues through null IDs and then fetched rows'
);
select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'last_fetched', 'desc', null)),
  array['Gamma', 'Delta', 'Beta', 'Alpha']::text[],
  'newest last-fetched order places nulls last and reverses ID ties'
);
select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'last_fetched', 'desc', '{"_tag":"LastFetched","timestamp":"2026-09-25T10:00:00.123456Z","id":"990000003"}'::jsonb)),
  array['Delta', 'Beta', 'Alpha']::text[],
  'descending fetched cursor continues into null rows'
);
select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'created_at', 'asc', null)),
  array['Gamma', 'Alpha', 'Beta', 'Delta']::text[],
  'created timestamp order preserves sub-millisecond precision and ID ties'
);
select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'created_at', 'asc', '{"_tag":"CreatedAt","timestamp":"2026-09-25T10:00:00.123456Z","id":"990000001"}'::jsonb)),
  array['Beta', 'Delta']::text[],
  'created timestamp cursor preserves the exact timestamp boundary'
);
select is(
  (select array_agg(name) from public.list_source_page(null, null, null, null, 'updated_at', 'desc', null)),
  array['Delta', 'Gamma', 'Beta', 'Alpha']::text[],
  'updated timestamp order sorts descending with ID ties'
);
select is(
  (select count(*)::integer from public.list_source_page('Gama', null, null, null, 'name', 'asc', null)),
  1,
  'fuzzy search matches a representative typo'
);
select is(
  (select count(*)::integer from public.list_source_page(null, null, false, 'never', 'name', 'asc', null)),
  2,
  'enabled and fetch-status filters combine before pagination'
);

insert into public.source (name, type, url)
select 'Bulk source ' || number::text, 'web_scrape', 'https://example.test/bulk/' || number::text
from generate_series(1, 60) as generated(number);
select is(
  (select count(*)::integer from public.list_source_page(null, null, true, 'never', 'name', 'asc', null)),
  51,
  'listing RPC caps a page at 51 rows for the extra-row cursor check'
);
select throws_ok(
  $$select * from public.list_source_page(null, null, null, null, 'url', 'asc', null)$$,
  '22023', null, 'listing RPC rejects non-allowlisted sorts'
);
select is(
  (select count(*)::integer from public.list_source_page(null, null, false, 'never', 'name', 'asc', null)),
  2,
  'combined filters narrow a larger source set before pagination'
);

reset role;
select * from finish();
rollback;
