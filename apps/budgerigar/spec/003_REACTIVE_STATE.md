# Budgerigar: signals, event streams, and consistent commits

## Purpose and scope

Introduce functional reactive state using Effect 4 primitives, with some
inspiration from ReflexDOM but no requirement to reproduce its API. Demonstrate
the model with two independent classic counters on the welcome page.

This specification extends `001_INITIAL_FRAMEWORK.md` and
`002_STATIC_DOM_CONSTRUCTION.md`. Existing construction, mounting, replacement,
and cleanup contracts continue unless explicitly refined here. In particular,
`h` retains its existing immediate, void-returning request API.

Include writable signals, event-folded signals, explicit derived signals, DOM
event streams, programmatic event emission, scoped event handlers, reactive text,
and explicit asynchronous batching. Defer reactive attributes and properties,
automatic dependency tracking, asynchronous derivations, application-wide shared
state, JSX, virtual DOM, and general reactive structural rendering. Add no runtime
dependencies.

Use the pinned Effect 4 implementation and vendored source as references.
`Ref`, `SubscriptionRef`, `Stream`, `PubSub`, synchronization primitives, fibers,
and scopes are building blocks, not substitutes for the consistency contract.
Publishing to independent `SubscriptionRef` instances does not itself provide
atomic multi-signal observations or wait for DOM consumers to finish. Supply the
coordination needed by this specification without importing vendored code.

## Public model

Each component occurrence owns independent reactive resources. Expose their
creation through its explicit setup context or an equivalent explicit owner
binding; do not use an ambient global current component.

All new operations that allocate resources, read or mutate state, acquire
subscriptions, emit events, or execute handlers are Effects. Pure transformation
callbacks and stream composition remain ordinary functions. Supporting names and
TypeScript generics may be refined during implementation; these capabilities and
semantics are normative:

| Capability          | Contract                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Writable signal     | Create from an initial value and optional equality predicate; expose effectful read, set, and atomic update. |
| Derived signal      | Create from explicitly named signal sources and a synchronous pure calculation, with optional equality.      |
| Signal composition  | Combine named sources into a read-only signal of consistent snapshots.                                       |
| Snapshot read       | Read a signal or an explicitly composed group in one consistent snapshot.                                    |
| Signal observations | Acquire a stream starting with the current committed value and continuing with committed changes.            |
| DOM events          | Acquire a typed stream for an element and native event name.                                                 |
| Event source        | Create an owned programmatic source with an effectful emit operation.                                        |
| Fold                | Acquire a read-only signal from an event stream, initial state, and pure reducer.                            |
| Subscribe           | Acquire an owned, sequential event handler subscription with per-invocation error reporting.                 |
| Batch               | Evaluate Effect work against private staged state; commit together only on success, otherwise discard.       |

Read-only signals must not expose mutation capabilities. Writable signals are
also readable inputs to derivation, composition, and text binding. Preserve value
inference across sources, reducers, derived results, and native event types. Use
named options objects for related parameters and follow repository Option and
Match conventions. A pure `update` callback receives the latest value at its
transaction-local read position, including preceding staged writes in the same batch.
A concurrent change to a source read by a pending batch invalidates that batch
at commit rather than overwriting newer state.

## Signals and derivation

A signal always has a current value. A derived signal declares all dependencies
explicitly, for example sources `{ x, y }` and calculation `({ x, y }) => x + y`.
Its calculation is synchronous and pure: no Effect execution, suspension,
mutation, event emission, or hidden reactive reads. Derivation creation computes
an initial value and can fail. Dynamic dependency tracking is out of scope.

Maintain an acyclic dependency graph. Detect invalid ownership and any possible
cycle before activating a graph change. Recompute affected derivations in
dependency order against a consistent candidate snapshot; diamond dependencies
must never expose partially recomputed results. Intermediate candidate values
are private. Reads inside a batch must derive from that batch's latest staged
values, rather than stale committed derived values.

Default equality is `Object.is`. Allow a caller-supplied pure equality predicate
on writable, folded, and derived signals, including structural equality for a
particular derivation. Equal proposals retain the previous value and suppress
downstream propagation. For a batch, determine public changes relative to the
pre-batch committed values: a signal returning to its original value does not
notify observers. Events themselves are never deduplicated by state equality.

A reducer, derivation, or equality callback throwing is a failure, not an
unhandled exception escaping a browser listener. A failure while computing a
proposed commit rejects that entire candidate commit; retain the previous
consistent state and DOM. Preserve the original cause. Failed creation must
release partially acquired resources.

## Commit and observation contract

Each ordinary write, event-fold transition, or outermost batch produces one
candidate commit. Serialize commits in an ownership domain shared by related
component owners so ancestor signals and descendant derivations remain
consistent. Independent component roots need not block one another.

Before exposing a commit, finish validation, equality checks, and all affected
derived calculations. Install the committed signal snapshot and update affected
text bindings in one synchronous flush, then publish observations. A successful
write or batch Effect completes after this flush and publication; it need not
wait for arbitrary asynchronous stream consumers. Browser rendering must not
show a partial flush. Individual native DOM assignments remain sequential;
atomicity against instrumentation observing each individual assignment is not
promised.

For `x = 1` and `doubled = x * 2`, a composed observation moves directly from
`{ x: 1, doubled: 2 }` to `{ x: 2, doubled: 4 }`. For initial `{ a: 1, b: 2 }`,
batching `a = 2` and `b = 3` exposes only `{ a: 2, b: 3 }`, never a mixed pair.
The same guarantee applies to downstream derivations and bound text.

Consistency across several signals is obtained through explicit signal
composition or a snapshot read. Separate reads may straddle commits. Once
independent signals have been converted into ordinary Effect streams, combining
their latest emissions, buffering them separately, or processing them
asynchronously does not preserve shared commit identity automatically. Compose
signals first, then observe the composed signal when this guarantee is needed.

Observation acquisition must atomically establish its initial snapshot and future
subscription so no commit can be missed between reading and subscribing.
Observers receive every changed committed value in order, without coalescing
ordinary commits. They receive no intermediate batch values. Slow consumers may
lag without delaying completed commits; subscriptions use lossless buffering and
release queued values on disposal.

Commit propagation must use reverse dependency links and visit only the
downstream graph reachable from touched signals, in dependency order. It must
not scan the complete component-tree signal registry. Equal prepared values
stop downstream recalculation. Disposal removes reverse dependency links.

## Batching and asynchronous work

A batch may await arbitrary Effect work. Its writes are staged privately:

- Reads in the batch see its latest staged state and corresponding derivations.
- Outside readers and observers see the latest committed snapshot, excluding
  this batch's private writes. Other batches may commit while this batch awaits.
- No component-tree write lock is held while evaluating or awaiting a batch body.
- Each source read or written by the owning fiber captures its committed value
  and version on first access. Subsequent reads use that captured value plus this
  batch's staged writes. Composed reads track every source dependency.
- Commit validates the captured versions and source liveness. A concurrent change
  or disposal rejects the entire batch with a typed ReactiveError describing a
  batch conflict. This includes a source changed and later restored in separate
  commits. Disjoint batches can both succeed, even when they share downstream
  derivations. Those derivations use the latest committed values of untouched sources.
- Nested batches on the same fiber share staged state and flush only at the
  outermost boundary; they are not savepoints.
- Successful completion commits all completed writes together.
- Body failure or interruption discards all staged writes and emissions and
  propagates the failure or interruption. Do not attempt a commit after the body
  fails, even if some writes completed before the failure.
- A reducer, derivation, or equality failure during the batch or commit rejects
  the entire batch. Retain the previous committed state and DOM and publish no
  staged events or state notifications.
- A failed nested batch invalidates the shared outer batch, even if its caller
  catches the failure. Nested batches are not independent transactions.
- Owner disposal likewise discards its pending batch, interrupts owned work,
  and prevents a final flush into DOM undergoing cleanup.

Batching provides all-or-nothing publication of reactive state and staged
emissions. It does not roll back network requests or other external side effects.
For example, if a batch stages `a = 1` and then an awaited fetch fails, `a` keeps
its previous committed value unless another batch has committed a newer value.
Validation, preparation, installation, text flushing, and publication run in one
synchronous section without yielding. Do not retry arbitrary batch bodies
automatically. Conflict recovery belongs to the caller; external side effects
already performed by the failed body remain outside rollback.

Only the batch-owning fiber may read its private staged snapshot or write into
the batch. Child fibers may perform asynchronous or read-only work; their signal
reads use committed snapshots. A child attempting a write or emission with an
inherited batch context must fail clearly instead of mutating shared staged
state. This is a transaction ownership rule, not a deadlock safeguard: batches
do not hold a write lock. Reject stale inherited contexts after the batch closes.
Use explicit batch context identity and owning fiber identity, not just an
inherited boolean flag. Supporting child writes would require explicit rules for
write ordering, child completion before commit, and propagation of child failure;
these semantics are deferred.

In particular, this pattern must fail because the child does not own the transaction:

```text
batch:
  set a = 2
  child = fork(set b = 3)
  join child
```

The check prevents a child from concurrently mutating its parent's private
transaction. Awaiting a fetch and then writing its result on the owning fiber is
supported. A child with the inherited transaction context explicitly cleared
runs an independent transaction. Awaiting an independent writer is supported;
changes to a captured source will subsequently cause the pending batch to conflict.

## Event sources and processing

Provide an effectful `events(element, eventName)`-style API with native event
type inference. Do not add `on` options to `he` in this iteration. Event streams
broadcast to active subscribers, have no replay, and retain event occurrences
even when resulting state is unchanged. Do not automatically prevent default or
stop propagation. Native cancellation must happen during browser dispatch;
ordinary asynchronous stream handlers must not promise that capability.

Listeners and subscriber queues are scoped resources. Acquiring a managed fold
or handler must wait until its framework event inputs are subscribed, ensuring
setup can return an interactive counter with no subscription-startup race.
Subscription readiness is required for framework sources and their supported
synchronous composition, not arbitrary delayed external streams. Remove listeners
when no longer needed and always on owner disposal. Constructing and abandoning
an element must not leak a listener beyond its owner's lifetime.

Preserve browser dispatch order across the counter's three buttons, not merely
order within each button stream. The supported event merge/composition path must
preserve ingress order for synchronously tagged DOM events. Assign ordering at
ingress if necessary; an ordinary concurrent stream merge is not sufficient
evidence of ordering. Asynchronous upstream transformations may explicitly alter
arrival order and are outside this stronger ingress-order guarantee.

Use lossless, unbounded queues for this iteration. Process each subscription
sequentially. An awaiting handler delays subsequent invocations of that
subscription; unrelated subscriptions may continue, subject to state commit
serialization. No implicit debounce, dropping, cancellation of earlier events,
or parallel handler execution is allowed.

Programmatic sources expose effectful `emit` alongside DOM sources. Outside a
batch, emission participates in normal ordered event processing. Inside a batch,
directly connected folds and their supported synchronous event transformations
must participate in the owning fiber's staged commit. An emission affecting two
folds must not expose one fold's new state alongside the other's old state.
Process staged emissions in emission order, applying each reducer to its latest
staged state. Emitting several events may still yield one public state change.

The event composition layer must retain enough source/commit information for
this behavior. Do not implement transactional emission solely by publishing into
a PubSub and hoping independently forked consumers join the batch. Ordinary
Effect streams remain usable, but an arbitrary asynchronous stream round-trip
does not inherit transactional participation: its later fold input is a separate
update. Make this distinction explicit in API types or named adapters.

General effectful handlers execute separately from a publishing batch and
are not part of its atomic state transition. Publish their staged event
occurrences after a valid commit, in order, including events whose folds made no
state change. If the candidate commit is rejected or discarded on disposal,
discard its staged emissions too. The special same-fiber fold propagation path
is framework work, not permission for application child fibers to write.

## Folds, handlers, and failures

The counter uses the event-folding approach: fold tagged actions into a
read-only count signal using a synchronous pure reducer. Effectful work belongs
in stream processing or managed handlers, not reducers or derived calculations.
Writable signals also remain available for direct effectful updates and batching.

A managed handler subscription reports each failed invocation through the
application error handler and continues with the next event. A failed fold
transition reports the failure, retains the last committed state, and proceeds
to the next input. Failure must not poison the event queue. Earlier completed
writes in a non-batched handler remain committed if later work fails; handlers
are not implicitly batched.

A failure of the upstream stream itself terminates that subscription after
reporting. It cannot generally be resumed without loss or replay. Place
recoverable per-event effects inside the managed handler or explicitly recover
inside upstream operators. Other subscriptions continue. Normal stream
completion stops the subscription and leaves a folded signal at its last value
until owner disposal.

Extend existing error metadata with honest reactive operation and occurrence
context: identify the owning component occurrence and relevant source,
subscription, or commit where applicable. Preserve Effect causes and multiple
failures. A throwing application error reporter must not stop subsequent event
processing. Directly evaluated public operations expose typed errors where
appropriate; supervised processing reports failures once rather than both
swallowing them and reporting duplicates. Expected disposal interruption is not
an application failure.

## Ownership and DOM integration

A child can consume an ancestor's signal. Unrelated component owners cannot
share signals, event sources, or reactive construction bindings in this
iteration. Deriving or binding a foreign signal fails before disturbing installed
content. No application-global state API is required. Closures may pass ancestor
signals to child definitions without introducing a new component-props system.

Accept `Signal<string>` in `he` children alongside strings, nodes, and component
definitions. Do not extend `h` to accept reactive content or change component
output to return signals. Numeric state uses an explicit derived string signal.
Keep existing static attributes and properties unchanged.

Each reactive child occupies one text node. Assign text literally, never through
HTML parsing, and update that node in place. Preserve neighboring nodes, event
listeners, and component occurrences. Reusing a signal in several text positions
creates separate text nodes observing the same state.

Construction samples an initial value. Activate live text bindings when their
tree is adopted, refreshing to the latest committed value without a lost-update
window. Constructed but unadopted trees must not acquire permanent live
subscriptions. Bindings belong to the installed tree's lifetime as well as its
issuing owner: replacing a native subtree stops its bindings even if the owner
remains active. Account for reactive text in existing tree validation,
reservation, ownership, and disposal without treating text-value updates as
structural mutations.

Disposal stops event ingress and subscriptions, interrupts owned processing,
discards pending work, and prevents new reactive DOM changes before finalizers.
Preserve existing descendant-before-owner cleanup and attached-DOM cleanup
semantics. Retained signal/source handles fail clearly after their owner is
disposed; they do not silently restart work. Direct external DOM removal still
does not trigger cleanup.

## Counter example

Keep the welcome heading and paragraph and add two occurrences of one reusable
Counter definition. Each starts at zero, allows negative numbers, increments and
decrements by one, and resets to zero. Use native buttons with `type="button"`
and visible accessible names Increment, Decrement, and Reset. Group each counter
with its own visible count so the two instances are distinguishable in tests.

The intended authoring flow is:

```text
Counter.setup:
  create increment, decrement, and reset buttons with he
  acquire each button's click stream
  synchronously tag and merge actions in browser dispatch order
  count = acquire fold(actions, initial 0, pure action reducer)
  label = acquire derive(sources { count }, count => String(count))
  return a container constructed with he whose children include
    label, increment button, decrement button, reset button
```

Use Match for exhaustive action handling. Setup runs once; clicks update state
and text without rerunning setup or replacing the component. Reset at zero
remains an event but produces no count notification. Mounting a fresh occurrence
starts again at zero. No persistence or counter configuration API is required.

## Acceptance criteria and verification

- Both counters start at zero and independently increment, decrement below zero,
  and reset. Existing welcome content remains.
- Counter setup runs once and text-node and button identities survive updates.
- Rapid mixed button events, including reset, fold in browser dispatch order
  without startup loss or dropped events.
- Writable updates serialize without lost increments. Reads and mutation are
  Effects; folded/derived signals have no writable capability.
- Derived chains and diamonds expose only consistent snapshots. The x/doubled
  and a/b examples above pass for composed observations and rendered text.
- Default and custom equality retain previous equal values and suppress only
  state propagation, including a batch returning to its initial state.
- Signal observation acquisition has no initial-read/subscription gap.
- Async batches expose staged values only to their owning fiber; external reads
  see the latest committed state and independent writers proceed. Nested batches
  flush once. Conflicting batches roll back without replaying their bodies.
- A body failure, interruption, reducer failure, or derivation/equality failure
  discards every staged write and emission, preserves the previous committed
  state and DOM from other successful commits, and publishes no notifications.
  A failed nested batch invalidates the outer batch even when caught.
- Owner disposal discards pending batches and emissions and prevents late DOM
  updates, including while cleanup is awaiting completion.
- Child-fiber writes/emissions with an inherited batch context fail promptly;
  async read-only work and same-fiber writes after awaits succeed.
- Programmatic emission can update multiple folds atomically, preserves every
  event occurrence, and distinguishes transactional composition from ordinary
  asynchronous Effect stream processing.
- An awaiting handler processes later events sequentially. A failed invocation
  is reported once and the next event runs; failed upstream streams terminate
  only their subscription. Reporter exceptions cannot stall processing.
- Listeners, queued events, folds, observers, and bindings clean up on replacement,
  setup failure, and disposal. Unadopted construction does not leak bindings.
- Ancestor-to-child consumption succeeds; unrelated ownership and disposed
  handle use fail clearly without altering live content.
- Type coverage rejects incorrect event payloads, reducer results, derived
  inputs, non-string reactive children, and writes to read-only signals.
- Existing static construction and lifecycle tests continue to pass.

Use deterministic gates, queues, and explicit subscription readiness for
concurrency verification, never timing-dependent sleeps. During implementation,
run relevant Budgerigar tests and `pnpm fmt`, `pnpm lint`, and `pnpm typecheck`.

This change is a specification only. Runtime implementation and its verification
follow separately.
