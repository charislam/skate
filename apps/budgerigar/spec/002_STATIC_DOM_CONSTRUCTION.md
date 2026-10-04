# Budgerigar: static DOM construction and mixed children

The attribute-value rules in this historical specification are superseded by
`004_REACTIVE_ATTRIBUTES_AND_PROPERTIES.md`: current attributes require
`Option<true | string>` (or a signal of that type), with `None` removing an
attribute. Wholly static attribute/property precedence remains unchanged.

## Purpose and scope

Add Effect-based static HTML construction through `he` and extend `h` to replace a
target with constructed nodes. Native elements and components must compose in
both directions, including components between native siblings without wrapper
elements. Preserve the welcome page's content and presentation.

This specification extends `001_INITIAL_FRAMEWORK.md`. Its whole-element mounting
semantics continue to apply unless refined below. In particular, this spec
supersedes its rule that later requests wait for earlier setup to finish:
replacement may now cancel pending setup, including for a single component.
Add no runtime dependencies. Reactive inputs, event handlers, SVG, custom
elements, JSX, HTML parsing, and a public region-replacement API are out of
scope.

## Public API

Each component's setup context provides an owner-bound `he` alongside its existing
`h`, `scope`, and `fork`. `he` is not an ambient global constructor. Bootstrap can
continue acquiring `h` through `mounting` and calling `h(root, Home)`; changing
that acquisition API is unnecessary.

The API has these conceptual signatures; precise supporting TypeScript types
remain implementation choices:

```ts
he<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: ElementOptions<K>,
): Effect.Effect<HTMLElementTagNameMap[K], ConstructionError>

type MountItem = Component | Node;

h(parent: Element, content: MountItem | ReadonlyArray<MountItem>): void
```

`he` returns a lazy Effect that creates a fresh, detached native element when
evaluated. Each successful evaluation creates a new element. Construction runs without
asynchronous work and fails through the typed `ConstructionError` channel. Tag
inference must retain the specific success type, such as `HTMLInputElement` for
`"input"`. Support known HTML tags only. Use Option for internal optional state
according to repository conventions; omission of the public options argument means empty options.

`h` always means replacement of all children of its target. It submits work to
the existing per-parent queue and returns immediately, with no completion value.
It accepts a component definition, a single constructed node, or an ordered
readonly array mixing constructed nodes and component definitions. An array is
one replacement request, not a sequence of replacements. An empty array clears
the target after cleanup. Single items are equivalent to one-item arrays,
including their setup, cancellation, failure, and cleanup behavior. It does not
accept strings or nested arrays; text at this boundary must be a text node.
Snapshot the array's membership at submission so later caller mutation cannot
change the queued request. Component setup output remains nodes only; this does
not extend `Output` to include component definitions.

Both helpers belong to their issuing context. Calls to `h` after owner disposal
remain ignored, as in the existing API. Evaluating a construction Effect after
owner disposal fails with a descriptive `ConstructionError`, including Effects created
before disposal but evaluated afterward.

## Authoring examples

Migrate Home to this shape:

```ts
export const Home = component({
  setup: ({ he }) =>
    Effect.gen(function* () {
      return yield* he("main", {
        children: [
          yield* he("h1", { children: ["Budgerigar"] }),
          yield* he("p", { children: ["Welcome home."] }),
        ],
      });
    }),
});
```

Components can appear directly between native siblings:

```ts
const Parent = component({
  setup: ({ he }) =>
    Effect.gen(function* () {
      return yield* he("main", {
        children: [
          yield* he("h1", { children: ["Title"] }),
          Child,
          yield* he("p", { children: ["After the child"] }),
        ],
      });
    }),
});
```

The same context can also request explicit native or mixed replacement:

```ts
Effect.gen(function* () {
  h(target, [
    yield* he("h2", { children: ["Updated title"] }),
    Child,
    yield* he("p", { children: ["Updated body"] }),
  ]);
});
```

## Element options

Options contain separate optional `attrs`, `props`, and `children` fields. They
accept static values only. Do not introduce placeholder signal types or reactive
subscriptions in this iteration.

### Attributes

`attrs` maps HTML attribute names to strings or booleans. Use `setAttribute` with
the supplied HTML name, including `class`, `for`, `data-*`, and `aria-*` names.

- A string sets that exact value, including the empty string.
- `true` sets an empty attribute.
- `false` omits the attribute.
- Numbers, null, undefined, and object values are not supported attribute values.

Boolean shorthand always means presence or absence, regardless of the attribute
name. For example, use `"aria-expanded": "false"` to retain an explicit false
ARIA value; boolean `false` would omit it. Do not stringify boolean false.

Event-handler attributes such as `onclick` and the HTML-parsing attribute
`srcdoc` are outside this API and must be rejected.

### Properties

`props` assigns native DOM properties using their JavaScript names and types.
Infer the allowed properties from the selected tag. Include writable data
properties such as input `value`, `checked`, and `disabled`; exclude readonly
properties and methods. Do not expose an unrestricted string index signature or
use `any` as the property-value contract.

Exclude event-handler properties, `innerHTML`, `outerHTML`, `textContent`,
`innerText`, `outerText`, and `srcdoc`. These either introduce deferred features
or conflict with structural construction through children. Property assignment
is shallow native assignment, not recursive object merging. A style object API
is not included; a static `style` attribute remains available.

Permit both attributes and properties for the same underlying field. For
example, an input's `value` attribute and `value` property can express different
default and current values.

Apply construction in this order:

1. Create the element and apply attributes.
2. Construct and append children in order.
3. Assign properties.

Properties are assigned during evaluation of the construction Effect. This makes
a select's static option children constructed with `he` available before assigning its
`value`. Children supplied as component definitions mount later, so properties
that depend on those children may not produce the intended result. For example:

```ts
Effect.gen(function* () {
  return yield* he("select", {
    props: { value: "banana" },
    children: [AsyncOptions],
  });
});
```

When `value` is assigned, `AsyncOptions` has not produced any option elements, so
the browser cannot select the intended option at that point. Adding those options
later does not guarantee that `"banana"` becomes selected. This timing distinction
applies even when the child component's setup Effect is synchronous: `he` defers
all component setup until adoption.

This iteration provides no deferred property assignment. The framework does not
remember and replay assignments when component children finish mounting. Such
replay would need separate rules for multiple children completing at different
times and could overwrite changes made by the user in the meantime. Use native
browser behavior for valid property assignments; do not add implicit coercion
or synchronization between the attribute and property bags.

### Children

`children` is an ordered readonly array of strings, native nodes, or component
definitions. Do not accept nested arrays, numbers, booleans, null, or undefined
as children in this iteration. There is no separate `text` option.

Each string creates a text node, including strings containing HTML-like text.
Each supplied native node is appended directly. Each component occurrence
reserves an independent region at its exact position in the array. Reusing a
component definition produces fresh component instances; it does not reuse DOM.

## Component regions and adoption

Represent component positions with paired comment anchors. Components may return
zero, one, or multiple roots; all their rendered roots occupy the space between
their anchors. Do not introduce visible wrapper elements. Comments are framework
bookkeeping, not part of a component's returned roots.

Creating or evaluating a construction Effect must not start component setup.
Evaluation records deferred component occurrences and constructs the native
portion of the tree. A tree that is constructed and discarded starts no
component work and acquires no child component scopes. Keep metadata associated
with nodes without retaining discarded trees indefinitely in an owner-wide
collection.

Adoption occurs when either:

- A component successfully returns its output and the runtime accepts that output
  for insertion.
- A queued `h` replacement reaches insertion after previous cleanup.

Before mounting, validate all supplied roots and their descendants as one group.
If any part is invalid, reject the whole group without inserting its nodes or
starting its components. Once accepted, attach the native tree and activate its
deferred regions through the runtime. Each region starts its component exactly
once in an independent child scope. A containing component's completion does not
await its regions' setup. Native siblings can appear while a child is pending,
and independently progressing children must retain their reserved DOM order
regardless of completion order.

The context that constructed a tree containing regions must also be the context
returning that tree or submitting it through `h`. Reject transfer to another
context, even when the contexts are related. A component's own bound `he` is the
correct constructor for its returned output; the external caller's `h` adopting
that component's successful output is normal mounting, not an ownership transfer.
Component definitions remain freely reusable.

## Replacement and resource ownership

All native and component replacement requests share the same per-parent queue.
Native replacements must not bypass the queue. For each valid request:

1. Validate the complete request before disturbing the current installation.
2. Deactivate the current installation so none of its pending setups can insert
   late output. Interrupt its pending setup and owned background work throughout
   the subtree, then await descendant and component cleanup.
3. Remove old content, retaining the existing attached-DOM-during-cleanup rule.
4. Install the new native nodes and component region anchors in array order.
   Activate deferred regions within native trees and start each direct component
   occurrence in its own scope, independently of sibling setup completion.
5. Release the queue to process the next request without awaiting setup success
   or failure of these components or their descendants.

Every component occurrence, including a standalone `h(parent, Component)`, uses
the same region model. Each successful setup inserts into its reserved position.
A slow component does not delay sibling setup or prevent native siblings from
appearing. One failed component leaves its region empty and preserves siblings.

Preserve accepted request installation order; do not debounce or coalesce queued
requests. There is no guarantee that an intermediate installation paints or that
its setup completes. Give each installed component its setup invocation, but do
not wait for that Effect to finish or make any specified amount of progress
before allowing replacement. Scheduling must not serialize sibling setup on
asynchronous completion. Requests discarded by owner disposal need not start.

For example, both of these forms permit `Next` to interrupt pending `Slow` setup:

```ts
h(parent, Slow); // Equivalent to h(parent, [Slow]).
h(parent, Next);
```

Slow setup therefore no longer blocks the queue, but cleanup still does. Once
replacement starts cleanup, later submissions cannot interrupt or skip that
cleanup. Uninterruptible setup work can also delay cancellation; no timeout or
forced abandonment of owned resources is introduced. Different parent queues
continue to progress independently.

A replacement group needs no synthetic component definition or component setup.
It does need an owned replacement record so direct component regions and any
regions inside its native nodes are disposed before removal. Ownership must track
both the issuing context and the installed replacement's lifetime: a later
replacement disposes its regions even while the issuing context remains alive.

Disposing an enclosing component, replacement group, or application owner must
cancel pending child setup, interrupt owned work, await descendant cleanup, and
prevent late insertion. Preserve child-before-parent cleanup and existing
old-DOM-during-cleanup behavior. Remove region anchors when their containing
installation is removed. No finalizer may execute twice.

An inline component cannot replace siblings outside its region. Its own explicit
`h` calls still target ordinary elements and follow existing target ownership
rules.

## Node validity and reuse

Accept insertable element and text nodes, and ordinary comment nodes. Reject
Document, DocumentType, DocumentFragment, and framework-owned region anchors as
explicit content. DocumentFragment has consuming insertion semantics that would
make this iteration's root and ownership guarantees ambiguous.

Require supplied children to be detached when the `he` Effect is evaluated.
Require native roots submitted to `h` to be detached at submission and validate
them again before insertion. Successful component output must likewise have
detached roots. Children already attached inside a freshly constructed root are
expected; the detachment rule applies to roots at each composition boundary, not
every node in their descendant tree.

Reject duplicate node references, overlapping roots, previously adopted nodes,
already-reserved replacement roots, foreign-owned region trees, and invalid or
tampered region boundaries. An accepted queued submission reserves its nodes so
they cannot be submitted again while detached. Treat submitted trees as consumed:
callers must not reparent, mutate their structure, or reuse them after submission,
including requests discarded by disposal. Create fresh trees for new requests.

Preflight an entire children array before appending supplied nodes so a duplicate
or parented child cannot partially move valid siblings. Likewise, validation of
a replacement, including every native member of a mixed array, must finish before
cleanup of the currently installed view. An invalid member rejects the entire
request before any of its component definitions start setup. Repeating the same
component definition is valid and creates distinct occurrences; the duplicate
restriction applies to native nodes.

A failed revalidation leaves that view installed and permits later queued work.
Never repair invalid input by moving nodes out of another view.

Direct external DOM removal still does not trigger cleanup. Validating inputs
does not require a MutationObserver or continuous monitoring of external changes.

## Failure handling

Construction validation failures use `Effect.fail` with a typed
`ConstructionError`; validation helpers likewise return Effects rather than
throwing. When evaluated during setup, failures follow existing setup-failure
cleanup and reporting. Preflight validation is required, but rollback of
arbitrary native property-setter side effects is not guaranteed.

`h` remains a void, fire-and-forget API. Report invalid replacement submissions
and queued revalidation failures through the inherited error handler, preserving
the Effect cause. Invalid submissions do not clear existing content or stall
later requests. Owner disposal continues to discard requests without expected
cancellation errors. Interruption caused by a later valid replacement is also
expected cancellation, not a setup failure. Genuine cleanup failures still reach
the handler. Invalid requests do not cancel a currently pending valid setup.

A region's component setup failure cleans up that attempt and leaves only its
empty region anchors. This applies equally to direct components in a mixed
replacement, standalone component replacements, and components nested through
`he`. Report it without failing the enclosing component or
removing siblings. Failure of an enclosing setup or disposal still cleans all
resources owned by that enclosing attempt. No automatic child retry is required.

Extend failure metadata to represent native replacements and component regions
honestly: include a discriminated subject/target identifying a replacement group
or a particular component occurrence and its region as appropriate. Repeated
uses of the same component definition must be distinguishable. Add a validation
operation. Do not invent dummy component definitions merely to satisfy the
existing `component` field. Preserve the current lifecycle operation
distinctions, original causes, and resilience to an error reporter throwing.

## Acceptance criteria

- Home renders the unchanged welcome page using `yield* he` calls without direct
  element or text-node construction.
- Tag-specific return and property types are retained. Type checks reject
  unsupported tags, invalid property values, readonly properties, methods,
  structural properties, and event-handler properties.
- Attribute strings and boolean presence shorthand work; an explicit ARIA string
  `"false"` remains present. HTML-like child strings render as literal text.
- Construction order supports default/current input values and selecting a value
  after static options have been appended.
- Mixed children preserve order with native nodes, text, and components returning
  zero, one, or several roots, without wrapper elements.
- Constructing a discarded tree never starts nested setup. Adoption starts each
  occurrence once, and reuse of a component definition creates independent scopes.
- Controlled asynchronous child completion preserves sibling order. Child failure
  leaves its region empty and preserves its enclosing component and siblings.
- Native and component replacements interleave in the same queue, awaiting old
  cleanup and preserving accepted installation order. Empty arrays clear it.
- Heterogeneous arrays install native nodes and independent component regions in
  order as one replacement. Repeated component definitions get separate scopes.
- Single components and one-component arrays have identical lifecycle semantics.
  A subsequent request cancels pending setup, awaits acquired-resource cleanup,
  and installs its content without waiting for the previous setup's success.
- Cancellation prevents stale output, including late completion after interruption.
  Expected replacement interruption is not reported as setup failure.
- Invalid mixed requests start no components and preserve the active installation,
  including its pending setup. Array membership is captured at submission.
- Sibling setup proceeds independently, sibling failure is isolated, and replacing
  a group cleans every member before the next installation starts.
- Replacing a native tree disposes its inline components, including pending setup
  and background work. Owner disposal prevents late region insertion.
- Duplicate, overlapping, parented, reused, reserved, and foreign-owned inputs
  are rejected without stealing nodes or clearing the currently installed view.
  Revalidation catches nodes reparented while queued.
- Existing component mounting, ownership, failure recovery, and cleanup ordering
  coverage remains, updated for region anchors, failure metadata, and the explicit
  change from setup-blocking queues to replacement cancellation. Replace the old
  assertion that slow setup blocks later requests with cancellation coverage;
  retain the assertion that slow cleanup blocks later installation.

During implementation, use deterministic completion gates for asynchronous
tests. Run the relevant Budgerigar tests and `pnpm fmt`, `pnpm lint`, and `pnpm
typecheck`. This change is a specification only; implementation and its
verification follow separately.
