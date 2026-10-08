import { Effect, Match, Option } from "effect";
import { component, mapEvents, mergeEvents } from "./framework";
import * as Sync from "./sync-public";

type Action = "increment" | "decrement" | "reset";

export const Counter = component(() =>
  Sync.succeed({
    setup: ({ he, events, fold, derive }) =>
      Effect.gen(function* () {
        const increment = yield* he("button", {
          attrs: { class: Option.some("primary") },
          props: { type: "button" },
          children: ["Increment"],
        });
        const decrement = yield* he("button", {
          props: { type: "button" },
          children: ["Decrement"],
        });
        const reset = yield* he("button", { props: { type: "button" }, children: ["Reset"] });
        const actions = mergeEvents<Action>([
          mapEvents(yield* events(increment, "click"), () => "increment"),
          mapEvents(yield* events(decrement, "click"), () => "decrement"),
          mapEvents(yield* events(reset, "click"), () => "reset"),
        ]);
        const count = yield* fold({
          events: actions,
          initial: 0,
          reducer: ({ state, event: action }) =>
            Match.value(action).pipe(
              Match.when("increment", () => state + 1),
              Match.when("decrement", () => state - 1),
              Match.when("reset", () => 0),
              Match.exhaustive,
            ),
        });
        const label = yield* derive({ sources: { count }, compute: ({ count }) => String(count) });
        return yield* he("section", {
          attrs: { class: Option.some("card counter"), "aria-label": Option.some("Counter") },
          children: [yield* he("output", { children: [label] }), increment, decrement, reset],
        });
      }),
  }),
);
