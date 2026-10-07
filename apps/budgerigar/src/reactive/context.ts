import { Context, Effect, Result, Option, Stream, type Scope } from "effect";
import { capturedWork } from "~/deferred-context";
import { nativeNode, type ElementOutput } from "~/output";
import { fromResultLazy, withContext, runResult, gen as syncGen, type Sync } from "~/sync";
import { lazy } from "~/synchronous";
import {
  checkEventsSync,
  createSource,
  domEventsSync,
  eventData,
  eventStreamSync,
  type EventSource,
  type EventStream,
} from "./events";
import { bindValueSync } from "./input";
import {
  synchronousTransactions,
  CurrentTransaction,
  reportFailure,
  requireValid,
  requireValidSync,
  runBatch,
  ReactiveError,
  type ReactiveRuntime,
} from "./runtime";
import {
  deriveSync,
  makeCell,
  readSync,
  readonlySignal,
  type Signal,
  type WritableSignal,
  type SignalOptions,
  type Sources,
  type Values,
  type Equality,
} from "./signal";

const resultReactive = (runtime: ReactiveRuntime) => {
  const valid = () =>
    requireValidSync(runtime.lifetime.active(), "Reactive runtime has been disposed");
  const signal = <A>(options: SignalOptions<A>): Result.Result<WritableSignal<A>, ReactiveError> =>
    valid().pipe(
      Result.map(() => makeCell({ ...options, runtime, dependencies: [], compute: Option.none() })),
    );
  const subscribeStream = <A, E>(
    stream: Stream.Stream<A, E, Scope.Scope>,
    handler: (value: A) => Effect.Effect<unknown, unknown, Scope.Scope>,
  ): Result.Result<void, ReactiveError> =>
    valid().pipe(
      Result.andThen(() =>
        runtime.lifetime.registerWork(
          Stream.runForEach(stream, (value) =>
            Effect.suspend(() => handler(value)).pipe(
              Effect.catchCause((cause) => reportFailure({ runtime, resource: stream, cause })),
            ),
          ).pipe(
            Effect.provideService(CurrentTransaction, Option.none()),
            Effect.catchCause((cause) => reportFailure({ runtime, resource: stream, cause })),
          ),
        ),
      ),
    );
  return {
    signal,
    read: <A>(input: Signal<A>) => readSync({ runtime, signal: input }),
    derive: <S extends Sources, A>(options: {
      sources: S;
      compute: (values: Values<S>) => A;
      equals?: Equality<A>;
    }) => deriveSync({ ...options, runtime }),
    combine: <S extends Sources>(sources: S) => {
      const inputs = { ...sources };
      return deriveSync({
        runtime,
        sources: inputs,
        compute: (values) => values,
        equals: ({ previous, proposed }) =>
          Object.keys(inputs).every((key) =>
            Object.is(Reflect.get(previous, key), Reflect.get(proposed, key)),
          ),
      });
    },
    batch: <A, E>(work: () => Result.Result<A, E>): Result.Result<A, E | ReactiveError> =>
      Result.gen(function* () {
        yield* valid();
        yield* requireValidSync(
          !runtime.coordinator.committing,
          "Reentrant commits during DOM flushing are not allowed",
        );
        yield* requireValidSync(typeof work === "function", "Result batches require a thunk");
        return yield* Effect.runSync(
          runBatch({
            runtime,
            work: Effect.gen(function* () {
              const transaction = yield* CurrentTransaction;
              const previous = Option.fromUndefinedOr(
                synchronousTransactions.get(runtime.coordinator),
              );
              Option.match(transaction, {
                onNone: () => {},
                onSome: (transaction) =>
                  synchronousTransactions.set(runtime.coordinator, transaction),
              });
              return yield* Effect.suspend(() => {
                const result = work();
                return requireValid(
                  Result.isResult(result),
                  "Result batches require a Result body",
                ).pipe(Effect.andThen(() => Effect.fromResult(result)));
              }).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    Option.match(previous, {
                      onNone: () => synchronousTransactions.delete(runtime.coordinator),
                      onSome: (transaction) =>
                        synchronousTransactions.set(runtime.coordinator, transaction),
                    });
                  }),
                ),
              );
            }),
          }).pipe(Effect.result),
        );
      }),
    source: <A>(): Result.Result<EventSource<A>, ReactiveError> =>
      valid().pipe(Result.map(() => createSource<A>(runtime))),
    bindValue: (options: {
      element: HTMLInputElement | HTMLTextAreaElement;
      signal: WritableSignal<string>;
    }) => bindValueSync({ ...options, runtime }),
    events: <K extends keyof HTMLElementEventMap>(
      element: HTMLElement,
      name: K,
      options: { synchronous?: (event: HTMLElementEventMap[K]) => void } = {},
    ) => domEventsSync({ runtime, element, name, ...options }),
    fold: <A, B>(options: {
      events: EventStream<A>;
      initial: B;
      reducer: (options: { readonly state: B; readonly event: A }) => B;
      equals?: Equality<B>;
    }): Result.Result<Signal<B>, ReactiveError> =>
      Result.gen(function* () {
        yield* checkEventsSync({ runtime, events: options.events });
        const cell = yield* signal(options);
        const disconnect = eventData(options.events).connect((event) =>
          cell.update((state) => options.reducer({ state, event })),
        );
        runtime.lifetime.cleanups.add(disconnect);
        const { set: _set, update: _update, ...readOnly } = cell;
        return readOnly;
      }),
    toStream: <A>(events: EventStream<A>) => eventStreamSync({ runtime, events }),
    subscribe: <A>(
      events: EventStream<A>,
      handler: (value: A) => Effect.Effect<unknown, unknown, Scope.Scope>,
    ) =>
      eventStreamSync({ runtime, events }).pipe(
        Result.flatMap((stream) => subscribeStream(stream, handler)),
      ),
    subscribeStream,
    foldStream: <A, B, E>(options: {
      stream: Stream.Stream<A, E, Scope.Scope>;
      initial: B;
      reducer: (options: { readonly state: B; readonly event: A }) => B;
      equals?: Equality<B>;
    }): Result.Result<Signal<B>, ReactiveError> =>
      Result.gen(function* () {
        const cell = yield* signal(options);
        yield* subscribeStream(options.stream, (event) =>
          cell.update((state) => options.reducer({ state, event })),
        );
        const { set: _set, update: _update, ...readOnly } = cell;
        return readOnly;
      }),
  };
};

export const reactive = (runtime: ReactiveRuntime) => {
  const sync = resultReactive(runtime);
  const helpers = {
    signal: <A>(options: SignalOptions<A>) => lazy(() => sync.signal(options)),
    read: <A>(signal: Signal<A>) => lazy(() => sync.read(signal)),
    derive: <S extends Sources, A>(options: {
      sources: S;
      compute: (values: Values<S>) => A;
      equals?: Equality<A>;
    }) => lazy(() => sync.derive(options)),
    combine: <S extends Sources>(sources: S) => lazy(() => sync.combine(sources)),
    batch: <A, E, R>(work: Effect.Effect<A, E, R>) => runBatch({ runtime, work }),
    source: <A>() => lazy(() => sync.source<A>()),
    bindValue: (options: {
      element: ElementOutput<HTMLInputElement | HTMLTextAreaElement, unknown>;
      signal: WritableSignal<string>;
    }) => lazy(() => sync.bindValue({ ...options, element: nativeNode(options.element) })),
    events: <K extends keyof HTMLElementEventMap>(
      element: ElementOutput<HTMLElement, unknown>,
      name: K,
      options: { synchronous?: (event: HTMLElementEventMap[K]) => void } = {},
    ) => lazy(() => sync.events(nativeNode(element), name, options)),
    fold: <A, B>(options: {
      events: EventStream<A>;
      initial: B;
      reducer: (options: { readonly state: B; readonly event: A }) => B;
      equals?: Equality<B>;
    }) => lazy(() => sync.fold(options)),
    toStream: <A>(events: EventStream<A>) => lazy(() => sync.toStream(events)),
    subscribe: <A, E, R>(
      events: EventStream<A>,
      handler: (value: A) => Effect.Effect<unknown, E, R>,
    ): Effect.Effect<void, ReactiveError, Exclude<R, Scope.Scope>> =>
      Effect.context<Exclude<R, Scope.Scope>>().pipe(
        Effect.flatMap((context) =>
          lazy(() =>
            sync.subscribe(events, (value) =>
              capturedWork({ work: Effect.suspend(() => handler(value)), context }),
            ),
          ),
        ),
      ),
    subscribeStream: <A, E, R, EH, RH>(
      stream: Stream.Stream<A, E, R>,
      handler: (value: A) => Effect.Effect<unknown, EH, RH>,
    ): Effect.Effect<void, ReactiveError, Exclude<R | RH, Scope.Scope>> =>
      Effect.context<Exclude<R | RH, Scope.Scope>>().pipe(
        Effect.flatMap((context) =>
          lazy(() =>
            runtime.lifetime.registerWork(
              capturedWork({
                context,
                work: Stream.runForEach(stream, (value) =>
                  Effect.suspend(() => handler(value)).pipe(
                    Effect.catchCause((cause) =>
                      reportFailure({ runtime, resource: stream, cause }),
                    ),
                  ),
                ).pipe(
                  Effect.catchCause((cause) => reportFailure({ runtime, resource: stream, cause })),
                ),
              }),
            ),
          ),
        ),
      ),
    foldStream: <A, B, E, R>(options: {
      stream: Stream.Stream<A, E, R>;
      initial: B;
      reducer: (options: { readonly state: B; readonly event: A }) => B;
      equals?: Equality<B>;
    }): Effect.Effect<Signal<B>, ReactiveError, Exclude<R, Scope.Scope>> =>
      Effect.gen(function* () {
        const cell = yield* helpers.signal(options);
        yield* helpers.subscribeStream(options.stream, (event) =>
          cell.update((state) => options.reducer({ state, event })),
        );
        return readonlySignal(cell);
      }),
  };
  return helpers;
};

export const synchronousReactive = (runtime: ReactiveRuntime) => {
  const sync = resultReactive(runtime);
  const helpers = {
    signal: <A>(options: SignalOptions<A>) => fromResultLazy(() => sync.signal(options)),
    read: <A>(signal: Signal<A>) => fromResultLazy(() => sync.read(signal)),
    derive: <S extends Sources, A>(options: {
      sources: S;
      compute: (values: Values<S>) => A;
      equals?: Equality<A>;
    }) => fromResultLazy(() => sync.derive(options)),
    combine: <S extends Sources>(sources: S) => fromResultLazy(() => sync.combine(sources)),
    batch: <A, E, R>(work: () => Sync<A, E, R>): Sync<A, E | ReactiveError, R> =>
      withContext((context) =>
        sync.batch(() =>
          runResult({
            computation: work(),
            context: Context.add(
              context,
              CurrentTransaction,
              Option.fromUndefinedOr(synchronousTransactions.get(runtime.coordinator)),
            ),
          }),
        ),
      ),
    source: <A>() => fromResultLazy(() => sync.source<A>()),
    bindValue: (options: {
      element: ElementOutput<HTMLInputElement | HTMLTextAreaElement, unknown>;
      signal: WritableSignal<string>;
    }) =>
      fromResultLazy(() => sync.bindValue({ ...options, element: nativeNode(options.element) })),
    events: <K extends keyof HTMLElementEventMap>(
      element: ElementOutput<HTMLElement, unknown>,
      name: K,
      options: { synchronous?: (event: HTMLElementEventMap[K]) => void } = {},
    ) => fromResultLazy(() => sync.events(nativeNode(element), name, options)),
    fold: <A, B>(options: {
      events: EventStream<A>;
      initial: B;
      reducer: (options: { readonly state: B; readonly event: A }) => B;
      equals?: Equality<B>;
    }) => fromResultLazy(() => sync.fold(options)),
    toStream: <A>(events: EventStream<A>) => fromResultLazy(() => sync.toStream(events)),
    subscribe: <A, E, R>(
      events: EventStream<A>,
      handler: (value: A) => Effect.Effect<unknown, E, R>,
    ): Sync<void, ReactiveError, Exclude<R, Scope.Scope>> =>
      withContext((context) =>
        sync.subscribe(events, (value) =>
          capturedWork({ work: Effect.suspend(() => handler(value)), context }),
        ),
      ),
    subscribeStream: <A, E, R, EH, RH>(
      stream: Stream.Stream<A, E, R>,
      handler: (value: A) => Effect.Effect<unknown, EH, RH>,
    ): Sync<void, ReactiveError, Exclude<R | RH, Scope.Scope>> =>
      withContext((context) =>
        runtime.lifetime.registerWork(
          capturedWork({
            context,
            work: Stream.runForEach(stream, (value) =>
              Effect.suspend(() => handler(value)).pipe(
                Effect.catchCause((cause) => reportFailure({ runtime, resource: stream, cause })),
              ),
            ).pipe(
              Effect.catchCause((cause) => reportFailure({ runtime, resource: stream, cause })),
            ),
          }),
        ),
      ),
    foldStream: <A, B, E, R>(options: {
      stream: Stream.Stream<A, E, R>;
      initial: B;
      reducer: (options: { readonly state: B; readonly event: A }) => B;
      equals?: Equality<B>;
    }): Sync<Signal<B>, ReactiveError, Exclude<R, Scope.Scope>> =>
      syncGen(function* () {
        const cell = yield* helpers.signal(options);
        yield* helpers.subscribeStream(options.stream, (event) =>
          cell.update((state) => options.reducer({ state, event })),
        );
        return readonlySignal(cell);
      }),
  };
  return helpers;
};
export type SynchronousReactiveContext = ReturnType<typeof synchronousReactive>;
export type ReactiveContext = ReturnType<typeof reactive>;
