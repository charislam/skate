import { Effect, Match, Option, Queue } from "effect";
import { claimDestination, registerBinding, validateElementOwner } from "./dom";
import { writeProperty } from "./properties";
import { accessible, requireValid, runBatch, type ReactiveRuntime } from "./runtime";
import { signalData, type WritableSignal } from "./signal";

const textTypes = new Set(["text", "search", "tel", "url", "email", "password"]);
export const bindValue = Effect.fn("Budgerigar.bindValue")(function* (options: {
  runtime: ReactiveRuntime;
  element: HTMLInputElement | HTMLTextAreaElement;
  signal: WritableSignal<string>;
}) {
  const { runtime, element, signal } = options;
  yield* requireValid(
    (element instanceof HTMLInputElement && textTypes.has(element.type)) ||
      element instanceof HTMLTextAreaElement,
    "bindValue requires a text-editing input or textarea",
  );
  yield* requireValid(
    typeof signal.set === "function",
    "bindValue requires a writable string signal",
  );
  yield* validateElementOwner({ element, runtime });
  yield* accessible({
    consumer: runtime.lifetime,
    producer: signalData(signal).participant.lifetime,
  });
  yield* requireValid(
    typeof (yield* signal.get) === "string",
    "bindValue requires a string signal",
  );
  yield* claimDestination({ element, kind: "property", name: "value", reactive: true });

  let composing = false;
  let revision = 0;
  let echo: Option.Option<number> = Option.none();
  let lastCompletion: Option.Option<string> = Option.none();
  let active = false;
  const resource = { element, kind: "property", name: "value" };
  const enqueue = (value: string): void => {
    revision += 1;
    const snapshot = { value, revision };
    Queue.offerUnsafe(runtime.eventQueue, {
      resource,
      work: Effect.suspend(() =>
        Match.value(active && runtime.lifetime.active()).pipe(
          Match.when(false, () => Effect.void),
          Match.when(true, () =>
            Effect.gen(function* () {
              echo = Option.some(snapshot.revision);
              yield* runBatch({ runtime, work: signal.set(snapshot.value) }).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    echo = Option.none();
                  }),
                ),
              );
            }),
          ),
          Match.exhaustive,
        ),
      ),
    });
  };
  const input = (event: Event): void => {
    const value = element.value;
    const isComposing = event instanceof InputEvent && event.isComposing;
    Match.value(composing || isComposing).pipe(
      Match.when(true, () => {
        composing = true;
      }),
      Match.when(false, () => {
        Match.value(Option.contains(lastCompletion, value)).pipe(
          Match.when(false, () => enqueue(value)),
          Match.orElse(() => {}),
        );
        lastCompletion = Option.none();
      }),
      Match.exhaustive,
    );
  };
  const start = (): void => {
    composing = true;
    lastCompletion = Option.none();
  };
  const end = (): void => {
    composing = false;
    const value = element.value;
    lastCompletion = Option.some(value);
    enqueue(value);
  };
  yield* registerBinding({
    runtime,
    node: element,
    signal,
    kind: "property",
    name: "value",
    validate: (value) =>
      requireValid(typeof value === "string", "bindValue requires a string signal"),
    write: (value) =>
      Match.value(
        composing || Option.exists(echo, (snapshotRevision) => snapshotRevision < revision),
      ).pipe(
        Match.when(false, () => writeProperty({ element, name: "value", value })),
        Match.orElse(() => Effect.void),
      ),
    activate: () => {
      active = true;
      element.addEventListener("input", input);
      element.addEventListener("compositionstart", start);
      element.addEventListener("compositionend", end);
      return () => {
        active = false;
        composing = false;
        lastCompletion = Option.none();
        element.removeEventListener("input", input);
        element.removeEventListener("compositionstart", start);
        element.removeEventListener("compositionend", end);
      };
    },
  });
});
