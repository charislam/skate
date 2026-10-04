import { Effect, Match, Option } from "effect";
import { component, type Component } from "./framework";

export const AccessWarning = component({
  setup: ({ he }) =>
    he("p", {
      attrs: { role: Option.some("alert") },
      children: ["Access denied. Choose Allowed to view the page."],
    }),
});

export const AccessiblePage = component({
  fallback: () => document.createTextNode("Loading accessible page…"),
  setup: ({ signal, derive, he, events, subscribe }) =>
    Effect.gen(function* () {
      const count = yield* signal({ initial: 0 });
      const label = yield* derive({ sources: { count }, compute: ({ count }) => String(count) });
      const increment = yield* he("button", {
        props: { type: "button" },
        children: ["Increment page counter"],
      });
      yield* subscribe(yield* events(increment, "click"), () => count.update((value) => value + 1));
      return yield* he("article", {
        children: [
          yield* he("h3", { children: ["Accessible page"] }),
          yield* he("output", { children: [label] }),
          increment,
        ],
      });
    }),
});

export const AccessExample = component({
  setup: ({ signal, derive, he, events, subscribe }) =>
    Effect.gen(function* () {
      const access = yield* signal<Option.Option<boolean>>({ initial: Option.none() });
      const selected = yield* derive({
        sources: { access },
        compute: ({ access }): Option.Option<Component> =>
          Option.match(access, {
            onNone: () => Option.none(),
            onSome: (allowed) =>
              Match.value(allowed).pipe(
                Match.when(false, () => Option.some(AccessWarning)),
                Match.when(true, () => Option.some(AccessiblePage)),
                Match.exhaustive,
              ),
          }),
      });
      const controls: Node[] = [];
      for (const choice of [
        { label: "Unknown", value: Option.none<boolean>() },
        { label: "Denied", value: Option.some(false) },
        { label: "Allowed", value: Option.some(true) },
      ]) {
        const button = yield* he("button", { props: { type: "button" }, children: [choice.label] });
        yield* subscribe(yield* events(button, "click"), () => access.set(choice.value));
        controls.push(button);
      }
      return yield* he("section", {
        attrs: {
          class: Option.some("access-example"),
          "aria-label": Option.some("Access selection"),
        },
        children: [
          yield* he("h2", { children: ["Signal-selected content"] }),
          yield* he("p", {
            children: ["Allowed again preserves the counter. Leave and return to reset it."],
          }),
          ...controls,
          selected,
        ],
      });
    }),
});
