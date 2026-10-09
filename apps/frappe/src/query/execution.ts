import { Cause, DateTime, Deferred, Effect, Exit, Match, Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { reportFailure } from "~/reactive/runtime";
import type { Key } from "./key";
import {
  cancel,
  current,
  Disposed,
  launch,
  notify,
  type AnyDefinition,
  type Entry,
  type Store,
  Unavailable,
} from "./entry";
import { activate, freshness, stale, unused } from "./policy";

export const fetch = (options: {
  store: Store;
  entry: Entry;
  replace: boolean;
  staleTime: number;
}): void => {
  const { store, entry } = options;
  Match.value(!options.replace && (entry.pending || !stale(options))).pipe(
    Match.when(true, () => {}),
    Match.when(false, () => {
      entry.generation += 1;
      const generation = entry.generation;
      cancel(entry.execution);
      entry.execution = Option.none();
      entry.pending = true;
      entry.state = AsyncResult.waiting(entry.state);
      const retry = Match.value(entry.definition.retry).pipe(
        Match.tag("Inherit", () => store.retry),
        Match.orElse((r) => r),
      );
      const attempt = Effect.scoped(Effect.suspend(() => entry.definition.load(entry.key.input)));
      const sequence = Effect.scoped(
        Match.value(retry).pipe(
          Match.tag("Schedule", ({ schedule }) => attempt.pipe(Effect.retry(schedule))),
          Match.orElse(() => attempt),
        ),
      );
      launch(
        store,
        Effect.withFiber((fiber) => {
          return Match.value(current({ store, entry, generation })).pipe(
            Match.when(false, () => Effect.void),
            Match.when(true, () => {
              entry.execution = Option.some(fiber);
              return Effect.gen(function* () {
                const exit = yield* Effect.exit(sequence);
                const instant = yield* DateTime.now;
                yield* Match.value(current({ store, entry, generation })).pipe(
                  Match.when(false, () => Effect.void),
                  Match.when(true, () =>
                    Effect.gen(function* () {
                      entry.pending = false;
                      entry.execution = Option.none();
                      entry.state = Exit.match(exit, {
                        onSuccess: (value) =>
                          AsyncResult.success(value, {
                            timestamp: DateTime.toEpochMillis(instant),
                          }),
                        onFailure: (cause) =>
                          AsyncResult.failureWithPrevious(cause, {
                            previous: Option.some(entry.state),
                          }),
                      });
                      entry.invalidated = Exit.isFailure(exit);
                      yield* notify(store).pipe(
                        Effect.catchCause((cause) =>
                          reportFailure({
                            runtime: store.runtime,
                            resource: entry.definition.identity,
                            cause,
                          }),
                        ),
                      );
                      for (const waiter of entry.waiters) Deferred.doneUnsafe(waiter, exit);
                      yield* Match.value(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).pipe(
                        Match.when(true, () =>
                          Exit.match(exit, {
                            onSuccess: () => Effect.void,
                            onFailure: (cause) =>
                              reportFailure({
                                runtime: store.runtime,
                                resource: entry.definition.identity,
                                cause,
                              }),
                          }),
                        ),
                        Match.orElse(() => Effect.void),
                      );
                    }),
                  ),
                  Match.exhaustive,
                );
              });
            }),
            Match.exhaustive,
          );
        }),
      );
    }),
    Match.exhaustive,
  );
};
export const invalidate = (store: Store, entries: Iterable<Entry>): void => {
  for (const entry of entries) {
    entry.invalidated = true;
    Match.value(entry.observers.size > 0).pipe(
      Match.when(true, () => fetch({ store, entry, replace: true, staleTime: 0 })),
      Match.when(false, () => {
        entry.generation += 1;
        cancel(entry.execution);
        entry.execution = Option.none();
        entry.pending = false;
        entry.state = AsyncResult.match(entry.state, {
          onInitial: () => AsyncResult.initial(),
          onSuccess: (s) => AsyncResult.success(s.value, { timestamp: s.timestamp }),
          onFailure: (s) => AsyncResult.failure(s.cause, { previousSuccess: s.previousSuccess }),
        });
        // Live imperative waiters must not be stranded by retiring their generation.
        Match.value(entry.waiters.size > 0).pipe(
          Match.when(true, () => fetch({ store, entry, replace: false, staleTime: 0 })),
          Match.orElse(() => {}),
        );
      }),
      Match.exhaustive,
    );
  }
};
export const consume = (options: {
  store: Store;
  definition: AnyDefinition;
  key: Key<unknown>;
  refresh: boolean;
}): Effect.Effect<unknown, unknown> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { store, definition, key } = options;
      yield* Match.value(store.runtime.lifetime.active()).pipe(
        Match.when(false, () => Effect.fail(new Disposed())),
        Match.orElse(() => Effect.void),
      );
      yield* Match.value(Option.isNone(store.partition)).pipe(
        Match.when(true, () =>
          Effect.fail(new Unavailable({ message: "Query partition is unavailable" })),
        ),
        Match.orElse(() => Effect.void),
      );
      const entry = store.entry(definition, key);
      const waiter = Deferred.makeUnsafe<unknown, unknown>();
      activate(entry);
      entry.waiters.add(waiter);
      return yield* Effect.gen(function* () {
        fetch({ store, entry, replace: options.refresh, staleTime: freshness(store, definition) });
        yield* notify(store);
        Match.value(entry.pending).pipe(
          Match.when(false, () => {
            AsyncResult.match(entry.state, {
              onInitial: () => {},
              onSuccess: (s) => Deferred.doneUnsafe(waiter, Effect.succeed(s.value)),
              onFailure: (s) => Deferred.doneUnsafe(waiter, Effect.failCause(s.cause)),
            });
          }),
          Match.orElse(() => {}),
        );
        return yield* restore(Deferred.await(waiter));
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.waiters.delete(waiter);
            unused(store, entry);
          }),
        ),
      );
    }),
  );
