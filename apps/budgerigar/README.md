# Budgerigar

An experiment in scoped DOM composition using Effect. Run `pnpm dev:budgerigar`
from the repository root, or `pnpm --filter @charismaticalli/budgerigar test` for
its tests.

`component({ setup })` defines a reusable component. Setup runs once per mount
and returns a fresh DOM node or a readonly array of roots (including an empty
array). Setup can await Effect work.

The context provides:

- `h(parent, definition)` to enqueue a nested mount and return immediately.
- `scope` to register resource finalizers with `Scope.addFinalizer`. Setup also
  receives this scope as an Effect service, so `Effect.addFinalizer` works.
- `fork(work)` to start background Effect work owned by the component. Use this
  binding for work that must be interrupted before descendant cleanup. It shares
  the component scope for resource acquisition and reports failures to the
  application's error handler.

```ts
const Child = component({
  setup: () => Effect.sync(() => document.createTextNode("Hello")),
});

const Parent = component({
  setup: ({ h }) =>
    Effect.gen(function* () {
      const section = document.createElement("section");
      h(section, Child);
      yield* Effect.addFinalizer(() => Effect.log("Parent disposed"));
      return section;
    }),
});
```

Acquire an application binding with `mounting({ scope, onError })`, then call
`h(root, Parent)`. Keep the application scope alive; closing it awaits disposal.
`bootstrap` does this for the welcome page and requires the existing `#app` root.

Requests for a parent execute in order: await old cleanup, clear all children,
run fresh setup, then append its roots. Other parents progress independently.
Nested mounts may finish after their enclosing component is inserted. Disposal
cancels pending requests and active work, cleans descendants before their owner,
and removes DOM after cleanup. Mount failures include the parent, component,
lifecycle operation, and original Effect cause; an error handler throwing does
not stall the queue.

A target belongs to one live mount context. Requests through another owner are
reported as ownership failures. Components must create fresh nodes; direct DOM
removal does not dispose a component.
