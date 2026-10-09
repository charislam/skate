import { Clock, Context, Match, MutableHashMap, Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type { ReactiveRuntime } from "~/reactive/runtime";
import { makeCell } from "~/reactive/signal";
import { duration, disabled } from "./definition";
import { Disposed, type AnyDefinition, type Entry, type Store, type StoreOptions } from "./entry";
import type { Key } from "./key";
import { retire } from "./policy";

export const createStore = (options: {
  runtime: ReactiveRuntime;
  environment: Context.Context<never>;
  clock: Clock.Clock;
  policy: StoreOptions;
}): Store => {
  const staleTime = duration(options.policy.staleTime ?? 0);
  const gcTime = duration(options.policy.gcTime ?? "5 minutes");
  const families = new WeakMap<object, MutableHashMap.MutableHashMap<Key<unknown>, Entry>>();
  const entries = new Set<Entry>();
  const family = (definition: AnyDefinition) =>
    Option.getOrElse(Option.fromUndefinedOr(families.get(definition.identity)), () => {
      const map = MutableHashMap.empty<Key<unknown>, Entry>();
      families.set(definition.identity, map);
      return map;
    });
  const store: Store = {
    ...options,
    environment: Context.add(options.environment, Clock.Clock, options.clock),
    pulse: makeCell({
      runtime: options.runtime,
      initial: 0,
      compute: Option.none(),
      dependencies: [],
      // A touched pulse must prepare all projections even without a numeric write.
      equals: () => false,
    }),
    staleTime,
    gcTime,
    retry: options.policy.retry ?? disabled(),
    entries,
    partition: Option.none(),
    epoch: 0,
    peek: (definition, key) =>
      MutableHashMap.get(family(definition), key).pipe(
        Option.filter((e) => e.live && e.epoch === store.epoch),
      ),
    forget: (entry) => {
      entries.delete(entry);
      const map = family(entry.definition);
      Match.value(
        Option.exists(MutableHashMap.get(map, entry.key), (current) => current === entry),
      ).pipe(
        Match.when(true, () => MutableHashMap.remove(map, entry.key)),
        Match.orElse(() => {}),
      );
    },
    entry: (definition, key) =>
      Option.getOrElse(store.peek(definition, key), () => {
        const entry: Entry = {
          definition,
          key,
          epoch: store.epoch,
          observers: new Set(),
          waiters: new Set(),
          state: AsyncResult.initial(),
          generation: 0,
          live: true,
          invalidated: true,
          pending: false,
          execution: Option.none(),
          gc: Option.none(),
          gcGeneration: 0,
        };
        MutableHashMap.set(family(definition), key, entry);
        entries.add(entry);
        return entry;
      }),
  };
  options.runtime.lifetime.cleanups.add(() => retire(store, new Disposed()));
  return store;
};
