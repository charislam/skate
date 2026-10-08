import { Effect, Match, Option } from "effect";
import { component, nativeNode, type ElementOutput } from "./framework";
import { occurrenceId } from "./occurrence";
import * as Sync from "./sync-public";

const names = ["Overview", "Details", "Settings"] as const;
const navigation = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);
export const Tabs = component(() =>
  Sync.succeed({
    setup: ({ he, signal, derive, events, subscribe, batch }) =>
      Effect.gen(function* () {
        const id = occurrenceId("tabs");
        const focused = yield* signal({ initial: 0 });
        const selected = yield* signal({ initial: 0 });
        const buttons: ElementOutput<HTMLButtonElement>[] = [];
        const panels: ElementOutput<HTMLElement>[] = [];
        const focusTab = (next: number) =>
          focused
            .set(next)
            .pipe(
              Effect.andThen(
                Effect.sync(() =>
                  Option.fromUndefinedOr(buttons[next]).pipe(
                    Option.map((button) => nativeNode(button).focus()),
                  ),
                ),
              ),
            );
        for (const [index, name] of names.entries()) {
          const tabIndex = yield* derive({
            sources: { focused },
            compute: ({ focused }) =>
              Match.value(focused === index).pipe(
                Match.when(true, () => 0),
                Match.when(false, () => -1),
                Match.exhaustive,
              ),
          });
          const selectedText = yield* derive({
            sources: { selected },
            compute: ({ selected }) => Option.some(String(selected === index)),
          });
          const tabClass = yield* derive({
            sources: { selected },
            compute: ({ selected }) =>
              Match.value(selected === index).pipe(
                Match.when(true, () => Option.some("selected")),
                Match.when(false, () => Option.none<string>()),
                Match.exhaustive,
              ),
          });
          const hidden = yield* derive({
            sources: { selected },
            compute: ({ selected }) => selected !== index,
          });
          const button = yield* he("button", {
            attrs: {
              id: Option.some(`${id}-tab-${index}`),
              role: Option.some("tab"),
              "aria-controls": Option.some(`${id}-panel-${index}`),
              "aria-selected": selectedText,
              class: tabClass,
            },
            props: { type: "button", tabIndex },
            children: [name],
          });
          buttons.push(button);
          panels.push(
            yield* he("div", {
              attrs: {
                id: Option.some(`${id}-panel-${index}`),
                role: Option.some("tabpanel"),
                "aria-labelledby": Option.some(`${id}-tab-${index}`),
              },
              props: { hidden, tabIndex: 0 },
              children: [`${name} panel`],
            }),
          );
          yield* subscribe(yield* events(button, "click"), () =>
            batch(selected.set(index).pipe(Effect.andThen(focused.set(index)))).pipe(
              Effect.andThen(Effect.sync(() => nativeNode(button).focus())),
            ),
          );
          yield* subscribe(yield* events(button, "focus"), () => focused.set(index));
          yield* subscribe(
            yield* events(button, "keydown", {
              synchronous: (event) =>
                Match.value(navigation.has(event.key)).pipe(
                  Match.when(true, () => event.preventDefault()),
                  Match.orElse(() => {}),
                ),
            }),
            (event) =>
              Match.value(event.key).pipe(
                Match.when("ArrowLeft", () => focusTab((index + names.length - 1) % names.length)),
                Match.when("ArrowRight", () => focusTab((index + 1) % names.length)),
                Match.when("Home", () => focusTab(0)),
                Match.when("End", () => focusTab(names.length - 1)),
                Match.orElse(() => Effect.void),
              ),
          );
        }
        return yield* he("section", {
          attrs: { class: Option.some("card tabs"), "aria-label": Option.some("Reactive tabs") },
          children: [
            yield* he("div", {
              attrs: {
                role: Option.some("tablist"),
                "aria-label": Option.some("Example sections"),
              },
              children: buttons,
            }),
            ...panels,
          ],
        });
      }),
  }),
);
