import { Effect, Match, Option, Predicate, Queue, Result, Stream, type Scope } from "effect";
import { isElementOutput, nativeNode, type ElementOutput } from "~/output";
import { lazy } from "~/synchronous";
import {
  accessibleSync,
  calculate,
  calculateSync,
  poison,
  reportFailure,
  requireValidSync,
  runBatch,
  transactionFor,
  ReactiveError,
  type ReactiveRuntime,
  type Transaction,
  CurrentTransaction,
} from "./runtime";

type Delivery<A> = (value: A, transaction: Transaction) => Effect.Effect<void, ReactiveError>;
const EventState = Symbol("Budgerigar/EventStream");
interface EventData<A> {
  readonly runtimes: ReadonlyArray<ReactiveRuntime>;
  readonly connect: (delivery: Delivery<A>) => () => void;
}

/** Synchronous composition preserves transactional participation and ingress order. */
export interface EventStream<A> {
  readonly [EventState]: EventData<A>;
}

export const eventData = <A>(events: EventStream<A>): EventData<A> => events[EventState];

export interface EventSource<A> {
  readonly events: EventStream<A>;
  readonly emit: (value: A) => Effect.Effect<void, ReactiveError>;
}

export const mapEvents = <A, B>(events: EventStream<A>, f: (value: A) => B): EventStream<B> => ({
  [EventState]: {
    runtimes: eventData(events).runtimes,
    connect: (delivery) =>
      eventData(events).connect((value, transaction) =>
        calculate(() => f(value)).pipe(Effect.flatMap((mapped) => delivery(mapped, transaction))),
      ),
  },
});

export const mergeEvents = <A>(events: ReadonlyArray<EventStream<A>>): EventStream<A> => {
  const inputs = [...events];
  return {
    [EventState]: {
      runtimes: inputs.flatMap((event) => eventData(event).runtimes),
      connect: (delivery) => {
        const disconnect = inputs.map((event) => eventData(event).connect(delivery));
        return () => {
          for (const stop of disconnect) stop();
        };
      },
    },
  };
};

export const createSource = <A>(
  runtime: ReactiveRuntime,
): EventSource<A> & { readonly dispatch: (value: A) => Effect.Effect<void, ReactiveError> } => {
  const deliveries = new Set<Delivery<A>>();
  runtime.lifetime.cleanups.add(() => deliveries.clear());
  const dispatch = (value: A) => {
    const current = [...deliveries];
    return runBatch({
      runtime,
      work: Effect.gen(function* () {
        const transaction = yield* transactionFor(runtime).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new ReactiveError({ message: "Missing event transaction" })),
              onSome: Effect.succeed,
            }),
          ),
        );
        for (const delivery of current)
          yield* poison({ transaction, work: delivery(value, transaction) });
      }),
    });
  };
  return {
    events: {
      [EventState]: {
        runtimes: [runtime],
        connect: (delivery) => {
          let connected = true;
          const guarded: Delivery<A> = (value, transaction) =>
            Effect.suspend(() =>
              Match.value(connected).pipe(
                Match.when(true, () => delivery(value, transaction)),
                Match.orElse(() => Effect.void),
              ),
            );
          deliveries.add(guarded);
          return () => {
            connected = false;
            deliveries.delete(guarded);
          };
        },
      },
    },
    emit: (value) => Effect.suspend(() => dispatch(value)),
    dispatch,
  };
};

export const checkEventsSync = (options: {
  runtime: ReactiveRuntime;
  events: EventStream<unknown>;
}) =>
  Result.gen(function* () {
    yield* requireValidSync(
      options.runtime.lifetime.active(),
      "Reactive runtime has been disposed",
    );
    for (const producer of eventData(options.events).runtimes)
      yield* accessibleSync({ consumer: options.runtime.lifetime, producer: producer.lifetime });
  });

export const eventStreamSync = <A>(options: {
  runtime: ReactiveRuntime;
  events: EventStream<A>;
}): Result.Result<Stream.Stream<A>, ReactiveError> =>
  Result.gen(function* () {
    yield* checkEventsSync(options);
    const queue = Effect.runSync(Queue.unbounded<A>());
    const disconnect = eventData(options.events).connect((value, transaction) =>
      Effect.sync(() => {
        transaction.publications.push(() => {
          Match.value(options.runtime.lifetime.active()).pipe(
            Match.when(true, () => Queue.offerUnsafe(queue, value)),
            Match.orElse(() => false),
          );
        });
      }),
    );
    const stop = () => {
      disconnect();
      Effect.runSync(Queue.shutdown(queue));
      options.runtime.lifetime.cleanups.delete(stop);
    };
    options.runtime.lifetime.cleanups.add(stop);
    return Stream.fromQueue(queue).pipe(Stream.ensuring(Effect.sync(stop)));
  });

export const subscribeStream = <A, E>(options: {
  runtime: ReactiveRuntime;
  stream: Stream.Stream<A, E, Scope.Scope>;
  handler: (value: A) => Effect.Effect<unknown, unknown, Scope.Scope>;
}) =>
  options.runtime.lifetime.fork(
    Stream.runForEach(options.stream, (value) =>
      Effect.suspend(() => options.handler(value)).pipe(
        Effect.catchCause((cause) =>
          reportFailure({ runtime: options.runtime, resource: options.stream, cause }),
        ),
      ),
    ).pipe(
      Effect.provideService(CurrentTransaction, Option.none()),
      Effect.catchCause((cause) =>
        reportFailure({ runtime: options.runtime, resource: options.stream, cause }),
      ),
    ),
  );

export type DomEventTarget =
  | ElementOutput<HTMLElement, unknown>
  | Document
  | Window
  | VisualViewport;
export type DomEventMap<T extends DomEventTarget> = T extends Document
  ? DocumentEventMap
  : T extends Window
    ? WindowEventMap
    : T extends VisualViewport
      ? VisualViewportEventMap
      : HTMLElementEventMap;
export type DomEvent<T extends DomEventTarget, K extends keyof DomEventMap<T>> = Extract<
  DomEventMap<T>[K],
  Event
>;
export interface DomEventOptions<E extends Event> {
  readonly capture?: boolean;
  readonly passive?: boolean;
  readonly synchronous?: (event: E) => void;
}
const isNativeGlobalTarget = (value: unknown): value is Document | Window | VisualViewport =>
  (Predicate.hasProperty(value, "nodeType") &&
    value.nodeType === 9 &&
    Predicate.hasProperty(value, "createElement") &&
    typeof value.createElement === "function") ||
  (Predicate.hasProperty(value, "window") &&
    value.window === value &&
    Predicate.hasProperty(value, "document")) ||
  Object.prototype.toString.call(value) === "[object VisualViewport]";

export const nativeEventTarget = (
  target: DomEventTarget,
): Result.Result<EventTarget, ReactiveError> =>
  Match.value(target).pipe(
    Match.when(isElementOutput, (output) => Result.succeed(nativeNode(output))),
    Match.when(isNativeGlobalTarget, (target) => Result.succeed(target)),
    Match.orElse(() =>
      Result.fail(
        new ReactiveError({
          message: "DOM events require an element output, Document, Window, or VisualViewport",
        }),
      ),
    ),
  );

export const domEventsSync = <E extends Event>(
  options: {
    runtime: ReactiveRuntime;
    element: EventTarget;
    name: string;
  } & DomEventOptions<E>,
): Result.Result<EventStream<E>, ReactiveError> =>
  Result.gen(function* () {
    const { runtime, element, name } = options;
    yield* requireValidSync(runtime.lifetime.active(), "Reactive runtime has been disposed");
    const source = createSource<E>(runtime);
    let references = 0;
    const capture = options.capture ?? false;
    const listener: EventListener = (event) =>
      Match.value(references > 0 && runtime.lifetime.active()).pipe(
        Match.when(true, () => {
          // The public event-map signature proves E for this DOM target/name pair.
          const value = event as E;
          const synchronous = calculateSync(() => options.synchronous?.(value));
          const dispatch = source.dispatch(value);
          Queue.offerUnsafe(runtime.eventQueue, {
            resource: source.events,
            work: Effect.suspend(() =>
              Match.value(runtime.lifetime.active()).pipe(
                Match.when(true, () =>
                  Effect.fromResult(synchronous).pipe(Effect.andThen(dispatch)),
                ),
                Match.when(false, () => Effect.void),
                Match.exhaustive,
              ),
            ),
          });
        }),
        Match.orElse(() => {}),
      );
    runtime.lifetime.cleanups.add(() => element.removeEventListener(name, listener, capture));
    return {
      [EventState]: {
        runtimes: eventData(source.events).runtimes,
        connect: (delivery: Delivery<E>) => {
          const disconnect = eventData(source.events).connect(delivery);
          references += 1;
          element.addEventListener(name, listener, { capture, passive: options.passive ?? false });
          return () => {
            disconnect();
            references -= 1;
            Match.value(references === 0).pipe(
              Match.when(true, () => element.removeEventListener(name, listener, capture)),
              Match.orElse(() => {}),
            );
          };
        },
      },
    };
  });

export const checkEvents = (options: Parameters<typeof checkEventsSync>[0]) =>
  lazy(() => checkEventsSync(options));
export const eventStream = <A>(options: { runtime: ReactiveRuntime; events: EventStream<A> }) =>
  lazy(() => eventStreamSync(options));
export const domEvents = <E extends Event>(
  options: {
    runtime: ReactiveRuntime;
    element: EventTarget;
    name: string;
  } & DomEventOptions<E>,
) => lazy(() => domEventsSync(options));
