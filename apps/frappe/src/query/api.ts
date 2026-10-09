import type { Duration, Effect, Option, Scope } from "effect";
import type { ReactiveError } from "~/reactive/runtime";
import type { Signal } from "~/reactive/signal";
import type { Structural } from "~/requirements";
import type { Identifier } from "~/resource";
import type { Definition, Policy, Retry } from "./definition";
import type { FrameworkError } from "./entry";
import type * as State from "./state";

export interface Handle<I, A, E, Retain extends boolean = false> {
  readonly state: Signal<State.QueryState<I, A, E, Retain>>;
  readonly refresh: Effect.Effect<void, ReactiveError>;
}
// Keep framework errors distinct from loader errors: observation itself only fails setup/ownership.
export interface ObserveOptions<I, A, E, R, Retain extends boolean> {
  readonly query: Definition<I, A, E, R>;
  readonly input: Signal<Option.Option<I>>;
  readonly retainPrevious?: Retain;
  readonly staleTime?: Duration.Input;
}
export type Observe<Available = never> = <I, A, E, R, Retain extends boolean = false>(
  options: ObserveOptions<I, A, E, R, Retain>,
) => Effect.Effect<
  Handle<I, A, E, Retain>,
  ReactiveError,
  Structural<Exclude<R, Available | Scope.Scope>>
>;
export interface Client<Available = never> {
  readonly get: <I, A, E, R>(options: {
    readonly query: Definition<I, A, E, R>;
    readonly input: I;
  }) => Effect.Effect<
    A,
    E | FrameworkError | ReactiveError,
    Structural<Exclude<R, Available | Scope.Scope>>
  >;
  readonly refresh: Client<Available>["get"];
  readonly invalidate: <I, A, E, R>(options: {
    readonly query: Definition<I, A, E, R>;
    readonly input: I;
  }) => Effect.Effect<void, ReactiveError>;
  readonly invalidateDefinition: <I, A, E, R>(options: {
    readonly query: Definition<I, A, E, R>;
  }) => Effect.Effect<void, ReactiveError>;
}
export type Configure<Available = never> = <P, R = never>(
  options: Policy & {
    readonly partition: Signal<Option.Option<P>>;
    readonly retry?: Retry<unknown, R>;
  } & ([Exclude<R, Identifier | Scope.Scope>] extends [never]
      ? unknown
      : { readonly invalidQueryRequirements: never }),
) => Effect.Effect<
  Client<Available>,
  ReactiveError,
  Structural<Exclude<R, Available | Scope.Scope>>
>;
