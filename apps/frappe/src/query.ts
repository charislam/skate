import type { Effect, Option, Scope } from "effect";
import type { ApplicationContext, OwnerContext } from "./framework";
import type { Configure, ObserveOptions, Handle } from "./query/api";
import type { Policy, Retry } from "./query/definition";
import { observe as observeRuntime } from "./query/observer";
import { configure as configureRuntime } from "./query/runtime";
import { ownerRuntime } from "./reactive/owner";
import type { ReactiveError } from "./reactive/runtime";
import type { Signal } from "./reactive/signal";
import type { Structural } from "./requirements";
import type { Identifier } from "./resource";

/** Queries compose existing signals; the context only establishes ownership. */
type Available<C> = C extends ApplicationContext<infer R> ? R : never;
export const observe = <
  C extends Pick<OwnerContext, "readCommitted" | "signal">,
  I,
  A,
  E,
  R,
  Retain extends boolean = false,
>(
  options: ObserveOptions<I, A, E, R, Retain> & { readonly context: C },
): Effect.Effect<
  Handle<I, A, E, Retain>,
  ReactiveError,
  Structural<Exclude<R, Available<C> | Scope.Scope>>
> =>
  // An application discharges its mounted resources; component registration keeps
  // structural requirements until the component is mounted in that application.
  observeRuntime(ownerRuntime(options.context))(options) as Effect.Effect<
    Handle<I, A, E, Retain>,
    ReactiveError,
    Structural<Exclude<R, Available<C> | Scope.Scope>>
  >;

export const configure = <Resources extends Identifier, P, R = never>(
  options: Policy & {
    readonly context: ApplicationContext<Resources>;
    readonly partition: Signal<Option.Option<P>>;
    readonly retry?: Retry<unknown, R>;
  } & ([Exclude<R, Identifier | Scope.Scope>] extends [never]
      ? unknown
      : { readonly invalidQueryRequirements: never }),
) => (configureRuntime(ownerRuntime(options.context)) as Configure<Resources>)(options);

export type { Handle, ObserveOptions, Client } from "./query/api";
export {
  define,
  disabled,
  inherit,
  retry,
  Retry,
  type Definition,
  type Policy,
} from "./query/definition";
export { Disposed, PartitionChanged, type FrameworkError, Unavailable } from "./query/entry";
export * as QueryState from "./query/state";
