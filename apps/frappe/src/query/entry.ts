import { Context, Effect, Option, Schema, type Clock, type Deferred, type Fiber } from "effect";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { CurrentTransaction, type ReactiveRuntime } from "~/reactive/runtime";
import type { WritableSignal } from "~/reactive/signal";
import type { Definition, Policy, Retry } from "./definition";
import type { Key } from "./key";

export class Unavailable extends Schema.TaggedError<Unavailable>()("QueryUnavailable", {
  message: Schema.String,
}) {}
export class PartitionChanged extends Schema.TaggedError<PartitionChanged>()(
  "QueryPartitionChanged",
  {},
) {}
export class Disposed extends Schema.TaggedError<Disposed>()("QueryDisposed", {}) {}
export type FrameworkError = Unavailable | PartitionChanged | Disposed;
/** Erased only inside the runtime store. Public registration checks resources and preserves I/A/E. */
export type AnyDefinition = Definition<unknown, unknown, unknown, unknown>;
export interface Entry {
  readonly definition: AnyDefinition;
  readonly key: Key<unknown>;
  readonly epoch: number;
  readonly observers: Set<object>;
  readonly waiters: Set<Deferred.Deferred<unknown, unknown>>;
  state: AsyncResult.AsyncResult<unknown, unknown>;
  generation: number;
  live: boolean;
  invalidated: boolean;
  pending: boolean;
  execution: Option.Option<Fiber.Fiber<unknown, unknown>>;
  gc: Option.Option<Fiber.Fiber<unknown, unknown>>;
  gcGeneration: number;
}
export interface StoreOptions extends Policy {
  readonly retry?: Retry<unknown, unknown>;
}
export interface Store {
  readonly runtime: ReactiveRuntime;
  readonly pulse: WritableSignal<number>;
  readonly entries: Set<Entry>;
  readonly clock: Clock.Clock;
  readonly environment: Context.Context<never>;
  readonly staleTime: number;
  readonly gcTime: number;
  readonly retry: Retry<unknown, unknown>;
  partition: Option.Option<unknown>;
  epoch: number;
  readonly peek: (definition: AnyDefinition, key: Key<unknown>) => Option.Option<Entry>;
  readonly forget: (entry: Entry) => void;
  readonly entry: (definition: AnyDefinition, key: Key<unknown>) => Entry;
}
export const consumers = (entry: Entry) => entry.observers.size + entry.waiters.size;
export const cancel = (fiber: Option.Option<Fiber.Fiber<unknown, unknown>>) =>
  Option.match(fiber, { onNone: () => {}, onSome: (f) => f.interruptUnsafe() });
export const current = (options: { store: Store; entry: Entry; generation: number }) =>
  options.store.runtime.lifetime.active() &&
  options.entry.live &&
  options.entry.epoch === options.store.epoch &&
  options.entry.generation === options.generation;
export const notify = (store: Store) => store.pulse.update((n) => n + 1);
export const launch = (store: Store, work: Effect.Effect<unknown, unknown, unknown>) =>
  Effect.runSync(
    Effect.fromResult(
      store.runtime.lifetime.registerWork(
        work.pipe(
          Effect.provide(store.environment as Context.Context<unknown>),
          Effect.provideService(CurrentTransaction, Option.none()),
        ),
      ),
    ).pipe(Effect.orDie),
  );
