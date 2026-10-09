# frappé: fully inferred context requirements

## Purpose and agreed scope

Allow descendants to consume ancestor-provided services without prop-drilling,
while statically rejecting trees with unsatisfied dependencies. Requirements are
inferred from service reads, returned output, and registered work. Do not require
component dependency declarations or explicit requirement type arguments in
ordinary application code.

This specification supersedes the native-node construction result, Result-based
factory/fallback, and immediate Effect-context `h` contracts in specifications
002–007. Preserve transaction, occurrence identity, selection, keyed-list,
ownership, synchronous commit, cancellation, and cleanup semantics unless changed
explicitly below. This document is an implementation plan, not an implementation.

The requirements discussion settled these choices:

- Use ordinary Effect service tokens and their identifier types. Do not introduce
  a parallel UI token system.
- Infer every component requirement; do not introduce a `requires` declaration.
- Migrate all frappé callers and examples. No compatibility layer.
- Return opaque typed element handles from construction, rather than native
  elements or intersections branded onto native elements.
- Introduce strict `Sync<A, E, R>` computations for factories and fallbacks, with
  explicit service and Result adapters. Reject Effects and Promises in Sync.
- Make `h` yieldable in both synchronous and Effect contexts.
- Providers supply existing values to component descriptions only. Acquire
  resources in the owning component; Layer-based/async providers are out of scope.
- Ordinary computation provision and descendant subtree provision are distinct.
- Deferred callbacks capture the computation environment at registration,
  including local Effect service overrides.
- Expose explicit native access and checked native-node import.
- Missing required services in untyped or unsafely cast programs are defects
  reported through existing lifecycle/work error reporting, not an added typed
  `MissingContext` error on every service read.

## Intended authoring experience

The following is the intended API shape. Concrete generic parameter ordering and
internal representation must be validated against the pinned Effect and TypeScript
versions before implementation. Examples omit existing error parameters when
discussing inferred component types.

```ts
import { Context, Effect, Option } from "effect";
import { component, provideContext, readonlySignal, Sync, type Signal } from "./framework";

interface User {
  readonly email: string;
}

class CurrentUser extends Context.Service<CurrentUser, Signal<Option.Option<User>>>()(
  "frappe/CurrentUser",
) {}

const Account = component(() =>
  Sync.succeed({
    setup: ({ derive, he }) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const email = yield* derive({
          sources: { user },
          compute: ({ user }) =>
            Option.match(user, {
              onNone: () => "Not signed in",
              onSome: ({ email }) => email,
            }),
        });
        return yield* he("p", { children: [email] });
      }),
  }),
);

const Settings = component(() =>
  Sync.succeed({
    setup: ({ he }) => he("section", { children: [Account] }),
  }),
);

const Root = component(() =>
  Sync.succeed({
    setup: ({ signal }) =>
      Effect.gen(function* () {
        const user = yield* signal<Option.Option<User>>({
          initial: Option.none(),
        });
        // Authentication work owned by Root updates this writable signal.
        return provideContext({
          key: CurrentUser,
          value: readonlySignal(user),
          child: Settings,
        });
      }),
  }),
);
```

Infer Account and Settings as requiring CurrentUser; infer Root as requiring
nothing. Changing the root signal updates Account's derived text without rerunning
either setup. A signed-out `Option.none()` is a valid provided value, distinct
from an absent provider. Export the existing read-only signal capability adapter.

## Requirement algebra and public type boundaries

Represent unmet dependencies by unions of Effect service identifier types;
`never` means no requirements. Preserve existing error inference independently.

- `Component<R>` carries all unmet requirements of one component description.
- `ElementOutput<ElementType, R>` carries requirements of its deferred children.
- `Output<R>` and mixed readonly arrays preserve the union of their entries.
- `Signal<Option<Component<R>>>` preserves R, including requirements of future
  selections, not only the currently selected value.
- `Row<A, R>` and `KeyedList<A, R>` preserve all possible row requirements.
- A provider for identifier I transforms `Component<R>` into
  `Component<Exclude<R, I>>`.

Compute component requirements from the union of factory computation requirements,
fallback computation and output requirements, and setup computation and output
requirements. Include work registered by any lifecycle phase. Both fallback and
setup contribute even when runtime execution eventually takes only one path.

Automatically supplied Scope belongs to the computation capability contract.
Remove it only where the runtime actually provides the corresponding scope. Do
not globally subtract Scope from arbitrary output requirements. Framework-owned
scope and transaction services cannot be overridden through subtree providers.

An unparameterized public Component/Output type defaults to no requirements, not
arbitrary requirements. Do not allow widening to a requirement-free component,
native Node, or broad public mount item to erase dependencies. Internal erased
storage is permitted only behind checked construction/activation boundaries.
Use positive and negative compile-time cases to establish variance and inference;
do not rely on illustrative signatures as proof of soundness.

Use Effect tokens with distinct identifier types and distinct runtime keys. Effect
uses string service keys at runtime; do not promise fresh-symbol identity or
collision detection that Effect itself does not provide. Demonstrate class-style
tokens with namespaced keys, and test different tokens with identical value shapes.
Provider value inference must come from the token, not widen the token's value
type to accommodate a mismatched value. Use NoInfer or equivalent constraints.

## Strict synchronous computations

Introduce an inert, composable `Sync<A, E, R>` with at least:

- `succeed`, `fail`, `gen`, `map`, and `flatMap`.
- `service(token)` for an ordinary Effect service token.
- `fromResult(result)` for a previously computed Result.
- A lazy synchronous callback constructor for deferred synchronous operations.
- Local computation service provision, with the same distinction from subtree
  provision as Effect has.

`Sync.gen` yields Sync computations only. A token is read through
`Sync.service(CurrentUser)`, not by yielding the Effect token directly. A Result
is lifted explicitly. Reject arbitrary Effect/Promise returns and yields at the
type boundary; validate foreign/untyped computations at runtime. There is no
general `fromEffect` adapter that runs an arbitrary Effect synchronously.

Framework factory/fallback helpers return Sync. Factories return Sync containing
the lifecycle; fallbacks return Sync containing output. Setup remains Effect.
The interpreter supplies the owner computation environment and completes without
suspension. Expected errors retain E; thrown exceptions and missing services are
defects. Keep interpreter execution internal to lifecycle/commit boundaries; any
public runner must require a sufficient typed environment.

Migrate Result.gen/succeed factory and fallback usage to Sync.gen/succeed. Internal
Result-based validation can remain and be lifted lazily. `fromResult` does not
retroactively make eager argument evaluation lazy. Constructing component and
provider descriptions must not execute Sync callbacks or allocate occurrences.

## Opaque output and native interoperability

`he` continues constructing detached DOM when its computation executes, but returns
an opaque handle, not a native element. It need not introduce a virtual DOM.

Conceptually:

```ts
he("section", { children: [Account] });
// Effect<ElementOutput<HTMLSectionElement, CurrentUser>, ConstructionError>
```

Children's requirements live on the output, not on the construction Effect's R.
Construction does not consume child services. This preserves the distinction
between constructing deferred content and executing computations that read a
service. The synchronous constructor follows the same rule.

Keep tag-specific native property types. Update events, bindValue, reactive DOM
helpers, h targets, and tests to accept appropriate typed handles. Helpers that
only use the element's native capabilities must not discharge or unnecessarily
demand its deferred child requirements.

Provide explicit native access for focus, measurements, and third-party widgets.
Such access does not make the native object a valid mountable output. Do not
expose an implicit Node conversion or accept raw Nodes in normal output unions.

Provide owner-bound checked native-node import, returning a requirement-free
opaque handle in Sync or Effect. Native DOM supplied to import must be detached,
fresh, and free of framework-managed nodes/regions, including nested descendants.
Reject import of an exported framework element, a wrapper containing such an
element, adopted/consumed trees, and tracked nodes after detachment. Repeat relevant
structure/ownership validation at adoption to catch post-import mutation. This
closes the export/widen/re-import requirement-erasure path.

Existing single-use, overlap, freshness, structural-mutation, and adoption rules
remain. Native escape hatches permit ordinary imperative DOM access; they do not
promise safety for unsupported structural mutation or malicious casts. Native
application mount targets remain supported separately from mountable output.

## Providers and runtime environments

`provideContext({ key, value, child })` returns an inert Component description.
Accept only component descriptions as child, not constructed handles, lists,
selections, or arrays. Wrap those in a component when needed. This keeps provider
construction independent from already-constructed tree ownership.

A provider occurrence extends its parent's subtree environment before invoking
its child factory. Carry this environment explicitly through the owner tree,
including pending fallback owners, structural selection owners, keyed controllers,
and row occurrences. Do not depend on DOM ancestry, current JavaScript call nesting,
or accidental fiber inheritance. Nearest provider wins; sibling providers and
separate application instances remain isolated.

Bindings are immutable for an occurrence. Publish changing values through signals;
do not support replacing a provider binding in place. As with existing component
selection, a newly allocated provider definition is a new identity; retain stable
definitions when local state must survive selection. A provider introduces no
visible DOM wrapper and uses the existing occurrence lifecycle.

Providing a value does not acquire it or transfer ownership. Root-owned signals
remain root-owned, consumer derivations remain consumer-owned, and existing signal
ancestor-access checks still apply. Services may expose general capabilities;
context is not a security boundary and does not deeply validate arbitrary service
objects. Providers do not add subscriptions or a second reactive graph.

Each component factory/fallback/setup begins with its subtree environment plus
the framework's appropriate lifecycle capabilities. Effect.provideService and
Sync computation provision affect only the computations they wrap. They do not
modify the owner's subtree environment or supply deferred child occurrences.
The application starts with no user subtree services; supply the root through
explicit providers. Do not silently capture mounting's caller services as root
subtree providers.

## Imperative mounting and structural requirements

`h(parent, content)` becomes lazy and yieldable. It validates and enqueues when
executed, and returns after enqueueing, without awaiting mounted setup or async
cleanup. Sync h does not suspend; it runs inside Sync.gen or another Sync
composition. Unexecuted h computations enqueue nothing.

```ts
Sync.gen(function* () {
  yield* h(parent, Account);
  // Validation/registration completed; Account setup is not awaited.
});
```

Requirements of imperatively mounted content must contribute to the enclosing
component even though h returns void. They must remain structural requirements,
distinct from ordinary service reads in that computation. Otherwise wrapping h
with Effect.provideService(CurrentUser, value) could remove CurrentUser from its
type without providing it to the mounted child at runtime.

Use an internal, type-distinct structural-requirement marker in Sync/Effect's R
channel (or an equally sound representation). h contributes that marker for its
content requirements. Component inference normalizes markers into component
requirements; ordinary service provision must not discharge them. Markers are
framework bookkeeping, not user-provided Effect services. Do not perform fake
runtime service lookups for these markers. Union normalization must retain all
requirements through nested callback registration and helper composition.

Application h accepts only closed output with no user service requirements. Its
native target does not supply services. At component level h uses the issuing
owner's subtree environment. It may not treat the caller's local Effect context
as an implicit subtree provider. Generic owner helpers must not allow captured
application helpers to bypass the application boundary checks.

Type-prototype this case before runtime implementation. If the proposed marker
representation cannot preserve inference through Effect/Sync composition without
casts in application code, revise the representation before migrating callers;
do not weaken the computation/subtree distinction to make the types pass.

## Deferred work and resource lifecycle

Audit fork, subscribe, subscribeStream, foldStream, stream acquisition, and any
other helper that stores a callback or schedules a computation. Their returned
Sync/Effect must carry the requirements of the registered work, minus only
capabilities actually supplied by the runtime. Preserve structural requirements
from h calls inside that work.

Capture the computation environment when registration executes, not when the
helper computation is constructed or when a later event arrives. Execute the
callback/work with that snapshot, including local service overrides. Sync
registration captures the interpreter's environment. Context values themselves
are not deep-copied; signals remain live references.

Descendant component activation continues to use subtree environments. For example,
a locally provided CurrentUser inside subscribe affects the event handler's own
service read; it does not satisfy Account mounted by h inside that handler.

Retain existing scope and transaction authority: install the correct owning Scope,
start managed asynchronous work with a fresh transaction context, and do not
resurrect a captured staging transaction. Preserve owned-work cancellation,
attached-DOM synchronous finalizers, descendant-first resource cleanup, and
application shutdown awaiting outstanding cleanup. Locally acquired resources
must outlive deferred consumers; context capture does not extend resource lifetime.
Finalizers and cleanup must preserve the appropriate registered service environment
without substituting a later provider occurrence's services.

No asynchronous acquisition by providers, implicit Layer building, optional
context/default-value API, or automatic rerunning of setup on service changes is
introduced in this version.

## Failure handling

In typed programs, a required service is supplied before its consumer runs.
Malformed JavaScript callers and unsafe casts remain possible. A missing service
is a defect with useful token/phase context, flowing through the existing cause
and failure-reporting system. Do not add MissingContext to every expected-error
union or use a default value for a required service.

Preserve phase-specific behavior: factory/setup failure fails the occurrence;
fallback failure retires its partial pending view and permits setup to continue;
callback failures follow existing reporting/recovery rules. Providers do not
introduce broad eager tree evaluation to discover requirements at runtime. No
factories execute during description construction or aborted preparation.

## Implementation sequence

1. Prove the type algebra with minimal public API prototypes and compile-time
   regressions: inferred lifecycle/output unions, provider subtraction, opaque
   handles, selections, rows, deferred handlers, and imperative h markers. Include
   local Effect/Sync provision counterexamples before committing to signatures.
2. Implement strict Sync and environment interpretation with existing synchronous
   Result validation underneath. Preserve error types and non-suspension.
3. Introduce opaque typed element/output handles, explicit native access, and
   checked import. Adapt construction, bindings, event/input helpers, ownership
   inspection, and public exports without changing DOM commit timing.
4. Carry subtree environments through every owner creation/activation path and
   implement inert component-only providers using existing lifecycle machinery.
5. Make h yieldable, propagate structural requirements, and capture registration
   environments for deferred work. Audit all internal runFork/runSync boundaries,
   scopes, cleanup paths, and transaction resets.
6. Migrate every frappé component, row, demo, helper, and test. Remove obsolete
   public Result lifecycle and raw native output paths. Update README and add the
   root-user / Settings / Account example with controllable signal updates.
7. Run focused new checks and the complete frappé suite, then required
   repository formatting, lint, and typechecking. Report unrelated failures
   separately; do not edit vendored repositories.

## Acceptance criteria

### Compile-time coverage

- Account/Settings infer CurrentUser without annotations; providing it closes Root.
- Wrong value type, wrong token with identical value shape, missing provider, and
  partially provided multi-service trees fail at the mounting boundary.
- Factory, fallback, setup, mixed-array, nested-element, direct-output, selection,
  heterogeneous-row, stream, and deferred-work requirements all propagate.
- Result is accepted only through its adapter; arbitrary Effect, Promise, and
  directly yielded service tokens are rejected by Sync.gen.
- Factory/fallback/setup error types and native tag/property/input/event types
  retain their current precision.
- Effect/Sync provision can close ordinary computation requirements but cannot
  close requirements stored in an output or imperative h structural marker.
- A locally provided handler service read is accepted; a child mounted by that
  handler still requires an explicit subtree provider.
- Application h rejects open output even under ordinary Effect.provideService.
- A component with an unresolved requirement cannot widen to Component<never>;
  arrays, signals, rows, output annotations, and generic helpers cannot erase R.
- Native element handles cannot widen to Nodes, and native access results cannot
  be directly mounted. Provider child accepts only component descriptions.
- No application casts, explicit requires declarations, or manually repeated
  requirement unions are needed for the primary examples.

### Runtime coverage

- Root signal changes update nested Account text without rerunning setup; signed
  out state is valid. Root retains write capability while Account receives read-only
  capability. Disposal removes descendant bindings and subscriptions.
- Factory and fallback read context synchronously; child factories see providers
  before execution. Pending fallback replacement preserves existing scope rules.
- Nested shadowing, siblings, duplicate mounts, independent applications, selected
  subtrees, keyed rows/reorders, imperative mounts, and asynchronous setup all use
  the correct owner environment without cross-occurrence leakage.
- Inert/unmounted providers, coalesced-away selections, and aborted/conflicting
  batches perform no lifecycle work. Stable definitions preserve state; changed
  provider definitions remount according to ordinary identity semantics.
- Local computation provision affects service reads and captured callbacks but
  does not mutate descendant environments. Deferred registration snapshots its
  environment only when executed and respects liveness/cancellation.
- Captured contexts do not restore stale transactions or override framework Scope;
  resource cleanup observes its original environment during overlapping replacement.
- Sync h executes validation/enqueueing synchronously, unexecuted h is inert, and
  neither h variant awaits setup. Existing queue/replacement ordering is preserved.
- Checked native import accepts fresh unmanaged trees and rejects exported handles,
  nested framework nodes/anchors, consumed/detached tracked nodes, duplicate roots,
  and post-import mutation that invalidates adoption.
- Untyped missing-service defects are reported with existing phase isolation and
  cleanup behavior; throwing error reporters do not stall unrelated work.
- Existing reactive transaction, keyed focus/caret, fallback, ownership, input,
  and teardown regressions continue to pass after migration.

Use deterministic gates rather than sleeps or live network requests. Run the
frappé type tests and runtime suite, and repository `pnpm fmt`, `pnpm
lint`, and `pnpm typecheck` during implementation. This specification-only
change does not require executing the runtime regression suite.
