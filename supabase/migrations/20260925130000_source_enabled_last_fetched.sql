alter table public.source
  add column enabled boolean not null default true,
  add column last_fetched timestamptz;
