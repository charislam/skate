# Budgerigar: occurrence factories and reactive fallbacks

## Purpose and agreed scope

Replace object-form component definitions with synchronous per-occurrence
closure factories. Factories create shared state before fallback construction.
Fallback inserts synchronously, can consume shared or ancestor signals, and can
return components. Setup remains an Effect and may suspend for network requests
or other asynchronous work.

This specification supersedes the native-only output and zero-argument fallback
contracts in specifications 001, 002, and 005. Preserve existing transaction,
selection identity, cancellation, DOM ownership, and cleanup guarantees except
where explicitly revised below.

The requirements discussion settled these choices:

- Factory and fallback callbacks and fallible helpers return `Result<A, E>`
  synchronously, preserving typed errors without permitting suspension.
- Both contexts expose full owner capabilities, including event wiring,
  synchronous finalizers, and scheduling owned asynchronous work.
- Factory resources belong to the occurrence and survive fallback replacement.
- Fallback resources and descendants belong to a separate pending-view lifetime.
- Both fallback and setup accept the same expanded output contract.
- Child setup starts outside the synchronous commit. Child fallbacks insert
  synchronously, including within the enclosing fallback.
- Successful enclosing setup replaces fallback without awaiting asynchronous
  fallback cleanup. Synchronous finalizers run while outgoing DOM is attached.
- Setup failure disposes fallback, reports failure, and leaves an empty region.
- Factory failure fails the occurrence. Fallback failure disposes its partial
  subtree, reports failure, and allows enclosing setup to continue.
- Migrate all callers; do not retain the old object-form API.
- Defer typed props. Document stable closure-based passing of parent signals.

## Public API

The intended public shape is:

```ts
import { Effect, Result } from "effect";

component(({ signal }) =>
  Result.gen(function* () {
    const progress = yield* signal({ initial: "Loading…" });

    return {
      fallback: ({ he }) => he("p", { children: [progress] }),
      setup: ({ he }) =>
        Effect.gen(function* () {
          yield* progress.set("Preparing content…");
          return yield* he("article", { children: ["Ready"] });
        }),
    };
  }),
);
```

The factory is a reusable description until mounted. Invoke it once per committed
occurrence, before invoking its optional fallback. Two mounts of the same
definition have independent factory closures, signals, scopes, and DOM.
Construction, validation of an uncommitted candidate, and aborted batches must
not invoke factories. A stable selected definition preserves the entire
occurrence, including its pending view and in-flight setup.

The factory returns `Result<Lifecycle, EFactory>`; setup is required and
fallback is optional. Fallback returns `Result<Output, EFallback>`. Infer and
preserve error types through helper and callback composition; do not force users
to throw expected failures or erase helper errors to `unknown`. Require Result
wrappers even for infallible callbacks (`Result.succeed`). Reject bare output
and Promise/Effect returns at the type boundary, with runtime validation for
untyped callers. Setup retains its Effect-based contract and executes once per
occurrence unless disposal supersedes its deferred start.

Both fallback and setup have success output `MountItem |
ReadonlyArray<MountItem>`, where existing `MountItem` accepts native nodes,
component definitions, and `Signal<Option<Component>>`. An empty array is empty
output. Capture arrays when consuming callback results. Normalize direct
components and selections to regions without adding visible wrapper elements.
Preserve native node freshness, single-use, duplicate-root, connected-node, and
ownership checks.

Strings and text signals remain children of `he`; do not broaden root output to
arbitrary reactive values, nested arrays, promises, or streams.

### Synchronous and Effect contexts

Provide distinct Result-based synchronous and Effect-based context types backed
by the same ownership and reactive primitives. Factory and fallback use the
synchronous type; setup retains Effect-based helpers. The application context
remains Effect-based.

Synchronous context capabilities include:

- `signal`, `derive`, and `combine`, returning signals in a typed Result.
- `read(signal)`, returning the current committed value in a Result after ownership and
  lifetime validation. Keep existing signal objects and their Effect-based
  `get`, `set`, `update`, and `changes` API; do not create incompatible sync and
  async signal representations.
- `he`, returning a constructed element in a Result, and queued `h` with a
  Result reporting synchronous validation/registration failure. Later queued
  failures still use the existing reporting channel.
- Event sources, DOM events, folds, stream conversion, subscriptions, and input
  binding. Finite declaration/registration work completes synchronously;
  execution of stream consumers and effectful event handlers is deferred.
- `fork(work)`, which synchronously registers owned Effect work for deferred
  execution and returns `Result<void, ReactiveError>` without awaiting it. The
  Result reports registration failure, not eventual background failure.
- `addSyncFinalizer`, synchronous registration with the issuing owner, and
  access to that owner's scope for resource ownership.
- `batch(work)`, using a thunk returning Result and preserving atomicity where
  permitted. It must reject entry during the enclosing commit, even if its
  callback would attempt to schedule work. Invoke the thunk only after entry
  validation; a failed Result aborts staged writes. Never accept an eagerly
  evaluated Result as the batch body.

Fallible synchronous helpers return Result with their concrete error types,
including event registration, subscriptions, input binding, and finalizer
registration. Plain capabilities such as the owner's scope remain plain values.
Compose these operations with `Result.gen`, which evaluates eagerly and
synchronously. It short-circuits on failure but does not roll back previously
registered resources; the owning lifecycle failure boundary retires them.

Invoke each callback lazily inside the lifecycle Effect, validate its returned
Result, and convert with `Effect.fromResult`. Expected Result failures become
typed Effect failures; unexpected throws remain defects in the reported cause.
Do not use `Result.getOrThrow` as the adapter. Both forms of failure follow the
same ownership cleanup rules while retaining their distinct cause semantics.

Do not accept an arbitrary Effect and run its prefix until suspension as the
public construction API. Implement shared synchronous operations with Result
and adapt them to Effect for setup, keeping execution lazy at the Effect helper
boundary. Audit shared paths for hidden fiber startup or suspension. A Result
cannot encode a suspended continuation, but cannot prevent arbitrary user code
from starting external work; owned asynchronous work still goes through `fork`.

The synchronous callback capability does not make signal writes legal during
commit. Reads see committed values, including values committed by the transaction
that selects this occurrence. Signal writes and batches cannot reenter that
commit, including via manually running a signal's Effect methods. Allocate new
signals with initial values rather than writing during construction.

User work registered with `fork`, subscriptions, or queued mounts cannot execute
inline inside the commit. It starts after commit with a fresh transaction
context, checks owner authority, and is skipped if its owner has already retired.
Such work can then update signals normally. External unscoped work started
manually by user code is outside these ownership guarantees.

## Ownership and lifetime

Use this logical ownership structure:

```text
parent occurrence or application
└── component occurrence: factory state, work, finalizers, setup scope
    ├── pending view: fallback state, bindings, work, finalizers
    │   └── fallback child occurrences
    └── ready content: bindings and child occurrences adopted from setup
```

Factory and setup share occurrence ownership. Factory signals are accessible to
fallback, setup, and their descendants. Fallback-local signals are accessible to
its descendants, but cannot be adopted by the ready view or consumed by enclosing
setup: they belong to a shorter-lived descendant owner. Existing ancestor-only
reactive access rules continue to apply. Passing a reference through a closure
does not bypass lifetime validation.

The pending view has its own scope, runtime, bindings, finalizers, and child
owners. A factory finalizer runs on occurrence disposal, not on fallback
replacement. A fallback finalizer runs on pending-view disposal. Setup-owned
resources persist through successful adoption until occurrence disposal.

No fallback binding, event listener, queued mount, signal selection, or child
setup may repopulate the region after the pending view retires. Factory-owned
background work continues when ready content replaces fallback, and is cancelled
when the whole occurrence retires.

## Lifecycle and commit ordering

### Starting an occurrence

1. After request validation and selection coalescing, allocate the occurrence
   owner and its reactive runtime before invoking user factory code.
2. Invoke the factory synchronously under that occurrence's context.
3. Allocate a pending-view owner if fallback exists. Invoke fallback with that
   owner's synchronous context, validate and normalize its output, bind current
   signal values, and insert it into the reserved region.
4. Activate fallback child regions synchronously: invoke their factories and
   install their own fallbacks recursively. Native siblings remain visible even
   if a child has no fallback. A child's setup may suspend independently.
5. After the synchronous commit, run eligible deferred child setups, enclosing
   setup, and registered background work. Do not promise relative completion
   order between these tasks. They must all check live ownership before running.

No-fallback occurrences retain an empty pending region. Factory invocation is
part of committed occurrence creation and may run even when its later setup is
superseded. This differs from uncommitted/transient selections, whose factories
must never run. Factory code should remain short because it executes in commit.

The selected pending subtree and other ordinary DOM bindings become observable
within the same synchronous flush. Adding component support must not introduce
an asynchronous gap before the immediate fallback is installed.

### Successful setup

1. Normalize and validate the candidate ready output and prepare its bindings
   without retiring pending content or starting candidate child setup.
2. Confirm the occurrence still has adoption authority.
3. In one synchronous replacement, deactivate pending ingress and bindings,
   revoke descendant adoption authority, request interruption of pending work,
   run pending synchronous finalizers descendants-first while DOM is attached,
   detach pending DOM, and insert ready output with its current signal values.
4. Activate ready child regions and their synchronous fallbacks. Schedule their
   setup outside the replacement commit.
5. Track pending asynchronous resource cleanup in the background. Ready content
   and its setup descendants do not await it. Application shutdown still awaits
   all retired cleanup.

Validation/adoption failure follows existing component failure semantics: retire
the whole occurrence, remove pending or partial output, and leave empty anchors.
Failure of an independently activated child remains isolated to that child.
Synchronous finalizer exceptions are reported without preventing detachment or
ready-content insertion. Existing protection against reentrant signal commits
also applies during this replacement.

A fast enclosing setup may dispose a pending child before that child's setup
starts. Skip the child's user setup in this case. An already-running child is
interrupted; late or uninterruptible completion cannot adopt or remove newer DOM.

### Failure and replacement

- Factory failed Result, throw, or invalid factory result: report a distinct `factory` operation,
  retire all partially registered occurrence resources, leave the region empty,
  and do not call its fallback or setup.
- Fallback failed Result, throw, or invalid output: report `fallback`, retire all partial pending
  resources and descendants, leave pending content empty, and continue enclosing
  setup. Factory-owned resources remain alive.
- Setup failure: report `setup`, retire the whole occurrence and its pending
  view immediately, and leave the region empty while cleanup completes.
- Background failure: retain existing reporting policy; it does not implicitly
  fail setup or replace the view.
- Replacement or application disposal: revoke authority for factory work,
  pending descendants, and setup before any later asynchronous completion can
  mutate DOM. Preserve tracked cleanup and failure isolation.

Do not retry automatically or introduce error views. Preserve existing selection
rearming semantics: an unchanged failed definition does not rerun its factory;
a qualifying definition change can create a new occurrence.

## Passing parent state without props

Use an ordinary function accepting a named options object to create a child
definition whose factory closes over parent signals. Create and retain that
definition once within the parent occurrence factory or setup, then return or
select the stable definition as needed.

Creating a child definition does not create its occurrence state or start its
work. Each mounted occurrence invokes its own factory. Signal updates change
bindings without rerunning factory, fallback, or setup. Setup reads a snapshot
when it explicitly reads a signal; changing that signal does not automatically
restart an outstanding request.

Document that constructing a new component definition inside every derivation
evaluation changes identity and causes remounts. No props mechanism, automatic
request restart, keyed reconciliation, or memoization API is part of this work.

## Implementation plan

1. Introduce the Result-returning factory definition, lifecycle callback,
   synchronous context, and expanded output types. Add `factory` failure
   reporting, lazy Result-to-Effect adapters, and error-inference type coverage.
2. Refactor reactive/context construction so an occurrence runtime exists before
   its factory runs. Separate synchronous registration from deferred user work;
   avoid starting event processing inside commit. Share validation and ownership
   logic between synchronous and Effect helpers.
3. Introduce pending-view ownership and cleanup independently of the enclosing
   occurrence. Preserve ancestor signal visibility and tracked retired scopes.
4. Share output normalization, validation, binding, and region adoption for
   fallback and setup. Support mixed root outputs and recursive child fallbacks.
5. Implement deferred work scheduling and atomic pending-to-ready replacement.
   Audit cancellation, partial construction failure, and reentrant commit paths.
6. Migrate every component definition in demos, helpers, runtime tests, and type
   tests. Update README examples and lifecycle documentation. Add a gated loading
   example showing parent state plus shared progress in a component fallback;
   tests must not depend on live network access.
7. Run focused lifecycle/reactive/construction tests, then the Budgerigar suite
   and repository `pnpm fmt`, `pnpm lint`, and `pnpm typecheck`. Use repository
   test conventions and vendored references where applicable. Report unrelated
   pre-existing failures separately.

## Acceptance coverage

- Same definition mounted twice invokes two factories and has independent state.
- Detached construction, invalid requests, aborted batches, and coalesced-away
  selections invoke no factories or fallbacks and start no work.
- Stable selections preserve factory state, fallback DOM, and pending setup.
- Parent and factory signal bindings render committed values in the initial
  fallback and update while setup is gated. Changes do not rerun callbacks.
- A transaction changing both selection and a label presents the new label in
  the new fallback without an intermediate stale frame.
- Full synchronous helpers return typed Results; bare/Promise/Effect callback
  output is rejected. Result generators infer error unions and short-circuit.
  Effect adapters defer execution and preserve failures without throwing them.
  Unexpected throws remain defects. Failed Result batches abort staged writes;
  rejected batch entry does not execute its thunk. Reentrant writes fail and
  deferred work can write after commit.
- Factory work survives readiness; pending work, listeners, folds, subscriptions,
  and child occurrences stop on pending-view retirement.
- Fallback-local signals cannot escape into ready bindings or unrelated owners.
- Direct components, selected components, native nodes, mixed arrays, and empty
  arrays work as output from both callbacks without visible wrappers.
- Nested fallback children insert pending content synchronously and suspend
  independently; child failure does not fail enclosing setup or siblings.
- Fast enclosing setup skips superseded child setup. Late uninterruptible child
  work cannot adopt, clear ready DOM, or affect a newer occurrence.
- Pending finalizers see attached DOM, run descendants-first exactly once, and
  cannot block replacement by throwing. Gated async cleanup does not delay ready
  output, but shutdown waits for it.
- Factory failure cleans partial occurrence resources; fallback failure cleans
  partial pending resources and continues setup; setup/adoption failure empties
  the region and cleans both lifetimes without automatic retry.
- Invalid/reused/connected native output is still rejected, partial binding
  failures leak no observers, and multiple-root order and sibling identity hold.
- Closure-based parent signal examples retain stable component identities and
  preserve ancestor-only access validation.

This file is the implementation plan; writing it does not change runtime behavior.
