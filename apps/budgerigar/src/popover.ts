import { Effect, Match, Option, Result } from "effect";
import {
  nativeNode,
  occurrenceId,
  ReactiveError,
  readonlySignal,
  Sync,
  type ElementOutput,
  type SynchronousContext,
} from "./framework";

const panelIds = new WeakMap<Document, Set<string>>();

export type CloseReason =
  | { readonly _tag: "Trigger" }
  | { readonly _tag: "Escape" }
  | { readonly _tag: "OutsidePointer" }
  | { readonly _tag: "FocusOutside" }
  | { readonly _tag: "Programmatic" };

const validate = (valid: boolean, message: string) =>
  Match.value(valid).pipe(
    Match.when(true, () => Sync.succeed(undefined)),
    Match.when(false, () => Sync.fail(new ReactiveError({ message }))),
    Match.exhaustive,
  );

export const make = (options: {
  readonly context: SynchronousContext;
  readonly initialOpen: boolean;
}) =>
  Sync.gen(function* () {
    const { context } = options;
    const state = yield* context.signal({ initial: options.initialOpen });
    let active = true;
    let binding: Option.Option<{ trigger: HTMLButtonElement; panel: HTMLElement }> = Option.none();
    const isOpen = () => context.readCommitted(state).pipe(Result.getOrElse(() => false));
    yield* context.addSyncFinalizer(() => {
      active = false;
      Option.map(binding, ({ panel }) => panelIds.get(panel.ownerDocument)?.delete(panel.id));
      binding = Option.none();
      return undefined;
    });
    const close = ({ reason }: { readonly reason: CloseReason }) =>
      Effect.gen(function* () {
        const wasOpen = yield* state.get;
        const restore =
          wasOpen &&
          Match.value(reason._tag).pipe(
            Match.when("Escape", () => true),
            Match.when("Programmatic", () =>
              Option.exists(binding, ({ panel }) =>
                panel.contains(panel.ownerDocument.activeElement),
              ),
            ),
            Match.when("Trigger", () => false),
            Match.when("OutsidePointer", () => false),
            Match.when("FocusOutside", () => false),
            Match.exhaustive,
          );
        yield* state.set(false);
        yield* Effect.sync(() =>
          Option.map(binding, ({ trigger }) =>
            Match.value(restore && trigger.isConnected && active).pipe(
              Match.when(true, () => trigger.focus()),
              Match.orElse(() => {}),
            ),
          ),
        );
      });
    const toggle = () =>
      state.get.pipe(
        Effect.flatMap((open) =>
          Match.value(open).pipe(
            Match.when(true, () => close({ reason: { _tag: "Trigger" } })),
            Match.when(false, () => state.set(true)),
            Match.exhaustive,
          ),
        ),
      );
    const attach = (elements: {
      readonly trigger: ElementOutput<HTMLButtonElement, unknown>;
      readonly panel: ElementOutput<HTMLElement, unknown>;
    }) =>
      Sync.gen(function* () {
        const trigger = nativeNode(elements.trigger);
        const panel = nativeNode(elements.panel);
        yield* validate(Option.isNone(binding), "Popover supports only one attachment");
        yield* context.bind({ element: elements.trigger });
        yield* context.bind({ element: elements.panel });
        yield* validate(
          trigger.tagName === "BUTTON" && trigger.ownerDocument === panel.ownerDocument,
          "Popover requires a button and panel in the same document",
        );
        const ids = panelIds.get(panel.ownerDocument) ?? new Set<string>();
        const existing = Option.fromNullishOr(panel.ownerDocument.getElementById(panel.id));
        const id = Match.value(
          panel.id.length > 0 &&
            !/\s/u.test(panel.id) &&
            !ids.has(panel.id) &&
            Option.match(existing, { onNone: () => true, onSome: (element) => element === panel }),
        ).pipe(
          Match.when(true, () => panel.id),
          Match.when(false, () => occurrenceId("popover")),
          Match.exhaustive,
        );
        const expanded = yield* context.derive({
          sources: { state },
          compute: ({ state }) => Option.some(String(state)),
        });
        const controls = yield* context.derive({
          sources: { state },
          compute: () => Option.some(id),
        });
        const hidden = yield* context.derive({
          sources: { state },
          compute: ({ state }) => !state,
        });
        yield* context.bind({
          element: elements.trigger,
          attrs: { "aria-expanded": expanded, "aria-controls": controls },
        });
        yield* context.bind({
          element: elements.panel,
          props: { hidden },
          attrs: { id: Option.some(id) },
        });
        ids.add(id);
        panelIds.set(panel.ownerDocument, ids);
        binding = Option.some({ trigger, panel });
        yield* context.subscribe(yield* context.events(elements.trigger, "click"), toggle);
        const inside = (event: Event) =>
          event.composedPath().some((node) => node === trigger || node === panel);
        const document = trigger.ownerDocument;
        // Event paths are transient: decide outside-ness during native dispatch.
        for (const input of [
          { name: "pointerdown" as const, reason: { _tag: "OutsidePointer" as const } },
          { name: "focusin" as const, reason: { _tag: "FocusOutside" as const } },
        ]) {
          const outside = new WeakSet<Event>();
          yield* context.subscribe(
            yield* context.events(document, input.name, {
              capture: true,
              synchronous: (event) => {
                Match.value(isOpen() && !inside(event)).pipe(
                  Match.when(true, () => {
                    outside.add(event);
                  }),
                  Match.orElse(() => {}),
                );
              },
            }),
            (event) =>
              Match.value(outside.has(event)).pipe(
                Match.when(true, () => close({ reason: input.reason })),
                Match.orElse(() => Effect.void),
              ),
          );
        }
        for (const element of [elements.trigger, elements.panel]) {
          const handled = new WeakSet<KeyboardEvent>();
          yield* context.subscribe(
            yield* context.events(element, "keydown", {
              synchronous: (event) => {
                Match.value(event.key === "Escape" && isOpen() && !event.defaultPrevented).pipe(
                  Match.when(true, () => {
                    event.preventDefault();
                    event.stopPropagation();
                    handled.add(event);
                  }),
                  Match.orElse(() => {}),
                );
              },
            }),
            (event) =>
              Match.value(handled.has(event)).pipe(
                Match.when(true, () => close({ reason: { _tag: "Escape" } })),
                Match.orElse(() => Effect.void),
              ),
          );
        }
        for (const view of Option.toArray(Option.fromNullishOr(document.defaultView)))
          yield* context.subscribe(yield* context.events(view, "blur"), () =>
            close({ reason: { _tag: "FocusOutside" } }),
          );
      });
    return { isOpen: readonlySignal(state), open: () => state.set(true), close, toggle, attach };
  });
