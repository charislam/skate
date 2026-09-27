# Skate API

The `skate-api` Edge Function exposes `POST /skate-api/source/scrape`. It
validates the configured secret API key before source access, reads the source
through a service client, fetches its stored page, classifies four weeks, and
conditionally updates `last_fetched` after result validation. The value
describes successful server processing; it does not prove that the caller
received the response. There is no session persistence or scheduled invocation
in this version.

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
