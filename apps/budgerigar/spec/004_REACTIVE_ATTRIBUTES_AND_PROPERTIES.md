# Budgerigar: reactive attributes, properties, and form bindings

## Purpose and agreed scope

Extend `002_STATIC_DOM_CONSTRUCTION.md` and `003_REACTIVE_STATE.md` with
reactive attributes and properties. Demonstrate them with a text input and
accessible tabs on the home page, alongside the existing counters.

The requirements discussion settled these choices:

- Accept signals directly alongside static values in `he` options.
- Include an explicit two-way binding API.
- Build tabs from native buttons and panels, with manual keyboard activation.
- Require Option-wrapped attribute values: `Some(true)` or `Some(string)` sets
  an attribute; only `None` removes it. This breaks the previous static API.
- Support every writable property currently permitted by construction; reject
  conflicting attribute/property bindings.
- Include event-time input snapshots, caret preservation, and IME handling.
- Report DOM assignment failures separately from successful state commits.
  Keep failed bindings active so later changed values can recover.

This document is the implementation plan. API names and the detailed editing
rules below are proposed implementation decisions. Add no runtime dependencies.
Dynamic lists, reactive subtree replacement, custom elements, SVG namespaces,
general form validation, and automatic dependency tracking remain out of scope.

## Public construction API

Keep `he(tag, options)`, but replace the static attribute value contract. Allow each
attribute or property entry to independently receive a static value or signal;
do not require a signal containing an entire options object.

Attribute values are `Option<true | string>` or `Signal<Option<true | string>>`.
Accept narrower values and signals such as `Option<string>`,
`Signal<Option<true>>`, and `Signal<Option<string>>` without widening or casts at
the call site. Apply the same rules initially and on subsequent commits:

| Value                 | DOM operation                                    |
| --------------------- | ------------------------------------------------ |
| `Option.some(string)` | Set the exact string, including the empty string |
| `Option.some(true)`   | Set an empty attribute                           |
| `Option.none()`       | Remove the attribute                             |

Every string is literal: `Some("false")`, `Some("true")`, and `Some("null")`
set those exact strings, without special interpretation. ARIA values such as
`aria-selected` therefore use `Some("true")` and `Some("false")`. For a native
boolean attribute, even `Some("false")` leaves the attribute present; use `None`
to remove it.

Reject bare strings and booleans, `Some(false)`, numbers, objects other than the
specified Option values, null, and undefined at both the type and runtime
boundaries. No compatibility overload or implicit wrapping is provided. Omitted
attribute keys remain valid and specify no attribute or binding. Validate
attribute names before activation.

For each allowed property `P`, accept its existing DOM type or a signal of that
type. Preserve tag-specific inference and the exclusions for readonly members,
methods, event handlers, HTML injection, text replacement, and `style`. Do not
introduce Option-based property deletion: properties use their native value
domain, including native nullability where applicable. Treat native undefined
values as a DOM boundary concern, not a new framework absence convention.

Illustrative usage (`selectedText` and `tabClass` are `Signal<Option<string>>`):

```ts
yield *
  he("button", {
    attrs: { role: Option.some("tab"), "aria-selected": selectedText, class: tabClass },
    props: { type: "button", tabIndex },
    children: ["Overview"],
  });
```

### Conflicting destinations

Reject two writers to the same DOM destination when at least one is reactive.
This includes a two-way binding and an existing binding to the same property.
Normalize HTML attribute names and account for native reflection aliases such
as `class`/`className`, `for`/`htmlFor`, and `tabindex`/`tabIndex`. Detect direct
reflection conflicts such as `attrs.disabled` plus `props.disabled`, even when
one side is static. Include coupled form fields such as the value attribute and
live/default value properties in the documented conflict rules.

Retain existing precedence for wholly static options. Implement conflict
detection using explicit tag-aware destination metadata; do not discover
reflection by mutating live elements. Before implementation is complete, audit
the supported property surface and document the covered alias/coupling rules
and tests. Do not claim to prevent every indirect interaction among unrelated
native properties, such as changing an input's type affecting its value.

## Binding lifetime and commit behavior

Generalize the existing text binding mechanism into typed DOM sinks shared by
text, attributes, properties, and two-way input bindings. Keep DOM-specific
assignment logic outside the signal state implementation.

Construction validates ownership and initializes detached nodes from the
current snapshot, without installing live subscriptions. Adoption revalidates
the bindings, refreshes from committed values, and activates subscriptions.
Changes between construction and adoption must appear at adoption. Unadopted
trees must not retain active signal subscriptions or input listeners.

Preserve the issuing-runtime checks, ancestor signal consumption rules, and
rejection of unrelated/disposed resources from reactive text. Binding cleanup
belongs to the adopted tree's lifetime, including bindings to ancestor signals.
Framework replacement and component disposal stop DOM writes and release
listeners and references before removal. Direct external DOM removal does not
introduce a new automatic disposal mechanism.

Before installing a candidate commit, validate the proposed values of affected
active bindings as well as signal calculations. A validation failure rejects
the entire candidate and preserves the previous state and DOM. Never perform
trial assignments to live DOM as validation.

For a valid candidate, install all changed signal values, synchronously flush
affected text/attribute/property sinks, and then publish observations. Successful
writes and batches complete after that flush and publication. Failed batches
produce no DOM assignments. Do not scan unrelated signals or DOM bindings.

Skip redundant DOM assignments by comparing the destination's current value
with the intended value. In particular, do not reassign an input's value when
the browser already contains the new signal value. Signals retain their current
equality semantics: setting an equal signal value does not force a DOM refresh.
Stable DOM node identities are required across updates.

### Report and recover

A native setter or assignment can throw after state has committed. Catch each
binding failure independently, preserve the original cause, continue flushing
other bindings, and publish the committed state. Report through the existing
mount failure channel with operation `reactive-dom` and a resource identifying
the element, binding kind, and attribute/property name. Guard reporting so a
failing error handler cannot interrupt the remaining flush.

Do not roll back committed signals, reject the successful write Effect, stop
the component, or unsubscribe the failed binding. The destination retains
whatever value the browser left behind. A later changed signal value retries
the assignment; there is no automatic retry loop or retry on an equal write.
One failed assignment attempt produces one report. Observers can therefore see
committed state whose failed DOM destination has not caught up.

Apply the same per-binding reporting policy to assignment failures during
initialization and adoption, after validation succeeds. Invalid construction
still fails through `ConstructionError`; invalid commit proposals fail through
`ReactiveError`. Browser normalization of a successfully assigned property is
not an assignment failure and does not automatically rewrite its source signal.

## Two-way text input binding

Add an effectful component-context helper, provisionally:

```ts
yield * bindValue({ element: input, signal: text });
```

The helper requires a `WritableSignal<string>`, registers a value destination
and native input ingress under the issuing owner, and returns no manually managed
subscription. Register it during setup before adoption. Validate eligibility,
ownership, and duplicate destinations before acquiring resources. Derived
read-only signals must be rejected by the type system.

The initial helper supports text-editing inputs (`text`, `search`, `tel`, `url`,
`email`, and `password`) and textareas. Other property bindings remain available
through `props`; generic checkbox/select/number conversion helpers are deferred.

Capture the string value and composition metadata in the native listener,
before queueing work. Process those immutable snapshots in ingress order using
the existing reactive transaction domain. Do not read mutable `event.target`
later in an asynchronous subscription. Reuse or extend the DOM event ingress
internals narrowly; existing `events(element, name)` behavior remains compatible.

Editing policy:

- User input updates the writable signal; programmatic signal changes update
  the element. Programmatic assignments do not synthesize input/change events.
- Ordinary input echo must preserve focus and selection by skipping redundant
  assignments.
- Track composition synchronously from native events. While composing, leave
  the browser's editing buffer intact, suppress model-to-value assignments, and
  defer user-to-model publication until composition ends.
- On composition end, enqueue the completed string once. A trailing native
  input event with the same value must not cause a second state change.
- Composition completion wins over programmatic text changes made during the
  composition. Later programmatic writes proceed normally. Document this
  intentional precedence rather than silently dropping the completed user edit.
- With rapid queued input events, publish their snapshots in order but avoid
  writing an older echo over the browser's newer editing buffer. Track ingress
  revisions per binding to distinguish stale echoes from new model writes.
- Disposal during composition cancels pending owned work and removes listeners;
  no deferred completion may update a disposed component.

## Home page demonstrations

### Input

Add a labeled text input using `bindValue`, a live text echo, a reset button
that clears the signal, and an enabled/disabled toggle driven by a boolean
property signal. Add an optional hint attribute, such as `title`, derived as
`Option<string>` so the demo exercises attribute removal as well as property
updates. Keep all controls explicitly labeled and buttons `type="button"`.

Place this in its own component with occurrence-local state. Preserve the
heading, welcome message, and two independent counters.

### Tabs

Add a separate tabs component with three fixed tabs: Overview, Details, and
Settings. Use native buttons with `role="tab"`, a labeled `role="tablist"`,
and associated `role="tabpanel"` elements. Generate occurrence-unique IDs for
`aria-controls` and `aria-labelledby`.

Maintain distinct focused-tab and selected-tab state:

- The first tab starts selected and is the initial tab-list entry point.
- Clicking selects and focuses that tab.
- Left/Right arrows move focus with wrapping; Home/End focus the first/last tab.
  These keys do not select a panel.
- Enter/Space activates the focused tab using native button activation; avoid
  dispatching the selection twice through both keydown and click handling.
- Use roving reactive `tabIndex`, string `aria-selected`, and an active class.
  Panels stay mounted and toggle their reactive `hidden` property.
- Tab leaves the tab list normally. Make visible panels keyboard reachable where
  their content does not provide an appropriate initial focus target.
- Preserve separate visible focus and selected styles.

Prevent native scrolling for handled navigation keys synchronously in the native
listener. The existing queued event delivery cannot perform timely default
prevention; add a narrow synchronous event ingress option or owned adapter for
that purpose. Keep signal updates in the normal queue and perform imperative
focus effects in the corresponding ordered handler after its state update.

## Implementation sequence

1. Extend construction types and define attribute normalization and property
   destination metadata. Add type-level checks for tag-specific signals,
   optional attributes, forbidden fields, and read-only two-way inputs.
   Migrate all existing Budgerigar attribute call sites, tests, and current API
   examples to Option values; replace removal via `false` with `Option.none()`.
   This specification supersedes the attribute value rules in specification 002.
2. Extract a shared DOM binding registry and sink interface from
   `reactive/text.ts` and `reactive/signal.ts`. Generalize `flushText` in the
   coordinator to DOM flushing while preserving existing text behavior.
3. Integrate binding validation into candidate preparation and construction;
   integrate activation/cleanup with current framework adoption lifetimes.
   Add per-sink assignment failure reporting and recovery.
4. Implement the two-way helper and synchronous event snapshot/default-prevention
   support. Keep composition and ingress bookkeeping local to each input binding.
5. Add input and tabs components, wire them into `home.ts`, and add minimal styles.
6. Complete regression and browser verification; update the README to document
   construction values, two-way editing rules, conflicts, and failure semantics.

Use the pinned Effect implementation and available vendored sources as read-only
references. Follow Option/Match conventions and named options for related
parameters. Do not add abstractions that require exposing signal internals to
application components.

## Verification and acceptance

Extend existing Vitest coverage for the framework.

Cover these independently observable behaviors:

- Mixed static/reactive entries; initial snapshots; Some(true)/None and
  Some(string)/None transitions; literal strings including empty, "false",
  "true", and "null"; native property typing and exclusions.
- Compile-time and runtime rejection of bare attribute strings/booleans,
  Some(false), and other invalid values; migrated static construction examples.
- Conflicting destinations and aliases fail before activation or child adoption.
- Detached nodes do not subscribe; adoption refreshes; ancestor consumption
  works; unrelated/disposed owners fail; replacement and disposal stop updates.
- Batched related text, attributes, and properties are updated before observers
  run and before a successful write returns. Validation failures and aborted
  batches leave state and DOM unchanged.
- A deliberately throwing setter reports once without stopping other bindings
  or publication; the write succeeds; a later valid changed value recovers.
  An equal write neither forces retry nor produces a duplicate report.
- Input editing, reset, disabled toggling, optional hint removal, multiple
  independent occurrences, event-time snapshots, and no synthetic feedback loop.
- Rapid events retain distinct snapshots without stale DOM echo. Composition
  completion, duplicate trailing input, programmatic writes during composition,
  and disposal during composition obey the specified policy.
- Tabs support mouse selection, roving focus, wrapping, Home/End, manual
  Enter/Space activation, unique ARIA relationships, panel visibility, and stable
  tab/panel node identities. Existing counter tests remain valid when new
  sections and buttons are added; scope their selectors to counter components.

Use deterministic synchronization, not arbitrary delays. Inspect properties
directly where MutationObserver cannot observe property-only changes.

Run repository convention checks (`pnpm fmt`, `pnpm lint`, `pnpm typecheck`) and
`pnpm test:budgerigar` during implementation; identify any unrelated baseline
failures separately.
