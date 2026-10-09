import { Cause, Data, DateTime, Match, Option } from "effect";
import { dual } from "effect/Function";
import { pipeArguments, type Pipeable } from "effect/Pipeable";

export type PreviousSuccess<I, A> = Data.TaggedEnum<{
  SameKey: { readonly previousData: A };
  PreviousKey: { readonly previousData: A; readonly key: I };
}>;
interface PreviousSuccessDefinition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: PreviousSuccess<this["A"], this["B"]>;
}
export const PreviousSuccess = Data.taggedEnum<PreviousSuccessDefinition>();
export type History<I, A, Retain extends boolean> = Retain extends false
  ? Extract<PreviousSuccess<I, A>, { readonly _tag: "SameKey" }>
  : PreviousSuccess<I, A>;

export interface Initial<I, A, Retain extends boolean = true> extends Pipeable {
  readonly _tag: "Initial";
  readonly waiting: boolean;
  readonly previousSuccess: Option.Option<History<I, A, Retain>>;
}
export interface Success<A> extends Pipeable {
  readonly _tag: "Success";
  readonly waiting: boolean;
  readonly value: A;
  readonly timestamp: DateTime.Utc;
}
export interface Failure<I, A, E, Retain extends boolean = true> extends Pipeable {
  readonly _tag: "Failure";
  readonly waiting: boolean;
  readonly cause: Cause.Cause<E>;
  readonly previousSuccess: Option.Option<History<I, A, Retain>>;
}
export type QueryState<I, A, E, Retain extends boolean = true> =
  | Initial<I, A, Retain>
  | Success<A>
  | Failure<I, A, E, Retain>;
const proto = {
  pipe(this: Pipeable) {
    return pipeArguments(this, arguments);
  },
};
const make = <A extends object>(fields: A): A & Pipeable =>
  Object.assign(Object.create(proto), fields);
export const initial = <I = never, A = never, Retain extends boolean = true>(
  options: {
    readonly waiting?: boolean;
    readonly previousSuccess?: Option.Option<History<I, A, Retain>>;
  } = {},
): Initial<I, A, Retain> =>
  make({
    _tag: "Initial" as const,
    waiting: options.waiting ?? false,
    previousSuccess: options.previousSuccess ?? Option.none(),
  });
export const success = <A>(
  value: A,
  options: { readonly timestamp: DateTime.Utc; readonly waiting?: boolean },
): Success<A> =>
  make({
    _tag: "Success" as const,
    value,
    timestamp: options.timestamp,
    waiting: options.waiting ?? false,
  });
export const failure = <I, A, E, Retain extends boolean = true>(
  cause: Cause.Cause<E>,
  options: {
    readonly waiting?: boolean;
    readonly previousSuccess?: Option.Option<History<I, A, Retain>>;
  } = {},
): Failure<I, A, E, Retain> =>
  make({
    _tag: "Failure" as const,
    cause,
    waiting: options.waiting ?? false,
    previousSuccess: options.previousSuccess ?? Option.none(),
  });
export const isInitial = <I, A, E, T extends boolean>(
  state: QueryState<I, A, E, T>,
): state is Initial<I, A, T> => state._tag === "Initial";
export const isSuccess = <I, A, E, T extends boolean>(
  state: QueryState<I, A, E, T>,
): state is Success<A> => state._tag === "Success";
export const isFailure = <I, A, E, T extends boolean>(
  state: QueryState<I, A, E, T>,
): state is Failure<I, A, E, T> => state._tag === "Failure";
export const isWaiting = <I, A, E, T extends boolean>(state: QueryState<I, A, E, T>): boolean =>
  state.waiting;
type Handlers<I, A, E, T extends boolean, X, Y, Z> = {
  readonly onInitial: (state: Initial<I, A, T>) => X;
  readonly onFailure: (state: Failure<I, A, E, T>) => Y;
  readonly onSuccess: (state: Success<A>) => Z;
};
export const match: {
  <I, A, E, T extends boolean, X, Y, Z>(
    handlers: Handlers<I, A, E, T, X, Y, Z>,
  ): (state: QueryState<I, A, E, T>) => X | Y | Z;
  <I, A, E, T extends boolean, X, Y, Z>(
    state: QueryState<I, A, E, T>,
    handlers: Handlers<I, A, E, T, X, Y, Z>,
  ): X | Y | Z;
} = dual(
  2,
  <I, A, E, T extends boolean, X, Y, Z>(
    state: QueryState<I, A, E, T>,
    handlers: Handlers<I, A, E, T, X, Y, Z>,
  ): X | Y | Z =>
    Match.value(state).pipe(
      Match.tag("Initial", (s): X | Y | Z => handlers.onInitial(s)),
      Match.tag("Success", (s): X | Y | Z => handlers.onSuccess(s)),
      Match.tag("Failure", (s): X | Y | Z => handlers.onFailure(s)),
      Match.exhaustive,
    ) as X | Y | Z,
);
const mapHistory = <I, A, B, T extends boolean>(
  history: History<I, A, T>,
  f: (a: A) => B,
): History<I, B, T> =>
  // Mapping preserves the discriminator and key, including the false specialization.
  ({ ...history, previousData: f(history.previousData) }) as unknown as History<I, B, T>;
export const map: {
  <A, B>(
    f: (a: A) => B,
  ): <I, E, T extends boolean>(state: QueryState<I, A, E, T>) => QueryState<I, B, E, T>;
  <I, A, E, T extends boolean, B>(
    state: QueryState<I, A, E, T>,
    f: (a: A) => B,
  ): QueryState<I, B, E, T>;
} = dual(
  2,
  <I, A, E, T extends boolean, B>(
    state: QueryState<I, A, E, T>,
    f: (a: A) => B,
  ): QueryState<I, B, E, T> =>
    match(state, {
      onInitial: (s) =>
        initial({
          waiting: s.waiting,
          previousSuccess: Option.map(s.previousSuccess, (h) => mapHistory(h, f)),
        }),
      onFailure: (s) =>
        failure(s.cause, {
          waiting: s.waiting,
          previousSuccess: Option.map(s.previousSuccess, (h) => mapHistory(h, f)),
        }),
      onSuccess: (s) => success(f(s.value), s),
    }),
);
