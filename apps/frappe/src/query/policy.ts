import { Deferred, Effect, Match, Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import {
  cancel,
  consumers,
  launch,
  type AnyDefinition,
  type Entry,
  type FrameworkError,
  type Store,
} from "./entry";

export const freshness = (store: Store, definition: AnyDefinition) =>
  Option.getOrElse(definition.staleTime, () => store.staleTime);
export const stale = (options: { store: Store; entry: Entry; staleTime: number }): boolean =>
  options.entry.invalidated ||
  !AsyncResult.isSuccess(options.entry.state) ||
  options.store.clock.currentTimeMillisUnsafe() - options.entry.state.timestamp >=
    options.staleTime;
export const activate = (entry: Entry): void => {
  entry.gcGeneration += 1;
  cancel(entry.gc);
  entry.gc = Option.none();
};
const remove = (store: Store, entry: Entry): void => {
  entry.live = false;
  entry.generation += 1;
  entry.pending = false;
  cancel(entry.execution);
  cancel(entry.gc);
  store.forget(entry);
};
export const unused = (store: Store, entry: Entry): void => {
  Match.value(entry.live && consumers(entry) === 0).pipe(
    Match.when(true, () => {
      const gcTime = Option.getOrElse(entry.definition.gcTime, () => store.gcTime);
      entry.gcGeneration += 1;
      const token = entry.gcGeneration;
      Match.value(gcTime).pipe(
        Match.when(0, () => remove(store, entry)),
        Match.when(Infinity, () => {}),
        Match.orElse((millis) =>
          launch(
            store,
            Effect.withFiber((fiber) => {
              return Match.value(
                entry.live && entry.gcGeneration === token && consumers(entry) === 0,
              ).pipe(
                Match.when(false, () => Effect.void),
                Match.when(true, () => {
                  entry.gc = Option.some(fiber);
                  return Effect.sleep(millis).pipe(
                    Effect.andThen(
                      Effect.sync(() => {
                        Match.value(
                          entry.live && entry.gcGeneration === token && consumers(entry) === 0,
                        ).pipe(
                          Match.when(true, () => remove(store, entry)),
                          Match.orElse(() => {}),
                        );
                      }),
                    ),
                  );
                }),
                Match.exhaustive,
              );
            }),
          ),
        ),
      );
    }),
    Match.orElse(() => {}),
  );
};
export const retire = (store: Store, error: FrameworkError): void => {
  store.epoch += 1;
  for (const entry of store.entries) {
    for (const waiter of entry.waiters) Deferred.doneUnsafe(waiter, Effect.fail(error));
    remove(store, entry);
  }
};
