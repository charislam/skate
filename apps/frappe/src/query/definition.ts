import { Data, Duration, Effect, Match, Option, type Schedule, type Scope } from "effect";
import type { Identifier } from "~/resource";
import { snapshot, type Key } from "./key";

export type Retry<E, R = never> = Data.TaggedEnum<{
  Inherit: {};
  Disabled: {};
  Schedule: { readonly schedule: Schedule.Schedule<unknown, E, never, R> };
}>;
export const Retry = Data.taggedEnum<Retry<unknown, unknown>>();
export const inherit = (): Retry<unknown> => Retry.Inherit();
export const disabled = (): Retry<unknown> => Retry.Disabled();
export const retry = <E, R>(schedule: Schedule.Schedule<unknown, E, never, R>): Retry<E, R> => ({
  _tag: "Schedule",
  schedule,
});
export interface Policy {
  readonly staleTime?: Duration.Input;
  readonly gcTime?: Duration.Input;
}
export interface Definition<I, A, E, R> {
  readonly identity: object;
  readonly name: string;
  readonly load: (input: I) => Effect.Effect<A, E, R>;
  readonly key: (input: I) => Key<I>;
  readonly staleTime: Option.Option<number>;
  readonly gcTime: Option.Option<number>;
  readonly retry: Retry<E, R>;
}
export const duration = (input: Duration.Input): number => {
  Match.value(typeof input === "number" && input < 0).pipe(
    Match.when(true, () => {
      throw new TypeError("frappé query durations must be nonnegative");
    }),
    Match.orElse(() => {}),
  );
  const millis = Duration.toMillis(input);
  Match.value(millis >= 0 && !Number.isNaN(millis)).pipe(
    Match.when(false, () => {
      throw new TypeError("frappé query durations must be nonnegative");
    }),
    Match.orElse(() => {}),
  );
  return millis;
};
export const define = <I, A, E, R, RR = never>(
  options: Policy & {
    readonly name: string;
    readonly load: (input: I) => Effect.Effect<A, E, R>;
    readonly retry?: Retry<NoInfer<E>, RR>;
    /** Return a supported immutable structure preserving the loader's Input type. */
    readonly canonicalize?: (input: I) => I;
  } & ([Exclude<R | RR, Identifier | Scope.Scope>] extends [never]
      ? unknown
      : { readonly invalidQueryRequirements: never }),
): Definition<I, A, E, R | RR> => ({
  identity: {},
  name: options.name,
  load: options.load,
  key: (input) =>
    snapshot(
      Option.match(Option.fromUndefinedOr(options.canonicalize), {
        onNone: () => input,
        onSome: (normalize) => normalize(input),
      }),
    ),
  staleTime: Option.map(Option.fromUndefinedOr(options.staleTime), duration),
  gcTime: Option.map(Option.fromUndefinedOr(options.gcTime), duration),
  retry: options.retry ?? inherit(),
});
