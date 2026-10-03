# Budgerigar: scoped component mounting

## Purpose and scope

Budgerigar is a custom functional reactive programming framework experiment. Its
eventual reactive model will include signals, derived values, and event streams.
This first iteration establishes DOM composition and Effect scope ownership while
preserving the static welcome page. It does not implement those reactive primitives.

Use the existing Effect dependency and browser APIs; add no framework dependencies.
JSX, virtual DOM, server rendering, routing, and reactive inputs to mounting are out
of scope. Component setup and cleanup may both perform asynchronous work.

## Initial page

Currently, `src/main.ts` creates a `<main>`, assigns its `innerHTML`, and appends it
to the body. `index.html` contains no application root.

Add `<div id="app"></div>` to `index.html`. Bootstrap must find this existing root
and fail with a clear error if it is absent. It must not silently create a fallback.
Mount the welcome component into that root using `h(root, Home)`.

The welcome component creates DOM through browser element and text APIs. Its output
remains a `<main>` containing the heading “Budgerigar” and paragraph “Welcome home.”
Do not use `innerHTML` to build this page. Preserve the existing visual presentation.

## Component definitions

Create reusable component objects through `component({ setup })`.

- A component object is a definition, not a mounted instance.
- Each mount invokes setup once and creates independent DOM, state, and scope.
- Setup receives a context containing a scope-bound `h` and access to the owning
  Effect scope for finalizers and background work.
- Setup is represented as Effect work and may await asynchronous operations.
- Successful setup returns one DOM node or an ordered, readonly array of DOM nodes.
  An empty array represents a component with no rendered roots.
- Setup creates fresh nodes for each instance. Sharing mounted nodes between
  instances is unsupported.
- Cleanup is registered through Effect finalizers; a separate component cleanup
  callback is unnecessary in this iteration.

The exact TypeScript generics and context field names can be refined during
implementation. Preserve these lifecycle semantics as the API evolves.

## Mounting API

The public composition operation has the shape:

```ts
h(parent, componentToMount): void
```

`parent` is a DOM Element. `componentToMount` is a component definition created by
`component()`. The operation accepts no signal, stream, or other reactive argument.
It is used for both the initial application mount and nested composition.

Bootstrap acquires an application scope and obtains a bound `h`. Each component
receives its own bound `h` during setup. Scope ownership must be explicit through
these bindings rather than a global ambient “current component.”

Calling `h` submits a mount request and returns immediately with no value. It does
not return an Effect, Promise, mounted instance, or cleanup handle. Completion and
failure are managed by the owning runtime and scope. Returning from `h` does not
mean setup or DOM insertion has completed.

## Per-parent replacement queue

Serialize requests targeting the same parent in submission order. Mount every
queued component; do not debounce, coalesce, or skip intermediate requests during
normal operation. Different parents can progress independently.

For each request:

1. Dispose the previous mounted component's scope, including its nested mounts.
2. Await cleanup, leaving the old DOM attached while cleanup runs.
3. Remove the parent's existing children. On the first mount this also removes any
   pre-existing content that has no framework scope.
4. Start a fresh component scope and execute setup.
5. After setup succeeds, append its returned root node or nodes in order.

The next request starts only after this request succeeds or its failure handling
finishes. A later request does not interrupt an earlier setup merely because it
has been queued. Slow setup or cleanup therefore delays subsequent requests for
that parent, and the parent may be empty while replacement setup awaits work.

Nested setup may enqueue mounts into elements it has just created, before those
elements are attached to the document. A parent's successful setup does not imply
that all independently queued descendant setups have completed.

## Ownership and disposal

Every mount belongs to the scope that owns the bound `h` used to request it. The
component instance gets a fresh child scope. Mounts requested through its bound
`h` are owned descendants, recursively.

When an owning scope is disposed:

1. Stop accepting mounts from that owner and discard its pending mount requests.
2. Interrupt in-progress setup and scoped background work; prevent late completion
   from attaching DOM after disposal.
3. Dispose descendant mounts and await their cleanup.
4. Run the component's own cleanup, then remove its DOM.

Cleanup must run child before parent, with no finalizer executed twice. Sibling
cleanup ordering is not part of the public contract. Pending requests are discarded
only for disposal, not as an optimization of ordinary replacement.

An enclosing component's DOM stays attached until its cleanup finishes, although
descendants may be removed as their cleanup completes. Bootstrap keeps the app
scope alive for the app lifetime; closing it disposes the mounted application.

Direct DOM removal does not trigger framework cleanup. Lifecycle changes must go
through the framework's mounting or scope disposal operations. No MutationObserver
or automatic external-DOM-removal detection is required.

For this iteration, a parent has one owning mount context. Repeated calls through
that context are supported. Moving a mount target between unrelated live owners
is outside the supported API; implementation must not silently transfer ownership.

## Failure handling

Bootstrap supplies an error handler, inherited by nested mounts. Asynchronous
mount failures go to this handler because `h` returns no result. Include sufficient
context to identify the failed lifecycle operation and preserve the Effect cause.

If setup fails, clean up all resources and nested mounts acquired by that attempt,
await cleanup, remove any partially mounted content, and leave the parent empty.
Report the error. A subsequent queued request may then proceed; one failed setup
must not permanently stall the queue.

As an implementation default, cleanup failures must be reported while still
attempting the remaining finalizers. After cleanup attempts finish, remove the old
DOM and allow the queue to progress. Preserve multiple failures rather than losing
the original error to a later cleanup error. Error reporting itself must not leave
queue bookkeeping stuck.

Owner disposal is cancellation, not a request to mount remaining queued components.
Expected interruption during disposal is not reported as a setup failure; genuine
cleanup failures still reach the error handler.

## Acceptance criteria

- The initial HTML contains `#app`; bootstrap queries it and reports its absence.
- The unchanged welcome content is created by a reusable component and mounted
  through `h`, without `innerHTML`.
- One component definition can mount under two different parents with independent
  nodes and scopes.
- Single roots, multiple ordered roots, and empty output work.
- Repeated requests replace all children and mount every request in order, even
  when setup or cleanup awaits asynchronous work.
- Old DOM remains during cleanup; new setup starts only after cleanup completes
  and the old children are removed.
- Different parent queues can make progress independently.
- Nested mounts clean up before their owner, including mounts into detached nodes
  created during asynchronous parent setup.
- Setup failure cleans partial resources, reports the cause, leaves an empty
  parent, and permits the next queued mount.
- Owner disposal cancels pending mounts and active work, awaits cleanup, and
  prevents late DOM insertion.
- Cleanup failures do not prevent remaining cleanup or permanently stall a queue.
- No new runtime dependency is introduced.

When implementing, verify asynchronous ordering with controlled completion gates
rather than timing-dependent sleeps. Set up testing with vitest, using the
monorepo version of vitest. Run `pnpm fmt`, `pnpm lint`, and `pnpm typecheck`
as required by repository conventions.

## Deferred design

Signals, derived values, event streams, reactive DOM bindings, component inputs,
routing, and a public mount-completion API are later work. This specification does
not require their types or implementations. Queue internals and the bootstrap
helper's name remain implementation choices.
