import { Effect, Match } from "effect";
import { registerBinding } from "./dom";
import { calculate, requireValid, type ReactiveRuntime } from "./runtime";
import { type Signal } from "./signal";

export const reactiveText = Effect.fn("Budgerigar.reactiveText")(function* (options: {
  runtime: ReactiveRuntime;
  signal: Signal<string>;
}) {
  const text = document.createTextNode("");
  yield* registerBinding({
    ...options,
    node: text,
    kind: "text",
    name: "data",
    validate: (value) =>
      requireValid(typeof value === "string", "Reactive text requires a string signal"),
    write: (value) =>
      calculate(() =>
        Match.value(text.data !== value).pipe(
          Match.when(true, () => {
            text.data = value;
          }),
          Match.orElse(() => {}),
        ),
      ),
  });
  return text;
});
