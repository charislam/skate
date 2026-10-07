# Budgerigar: runtime resources and component context

## Purpose and agreed scope

Introduce application resources implemented with Effect layers, independently
accessible to every component in a mounting runtime. Keep component context as a
separate, ancestor-provided mechanism for values such as the current user signal.

Root and Navigation can both read Auth without a provider component or manually
forwarding the service. Root owns CurrentUser state; Navigation calls Auth.logout;
Root consumes Auth's session stream to update CurrentUser.

This is an implementation plan, not an implementation. It supersedes spec 008's
ordinary unclassified service tokens and resource-free application environment.
Preserve its inferred requirements, explicit subtree context, strict Sync,
registration-time environment capture, structural requirement protection, and
existing occurrence/reactive semantics unless explicitly changed here.

The requirements discussion settled these choices:

- Brand both resource and component-context tokens, with distinct constructors.
- Keep ordinary Effect reads and Layer interoperability.
- Require explicit resource tags for direct component access to third-party
  services; ordinary third-party services can be private layer dependencies.
- Acquire one resource graph per mounting runtime before mounting returns.
- Share acquired instances across components within that runtime; isolate layer
  acquisition and lifetime between runtimes.
- Return acquisition failures through mounting's typed Effect error channel.
- Support cancellation during acquisition and release partially acquired resources.
- Replace layers at runtime construction for tests. Defer component-specific
  resource overrides, resource hot swapping, and resource-loading UI in the runtime.
- Demonstrate Auth session changes consumed by Root, including logout from Navigation.

## Token API and strict separation

Export Resource.Service and Context.Service from Budgerigar. These are branded
class-style constructors backed by Effect Context.Service, not a second DI engine.
Use an EffectContext import alias internally wherever the two Context APIs coexist.

```ts
import { Effect, Option, Stream } from "effect";
import { Context, Resource, type Signal } from "./framework";
import type { AuthError, Credentials, User } from "./auth-model";

export class Auth extends Resource.Service<
  Auth,
  {
    readonly signIn: (credentials: Credentials) => Effect.Effect<void, AuthError>;
    readonly logout: () => Effect.Effect<void, AuthError>;
    readonly sessions: Stream.Stream<Option.Option<User>>;
  }
>()("Budgerigar/Auth") {}

export class CurrentUser extends Context.Service<CurrentUser, Signal<Option.Option<User>>>()(
  "Budgerigar/CurrentUser",
) {}
```

Preserve `yield* Auth`, `yield* CurrentUser`, `Sync.service(Auth)`, service `.of`,
and ordinary Layer.effect / Layer.succeed interoperability. A token's identifier
type in Effect's R channel must retain its kind, not merely the static class value.
Retain distinct token identity even when service shapes match.

Use disjoint unique-symbol type brands for identifier kinds and runtime metadata
on tokens for public-boundary validation. Namespace the underlying Effect keys by
kind so a context and resource with the same user-supplied name cannot collide.
Duplicate names within the same kind retain Effect's identity semantics; use
application-qualified names rather than introducing a global registration system.

`provideContext({ key, value, child })` accepts only a Budgerigar context token.
It cannot satisfy or override a resource. Resource layers supplied to mounting
may expose only resource identifiers; they cannot provide CurrentUser, ordinary
third-party tags, Scope, or framework bookkeeping services as public outputs.
Malformed untyped provider calls should fail with useful defects. Type-level
layer output validation is required; do not promise comprehensive runtime
inspection of erased Layer generics or arbitrary service objects.

Ordinary third-party tags remain valid inside layer implementations. For example,
AuthLive can depend on HttpClient and hide it with Layer.provide. A component that
needs direct HTTP access must use a resource adapter tag. Do not add automatic
classification or register HttpClient as a resource behind the user's back.

Self-contained Effects with privately supplied ordinary services remain legal.
The prohibition concerns unresolved component dependencies and exported runtime
resources, not all internal Effect usage. Explicit local Effect.provideService is
still ordinary computation-local provision; it does not mutate runtime resources
or supply descendants. This iteration adds no component resource override API.

## Mounting API and inferred requirements

The intended usage is:

```ts
const app =
  yield *
  mounting({
    scope,
    resources: Layer.mergeAll(AuthLive, LocalStorageLive),
    onError,
  });
yield * app.h(rootElement, Root);
```

Resource-free callers can omit resources and retain the current behavior. An
explicit Layer.empty is also valid. Preserve inference without explicit generic
arguments in ordinary callers. Validate concrete signatures against pinned Effect
and TypeScript before committing to generic ordering.

For a supplied Layer<Resources, E, Inputs>:

- mounting returns an Effect<ApplicationContext<Resources>, E, Inputs>, apart
  from any existing framework errors. Scope remains the explicitly supplied scope.
- The layer's input requirements remain visible to the caller. Ordinary
  infrastructure services can satisfy acquisition inputs; component context and
  structural bookkeeping are not valid acquisition inputs.
- Only explicit layer outputs become application resources. Do not capture the
  caller's entire Effect environment as the runtime service environment.
- Application mounting accepts content only when every remaining inferred
  requirement is a resource supplied by this runtime. Unprovided context and
  unclassified ordinary service requirements must be rejected.
- Context provision subtracts only its context identifier. It cannot erase a
  resource requirement. Missing resources remain errors at the mounting boundary.

Keep component requirements inferred from factory, fallback, setup, returned
output, and registered work. A unified Component<R, ...> requirement union is
acceptable if branded kinds remain intact; do not require explicit dependency
lists or split generic parameters just for authoring ergonomics.

Audit all ApplicationContext methods, not only h: application-level fork,
subscriptions, and other Effect helpers must execute with the runtime's resources
and discharge only resources that runtime supplies. Preserve any residual typed
requirements and ordinary local provision semantics. Preserve structural markers
so local computation provision cannot satisfy a deferred child's requirements.

Generic helpers must not widen away resource requirements, layer output kinds,
or a runtime's available-resource set. Do not use unchecked casts, any, optional
service reads, or Context.Reference defaults to make public type tests pass.

## Acquisition, isolation, and shutdown

Create a dedicated resource scope and a fresh layer memo map for each mounting
invocation. Build with the explicit memo map and scope; do not inherit a caller's
memo map and accidentally share acquisitions between runtimes. Preserve normal
Effect memoization within each graph, so shared dependencies are acquired once.

Isolation means separate acquisitions, memo maps, and owned lifetimes. Layers
that deliberately return a prebuilt singleton (for example Layer.succeed) can
still return the same object; Budgerigar does not clone service values. Stateful
live/test layers should allocate inside acquisition when isolation is required.

Resources must finish acquisition before exposing ApplicationContext. All
component factories, fallbacks, setup effects, event handlers, streams, forks,
and finalizers can then access the same acquired instances. No component waits
on a lazy resource lookup. Empty resources preserve the resource-free fast path.

Acquisition is interruptible. The current whole-function Effect.uninterruptible
on mounting must be narrowed or replaced with an acquisition-safe mask: protect
ownership/finalizer registration while restoring interruption during layer build.
On acquisition failure, interruption, or later runtime initialization failure,
close partially acquired scopes and do not expose a half-initialized runtime.
Closing the supplied parent scope during startup must not leak a resource scope
or allow a usable runtime to escape after closure.

Typed layer failures fail mounting directly, rather than becoming onError mount
failures. Defects and interruption retain their Effect causes. Existing onError
behavior remains for failures after the runtime is available; do not route one
acquisition failure through both channels. Background layer behavior and error
recovery remain the resource implementation's responsibility.

On shutdown, retire component work and await existing descendant/application
cleanup before closing the resource scope. Component finalizers may still call
resources. Layer finalizers run once after consumers finish; preserve causes and
ensure resource release is attempted even if component cleanup defects. Replacing
mounted content does not rebuild resources. Disposing one runtime cannot cancel
another runtime's resources.

## Runtime environments

Maintain two logical inputs to component execution: immutable runtime resources
and inherited component-context bindings. Internally both can be represented
with Effect contexts, but keep their ownership and provision paths distinct.

Compose them with the framework-owned Scope and transaction capabilities when
executing a phase. Resource/context tokens cannot replace framework capabilities.
Nearest context provider wins among context bindings; resources are unchanged by
component ancestry, native DOM ancestry, selections, keyed rows, or imperative h.

Preserve registration-time capture for deferred work, including explicitly local
Effect service overrides. Do not let later registrations or a different runtime
replace captured services. Descendant activation uses its runtime resources and
explicit ancestor context, not the caller callback's incidental local environment.

Audit internal Effect.runSync/runFork boundaries, Sync interpretation, mounting,
factory/fallback/setup activation, application helpers, stream acquisition,
selection/keyed activation, cleanup, and finalizer execution. Missing dependencies
in unsafe programs remain useful phase/work defects, not an added typed
MissingResource error on every read.

## Auth demonstration and mocking

Migrate the account demonstration to the branded CurrentUser context and add an
Auth resource. Root and Navigation independently read Auth. Root owns the writable
user signal and provides only its read-only view as CurrentUser. Navigation calls
logout without writing Root's signal or receiving the Auth instance as a prop.

Auth.sessions is a latest-session stream: every subscriber receives the current
session first, followed by updates. Signed-out is Option.none, not a missing
dependency or failed acquisition. Resolve initial session discovery during Auth
acquisition, then expose a replaying state stream such as SubscriptionRef changes.
Root consumes that single stream to seed and update its signal; avoid a separate
getCurrentUser-then-subscribe sequence that can lose a session transition.
The demo may show its existing pending/signed-out UI until the initial stream
emission is processed; it must not falsely present an authenticated session.

Successful signIn/logout updates the resource's session state. Failed operations
surface their typed error and do not falsely publish success. Capture SDK session
changes in the resource layer where applicable. Component unmount cancels Root's
subscription; the resource and its external session listener live until runtime
shutdown. Do not make the service depend on Budgerigar UI signals.

Keep network/SDK details behind the Auth interface, with no new production backend
or credentials required by this framework change. Supply a self-contained demo
layer and deterministic mock layer; real adapters can use Layer.effect and private
HTTP/SDK dependencies. Tests replace the runtime layer and allocate fresh mock
session state per acquisition. Include an independent LocalStorage resource
example to demonstrate multiple unrelated resource requirements and a memory mock.

## Implementation sequence

1. Prove branded constructors against Effect service/layer inference. Add positive
   and negative type checks before changing runtime ownership.
2. Introduce constructors and migrate context tokens, examples, and tests. Restrict
   provideContext to context tokens and validate malformed public provider calls.
3. Parameterize ApplicationContext and mounting over supplied resources, preserve
   structural requirement protections, and reject invalid exported layer kinds.
4. Implement interruptible layer acquisition with explicit per-runtime memoization
   and safe scope ownership. Compose environments throughout execution paths.
5. Verify teardown ordering, failure rollback, resource access from application
   helpers, and all deferred/structural execution paths.
6. Update Auth/CurrentUser and local-storage examples, bootstrap wiring, and README.
   Keep this spec as the contract; document APIs that supersede spec 008.

## Acceptance and validation

Type checks must cover:

- Both constructors work with yield*, Sync.service, and normal Effect layers.
- Same-shape resource/context and distinct same-shape tokens cannot substitute.
- provideContext rejects resources and ordinary tags; mounting resource outputs
  reject context tokens, ordinary tags, and framework capabilities.
- Complete runtime resources satisfy nested and heterogeneous outputs; missing
  resources, missing contexts, and partial graphs fail at mounting.
- Third-party services hidden inside resource layers work; unresolved direct
  third-party component reads cannot mount.
- Acquisition inputs/errors remain inferred; invalid acquisition context inputs
  are rejected. Resource-free callers continue to compile.
- Factories, fallbacks, setup, callbacks, forks, and application helper requirements
  retain correct inference. Local provision does not erase structural requirements.

Runtime tests must cover:

- Root and Navigation observe one Auth acquisition/instance; a second runtime
  using the same layer description acquires independent state and releases it
  independently, even under a caller-provided memoization environment.
- Shared dependencies acquire once within a runtime graph; remounting content
  does not reacquire application resources.
- Delayed acquisition withholds ApplicationContext; failures, cancellation,
  initialization defects, and parent-scope closure release partial acquisitions.
- Every execution phase, deferred registration, structural child path, and
  application helper sees the correct resources and component context.
- Component cleanup can use resources; resource release follows consumer cleanup,
  occurs once, and still occurs when consumer cleanup defects.
- Auth stream seeds Root and reflects navigation logout and external session
  updates without a read/subscribe gap. Failed logout preserves session state.
- Unmounting Root stops its subscription without disposing runtime Auth; runtime
  shutdown releases Auth listeners. Local-storage mocks stay isolated.

Use deterministic Deferred/Queue/Ref or equivalent Effect synchronization
instead of sleeps. Run the Budgerigar test suite and the required repository
pnpm fmt, pnpm lint, and pnpm typecheck checks during implementation; report
unrelated baseline failures separately. Do not modify vendored repositories.
