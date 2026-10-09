# frappé

An experiment in scoped DOM composition and functional reactive state using
Effect 4. Run `pnpm dev:frappe` from the repository root, or `pnpm --filter
@charismaticalli/frappe test` for its tests.

`component(factory)` defines an inert, reusable description. Each committed
occurrence invokes its synchronous factory once. The factory returns
`Sync.succeed({ setup, fallback? })`, or composes typed helpers with `Sync.gen`.
Factory closures, signals, and scopes are independent across mounts. Construction,
invalid requests, aborted batches, and coalesced-away selections invoke no factories.
Stable selected definitions preserve factory state, pending DOM, and outstanding setup.

Factory and fallback use `SynchronousContext`: fallible helpers return typed
Sync computations. Setup and the application use Effect helpers, which stay
lazy until evaluated. Setup can suspend and runs once, after the commit, unless
the occurrence has retired. Both fallback and setup return an opaque element
output, component, `Signal<Option<Component>>`, or a readonly mixed array of
those items. `[]` is empty output. Strings and text signals remain children of
`he`; nested root arrays are unsupported.

Import `Sync` from the framework alongside `Effect` for the examples below.

The context provides:

- `he(tag, options?)` to return an Effect that constructs a detached HTML
  element and returns `ElementOutput<ElementType, R>`. Deferred child
  requirements stay on the handle; constructing it does not consume their
  services. Validation failures use the typed `ConstructionError` channel.
  Options contain optional-value `attrs`, writable native `props`, and ordered
  `children` consisting of strings, element outputs, signals of strings,
  component definitions, or signals of `Option<Component>`. Attribute and
  property entries can themselves be signals. Attributes precede children, and
  properties are assigned last. Strings become literal text nodes.
- `h(parent, content)` to lazily enqueue replacement of all children. Yield it in
  Effect or Sync composition; it returns after enqueueing without awaiting setup.
  Content is an element output, component, signal of `Option<Component>`, or
  readonly mixed array; `[]` clears the target after cleanup.
- `nativeNode(output)` for typed native DOM access, such as focus and measurement.
  Exported nodes are not mountable output. `importNative(node)` lazily checks a
  fresh detached native tree and returns a closed output handle. Import rejects
  framework nodes, including exported elements, regions, consumed nodes, and
  wrappers containing them. Adoption checks the imported tree again for mutation.
  Native application mount targets remain supported.
- `addSyncFinalizer(callback)` to register synchronous DOM cleanup. Callbacks run
  in reverse registration order, descendants before owners, while outgoing DOM is
  still attached. Callbacks return `undefined` and cannot await work.
- `scope` to register asynchronous resource finalizers with `Scope.addFinalizer`.
  Setup also receives this scope as an Effect service, so `Effect.addFinalizer`
  works. These finalizers run after DOM detachment.
- `fork(work)` to register background Effect work owned by the component. It starts
  after the commit with a fresh transaction context and checks live ownership. Use this
  binding for work whose cancellation must be requested before synchronous DOM
  finalizers and completed before asynchronous descendant resource cleanup. It
  shares the component scope for resource acquisition and reports failures to
  the application's error handler.

```ts
const Child = component(() =>
  Sync.succeed({
    setup: ({ he }) => he("p", { children: ["Hello"] }),
  }),
);

const Parent = component(() =>
  Sync.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("main", {
          children: [yield* he("h1", { children: ["Title"] }), Child, "After the child"],
        });
      }),
  }),
);
```

Both Effect-based and synchronous `he` are lazy and construct when executed.
Component setup is deferred until the constructed tree is adopted. Each
occurrence occupies an independent region between comment anchors, without
visible wrappers. Children can finish in any order while retaining their
positions. Their completion is independent of their enclosing setup. Properties
that depend on component children, such as a select's `value`, are assigned
before those children mount and are not replayed later.

Acquire an application context with `const app = yield* mounting({ scope,
onError })`, then destructure `const { h } = app` and execute `yield* h(root,
Parent)`. The context provides the same construction, scope, fork,
synchronous-finalizer, and reactive helpers as a component context. Keep the
application scope alive; closing it awaits disposal. `bootstrap` does this for
the welcome page and requires the existing `#app` root.

Requests for a parent execute in order: validate, deactivate the current
installation, run synchronous finalizers while its DOM is attached, remove it,
install the incoming fallback (if provided), and start setup. Asynchronous resource
cleanup runs in tracked background fibers and can overlap incoming setup. It does
not hold the replacement queue. Every valid imperative request is processed in
order; superseded occurrences skip setup if it has not started.

A failed component immediately removes its fallback or partial output and leaves
an empty region, preserving siblings. Disposal cancels pending requests and owned
work. Synchronous DOM finalizers run descendants before their owner, followed by
DOM detachment; asynchronous resource finalizers also run descendants before their
owner. Application scope closure awaits every outstanding cleanup fiber, including
retired branches. Failures include the parent, a replacement or component-occurrence
subject, lifecycle operation, and original Effect cause; a throwing error handler
does not stall other work. Application-owned failures have a stable
`subject.kind === "application"` identity and no `parent` field.

A target belongs to one live mount context. Trees containing deferred regions must
be adopted by the context that constructed them. Native roots must be detached;
submitted trees are consumed, including discarded requests. Do not reuse,
reparent, or structurally mutate them. Duplicate, overlapping, reserved, adopted,
and invalid nodes are rejected before disturbing the installed view. Direct
external DOM removal does not dispose a component. Calling `h` after disposal is
ignored; evaluating a construction Effect after disposal fails with `ConstructionError`.

## Reactive state

The welcome page mounts two independent counters, a text input, and accessible
tabs. Each folds a merged stream of button clicks into state and derives its
displayed text without rerunning setup. Setup also receives these owner-bound
helpers:

- `signal({ initial, equals? })` creates a writable signal with effectful `get`,
  `set(value)`, and `update(f)` operations.
- `derive({ sources, compute, equals? })` creates a read-only signal with explicit
  dependencies and a pure synchronous calculation.
- `combine({ x, y })` creates a signal of consistent named snapshots. Read its
  `get` Effect or acquire its `changes` stream; separately composed ordinary
  Effect streams do not preserve multi-signal consistency automatically.
- `events(element, name)` acquires typed DOM events. `mapEvents` and `mergeEvents`
  compose framework event streams synchronously, retaining browser dispatch order
  and transactional fold participation.
- `source<A>()` creates `{ events, emit }` for programmatic events. `emit` is an
  Effect, and directly connected folds participate in the emitting batch.
- `fold({ events, initial, reducer, equals? })` acquires a read-only signal. Input
  subscription is ready before acquisition completes; reducers are pure and
  receive named `{ state, event }` inputs.
- `subscribe(events, handler)` acquires a sequential Effect handler. Each failed
  invocation is reported and processing continues with the next event.
- `toStream(events)` acquires an ordinary Effect stream. `subscribeStream` and
  `foldStream` accept ordinary streams; their asynchronous processing is separate
  from a source's originating commit. Upstream stream failure ends that
  subscription, while handler failures are recoverable per invocation.
- `batch(work)` stages writes and emissions privately, including across awaits.
  Outside readers see committed state and other writers can proceed. A concurrent
  change to a source read or written by the batch fails it with a batch conflict;
  the body is never retried automatically. Success flushes affected derivations
  and DOM bindings together before returning. Failure or interruption discards the
  complete batch. A failed nested batch invalidates the outer batch even when
  caught. External side effects cannot be rolled back.

```ts
const Label = component(() =>
  Sync.succeed({
    setup: ({ signal, derive, he }) =>
      Effect.gen(function* () {
        const count = yield* signal({ initial: 0 });
        const text = yield* derive({
          sources: { count },
          compute: ({ count }) => `Count: ${count}`,
        });
        return yield* he("p", { children: [text] });
      }),
  }),
);
```

Signals use `Object.is` equality by default and retain the old value when an
optional equality predicate says the proposal is equal. Equality receives named
`{ previous, proposed }` inputs. A signal observation stream begins with its
current committed value and retains every changed commit. Event streams have no
replay and use lossless unbounded queues.

Only a batch's owning fiber can write or emit into it. Child reads see committed
state; child writes with an inherited batch context fail to prevent concurrent
mutation of the parent's private transaction. This is a transaction ownership
rule; batches do not hold a write lock. An independent transaction can proceed
while the parent awaits, but changing a source captured by the parent causes
the parent's batch to conflict.

Awaiting asynchronous work and then writing on the original fiber is supported.
Reactive resources belong to their issuing application or component, children
may consume ancestor signals, and unrelated owners cannot derive from or bind
one another's signals. Disposal stops events and subscriptions, cancels batches,
and prevents late DOM updates. Reactive text binds on adoption and stops on tree
replacement; constructing an unadopted tree does not install live bindings.

## Runtime internals

The runtime separates component lifetime from transaction coordination:

- `ComponentLifetime` holds liveness, ancestor access, managed forks, error reporting,
  cleanup callbacks, and fibers running batches.
- `CommitCoordinator` tracks signal membership across a component tree.
- `ReactiveRuntime` connects a component lifetime to that coordinator and the
  component's ordered DOM event queue.
- `SignalCommit` is a signal's participation in commits: dependencies, preparation,
  value installation, DOM validation/flushing, and change publication. Signal values,
  staged candidates, and read caches remain private to the signal. Reverse
  dependency links and dependency depth identify and order affected signals;
  committed versions detect conflicting batches.
- `Transaction` records the coordinator, owning fiber, touched signals, deferred
  event publications, captured source versions, retired owners, and failures.
  Its phase is `Staging` (with a read-cache revision), `Preparing` (with the
  set of prepared signals), or `Closed`.

A batch stages writes privately without blocking other batches. On success it
validates captured source versions and prepares structural selection and
keyed-list plans in owner order, then ordinary affected signals in dependency
order. Plans mark outgoing owners as retired within the transaction; their
descendants skip preparation, validation, DOM updates, and publication. It
validates affected DOM sinks, installs every changed value, flushes DOM, and
then publishes signal changes and events. This entire commit is synchronous and
cannot interleave with another fiber's commit. It never scans unrelated
signals. Failure discards the staged work, preserving other batches' successful
commits. Either outcome closes the transaction. Component disposal cancels its
batch fibers and runs its cleanup callbacks, which unregister its signals from
the coordinator.

## Reactive DOM values and editing

Each `attrs` or `props` entry accepts an independent static value or signal.
Attributes **require** `Option<true | string>`: `Some(true)` sets an empty
attribute, `Some(string)` sets that literal string, and only `None` removes it.
Empty strings and strings such as `"false"`, `"true"`, and `"null"` stay literal.
For a boolean HTML attribute, `Some("false")` still leaves it present. Bare
strings/booleans, `Some(false)`, numbers, objects, null, and undefined are rejected
by types and runtime validation. Attribute names are validated before adoption.
Omitted keys install no writer.

Properties retain their native, tag-specific types, including nullability;
`Signal<boolean>` can drive `input.disabled`, for example. Methods, readonly
members, event handlers, HTML injection, structural text fields, and `style`
remain excluded. `Option` does not delete properties. Native undefined is only
accepted for a native property whose domain includes it.

```ts
const Input = component(() =>
  Sync.succeed({
    setup: ({ he, signal, derive, bindValue }) =>
      Effect.gen(function* () {
        const text = yield* signal({ initial: "" });
        const hint = yield* derive({
          sources: { text },
          compute: ({ text }) =>
            Match.value(text.length > 0).pipe(
              Match.when(true, () => Option.some("Clear to reset")),
              Match.when(false, () => Option.none<string>()),
              Match.exhaustive,
            ),
        });
        const input = yield* he("input", {
          attrs: { "aria-label": Option.some("Your text"), title: hint },
          props: { type: "text" },
        });
        yield* bindValue({ element: input, signal: text });
        return yield* he("section", { children: [input, text] });
      }),
  }),
);
```

Construction initializes detached nodes without subscriptions. Adoption validates
again, refreshes from committed snapshots, and activates the bindings. Tree
replacement and component disposal release sinks and listeners before DOM removal,
including bindings to ancestor signals. External DOM removal still does not
trigger disposal. Signals preserve equality: an equal write does not force a
refresh or a retry. Redundant destination assignments are skipped.

Candidate commits validate affected DOM values before installing any state;
invalid candidates fail with `ReactiveError` and leave state and DOM intact.
All changed state is installed before synchronous text, attribute, and property
flushing, followed by observations. Only affected bindings are visited.

A native assignment failure occurs **after** a valid state commit. It reports
`operation: "reactive-dom"` through `mounting({ onError })`, with a resource
`{ element, kind, name }` and the original cause. Each failed attempt reports once;
other bindings and observations continue even if the error handler throws. The
write succeeds, and the failed binding stays active. A later changed value retries;
equal writes do not. Initialization and adoption use the same reporting policy.
Successful browser normalization does not rewrite the source signal.

`bindValue({ element, signal })` requires a writable string signal and an input or
textarea constructed by the issuing context. Register it during setup before
adoption. Supported input types are text, search, tel, url, email, and password.
Listeners are installed only at adoption and released with the tree. Programmatic
writes do not synthesize input/change events. Browser input snapshots are captured
synchronously and processed in order; older queued echoes do not overwrite a newer
editing buffer. Ordinary input echo skips assignment, preserving focus and caret.

During IME composition, model writes leave the browser buffer intact and user
publication is deferred. Composition end enqueues the completed string once;
a duplicate trailing input does not publish again. **Composition completion wins
over programmatic text changes made during composition.** Later programmatic
writes work normally. Disposal cancels pending owned input work.

`events(element, name, { synchronous })` optionally runs a small native ingress
callback before queueing the event. Use it for timely `preventDefault`; keep
signal changes and focus work in the normal ordered handlers. Existing two-argument
calls behave as before.

The home page now includes an independent text-input demo and three manual tabs.
Tab buttons keep distinct selected and focused state. Left/Right wrap focus;
Home/End focus the ends without selecting. Native Enter/Space activation selects
through click alone; Tab leaves the list normally. Panels remain mounted and use
reactive `hidden` properties, with keyboard entry points and unique ARIA IDs.

Run `pnpm test:frappe` for the deterministic DOM-emulator and type regressions.

## Signal-selected subtrees

A `Signal<Option<Component>>` is a child in `he` or a direct mount item in `h`.
`None` has no visible output; `Some(definition)` mounts a fresh occurrence between
stable comment anchors.

Declare definitions outside derivations. A fresh `Some` of the same definition
preserves its occurrence and state, including while setup is pending. A different
definition disposes the previous occurrence; returning after disposal begins
creates fresh local state. Use reactive `props: { hidden: signal }` instead when
you want mounted content and its state to survive hiding, as the tabs demo does.

Writes validate and commit selection requests without awaiting setup or resource
cleanup. Ordinary reactive text, attributes, and properties flush in the same
synchronous commit as outgoing DOM removal and incoming fallback insertion. When
a write returns, outgoing content is gone and the region displays its fallback or
is empty. Observers see that pending view; successful setup later replaces it with
its output. This makes the transition to pending content visually atomic, while
setup completion remains asynchronous.

A factory can return an optional fallback. It runs synchronously under a
separate pending-view owner and returns a Sync computation. Before activating
the selected component, the commit installs all signal changes from the
transaction. Its fallback therefore renders those new values immediately. Child
factories and fallbacks mount recursively in that same commit; their setups and
owned asynchronous work start afterward. Bare values, Effects, and Promises are
invalid factory or fallback returns, including for infallible callbacks.

Factory and setup share occurrence ownership. Their signals and work survive
fallback replacement. Fallback-local resources belong to a descendant lifetime:
its children can consume them, but enclosing setup and ready bindings cannot.
Passing a reference through a closure does not bypass lifetime validation.

```ts
import { Effect } from "effect";
import { Sync } from "./framework";

const Page = component(({ signal }) =>
  Sync.gen(function* () {
    const progress = yield* signal({ initial: "Loading…" });
    return {
      fallback: ({ he }) => he("p", { children: [progress] }),
      setup: ({ he }) =>
        Effect.gen(function* () {
          yield* progress.set("Preparing content…");
          const page = yield* loadPage;
          return yield* he("article", { children: [page.title] });
        }),
    };
  }),
);
```

Synchronous contexts expose `signal`, `derive`, `combine`, `he`, queued `h`,
`source`, `events`, `fold`, `toStream`, `subscribe`, `subscribeStream`, `foldStream`,
`bindValue`, `fork`, and `addSyncFinalizer` as lazy Sync helpers. `read(signal)` validates
ancestor access and returns its committed value. `scope` remains a plain scope.
The same signal object retains Effect-based `get`, `set`, `update`, and `changes`.
`fork` reports registration failure synchronously; eventual background failure
uses the application reporter. Stream consumers, event handlers, and queued mounts
never run user work inline during commit.

`batch(() => Sync.gen(...))` accepts a lazy thunk and rejects entry during commit
before invoking it. A failed Sync computation aborts staged signal writes and emissions.
Signal writes, even manually run Effect methods, cannot reenter a commit. Allocate
new signals with initial values during construction and use `fork` for later work.
`Sync.gen` short-circuits without rolling back earlier registrations; lifecycle
failure retires those resources. Expected Sync failures retain typed Effect
failures; throws retain defect causes.

Successful setup validates and binds its candidate first, then synchronously
retires pending ingress, interrupts pending work, runs descendant-first finalizers
while DOM remains attached, removes fallback, and inserts ready content. Pending
asynchronous cleanup does not delay ready output; shutdown still awaits it. Factory
finalizers run on occurrence disposal, while fallback finalizers run on pending-view
retirement. Retired work cannot repopulate the region or clear newer content.

To pass parent state, create a stable child description once within the parent
factory or setup using a named options object:

```ts
const child = (options: { label: Signal<string> }) =>
  component(() =>
    Sync.succeed({
      fallback: ({ he }) => he("p", { children: [options.label] }),
      setup: ({ he }) => he("article", { children: [options.label] }),
    }),
  );

const Parent = component(({ signal }) =>
  Sync.gen(function* () {
    const label = yield* signal({ initial: "Parent label" });
    const stableChild = child({ label });
    return { setup: () => Effect.succeed(stableChild) };
  }),
);
```

Creating a description does not allocate occurrence state. Updating signals
changes bindings without rerunning callbacks or restarting requests. Explicit
setup reads are snapshots. Creating a new definition inside every derivation
changes identity and remounts; no props, memoization, or automatic request
restart is provided. The home page's gated loading demo shows parent title
updates and shared progress while awaiting a button, without depending on a
live network.

Use `yield* addSyncFinalizer(() => { ... })` in setup for DOM-dependent work
such as checking `nativeNode(panel).contains(document.activeElement)` and
focusing a surviving trigger before the panel detaches. Reactive handles owned
by the outgoing occurrence are already inactive during this callback. Keep
asynchronous work in ordinary scope finalizers; those see detached outgoing
nodes. Old resource cleanup and new resource acquisition may overlap, so shared
resources need ownership rules that support overlapping lifetimes. Avoid
restoring focus in delayed cleanup, which could override a newer user
interaction.

Synchronous finalizer exceptions report as `cleanup` failures and do not stop
removal, other finalizers, or fallback insertion. Factory failures report as
`factory`, clean partial occurrence resources, and skip fallback and setup.
Fallback failures report as `fallback` failures, remove any partial fallback,
and continue setup in an empty region. Successful setup installs its output
normally. Setup/adoption failures also leave an empty region, removing pending
content immediately while cleanup continues. These failures do not reject an
already committed write. Repeating the failed definition does not retry it;
changing the selection re-arms it for a later attempt. Reporter exceptions
remain isolated. Signal writes reentered from a synchronous callback during a
commit fail with `ReactiveError`; schedule subsequent writes after that
commit instead.

Different regions and targets progress independently. Aborted batches and
transient selections inside a batch perform no factory invocation, finalization,
fallback construction, or setup. Superseded setup cannot adopt output, and its
eventual cleanup cannot remove another occurrence's nodes. External structural
DOM changes remain unsupported and do not automatically dispose resources.

Root signals can select components directly, and descendants can consume root
signals across multiple targets. Each application context has its own lifetime,
ancestor chain, and commit coordinator, even if two contexts share a scope.
Shared coordination grants no access to descendant, sibling, or foreign resources.
Clearing a target disposes its installed bindings and components while preserving
application state, subscriptions, work, and other targets. Scope closure stops
root handles and work, runs synchronous finalizers, removes DOM immediately, and
awaits descendant and retired-branch resource cleanup before completing.

For example, with an existing `root` element and application `onError` reporter:

```ts
import { Effect, Match, Option } from "effect";
import { AccessWarning, AccessiblePage } from "./src/access";
import { mounting, type Component } from "./src/framework";

const program = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const app = yield* mounting({ scope, onError });
  const access = yield* app.signal<Option.Option<boolean>>({ initial: Option.none() });
  const selected = yield* app.derive({
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
  const { h } = app;
  yield* h(root, selected);
  yield* access.set(Option.some(true)); // Commits the request, not setup completion.
  yield* Effect.never; // Keep the application lifetime open.
}).pipe(Effect.scoped);
```

## Keyed dynamic lists

Use `keyed({ items, key, row })` to render a signal of immutable array snapshots.
Define a stable row descriptor once; its factory runs independently for each
mounted `(key, descriptor)` identity. Lists work in `he` children and directly
in mounts, setup, and fallback output, including mixed arrays and nested lists.

```ts
const TodoRow = row<Todo>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const label = yield* context.derive({
      sources: { item: inputs.item, index: inputs.index },
      compute: ({ item, index }) => `${index + 1}. ${item.text}`,
    });
    return { setup: ({ he }) => he("li", { children: [label] }) };
  }),
);

const list = keyed({ items: todos, key: (todo) => todo.id, row: () => TodoRow });
const element = yield * he("ol", { children: [list] });
```

The only row constructor signature is `row<Todo>()(factory)`. It preserves
inferred factory, setup, and fallback error types while specifying the item
type. Import `keyed` and `row` from the framework with the existing
Effect/Sync helpers.

Each row receives a stable key, a read-only item signal, and a read-only zero-based
index signal. Retained row inputs and parent dependencies update in one source
transaction, before observations. New item objects update bindings while local
state and pending setup remain alive. Reordering moves existing anchored native
nodes, including multi-root output and pending fallback; it runs no lifecycle
callbacks. The move implementation restores focused controls and input/textarea
selection with `preventScroll` if native movement loses focus.

Keys are strings or finite numbers, unique across a list even with different row
types. `1` and `"1"` differ; `0` and `-0` collide. Invalid keys, duplicate keys,
throwing selectors, and invalid retained-row bindings reject the entire update.
Selectors must be pure, and row descriptors must be stable. Creating a new
descriptor in the selector deliberately replaces the occurrence.

Removal, including filtering, finalizes a row; returning its key creates fresh
state. Identity is local to each mounted list. Factory/setup failure empties only
the failed row's slot and retires its signals/resources. A later committed item
change under `Object.is` creates one fresh attempt; index-only changes do not.
Sorting that recreates every item object can retry failed rows even when their
fields are equal. Healthy/pending rows never restart merely because data changes;
if pending setup fails, it waits for the next item change. Descriptor replacement
and removal/reinsertion also rearm failure. Old asynchronous cleanup cannot affect
new occurrences, and application shutdown awaits all retired cleanup.

Row actions should update parent state by key. Compose empty views through the
existing selection helpers. The home page's todo example demonstrates add, save,
completion, deletion, and Move up/Move down buttons, with unsaved row-local drafts
preserved across reordering.

## Runtime resources and component context

Use `Resource.Service<Self, Shape>()("app/Name")` for services available throughout
one mounting runtime. Use `Context.Service<Self, Shape>()("app/Name")` from
frappé for ancestor-provided values. Both constructors are branded Effect
service classes: ordinary `yield* Token`, `Sync.service(Token)`, `.of`, and Effect
layers work. Their underlying keys have separate namespaces. Use application-qualified
names; repeated names within a kind retain Effect's normal identity semantics.

```ts
import { Effect, Layer, Option } from "effect";
import { Context, Resource, mounting, type Signal } from "./src/framework";

class Storage extends Resource.Service<
  Storage,
  {
    readonly get: (key: string) => Effect.Effect<Option.Option<string>>;
  }
>()("Example/Storage") {}

class CurrentUser extends Context.Service<CurrentUser, Signal<Option.Option<string>>>()(
  "Example/CurrentUser",
) {}

const StorageLive = Layer.effect(
  Storage,
  Effect.sync(() =>
    Storage.of({
      get: (key) => Effect.sync(() => Option.fromNullishOr(localStorage.getItem(key))),
    }),
  ),
);

const app = yield * mounting({ scope, resources: StorageLive, onError });
yield * app.h(root, Page); // Page and its descendants may independently read Storage.
```

Components infer requirements from factory, fallback, setup, returned descriptions,
and registered work. `Component<R>` records unmet identifier types. Mounting accepts
content only when the runtime supplies every remaining resource requirement.
`provideContext({ key, value, child })` accepts only a frappé context token and
supplies an existing value to descendant occurrences without a DOM wrapper. It
subtracts that context requirement while retaining every resource requirement.
Nearest providers win; publish changing values through signals rather than replacing
bindings. Resources remain independent of component and native DOM ancestry.

Pass an Effect layer graph through `resources` to mounting. Only resource tags may
be exported; ordinary infrastructure dependencies can be hidden with `Layer.provide`.
For direct component access to a third-party service, define a resource adapter tag.
Layer inputs and typed acquisition errors remain in mounting's Effect type. Omit
`resources`, or pass `Layer.empty`, for resource-free applications.

Acquisition finishes before mounting returns, with a fresh memo map and owned scope
for each runtime. Shared dependencies acquire once within a graph. Stateful layers
should allocate inside acquisition; `Layer.succeed` can deliberately share a prebuilt
object. Tests replace the entire runtime layer. Mounting is interruptible during
acquisition, releases partial acquisitions on failure or cancellation, and fails
through its typed error channel without also calling `onError`. Once mounted,
component and owned-work failures retain the existing `onError` behavior.

Replacing content retains resources. Shutdown interrupts consumers, awaits descendant
and retired-branch cleanup, then releases resources once. Component finalizers can
still use services during cleanup. Application `fork`, `batch`, subscriptions, and
stream helpers supply runtime resources and retain any residual typed requirements.

Factory and fallback read services with `yield* Sync.service(Token)`; setup uses
ordinary Effect reads. Explicit local `Effect.provideService` and `Sync.provideService`
affect computation reads and registration-time capture. They do not supply deferred
children or modify runtime resources. Descendants receive their runtime resources
and explicit ancestor context, independently of a callback's incidental environment.
Owned deferred work receives its owning Scope and fresh transaction authority.

The [account example](src/account.ts) demonstrates Root owning a writable user signal
and providing its read-only view as CurrentUser. Root and Navigation independently
read the [Auth resource](src/auth.ts); Navigation logs out through Auth, and Root
consumes the replaying session stream to seed and update its signal. Session discovery
happens during acquisition, so there is no separate read/subscribe gap. Signed-out
is `Option.none()`. Unmounting Root stops its subscription while Auth remains alive
until runtime shutdown.

[LocalStorage](src/local-storage.ts) demonstrates an unrelated resource and an isolated
memory layer. Bootstrap merges it with the self-contained Auth demo layer; no backend
or credentials are required. Tests use `authMock({ initial })` and `LocalStorageMemory`,
which allocate fresh state per runtime.

## Scoped tagged-union branches

`branch<A>()(factory)` describes a reusable occurrence whose `inputs.state` is a
live `WritableSignal<A>`. `branch<A, Signal<A>>()` describes a read-only consumer,
which also works over writable sources. `cases({ state, branches })` requires
exactly one correctly narrowed descriptor for every `_tag` in the source union.
A writable consumer cannot mount over a read-only signal. Cases work in `he`
children, `h`, setup/fallback output, and mixed root arrays; their deferred context
and resource requirements remain inferred through all those boundaries.

```ts
import { Effect } from "effect";
import { branch, cases, focus, Sync } from "./src/framework";

type State =
  | { readonly _tag: "Editing"; readonly documentId: string; readonly draft: string }
  | { readonly _tag: "Closed" };
type Editing = Extract<State, { _tag: "Editing" }>;

const EditingBranch = branch<Editing>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const draft = yield* focus({ context, source: inputs.state, key: "draft" });
    const input = yield* context.he("input", { props: { type: "text" } });
    yield* context.bindValue({ element: input, signal: draft });
    return { setup: () => Effect.succeed(input) };
  }),
);
const ClosedBranch = branch<Extract<State, { _tag: "Closed" }>>()(() =>
  Sync.succeed({ setup: () => Effect.succeed([]) }),
);
const output = cases({
  state,
  branches: {
    Editing: { branch: EditingBranch, key: (state) => state.documentId },
    Closed: { branch: ClosedBranch },
  },
});
```

Descriptions are inert. Construction validates ownership and the initial identity;
adoption validates the latest committed state. Each mount has independent local
state. Occurrences retain their descriptor, tag, and optional string/finite-number
key. Data changes within that identity update inputs in the source commit, preserving
pending setup and fallback. Changing identity retires outgoing descendants immediately;
incoming content shows its fallback or an empty region. Leaving and returning starts
a fresh occurrence. Failed occurrences stay empty until identity changes or reentry.
There is no inactive-page cache or implicit setup restart on parameter changes.

Narrowed setters replace their variant in the authoritative source and cannot change
its tag, including through malformed JavaScript calls. `focus({ context, source, key })`
projects a property, preserving the source's write capability. Discriminant projection
is excluded. `get`, `set`, and `update` run lifetime checks when their Effects execute.
Nested setters use the latest staged parent, so sibling edits and parent/child writes
compose in program order in one batch without subscriptions or extra commits.

A setter that rekeys its own occurrence succeeds; subsequent access through that
occurrence fails with `ReactiveError`. Staged departure/rekeying also invalidates old
lenses for the rest of that batch, even if the candidate returns to the original
identity. Catching that failure poisons the batch. A discarded batch restores prior
validity; a successful batch whose final identity is unchanged retains its committed
occurrence. Saved lenses cannot revive a retired occurrence after a later matching
login/key. Existing conflict, fiber-ownership, disposal, and cleanup rules apply.

## Typed URLs and navigation

Define routes once to infer both the global `Destination` union and typed validated
prefix alternatives. Definitions are pure; parsing acquires no user or project data.
Parameters and query values use synchronous, service-free Schema codecs with string
encodings. Asynchronous codecs and schema defects fail through URL diagnostics or
`UrlBuildError` rather than being awaited. Custom encoders can fail even for typed
values, so builders return `Result`.

```ts
import { Option, Schema } from "effect";
import {
  arrayQuery,
  defaultQuery,
  optionalQuery,
  parameter,
  route,
  router,
  type Destination,
} from "./src/framework";

const ProjectId = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
  Schema.brand("ProjectId"),
);
const urls = router([
  route({ tag: "Login", path: ["login"] }),
  route({
    tag: "Projects",
    path: ["projects"],
    children: [
      route({ tag: "NewProject", path: ["new"] }),
      route({
        tag: "Project",
        path: [parameter("id", ProjectId)],
        children: [
          route({
            tag: "Settings",
            path: ["settings"],
            query: {
              q: optionalQuery(Schema.String),
              page: defaultQuery(Schema.NumberFromString, 1),
              filter: arrayQuery(Schema.String),
            },
          }),
        ],
      }),
    ],
  }),
]);
type AppDestination = Destination<typeof urls.definitions>;
const destination: AppDestination = {
  _tag: "Settings",
  params: { id: ProjectId.make(123) },
  query: { q: Option.none(), page: 1, filter: [] },
  fragment: Option.some("details"),
};
const href = urls.build(destination); // Result: /projects/123/settings#details
const outcome = urls.parse("/projects/123/unknown-child");
```

Routes match in declaration order at each level. Structural ownership precedes
schema decoding, so an invalid `:id` cannot fall through to another schema.
Declare literals such as `new` before parameter siblings.
`remaining("segments")` explicitly captures remaining decoded segments and must
be terminal. Inherited parameter/query names and route tags must be unique;
conflicting definitions are rejected.

`parse` returns exhaustive `Matched`, `NotFound`, or `InvalidUrl` variants.
Each keeps the original URL and a typed `ancestry` array of discriminated
prefixes containing only validated values. `NotFound` keeps the remaining
segments; `InvalidUrl` distinguishes the structurally matched route from
validated ancestry and includes parameter/query location and schema
diagnostics. `/projects/wrong-id` has a valid projects prefix without a
fabricated branded ID. `/projects/123/unknown-child` has a validated project
prefix; the application can acquire it before rendering the nested error.

Paths are case-sensitive. Builders omit trailing slashes except at the root,
absent optional queries, and declared defaults. Parsing an equivalent trailing
slash does not rewrite history. Splitting precedes decoding: encoded slashes
remain segment data, and interior empty segments remain meaningful. A terminal
empty segment cannot be built canonically and returns a build error. Unknown
query parameters are ignored; scalar repetition and missing required queries
are invalid. `requiredQuery` declares required scalars; arrays accept ordered
repeated values. Query order follows definitions, with normal URL encoding.
Malformed percent encodings are structured failures. Builders verify the
emitted URL still matches its own tag; destinations shadowed by an earlier
declaration fail to build. Declared defaults are validated at definition time
and omitted using their encoded equivalence. Optional fragments, including
empty fragments, are URL data; they do not trigger framework scroll or focus
behavior.

Acquire `browserHistory(window)` in a `Layer.effect(History, ...)` resource. It
owns one popstate listener per document and rejects competing document
controllers. Adapters carry a stable transport identity, which decorators must
preserve; only one navigator may claim that identity at a time.
`memoryHistory({ initial })` is a scoped test adapter with entries, traversal,
failure injection, and disposal. Observation acquires the initial location and
subscription atomically. Push/replace never emit synthetic traversal events.

`navigator({ context, router, state, history, transition, onError })` binds one
FIFO controller to an authoritative writable application signal. Await
`navigator.initial` before rendering admitted pages. `navigate(destination, {
mode: "push" | "replace" })` accepts every valid destination, independently of
the current branch. `dispatch(event)` queues application/session events through
the same controller. A synchronous pure transition receives the latest state
and a `Navigate`, `Location`, or `Application` event and returns `{ state,
history }`. History intents are `Keep`, typed `Push`/`Replace`, or `ReplaceUrl`
for restoring the original URL of an admitted structured failure.

Application transitions own admission and redirects. For example, represent
unresolved sessions explicitly; when discovery says anonymous, admit a private
request to Login with an in-memory typed return target and a `Replace` intent.
After login, readmit that target against the new session. The parser and
browser adapter never decide authority or mount shells. Context provision
supplies values; the application union establishes when a non-optional
user/project exists. Use session identity for authenticated keys, project
identity for project keys, and variant identity for tabs.

Ordinary navigation to the current canonical URL, including query/fragment
data, is a no-op. Explicit replacement and application events still run.
Traversal reapplies admission without pushing; denied destinations replace the
observed entry with the final redirect. An equivalent external URL remains
unchanged unless the transition explicitly replaces it. Redirects replace even
when the active destination is unchanged.

Navigation validates captured versions, structural plans, and DOM sinks before
the synchronous history operation, then installs prepared signal values without
an await between history and installation. Preparation/history failure
preserves prior state and content. This integration is internal, not a general
external-effect transaction API. Lifecycle errors after commit use the usual
owner reporting path and cannot roll history back. Unexpected post-history
defects produce a reconciliation error. Traversal failures retain the last
valid state and expose the observed URL, last committed location/state, and
cause through `NavigationError`; URL and view may differ. Use an explicit
replacement to reconcile. No automatic `history.go` retry occurs.

`link({ context, router, navigator, destination, children, attrs, props })`
builds an owner-bound real anchor. Builder failures use its construction error
channel. Only eligible unmodified primary activation (including
keyboard-generated clicks) is intercepted, with synchronous `preventDefault`
before queued navigation. Modifiers, non-primary buttons, `defaultPrevented`,
download, other targets, and external origins retain native behavior. Ordinary
anchors receive no interception.

Direct writable field edits do not synchronize history. Use the navigator for
policy changes that must coordinate state and URL. Application code owns
focus/scroll, obsolete-result checks for work above page ownership, and
reconciliation policy. SSR/hydration, hash transport, loaders,
caching/prefetching, blockers, retained outgoing content, automatic request
restarts, and backend integration remain outside v1.

The [routing demo](src/routing-demo/app.ts) is mounted by bootstrap alongside
the earlier examples. It provides `Signal<User>` and `Signal<Project>` only
inside authenticated and ready-project subtrees. Its
[model](src/routing-demo/model.ts) and
[transitions](src/routing-demo/transitions.ts) keep admission policy visible.
Controls choose session discovery, sign-in, logout, expiry, new
sessions/account switching, refresh, immediate/delayed/failed project
acquisition, completion, rejection of the next history write, and explicit URL
reconciliation. Browser Back/Forward and real links exercise the same
controller. Authenticated/project counters demonstrate shell retention;
overview edits and settings notes demonstrate writable nested projections. No
login return target survives reload.

In the demo, signing in again as the current account preserves its application
ownership lifetime, acquired project, page state, and shell counters. Account
identity is the mock user's name. The incoming session notification can have a
new identifier; the application retains its existing ownership identifier for
the same account. Switching accounts, logout, or expiry retires that lifetime.

`focus({ context, source, key })` and `navigator({ context, ... })` allocate in
the explicitly supplied context. A descendant context may consume an ancestor's
source, but an ancestor or unrelated context cannot allocate against a
descendant's source. Disposing the supplied context expires its projections and
navigation work even when the source remains live. Signals retain their commit
participant and authoritative write-root identity; they do not carry allocation
runtime authority.
