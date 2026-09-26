# Admin sources table

## Decision

Populate `/admin/sources` with a read-only table of `public.source`, using cursor pagination and the nested AsyncData pattern: an outer AsyncData owns the collection's initial load and refresh; an inner tagged union owns fetching more rows. Fetch 50 rows at a time, with automatic infinite loading. Infinite loading on scroll with a sentinel element can dispatch through a scoped browser subscription.

Filtering and sorting happen on the server before pagination. Add a human-readable `name text unique not null` column to `public.source` and default to Name A–Z. IDs are internal only: do not expose them as a column, filter, sort option, or user-facing label. Refresh replaces the accumulated collection with page one while preserving old rows until success.

This design is based on checked-in migrations as of 2026-09-25, not an inspection of a deployed database. Implementation must confirm migration state. The schema and indexes below are proposed implementation work; this document does not apply them.

## Schema and migration plan

Add `name text` and backfill a meaningful, unique name for every existing source before setting NOT NULL and adding `source_name_key UNIQUE (name)`. Names should identify the source to an administrator; use a reviewed mapping from existing rows to names rather than ID-derived labels or assuming URLs are unique. Audit missing/blank names and collisions before applying the constraints. Add a check requiring a nonempty trimmed value, and trim names at write boundaries. Do not supply a placeholder default that masks missing names.

Use the database's existing deterministic text collation consistently for uniqueness, ordering, and cursor comparisons. Uniqueness is case-sensitive in this design; Name A–Z means database text order, not a separate browser locale sort. Verify the actual column collation during implementation. Case-insensitive identity or ordering would require a coordinated constraint, index, and query change.

Stage the rollout: add the nullable column, update all source creation/import paths and fixtures to supply names, backfill and validate existing data, then enforce the constraints and deploy the table. Inventory writers before making the column required. Existing rows' `updated_at` trigger will fire during backfill; record this expected consequence. For a large live table, choose a staged backfill and index build strategy appropriate to its size instead of one long blocking migration.

Extend the existing column-level grants with SELECT, INSERT, and UPDATE on `name` for authenticated users, retaining the existing source RLS policies. The listing remains read-only; this grant supports existing authorized source writers. Update codecs and any generated database types.

## Filters and useful sorts

| Field          | Filter control              | Sort control                                                                | Supporting index after migration                        |
| -------------- | --------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| `name`         | Fuzzy name search           | A–Z / Z–A (default A–Z)                                                     | Unique constraint on `(name)` plus trigram search index |
| `type`         | All types or exact type     | Type then name, both ascending or both descending                           | `(type, name)`                                          |
| `enabled`      | All, Enabled, Disabled      | Disabled first / Enabled first; name follows the same direction             | `(enabled, name)`                                       |
| `last_fetched` | All, Never fetched, Fetched | Oldest first with Never fetched first; newest first with Never fetched last | `(last_fetched ASC NULLS FIRST, id ASC)`                |
| `created_at`   | None initially              | Oldest / newest first, ID in the same direction                             | `(created_at, id)`                                      |
| `updated_at`   | None initially              | Oldest / newest first, ID in the same direction                             | `(updated_at, id)`                                      |
| `url`, `notes` | None                        | None                                                                        | None                                                    |

The current type constraint permits only `web_scrape`. Display “Web scrape”; type sorting therefore currently behaves like name sorting. Keep the schema-derived allowlist explicit. IDs remain selected internally for row keys, deduplication, and timestamp tie-breakers.

Filters combine with AND. Apply filters with an Apply button, and provide Clear filters. Keep draft inputs separate from the applied query. Sort changes apply immediately to the currently applied filters. Label the input “Search names”. Apply or Enter commits the search together with the other filters; typing only changes draft state. Clearing the search and applying restores the unsearched listing with the selected sort.

### Proposed indexes

The implementation migration should create these indexes alongside the unique name constraint. Enable `pg_trgm` in the project's extension schema (reuse its existing installation if present), and schema-qualify its operator class and operators:

| Proposed index               | Definition                               | Purpose                                                                                            |
| ---------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `source_name_key`            | Unique constraint on `(name)`            | Enforces identity and gives a total name ordering; do not also create a duplicate name index       |
| `source_name_trgm_idx`       | GIN on `(lower(name) gin_trgm_ops)`      | Candidate lookup for fuzzy name search; keep the unique B-tree for uniqueness and alphabetic order |
| `source_enabled_name_idx`    | `(enabled, name)`                        | Stable enabled grouping; name order within an exact enabled filter                                 |
| `source_type_name_idx`       | `(type, name)`                           | Stable type grouping; name order within an exact type filter                                       |
| `source_last_fetched_id_idx` | `(last_fetched ASC NULLS FIRST, id ASC)` | Prioritize never-fetched/oldest sources; reverse scan supplies newest first with nulls last        |
| `source_created_at_id_idx`   | `(created_at, id)`                       | Stable creation-time order in either direction                                                     |
| `source_updated_at_id_idx`   | `(updated_at, id)`                       | Stable modification-time order in either direction                                                 |

A unique, non-null name already supplies a total order, so name sorting needs no additional ID key. Grouped sorts use name as their unique, readable tie-breaker. Timestamp sorts use the hidden ID because timestamps can tie. Reverse every ordering component together so one index supports both directions. In particular, Enabled first uses name Z–A within each group; retaining name A–Z in both group directions would require another mixed-direction index and is outside this initial contract.

The new `(enabled, name)` and `(type, name)` indexes can also support the existing equality predicates. After checking existing workload plans (including `countActive`), consider dropping the now-overlapping single-column `source_enabled_idx` and `source_type_idx`; do not remove them blindly, since their smaller size may still help existing workloads. Retain the primary key.

These indexes cover each advertised ordering, but not every filter/sort combination with an equally efficient bounded scan. For example, Enabled + Last fetched can require filtering an ordered scan or sorting matching rows. Check realistic authenticated query plans for first and deep pages. If this combination is frequent and slow, add `(enabled, last_fetched ASC NULLS FIRST, id ASC)`; if Type + Enabled + Name becomes selective and common, consider `(type, enabled, name)`. These are conditional follow-ups, not indexes to create speculatively. Timestamp indexes incur write maintenance, especially last_fetched; measure ingestion impact as well as read latency.

PostgreSQL documents [B-tree ordering and reverse scans](https://www.postgresql.org/docs/current/indexes-ordering.html) and the [loss of ordering when combining indexes](https://www.postgresql.org/docs/current/indexes-bitmap-scans.html). Existing timestamp indexes apply to `public.user`; sources needs the new indexes proposed here.

## Fuzzy name search

Use PostgreSQL `pg_trgm` word similarity so a misspelled word can match part of a longer source name. Apply the index-supported predicate `lower(searchText) <% lower(name)`, with a fixed initial `pg_trgm.word_similarity_threshold` of `0.4`. The GIN expression must match the queried `lower(name)` expression. See [PostgreSQL's trigram operators and index support](https://www.postgresql.org/docs/current/pgtrgm.html).

Search is a filter: retain the selected table sort, including the default Name A–Z. Do not introduce relevance ordering or a floating-point score cursor in this iteration. Existing total orders and cursor variants remain valid after filtering. The search predicate combines with Type, Enabled, Fetch status, and the cursor before applying the 51-row limit. The trigram index finds candidates; ordering those candidates can still require a sort.

Trim surrounding whitespace. An empty value means no search predicate. Require at least three characters with at least three letters/digits and cap input at 200 characters. Invalid input shows an inline message and leaves the applied query/results intact. Search is case-insensitive through database lowercasing; accent folding, token reordering, arbitrary wildcard syntax, and exact edit-distance guarantees are outside this contract. Punctuation is passed as literal input, never interpreted as SQL or a user-supplied pattern. The threshold is an initial product choice: tune it with real source names and representative typos before shipping, then keep it fixed while paginating the applied query.

Implement a typed `list_source_page` SECURITY INVOKER RPC for the listing, including requests without a search term. Use bound values and allowlisted sort branches, schema-qualified database objects, and a restricted search path. Set the similarity threshold through function-local configuration that is restored after the call; do not change a pooled session's global setting. Revoke default PUBLIC/anon execution and grant execution to authenticated only. Existing column privileges and source RLS continue to govern the invoker's reads. Return only the specified source columns.

The service keeps its `listPage(query, cursor)` interface and calls this RPC with structured arguments. Include the applied search text in query identity and every page request. Applying a changed search invalidates previous cursors and pending responses, resets to page one, and follows the same pending-request identity guard as other filter changes. Refresh repeats the applied search. A response for an earlier search must never append to the current results.

## Page experience

- Toolbar: Search names input, Enabled filter, Type filter, Fetch status filter, Apply, Clear filters, and Refresh. Default Enabled is All; the overview's existing sources link continues to open this default view.
- Columns: Name, URL, Type, Enabled, Last fetched, Created, Updated, Notes. Display null Last fetched as “Never fetched”. Use a horizontally scrollable table on small screens. Wrap or truncate long URL/notes text with an accessible way to reveal the full value. Render notes as text. Only render URLs with HTTP(S) schemes as links.
- Sortable headers: Name, Type, Enabled, Last fetched, Created, Updated. Clicking the selected header toggles direction; clicking another selects its ascending order. Indicate the active direction with text/icon and `aria-sort`. Other headers are plain labels.
- Initial loading: table loading state. Initial failure: error and Retry. Successful empty result: “No sources match these filters” and Clear filters.
- Loaded state: keyed rows by source ID and “50 sources loaded”, increasing as pages append. Avoid an exact total-count query for each page.
- Footer: Load more, Loading more…, or a local error with Retry. End state reads “All matching sources loaded”. Refresh errors appear above the table while keeping the rows.
- Refresh retains rows and indicates that they are refreshing. Disable load more during refresh. Applying a different query clears old results and resets scrolling; do not display old rows as results for new filters.
- Keep focus on the initiating control and announce appended row counts through a polite live region. An explicit Load more button is available for accessibility.

For the first implementation, filter and sort state live in the admin model, without changing the route's query-string contract. Navigating to Overview and back retains the applied query and loaded rows within the current authenticated model; reload uses defaults. Shareable query URLs can be added separately.

## Model

Define codecs for the row, query, cursor, result page, and the following conceptual types using the project's Effect Schema and Foldkit tagged-union conventions:

```text
SourcesTableModel
  draftFilters
  query: { filters: { searchText, type, enabled, fetchStatus }, sortField, direction }
  nextRequestId: number
  pendingRequest: Option<{ requestId, kind, cursor }>
  feed: AsyncData<{ items: SourceRow[], more: More }, SourceError>

More
  Ready { cursor }
  Loading { cursor }
  Failed { cursor, error }
  End

SourcePage
  items: SourceRow[]
  nextCursor: Option<SourceCursor>
```

`pendingRequest.kind` distinguishes initial, refresh, and more; its cursor is absent for initial/refresh. It records identity for rejecting late messages, while AsyncData and More determine the rendered state. Maintain the invariant that at most one request is current for this table. Keep this counter independent of the overview's `sourceRequestId`. Allocate a fresh request ID for every fetch, including retries. Clear pendingRequest when abandoning a request or accepting its completion; replace it when starting a superseding request. Accept a completion only when its ID matches the current pending request. With at most one current request, a separate listing-generation counter adds no protection.

Never reuse a request ID while a response with that ID can still arrive. Preserve the monotonically increasing allocator across table resets, route changes, and authentication changes for the lifetime of the running application; store the allocator at the application level if the child model is recreated. The `nextRequestId` shown here describes that allocator, not a counter that resets with the table. Carry the initiating user identity as an additional completion guard; user identity alone cannot distinguish two sessions for the same user.

The cursor has one variant per sort field: name alone; type plus name; enabled plus name; or timestamp plus internal ID. Last-fetched cursors explicitly distinguish a null timestamp from a present timestamp. All values come from the final emitted row. The request also carries the immutable applied query and request ID. Validate returned rows at the service boundary, including nullable notes and last_fetched. Decode timestamps without losing their instant.

`source.id` is a PostgreSQL bigint. It probably comes from PostgREST via the Supabase SDK as a string, but confirm this yourself.

## Request and cursor contract

Extend `Sources.Service` with `listPage(query, cursor)` returning a typed Effect of `SourcePage`. Keep `countActive` for Overview. Use the existing authenticated Supabase client and publishable key, explicit column selection, abort signals, and typed SourceError conversion. The selected columns are `id,name,type,url,notes,enabled,last_fetched,created_at,updated_at`.

Request 51 rows; emit the first 50. An extra row means there is another page: derive the cursor from the last emitted row, never the extra row. Otherwise return no cursor. A result of exactly 50 rows without an extra row is End. Do not use increasing OFFSET values.

Use the exact total orders defined above, with exclusive cursor boundaries:

- Name A–Z: name greater than the cursor name. Z–A: name less than it. Use database comparisons and the same collation as the unique index.
- Type ascending: type greater than the cursor type, OR equal type and name greater than the cursor name. Reverse both comparisons and ordering for descending.
- Enabled ascending: after a false cursor, accept remaining false rows with greater names plus true rows; after a true cursor, accept only true rows with greater names. Descending reverses group order and name comparisons.
- Created/Updated ascending: timestamp greater than the cursor timestamp, OR equal timestamp and ID greater than the cursor ID. Reverse both comparisons for descending. Preserve timestamp precision in the cursor; do not round through JavaScript Date milliseconds.
- Last fetched oldest first (`ASC NULLS FIRST`, ID ascending): after a null cursor, accept null rows with greater IDs plus all non-null rows. After a non-null cursor, accept only greater timestamp/ID pairs, excluding nulls.
- Last fetched newest first (`DESC NULLS LAST`, ID descending): after a non-null cursor, accept lesser timestamp/ID pairs plus all null rows. After a null cursor, accept only null rows with smaller IDs.

AND the cursor condition with all applied filters, including fuzzy search. Express these predicates inside the parameterized listing RPC described above; name and search values are bound data, never SQL fragments. Keep the server's ordering authoritative; never sort only the loaded rows in the browser.

This is a live listing, not a database snapshot across requests. Concurrent edits to name, enabled, type, or the selected timestamp can move rows across a cursor. Merge appended rows by ID, retaining their original position and updating an already-seen row's contents, so duplicates are not rendered. Advance the cursor from the raw returned page even if every row was already present. Concurrent changes can still cause omissions; Refresh rebuilds the listing. Do not promise snapshot consistency.

## Update lifecycle

1. **Enter Sources:** after the existing admin-access gate succeeds, use `loadIfMissing` on the table feed and issue the initial command. An already loaded collection is retained. Direct navigation must trigger this after access resolves as well as on ordinary section changes.
2. **Apply filters or change sort:** validate and normalize the new query. If unchanged, do nothing. Otherwise invalidate any old pending request, clear rows, enter Loading, and request page one with a fresh request ID. Cancellation is useful but request identity checks provide correctness.
3. **Initial completion:** accept only a matching authenticated user and current pending request ID, with the expected request kind. Clear pending identity and settle the mapped page result into the outer AsyncData. Build More as Ready or End.
4. **Load more:** accept only when access is allowed, Sources is active, no request is pending, the feed has data and is not refreshing, and More is Ready (or Failed for an explicit Retry action). Change More to Loading with the same cursor and issue the command. Repeated click/observer messages are no-ops while pending.
5. **More completion:** apply the identity guards plus the expected cursor. Clear the accepted pending request. On success, merge rows and set Ready/End; on failure, keep rows and set Failed with the original cursor. Use `AsyncData.map` for this update so a pre-existing outer Stale state and its refresh error are preserved. A successful append loads more rows but does not revalidate previously loaded rows, so it cannot resolve the failed refresh. Clear the footer error on append success; retain the refresh error until a successful refresh or a new query replaces the collection. Do not pass a raw next-page result to `AsyncData.settle`, which would replace the accumulated rows.
6. **Refresh:** invalidate any pending append. Before calling `revalidateOrLoad`, convert only inner Loading to Ready with its retained cursor: the append has been abandoned, so the fallback collection must no longer claim it is running. Preserve inner Failed, including its cursor and error; Ready and End also remain unchanged. Hold that collection in Refreshing and request page one with a fresh request ID. Clear the accepted pending request on completion. Success replaces all rows and More; failure settles to Stale with the retained collection. Converting abandoned Loading to Ready prevents a failed refresh leaving a footer spinning forever and allows pagination to resume from the retained cursor. Preserving Failed means a failed refresh can leave both a refresh error and an append error visible, with separate retry actions. Block append requests while refresh is pending; a repeated refresh while already refreshing is a no-op.
7. **Leave Sources:** stop the optional observer and invalidate/cancel the table's pending request. Normalize inner Loading to Ready; restore outer Refreshing to Success with held data, or outer Loading to Idle. Retain settled rows/query. Return loads only if missing. Ignore late completions from the abandoned request.
8. **Logout, user replacement, or revoked access:** clear the table and pending identities through the existing authenticated model lifecycle. Never accept an earlier user's response after a new session begins. Access revalidation hides the table according to the existing `canAccessAdmin` rule and must suspend new table requests.

Do not combine accumulated data and the pending page through `AsyncData.all`: a Loading or Failure child would hide previously loaded rows.

## Integration and authorization

Keep the existing admin shell and navigation in `src/page/admin/view.ts`; render a sources child view from its Sources branch. Put table-specific model, messages, commands, update, and view under `src/page/admin/sources/`, composing through the existing Foldkit Submodel conventions. Keep the sources row/query/page codecs and service operation in `src/domain/sources.ts` or a focused adjacent domain module if it becomes large.

Update admin section entry and parent message routing so access resolution and route changes initialize the appropriate child. Add observer subscription lifting only if automatic loading is included; its lifetime must require the Sources route, allowed access, and a loadable footer. Re-evaluate after successful appends if the sentinel remains visible. Stop automatic retries after errors; Retry is explicit.

The existing SELECT policy admits authenticated users with source_read or source_write, and migrations grant SELECT on existing columns. Add the name column grants described above. Preserve those checks and the admin gate. Read through the user's session; do not introduce a privileged browser credential, bypass RLS, or broaden row access. A permission-related fetch failure must not be treated as successful empty data. RLS may also yield zero rows rather than an error, so the existing permission gate remains significant.

## Implementation verification

- Schema coverage: meaningful backfill, missing/blank and duplicate name rejection, writer compatibility, and name column grants under existing RLS.
- Service/query coverage: all allowed filter and sort variants; name punctuation, case/collation behavior, timestamp ties and sub-millisecond precision, null last-fetched boundaries in both directions; tied type/enabled values across page boundaries in both directions; combined filters; 0, 49, 50, and 51-row responses; correct cursor source; malformed rows and unsafe IDs; nullable fields; network failures.
- Search coverage: exact and partial-name matches, representative typos, case variants, unrelated names, punctuation, whitespace, invalid short/oversized inputs, and empty search. Verify threshold configuration does not leak between calls; authenticated RPC execution preserves source RLS; search combines correctly with every filter and sort across page boundaries. Inspect trigram query plans on realistic data and benchmark broad matches.
- Pure update stories: initial/retry, duplicate load-more messages, append/retry, End, refresh replacing pages, failed refresh after an abandoned append restoring Ready with the same cursor, failed refresh preserving an existing inner Failed error/cursor, successful append preserving outer Stale and its refresh error, query/search changes during fetch, navigation during fetch, and stale completions after session changes (including signing back in as the same user), and non-reuse of request IDs across child-model resets. Include a next page containing only already-seen IDs.
- Scenes: accessible controls and sorting indicators, applying/clearing filters, initial empty/error, appending rows without losing existing ones, independent footer and refresh errors, and retained state on returning from Overview.
- Database checks during implementation: migration state and indexes, allowed/denied authenticated reads, and representative query plans with realistic cardinality for supported filter/sort combinations. Confirm the proposed indexes cover their intended ordering, inspect conditional composite-index needs. Verify the name sort and cursor comparison use the same collation.
- Run `pnpm fmt`, `pnpm lint`, `pnpm typecheck`, and `pnpm test:app` when implementing. This change is a design document only.

## Local references

- [Source schema and initial index](../../../supabase/migrations/20260924221315_users_owners_sources.sql)
- [Source permissions](../../../supabase/migrations/20260924224548_source_permissions.sql)
- [Enabled and last-fetched columns](../../../supabase/migrations/20260925130000_source_enabled_last_fetched.sql)
- [Additional column grants](../../../supabase/migrations/20260925140000_source_column_permissions.sql)
- [Enabled index](../../../supabase/migrations/20260925141000_source_enabled_idx.sql)
- [Existing sources service](../src/domain/sources.ts)
- [Admin request guards and section entry](../src/page/admin/update.ts)
- [Foldkit AsyncData behavior](../../../repos/foldkit/packages/website/src/page/asyncData.md)
