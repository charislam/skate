import { Effect, Match, Option, Queue, Stream, type Scope } from "effect";
import {
  accessible,
  calculate,
  poison,
  reportFailure,
  requireValid,
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

export const checkEvents = (options: { runtime: ReactiveRuntime; events: EventStream<unknown> }) =>
  requireValid(options.runtime.lifetime.active(), "Reactive runtime has been disposed").pipe(
    Effect.andThen(
      Effect.forEach(
        eventData(options.events).runtimes,
        (producer) =>
          accessible({ consumer: options.runtime.lifetime, producer: producer.lifetime }),
        { discard: true },
      ),
    ),
  );

export const eventStream = <A>(options: {
  runtime: ReactiveRuntime;
  events: EventStream<A>;
}): Effect.Effect<Stream.Stream<A>, ReactiveError> =>
  Effect.gen(function* () {
    yield* checkEvents(options);
    const queue = yield* Queue.unbounded<A>();
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

export const domEvents = <K extends keyof HTMLElementEventMap>(options: {
  runtime: ReactiveRuntime;
  element: HTMLElement;
  name: K;
  synchronous?: (event: HTMLElementEventMap[K]) => void;
}): Effect.Effect<EventStream<HTMLElementEventMap[K]>, ReactiveError> =>
  Effect.gen(function* () {
    const { runtime, element, name } = options;
    yield* requireValid(runtime.lifetime.active(), "Reactive runtime has been disposed");
    const source = createSource<HTMLElementEventMap[K]>(runtime);
    let references = 0;
    const listener = (event: HTMLElementEventMap[K]) => {
      options.synchronous?.(event);
      Match.value(runtime.lifetime.active()).pipe(
        Match.when(true, () =>
          Queue.offerUnsafe(runtime.eventQueue, {
            resource: source.events,
            work: source.dispatch(event),
          }),
        ),
        Match.orElse(() => false),
      );
    };
    runtime.lifetime.cleanups.add(() => element.removeEventListener(name, listener));
    return {
      [EventState]: {
        runtimes: eventData(source.events).runtimes,
        connect: (delivery: Delivery<HTMLElementEventMap[K]>) => {
          const disconnect = eventData(source.events).connect(delivery);
          references += 1;
          element.addEventListener(name, listener);
          return () => {
            disconnect();
            references -= 1;
            Match.value(references === 0).pipe(
              Match.when(true, () => element.removeEventListener(name, listener)),
              Match.orElse(() => {}),
            );
          };
        },
      },
    };
  });
