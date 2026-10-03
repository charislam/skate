# Budgerigar

An experiment in scoped DOM composition using Effect. Run `pnpm dev:budgerigar`
from the repository root, or `pnpm --filter @charismaticalli/budgerigar test` for
its tests.

`component({ setup })` defines a reusable component. Setup runs once per
occurrence and returns a fresh native node or a readonly array of roots (including
an empty array). Setup can await Effect work.

The context provides:

- `he(tag, options?)` to return an Effect that constructs a detached HTML element.
  Validation failures use the typed `ConstructionError` channel. Options
  contain static `attrs`, writable native `props`, and ordered `children` consisting
  of strings, nodes, or component definitions. Attributes precede children, and
  properties are assigned last. Strings become literal text nodes.
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
