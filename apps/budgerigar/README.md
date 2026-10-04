# Budgerigar

An experiment in scoped DOM composition and functional reactive state using
Effect 4. Run `pnpm dev:budgerigar` from the repository root, or `pnpm --filter
@charismaticalli/budgerigar test` for its tests.

`component({ setup })` defines a reusable component. Setup runs once per
occurrence and returns a fresh native node or a readonly array of roots (including
an empty array). Setup can await Effect work.

The context provides:

- `he(tag, options?)` to return an Effect that constructs a detached HTML element.
  Validation failures use the typed `ConstructionError` channel. Options
  contain optional-value `attrs`, writable native `props`, and ordered `children`
  consisting of strings, nodes, signals of strings, or component definitions.
  Attribute and property entries can themselves be signals. Attributes precede
  children, and properties are assigned last. Strings become literal text nodes.
- `h(parent, content)` to enqueue replacement of all children and return
  immediately. Content is a node, component, or readonly mixed array; `[]` clears
  the target after cleanup.
- `scope` to register resource finalizers with `Scope.addFinalizer`. Setup also
  receives this scope as an Effect service, so `Effect.addFinalizer` works.
- `fork(work)` to start background Effect work owned by the component. Use this
  binding for work that must be interrupted before descendant cleanup. It shares
  the component scope for resource acquisition and reports failures to the
  application's error handler.

```ts
const Child = component({
  setup: ({ he }) => he("p", { children: ["Hello"] }),
});

const Parent = component({
  setup: ({ he }) =>
    Effect.gen(function* () {
      return yield* he("main", {
        children: [yield* he("h1", { children: ["Title"] }), Child, "After the child"],
      });
    }),
});
```

`he` is lazy: evaluation creates fresh native nodes, and component setup is
deferred until the constructed tree is adopted. Each occurrence
occupies an independent region between comment anchors, without visible wrappers.
Children can finish in any order while retaining their positions. Their completion
is independent of their enclosing setup. Properties that depend on component
children, such as a select's `value`, are assigned before those children mount and
are not replayed later.

Acquire an application binding with `mounting({ scope, onError })`, then call
`h(root, Parent)`. Keep the application scope alive; closing it awaits disposal.
`bootstrap` does this for the welcome page and requires the existing `#app` root.

Requests for a parent execute in order: validate, cancel the current installation,
await cleanup with its DOM attached, then install native nodes and region anchors
and start component setup. Pending setup never holds the queue; a later valid
request can cancel it. Cleanup still holds the queue. Other parents progress
independently. A failed component cleans its resources and leaves an empty region,
preserving its siblings. Disposal cancels pending requests and owned work, cleans
descendants before their owner, and removes DOM after cleanup. Failures include
the parent, a replacement or component-occurrence subject, lifecycle operation,
and original Effect cause; an error handler throwing does not stall the queue.

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
const Label = component({
  setup: ({ signal, derive, he }) =>
    Effect.gen(function* () {
      const count = yield* signal({ initial: 0 });
      const text = yield* derive({
        sources: { count },
        compute: ({ count }) => `Count: ${count}`,
      });
      return yield* he("p", { children: [text] });
    }),
});
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
Reactive resources are component-owned, children may consume ancestor signals,
and unrelated owners cannot derive from or bind one another's signals. Disposal
stops events and subscriptions, cancels batches, and prevents late DOM updates.
Reactive text binds on adoption and stops on tree replacement; constructing an
unadopted tree does not install live bindings.

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
  event publications, captured source versions, and failures. Its phase is
  `Staging` (with a read-cache revision), `Preparing` (with the set of prepared
  signals), or `Closed`.

A batch stages writes privately without blocking other batches. On success it
validates captured source versions and prepares affected signals in dependency
order, validates affected DOM sinks, installs every changed value, flushes DOM,
and then publishes signal changes and events. This entire commit is synchronous and cannot interleave with
another fiber's commit. It never scans unrelated signals. Failure discards the
staged work, preserving other batches' successful commits. Either
outcome closes the transaction. Component disposal cancels its batch fibers and
runs its cleanup callbacks, which unregister its signals from the coordinator.

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
const Input = component({
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
});
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

Run `pnpm test:budgerigar` for the deterministic DOM-emulator and type regressions.
