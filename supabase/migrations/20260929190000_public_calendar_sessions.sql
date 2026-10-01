create role calendar_projection_owner nologin nosuperuser nobypassrls;
grant usage on schema public to calendar_projection_owner;
grant select (id, rink_id, start, "end", audience, is_cancelled, certainty)
  on public.skating_session to calendar_projection_owner;
grant select (id, name, address, url) on public.rink to calendar_projection_owner;

create policy skating_session_calendar_projection on public.skating_session
  for select to calendar_projection_owner using (true);
create policy rink_calendar_projection on public.rink
  for select to calendar_projection_owner using (true);

create index skating_session_calendar_start_id_idx
  on public.skating_session (start, id) include ("end");
create index skating_session_calendar_end_idx
  on public.skating_session ("end");

create view public.calendar_session as
select
  skating_session.id::text as id,
  skating_session.start,
  skating_session."end",
  skating_session.audience,
  skating_session.is_cancelled,
  skating_session.certainty,
  skating_session.rink_id::text as rink_id,
  rink.name as rink_name,
  rink.address as rink_address,
  rink.url as rink_url
from public.skating_session
join public.rink on rink.id = skating_session.rink_id;

grant create on schema public to calendar_projection_owner;
grant calendar_projection_owner to postgres;
alter view public.calendar_session owner to calendar_projection_owner;
set role calendar_projection_owner;
revoke all on public.calendar_session from public, anon, authenticated;
grant select on public.calendar_session to anon, authenticated;
reset role;
revoke calendar_projection_owner from postgres;
revoke create on schema public from calendar_projection_owner;
