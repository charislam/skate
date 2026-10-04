import { Effect, Option, type Stream, type Scope } from "effect";
import {
  checkEvents,
  createSource,
  domEvents,
  eventData,
  eventStream,
  subscribeStream,
  type EventSource,
  type EventStream,
} from "./events";
import { requireValid, runBatch, ReactiveError, type ReactiveRuntime } from "./runtime";
import {
  derive,
  makeCell,
  type Signal,
  type WritableSignal,
  type SignalOptions,
  type Sources,
  type Values,
  type Equality,
} from "./signal";

import { bindValue } from "./input";

export const reactive = (runtime: ReactiveRuntime) => ({
  signal: <A>(options: SignalOptions<A>): Effect.Effect<WritableSignal<A>, ReactiveError> =>
    Effect.suspend(() =>
      requireValid(runtime.lifetime.active(), "Reactive runtime has been disposed").pipe(
        Effect.map(() =>
          makeCell({ ...options, runtime, dependencies: [], compute: Option.none() }),
        ),
      ),
    ),
  derive: <S extends Sources, A>(options: {
    sources: S;
    compute: (values: Values<S>) => A;
    equals?: Equality<A>;
  }) => derive({ ...options, runtime }),
  combine: <S extends Sources>(sources: S) =>
    Effect.suspend(() => {
      const inputs = { ...sources };
      return derive({
        runtime,
        sources: inputs,
        compute: (values) => values,
        equals: ({ previous: left, proposed: right }) =>
          Object.keys(inputs).every((key) =>
            Object.is(Reflect.get(left, key), Reflect.get(right, key)),
          ),
      });
    }),
  batch: <A, E, R>(work: Effect.Effect<A, E, R>) => runBatch({ runtime, work }),
  source: <A>(): Effect.Effect<EventSource<A>, ReactiveError> =>
    Effect.suspend(() =>
      requireValid(runtime.lifetime.active(), "Reactive runtime has been disposed").pipe(
        Effect.map(() => createSource<A>(runtime)),
      ),
    ),
  bindValue: (options: {
    element: HTMLInputElement | HTMLTextAreaElement;
    signal: WritableSignal<string>;
  }) => bindValue({ ...options, runtime }),
  events: <K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    name: K,
    options: { synchronous?: (event: HTMLElementEventMap[K]) => void } = {},
  ) => domEvents({ runtime, element, name, ...options }),
  fold: <A, B>(options: {
    events: EventStream<A>;
    initial: B;
    reducer: (options: { readonly state: B; readonly event: A }) => B;
    equals?: Equality<B>;
  }): Effect.Effect<Signal<B>, ReactiveError> =>
    Effect.gen(function* () {
      yield* checkEvents({ runtime, events: options.events });
      const cell = makeCell({ ...options, runtime, dependencies: [], compute: Option.none() });
      const reducer = options.reducer;
      const disconnect = eventData(options.events).connect((event) =>
        cell.update((state) => reducer({ state, event })),
      );
      runtime.lifetime.cleanups.add(disconnect);
      const { set: _set, update: _update, ...signal } = cell;
      return signal;
    }),
  toStream: <A>(events: EventStream<A>) => eventStream({ runtime, events }),
  subscribe: <A>(
    events: EventStream<A>,
    handler: (value: A) => Effect.Effect<unknown, unknown, Scope.Scope>,
  ): Effect.Effect<void, ReactiveError> =>
    eventStream({ runtime, events }).pipe(
      Effect.flatMap((stream) => subscribeStream({ runtime, stream, handler })),
    ),
  subscribeStream: <A, E>(
    stream: Stream.Stream<A, E, Scope.Scope>,
    handler: (value: A) => Effect.Effect<unknown, unknown, Scope.Scope>,
  ) =>
    Effect.suspend(() =>
      requireValid(runtime.lifetime.active(), "Reactive runtime has been disposed").pipe(
        Effect.andThen(subscribeStream({ runtime, stream, handler })),
      ),
    ),
  foldStream: <A, B, E>(options: {
    stream: Stream.Stream<A, E, Scope.Scope>;
    initial: B;
    reducer: (options: { readonly state: B; readonly event: A }) => B;
    equals?: Equality<B>;
  }): Effect.Effect<Signal<B>, ReactiveError> =>
    Effect.gen(function* () {
      yield* requireValid(runtime.lifetime.active(), "Reactive runtime has been disposed");
      const cell = makeCell({ ...options, runtime, dependencies: [], compute: Option.none() });
      yield* subscribeStream({
        runtime,
        stream: options.stream,
        handler: (event) => cell.update((state) => options.reducer({ state, event })),
      });
      const { set: _set, update: _update, ...signal } = cell;
      return signal;
    }),
});

export type ReactiveContext = ReturnType<typeof reactive>;
