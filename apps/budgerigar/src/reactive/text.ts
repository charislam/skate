import { Result, Match } from "effect";
import { elementOutput, managedNodes } from "~/output";
import { lazy } from "~/synchronous";
import { registerBindingSync } from "./dom";
import { calculateSync, ReactiveError, type ReactiveRuntime } from "./runtime";
import { type Signal } from "./signal";

const validateText = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(
      (value: unknown): value is string => typeof value === "string",
      (text) => Result.succeed(text),
    ),
    Match.orElse(() =>
      Result.fail(new ReactiveError({ message: "Reactive text requires a string signal" })),
    ),
  );

export const reactiveTextSync = (options: { runtime: ReactiveRuntime; signal: Signal<unknown> }) =>
  Result.gen(function* () {
    const text = document.createTextNode("");
    managedNodes.add(text);
    yield* registerBindingSync({
      ...options,
      node: text,
      kind: "text",
      name: "data",
      validate: validateText,
      write: (value) =>
        validateText(value).pipe(
          Result.flatMap((value) =>
            calculateSync(() =>
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

export const reactiveText = (options: Parameters<typeof reactiveTextSync>[0]) =>
  lazy(() => reactiveTextSync(options).pipe(Result.map(elementOutput)));
