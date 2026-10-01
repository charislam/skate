# Public session calendars

## Outcome and scope

Populate the Day, Week, and Month calendars from a public projection of `public.skating_session` joined to `public.rink`. Complete the currently empty Month view. Anyone can browse sessions and open shareable session details without signing in.

Use one in-memory, date-keyed cache shared across views and dialogs. Each day owns an independent `AsyncData` collection, with ten-minute freshness and stale-while-revalidate behavior. Retain existing data during refresh and after refresh failure. This supersedes the earlier proposal to discard data on refresh.

Include session menus, a day dialog, a session-details dialog, manual refresh, and `/sessions/:id` links. Rink/audience filters, session editing, persistent caching, realtime subscriptions, and shareable calendar view/date parameters are outside this work. Keep the existing default Day view and the existing 1024px breakpoint for Week/Month availability.

## Existing integration points

- `src/view/calendar.ts` renders Day/Week headings; Month content is empty.
- `src/domain/active-date.ts` already models Day/Week/Month navigation with Monday-first weeks.
- `src/main.ts` hides the view selector below 1024px and switches to Day on a resize below that breakpoint. Initial dates currently use the browser's local timezone.
- `src/route.ts` currently has no session route. Public home state is shared between logged-in and logged-out model variants.
- `src/domain/supabase.ts` supplies the shared Supabase client. Add the calendar service to the existing Effect resource graph rather than creating another client.
- The existing base tables require authenticated permissions. Their timestamps use Toronto wall time in `timestamp without time zone` columns.

Follow `FOLDKIT.md`: schema-backed models, pure updates, commands for effects, and existing Foldkit UI components for menus/dialogs. Keep calendar loading and overlay behavior in a cohesive calendar submodel rather than expanding the root update with all feature logic. Use the vendored Foldkit source as read-only API reference.

## Public database contract

Create a read-only view named `public.calendar_session`, joining each session to its rink. Return exactly these fields:

| Field                      | Meaning                                               |
| -------------------------- | ----------------------------------------------------- |
| `id`                       | Stable session identifier, also used in the route     |
| `start`, `end`             | Full Toronto-local session boundaries                 |
| `audience`                 | `general`, `family`, `adult`, `children`, or `senior` |
| `is_cancelled`             | Cancellation flag                                     |
| `certainty`                | `certain` or `uncertain`                              |
| `rink_id`, `rink_name`     | Rink identity (text), and display name                |
| `rink_address`, `rink_url` | Nullable address and website                          |

All sessions are public, including past, cancelled, and uncertain sessions. The projection contains no source ID, provider/foreign ID, audit timestamps, or other internal fields. Use an explicit select list. The browser reads this view for both calendar collections and ID lookups, regardless of authentication state.

Grant `SELECT` on the view to `anon` and `authenticated`; grant neither role writes through it. Preserve existing authenticated administration of the underlying tables and do not grant anonymous access to those tables.

This public projection deliberately uses view-owner permissions: `security_invoker = true` would require callers to have underlying table access. Use a dedicated non-login owner without superuser or `BYPASSRLS`, limited to the base columns needed by the projection, with SELECT policies granting that owner access to all rink/session rows. Do not grant API roles membership in that owner role, table ownership, or schema creation privileges. The view owner must not own the base tables. This provides the explicitly authorized public projection while preserving the base-table permission boundary. PostgreSQL documents both owner-based view access and the application of the owner's RLS policies in [CREATE VIEW](https://www.postgresql.org/docs/current/sql-createview.html).

Deliver the database change through the repository's migration workflow. Verify anonymous and authenticated Data API access as well as SQL grants; dashboard exposure settings must allow the view to be queried. The existing test asserting anonymous base-table reads are denied should continue to hold.

## Dates, ordering, and retrieval

Treat database session boundaries as Toronto wall-clock values. Do not append `Z`, parse them as browser-local instants, or convert displayed times to the viewer's timezone. Compute today and the midnight rollover using `America/Toronto`. Date arithmetic uses calendar dates, not fixed 24-hour durations. Display readable 12-hour time ranges.

For day D, fetch all sessions overlapping the half-open interval `[D 00:00, next(D) 00:00)`: `start < nextDayStart` and `end > dayStart`. A session ending exactly at midnight does not appear the next day. A session spanning midnight appears on every date it overlaps; its ID remains the same in each bucket. Show “Continues from previous day” and/or “Continues next day” as applicable. Details always show the original complete date/time range.

Sort by original session start ascending, then session ID ascending for stable ties. Do not group by rink, hide past hours, or merge distinct database IDs even if they describe similar sessions. Use a lossless representation of database IDs throughout decoding, pagination, keys, and routes; do not silently round bigint values. You do not need to verify the shape of bigint ID values, just treat them as opaque but unique string identifiers.

Load the dates actually displayed: one for Day, seven for Week, and every cell including adjacent-month dates for Month. Use per-day requests with bounded concurrency (four active day loads), independently settled results, and in-flight deduplication. Do not fetch unrelated months. Evaluate query plans for the overlap predicate against representative data and add an appropriate supporting index if needed; the current rink-only index does not establish date-query performance.

Fetch every page for a day in deterministic `(start, id)` order. Respect the Data API row limit; a truncated response must never become a successful complete day. Accumulate pages inside the request and publish the complete day atomically. A later-page failure fails that day's refresh/load, retaining its previous complete collection when available. Do not show incremental page counts as complete session totals.

## Cache and AsyncData lifecycle

Model the cache as a schema-backed map keyed by Toronto `YYYY-MM-DD`. A day entry contains:

- `sessions: AsyncData<ReadonlyArray<CalendarSession>, CalendarError>`.
- Optional timestamp of the most recent successful complete fetch.
- Optional current request identity, including automatic/manual/retry origin.
- Request scheduling metadata needed for bounded concurrency and retry cooldown.

Use a monotonically increasing request ID and accept completions only for the matching pending request. Discard late responses for superseded or evicted entries. A date change does not make an otherwise current request's result invalid: it may finish and warm its own day entry, but cannot alter the active date or open a dialog. Prefer newly visible queued work over dates no longer visible.

Keep the cache in shared public calendar state across Day/Week/Month switches, overlay transitions, and login/logout. Its data is identical for all readers and must not include privileged table results. Browser reload starts a new cache. Bound retained state to 120 day entries using least-recently-used eviction; pin displayed days, dialog dates, and active requests. Evict inactive entries as needed without discarding visible data.

Freshness expires ten minutes after successful completion, including successful empty results. Read clocks through Effect commands/subscriptions and carry time in messages; keep updates pure. A time-expired `Success` remains data-bearing until revalidation begins. Do not construct `AsyncData.Stale` merely because ten minutes elapsed: that variant carries a refresh error.

Revalidate expired displayed entries when their freshness deadline arrives, on calendar/view entry, and on return to a visible browser tab. Pause automatic timers while the page is hidden or the calendar is not displayed. On resume, check expiry immediately. Failed attempts get a ten-minute automatic retry cooldown to prevent a loop; manual refresh or Retry bypasses that cooldown. Unexpired successful entries are reused. Do not refetch fresh data on every auth event.

Use `AsyncData.loadIfMissing` for missing data and `AsyncData.revalidateOrLoad` for expired, retried, or manually refreshed entries. Already pending entries do not start duplicate requests. Settle through `AsyncData.settle`:

| State                | Rendering                                                                         |
| -------------------- | --------------------------------------------------------------------------------- |
| Idle/Loading         | Day-local placeholder; never “No sessions”                                        |
| Success with no rows | “No sessions”                                                                     |
| Success with rows    | Session list/previews                                                             |
| Refreshing           | Existing rows or prior empty state remain visible, with a refresh indicator       |
| Failure              | Day-local error and Retry                                                         |
| Stale                | Existing rows or prior empty state remain visible, with a refresh error and Retry |

Render each day independently. Do not combine the whole range using `AsyncData.all`, which would let one unloaded/failed day hide its neighbors.

Provide a labelled Refresh action in the calendar controls. It forces refresh of every displayed day, including adjacent-month cells, while retaining all available data. Show an aggregate loading indicator until the targeted requests finish, without cancelling or duplicating requests already pending. Each failed day retains its own Retry action. The day dialog's Refresh targets only its day. Session-details Refresh targets its ID lookup; successful changes invalidate affected cached day collections so old dates/counts are corrected.

## Calendar presentation

Day displays the complete chronological session list. Week displays seven Monday–Sunday columns, each with its own chronological list and load/error state. Show rink names on every entry. Keep existing range navigation and “Go to today”; show unambiguous week headings across month/year boundaries.

Month uses a seven-column Monday-first grid beginning on the Monday on or before the first of the month and ending on the Sunday on or after its last day. Use the required number of complete weeks (four, five, or six), not a fixed six rows. Show adjacent-month dates and their sessions, with visually muted date labels, and distinguish today without relying on color alone.

Each month cell shows its date, the first three sessions in chronological order, and “N more” when additional sessions exist. Cancelled sessions count toward the three previews and the overflow count. The date button and “N more” both open the day dialog for that cell, including adjacent-month dates. Clicking a session preview opens its session menu instead. An empty day can still be opened through its date button.

Every session entry shows its time range, rink name, and audience. Mark uncertain sessions explicitly. Cancelled sessions remain interactive, use muted text and strike-through styling, and carry an explicit “Cancelled” label; retain readable contrast in both themes. Show continuation labels where applicable.

Below 1024px, only Day is available. Enforce this for initial route resolution, menu actions, and resizing. If a session dialog is open while resizing, keep it open and focus the underlying Day calendar on the session's starting date. Otherwise preserve the existing active-range-to-Day behavior. Increasing width does not automatically restore a previous Week/Month selection.

## Menus and dialogs

Use the established Foldkit menu/dialog primitives with keyboard navigation, Escape dismissal, focus trapping for dialogs, and focus restoration. Menu buttons must have accessible names identifying their session; loading and error updates must be announced without repeatedly stealing focus. Do not nest interactive controls inside an all-cell button.

The session popup menu has “View details” and “Open rink website”. Omit the website action when absent or not a valid HTTP(S) URL. Open valid external websites in a new tab with appropriate link protection. Opening details closes the menu.

The day dialog shows its full date and all overlapping sessions using the same day cache, list ordering, status labels, and session menus. It is scrollable when needed. It does not change the underlying calendar range or URL.

Session details replace the day dialog rather than stacking modal dialogs. If entered from a day dialog, offer “Back to [date]”, restoring that day's dialog and preserving its originating calendar context. Closing session details closes the entire overlay; it does not implicitly restore the day dialog.

Session details contain the full date/time range, rink name/address, audience, cancellation/uncertainty status, website link where available, and Copy link. Omit an absent address. Copy the canonical absolute `/sessions/:id` URL and announce success or failure. Do not include calendar view, date, or day-dialog origin in copied links.

## Routes, context, and history

Add public `/sessions/:id` routing to both authenticated and anonymous route models. The session ID is the only shared state. The sender's view is not encoded in the URL; the agreed behavior preserves the current recipient's view where available:

| Entry path                     | Calendar underneath details                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| In-app View details            | Preserve the exact existing Day/Week/Month context, including an adjacent-month or continuation-day origin                 |
| Shared link in an existing app | Preserve the recipient's current view kind; move it to the session's starting date, its Monday-starting week, or its month |
| Direct link in a fresh app     | Day at the session's starting date                                                                                         |
| Small screen                   | Day; shared-link entry uses the session's starting date                                                                    |

Local navigation context may be stored in application-owned browser history state, never in shared URL parameters. Preserve enough context to make Back/Forward deterministic within the current tab. A hard reload treats `/sessions/:id` as a fresh direct link.

Opening details in-app pushes one history entry. Browser Back closes details and returns to the prior local context; Forward reopens them. When the prior context was a day dialog, browser Back restores that dialog. The explicit close button instead closes all overlays, removes the session URL, and retains the underlying calendar. It must not unexpectedly leave the app or restore the day dialog. Use history back only when the known preceding app entry represents that required closed-overlay state; otherwise replace with `/` and the retained calendar context. Never push an extra entry merely to close details.

For direct/shared entry, render the details dialog in its own loading state and look up the ID through the public view. Derive the calendar date from the returned session before loading its day/week/month. Guard the result by route/request identity so a late lookup cannot reopen a dismissed dialog or navigate away from a newer session. Do not let the existing initial-date command overwrite a route-resolved date.

Use a separate ID-keyed `AsyncData` for detail lookup, with the same ten-minute freshness and retained-data refresh semantics. A complete fresh day row may seed detail data with its original fetch timestamp, avoiding redundant requests. An ID lookup must never mark an entire day loaded.

Keep local calendar context stable while details refresh; route entry derives its date once per resolved navigation, not on every poll. The ID lookup and background calendar loads have independent errors. A calendar-day failure must not hide successfully loaded session details.

For a malformed session ID or a successful lookup with no row, show “Session not found” in the dialog. Retain existing local calendar context when available; otherwise show today. A network or decode failure is an error with Retry, not “not found”. An authoritative missing result replaces previously cached detail content; a transient refresh failure retains it. Close returns to the loaded calendar without requiring browser history from outside the app.

## Acceptance and implementation verification

1. Anonymous and signed-in users with no session/rink permissions receive the same public projection. Internal fields are absent, anonymous base-table access remains denied, and neither API role can write through the view. Existing admin access still works.
2. Day, Week, and Month show real sessions in deterministic order, including empty days, ties, cancellations, uncertainty, and missing rink metadata. A day exceeding one API page has accurate complete counts.
3. Month grids cover four/five/six-week months, leap February, year boundaries, and adjacent-month sessions. Overflow and date buttons open the correct day without changing the calendar beneath it.
4. Non-Toronto browser timezones and Toronto DST changes do not shift stored times or day assignment. Midnight endpoints and sessions spanning multiple days obey the overlap rule and show continuation labels.
5. Switching views reuses fresh day entries. At ten minutes, visible data revalidates without disappearing. Manual refresh is visibly pending. Failed initial loads and failed refreshes render distinct per-day states; empty successful results are cached.
6. Verify concurrency limits, no duplicate pending loads, retry cooldown, eviction, and late-response guards. Navigation during loading cannot replace another date's data; old detail responses cannot reopen overlays.
7. Day-dialog → menu → details → Back-to-day and explicit close follow the specified flow. Browser Back/Forward, direct-link reload, missing IDs, network failure, copy-link failure, login/logout, and resize preserve the intended context.
8. Links contain only `/sessions/:id`. Fresh recipients see Day; existing recipients retain their view kind at the session's date. Mobile never renders Week/Month.
9. Cover pure date/cache transitions with domain and Foldkit story tests, accessible menu/dialog flows with scene tests, and database exposure with database/API checks. Verify query plans and multi-page retrieval using representative data.
10. During implementation, run the relevant tests and repository convention commands: `pnpm fmt`, `pnpm lint`, and `pnpm typecheck`. This specification change itself requires no application or database deployment.

## References

- [Active-date state machine](../src/domain/active-date.ts)
- [Calendar view](../src/view/calendar.ts)
- [Routes](../src/route.ts)
- [Shared Supabase resource](0006_SHARED_SUPABASE_RESOURCE.md)
- [Session persistence specification](0009_PERSIST_SCRAPED_SESSIONS.md)
- [Foldkit AsyncData behavior](../../../repos/foldkit/packages/website/src/page/asyncData.md)
- [PostgreSQL view permissions](https://www.postgresql.org/docs/current/sql-createview.html)
