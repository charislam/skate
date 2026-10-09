import { DateTime, Effect, Equal, Match, Option, Result, type Scope } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import {
  accessibleSync,
  activeInTransaction,
  calculateSync,
  requireValidSync,
  type ReactiveError,
  type ReactiveRuntime,
} from "~/reactive/runtime";
import type { Structural } from "~/requirements";
import { makeCell, readonlySignal, signalData, type Signal } from "~/reactive/signal";
import type { Observe, ObserveOptions } from "./api";
import { duration } from "./definition";
import { notify, type Entry } from "./entry";
import { fetch } from "./execution";
import { trackInputs } from "./inputs";
import type { Key } from "./key";
import { activate, freshness, stale, unused } from "./policy";
import { binding, erase, equalPartition, partitionKey } from "./runtime";
import * as State from "./state";

export const observe =
  (runtime: ReactiveRuntime): Observe =>
  <I, A, E, R, Retain extends boolean = false>(options: ObserveOptions<I, A, E, R, Retain>) =>
    Effect.gen(function* () {
      yield* Effect.context<Structural<Exclude<R, Scope.Scope>>>();
      const b = yield* Effect.fromResult(calculateSync(() => binding(runtime)));
      const { store } = b;
      yield* Effect.fromResult(
        accessibleSync({
          consumer: runtime.lifetime,
          producer: signalData(options.input).participant.lifetime,
        }),
      );
      const definition = erase(options.query);
      const staleTime = yield* Effect.fromResult(
        calculateSync(() =>
          Option.getOrElse(Option.map(Option.fromUndefinedOr(options.staleTime), duration), () =>
            freshness(store, definition),
          ),
        ),
      );
      const observer = {};
      let attached: Option.Option<Entry> = Option.none();
      let partition = store.partition;
      let history: Option.Option<{ readonly key: Key<unknown>; readonly value: unknown }> =
        Option.none();
      const keyOf = (input: Option.Option<unknown>) => Option.map(input, (i) => definition.key(i));
      const inputData = signalData(options.input);
      const partitionData = signalData(b.partition);
      const requests: Parameters<typeof b.requests.add>[0] = (target) => {
        const active = Option.match(target.transaction, {
          onNone: () => runtime.lifetime.active(),
          onSome: (transaction) => activeInTransaction({ lifetime: runtime.lifetime, transaction }),
        });
        return Match.value(active && target.definition.identity === definition.identity).pipe(
          Match.when(false, () => false),
          Match.when(true, () => {
            const next = keyOf(Result.getOrThrow(inputData.candidate(target.transaction)));
            return Option.exists(
              next,
              (key) =>
                Equal.equals(key, target.key) &&
                !Option.exists(
                  attached,
                  (entry) =>
                    entry.live && entry.epoch === store.epoch && Equal.equals(entry.key, key),
                ) &&
                Option.exists(store.peek(definition, key), (entry) =>
                  stale({ store, entry, staleTime }),
                ),
            );
          }),
          Match.exhaustive,
        );
      };
      const projection = (
        tx: Parameters<typeof inputData.candidate>[0],
      ): Result.Result<State.QueryState<unknown, unknown, unknown>, ReactiveError> =>
        Result.gen(function* () {
          const p = partitionKey(yield* partitionData.candidate(tx));
          const input = yield* inputData.candidate(tx);
          const key = keyOf(input);
          return Option.match(Option.zipRight(p, key), {
            onNone: () => State.initial(),
            onSome: (key) => {
              const samePartition = equalPartition(p, store.partition);
              const entry = Match.value(samePartition).pipe(
                Match.when(true, () => store.peek(definition, key)),
                Match.orElse(() => Option.none<Entry>()),
              );
              const state = Option.match(entry, {
                onNone: () => AsyncResult.initial(true),
                onSome: (e) => e.state,
              });
              const previousSuccess = Option.flatMap(history, (h) =>
                Match.value(
                  options.retainPrevious === true && samePartition && equalPartition(p, partition),
                ).pipe(
                  Match.when(false, () => Option.none<State.PreviousSuccess<unknown, unknown>>()),
                  Match.when(true, () =>
                    Option.some(
                      Match.value(Equal.equals(h.key, key)).pipe(
                        Match.when(true, () =>
                          State.PreviousSuccess.SameKey({ previousData: h.value }),
                        ),
                        Match.orElse(() =>
                          State.PreviousSuccess.PreviousKey({
                            previousData: h.value,
                            key: h.key.input,
                          }),
                        ),
                      ),
                    ),
                  ),
                  Match.exhaustive,
                ),
              );
              const waiting =
                state.waiting ||
                Option.match(entry, {
                  onNone: () => true,
                  onSome: () =>
                    Array.from(b.requests).some((request) =>
                      request({ definition, key, transaction: tx }),
                    ),
                });
              return AsyncResult.match(state, {
                onInitial: () => State.initial({ waiting, previousSuccess }),
                onSuccess: (s) =>
                  State.success(s.value, { waiting, timestamp: DateTime.makeUnsafe(s.timestamp) }),
                onFailure: (s) =>
                  State.failure(s.cause, {
                    waiting,
                    previousSuccess: Option.orElse(
                      Option.map(s.previousSuccess, (h) =>
                        State.PreviousSuccess.SameKey({ previousData: h.value }),
                      ),
                      () => previousSuccess,
                    ),
                  }),
              });
            },
          });
        });
      const initial = yield* Effect.fromResult(
        calculateSync(() => Effect.runSync(Effect.fromResult(projection(Option.none())))),
      );
      const cell = makeCell({
        runtime,
        initial,
        dependencies: [
          inputData.participant,
          partitionData.participant,
          signalData(store.pulse).participant,
        ],
        compute: Option.some((tx) =>
          calculateSync(() => projection(tx)).pipe(Result.flatMap((r) => r)),
        ),
        equals: () => false,
      });
      b.requests.add(requests);
      const untrack = trackInputs({ runtime, input: options.input, pulse: store.pulse });
      runtime.lifetime.cleanups.add(() => {
        untrack();
        b.requests.delete(requests);
      });
      let commit: Parameters<typeof inputData.candidate>[0] = Option.none();
      const sync = () => {
        const nextPartition = store.partition;
        Match.value(
          !equalPartition(partition, nextPartition) || Option.isNone(inputData.committed()),
        ).pipe(
          Match.when(true, () => {
            history = Option.none();
          }),
          Match.orElse(() => {}),
        );
        partition = nextPartition;
        const nextKey = Option.zipRight(nextPartition, keyOf(inputData.committed()));
        const unchanged = Option.match(attached, {
          onNone: () => Option.isNone(nextKey),
          onSome: (e) =>
            e.live &&
            e.epoch === store.epoch &&
            Option.exists(nextKey, (key) => Equal.equals(key, e.key)),
        });
        Match.value(unchanged).pipe(
          Match.when(false, () => {
            Option.match(attached, {
              onNone: () => {},
              onSome: (e) => {
                e.observers.delete(observer);
                Option.match(commit, {
                  onNone: () => unused(store, e),
                  onSome: (transaction) => {
                    transaction.publications.push(() => unused(store, e));
                  },
                });
              },
            });
            attached = Option.map(nextKey, (key) => {
              const entry = store.entry(definition, key);
              activate(entry);
              entry.observers.add(observer);
              fetch({ store, entry, replace: false, staleTime });
              return entry;
            });
          }),
          Match.orElse(() => {}),
        );
        const displayed = signalData(cell).committed();
        Match.value(displayed).pipe(
          Match.tag("Success", (s) => {
            history = Option.map(nextKey, (key) => ({ key, value: s.value }));
          }),
          Match.orElse(() => {}),
        );
      };
      const disconnect = signalData(cell).bind({
        validate: (transaction) => {
          commit = transaction;
          return Result.succeed(undefined);
        },
        flush: () =>
          Effect.sync(() => {
            sync();
            commit = Option.none();
          }),
      });
      b.observers.add(sync);
      sync();
      runtime.lifetime.cleanups.add(() => {
        disconnect();
        b.observers.delete(sync);
        history = Option.none();
        Option.match(attached, {
          onNone: () => {},
          onSome: (e) => {
            e.observers.delete(observer);
            unused(store, e);
          },
        });
        attached = Option.none();
      });
      yield* notify(store);
      return {
        state: readonlySignal(cell) as Signal<State.QueryState<I, A, E, Retain>>,
        refresh: Effect.gen(function* () {
          yield* requireValidSync(
            runtime.lifetime.active(),
            "Query observer has been disposed",
          ).pipe(Effect.fromResult);
          Option.match(attached, {
            onNone: () => {},
            onSome: (entry) => fetch({ store, entry, replace: true, staleTime }),
          });
          yield* Match.value(Option.isSome(attached)).pipe(
            Match.when(true, () => notify(store)),
            Match.orElse(() => Effect.void),
          );
        }),
      };
    });
