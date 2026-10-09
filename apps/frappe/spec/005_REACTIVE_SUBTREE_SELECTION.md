# frappé: signal-selected subtrees

## Purpose and agreed scope

Extend static construction, reactive state, and reactive DOM bindings from
specifications 002–004 with selection of component subtrees by signal. The test
case is `Signal<Option<boolean>>` describing access to a page:

| Access        | Selected content         |
| ------------- | ------------------------ |
| `None`        | Nothing                  |
| `Some(false)` | An access-denied warning |
| `Some(true)`  | The page                 |

The requirements discussion settled these behaviors:

- Deselecting a branch disposes its occurrence, subscriptions, and owned work.
  Selecting it again creates a fresh occurrence with fresh local state.
- Split DOM cleanup from resource cleanup. Synchronous finalizers run while
  outgoing DOM is attached, then DOM is removed immediately. Asynchronous
  finalizers run in tracked background work after detachment.
- Latest committed selection wins. Cancel obsolete setup and skip intermediate
  selections superseded while lifecycle work is pending.
- Provide general selection of reusable component definitions, composed with
  ordinary `derive`, `Option`, and exhaustive `Match`.
- Make the application root a first-class reactive owner. Root-owned signals
  can select content directly at mount targets and be consumed by descendants.
- A successful write commits the selection request; it does not await subtree
  setup or cleanup. Setup failure reports through `onError` and leaves an empty
  region, without automatic retry or an error fallback branch.
- Optional synchronous setup fallbacks provide the pending view. Without a
  fallback, an empty region during asynchronous setup is intentional.

This document records the construction and lifecycle design, including the
agreed synchronous DOM-finalization and setup-fallback revision. No runtime
dependencies, routing, authorization service, keyed lists, branch caches,
transition animations, completion signals, or boolean/Option convenience helpers
are required. Existing reactive `hidden` properties remain the way to hide
mounted content while preserving its state.

## Public construction contract

Accept `Signal<Option<Component>>` directly as a declarative child, following
the established acceptance of `Signal<string>` for text. A component definition
is a reusable description; native nodes remain single-use construction results.
Do not accept signals of native nodes or general child arrays.

Extend `MountItem` to include `Signal<Option<Component>>`, and consequently
support selection in both `he(..., { children })` and `h(parent, content)`,
including mixed arrays. Reactive content requires a live issuing context, either
a component context or the application context returned by `mounting`.
Keep `Component.setup` output as `Node | ReadonlyArray<Node>`: a selected
component already provides empty, single-root, and multiple-root output through
that contract. Do not broaden setup output into arbitrary reactive values.

Accept narrower compatible signal values, including `Signal<Option<never>>`
and `Signal<Option<SpecificComponent>>`, without application casts. Reject bare
boolean/Option-boolean signals, `Signal<Component>`, node signals, invalid Option
payloads, and non-Option absence values at the relevant type/runtime boundaries.
Existing string signals retain text behavior.

Each selection occurrence occupies its own stable comment-delimited region,
without a visible wrapper. It affects only the nodes inside that region. Static
siblings, surrounding text, and other selection occurrences retain their order
and identity. Using one selection signal in two positions creates two independent
branch occurrences and lifetimes.

## Application root as a reactive owner

Change `mounting({ scope, onError })` to return an application context with the
same capabilities as `ComponentContext`: `h`, `he`, `scope`, `fork`,
`addSyncFinalizer`, and all `ReactiveContext` helpers. Extract a shared context
contract rather than duplicating helper implementations or pretending the
application is a component occurrence. The application has no setup output,
component definition, or artificial DOM wrapper. Its owner lifetime is bounded
by the supplied application scope.

This intentionally replaces the bare mount-function return value. Migrate
bootstrap, tests, and documentation to destructure `h` from the returned context;
do not add a callable-object compatibility layer. For example, with `root` an
existing mount element and `onError` the application reporter:

```ts
const scope = yield * Effect.scope;
const app = yield * mounting({ scope, onError });
const access =
  yield *
  app.signal<Option.Option<boolean>>({
    initial: Option.none(),
  });
const selected =
  yield *
  app.derive({
    sources: { access },
    compute: ({ access }): Option.Option<Component> =>
      Option.match(access, {
        onNone: () => Option.none(),
        onSome: (allowed) =>
          Match.value(allowed).pipe(
            Match.when(false, () => Option.some(AccessWarning)),
            Match.when(true, () => Option.some(AccessiblePage)),
            Match.exhaustive,
          ),
      }),
  });
app.h(root, selected);
yield * access.set(Option.some(true));
```

Acquire the root reactive runtime before returning the context, with cleanup
registered so partial acquisition cannot leak resources. Root `fork` supplies the
application scope to its work. As with component `fork`, cancellation is requested
before synchronous DOM finalizers; interruption is awaited before asynchronous
descendant resource cleanup. Root construction, events, subscriptions,
batches, and binding helpers obey the same contracts as their component forms.

### Ownership and transaction domain

Each `mounting` acquisition creates one independent root lifetime and commit
coordinator. All component occurrences mounted through that context, including
those at different DOM targets, inherit that coordinator and an ancestor chain
ending at the application root. DOM ancestry does not determine reactive ownership.
Separate application contexts remain unrelated even when given the same scope.

Preserve directional ownership checks: consumers may use their own or ancestor
resources. The root can consume its own signals, but cannot bind or derive from
descendant-owned signals. Siblings cannot consume each other's signals. A common
coordinator provides transaction consistency, not permission to bypass ownership.
Do not adopt arbitrary foreign signals or reparent their ownership on binding.

Top-level occurrences now share a transaction domain instead of each starting a
separate coordinator. A root batch can update root state used across targets with
the existing consistent-snapshot guarantees. Preserve batch fiber ownership and
conflict detection. Event ingress remains owned and ordered per runtime; do not
introduce a global event queue or claim global browser-event ordering across owners.
Commits still visit only affected dependencies and bindings, not every signal or
component beneath the root.

### Resource lifetime and shutdown

Keep application signal lifetime distinct from adopted-tree binding lifetime.
Replacing or clearing one mount target disposes that installed tree, its selection
bindings, and its descendants. It does not dispose root signals, other targets,
or application-owned work. Root subscriptions explicitly acquired through the
application helpers remain application-owned until scope closure; mounting a node
does not transfer those subscriptions to a component lifetime.

Component-local signals remain component-owned. Disposal unregisters them from
the shared coordinator and disconnects dependencies and bindings; a common root
must not retain disposed occurrences across repeated selection changes.

Closing the application scope deactivates the root and descendants, stops ingress
and bindings, cancels owned work and outstanding batches, runs synchronous
finalizers, removes DOM immediately, and awaits descendant and retired-branch
resource cleanup before completing application-owner cleanup. Root handles are
inactive during this cleanup, including when a descendant finalizer is awaiting
work. Reads/writes/acquisitions on disposed reactive handles fail through
existing reactive errors; post-disposal `h` remains ignored and `he` fails
through `ConstructionError`. No late work may repopulate a target. Cleanup runs
exactly once, including during an in-progress replacement.

### Errors without a DOM parent

Root-owned background or reactive work can fail before anything is mounted and
can affect multiple targets. Do not invent a DOM parent or component occurrence
to report these failures. Extend the existing `MountFailure` contract as a
discriminated union: preserve existing replacement/component subjects and their
required `parent: Element`; add an application subject with a stable identity per
mounting context and no `parent` field. Application failures retain `operation`,
original `cause`, and resource information when applicable. Consumers narrow by
subject kind before accessing DOM context.

Failures associated with a concrete replacement, selected occurrence, or adopted
DOM binding retain that mount context, even when their source signal is root-owned.
Failures of application-owned work use the application subject. Report both through
the supplied `onError`, retaining existing protection against reporter exceptions.
Migrate error consumers and add exhaustive type coverage for the new subject.

## Composition and branch identity

Derive the selection from application state. Selection does not introduce a
second predicate, dependency-tracking mechanism, or framework-specific matcher.
The access example is illustrative application code:

```ts
const AccessExample = component({
  setup: ({ signal, derive, he }) =>
    Effect.gen(function* () {
      const access = yield* signal<Option.Option<boolean>>({
        initial: Option.none(),
      });
      const selected = yield* derive({
        sources: { access },
        compute: ({ access }): Option.Option<Component> =>
          Option.match(access, {
            onNone: () => Option.none(),
            onSome: (allowed) =>
              Match.value(allowed).pipe(
                Match.when(false, () => Option.some(AccessWarning)),
                Match.when(true, () => Option.some(AccessiblePage)),
                Match.exhaustive,
              ),
          }),
      });
      return yield* he("section", { children: [selected] });
    }),
});
```

`AccessWarning` and `AccessiblePage` are stable component definitions declared
outside the computation. Never construct nodes, acquire resources, or run branch
setup inside a derivation. Selected components may consume ancestor-owned signals
using the existing ownership rules; changing their input signals does not require
recreating their definitions.

Region selection compares absence or component definition identity. A newly
allocated `Some` containing the same definition does not remount or cancel that
branch. This destination-level deduplication does not change signal equality or
observation semantics. A different definition replaces the occurrence even if
its output looks identical. Creating a new definition on every computation
therefore deliberately requests replacement and should be discouraged in examples.

Once a branch has begun disposal, a later selection of the same definition cannot
revive it. Create a fresh occurrence without waiting for its predecessor's
asynchronous resource cleanup. Each changed committed selection deactivates and
detaches the previous occurrence synchronously.

## Construction, adoption, and ownership

Integrate selected regions with the existing deferred-region construction and
adoption path. Construction validates the signal, current value, and ownership,
but neither calls fallback factories, starts setup, nor installs a live
subscription. Adoption revalidates and reads the latest committed selection,
then activates the region without an initial-read/subscription gap. Unadopted
trees acquire no live branch resources. An initially absent selection has
anchors but no visible content.

Preserve issuing-context validation, single-use tree consumption, and rejection
of foreign/disposed resources before disturbing installed content. A component
may bind its own or an ancestor's signal; unrelated ownership is invalid. Selected
branch runtimes must join the existing coordinator and ancestor chain, so nested
selection and ancestor signal consumption work normally.

The adopted region owns its signal binding, lifecycle controller, and selected
occurrence. Replacing the containing tree stops the binding and pending requests,
cancels setup and owned work, runs synchronous finalizers, and removes DOM.
Asynchronous cleanup remains owned and tracked until completion. Scope closure
waits for already-running branch cleanup; do not leave a detached cleanup worker.
No late setup result, queued selection, or signal update may insert nodes after
the region is disposed. External DOM removal retains the existing unsupported
structural-mutation behavior and does not automatically dispose resources.

## Commit and asynchronous lifecycle boundary

Integrate selection into the existing affected-binding validation and flush
protocol. Validate candidate selection values before installing any signal state.
An invalid candidate fails with `ReactiveError`, preserving previous state, DOM,
and pending selection. Initial construction/adoption validation uses the existing
`ConstructionError` and mount-failure paths. Do not run user setup or mutate live
DOM during candidate validation.

For a valid commit, install all changed signal values and flush affected ordinary
DOM values and selected regions before publishing signal observations. Selection
flushes run synchronous finalizers, remove outgoing DOM, and install the incoming
fallback within the same synchronous commit. User setup and asynchronous resource
cleanup execute outside it. Writes return after the pending view is installed,
without awaiting setup or cleanup. Reentrant signal commits from synchronous
finalizers or fallback factories fail with `ReactiveError` so they cannot corrupt
the committed snapshot. Exceptions from synchronous user callbacks report without
rolling back already-installed signal state.

Only committed selections participate. Aborted/conflicting batches and transient
values within a batch cause no finalizers, fallback construction, cancellation, or
setup. A batch ending at the previous definition preserves its occurrence.
Affected regions transition to their fallback or empty pending view in the same
synchronous DOM flush as other bindings. Their eventual setup completions remain
independent. Do not scan unrelated signals or regions.

Keep one latest desired selection per region. Superseded setup attempts lose
adoption authority immediately, even if their work completes after cancellation.
Do not run setup for an attempt superseded before its deferred start. Resource
cleanup from retired attempts cannot remove newer occurrences' nodes.

When a committed selection changes the branch:

1. Deactivate the outgoing occurrence, stop bindings and ingress, revoke setup's
   adoption authority, and request cancellation of owned work.
2. Run synchronous finalizers descendants before owners, in reverse registration
   order within each owner, while the whole outgoing subtree remains attached.
   Report callback exceptions and continue all remaining finalizers.
3. Remove outgoing DOM immediately.
4. Call the incoming component's synchronous fallback factory if provided,
   validate its fresh detached native roots as a group, and install them. `None`
   has no fallback or setup. Absence of a fallback intentionally leaves an empty
   pending region.
5. Start incoming setup outside the commit. Successful output adoption replaces
   its fallback. A newer differing selection repeats these steps immediately.

Asynchronous scope finalizers run after removal in tracked cleanup fibers and may
finish after incoming setup starts or completes. Each retiring subtree retains
its descendant-before-owner resource cleanup order. Application shutdown awaits
all cleanup, including already-retired branches. Cleanup runs once per occurrence
and cannot be canceled by subsequent selections.

Imperative `h` requests retain their ordered processing: every valid admitted
replacement starts in request order. Async cleanup no longer blocks their queues.

## Synchronous finalizers and setup fallbacks

Both application and component contexts provide
`addSyncFinalizer(callback: () => undefined): Effect<void, ReactiveError>`.
Registration requires an active owner. Callbacks cannot await work or return an
Effect or Promise. They inspect native DOM and can transfer focus to surviving
controls before detachment; local reactive handles are already inactive.

Component definitions optionally provide `fallback: () => Output`, using the
same native output shape as setup (`Node | ReadonlyArray<Node>`). Each invocation
must return fresh detached native nodes; no reactive values or deferred component
regions are accepted. The factory receives no context and runs only on adoption
or a changed committed selection, never during construction or candidate
validation. Repeating the same definition preserves fallback identity and setup.

## Failure behavior

Reuse existing mount reporting, retaining the original cause, parent, operation,
and failing occurrence/region identity. Fallback failures report with operation
`fallback`, remove any partial fallback output, and continue setup in an empty
region. Successful setup installs its output normally. Setup and adoption
failures remove fallback/partial output immediately and leave the region empty,
preserving siblings. Failed occurrences still finish tracked asynchronous
resource cleanup. Synchronous finalizer failures report as `cleanup` and do not
prevent other callbacks, detachment, or incoming fallback/setup. Asynchronous
cleanup failures also report and allow shutdown to complete. Exceptions from
`onError` must not stall reconciliation or other bindings.

A failure after selection commits does not roll back state or reject the already
successful write. Keep the selection binding alive. Repeated selection of the
same failed definition, including a fresh `Some` wrapper, does not retry it. A
different desired branch or `None` re-arms selection; subsequently selecting the
failed definition creates a new attempt, even if intermediate requests were
coalesced before setup. There is no retry loop or dedicated retry API.

Treat cancellation-only failures as normal cancellation, consistent with current
component lifecycle handling. If a newer selection arrives during failure cleanup,
allow its replacement to proceed immediately; old cleanup must not affect the
latest occurrence.

## Demonstration

Add an independent home-page component with an occurrence-local writable
`Option<boolean>` signal initially `None`. Provide labeled native buttons for
Unknown, Denied, and Allowed, all with `type="button"`. Keep controls outside the
selected region so every state remains reachable.

Denied shows a clear access warning. Allowed mounts a page with a local counter
and increment button. Demonstrate that leaving the page and returning after
disposal resets its counter, while selecting Allowed again retains its value.
Unknown leaves the selected region visually empty. Preserve the existing welcome,
counters, input, and tabs demos. Update the README during implementation to explain
selection versus state-preserving `hidden`, stable definitions, asynchronous
completion, synchronous focus handoff, and detached asynchronous cleanup.

Also document and test the direct root-selection example above. Retain the
independent home-page demo so its controls remain reachable in every access state;
the demo does not need to hide the entire home page to demonstrate root support.

## Implementation sequence

1. Introduce the shared application/component context, acquire a root runtime in
   `mounting`, extend failure subjects, and migrate mounting call sites. Verify
   root ownership, shared commits, and shutdown before adding selection.
2. Extend construction types and region descriptors for signal-selected component
   definitions, preserving existing static component and reactive-text paths.
3. Factor shared region adoption/disposal operations as needed from the existing
   framework. Keep lifecycle coordination in the mounting layer and signal
   computation in the reactive layer; do not implement a parallel renderer or
   use ordinary asynchronous signal streams as the commit boundary.
4. Connect candidate validation and nonblocking desired-selection publication to
   the existing DOM binding protocol. Track the latest desired occurrence, install
   its pending view synchronously, defer supersedable setup, and retain retired
   cleanup workers through shutdown.
5. Add the access demonstration, documentation, and focused regression coverage.

Use Option and exhaustive Match conventions and named options for related inputs.
Read vendored library sources as needed without modifying or importing from them.

## Acceptance and verification

Extend the existing frappé Vitest/type-test patterns. Use deterministic gates
and explicit readiness, never timing-dependent sleeps. Cover:

- All three access states and transitions, including local-state reset after
  disposal and preservation for repeated selection of the active definition.
- Fresh Option wrappers, changed component identity, empty/multiple roots,
  nested selections, two occurrences of one signal, and stable sibling identity.
- Detached construction does no setup/subscription; adoption uses the current
  committed value; unused/discarded construction acquires no live resources.
- Construction and commit rejection of invalid values; valid ancestor ownership;
  unrelated/disposed owner rejection; unchanged static/text behavior and typing.
- Batch rollback/conflict produces no lifecycle work; transient batch selections
  do not mount; writes and observations proceed while cleanup/setup is gated.
- Synchronous finalizers see attached outgoing DOM, run descendants first and in
  reverse registration order, support focus handoff, and tolerate exceptions.
  Asynchronous finalizers see detached nodes and can overlap incoming setup.
- Fallback/empty pending views flush atomically with ordinary DOM values; fresh
  multiple-root fallback output, failure isolation, identity preservation, and
  superseded fallback removal all follow the occurrence lifetime.
- Rapid true → false → true skips warning setup if superseded before its start,
  mounts a fresh page without waiting for old cleanup, and never adopts obsolete
  setup output or lets old cleanup remove the latest fallback/content.
- Returning to a definition whose disposal already started cannot resurrect its
  state. Stable selection during pending setup preserves its fallback and setup.
- Setup/adoption/cleanup failures, throwing reporters, same-branch non-retry,
  recovery after a changed selection, and updates arriving during failure cleanup.
- Replacement/disposal during setup or cleanup releases bindings, listeners, owned
  work, and selected descendants exactly once; late completion cannot insert DOM.
- Existing mounting queues retain ordered imperative replacement semantics.
- Direct root selection, root-created reactive text/attributes/properties, and
  descendant consumption of application signals through multiple mount targets.
- Root/descendant, sibling, and separate-application ownership rejection, including
  two application contexts sharing a scope; shared coordination grants no new access.
- Root batches consistently update consumers across targets, retain conflict and
  fiber-ownership rules, and do not visit unrelated signals or bindings.
- Clearing one target releases its bindings and component signals while preserving
  root state, application-owned subscriptions, and other targets. Repeated branch
  replacement does not grow retained disposed signals or selection subscriptions.
- Application scope closure during batches, setup, and cleanup cancels owned work,
  waits for descendants, prevents late DOM writes, and invalidates root handles.
- Root work can report failures before any mount exists without a fake parent;
  occurrence failures retain their actual parent; throwing reporters remain isolated.

During runtime implementation, run `pnpm test:frappe`, `pnpm fmt`, `pnpm lint`,
and `pnpm typecheck`, reporting unrelated baseline failures separately. This
specification does not itself implement or claim verification of runtime behavior.
