# Public capabilities for external UI libraries

UI libraries are consumers of the public `framework` entry point. They may
construct and bind elements, subscribe to events, and register owner-bound work.
They must not import runtime, signal internals, DOM binding registries, or owner
lookup. Popover and anchored positioning follow this boundary.

The following operations are available on construction (`SynchronousContext`)
and setup/application contexts. Construction returns `Sync`; setup/application
returns `Effect`, except for `readCommitted`, which always returns `Result`.
The framework owns validation, event ordering, and disposal.

## Binding existing elements

```ts
yield *
  context.bind({
    element: trigger,
    attrs: { "aria-expanded": expanded },
    props: { disabled },
  });
```

`element` retains its native `ElementOutput<N, R>` type. `attrs` and `props` use
the same value types and safe property restrictions as `he`, with no `children`.
All supplied fields and signal ownership are validated before any field is
claimed or written. Attribute/property aliases share a destination. Conflicting
reactive declarations fail with `ReactiveError`; static declarations retain the
existing static precedence rules. Unrelated fields and event subscriptions are
preserved.

Binding requires a live context and a detached, unadopted element created by that
same context. An empty binding checks this eligibility without claiming fields.
Reactive bindings initialize immediately, activate with adoption, and retire with
the owner. Binding does not grant native DOM insertion authority.

## Reading committed state during native callbacks

```ts
const open = context.readCommitted(isOpen).pipe(Result.getOrElse(() => false));
```

`readCommitted(signal)` is a synchronous `Result<A, ReactiveError>` operation,
with no Effect execution or service requirement. It reads the last committed
value, even when called within a batch that has staged another value. It validates
consumer/producer ownership and rejects disposed or unrelated signals. It cannot
write state or expose signal metadata.

This supports decisions that must happen before native dispatch ends, such as
whether Escape should call `preventDefault`.

## DOM events beyond elements

```ts
const outsidePointers =
  yield *
  context.events(document, "pointerdown", {
    capture: true,
    synchronous: (event) => {
      // Inspect composedPath here; it is transient after native dispatch.
    },
  });
yield * context.subscribe(outsidePointers, (event) => action(event));
```

`events` accepts an element output, `Document`, `Window`, or `VisualViewport`.
Names and callback types come from the corresponding native event map. Options
include `capture`, `passive`, and the existing `synchronous` callback. Native
elements still require an element output; extending event targets does not accept
arbitrary unmanaged element handles.

The synchronous callback runs during native dispatch, before queued Effect
handlers. Default prevention and propagation suppression belong there. Throwing
callbacks are reported through owner error handling. Queued occurrences preserve
the subscriptions present at dispatch time, rather than replaying to later
subscribers. Neither callbacks nor queued handlers execute after disposal, and
listeners are removed with the exact capture setting used during registration.

## Synchronous observation of committed changes

```ts
yield *
  context.watchSync({
    signal: isOpen,
    onChange: (open) => {
      // Schedule positioning while open; cancel pending work while closed.
    },
  });
```

`watchSync` calls `onChange` with the initial committed value during registration,
then synchronously during the flush of each committed change. Multiple writes
in one batch produce at most one callback with the final value; an unchanged
final value produces none. Rolled-back changes produce none. Ordering relative
to other DOM sinks is not a post-insertion guarantee; callbacks must check
connection before measuring and schedule when necessary.

Callbacks are synchronous side effects for DOM integration or scheduling. They
must not write signals, return deferred work, or assume attached DOM. For domain
Effects, use the existing streams and subscriptions. Initial callback failures
fail registration; subsequent failures are reported without undoing committed
state. Ownership is checked on registration, and disposal disconnects observation
even when the observed ancestor signal remains live.

## Other public facilities

Use `nativeNode` for imperative focus and measurement, `readonlySignal` to hide
mutation capabilities, `occurrenceId` to allocate unique relationships once per
occurrence, and `addSyncFinalizer` for listeners, observers, and scheduled
callbacks created directly through browser APIs. All are public facilities; UI
libraries need no runtime or raw owner scope.
