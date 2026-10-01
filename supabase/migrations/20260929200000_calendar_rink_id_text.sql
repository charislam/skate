drop view public.calendar_session;

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
revoke create on schema public from calendar_projection_owner;
revoke calendar_projection_owner from postgres;
