create schema if not exists extensions;
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_trgm') then
    execute 'alter extension pg_trgm set schema extensions';
  else
    execute 'create extension pg_trgm with schema extensions';
  end if;
end;
$$;

alter table public.source add column name text;

-- A reviewed row-to-name mapping must be added here if the target already has sources.
-- Fail closed rather than derive administrator labels from IDs or URLs.
do $$
declare
  is_deterministic boolean;
begin
  select collation_info.collisdeterministic
  into is_deterministic
  from pg_catalog.pg_attribute as attribute
  join pg_catalog.pg_class as table_class on table_class.oid = attribute.attrelid
  join pg_catalog.pg_namespace as table_schema on table_schema.oid = table_class.relnamespace
  join pg_catalog.pg_collation as collation_info on collation_info.oid = attribute.attcollation
  where table_schema.nspname = 'public'
    and table_class.relname = 'source'
    and attribute.attname = 'name'
    and not attribute.attisdropped;

  if is_deterministic is distinct from true then
    raise exception 'public.source.name must use a deterministic text collation';
  end if;

  if exists (select 1 from public.source where name is null or btrim(name) = '') then
    raise exception 'public.source contains unnamed rows; add a reviewed name backfill before applying this migration';
  end if;

  if exists (select 1 from public.source group by name having count(*) > 1) then
    raise exception 'public.source contains duplicate names; resolve collisions in the reviewed backfill';
  end if;
end;
$$;

alter table public.source
  alter column name set not null,
  add constraint source_name_key unique (name),
  add constraint source_name_nonempty check (name = btrim(name) and name <> '');

grant select (name) on public.source to authenticated;
grant insert (name) on public.source to authenticated;
grant update (name) on public.source to authenticated;

create function public.trim_source_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  return new;
end;
$$;
revoke all on function public.trim_source_name() from public, anon, authenticated;
create trigger source_trim_name
before insert or update of name on public.source
for each row execute function public.trim_source_name();

create index source_name_trgm_idx on public.source using gin (lower(name) extensions.gin_trgm_ops);
create index source_enabled_name_idx on public.source (enabled, name);
create index source_type_name_idx on public.source (type, name);
create index source_last_fetched_id_idx on public.source (last_fetched asc nulls first, id asc);
create index source_created_at_id_idx on public.source (created_at, id);
create index source_updated_at_id_idx on public.source (updated_at, id);

create function public.list_source_page(
  p_search_text text,
  p_type text,
  p_enabled boolean,
  p_fetch_status text,
  p_sort_field text,
  p_direction text,
  p_cursor jsonb
)
returns table (
  id text,
  name text,
  type text,
  url text,
  notes text,
  enabled boolean,
  last_fetched timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog
set pg_trgm.word_similarity_threshold = '0.4'
as $$
declare
  query_text text := nullif(btrim(p_search_text), '');
  is_desc boolean := p_direction = 'desc';
  order_clause text;
begin
  if p_sort_field is null or p_sort_field not in ('name', 'type', 'enabled', 'last_fetched', 'created_at', 'updated_at')
    or p_direction is null or p_direction not in ('asc', 'desc')
    or (p_type is not null and p_type <> 'web_scrape')
    or (p_fetch_status is not null and p_fetch_status not in ('never', 'fetched'))
    or (query_text is not null and (char_length(query_text) > 200 or query_text !~ '[[:alnum:]].*[[:alnum:]].*[[:alnum:]]')) then
    raise exception 'invalid source listing query' using errcode = '22023';
  end if;

  order_clause := case p_sort_field
    when 'name' then case when is_desc then 's.name desc' else 's.name asc' end
    when 'type' then case when is_desc then 's.type desc, s.name desc' else 's.type asc, s.name asc' end
    when 'enabled' then case when is_desc then 's.enabled desc, s.name desc' else 's.enabled asc, s.name asc' end
    when 'last_fetched' then case when is_desc then 's.last_fetched desc nulls last, s.id desc' else 's.last_fetched asc nulls first, s.id asc' end
    when 'created_at' then case when is_desc then 's.created_at desc, s.id desc' else 's.created_at asc, s.id asc' end
    when 'updated_at' then case when is_desc then 's.updated_at desc, s.id desc' else 's.updated_at asc, s.id asc' end
  end;

  return query execute
    'select s.id::text, s.name, s.type, s.url, s.notes, s.enabled, s.last_fetched, s.created_at, s.updated_at
     from public.source as s
     where ($1 is null or s.type = $1)
       and ($2 is null or s.enabled = $2)
       and ($3 is null or ($3 = ''never'' and s.last_fetched is null) or ($3 = ''fetched'' and s.last_fetched is not null))
       and ($4 is null or lower($4) OPERATOR(extensions.<%) lower(s.name))
       and ($5 is null or case $6
         when ''name'' then case when $7 then s.name < ($5->>''name'') else s.name > ($5->>''name'') end
         when ''type'' then case when $7 then
           (s.type < ($5->>''type'') or (s.type = ($5->>''type'') and s.name < ($5->>''name'')))
           else (s.type > ($5->>''type'') or (s.type = ($5->>''type'') and s.name > ($5->>''name''))) end
         when ''enabled'' then case when $7 then
           (s.enabled < (($5->>''enabled'')::boolean) or (s.enabled = (($5->>''enabled'')::boolean) and s.name < ($5->>''name'')))
           else (s.enabled > (($5->>''enabled'')::boolean) or (s.enabled = (($5->>''enabled'')::boolean) and s.name > ($5->>''name''))) end
         when ''created_at'' then case when $7 then
           (s.created_at, s.id) < ((($5->>''timestamp'')::timestamptz), (($5->>''id'')::bigint))
           else (s.created_at, s.id) > ((($5->>''timestamp'')::timestamptz), (($5->>''id'')::bigint)) end
         when ''updated_at'' then case when $7 then
           (s.updated_at, s.id) < ((($5->>''timestamp'')::timestamptz), (($5->>''id'')::bigint))
           else (s.updated_at, s.id) > ((($5->>''timestamp'')::timestamptz), (($5->>''id'')::bigint)) end
         when ''last_fetched'' then case
           when $7 and ($5->>''_tag'') = ''LastFetchedNull'' then s.last_fetched is null and s.id < (($5->>''id'')::bigint)
           when $7 then s.last_fetched is null or
             (s.last_fetched, s.id) < ((($5->>''timestamp'')::timestamptz), (($5->>''id'')::bigint))
           when ($5->>''_tag'') = ''LastFetchedNull'' then s.last_fetched is not null or
             (s.last_fetched is null and s.id > (($5->>''id'')::bigint))
           else s.last_fetched is not null and
             (s.last_fetched, s.id) > ((($5->>''timestamp'')::timestamptz), (($5->>''id'')::bigint))
         end
       end)
     order by ' || order_clause || '
     limit 51'
  using p_type, p_enabled, p_fetch_status, query_text, p_cursor, p_sort_field, is_desc;
end;
$$;

revoke all on function public.list_source_page(text, text, boolean, text, text, text, jsonb) from public, anon;
grant execute on function public.list_source_page(text, text, boolean, text, text, text, jsonb) to authenticated;
