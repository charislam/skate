# Budgerigar: headless popover and routing controls

## Purpose and scope

Introduce a reusable headless popover and use it to replace the routing demo's
controls sidebar. This document specifies proposed behavior and API shape; it
does not describe an existing implementation.

A headless primitive is an owner-scoped behavior factory. It exposes reactive
state and operations and attaches behavior to caller-created elements. The
application owns markup, content, styling, and domain actions. The primitive owns
its interaction and accessibility contract.

Build on existing signals, derivations, element outputs, event subscriptions,
and owner finalizers. No new component lifecycle concept is required.

V1 includes one trigger and one panel per instance, non-modal disclosure behavior,
outside dismissal, focus handling, and anchored positioning. Defer nested
popovers, portals, modal dialogs, controlled external state, animation lifecycle,
and ARIA menu widgets with item registration and arrow-key navigation.

## Routing page design

Place a `Controls` button at the right of the Routing heading. Opening it reveals
the existing controls in a panel aligned below the trigger's right edge. Remove
the sidebar column so route content uses the available page width.

Preserve these groups and their existing actions:

| Group | Contents |
| --- | --- |
| Session | Discover anonymous, Discover Ada, Switch to Grace, New Ada session, Refresh session, Log out, Expire session |
| Project loading | Immediate projects, Delay projects, Fail projects, Complete acquisitions, Fail acquisitions, pending acquisition count |
| History | Reject next history write, Reconcile URL |

Use section headings and ordinary buttons. Keep the pending count reactive while
the panel is closed. Keep navigation errors in the main content where they remain
visible after dismissal.

The panel should be approximately 320px wide, constrained to the viewport with
padding, and internally scrollable when its contents exceed the available height.
Style it with a surface, border, modest shadow, and clear group separation. The
application supplies all visual classes and focus indicators.

```text
Routing                                  [Controls ▾]
                                      ┌─────────────────────────┐
                                      │ Session                 │
                                      │ Session action buttons  │
                                      ├─────────────────────────┤
                                      │ Project loading         │
                                      │ Loading action buttons  │
                                      │ Pending acquisitions: 0 │
                                      ├─────────────────────────┤
                                      │ History                 │
                                      │ History action buttons  │
                                      └─────────────────────────┘
```

Keep the controls occurrence outside the session-keyed route branches. Switching
users or resolving a session must not recreate the popover. Change the resolving
message to refer to `Controls` instead of the sidebar.

## Public API proposal

The following is illustrative API usage. Implementation must preserve existing
Sync/Effect error and requirement inference rather than erase types to fit it.

```ts
const RoutingControls = component((context) =>
  Sync.gen(function* () {
    const popover = yield* Popover.make({
      context,
      initialOpen: false,
    });

    const trigger = yield* context.he("button", {
      props: { type: "button" },
      children: ["Controls"],
    });

    const panel = yield* context.he("section", {
      attrs: {
        class: Option.some("routing-controls"),
        "aria-label": Option.some("Routing controls"),
      },
      children: [/* Existing control sections. */],
    });

    yield* popover.attach({ trigger, panel });

    return {
      setup: () => Effect.succeed([trigger, panel]),
    };
  }),
);
```

`Popover.make` takes a `SynchronousContext` and an initial open value. Its public
surface is:

| Member | Contract |
| --- | --- |
| `isOpen` | Read-only boolean signal |
| `open()` | Effect requesting the open state; idempotent |
| `close({ reason })` | Effect requesting the closed state with explicit dismissal reason; idempotent |
| `toggle()` | Effect toggling the state as a trigger activation |
| `attach({ trigger, panel })` | Synchronous owner-bound wiring of one button output and one panel output |

Use a tagged close-reason union covering `Trigger`, `Escape`, `OutsidePointer`,
`FocusOutside`, and `Programmatic`. Handle it exhaustively with `Match.value`.
Use `Option` for optional internal references and values.

Only one attachment is supported per instance. Duplicate attachment and elements
from incompatible owners must fail through the framework's existing validation
and error conventions. Do not silently replace an earlier binding.

The caller can construct and style elements with `context.he` before attachment.
Attachment must compose with existing action subscriptions without replacing
them. It requires no wrapper element and no `asChild` facility.

The primitive owns the trigger's `aria-expanded` and `aria-controls`, panel
visibility, and identifiers needed to connect the pair. Reuse valid existing IDs
or allocate occurrence-specific IDs. Callers must not independently bind the
same behavior-owned fields. All unrelated attributes and classes remain owned
by the caller.

## Interaction and accessibility

This is a non-modal disclosure containing grouped controls. Do not assign
`role="menu"`, `role="menuitem"`, or `aria-haspopup="menu"`. ARIA menus carry
an item-navigation contract that this panel does not implement. See the
[WAI menu and menubar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/).

The trigger is a native button with an accessible name. The panel is a labelled
section with semantic group headings. Keep the panel immediately after the
trigger in DOM order, even when visually positioned elsewhere.

| Input or event | Required behavior |
| --- | --- |
| Trigger click, Enter, or Space | Toggle once through native button activation |
| Open | Leave focus on the trigger; the next Tab enters the panel |
| Escape within the trigger or panel | Close and restore focus to the connected trigger |
| Outside pointer interaction | Close without preventing the outside interaction or moving focus back |
| Tab or Shift+Tab outside the trigger/panel pair | Close without trapping or redirecting focus |
| Trigger closes the panel | Leave focus on the trigger |
| Programmatic close | Restore trigger focus only if focus would otherwise remain in hidden panel content |
| Control activation | Run the existing action and keep the panel open |

Keeping the panel open supports sequences such as delaying projects, navigating,
and completing acquisitions. Popover state is independent of action success or
failure. Reuse existing application error handling.

Closed content must be hidden from display, keyboard navigation, and the
accessibility tree. Keep the subtree mounted so its state and subscriptions
survive closing. Closing must not cancel domain work owned by the routing demo.

An interaction inside either trigger or panel is not an outside interaction.
Use event paths where needed to account for descendants and shadow boundaries.
Focus transitions between the trigger and panel must not cause dismissal.
If focus leaves the document, close without attempting to reclaim it.

Consume Escape only when this popover handles it. Suppression of browser defaults
or event propagation must occur in the event API's synchronous callback; delayed
Effect handlers cannot reliably perform that work.

## State, ownership, and lifecycle

Each component occurrence allocates independent state, identifiers, and bindings.
The writable open signal stays private; public consumers receive a read-only
view. There must be one authoritative open state, with visibility and ARIA state
derived from it rather than updated independently.

Construction may occur before DOM insertion. Attachment must not measure or
focus detached elements. Initial-open positioning must wait until connection;
do not assume component setup itself is a post-insertion lifecycle hook. Any
scheduled connection check must be cancellable and owner-bound.

Register element subscriptions through the existing context. Register any
document/window listeners, positioning observers, or scheduled callbacks with
the owning scope and synchronous finalizers. Listen on the elements' owner
document rather than an assumed global document.

Disposal removes all listeners and cancels scheduled work. It must not restore
focus to a trigger that is being removed, write retired signals, or run delayed
measurements. Opening and closing must not accumulate subscriptions.

## Positioning

Keep anchored positioning separate from disclosure state and focus behavior so
it can later support other primitives. The routing controls compose both helpers.

The positioner accepts an anchor, a floating element, placement, gap, and viewport
padding in a named options object. For the routing panel use bottom-end alignment
with a small gap. Shift horizontally to remain visible and flip above the trigger
when that provides more usable room. Constrain width and height to available
space and allow internal scrolling.

Measure only connected, open content. Reposition on opening, viewport changes,
relevant scrolling, and anchor or panel size changes. Coalesce measurements and
cancel pending callbacks when closed or disposed.

V1 may render the panel inline with positioning styles, provided the routing
page's ancestors do not clip it. Do not promise arbitrary clipping escape without
a top-layer or portal implementation. The positioner owns geometric styles;
application CSS owns appearance.

## Implementation boundaries

- Add the headless popover helper and a separately testable positioning helper.
- Extract the existing routing controls into an application component; preserve
  their actions and service requirements.
- Compose the controls next to the heading outside session-keyed branches.
- Remove the sidebar layout and add responsive panel styling.
- Update sidebar-specific copy and existing tests that assume an always-visible
  sidebar. Retain checks that all three control groups remain available.
- Follow repository conventions, including top-level imports, named options,
  `Option`, and exhaustive `Match.value` handling.

## Acceptance criteria and verification

Use focused state/ownership tests and browser interaction tests. Follow existing
Budgerigar test infrastructure.

1. The initial panel is closed and the trigger reports `aria-expanded="false"`.
2. Pointer and native keyboard activation each toggle exactly once, keeping
   visibility and accessibility state consistent.
3. Tab reaches controls in DOM order, Shift+Tab can return to the trigger, and
   leaving the pair dismisses without trapping focus.
4. Escape returns focus to the trigger; outside interaction preserves its target's
   native behavior and focus.
5. Closed controls cannot be reached by keyboard. Programmatic dismissal never
   strands focus in hidden content.
6. All existing session, loading, and history actions retain their behavior and
   keep the panel open. Pending counts continue to update across close/reopen.
7. Session branch replacement preserves the controls occurrence and open state.
8. Separate popover instances have independent state and unique relationships.
   Repeated open/close and owner disposal leave no active listeners or callbacks.
9. Run `pnpm fmt`, `pnpm lint`, and `pnpm typecheck` for implementation changes,
    plus the relevant automated tests. DOM-only tests do not establish browser
    focus ordering or positioning correctness.
