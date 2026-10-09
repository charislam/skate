# frappé: shared data querying

## Purpose and agreed scope

Introduce runtime-wide queries with reactive inputs, simultaneous-request
deduplication, stale-completion protection, stale-while-revalidate caching,
time-based garbage collection, retries, and reactive session/tenant partitioning.
Use Effect v4 AsyncResult as the observable asynchronous state. This is an
implementation plan, not an implementation.

Preserve the resource, ownership, and synchronous reactive transaction contracts
of specs 003, 005, 008, and 009. Query execution uses the mounting runtime's
resources and explicit inputs, never an observer's ancestor context or incidental
local service overrides. Each mounting runtime owns an independent query store.

Agreed behavior:

- Reusable query definition identity plus structurally equal input identifies a
  query within the current runtime partition.
- Ordinary concurrent consumption joins pending work. Every explicit refresh
  supersedes pending work, even two refreshes within one reactive transaction.
- All observers of an entry see shared refreshes and accepted results.
- Unobserved requests may finish and populate the cache until GC removes them.
- Cache defaults: stale immediately; retain unused entries for five minutes.
- Runtime policies can be overridden per definition. Observers can additionally
  override staleTime; retry and GC policies remain shared per definition.
  GC is time-based only.
- Optional observer-local previous-data retention works across key changes and
  subsequent failures, but never across disablement or partition changes.
- Retries default to off; global and per-query Effect schedules are supported.
- One optional reactive partition identity controls the entire runtime. Changing
  it discards the old cache; returning to an earlier identity fetches anew.
- Initial implementation includes exact and definition-wide invalidation and
  imperative consumption. Mutation orchestration, optimistic updates, polling,
  focus/reconnect refresh, prefetch APIs, persistence, SSR hydration, and batching
  are deferred.

## Input availability, without a separate enabled guard

Do not expose independent `enabled` and possibly-invalid input fields. The
observer receives a Signal<Option<Input>>. Some(input) means that the query can
run with that complete input; None means disabled. The loader always accepts
Input, never Option<Input> solely to accommodate disabled observations.

Illustrative API shape (names remain subject to the implementation type proof):

```ts
const ProjectQuery = Query.define({
  name: "Project",
  load: (input: { readonly id: ProjectId }) =>
    Effect.gen(function* () {
      const projects = yield* Projects;
      return yield* projects.get(input.id);
    }),
});

const input =
  yield *
  ui.derive({
    sources: { project: selectedProject },
    compute: ({ project }) => Option.map(project, ({ id }) => ({ id })),
  });

const project =
  yield *
  ui.query({
    query: ProjectQuery,
    input,
    retainPrevious: true,
    staleTime: "10 seconds",
  });
```

The example assumes top-level imports of Effect, Option, Query, Projects, and
ProjectId. It illustrates inference rather than a separately executable snippet.
Support always-available inputs through Some(input), with an ergonomic helper
for lifting a Signal<Input> if useful. Conditional access or multiple prerequisites
are expressed by deriving Option<Input>, preserving narrowing where the input is
constructed. Do not require assertions, placeholder IDs, or a repeated guard in
the loader. Disabled means detached: clear displayed state and retained data,
stop contributing to observer counts, and do not fetch. Other observers continue.

Each handle exposes a read-only Signal<QueryState<Input, A, E>> and a refresh
Effect. QueryState presents AsyncResult-style Initial, Success, and Failure
variants directly, with plain current success values and a single typed
previousSuccess on non-success states. There is no nested public result field
or second previousSuccess field. QueryState.match handles the three states.
Refreshing a disabled handle is a no-op. Disposal releases the subscription and
invalidates the handle using existing disposed-owner conventions.

## Definitions, identity, and resource inference

A definition owns its loader, input equality contract, and policy overrides.
Definition identity is an opaque stable token created once; its diagnostic name
does not establish equality. Different definitions with equal names or inputs
never share entries. Define queries outside component construction.

Use structural equality and compatible hashing for supported immutable inputs:
primitives, arrays, records, and explicitly supported Effect value types such as
Option and branded primitive IDs. Object property order does not affect equality;
array order does. Specify and test canonicalization before implementation. Reject
unsupported cyclic, mutable, function, or opaque identity-bearing inputs with a
useful diagnostic, or require an explicit definition-level canonicalization
adapter. Do not use raw JSON.stringify or ordinary object reference equality as
the structural key contract. Store a stable canonical snapshot so mutation of a
caller's record cannot corrupt an existing lookup.

Resource requirements and loader errors remain inferred through definition,
observer registration, component requirements, and mounting. Reject loaders with
unprovided or component-context requirements. A component may read context to
construct explicit input. Loader execution uses the runtime's resource environment
and a query-owned Scope; it must not capture the first observer's lifetime or
locally provided resource override. Self-contained privately provided dependencies
remain legal. Query policy schedules follow the same resource restriction.

Returned data must be usable beyond the execution Scope: live scoped resources
are not cached query values. Release execution resources when the attempt ends.

## Runtime partition

Configure one runtime-owned Signal<Option<PartitionId>> before attaching query
observers. Account/session generation and tenant identity are application-defined
parts of PartitionId. Some(anonymousIdentity) supports public queries;
None represents unresolved or disabled querying. Subtree partitions are deferred.

Provide a runtime configuration operation that binds the partition signal and
global policy once after mounting creates the application reactive runtime and
before query use. This avoids requiring a runtime-owned signal before that
runtime exists. Missing configuration is a useful setup error, not an implicit
shared anonymous partition. The implementation type/API proof must cover setup
ordering and reject foreign-runtime or disposed signals.

On each committed unequal partition transition, including to/from None:

1. Advance a monotonic runtime partition epoch before any result can publish.
2. Detach the old store and clear all observer snapshots and previous-data history
   in the same reactive commit. No old-partition value remains visible.
3. Request interruption of old requests/retries and cancel old GC work. Do not
   block new-partition fetching on an uncooperative old request's cleanup.
4. With Some(partition), reattach enabled inputs and fetch in the fresh store.
   With None, expose Initial with waiting false and start no work.

Returning to an equal historical identity never revives its discarded store.
Repeated equal current identities do not reset queries. Final committed signal
values determine reactive transitions; explicit refresh operations retain their
strict individual superseding semantics. Auth code must commit its partition
change consistently with the resource credentials used by subsequent loaders.
The framework cannot infer a credential change from an unchanged partition ID.

## AsyncResult and observer projection

Use the installed Effect 4.0.0-rc.115 source at
effect/unstable/reactivity/AsyncResult as the initial reference. Recheck the
pinned version during implementation. Its variants are Initial, Success, and
Failure; all carry waiting, and Initial and Failure have previousSuccess. Keep
AsyncResult as the internal shared-entry state. At the observer boundary, adapt
it to a QueryState with the same three-state API, replacing retained-success
representation rather than exposing an AsyncResult alongside a potentially
conflicting history field.

The public structural contract is:

```ts
type PreviousSuccess<Input, A> =
  | { readonly _tag: "SameKey"; readonly previousData: A }
  | { readonly _tag: "PreviousKey"; readonly previousData: A; readonly key: Input };

type QueryState<Input, A, E> =
  | {
      readonly _tag: "Initial";
      readonly waiting: boolean;
      readonly previousSuccess: Option.Option<PreviousSuccess<Input, A>>;
    }
  | {
      readonly _tag: "Success";
      readonly waiting: boolean;
      readonly value: A;
      readonly timestamp: DateTime.Utc;
    }
  | {
      readonly _tag: "Failure";
      readonly waiting: boolean;
      readonly cause: Cause.Cause<E>;
      readonly previousSuccess: Option.Option<PreviousSuccess<Input, A>>;
    };
```

Implement retained-data constructors with Effect Data.TaggedEnum. QueryState
must support pipeability, constructors,
isInitial/isSuccess/isFailure/isWaiting, map, and a dual data-first/data-last
match function using the same handler names and narrowed whole-state arguments
as AsyncResult.match:

```ts
QueryState.match(state, {
  onInitial: ({ waiting, previousSuccess }) => renderPending({ waiting, previousSuccess }),
  onSuccess: ({ value, waiting }) => renderProject({ project: value, refreshing: waiting }),
  onFailure: ({ cause, previousSuccess }) => renderError({ cause, previousSuccess }),
});

state.pipe(
  QueryState.match({
    onInitial: renderInitial,
    onSuccess: renderSuccess,
    onFailure: renderFailure,
  }),
);
```

All three handlers are required, callback parameters are inferred without
annotations, and the return type is the union of handler return types.
QueryState.map transforms current and retained data while preserving retained
key identity, tags, waiting, timestamps, and causes. Do not claim structural
compatibility with AsyncResult or reuse its type marker: previousSuccess has a
deliberately different type. QueryState helpers are the public adapter API;
ordinary AsyncResult helpers remain for internal cache state. Additional mirrored
helpers must preserve this retained-data contract, not silently unwrap old data.

Success.value is always plain A for the requested key. It has no previousSuccess
field and requires no SameKey/PreviousKey match. Initial and Failure each have
exactly one previousSuccess field. Initial gains history to represent a new key
loading while an earlier key's data remains available; Failure replaces
AsyncResult's native history field with the same typed representation. Neither
state exposes an alternative native previousSuccess or nested result.

Projection rules:

- A settled current success is Success(value, waiting false).
- During same-key refresh/retries, retain Success(value, waiting true); there is
  no duplicated SameKey field because the success value is already current-key.
- After same-key refresh failure, project the internal AsyncResult's retained
  success into Failure.previousSuccess = Some(SameKey({ previousData })).
- While B loads with retained A, expose Initial(waiting true) with
  Some(PreviousKey({ previousData: projectA, key: inputA })).
- If B fails, expose Failure with the new cause and the same PreviousKey history.
- Disabled input or absent partition exposes Initial(waiting false) with None.
  Disablement, disposal, and partition changes erase observer history.

Derive QueryState atomically from shared AsyncResult state and observer history;
never maintain a second independently writable asynchronous state machine.
Current-key success or history takes precedence over cross-key history. Keep
cross-key data out of the internal cache AsyncResult, including its native
Failure.previousSuccess. Do not provide a convenience accessor that merges
current and previous-key data into an untagged Option<A>.

For retainPrevious omitted or literal false, specialize Initial/Failure history
to Option<SameKey<A>>; literal true or a widened boolean exposes both variants.
Success.value, loader results, and cached success values remain plain A for all
configurations.

PreviousKey.key is the immutable input snapshot identifying retained data within
this query definition, not a hash or the latest input signal value. Narrowing
exposes that previous key precisely where retained data is used.

A key change detaches from the old entry and projects the new entry's state.
With retainPrevious, preserve the last displayed success only when the new entry
has no success of its own, including internal same-key history. Across A → B → C
while B never succeeds, retain A as PreviousKey with inputA. Never insert that
value into B's or C's cache entry.

If the observer returns to A while still retaining A, reclassify its history as
SameKey. Use A's actual cache entry for the state; if already collected, expose
Initial while fetching with SameKey history. Do not manufacture a cache success
from observer history. When A succeeds, expose Success with plain value and no
history field.

Two observers sharing a pending entry may expose different previousSuccess
values. Publish the entire state atomically: no commit may pair B's requested
state with a SameKey tag for A. Partition changes and disablement clear all
retained history, including same-key observer-local history.

Expose success timestamps as Effect DateTime.Utc, representing an absolute UTC
instant without a timezone dependency. Obtain the accepted-success instant with
DateTime.now, which uses Effect Clock and remains deterministic under TestClock.
Preserve that instant during refresh, retry, mapping, and observer projection;
only an accepted new success advances it. The internal AsyncResult currently
requires a numeric timestamp: convert the same instant with DateTime.toEpochMillis
at that boundary, and use DateTime.makeUnsafe to project a known valid internal
epoch timestamp back to DateTime.Utc. Do not restamp cached data on observation.

Track freshness independently of AsyncResult.waiting and of timestamps touched
by AsyncResult helpers. Check the module's equality implementation: it does not
compare every metadata field. QueryState publication must account for retained
provenance and previousSuccess changes so an equality shortcut cannot suppress
meaningful observer updates.

## Request coordination and stale completion protection

Maintain one authoritative current generation per cache entry and a runtime
partition epoch. Each execution carries epoch, entry identity, and generation.
Publish only when all three still identify the current live entry. Removing and
recreating the same key must not allow an old execution to pass this check.

Ordinary observation and imperative reads reuse pending work, including retries.
Settled success fresh enough for the requesting consumer is reused without
fetching; state stale for that consumer starts one shared revalidation.
Synchronously register pending ownership before forking the
loader so simultaneous reads cannot both start it. Equal reactive inputs do not
detach/reattach or cause another request.

Every explicit refresh advances generation and starts replacement work. Mark the
entry waiting and update all observers; ask the older execution to interrupt.
Do not coalesce refresh calls, even inside one transaction. Old successes and
failures cannot update the cache or any observer, regardless of interruption
cooperation. Observer notifications may obey normal transaction batching, but
each refresh must establish its own replacement execution generation.

Leaving a key does not invalidate that entry for other observers. A's completion
can populate A while a former observer now reads B; it cannot update B or replace
that observer's retained-data snapshot. With no observers, pending work continues
until completion, GC, partition retirement, or runtime shutdown.

Serialize entry transitions with the existing synchronous coordination model.
Never await network work or asynchronous finalizers inside a reactive commit.
Check generation at publication ingress, not only before awaiting the loader.
Keep cleanup tracked by the mounting runtime and await it during shutdown.

## Freshness, invalidation, and garbage collection

Global defaults are staleTime = zero and gcTime = five minutes; definition
overrides replace individual defaults. An observer's optional staleTime
overrides the definition default for that observer only: observer supersedes
definition

supersedes runtime. Imperative get uses the definition/runtime staleTime,
independent of mounted observers. GC remains a shared definition/runtime policy
with no observer override. Validate nonnegative durations; permit infinite
freshness/retention explicitly. Freshness is measured from the last accepted
successful completion. Errors are stale and do not extend freshness; existing
observers do not immediately loop on a terminal error.

Freshness is a consumer decision, not one shared fresh/stale boolean computed
from the minimum staleTime among mounted observers. Store the accepted-success
timestamp and explicit invalidation status on the entry; evaluate age against
the triggering consumer's policy. Explicit invalidation overrides every
consumer's freshness allowance, including infinite staleTime. Observer policies
are not part of query identity and never split shared requests or cache entries.

For example, with data thirty seconds old, a newly attached observer with a
five-minute staleTime reuses it without fetching. Attaching another observer with
a ten-second staleTime starts revalidation. Both observe waiting and the accepted
result. The tolerant observer cannot veto the request, and mounting order cannot
change its retry policy. If work is already pending, the new observer joins it
rather than superseding it. Observer staleTime is a registration option in this
version; reactive policy changes are deferred.

Fetch triggers are first observation, input changes to a new key, imperative
read of stale/missing state, explicit refresh, and invalidation of an observed
entry. Crossing staleTime alone starts nothing. A newly attached observer can
revalidate a stale entry; it joins an existing request if one is pending.
Shorter staleTime does not mean periodic fetching: a continuously mounted
observer does not fetch again without a trigger. Polling remains deferred.

Exact invalidation addresses a definition and input; family invalidation addresses
all entries of one definition in the current partition. Observed entries
supersede pending requests and revalidate. Inactive entries become stale, retire
any pending generation, and request its interruption without starting new work.
This ensures a pre-invalidation completion cannot make invalidated data fresh.
Missing entries are a no-op. App mutation Effects invoke these operations after
successful writes; no mutation state machine is introduced.

Start the GC timer when an entry loses its last consumer. Imperative waiters count
as consumers while awaiting data. Entries created solely for an imperative call
become unused when its final waiter leaves. Reattachment cancels GC. Completion
while unused does not restart the timer. At expiry, remove the entry, invalidate
its identity, and interrupt any pending execution. Zero retention collects on
the unused transition; infinite retention disables the timer. Active entries are
never collected; no hard capacity or LRU eviction exists in this version.

## Retries, failures, and imperative operations

Retry policy belongs to shared execution, with no observer or imperative-call
override. All consumers share the definition/runtime retry sequence regardless
of which consumer initiates work. Reject observer retry options in public type
tests. Consumers may render failures differently without changing network attempts.

Retry configuration has explicit Inherit, Disabled, and Schedule choices at the
definition boundary; global default is Disabled. A definition schedule replaces
the global schedule. Use Effect Schedule with typed loader errors as input;
global schedules must be valid across heterogeneous query errors, while per-query
schedules can discriminate the specific error type. Preserve inferred schedule
resource requirements. Do not share mutable retry-driver state between entries
or generations: instantiate a fresh schedule driver for each execution sequence.

Only expected typed loader failures retry. Defects are represented by their Cause
in terminal AsyncResult.Failure and reported once through the existing runtime
failure boundary. Supersession, GC, partition retirement, and shutdown interruption
are control flow and must not publish a Failure or report an application error.
Unexpected loader interruption must settle the current entry rather than leave
waiting true forever. Retry waits keep waiting true and preserve pre-request
data/error until success or exhaustion. All attempts use the same generation.

Expose imperative get, refresh, exact invalidate, and invalidate-definition
operations using named option objects. get waits for the current accepted result,
fetching stale/missing entries or joining pending work. refresh initiates a strict
replacement and waits for the latest accepted result. When superseded within the
same entry, live waiters follow its replacement rather than receive obsolete data.
Caller cancellation releases only its waiter; it does not cancel shared work.
Partition retirement terminates old-partition waiters with an explicit typed
partition-change error; it must not silently return another session's result.
Absent partition fails imperative get/refresh with an explicit typed unavailable
error. Define these framework errors separately from loader E; reactive absence
continues to be Initial, not Failure.

## Effect primitives and implementation boundaries

Evaluate the pinned effect/Cache against these requirements before choosing the
storage implementation. Its source deduplicates keyed pending lookups, but its
completion-based TTL and capacity eviction are not observer-based idle GC, and
it does not itself provide observer projections, partition epochs, or strict
supersession. Do not treat one Cache TTL as both staleTime and gcTime.

Reuse Cache if a small adapter demonstrably preserves all required semantics.
Otherwise document the mismatch and use a focused query-entry coordinator with
Effect keyed collections, fibers, Deferred/notification primitives, Clock, and
Schedule. Avoid maintaining two competing authorities for in-flight ownership.
Keep definition/key handling, entry execution, observer projection, policy/GC,
and runtime integration in separate focused modules; do not enlarge framework.ts
with the complete query engine. Export the public surface through the framework.

## Implementation sequence

1. Prove public definition/input/resource/retry inference and the Option-based
   observation API. Fix canonical input and partition identity semantics. Prove
   runtime-owned partition setup without circular construction requirements.
2. Implement and deterministically test entry coordination, generations, shared
   reads, strict supersession, imperative waiters, and Cause handling.
3. Add freshness, invalidation, retry schedules, and idle GC. Record the Cache
   suitability decision against the installed source.
4. Integrate partition epochs and mounting ownership, including reset ordering,
   detached cleanup, and shutdown. Preserve resource isolation across runtimes.
5. Add reactive observer attachment and AsyncResult projection, the three-state
   QueryState API with typed retained SameKey / PreviousKey data, exhaustive
   match, atomic publication, and disposal behavior.
6. Demonstrate two components sharing a project query, optional project selection,
   retained search/page results, refresh failures/retries, and a session switch.
   Update README with the supported API and policy precedence.
7. Run focused runtime/type tests and repository pnpm fmt, pnpm lint, and
   pnpm typecheck during implementation. Report unrelated baseline failures.

## Acceptance scenarios

Use deterministic Deferred, Queue, Ref, and TestClock controls, not sleeps.Do
not modify vendored code.

- Two simultaneous observers or imperative reads of structurally equal inputs
  execute one loader; different definitions, inputs, or runtimes remain isolated.
- Missing runtime resources and ancestor-context loaders fail type checks;
  Option.map input derivation gives the loader a fully narrowed Input without
  assertions or a second presence check.
- A → B and A → B → A races cannot publish into the wrong observer or resurrect
  a removed entry. An uncooperative superseded request cannot publish success,
  failure, freshness, or metadata after a newer request.
- Two explicit refreshes within one transaction create distinct generations;
  ordinary reads join the current one. All same-key observers share its result.
- Imperative waiters follow same-entry supersession, release independently, and
  terminate explicitly on partition retirement or runtime disposal.
- Cache freshness boundaries, zero/infinite policies, reattachment, completion
  while unused, and pending-request GC follow the exact policies above.
- Observers with different staleTime values share one entry. With
  thirty-second-old data, a five-minute observer reuses it, while a newly
  attached ten-second observer initiates one shared refresh. Reverse mounting
  order still deduplicates pending work. Advancing time alone starts no fetch.
  Verify observer > definition runtime freshness precedence, invalidation
  overriding infinite freshness, imperative reads using definition defaults,
  and retry policy independent of the initiating observer or mounting order.
- Exact/family invalidation excludes unrelated entries, supersedes active work,
  and prevents inactive pre-invalidation completions from restoring freshness.
- Retry default, global override, per-query replacement/disablement, exhaustion,
  interruption during delay, and independent schedule state are covered.
- Failed refresh retains same-key success. Optional cross-key retention preserves
  the actual source identity through waiting and failure, never contaminates the
  destination entry, and yields to destination data when available.
- Type checks allow plain A access through Success.value and match.onSuccess,
  without a provenance match. Initial/Failure expose exactly one previousSuccess;
  narrowing is required to access PreviousKey.key. Success exposes no history
  field and no state exposes a nested result. Literal false or omitted
  retainPrevious exposes only SameKey history; true exposes both variants.
- QueryState.match requires all three handlers, infers each whole-state argument
  and the union of return types, and supports direct and pipeable forms. Guards
  narrow correctly; map transforms current and retained data without losing keys.
- Success.timestamp is DateTime.Utc in constructors and match.onSuccess, not a
  number. TestClock controls accepted-success timestamps; refresh, retry, mapping,
  and cache observation preserve them until a new success is accepted. Internal
  AsyncResult epoch conversion preserves the exact instant and freshness behavior.
- Runtime projection checks cover A → B → C retaining A, A → B → A
  reclassification with and without cache GC, same-key refresh failure, and atomic
  state changes when different keys return equal data. Cross-key retention never
  enters the internal AsyncResult or its native previousSuccess.
- None input detaches and clears only that observer. None partition disables all
  observers. Anonymous Some partition permits public queries.
- Partition changes clear every snapshot and retention history atomically;
  old completions cannot publish, and returning to a historical partition starts
  fresh. Equal current partition values do not reset work.
- Disposing one observer does not interrupt another's request; runtime shutdown
  cancels timers/retries/work and awaits tracked cleanup before resource release.
- AsyncResult metadata-only changes and distinct retained previousSuccess values
  are not suppressed by inappropriate equality checks.

The policy details made concrete here (imperative waiter behavior, inactive
invalidation, identity canonicalization, and defect reporting) are implementation
design choices supporting the agreed requirements, not additional features.
