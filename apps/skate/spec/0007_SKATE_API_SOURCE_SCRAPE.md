# Skate API: source scraping

## Scope and agreed behavior

Create one Supabase Edge Function named `skate-api`, exposing `POST /skate-api/source/scrape`. Use Effect v4 throughout the backend, including its schema-based HTTP API and routing. The Deno entrypoint only connects the Effect web handler to `Deno.serve` and manages shutdown.

The endpoint accepts one `public.source` ID, authenticates a Supabase secret API key, loads the source, rejects disabled sources and types other than `web_scrape`, fetches HTML, and uses Jev through `ClassifierService` to extract individual public skating occurrences for four weeks. Return JSON and update `last_fetched` after successful processing. Do not persist sessions or create a Cron job in this iteration.

Include general, family, adult, children, and senior public skating. Include cancelled occurrences and represent uncertainty explicitly. Questions below are an initial version intended for iteration. Implement a real Jev adapter, with fakes restricted to tests.

## HTTP contract

- Hosted URL: `https://<project-ref>.supabase.co/functions/v1/skate-api/source/scrape`.
- Function route: `/skate-api/source/scrape`; `/functions/v1` belongs to the Supabase gateway. Verify the actual forwarded pathname using the local Edge Runtime.
- Method: `POST`; content type: `application/json`; body: `{ "sourceId": "123" }`.
- Decode the ID as a branded decimal string within the positive PostgreSQL bigint range. Never round-trip IDs through JavaScript numbers. Reject missing, fractional, negative, zero, out-of-range, numeric JSON, and unexpected body fields.
- Require `apikey: sb_secret_...`. A user JWT, legacy service-role JWT, publishable key, anonymous key, absent key, or arbitrary string must not authorize the endpoint.
- Limit the request body to 4 KiB. Do not accept caller-supplied URLs, prompts, notes, model names, or date overrides.
- Success is `200` with the response described below. Uncertain or unavailable schedule information is a valid result, distinct from transport, validation, and provider failures.
- Register only this application endpoint. Do not enable runtime OpenAPI/docs/health routes. An OpenAPI artifact can be generated during development without exposing another route.

Supabase documents function-name prefixes for routes. [Routing reference](https://supabase.com/docs/guides/functions/routing).

## Authentication

Set `[functions.skate-api] verify_jwt = false`. This disables the gateway's user-JWT check; the Effect authentication middleware must validate the secret key before source access or external calls. This is Supabase service authentication, as clarified by the user. [Authentication](https://supabase.com/docs/guides/functions/auth), [header handling](https://supabase.com/docs/guides/functions/auth-headers).

Use `@supabase/server/core` credential verification inside an Effect adapter, called by `HttpApiMiddleware`. Pin the package version and inspect its exported types during implementation. Wrap its Promise boundary with `Effect.tryPromise`, handle both thrown failures and returned errors, and translate them to application errors. Keep the rest of the middleware and handler in Effect; do not wrap the application in a second HTTP framework.

Configure one allowed key name through `SKATE_API_KEY_NAME`, initially `default`, and verify using `secret:<name>`. Resolve Supabase's secret-key map through Effect `Config`, pass explicit environment/config overrides into the adapter, and fail closed if the selected key is absent. A named automation key can replace `default` when Cron is configured. Do not accept a key solely because its prefix looks valid, and do not silently fall back to user authentication. The current server package distinguishes the default key, named keys, and wildcard acceptance. [Core primitives](https://github.com/supabase/server#primitives), [named key semantics](https://github.com/supabase/server/blob/main/docs/auth-modes.md).

Create the privileged database client once in its layer using configured server credentials, with session persistence and refresh disabled. Never derive database credentials from an unvalidated request or import the frontend Supabase resource. Keep secrets redacted and out of browser packages. Local serving must exercise the same authentication middleware, with explicit local secret configuration.

## Time window and domain defaults

Capture the clock once at the start of the authenticated workflow. Use the local date in `America/Toronto` as day zero. The window is local midnight today through local midnight 28 calendar days later, with an exclusive end. Week 1 is days 0–6, Week 2 days 7–13, Week 3 days 14–20, and Week 4 days 21–27; these are consecutive seven-day buckets rather than ISO calendar weeks. Include today's sessions even if their start time has passed.

Compute dates, weekdays, and week boundaries in code using Effect's clock and timezone-aware date facilities. Advance calendar days rather than adding 24-hour milliseconds across daylight-saving transitions. Give the classifier explicit ISO dates and weekday labels. Assign an occurrence to the week containing its start date; an overnight session can end outside that week or the overall window.

The following are initial product defaults, additional to the confirmed requirements:

- Exclude lessons, private rentals, organized hockey, and competitive practices from public skating.
- Treat each advertised occurrence as one session. Expand an explicit applicable weekly recurrence into dated occurrences; never extrapolate beyond a stated season or validity range.
- Classify family skating as `family`, explicitly adult skating as `adult`, children's/preschool skating as `children`, senior skating as `senior`, and otherwise unrestricted public skating as `general`. Ambiguous labels produce a null classification and an uncertainty reason.
- Retain start and end times separately. Missing end time does not imply a duration. Missing dates or times remain null with reasons.
- Offer the union of ten-minute and quarter-hour marks: `HH:00`, `HH:10`, `HH:15`, `HH:20`, `HH:30`, `HH:40`, `HH:45`, and `HH:50`. Include overlapping marks such as `HH:30` only once.

## Effect architecture and repository layout

Use the existing `effect` pin, currently `4.0.0-rc.115`, and normal dependency imports. The installed package and `repos/effect` are read-only references. Avoid v3 APIs or adding `@effect/platform` as though this were a v3 application.

Keep this first backend under `supabase/functions/skate-api/`, with a small entrypoint, Deno dependency/lock configuration, and focused modules:

```text
index.ts                      Deno.serve and shutdown wiring
app.ts                        Effect route and layer composition; web handler
api.ts                        HttpApi, group, endpoint, input/output/error schemas
http/source.ts                Thin scrape handler
http/auth.ts                  Effect authentication middleware
domain/source.ts              Persisted source decoding and branded ID
domain/schedule.ts            Result types, dates, uncertainty, invariants
domain/questions.ts           Versioned draft question builders
services/source-repository.ts Lookup and successful-fetch update interface
services/html-source.ts       Bounded HTML retrieval and normalization
services/classifier.ts        ClassifierService and provider-neutral contract
services/source-scraper.ts    Workflow, rounds, validation, completion
adapters/supabase-auth.ts     Official credential verification boundary
adapters/supabase-source.ts   Supabase repository implementation
adapters/jev.ts               Working Jev HTTP implementation
config.ts                     Validated configuration recipes
tests/                        Domain, service, adapter, and HTTP tests
```

Do not import frontend domain modules: they depend on Foldkit and browser resources. Keep API schemas separate from server implementation so they can later move into a shared package without exposing credentials. Add backend formatting, linting, typechecking, and test commands to repository tooling; the current root commands do not cover this directory. Pin Deno dependencies, commit the lockfile, and verify deployment resolves imports without relying on workspace symlinks.

Define routes with `effect/unstable/httpapi` (`HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`, `HttpApiMiddleware`). Build handler layers with `HttpApiBuilder.group`, routes with `HttpApiBuilder.layer`, and the Fetch-compatible handler with `HttpRouter.toWebHandler`, providing `HttpServer.layerServices` where required. These APIs were checked against the installed rc.115 source and vendored HTTP examples. Construct the handler once per isolate, share its layer graph across requests, and dispose it on graceful shutdown and in tests. Do not run a new Effect runtime inside every handler or adapter.

Services use `Context.Service`, real implementations use `Layer.effect` and `Service.of`, operations use named `Effect.fn`, and workflows use `Effect.gen`. Follow the repository's namespace module style where convenient; the classifier module must expose an identifiable `ClassifierService`. Records use `Schema.Struct` plus interfaces; expected failures use `Schema.TaggedError`. Decode persisted rows, provider payloads, and HTTP inputs at their boundaries.

The dependency graph is explicit: source scraper depends on repository, HTML source, classifier, and configuration; repository depends on the privileged Supabase client; HTML and Jev adapters depend on separately configured Effect HTTP clients backed by `FetchHttpClient.layer`. Authentication supplies a request-scoped authenticated-service identity. Use `Layer.provide` to hide adapter dependencies and merge only independent exposed services. Secrets and required infrastructure must not hide behind ambient defaults.

## Source lookup and HTML retrieval

Read `id::text`, `name`, `type`, `url`, `notes`, `enabled`, and the exact `updated_at` text. Decode `type` as a string at the persistence boundary, then explicitly reject unsupported types; the current database constraint permits only `web_scrape`, but the endpoint should preserve a useful unsupported-type error if that changes. Distinguish no row from database failures. Null notes are valid.

Fetch only the stored URL and accept a successful `text/html` response, allowing normal content-type parameters. Parse HTML with a pinned Deno-compatible parser; retain headings, table structure, dates, cancellation notices, and document order. Remove scripts, styles, and irrelevant navigation without discarding schedule meaning.

Do not execute JavaScript, follow schedule links, fetch PDFs/images, or run OCR. An unsupported media type or oversized document is an explicit error.

Initial limits: 2 MiB decompressed HTML, three redirects, 15 seconds for retrieval, and a conservative 24 KiB UTF-8 budget for the serialized classifier state. Stop oversized reads while streaming; do not buffer an unbounded body first. If normalization still exceeds the state budget, fail with `SourceContentTooLarge`; do not silently truncate a schedule.

Allow only HTTP(S) URLs without embedded credentials and only public destinations. Validate redirects before following them; reject loopback, private, link-local, metadata, and otherwise reserved addresses, including IPv6 and mixed DNS answers. The HTML transport must prevent DNS rebinding between validation and connection; confirm the selected edge-compatible transport can enforce this. If it cannot, use explicitly configured trusted source hosts with controlled DNS and reject other hosts until an enforcing egress mechanism exists. Never attach Supabase or Jev credentials to source requests.

## Classifier contract and Jev adapter

`ClassifierService.classify` accepts a bounded context snapshot and a map of named questions. Initially support two provider-neutral variants: a choice question with explicitly labelled options, and a yes/no question. Return corresponding choice answers with probabilities/confidence or yes probabilities. Callers depend only on these schemas and typed classifier errors. Jev request fields, authentication, response decoding, and model configuration stay in `adapters/jev.ts`.

Implement the adapter using Effect `HttpClient` with `FetchHttpClient.layer`:

- POST `https://api.typesafe.ai/v1/systemone`, bearer `TYPESAFE_API_KEY`.
- Translate context to `state`, configured model to `model`, and questions to the provider's keyed `questions` map.
- Map choices to `type: "choice"` with `instructions` and `criteria`; map yes/no to `type: "noul"`.
- Decode the returned `answers`, `model`, and `usage`. Validate answer IDs, variants, selected options, finite probabilities, confidence range, and distribution sums within a floating-point tolerance. Missing answers or foreign options are errors.
- Preserve provider model/version and usage in diagnostic metadata; normalize answers before returning them to services.
- Translate provider status and decode failures to typed errors. Specifically handle 401, 422, 429, and 529. Retry 429/529 with bounded exponential backoff and jitter, respecting `Retry-After` and the overall deadline.

[Jev HTTP API](https://docs.typesafe.ai/api).

Default `TYPESAFE_MODEL` to the versioned `jev-1.13.0`, with configuration allowing deliberate upgrades. Model limits currently include 64k tokens across a request and 32k for state plus the longest question. Bound complete serialized requests conservatively to 48 KiB UTF-8, including instructions and option descriptions, and split question batches before exceeding the budget; verify those conservative budgets against the actual provider tokenizer during implementation. Do not assume a character count is an exact token count. [Models and context limits](https://docs.typesafe.ai/models).

Limit classification batches to 24 questions and two concurrent calls, decreasing batch size as needed for the byte budget. A hard ceiling of 255 options per choice means `0..200`, `over_200`, and `unknown` fit, as do 192 distinct time choices (eight marks per hour) plus three sentinel options, for 195 total options. [Choice primitive](https://docs.typesafe.ai/primitives/choice).

Question IDs are correlation keys, not model instructions. Every question includes its full semantic target. Later rounds explicitly carry earlier decisions in state; questions within one batch cannot read each other's answers. [Jev evaluation model](https://docs.typesafe.ai/introduction).

## Draft classification rounds

Version the initial question set as `source-scrape-v1`. State includes source ID/name/URL, nullable notes, normalized HTML blocks, timezone, window boundaries, and explicit dates for each week. Page contents are evidence, never executable instructions.

### Round 1: weekly availability and counts

Ask independently for each of the four explicit week ranges:

1. **Coverage:** “Does this page contain a skating schedule applicable to the dates listed for this week?” Choices: `complete`, `partial`, `not_available`, `unclear`.
2. **Count:** “How many individual public skating occurrences of the permitted categories does the schedule describe for these seven dates, including cancelled occurrences? Count each occurrence once. Use zero only when the evidence supports no occurrences; use unknown when the schedule cannot establish a count.” Choices: string labels `0` through `200`, `over_200`, `unknown`.

Include category definitions, the concrete seven dates, recurrence rules, and cancellation rules directly in each question. An unknown count does not become zero. `over_200` does not get capped to 200. Return that week as unresolved with the appropriate reason and continue other weeks. A low-confidence numeric count may drive exploratory extraction but must remain labelled uncertain.

### Round 2: identify each occurrence

For a numeric count N, ask for occurrences 1 through N. Define the ordering identically in every question: local date, local start time, then document block order for ties; unknown dates/times follow known values in document order. Every prompt states the week, occurrence index, and ordering rule.

For each occurrence ask:

- **Existence:** “Is occurrence N a distinct occurrence supported by this schedule?” Yes/no probability.
- **Date:** “Which listed local date is the start date of occurrence N?” Choices: the week's seven ISO dates with weekday labels, `unknown`, `outside_week`.
- **Evidence:** “Which source block most directly describes occurrence N?” Choices: retained block IDs plus `unknown`. Partition candidate blocks in code if necessary to stay within the choice limit; do not drop blocks silently.

The selected block is an anchor, not proof of correctness. If unavailable, retain the occurrence as uncertain. An unsupported occurrence is removed from extracted sessions and recorded as a count discrepancy. Ambiguous existence is retained with uncertainty.

### Round 3: extract fields against the anchored occurrence

Pass the explicit occurrence descriptor and selected evidence block, alongside relevant surrounding headings/notes, into every question. Batch independent fields:

| Field                 | Draft question                                                               | Choices                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Start time            | What local clock time does this occurrence start?                            | Every hour at minutes `00`, `10`, `15`, `20`, `30`, `40`, `45`, `50`, plus `off_grid`, `not_stated`, `unclear` |
| End time              | What local clock time does this occurrence end?                              | Same choices                                                                                                   |
| End day               | Does its end time belong to the start date or the following date?            | `same_day`, `next_day`, `unknown`                                                                              |
| Category              | Which advertised public skating category describes this occurrence?          | `general`, `family`, `adult`, `children`, `senior`, `unknown`                                                  |
| Cancellation          | What cancellation status is supported for this occurrence?                   | `scheduled`, `cancelled`, `unclear`                                                                            |
| Publication certainty | Is this occurrence presented as definite, tentative, or conflicting/unclear? | `definite`, `tentative`, `conflicting`, `unknown`                                                              |

After the field answers and any exact-time fallback are available, ask a follow-up yes/no question for whether the page explicitly supports the assembled date/time occurrence, including applicable exception notices. Include those selected values in its state; it cannot depend on answers from its own batch. Preserve its probability as evidence strength, distinct from model confidence.

For `off_grid` times, a bounded follow-up chooses the exact hour (`00..23`) and minute (`00..59`), each with unknown options. Never snap times to the combined ten-minute and quarter-hour grid. Cross-field validation catches inconsistent component choices.

### Deterministic reconciliation

Validate dates, window membership, time syntax, and end-after-start using code. Do not assume an end time earlier than the start time means overnight without supporting end-day evidence. All web_scrape targets give their schedules in America/Toronto local time.

Compute returned counts from the reconciled sessions, keeping the model's weekly count separately. Include cancelled sessions in the extracted total and report their count separately. Compare expected and extracted counts and flag mismatches. Structural consistency does not prove that the model found every occurrence.

## JSON result and uncertainty

Define schema-validated JSON with:

- `sourceId`, `sourceUrl`, `fetchedAt`, `completedAt`, `lastFetched`, `questionSetVersion`, and classifier model metadata.
- `window`: timezone, local start date, exclusive end date.
- `weeks`: four entries containing index, start/end dates, coverage, model count (integer, `over_200`, or null), count confidence, extracted count, cancellation count, and uncertainty reasons.
- `sessions`: occurrence reference, week index, nullable local start/end dates and times, timezone, nullable category, cancellation status (`scheduled`, `cancelled`, `unknown`), certainty (`supported`, `uncertain`), per-field confidence/probability diagnostics, evidence block references, and uncertainty reasons.
- `summary`: extracted occurrence count, cancelled count, uncertain occurrence count, and completeness (`complete`, `partial`, `unknown`). A complete result means no detected coverage/extraction gaps; it does not assert ground-truth accuracy.
- A bounded evidence map containing only referenced source excerpts, and top-level warnings. Do not return the entire HTML document, secrets, or raw provider error bodies.

Use machine-readable uncertainty reasons such as `schedule_not_available`, `count_unknown`, `count_overflow`, `low_confidence`, `missing_date`, `missing_start_time`, `missing_end_time`, `tentative`, `conflicting_evidence`, `count_mismatch`, and `duplicate_ambiguous`. Summaries are computed in code rather than generated prose.

Initially flag choice confidence below 0.6. For yes/no checks, use probability >= 0.65 as support, <= 0.2 as negative, and intermediate values as uncertain. These are configurable experimental thresholds, not calibrated accuracy guarantees. Missing/conflicting source evidence remains uncertain even when model confidence is high. [Confidence semantics](https://docs.typesafe.ai/confidence).

## Successful completion and `last_fetched`

Success means HTML retrieval, all required classification calls for the selected branches, reconciliation, output validation, and the final database update completed. A valid uncertain result or supported zero-session result can succeed. Network failures, malformed provider responses, deadline expiry, and database failures cannot be converted to successful empty schedules.

After output validation, capture the completion timestamp and update only `last_fetched`. Preserve the existing `updated_at` trigger behavior. Use a conditional update against the source ID and the exact `updated_at` value read initially, with `enabled = true`; a changed/deleted/disabled row or a concurrent completed scrape yields `SourceChanged` and no success response. Return the timestamp read back from the update. This optimistic check prevents an older snapshot from being marked current without holding a transaction open across network calls.

No new database table or migration is expected. Verify existing service-role privileges using the configured admin client; do not widen authenticated user permissions. If the conditional update fails, return an error and discard the in-memory extraction. Repeated requests can incur repeated Jev costs; distributed deduplication is outside this first version.

Once the update commits, it cannot be rolled back because the client disconnects or response delivery fails. Document that `last_fetched` describes successful server processing, not proof that the caller received JSON. A timeout during a database write may have an ambiguous commit outcome; do not claim exactly-once processing.

## Failures, deadlines, and diagnostics

Map internal `Schema.TaggedError` failures to explicit public API schemas with safe messages and request IDs. Preserve internal causes for redacted logs, never serialize them directly.

| HTTP status | Cases                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| 400         | Invalid JSON or source ID / body schema                                                                    |
| 401         | Missing, invalid, or disallowed credential                                                                 |
| 404         | Source not found                                                                                           |
| 409         | Disabled source; source changed during processing                                                          |
| 413         | Caller request body exceeds limit                                                                          |
| 415         | Caller body is not JSON                                                                                    |
| 422         | Wrong source type, invalid/unsafe source URL, unsupported upstream media, source content too large         |
| 502         | Source fetch failure, invalid persisted row, malformed classifier output, non-retryable classifier failure |
| 503         | Database unavailable, exhausted provider rate-limit/overload retries                                       |
| 504         | Overall or stage deadline exceeded                                                                         |
| 500         | Unexpected defect or internal configuration failure                                                        |

Provide a safe final defect boundary without turning interruption into an ordinary recovered failure. Use typed recovery for expected failures. Misconfiguration should fail layer acquisition and never allow unauthenticated operation; smoke-test how initialization failures are rendered by the Deno bridge.

Set a 120-second total processing budget, including authentication and the final database update, below the documented 150-second idle timeout. Stage budgets are 15 seconds for HTML, 30 seconds per classifier call, and 10 seconds per database operation, always bounded by remaining total time. Classification can time out on large schedules; background jobs are intentionally deferred. [Edge Function limits](https://supabase.com/docs/guides/functions/limits).

Propagate interruption through Effect HTTP clients and SDK abort signals, release response bodies, and cancel sibling classification calls on failure. Do not launch detached classification work. Retry safe reads at most twice with `Schedule` backoff/jitter. Jev evaluation retries may incur duplicate inference charges; restrict automatic retries to explicit rate-limit/overload rejection, not ambiguous transport failures. Do not retry the whole workflow or timestamp update blindly.

Use request IDs and named Effect spans for lookup, fetch, normalize, classify rounds, reconcile, and complete. Log durations, question/batch counts, model version, token usage, result counts, and typed failure tags. Exclude credentials, notes, raw HTML, and query-string tokens from logs. No full probability distributions in routine logs.

## Implementation sequence and verification

1. Add the Deno backend scaffold and rc.115 dependencies. Prove a minimal Effect HttpApi web handler serves under the Supabase function prefix and shuts down cleanly. Wire backend commands into root checks.
2. Define schemas, errors, clock/window helpers, and service contracts. Implement official secret-key verification inside Effect middleware and prove that user/public credentials cannot reach service calls.
3. Implement the Supabase repository, conditional completion update, and bounded HTML adapter. Verify public destination enforcement with the actual deployed transport.
4. Implement the real Jev adapter and its contract tests, then versioned question builders, bounded batching, reconciliation, and JSON response encoding.
5. Wire the thin HTTP handler and production layers. Test the workflow with deterministic repository/HTML/classifier layers and Effect `TestClock`.
6. Document configuration and local/deployment commands discovered from the installed Supabase CLI help. Run local runtime smoke tests and one explicitly configured live Jev fixture test before considering the adapter verified. Deploying to production and scheduling Cron are separate actions.

Required coverage:

- HTTP routing, auth rejection without downstream side effects, body validation, bigint precision, wrong source type, missing and disabled sources.
- Toronto window boundaries, DST, month/year changes, today inclusion, recurring schedules, season bounds, cancellations, all five categories, and missing end times.
- A true zero week versus missing/partial schedules; count overflow; low confidence; inconsistent answers; duplicate listings; same-time distinct occurrences; quarter-hour choices including a single `HH:30` option; 192 distinct time choices and 195 total options; off-grid times; ambiguous midnight/overnight cases.
- HTML tables and cancellation notices survive normalization; non-HTML, huge bodies, malformed HTML, redirects, private destinations, and prompt-like page content are handled deliberately.
- Jev request shape, exact answer correlation, maximum choice counts, batch budgets, malformed distributions, provider status mapping, retry bounds, and cancellation of concurrent work.
- `last_fetched` updates on valid results including uncertainty, never on preceding failure; conditional update conflicts and failed writes cannot return 200. Client-disconnect tests distinguish pre-update cancellation from committed work.
- A small manually labelled fixture set reports count/date/time/category/cancellation accuracy separately. Mock tests establish mechanics; they do not establish Jev extraction accuracy.
- Run `pnpm fmt`, `pnpm lint`, and `pnpm typecheck` with the backend included, backend Effect tests, Deno checks, and local Supabase gateway integration tests. Production acceptance also requires a real Jev smoke test and a bundle/dependency compatibility check.

## Deferred work

Cron invocation and secret storage for scheduling; persistence of sessions/history; background jobs and polling; browser UI integration; PDF/image/JavaScript retrieval; link crawling; multi-timezone sources; distributed concurrency control; and improvements to question accuracy. The service boundaries allow those changes without exposing Jev to the workflow or HTTP contract.
