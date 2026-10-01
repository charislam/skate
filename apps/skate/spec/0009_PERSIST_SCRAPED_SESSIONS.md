# Persist scraped skating sessions

## Scope

Change `POST /skate-api/source/scrape` to persist extracted skating sessions. Keep the existing request, service authentication, scrape window, classifier behavior, and error envelope. Successful requests return `204 No Content`, with no response body. Log a persistence summary after the database transaction commits.

Keep the existing database column name `public.source.last_fetched`. This specification supersedes the response-only persistence behavior in 0007; extraction behavior from 0008 remains applicable. This work includes migrations, persistence, and necessary generated database types. Rinks are created separately by authorized users; scraping never creates rinks. Rink management UI is outside this scope.

## Staged migrations and backfill

Use two separately deployable migrations, ordered as follows:

1. Create `public.rink`, add the role permission columns described below, initialize role permissions, and implement rink grants, RLS, indexes, and timestamp triggers. Apply this migration first so the user can populate missing rinks.
2. Assume rinks have been backfilled after migration 1. Add the source association, enforce the association constraint, and create `public.skating_session` with its grants, RLS, indexes, triggers, and transactional persistence function.

The second migration must include an explicit precondition failure with a useful message if any web scrape source remains unassociated. Do not invent rink data, delete existing sources, or silently bypass the constraint. The user must backfill rinks before applying migration 2.

## Role permissions and access control

Add four `boolean not null default false` columns to `public.role`:

- `rink_read`
- `rink_write`
- `skate_session_read`
- `skate_session_write`

Set all four to true for the existing `owner` role. Set both read permissions to true and both write permissions to false for `member`. Other roles default to false. Authorization must follow the current user's `public.user.role_id` association to `public.role`, never a role-name comparison or user-editable JWT metadata. For each resource, write permission implies read permission even when the explicit read flag is false (though by convention it should not be false for a writer role).

Follow the existing private permission-helper pattern. Any security-definer helper must have a fixed empty search path, fully qualified objects, tightly scoped execution grants, and resolve the caller through `auth.uid()`. Keep helpers outside the exposed public schema.

Enable RLS on both new tables. Revoke inherited/default table and sequence privileges from `PUBLIC`, `anon`, and `authenticated`, then grant the explicit column operations below. Grant DELETE at table level with write-permission RLS. SELECT policies require the corresponding read OR write permission; INSERT requires write; UPDATE requires write in both USING and WITH CHECK; DELETE requires write. Unauthenticated callers have no access. These permissions apply across all rows, not per-row ownership.

Column grants are shared by the `authenticated` database role; RLS applies application permissions. Readers and writers use the same readable column set:

| Table             | SELECT columns                                                                                                    | INSERT / UPDATE columns                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `rink`            | `id`, `foreign_id`, `name`, `url`, `address`, `created_at`, `updated_at`                                          | `name`, `foreign_id`, `url`, `address`                                          |
| `skating_session` | `id`, `rink_id`, `source_id`, `start`, `end`, `audience`, `is_cancelled`, `certainty`, `created_at`, `updated_at` | `rink_id`, `source_id`, `start`, `end`, `audience`, `is_cancelled`, `certainty` |

IDs and timestamps are database-managed and cannot be inserted or updated by authenticated users. Avoid broad table-level SELECT/INSERT/UPDATE grants that override these restrictions. Supply only the sequence privileges actually required by identity-backed inserts; do not grant sequence mutation access.

Extend existing source column grants to permit reading, inserting, and updating `rink_id`, governed by existing source RLS and `source_read` / `source_write` permissions. New rink/session permissions do not independently grant source access. Preserve existing server-only control over `last_fetched`.

## Database schema

### `public.rink`

| Column       | Definition                                        |
| ------------ | ------------------------------------------------- |
| `id`         | `bigint generated always as identity primary key` |
| `name`       | `text not null`                                   |
| `foreign_id` | `text not null unique`                            |
| `url`        | nullable `text`                                   |
| `address`    | nullable `text`                                   |
| `created_at` | `timestamptz not null default now()`              |
| `updated_at` | `timestamptz not null default now()`              |

Require the literal, case-sensitive prefix `tor_` on `foreign_id`. Use a literal-prefix expression such as `starts_with(foreign_id, 'tor_')`; an unescaped underscore in LIKE would be a wildcard. Future providers can expand this constraint in a later migration. Reuse `public.set_updated_at()` in a BEFORE UPDATE trigger.

### `public.source`

Add `rink_id bigint references public.rink(id) on delete restrict` and an index on `rink_id`. Require `type <> 'web_scrape' OR rink_id IS NOT NULL`. Other future source types may have a null association. Preserve existing columns, timestamps, and triggers.

### `public.skating_session`

| Column         | Definition                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| `id`           | `bigint generated always as identity primary key`                          |
| `rink_id`      | `bigint not null references public.rink(id) on delete cascade`             |
| `source_id`    | `bigint not null references public.source(id) on delete cascade`           |
| `start`        | `timestamp without time zone not null`                                     |
| `end`          | `timestamp without time zone not null`                                     |
| `audience`     | `text not null`, one of `general`, `family`, `adult`, `children`, `senior` |
| `is_cancelled` | `boolean not null default false`                                           |
| `certainty`    | `text not null default 'certain'`, one of `certain`, `uncertain`           |
| `created_at`   | `timestamptz not null default now()`                                       |
| `updated_at`   | `timestamptz not null default now()`                                       |

Require `"end" > "start"`. Reuse `public.set_updated_at()` in a BEFORE UPDATE trigger. Audit timestamps represent instants; session timestamps represent local wall time in the existing `America/Toronto` schedule convention.

Create a unique B-tree index/constraint on `(source_id, start, audience)` and a separate index on `rink_id`. The unique index supports matching, source cascade lookups, and source-scoped date-range reconciliation. No additional source-only index is necessary.

Deleting a source cascades to its sessions. Deleting a rink cascades to sessions, but a referencing source still blocks rink deletion through its RESTRICT foreign key.

## Mapping and matching

Construct local timestamps directly from the scraper's date and clock fields, including its explicit next-day end date. Do not convert through UTC, append a timezone suffix, or reinterpret these values through JavaScript Date.

Map `category` to `audience`, `supported` certainty to `certain`, and `uncertain` to `uncertain`. Map `cancelled` to true and `scheduled` to false. Unknown cancellation becomes false and forces certainty to uncertain.

Skip extracted sessions with missing or invalid required fields, invalid audience, or end not later than start. Low confidence alone does not prevent persistence when all required fields are valid; save such rows as uncertain. Keep per-day skipped counts for reconciliation and logging.

Match by `(source_id, start, audience)`. Update matching rows in place, preserving their IDs and `created_at`; insert unmatched rows. End-time, cancellation, and certainty changes update the existing row. Start-time or audience changes produce a new row; the old row is eligible to be marked uncertain under the reconciliation rules below. Do not merge across sources, even when they refer to the same rink.

Normalize duplicate match keys before issuing an upsert. Collapse exact duplicates. If duplicate keys disagree on persisted values, skip that conflicting key, count the conflict, and treat the day as unresolved rather than choosing an arbitrary winner. Leave any existing row for that key unchanged. The match key intentionally permits only one session for a source, start time, and audience combination.

## Reconciliation of missing sessions

Determine day eligibility from the existing classifier confidence threshold and extraction results. A day is resolved only if its count is known, within the supported limit, and confident; all expected sessions have been extracted; and none were skipped, conflicted, or uncertain. A confidently empty day is resolved.

Persist valid sessions from both resolved and unresolved days. On unresolved days, do not change existing sessions that have no matching valid extracted row.

For resolved days only, mark existing sessions missing from the accepted match-key set as `certainty = 'uncertain'`. Preserve their IDs, times, audience, and cancellation state. Do not delete them or infer cancellation. An already-uncertain missing row needs no update. A later confident extraction of the same key can restore certainty to certain.

## Transaction and concurrency

Replace the separate completion update with one database transaction, exposed through a narrowly granted backend-only RPC or equivalent transactional database operation. It must:

1. Lock the source row and verify it still exists, is enabled, has type `web_scrape`, and matches the exact `updated_at` value and rink association loaded before scraping.
2. Validate the persistence payload and resolved-day set, then insert/update valid sessions.
3. Mark missing sessions uncertain only for resolved days.
4. Update `source.last_fetched` to the successful completion instant and return committed counts and the stored timestamp to the backend.

Any failure rolls back all session changes and the completion update. Concurrent scrapes that read the same source version must not both commit stale results: after the first commits, the second must fail the existing source-changed check. Preserve existing source-change error semantics. A deleted source must not be recreated. Keep database locks limited to persistence; never hold them across HTTP fetching or classifier calls.

Valid empty results, and successful extractions with every day unresolved or every row skipped, still complete the transaction and update `last_fetched`. Unknown data must not be interpreted as an empty resolved schedule. Retrieval, classification, validation, and database failures do not advance the timestamp.

The persistence RPC is not callable by `PUBLIC`, `anon`, or `authenticated`. Explicitly authorize only the backend database role used by the existing validated service client. Prefer security invoker with appropriate server privileges. Do not expose a general privileged write function to users.

## Endpoint integration and logging

Keep `/skate-api/source/scrape`, the `{ "sourceId": "..." }` request, and existing secret-key authentication. Update the Effect HTTP success schema/handler to return an empty 204 response. Retain extraction as an internal domain result and replace the repository's standalone completion operation with the transactional persistence operation. Keep database-specific concerns in adapters and use the existing typed service/error structure.

Emit one structured persistence summary after a confirmed commit, containing:

- Request correlation ID, source ID, and rink ID.
- Local scrape window and timezone.
- Extracted, accepted, skipped, and duplicate/conflict counts.
- Inserted, updated, unchanged, and missing-marked-uncertain counts, with the latter distinct from upsert updates.
- Resolved and unresolved day counts.
- Cancelled and uncertain counts among accepted incoming sessions.
- Stored `last_fetched` and persistence duration.

Counts must describe actual database outcomes. Skip no-op updates so unchanged records retain `updated_at`. Never log a successful persistence summary before commit, and do not log credentials, raw HTML, or full classifier payloads. Preserve existing error logging for failures.

## Acceptance criteria

- Migration 1 can be applied independently and permits authorized rink creation before migration 2.
- Migration 2 cannot complete with an unassociated web scrape source; the user must backfill first.
- Rink prefix and uniqueness constraints, session enums/time ordering, identity behavior, timestamps, and foreign-key deletion behavior are enforced by the database.
- Permission checks use role flags; members read, owners read/write, write implies read, and anonymous callers have no access. Column restrictions hold through the Data API, including rejection of identity/timestamp writes.
- Repeating an identical scrape preserves session IDs and audit timestamps for unchanged sessions. End/cancellation changes update existing rows; start/audience changes insert new rows.
- Resolved-day reconciliation marks missing rows uncertain; unresolved days and out-of-window rows remain protected from missing-row reconciliation.
- Unknown cancellation is persisted as false/uncertain. Invalid rows are skipped and prevent that day from being considered resolved.
- Empty and wholly unresolved successful scrapes advance `last_fetched`; failed writes and stale source versions roll back all persistence.
- Concurrent stale scrapes cannot overwrite a newer committed result.
- Successful HTTP responses are 204 with no body; logs contain an accurate post-commit summary.
- During implementation, run relevant database and backend checks plus repository conventions: `pnpm fmt`, `pnpm lint`, and `pnpm typecheck`. Spec-only work does not require running application tests.
