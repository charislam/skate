# frappé: keyed dynamic lists

## Purpose and agreed scope

Extend specifications 002–006 with dynamic lists of component occurrences.
Reconcile immutable array snapshots by explicit key and stable row descriptor.
Retained rows receive changing data without recreating their component state.

The requirements discussion settled these behaviors:

- Keys are strings or finite numbers, unique across one list regardless of row
  type. Invalid keys, duplicates, and throwing selectors reject the whole update.
- Identity is the pair of key and row descriptor reference, scoped to one mounted
  list occurrence. A different descriptor under the same key replaces the row.
- Retained rows receive read-only item and zero-based index signals. Their updates
  participate atomically in the source transaction.
- Reordering preserves DOM, local state, focus, caret, fallback, and pending setup.
- Removing a row disposes it immediately. Reinsertion creates a fresh occurrence;
  there is no cache or transfer of occurrences between lists.
- Row failures are isolated. A committed item change retries a failed row with
  fresh state; index-only changes do not. Removal/reinsertion or descriptor
  replacement also creates a fresh attempt.
- Demonstrate add, edit, complete, delete, and accessible move buttons with todos.
  Preserve an unsaved local edit through reorder.

This is a specification, not a runtime implementation. Drag-and-drop,
virtualization, exit animations, automatic async request restarts, cross-list
identity, and a dedicated empty-list API are outside this version.

## Public construction contract

Introduce an inert reusable `Row<A>` descriptor and an inert `KeyedList<A>`
description. Use the following public API shape; concrete branding and internal
storage are implementation details:

```ts
type Key = string | number;

interface RowInputs<A> {
  readonly key: Key;
  readonly item: Signal<A>;
  readonly index: Signal<number>;
}

row<A>(): <EFactory = never, ESetup = never, EFallback = never>(
  factory: (options: {
    readonly context: SynchronousContext;
    readonly inputs: RowInputs<A>;
  }) => Result.Result<Lifecycle<ESetup, EFallback>, EFactory>,
) => Row<A, EFactory, ESetup, EFallback>;

keyed<A>(options: {
  readonly items: Signal<ReadonlyArray<A>>;
  readonly key: (item: A) => Key;
  readonly row: (item: A) => Row<A>;
}): KeyedList<A>;
```

These declarations describe signatures rather than executable TypeScript. The
only valid constructor signature is `row<Todo>()(factory)`. Use it to specify
the item type while retaining inferred callback errors: TypeScript cannot infer
remaining generic arguments after explicitly supplying the first. Reject the
uncurried `row(factory)` and `row<Todo>(factory)` signatures. Export the public
constructors and types from the framework entry point. Preserve lifecycle error
types in descriptors; do not require application casts or erase callback errors
merely to unify heterogeneous descriptors.

The row factory follows `component(factory)`: it runs synchronously once for each
committed occurrence, returns a Result containing setup and optional fallback,
and receives the usual synchronous capabilities through `context`. Setup and
fallback close over `inputs`. Their output and resource ownership obey spec 006.
The descriptor is the row's component type; it is not a caller-provided string
token or the identity of a fresh per-item component wrapper.

Selectors are pure synchronous functions of the candidate item. They must not
allocate resources, write signals, construct DOM, or create a new row descriptor
on each call. They may run during validation more than once; do not promise a
call count. Capture each successful validation's keys and descriptors in its
reconciliation plan so the application phase does not reevaluate selectors.
Use exhaustive `Match` for variant selection. A single-type todo list returns
one stable descriptor from its selector.

Accept `KeyedList` wherever a component mount item is accepted: `he` children,
`h` content, fallback output, setup output, and mixed output arrays. Do not infer
keyed behavior from arbitrary array signals or broaden output to nested arrays.
Every mounted use of a description has independent row occurrences and signals.
Native constructed trees retain their existing single-use rules.

Construction validates issuer access and the current snapshot without invoking
row factories, installing subscriptions, or starting setup. Adoption revalidates
and uses the latest committed snapshot without a read/subscription gap. A live
issuing owner is required; ancestor-only signal access rules remain intact.

## Keys, data, and identity

Use string equality and numeric equality equivalent to Map keys: `1` and `"1"`
are distinct, and `0` and `-0` identify the same key. Reject NaN, infinities,
objects, symbols, null, and undefined. Empty strings are valid. Validate duplicate
keys across the complete snapshot, even when their selected descriptors differ.
Changing an item's key means removing the old identity and adding a new one.

For each candidate key:

| Previous entry                    | Candidate descriptor | Action                                             |
| --------------------------------- | -------------------- | -------------------------------------------------- |
| Absent                            | Any valid descriptor | Create a fresh row occurrence                      |
| Live (ready or pending)           | Same reference       | Retain and update item/index; move if needed       |
| Failed, item unchanged            | Same reference       | Keep empty slot; move if needed                    |
| Failed, item changed              | Same reference       | Create a fresh row occurrence                      |
| Present                           | Different reference  | Dispose previous occurrence and create a fresh one |
| Present, but candidate key absent | None                 | Dispose previous occurrence                        |

Retain item/index signal objects for the complete row occurrence lifetime.
Use `Object.is` for item equality and numeric equality for index. A replacement
item object updates the item signal even if its fields happen to match; reordering
the same object changes only its index. Changed source arrays with the same
entries, order, and descriptors cause no lifecycle work or redundant DOM moves.
Honor the source signal's equality policy: a suppressed write does not reconcile.
For failed rows, a changed item under this same equality rule requests a fresh
attempt. Rebuilding objects while sorting can therefore retry failed rows even
when their fields are unchanged; moving the same objects cannot.

Inputs are immutable snapshots by contract. Mutating an array or item in place
does not produce reactive updates and is unsupported. Capture the candidate
array's sequence for validation and application; deep cloning/freezing is not
required. Row inputs expose no writable methods. Actions update parent-owned
state by stable key; a captured index must not be used as item identity.

Filtering a row out is removal. A later return, including while old asynchronous
cleanup is pending, allocates fresh state and signals. A committed remove followed
by a committed reinsert creates a new occurrence even if setup never got to run.
A remove/reinsert staged within one batch whose final snapshot preserves the
identity causes no disposal.

## Ownership and atomic reconciliation

Each list occupies a comment-delimited region with no visible wrapper. Each row
has an independent anchored region supporting empty and multiple-root output,
nested lists, reactive selections, and asynchronous fallback-to-ready replacement.
Static siblings and other regions retain their identity and relative order.

Give each row an internal input lifetime that is an ancestor of its component
occurrence and descendant of the list owner. Its item/index signals share the
application coordinator and are accessible to the row, fallback, and descendants.
They are inaccessible to sibling rows and enclosing user contexts under the
existing directional ownership rules. Retiring a row deactivates its inputs as
well as component resources; remove all associated dependencies and bindings.

Reconciliation participates in transaction preparation, not a subscription that
performs a second commit. Before installing state, validate the candidate array,
all keys and descriptors, and affected retained-row derivations and DOM bindings
against candidate item/index values. Include dependencies on other changed parent
signals in the same snapshot. A validation error aborts the entire transaction,
preserving source state, input values, DOM order, and pending setup authority.
Initial invalid construction uses ConstructionError; adopted update validation
uses ReactiveError. Adoption failures use the existing mount reporting path.

Prepare affected nested lists in dependency order. A nested region being retired
by this transaction must not create new occurrences or start work while its
ancestor is removed. Do not implement inputs as independent writable signals
updated one at a time during the DOM flush.

For a valid commit:

1. Install source values and all retained item/index values together. Establish
   initial input values for new rows before their factories run.
2. Revoke outgoing rows' adoption authority and deactivate bindings, ingress,
   inputs, and owned work. Run synchronous finalizers descendants-first and in
   reverse registration order per owner while outgoing DOM remains attached.
3. Detach outgoing rows, arrange retained regions in candidate order, and create
   new regions. Invoke new factories and install their synchronous fallbacks as
   specified by spec 006. Retained factories and fallbacks do not rerun.
4. Finish affected ordinary DOM bindings and nested structural bindings before
   publishing signal observations. All observable committed input snapshots and
   final DOM ordering agree; no observer sees a new item with an old index.
5. Start eligible setup and other deferred work outside the commit. Track retired
   asynchronous cleanup without delaying new rows or completion of the write.

Do not promise ordering among independent sibling factories/finalizers or async
setup completions. Preserve descendant-before-owner cleanup. Reentrant user
commits from factories or synchronous finalizers remain forbidden. Callback
failures after state installation report without rolling back committed state.
Writes return after synchronous reconciliation, not after setup or cleanup.

New-row factory failures occur after commit and are isolated, unlike selector or
retained-binding validation errors discovered during preparation. Aborted and
conflicting batches invoke no factories/finalizers and cancel no pending setup.
Only affected lists reconcile; lookup by key must avoid quadratic key matching.
No minimum number of native move operations or particular diff algorithm is
required, but unchanged regions must not be needlessly moved.

## Reordering and browser state

Move existing row regions rather than reconstructing their native nodes. Preserve
node identity, listeners, local state, input editing buffers, the focused element,
and text input/textarea selection range and direction when a retained row moves.
Do not write input properties merely to restore list order. A move runs no mount,
unmount, factory, fallback, setup, or cleanup callback.

Choose and document a browser-compatible move strategy that meets the focus and
caret contract. Native node identity alone is insufficient evidence of focus
preservation. If the implementation needs focus/selection restoration, avoid
scroll jumps and publishing synthetic user edits. The guarantee concerns a move;
deliberate application changes that disable, hide, remove, or refocus the control
retain their ordinary behavior. No new guarantees for iframe/media/custom-element
lifecycle state are introduced by this version.

Pending rows move their current fallback and anchors together. Setup continues
once and adopts into the row's current position, regardless of its start position
or completion order. An explicit read in setup is a snapshot: input updates do
not automatically restart a request. Bindings created after suspension read the
latest committed signals at adoption.

## Failures, removal, and shutdown

Use the existing factory, fallback, setup, reactive DOM, and cleanup reporting
operations and preserve original causes. Include list occurrence identity, key,
and descriptor identity in row error context so equal keys in different lists
are distinguishable; retain the concrete parent/occurrence information required
by existing mount failures.

Factory or setup failure empties only that row's region and retires its resources.
Retain an inert failed identity record with the last committed item value for
reconciliation, not live row signals or component resources. A subsequent
committed item change under `Object.is` creates a fresh attempt under the same
key and descriptor. Allocate new input signals, local state, factory, fallback,
and setup; never resume the finalized occurrence. Initialize inputs with the
newly committed item and current index. Descriptor replacement or a committed
removal followed by insertion also creates a new attempt.

Allow at most one attempt per committed item change. If it fails again, retain
the new committed item in the failed record and wait for another qualifying
change. Index-only changes, unchanged item references, and source writes
suppressed by equality do not retry. Aborted/conflicting transactions and a batch
ending with the previous item value cause no retry. Validate the entire candidate
list before starting any retries; a rejected update preserves failed records too.

Healthy and pending rows still receive item updates without restarting their
factory or setup. If an item changes during pending setup and that setup later
fails, record the latest committed item at failure and wait for the next item
change. Do not retrospectively retry because the setup started with older data.
Old asynchronous cleanup may overlap a fresh attempt; retired work must not
adopt into or remove the replacement's DOM.

Failed slots still occupy their position in list indexing, even with no visible
output. Fallback failure continues setup with empty pending content, as in 006.
Background and individual DOM assignment failures retain existing policies.

Removal cancels pending setup and owned work before synchronous finalizers and
detachment. Skip deferred setup if removal occurs before it starts. Late or
uninterruptible completion cannot insert nodes, remove newer content, or revive
an old identity. Cleanup executes exactly once. Exceptions in cleanup or the
reporter do not prevent other rows from reconciling.

Disposing the containing tree or application stops the list binding and retires
all live rows. Application shutdown awaits asynchronous cleanup of active and
already-retired rows. Removing one list does not dispose its ancestor source
signal or another occurrence of the same description. External structural DOM
mutation remains unsupported and does not automatically dispose resources.

An empty snapshot leaves only list anchors. Compose an empty-state component
through existing derivation and selection APIs; its visibility changes in the
same source transaction. No dedicated list empty-state callback is added.

## Todo demonstration

Add a home-page todo example with immutable records containing stable generated
IDs, saved text, and completion state. Never derive IDs from position or text.
Provide labeled controls to add, save an edit, toggle completion, delete, and
move a todo up/down. Use native buttons with `type="button"` except an intentional
form submit control. Disable boundary moves using the current index and length.
Display a position derived from the zero-based index signal.

Each row creates its own writable draft text in its factory, initialized from
the item snapshot. Bind the edit input to this draft. Typing is local until Save
updates the parent record by key; incoming saved data does not silently overwrite
an unsaved draft. Saved text and completion UI derive from the read-only item
signal. Reordering preserves both draft and caret. A move-button click follows
normal browser focus behavior; independently verify reordering an actively edited
row through a programmatic update while focus remains in its input.

Show an empty message through existing selection helpers. Keep a stable row
descriptor within the parent occurrence, closing over parent actions/signals.
Document that allocating descriptors in the selector remounts rows. The demo need
not invent multiple todo types; tests exercise descriptor replacement separately.

## Implementation and acceptance

Implement descriptors and construction support, then transaction-aware input
preparation and keyed region reconciliation, then lifecycle/error integration,
browser focus preservation, and the demo/documentation. Share occurrence and
cleanup primitives with existing components instead of introducing a second
lifecycle implementation. Follow repository conventions and consult vendored
references without modifying or importing from them.

Acceptance coverage must include:

- Append, prepend, middle insertion/deletion, reverse, arbitrary reorder, clear,
  multiple-root/empty rows, static siblings, nested lists, and duplicate mounts.
- Same key/descriptor with a new item preserves local state and updates bindings;
  descriptor changes replace only that row; changed keys create fresh state.
- String/number distinction, signed zero collision, invalid numbers/types,
  duplicate keys across descriptors, throwing selectors, and invalid descriptors.
  Rejection leaves the entire transaction and pending rows unchanged.
- Consistent item/index/parent snapshots through combine, derivations, DOM, and
  observations, including retained-binding validation failures and nested lists.
- Aborted/conflicting batches and transient staged removals cause no lifecycle
  work; committed removal/reinsert during cleanup creates a new occurrence.
- Reorders invoke no lifecycle callbacks, and preserve node identity and drafts.
- Pending rows reorder and update their fallback bindings without restarting
  setup; completion adopts in current order; removed late completions cannot adopt.
- Failed-row isolation and empty slots; changed items retry with fresh state and
  current inputs, including new objects with equal fields. Index-only changes and
  identical item references do not retry. Repeated failures allow only one attempt
  per committed change; aborted/conflicting batches and batches ending at the old
  item do not retry. Invalid candidates leave failed records untouched.
- Item changes during pending setup do not restart it or trigger a retrospective
  retry after failure. A later item change retries normally. Retired cleanup can
  overlap retries without affecting their DOM. Explicit identity rearming,
  fallback failure recovery, and throwing error reporters remain covered.
- Attached-DOM synchronous finalizers, exactly-once cleanup, nonblocking retired
  async cleanup, shutdown waiting, ownership rejection, and no retained observers
  after repeated add/remove cycles or disposal of a never-ready row.
- Type coverage for item inference, readonly inputs, row descriptor compatibility,
  lifecycle error inference, accepted construction positions, and rejected raw
  array signals or invalid selector outputs.
- Todo add/save/toggle/delete/move interactions and empty-state composition.

Use deterministic gates for asynchronous tests, not live network calls. Run the
focused tests, frappé suite, real-browser reorder coverage, and repository
`pnpm fmt`, `pnpm lint`, and `pnpm typecheck` during implementation. Report
unrelated pre-existing failures separately.
