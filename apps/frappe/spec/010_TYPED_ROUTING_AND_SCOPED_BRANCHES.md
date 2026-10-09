# frappé: typed routing and scoped union branches

## Purpose and agreed scope

Add routing through frappé's reactive state, component ownership, context,
and resource primitives. Introduce general scoped union branches first, then
compose typed URL handling and application-owned admission transitions with them.

This is an implementation plan, not an implementation. Extend specs 003–009
without replacing their transaction, ownership, inferred requirements, or lifecycle
contracts. Where earlier examples expose an optional current user, the new demo
instead provides a non-optional user only within an authenticated branch.

The requirements discussion settled these choices:

- V1 includes scoped union branches, writable narrowing, typed URL codecs,
  browser navigation, explicit router links, and a mock auth/nested-project demo.
- Application transitions admit destinations and choose redirects. Do not add
  declarative route guards or a framework-owned application state machine.
- One global typed navigator accepts every valid destination of its router.
  Do not restrict navigation APIs to authenticated or branch-specific subsets.
- URL hierarchy and application state/component hierarchy are independently
  composable. A state branch need not consume a path segment, and a route prefix
  need not mount a component.
- Outgoing branches retire immediately. Incoming branches show their synchronous
  fallback or an empty region while setup runs.
- Retain occurrences by variant tag and optional explicit identity key. Leaving
  and returning creates a fresh occurrence; there is no inactive-page cache.
- Writable sources produce writable narrowed inputs; read-only sources produce
  read-only inputs. Reuse signal get/set/update rather than a separate mutation API.
- Unknown paths and invalid parameters are distinct parse outcomes. Both retain
  enough matched ancestry to render errors inside the appropriate surviving shell.
- Normal navigation pushes history; redirects replace; back/forward reapply
  admission. An ordinary request for the current canonical URL is a no-op.
- Anonymous private requests replace the URL with /login and retain a typed
  return destination in memory. A reload does not retain that return destination.
- Typed router links render real hrefs. Do not automatically intercept ordinary
  anchors. Preserve modified clicks and native new-tab behavior.
- Application code owns scroll and focus management.

Defer SSR/hydration, hash-based routing, loaders, caching, prefetching, transition
blockers, retaining outgoing content until readiness, automatic request restarts,
and real backend integration. URL fragments are supported as URL data; this is
different from using the hash as the routing transport.

## Architecture and invariants

Separate three responsibilities:

1. Pure route definitions decode URLs and build URLs from typed destinations.
2. A scoped history resource reads the initial location, observes traversal, and
   performs fallible push/replace operations. A memory implementation serves tests.
3. Application transitions combine navigation/session events with current state
   to produce valid next state and an explicit history decision.

Scoped branches render that state through the ordinary component runtime. The
browser adapter does not mount pages, and the route parser does not acquire auth
or project data. The navigator must re-evaluate admission against current state
when executing a request, regardless of where the request originated.

Keep one authoritative application union for related invariants, rather than
independent writable user, route, loading, and authorization signals. A requested
destination describes intent; it is not proof that a corresponding page is active.
Initial session discovery must be represented explicitly, rather than temporarily
treating an unknown session as anonymous.

An illustrative internal model, with domain types omitted:

```ts
type AppState = Data.TaggedEnum<{
  ResolvingSession: { readonly requested: NavigationTarget };
  Anonymous: {
    readonly page: PublicPage;
    readonly returnTo: Option.Option<NavigationTarget>;
  };
  Authenticated: {
    readonly sessionId: SessionId;
    readonly user: User;
    readonly page: PrivatePage;
  };
}>;

type PrivatePage = Data.TaggedEnum<{
  Dashboard: {};
  Projects: { readonly page: ProjectsPage };
}>;

type ProjectsPage = Data.TaggedEnum<{
  Index: {};
  InvalidUrl: { readonly issue: ProjectParameterIssue };
  NotFound: { readonly remainder: ReadonlyArray<string> };
  Project: {
    readonly projectId: ProjectId;
    readonly state: ProjectState;
  };
}>;

type ProjectState = Data.TaggedEnum<{
  Loading: { readonly requested: ProjectChildTarget };
  Failed: { readonly error: ProjectError };
  Ready: {
    readonly project: Project;
    readonly page: ProjectPage;
  };
}>;
```

NavigationTarget includes a valid destination or a structured URL failure. This
lets session discovery and login defer an invalid private URL without fabricating
a valid ProjectId. Only valid destinations are accepted by public navigate calls.
ProjectPage includes overview/settings and a nested NotFound case.

The authenticated branch cannot exist without User. The project Ready branch
cannot exist without Project. Provide CurrentUser as Signal<User> and, within
Ready, CurrentProject as Signal<Project> using existing Context.Service and
provideContext. Requirements continue to infer through factories, fallback,
setup, returned descriptions, and registered work. Context provision supplies
values; it does not independently establish authentication or backend authority.

Use session identity, not only user identity, to delimit authenticated lifetime.
A new session for the same user must be able to retire old work. Token refreshes
that retain the logical session identity should not reset the shell.

## Scoped union branch API

Introduce an inert branch descriptor and an inert exhaustive selection description,
provisionally branch<A>()(factory) and cases({ state, branches }). Concrete generic
ordering must be proven against the pinned compiler before implementation is
considered complete. These names and examples describe API intent:

```ts
const AuthenticatedBranch = branch<AuthenticatedState>()(
  ({ context, inputs }) =>
    Sync.gen(function* () {
      // inputs.state is narrowed; source mutability determines write access.
      // Derive/provide CurrentUser and return the authenticated shell lifecycle.
      return { setup: /* ordinary Effect setup */ };
    }),
);

const output = cases({
  state: appState,
  branches: {
    ResolvingSession: { branch: ResolvingSessionBranch },
    Anonymous: { branch: AnonymousBranch },
    Authenticated: {
      branch: AuthenticatedBranch,
      key: (state) => state.sessionId,
    },
  },
});
```

Support _tag-discriminated unions for v1. Require all cases and reject unknown
case names or incorrectly typed branch inputs. Adding a union member must cause
an existing incomplete case table to fail compilation. General custom
discriminator support is not required for this iteration.

Factories follow component/row conventions: inert reusable descriptors, one
synchronous factory execution per committed occurrence, Sync composition, normal
setup and optional fallback, and owner-bound reactive helpers. Inputs are live
signals, not snapshots or newly created component descriptions on every update.

Accept cases output anywhere an existing structural mount item is accepted:
he children, h, setup/fallback output, and mixed root arrays. Propagate unmet
requirements through construction and mounting without erasing them to unknown
or satisfying deferred requirements through incidental local Effect provision.

Mutability must survive inference. A descriptor which requires writable inputs
cannot be installed over a read-only source. Read-only-consuming descriptors may
be used with either kind. Prefer a shared implementation with explicit public
overloads/types over a union that forces consumers to inspect whether set exists.
Do not grant writable access to fold/derive results to simplify the signature.

Construction validates source ownership, case coverage, and initial identity
without running factories or installing subscriptions. Adoption revalidates the
latest committed snapshot. Preserve ancestor-only access and independent state
for each mounted use of a description.

### Identity and lifecycle

Occurrence identity is selection-region identity, variant tag, stable branch
descriptor identity, and optional key. Without a key, updates within a tag retain
the occurrence. Use existing Key semantics: string or finite number, distinguishing
numeric and string keys. Keys need only be meaningful within their own branch.

Changing the tag, key, or descriptor retires the occurrence. Returning after a
committed retirement creates new local state and a new occurrence identity.
Retained inputs update in the source commit, preserving local state, pending setup,
and fallback. Parameter changes do not implicitly restart setup.

Keys are pure synchronous selectors. Invalid keys or throwing selectors reject
the update before disturbing the current tree. Capture validation results in the
commit plan; do not rerun selectors during application of that plan.

Reuse structural preparation and ancestor-first retirement already present for
selection/keyed lists. Retire outgoing descendants before evaluating derivations
that would otherwise try to narrow a now-inapplicable union. Input installation,
outgoing removal, fallback insertion, DOM bindings, and publication participate in
the same commit. Do not mirror the parent into branch signals through subscriptions.

Preserve existing cancellation and cleanup order, including asynchronous cleanup
overlapping incoming setup. Superseded setup cannot adopt output. Lifecycle
failures report through the existing owner error path and leave the affected
region empty; they do not roll back committed state. For v1, retry a failed branch
by changing its identity or leaving/re-entering, rather than implicitly restarting
it for every data change.

## Writable narrowing and field projection

A writable narrowed input implements WritableSignal<ExactVariant> with ordinary
get, set, and update. A read-only input implements Signal<ExactVariant>. Both are
owned by the corresponding branch occurrence and expire with it. Existing typed
ReactiveError is the common error channel; add distinguishable expiry/conflict
information as needed without requiring a separate signal API.

A setter replaces that variant's value in its owning union; it cannot change the
variant tag. Validate this at runtime for malformed untyped calls as well as at
compile time. A variant setter may change its key; that write succeeds and retires
the old occurrence at commit. Later writes through that occurrence fail.

Provide a minimal field projection helper, provisionally focus({ source, key }),
so nested writable unions remain writable without copying state via subscriptions.
For example, focus the authenticated input's page field, then apply cases to that
signal. Projected setters update the latest parent candidate and preserve unrelated
fields. Read-only input yields a read-only projection. Exclude changing a narrowed
branch's discriminant through a field projection. General user-supplied bidirectional
get/set optics are not required; begin with typed property projection.

All narrowing and field projection writes target the authoritative underlying
source. They must not create independent mutable copies or publish extra commits.
Parent/child writes within one batch compose in program order. An update reads the
current transaction candidate, not a factory-time snapshot, so sibling field edits
are preserved. Nested projections retain all ancestor occurrence checks.

### Expiry and transactions

Bind lens validity to an unforgeable runtime occurrence identity, not just the
tag/key. A saved lens from a previous login must not work after re-entering a
matching tag/key. Source access and occurrence liveness are checked when an Effect
executes, not only when it is constructed.

Within a batch, reads and writes through the lens validate against the staged
parent candidate and every enclosing branch identity. If an earlier staged write
leaves or rekeys the branch, a subsequent lens write fails before commit. Track
transaction-local invalidation so switching away and back within that batch does
not revive the old lens for later writes in the same batch.

This local invalidation does not itself mount or retire anything. A successful
batch whose final selection matches its initial selection preserves the committed
occurrence under existing coalescing semantics. A discarded batch restores the
previous committed validity. In either case, committed occurrence retirement is
determined by the final structural plan, not intermediate factory invocations.

Lens failures follow existing batch poisoning semantics. Catching a failed lens
write does not make the batch safe to commit. Concurrent source changes retain
the existing version-conflict behavior; do not automatically retry user callbacks.
Disposal cancels owned batches. Child fibers retain existing transaction ownership
restrictions. Descendant input signals must not publish an impossible intermediate
variant during parent transition.

Writable lenses guarantee state shape and lifetime, not arbitrary application
policies. Application code uses the navigator for changes that must coordinate
with URL/history. Direct writes to URL-bearing fields do not automatically navigate
or synchronize history. The demo should expose derived read-only context where
children should not mutate those fields, while demonstrating writable lenses for
ordinary nested state edits.

## Typed route definitions and URL semantics

Define each route once and derive both its parser and builder. Support nested
literal prefixes, Schema-validated path parameters, Schema-validated query
parameters, optional query values using Option, declared defaults, repeated array
query values, and catch-all remaining segments. Keep fragments optional URL data.

Use synchronous/pure schema codecs for URL matching and building in v1. Reject
schemas requiring asynchronous work or runtime services. Do not introduce network
lookups into parsing. Building can fail through a typed error if custom encoding
fails; do not promise that every Schema encoder is infallible merely because its
input is typed. A successful build should parse to the equivalent normalized
destination. Test round trips including branded IDs, defaults, and escaping.

The valid global Destination union is inferred from route definitions. Builders,
navigate, and link helpers reject unknown route tags, missing required fields,
and wrong parameter types. Nested prefixes contribute typed parameters to their
descendants without requiring callers to repeat literal path strings. Reject
conflicting inherited parameter names at definition time rather than silently
overwriting their types or values.

Use declaration-order precedence. Structural matching determines which candidate
owns a URL before its parameter decoding. Once a path candidate owns a URL, a
decoding failure returns InvalidUrl; it must not fall through to another route
whose schema happens to accept the input. Declare literal /projects/new before
/projects/:id when the literal should win. Apply the same rule at nested levels.
Catch-all routes are explicit and follow the same ordered matching policy.

Document these defaults:

- Paths are case-sensitive. Equivalent trailing slash forms share one canonical
  representation; use no trailing slash except at the root.
- Do not collapse meaningful interior empty segments or decode an encoded slash
  into a new segment boundary. Split structurally before decoding segment values.
- Unknown query parameters are ignored by destination decoding and omitted by
  canonical builders.
- Repeated scalar query parameters are InvalidUrl. Declared arrays accept repeated
  values and preserve their order. Missing required query values are InvalidUrl.
- Omit absent optional values and declared defaults when building. Use deterministic
  query ordering from the definitions and normal URL percent encoding.
- Malformed percent encoding is a structured URL failure, not an uncaught exception.
- Preserve an optional fragment in the navigation target and built href. Do not
  infer page scrolling/focus behavior from it.

Distinguish semantic normalization from automatic history mutation. Builders emit
canonical URLs; merely parsing an equivalent external URL need not rewrite the
current history entry. An explicit replace may canonicalize it. Identity checks
use the normalized destination/URL, including the fragment and declared query data.
When handling redirects, replace the observed URL if necessary even when the
resolved active destination is unchanged.

## Hierarchical parse outcomes

Return an exhaustive typed result with Matched, NotFound, and InvalidUrl variants.
Retain the original URL, matched route ancestry, decoded values for valid ancestors,
and the remaining path or failing parameter/query location as appropriate. Preserve
schema diagnostics in InvalidUrl. Do not expose an invalid parameter as its branded
domain type or erase ancestry to an unstructured error string.

The result must distinguish a structurally matched route from its validated prefix.
For /projects/wrong-id, the projects prefix is valid but no ProjectId is available.
For /projects/123/doesnt-exist, the project prefix can contain a validated ProjectId,
with an unmatched child remainder. Runtime project acquisition remains a later
application decision. Represent typed prefix alternatives as a discriminated union
inferred from the route tree; avoid a heterogeneous map requiring application casts.

Required application behavior:

| URL                                   | Outcome and eligible shell                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| /doesnt-exist                         | Root NotFound; no fabricated project ancestry                                  |
| /projects/wrong-id                    | InvalidUrl within projects shell; no project load                              |
| /projects/123/doesnt-exist            | Nested NotFound within project shell after valid ID and successful acquisition |
| /projects/123 with failed acquisition | Project failure state; URL parsing still succeeded                             |
| Any private target while anonymous    | Login first; private shells require authenticated state                        |

Errors in query parameters are attached to the route level declaring the parameter.
Only validated ancestor context is available to surviving shells. The parser supplies
information; the application's exhaustive transition policy chooses the state and
view. URL ancestry does not directly create component ancestry.

## Navigation, history, and links

Expose one router-bound navigator accepting its inferred Destination type and named
options for push/replace. Use the framework Resource/Context distinction normally:
browser history is an application resource; application-owned navigation callbacks
may be supplied through context when they depend on root signals. Do not hide a
mutable application controller in a process-global singleton.

Acquire initial location and traversal observation without a read/subscription gap.
One controller owns history navigation per document; unrelated mounting runtimes
must not each install competing document navigation controllers. The memory adapter
must model push, replace, traversal, failures, initial location, and disposal.

Serialize application navigation decisions, including session-driven admission
changes, with traversal handling. Recompute a queued request against current state
when it runs. Use a pure synchronous transition policy to produce next state and
history intent. Slow acquisition belongs in the newly committed page state/setup,
not inside a navigation critical section. A newer request need not await old page
setup or asynchronous resource cleanup.

History policy:

- An ordinary admitted navigation pushes one entry.
- Redirects replace with the final admitted URL; do not push an intermediate denied
  destination. Application policy resolves redirects before writing history.
- Explicit replacement updates the current entry.
- Back/forward runs admission against the observed URL without pushing another
  entry. If denied, replace the observed entry with the admitted redirect.
- Normal navigation to the current canonical URL is a no-op. Explicit replace and
  admission/session events still run when needed; this is not a blanket suppression
  of state changes for equal URLs.
- Programmatic push/replace updates application state through the same controller;
  do not depend on popstate being emitted or introduce duplicate synthetic handling.

### Failure ordering and the reactive commit boundary

Honor the agreed ordering: prepare and validate the state transition, attempt the
history operation, then commit the prepared state. A rejected history write leaves
the previous application state and page intact and returns a typed navigation error.
Do not put pushState/replaceState inside an ordinary batch body and claim rollback.

Current batch does not expose a safe prepared-commit operation. Implementation must
provide a narrowly scoped internal navigation integration point: after captured
versions, structural plans, and DOM sinks validate, but before installing signal
values, run the synchronous history operation. No await or user callback may
interleave between that operation and state installation. A history failure discards
the prepared transaction. Do not expose a general-purpose external-effect transaction
API as part of this work.

Factories, fallback/setup failures, and cleanup errors retain their existing
post-commit lifecycle reporting behavior; they do not trigger a history rollback.
Unexpected defects after history succeeds need explicit error reporting and
reconciliation, not a false all-or-nothing guarantee across browser and DOM APIs.

Back/forward differs: the browser has already moved. An admission, preparation, or
redirect-write failure reports a typed traversal failure containing the observed
location and last committed location/state. Keep the last valid state (or enter an
application-selected valid error state); expose that the URL and view may differ.
Let application error handling retry/reconcile with an explicit replace. Do not
silently issue history.go, loop redirects, or pretend the browser did not move.

### Typed links

Provide an owner-bound link helper compatible with he, native event helpers, and
ordinary attributes/properties. Render a real built href so copying, opening in a
new tab, and native browser semantics work. Report builder errors through the
construction Effect rather than silently substituting an invalid href.

Intercept only eligible unmodified primary activation of that explicit router link,
for the current browsing context and same origin. Respect defaultPrevented, modifier
keys, non-primary buttons, download, and target. Keyboard activation must work.
Prevent the browser default synchronously with existing event capabilities, then
enqueue typed navigation. Ordinary anchors, external links, and new-tab actions
retain native behavior. The helper must not install document-wide anchor interception.

## Async work and application policies

Committed page replacement cancels page-owned work through existing scopes/fork.
Stale setup output cannot mount. Stale lens writes fail. For work owned above a page,
the application must carry session/project/request identity and ignore obsolete
results before updating state; component cancellation alone is not sufficient for
all external operations.

Use session identity for the authenticated branch, project ID for the project
branch, and variant identity for project tabs. Dashboard/settings navigation can
retain the authenticated shell. Switching projects retires project-local state.
Switching tabs retains the project shell. Changing parameters without changing an
explicit key updates input signals and does not restart setup automatically.

On private deep link with unknown session, preserve the typed target while resolving.
Anonymous resolution displays login and replaces the URL. Successful sign-in admits
the stored target against the new session. Expiry/logout removes the whole private
branch and redirects to login; expiry may retain the current private target, while
explicit logout clears it. Switching users replaces session identity and rechecks
the target. No return target survives reload in this demo.

## Demo deliverable

Build a small mock app within frappé using existing styling/component patterns:
login, dashboard, projects index, project overview, and project settings. Use mock
Auth and project resources with deterministic controls for session discovery,
sign-in, logout, expiry, account switching, delayed success, and acquisition failure.
Do not add Supabase or another backend.

Demonstrate:

- Non-optional CurrentUser and CurrentProject in the eligible subtrees.
- A private deep link resumed after login.
- Persistent authenticated/project shell state through eligible child navigation.
- Writable nested branch/field edits using set/update without copying parent state.
- Project changes resetting project-owned state and cancelling delayed work.
- Malformed project IDs and unknown nested children in the appropriate shells.
- Browser traversal, typed real links, explicit redirects, and navigation errors.

Make the example's app policies visible in its model/transitions, rather than
special-casing authentication or projects in framework routing code.

## Implementation sequence

1. Prove public type shapes with focused compiler fixtures: exhaustive cases,
   narrowed input inference, mutability preservation, field projection, nested
   prefix outcomes, schema destination inference, and inferred requirements.
2. Implement general scoped branches with read-only/writable inputs and property
   projections. Reuse transaction and owner machinery; avoid a second reactive
   engine. Verify expiry, staged invalidation, and conflict semantics first.
3. Implement pure route definitions, ordered matching, builders, normalization,
   structured ancestry, and typed failure diagnostics independently of the browser.
4. Implement memory/browser history resources and the serialized controller with
   the internal prepared-commit integration point. Verify failures before links/UI.
5. Add typed links and initial/traversal integration. Preserve source event ordering
   and avoid duplicate navigation from push/replace.
6. Build the mock nested-state demo, exercising the public APIs without casts.
7. Document the API, lifetime rules, write/history distinction, admission examples,
   normalization, and deliberate exclusions in the frappé README.

Keep modules focused on branch descriptions, branch runtime, lenses, pure route
codecs, navigation coordination, browser adapter, and example application policy.
Share low-level machinery with selection/keyed reconciliation where justified,
without moving application routing policy into framework.ts. Treat repos/foldkit
as read-only reference for parser and testing patterns, not an import dependency.

## Verification and acceptance

Type tests must reject incomplete/extra cases, wrong narrowed inputs, writes to
read-only sources, changing the narrowed discriminant, invalid destinations or
parameters, unprovided context/resources, and unsafe writable descriptor mounting.
Ensure valid nested examples infer without application casts, non-null assertions,
or explicit unions duplicating the route definitions.

Runtime tests must cover:

- Stable tag/key retention, identity replacement, independent mounts, fallback,
  pending setup, lifecycle failures, disposal, and stale completion isolation.
- Direct and nested writable lens get/set/update, atomic sibling edits, parent/child
  write ordering, staged leave/rekey, away-and-back behavior, rollback, expired
  occurrence reuse, conflicts, and child-fiber ownership restrictions.
- Structural retirement suppressing invalid descendant narrowing before publication;
  no side effects for aborted/coalesced-away selections and no duplicated commits.
- Route builder/parser round trips; brands, defaults, optional/array query values,
  escaping, malformed encoding, trailing slashes, case sensitivity, fragments,
  overlapping ordered paths, catch-alls, and no schema-failure fallthrough.
- Root versus nested NotFound/InvalidUrl, typed validated ancestry, and private error
  pages never mounting before admission.
- Initial-location races, push/replace/traversal, equal-URL behavior, redirects,
  session changes competing with navigation, resource isolation, and listener cleanup.
- Preparation failure before history, history failure before state installation,
  traversal failures after location movement, post-commit lifecycle errors, and
  absence of navigation feedback loops.
- Explicit link interception versus native modified clicks, target/download,
  keyboard activation, ordinary anchors, and external origins.

Use existing frappé Vitest/DOM and type-test patterns for primitive tests, with
deterministic Deferred/TestClock-style control rather than arbitrary sleeps.

Run the frappé tests and repository convention commands pnpm fmt, pnpm lint,
and pnpm typecheck during implementation. Inspect formatting changes and avoid
unrelated edits.

Acceptance requires the nested demo and compile-time examples to express the user
and project invariants without Option unwrapping in authenticated/ready components,
while expired writable lenses cannot resurrect retired state. Routing must use
the same signals, contexts, transactions, and lifetimes as other frappé content.
