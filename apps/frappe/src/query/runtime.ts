import { Effect, Equal, Match, Option, Result, type Scope } from "effect";
import type { Structural } from "~/requirements";
import { resourceEnvironment } from "~/resource-runtime";
import {
  calculateSync,
  requireValid,
  type ReactiveError,
  type CommitCoordinator,
  type ReactiveRuntime,
  type Transaction,
} from "~/reactive/runtime";
import { readSync, signalData, type Signal } from "~/reactive/signal";
import type { Configure } from "./api";
import type { Definition } from "./definition";
import { snapshot, type Key } from "./key";
import {
  notify,
  PartitionChanged,
  type AnyDefinition,
  type FrameworkError,
  type Store,
} from "./entry";
import { consume, invalidate } from "./execution";
import { retire } from "./policy";
import { createStore } from "./store";

export interface Binding {
  readonly store: Store;
  readonly partition: Signal<Option.Option<unknown>>;
  readonly observers: Set<() => void>;
  readonly requests: Set<
    (options: {
      readonly definition: AnyDefinition;
      readonly key: Key<unknown>;
      readonly transaction: Option.Option<Transaction>;
    }) => boolean
  >;
}
const bindings = new WeakMap<CommitCoordinator, Binding>();
export const binding = (runtime: ReactiveRuntime) =>
  Option.match(Option.fromUndefinedOr(bindings.get(runtime.coordinator)), {
    onSome: (b) => b,
    onNone: () => {
      throw new TypeError("frappé queries require Query.configure before query use");
    },
  });
// Definition erasure is confined to this checked runtime boundary. Each entry is only
// looked up with its opaque definition identity and canonical input.
export const erase = <I, A, E, R>(query: Definition<I, A, E, R>): AnyDefinition =>
  query as unknown as AnyDefinition;
export const partitionKey = (partition: Option.Option<unknown>) =>
  Option.map(partition, (p) => snapshot(p).input);
export const equalPartition = (a: Option.Option<unknown>, b: Option.Option<unknown>) =>
  Option.match(a, {
    onNone: () => Option.isNone(b),
    onSome: (value) => Option.exists(b, (other) => Equal.equals(value, other)),
  });
export const configure =
  (runtime: ReactiveRuntime): Configure =>
  (options) =>
    Effect.gen(function* () {
      yield* requireValid(runtime.lifetime.active(), "Query runtime has been disposed");
      yield* requireValid(
        !bindings.has(runtime.coordinator),
        "Queries can only be configured once",
      );
      const data = signalData(options.partition);
      yield* requireValid(
        data.participant.lifetime === runtime.lifetime,
        "Query partition must be owned by the application runtime",
      );
      const initial = yield* Effect.fromResult(readSync({ runtime, signal: options.partition }));
      const installed = yield* Effect.fromResult(calculateSync(() => resourceEnvironment(runtime)));
      const partition = yield* Effect.fromResult(calculateSync(() => partitionKey(initial)));
      const store = yield* Effect.fromResult(
        calculateSync(() => createStore({ runtime, ...installed, policy: options })),
      );
      store.partition = partition;
      const observers = new Set<() => void>();
      const b: Binding = { store, partition: options.partition, observers, requests: new Set() };
      const disconnect = data.bind({
        validate: (tx) =>
          data.candidate(tx).pipe(
            Result.flatMap((p) => calculateSync(() => partitionKey(p))),
            Result.map(() => undefined),
          ),
        flush: () =>
          Effect.sync(() => {
            const next = partitionKey(data.committed());
            Match.value(equalPartition(store.partition, next)).pipe(
              Match.when(false, () => {
                retire(store, new PartitionChanged());
                store.partition = next;
                for (const observer of observers) observer();
              }),
              Match.orElse(() => {}),
            );
          }),
      });
      bindings.set(runtime.coordinator, b);
      runtime.lifetime.cleanups.add(disconnect);
      const read = <I, A, E, R>(
        input: { readonly query: Definition<I, A, E, R>; readonly input: I },
        refresh: boolean,
      ): Effect.Effect<
        A,
        E | FrameworkError | ReactiveError,
        Structural<Exclude<R, Scope.Scope>>
      > =>
        // The entry preserves loader A/E. No caller environment is provided to execution.
        Effect.gen(function* () {
          const key = yield* Effect.fromResult(calculateSync(() => input.query.key(input.input)));
          return yield* consume({ store, definition: erase(input.query), key, refresh });
        }) as Effect.Effect<
          A,
          E | FrameworkError | ReactiveError,
          Structural<Exclude<R, Scope.Scope>>
        >;
      return {
        get: (input) => read(input, false),
        refresh: (input) => read(input, true),
        invalidate: (input) =>
          Effect.gen(function* () {
            yield* requireValid(runtime.lifetime.active(), "Query runtime has been disposed");
            const key = yield* Effect.fromResult(calculateSync(() => input.query.key(input.input)));
            Option.match(store.peek(erase(input.query), key), {
              onNone: () => {},
              onSome: (entry) => invalidate(store, [entry]),
            });
            yield* notify(store);
          }),
        invalidateDefinition: (input) =>
          Effect.gen(function* () {
            yield* requireValid(runtime.lifetime.active(), "Query runtime has been disposed");
            invalidate(
              store,
              Array.from(store.entries).filter(
                (e) => e.definition.identity === input.query.identity,
              ),
            );
            yield* notify(store);
          }),
      };
    });
