# Skate API

The `skate-api` Edge Function exposes `POST /skate-api/source/scrape`. It
validates the configured secret API key before source access, reads the source
through a service client, fetches and cleans the source page, counts public
skating independently for 28 Toronto dates, extracts each counted session, and
persists accepted sessions and `last_fetched` in one transaction. Successful
requests return `204 No Content`. processing; it does not prove that the caller
received the response. There is no scheduled invocation.

The internal `source-scrape-v3` extraction result contains 28 ordered `days`
with each selected daily count and confidence, plus ordered `sessions` with
local dates and times, category, cancellation, certainty, and field confidence.
Unknown counts remain unresolved; counts above the offered maximum are
incomplete. Valid uncertain sessions persist as uncertain. Confidently resolved
days reconcile missing sessions by marking them uncertain without deleting them.

The fetch limit is 2 MiB. The complete JSON classifier state, including the
cleaned HTML, date, shared instructions, and source notes, is limited to 24 KiB.
The translated provider request is limited to 48 KiB and 30 questions. Oversize
content fails without truncation. Each provider call has a 30-second timeout;
rate-limited requests retain bounded retries. The page is serialized as reduced
HTML: scripts, styles, embedded frames, SVG, comments, event handlers, and
presentation attributes are removed, while headings, paragraphs, lists, line
breaks, tables, time values, semantic emphasis, and cancellation markup are
preserved. No linked resources or scripts are loaded.

Deterministic backend tests cover workflow mechanics and HTML cleanup. They do
not establish extraction accuracy. Accuracy comparisons require a manually
labelled fixture set and a separately configured live Jev evaluation; no live
evaluation result is claimed here.

## Configuration

Configure these Edge Function secrets in local development and the deployed
project:

```sh
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEYS={"default":"sb_secret_..."}
SKATE_API_KEY_NAME=default
TYPESAFE_API_KEY=...
TYPESAFE_MODEL=jev-1.13.0
SKATE_API_TRUSTED_SOURCE_HOSTS=arena.example.ca,municipality.example.ca
```

`SUPABASE_SECRET_KEYS` must contain the selected name. Only that named key is
accepted; the function does not accept a user JWT or legacy service-role JWT.
The same selected secret key is used by the privileged Supabase client.
`SKATE_API_TRUSTED_SOURCE_HOSTS` is a comma-separated exact-host allowlist.

Do not put backend secrets in `apps/skate/.env` or any browser-exposed variable.
Locally, set secrets with the installed Supabase CLI
(`supabase secrets set ...`) or provide the variables to the local Edge Runtime.
Gateway JWT verification is disabled for this function; Effect middleware
performs the secret-key check.

## Commands

From the repository root:

```sh
pnpm fmt:backend
pnpm lint:backend
pnpm typecheck:backend
```

The Deno dependency versions are pinned in `deno.json` and resolved in
`deno.lock`.
