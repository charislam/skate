import { Effect, Match } from "effect";
import { registerBinding } from "./dom";
import { calculate, ReactiveError, type ReactiveRuntime } from "./runtime";
import { type Signal } from "./signal";

const validateText = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(
      (value: unknown): value is string => typeof value === "string",
      (text) => Effect.succeed(text),
    ),
    Match.orElse(() =>
      Effect.fail(new ReactiveError({ message: "Reactive text requires a string signal" })),
    ),
  );

export const reactiveText = Effect.fn("Budgerigar.reactiveText")(function* (options: {
  runtime: ReactiveRuntime;
  signal: Signal<unknown>;
}) {
  const text = document.createTextNode("");
  yield* registerBinding({
    ...options,
    node: text,
    kind: "text",
    name: "data",
    validate: validateText,
    write: (value) =>
      validateText(value).pipe(
        Effect.flatMap((value) =>
          calculate(() =>
            Match.value(text.data !== value).pipe(
              Match.when(true, () => {
                text.data = value;
              }),
              Match.orElse(() => {}),
            ),
          ),
        ),
      ),
  });
  return text;
});
