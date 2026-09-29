alter table public.source
  add column rink_id bigint references public.rink(id) on delete restrict;

do $$
declare
  unassociated_source_count integer;
begin
  select count(*)::integer into unassociated_source_count
  from public.source
  where type = 'web_scrape' and rink_id is null;

  if unassociated_source_count > 1 then
    raise exception 'Cannot apply rink backfill to % unassociated web_scrape sources: expected the single existing source. Assign each source to its correct rink, then reapply this migration.', unassociated_source_count;
  end if;

  update public.source
  set rink_id = 1
  where type = 'web_scrape' and rink_id is null;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.source
    where type = 'web_scrape' and rink_id is null
  ) then
    raise exception 'Cannot create skating sessions: every web_scrape source must be assigned a rink first. Backfill public.source.rink_id after creating matching public.rink rows, then reapply this migration.';
  end if;
end;
$$;

create index source_rink_id_idx on public.source (rink_id);
alter table public.source
  add constraint source_web_scrape_requires_rink
  check (type <> 'web_scrape' or rink_id is not null);

grant select (rink_id) on public.source to authenticated;
grant insert (rink_id) on public.source to authenticated;
grant update (rink_id) on public.source to authenticated;

create table public.skating_session (
  id bigint generated always as identity primary key,
  rink_id bigint not null references public.rink(id) on delete cascade,
  source_id bigint not null references public.source(id) on delete cascade,
  start timestamp without time zone not null,
  "end" timestamp without time zone not null,
  audience text not null,
  is_cancelled boolean not null default false,
  certainty text not null default 'certain',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skating_session_audience_valid check (
    audience = any (array['general', 'family', 'adult', 'children', 'senior']::text[])
  ),
  constraint skating_session_certainty_valid check (
    certainty = any (array['certain', 'uncertain']::text[])
  ),
  constraint skating_session_end_after_start check ("end" > start),
  constraint skating_session_source_start_audience_key unique (source_id, start, audience)
);

create index skating_session_rink_id_idx on public.skating_session (rink_id);
create trigger skating_session_set_updated_at
before update on public.skating_session
for each row execute function public.set_updated_at();

alter table public.skating_session enable row level security;
revoke all on table public.skating_session from public, anon, authenticated;
revoke all on sequence public.skating_session_id_seq from public, anon, authenticated;
grant usage on sequence public.skating_session_id_seq to authenticated;
grant select (
  id, rink_id, source_id, start, "end", audience, is_cancelled, certainty,
  created_at, updated_at
) on public.skating_session to authenticated;
grant insert (rink_id, source_id, start, "end", audience, is_cancelled, certainty)
  on public.skating_session to authenticated;
grant update (rink_id, source_id, start, "end", audience, is_cancelled, certainty)
  on public.skating_session to authenticated;
grant delete on public.skating_session to authenticated;

grant select on public.source to service_role;
grant update (last_fetched) on public.source to service_role;
grant select, insert, update on public.skating_session to service_role;
grant usage on sequence public.skating_session_id_seq to service_role;

create policy skating_session_select on public.skating_session for select to authenticated
using (
  private.has_rink_permission('skate_session_read')
  or private.has_rink_permission('skate_session_write')
);
create policy skating_session_insert on public.skating_session for insert to authenticated
with check (private.has_rink_permission('skate_session_write'));
create policy skating_session_update on public.skating_session for update to authenticated
using (private.has_rink_permission('skate_session_write'))
with check (private.has_rink_permission('skate_session_write'));
create policy skating_session_delete on public.skating_session for delete to authenticated
using (private.has_rink_permission('skate_session_write'));

create function public.persist_scraped_sessions(
  p_source_id bigint,
  p_expected_updated_at timestamptz,
  p_expected_rink_id bigint,
  p_completed_at timestamptz,
  p_sessions jsonb,
  p_resolved_days jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_row public.source%rowtype;
  incoming record;
  changed boolean;
  inserted_count integer := 0;
  updated_count integer := 0;
  unchanged_count integer := 0;
  missing_count integer := 0;
  accepted_count integer := 0;
  stored_last_fetched timestamptz;
begin
  if jsonb_typeof(p_sessions) <> 'array' or jsonb_typeof(p_resolved_days) <> 'array' then
    raise exception 'Invalid persistence payload: sessions and resolved days must be arrays';
  end if;
  if p_completed_at is null or p_expected_updated_at is null or p_expected_rink_id is null then
    raise exception 'Invalid persistence payload: source version and completion instant are required';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_sessions) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or jsonb_typeof(item.value -> 'start') <> 'string'
      or jsonb_typeof(item.value -> 'end') <> 'string'
      or jsonb_typeof(item.value -> 'audience') <> 'string'
      or jsonb_typeof(item.value -> 'is_cancelled') <> 'boolean'
      or jsonb_typeof(item.value -> 'certainty') <> 'string'
      or item.value ->> 'audience' not in ('general', 'family', 'adult', 'children', 'senior')
      or item.value ->> 'certainty' not in ('certain', 'uncertain')
  ) then
    raise exception 'Invalid persistence payload: session fields or enum values are invalid';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_sessions) as item(
      start timestamp without time zone,
      audience text
    )
    group by item.start, item.audience
    having count(*) > 1
  ) then
    raise exception 'Invalid persistence payload: duplicate source/start/audience match keys';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_resolved_days) as item(value)
    where jsonb_typeof(item.value) <> 'string'
      or (item.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$'
      or to_char((item.value #>> '{}')::date, 'YYYY-MM-DD') <> item.value #>> '{}'
  ) or (
    select count(*) from jsonb_array_elements_text(p_resolved_days)
  ) <> (
    select count(distinct value) from jsonb_array_elements_text(p_resolved_days) as item(value)
  ) then
    raise exception 'Invalid persistence payload: resolved days must be unique ISO calendar dates';
  end if;

  select * into source_row
  from public.source
  where id = p_source_id
  for update;

  if not found
    or source_row.enabled is distinct from true
    or source_row.type is distinct from 'web_scrape'
    or source_row.updated_at is distinct from p_expected_updated_at
    or source_row.rink_id is distinct from p_expected_rink_id
  then
    raise exception using errcode = 'P0001', message = 'SourceChanged';
  end if;

  for incoming in
    select * from jsonb_to_recordset(p_sessions) as item(
      start timestamp without time zone,
      "end" timestamp without time zone,
      audience text,
      is_cancelled boolean,
      certainty text
    )
  loop
    accepted_count := accepted_count + 1;
    changed := null;
    insert into public.skating_session (
      rink_id, source_id, start, "end", audience, is_cancelled, certainty
    ) values (
      source_row.rink_id, p_source_id, incoming.start, incoming."end",
      incoming.audience, incoming.is_cancelled, incoming.certainty
    )
    on conflict (source_id, start, audience) do update
    set rink_id = excluded.rink_id,
        "end" = excluded."end",
        is_cancelled = excluded.is_cancelled,
        certainty = excluded.certainty
    where (public.skating_session.rink_id, public.skating_session."end",
           public.skating_session.is_cancelled, public.skating_session.certainty)
      is distinct from
          (excluded.rink_id, excluded."end", excluded.is_cancelled, excluded.certainty)
    returning (xmax = 0) into changed;

    if changed is true then
      inserted_count := inserted_count + 1;
    elsif changed is false then
      updated_count := updated_count + 1;
    else
      unchanged_count := unchanged_count + 1;
    end if;
  end loop;

  update public.skating_session as existing
  set certainty = 'uncertain'
  where existing.source_id = p_source_id
    and existing.certainty <> 'uncertain'
    and exists (
      select 1
      from jsonb_array_elements_text(p_resolved_days) as resolved(day_text)
      where existing.start >= resolved.day_text::date::timestamp
        and existing.start < (resolved.day_text::date + 1)::timestamp
    )
    and not exists (
      select 1
      from jsonb_to_recordset(p_sessions) as accepted(
        start timestamp without time zone,
        audience text
      )
      where accepted.start = existing.start
        and accepted.audience = existing.audience
    );
  get diagnostics missing_count = row_count;

  update public.source
  set last_fetched = p_completed_at
  where id = p_source_id
  returning last_fetched into stored_last_fetched;

  return jsonb_build_object(
    'inserted', inserted_count,
    'updated', updated_count,
    'unchanged', unchanged_count,
    'missingMarkedUncertain', missing_count,
    'accepted', accepted_count,
    'lastFetched', stored_last_fetched
  );
end;
$$;

revoke all on function public.persist_scraped_sessions(
  bigint, timestamptz, bigint, timestamptz, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_scraped_sessions(
  bigint, timestamptz, bigint, timestamptz, jsonb, jsonb
) to service_role;
