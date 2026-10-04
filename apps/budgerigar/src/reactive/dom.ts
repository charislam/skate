import { Cause, Effect, Match, Option } from "effect";
import {
  accessible,
  calculate,
  requireValid,
  ReactiveError,
  type ComponentLifetime,
  type ReactiveRuntime,
} from "./runtime";
import { destination } from "./destinations";
import { isSignal, signalData, type DomSink, type Signal } from "./signal";

export type AttributeValue = Option.Option<true | string>;
export type BindingKind = "text" | "attribute" | "property" | "selection";
export interface DomResource {
  readonly element: Node;
  readonly kind: BindingKind;
  readonly name: string;
}
interface Declaration {
  readonly destination: string;
  readonly reactive: boolean;
}
interface Binding extends DomSink {
  readonly issuer: ReactiveRuntime;
  report: Option.Option<ComponentLifetime["report"]>;
  readonly signal: Signal<unknown>;
  readonly start: () => () => void;
}
const elementIssuers = new WeakMap<HTMLElement, Option.Option<ReactiveRuntime>>();
const activated = new WeakSet<Node>();
export const markElementOwner = (options: {
  element: HTMLElement;
  runtime: Option.Option<ReactiveRuntime>;
}): void => {
  elementIssuers.set(options.element, options.runtime);
};
export const validateElementOwner = (options: { element: HTMLElement; runtime: ReactiveRuntime }) =>
  requireValid(
    Option.exists(
      elementIssuers.get(options.element) ?? Option.none(),
      (issuer) => issuer === options.runtime,
    ) &&
      !activated.has(options.element) &&
      !options.element.isConnected &&
      options.runtime.lifetime.active(),
    "bindValue requires a detached element from its issuing runtime before adoption",
  );

const bindings = new WeakMap<Node, Binding[]>();
const declarations = new WeakMap<HTMLElement, Declaration[]>();

const isAttributeValue = (value: unknown): value is AttributeValue =>
  Option.isOption(value) &&
  (Option.isNone(value) || typeof value.value === "string" || value.value === true);

export const validateAttribute = (value: unknown): Effect.Effect<AttributeValue, ReactiveError> =>
  Effect.suspend(() =>
    Match.value(value).pipe(
      Match.when(isAttributeValue, (attribute) => Effect.succeed(attribute)),
      Match.orElse(() =>
        Effect.fail(new ReactiveError({ message: "Attributes require Option<true | string>" })),
      ),
    ),
  );
// https://dom.spec.whatwg.org/#valid-attribute-local-name
const invalidAttributeCharacters = /[\t\n\f\r /=>]/u;
export const attributeNameValid = (name: string): boolean =>
  name.length > 0 &&
  !invalidAttributeCharacters.test(name) &&
  !name.includes("\u0000") &&
  !name.toLowerCase().startsWith("on") &&
  name.toLowerCase() !== "srcdoc";

export const claimDestination = Effect.fn("Budgerigar.claimDestination")(function* (options: {
  element: HTMLElement;
  kind: "attribute" | "property";
  name: string;
  reactive: boolean;
}) {
  const key = destination(options);
  const existing = declarations.get(options.element) ?? [];
  yield* requireValid(
    !existing.some((entry) => entry.destination === key && (entry.reactive || options.reactive)),
    `Conflicting DOM destination ${options.name}`,
  );
  declarations.set(options.element, [
    ...existing,
    { destination: key, reactive: options.reactive },
  ]);
});

const reportAssignment = (options: {
  runtime: ReactiveRuntime;
  resource: DomResource;
  error: ReactiveError;
  report?: Option.Option<ComponentLifetime["report"]>;
}): Effect.Effect<void> =>
  Effect.sync(() => {
    // The handler may be asynchronous or throw before returning its Effect. Run
    // reporting separately so it cannot delay or interrupt the synchronous flush.
    Effect.runFork(
      Effect.suspend(() =>
        Option.getOrElse(
          options.report ?? Option.none(),
          () => options.runtime.lifetime.report,
        )({
          operation: "reactive-dom",
          resource: options.resource,
          cause: Cause.die(
            Option.getOrElse(Option.fromUndefinedOr(options.error.cause), () => options.error),
          ),
        }),
      ).pipe(Effect.catchCause(() => Effect.void)),
    );
  });

const assignOwned = (options: {
  runtime: ReactiveRuntime;
  resource: DomResource;
  write: Effect.Effect<void, ReactiveError>;
  report?: Option.Option<ComponentLifetime["report"]>;
}): Effect.Effect<void> =>
  options.write.pipe(Effect.catch((error) => reportAssignment({ ...options, error })));

export const assign = (options: {
  runtime: Option.Option<ReactiveRuntime>;
  resource: DomResource;
  write: Effect.Effect<void, ReactiveError>;
}): Effect.Effect<void, ReactiveError> =>
  Option.match(options.runtime, {
    onNone: () => options.write,
    onSome: (runtime) => assignOwned({ ...options, runtime }),
  });

export const registerBinding = Effect.fn("Budgerigar.registerBinding")(function* <A>(options: {
  runtime: ReactiveRuntime;
  node: Node;
  signal: Signal<A>;
  kind: BindingKind;
  name: string;
  validate: (value: A) => Effect.Effect<unknown, ReactiveError>;
  write: (value: A) => Effect.Effect<void, ReactiveError>;
  activate?: () => () => void;
  initialize?: (write: Effect.Effect<void, ReactiveError>) => void;
}) {
  yield* accessible({
    consumer: options.runtime.lifetime,
    producer: signalData(options.signal).participant.lifetime,
  });
  const initial = yield* options.signal.get;
  yield* options.validate(initial);
  const resource: DomResource = { element: options.node, kind: options.kind, name: options.name };
  const binding: Binding = {
    issuer: options.runtime,
    report: Option.none(),
    signal: options.signal,
    validate: (transaction) =>
      Effect.suspend(() =>
        options.validate(signalData(options.signal).candidate(transaction)),
      ).pipe(Effect.asVoid),
    flush: () =>
      assignOwned({
        runtime: options.runtime,
        resource,
        report: binding.report,
        write: Effect.suspend(() =>
          options.write(signalData(options.signal).candidate(Option.none())),
        ),
      }),
    start: () => options.activate?.() ?? (() => {}),
  };
  const initialize = assign({
    runtime: Option.some(options.runtime),
    resource,
    write: options.write(initial),
  });
  yield* Option.match(Option.fromUndefinedOr(options.initialize), {
    onNone: () => initialize,
    onSome: (schedule) => Effect.sync(() => schedule(initialize)),
  });
  bindings.set(options.node, [...(bindings.get(options.node) ?? []), binding]);
});

export const bindEntry = Effect.fn("Budgerigar.bindEntry")(function* (options: {
  runtime: Option.Option<ReactiveRuntime>;
  element: HTMLElement;
  kind: "attribute" | "property";
  name: string;
  value: unknown;
  validate: (value: unknown) => Effect.Effect<unknown, ReactiveError>;
  write: (value: unknown) => Effect.Effect<void, ReactiveError>;
  initialize?: (write: Effect.Effect<void, ReactiveError>) => void;
}) {
  const { value, element, name, kind } = options;
  yield* claimDestination({ element, kind, name, reactive: isSignal(value) });
  yield* Match.value(value).pipe(
    Match.when(isSignal, (signal) =>
      Option.match(options.runtime, {
        onNone: () =>
          Effect.fail(new ReactiveError({ message: "Reactive DOM requires a component owner" })),
        onSome: (runtime) => registerBinding({ ...options, runtime, node: element, signal }),
      }),
    ),
    Match.orElse((value) =>
      Effect.gen(function* () {
        yield* options.validate(value);
        const initialize = assign({
          runtime: options.runtime,
          resource: { element, kind, name },
          write: options.write(value),
        });
        yield* Option.match(Option.fromUndefinedOr(options.initialize), {
          onNone: () => initialize,
          onSome: (schedule) => Effect.sync(() => schedule(initialize)),
        });
      }),
    ),
  );
});

export const validateReactiveNode = (options: {
  node: Node;
  runtime: Option.Option<ReactiveRuntime>;
}): Effect.Effect<void, ReactiveError> =>
  Effect.gen(function* () {
    for (const binding of bindings.get(options.node) ?? []) {
      yield* Option.match(options.runtime, {
        onNone: () =>
          Effect.fail(new ReactiveError({ message: "Reactive DOM requires its issuing runtime" })),
        onSome: (runtime) =>
          requireValid(
            runtime === binding.issuer &&
              runtime.lifetime.active() &&
              signalData(binding.signal).participant.lifetime.active(),
            "Reactive DOM belongs to a foreign or disposed runtime",
          ),
      });
      yield* binding.validate(Option.none());
    }
  });

export const activateReactiveNode = Effect.fn("Budgerigar.activateReactiveNode")(
  function* (options: {
    node: Node;
    lifetime: { readonly cleanups: Set<() => void> };
    report?: Option.Option<ComponentLifetime["report"]>;
  }) {
    activated.add(options.node);
    for (const binding of bindings.get(options.node) ?? []) {
      binding.report = options.report ?? Option.none();
      yield* binding.flush();
      const disconnect = signalData(binding.signal).bind(binding);
      const stopIngress = binding.start();
      options.lifetime.cleanups.add(() => {
        stopIngress();
        disconnect();
        bindings.set(
          options.node,
          (bindings.get(options.node) ?? []).filter((entry) => entry !== binding),
        );
      });
    }
  },
);

export const writeAttribute = Effect.fn("Budgerigar.writeAttribute")(function* (options: {
  element: HTMLElement;
  name: string;
  value: unknown;
}) {
  const value = yield* validateAttribute(options.value);
  yield* calculate(() =>
    Option.match(value, {
      onNone: () =>
        Match.value(options.element.hasAttribute(options.name)).pipe(
          Match.when(true, () => options.element.removeAttribute(options.name)),
          Match.orElse(() => {}),
        ),
      onSome: (value) => {
        const text = Match.value(value).pipe(
          Match.when(true, () => ""),
          Match.orElse((text) => text),
        );
        Match.value(options.element.getAttribute(options.name) !== text).pipe(
          Match.when(true, () => options.element.setAttribute(options.name, text)),
          Match.orElse(() => {}),
        );
      },
    }),
  );
});
