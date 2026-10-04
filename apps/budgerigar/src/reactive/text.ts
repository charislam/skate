import { Effect, Match, Option } from "effect";
import { accessible, requireValid, ReactiveError, type ReactiveRuntime } from "./runtime";
import { signalData, type Signal } from "./signal";

interface TextBinding {
  readonly issuer: ReactiveRuntime;
  readonly signal: Signal<string>;
}
const textBindings = new WeakMap<Node, TextBinding>();

export const reactiveText = Effect.fn("Budgerigar.reactiveText")(function* (options: {
  runtime: ReactiveRuntime;
  signal: Signal<string>;
}) {
  yield* accessible({
    consumer: options.runtime.lifetime,
    producer: signalData(options.signal).participant.lifetime,
  });
  const value = yield* options.signal.get;
  yield* requireValid(typeof value === "string", "Reactive text requires a string signal");
  const text = document.createTextNode(value);
  textBindings.set(text, { issuer: options.runtime, signal: options.signal });
  return text;
});

export const validateReactiveNode = (options: {
  node: Node;
  runtime: Option.Option<ReactiveRuntime>;
}): Effect.Effect<void, ReactiveError> =>
  Option.match(Option.fromUndefinedOr(textBindings.get(options.node)), {
    onNone: () => Effect.void,
    onSome: (binding) =>
      Option.match(options.runtime, {
        onNone: () =>
          Effect.fail(new ReactiveError({ message: "Reactive text requires its issuing runtime" })),
        onSome: (runtime) =>
          requireValid(
            runtime === binding.issuer &&
              runtime.lifetime.active() &&
              signalData(binding.signal).participant.lifetime.active(),
            "Reactive text belongs to a foreign or disposed runtime",
          ),
      }),
  });

export const activateReactiveNode = (options: {
  node: Node;
  lifetime: { readonly cleanups: Set<() => void> };
}): void => {
  Option.match(Option.fromUndefinedOr(textBindings.get(options.node)), {
    onNone: () => {},
    onSome: (binding) => {
      const text = options.node;
      Match.value(text).pipe(
        Match.when(
          (node): node is Text => node instanceof Text,
          (node) => {
            options.lifetime.cleanups.add(signalData(binding.signal).bind(node));
          },
        ),
        Match.orElse(() => {}),
      );
    },
  });
};
