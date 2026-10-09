import { Context, Effect, Match, Pipeable, Result } from "effect";

const TypeId = Symbol("frappe/Sync");
const evaluate = Symbol("frappe/Sync/evaluate");

/** An inert synchronous computation. Exceptions are defects, not expected errors. */
export interface Sync<out A, out E = never, out R = never> extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId;
  readonly success?: () => A;
  readonly error?: () => E;
  readonly requirements?: () => R;
  readonly [evaluate]: (context: Context.Context<never>) => Result.Result<A, E>;
  [Symbol.iterator](): Generator<Sync<A, E, R>, A, unknown>;
}

const make = <A, E, R = never>(
  run: (context: Context.Context<never>) => Result.Result<A, E>,
): Sync<A, E, R> => ({
  [TypeId]: TypeId,
  [evaluate]: run,
  pipe() {
    return Pipeable.pipeArguments(this, arguments);
  },
  *[Symbol.iterator]() {
    return (yield this) as A;
  },
});

export const isSync = (value: unknown): value is Sync<unknown, unknown, unknown> =>
  typeof value === "object" && value !== null && TypeId in value && evaluate in value;

const interpret = <A, E, R>(options: {
  readonly computation: Sync<A, E, R>;
  readonly context: Context.Context<never>;
}): Result.Result<A, E> =>
  Match.value(isSync(options.computation)).pipe(
    Match.when(true, () => options.computation[evaluate](options.context)),
    Match.when(false, () => {
      throw new TypeError("frappé Sync requires a Sync computation");
    }),
    Match.exhaustive,
  );

export const succeed = <A>(value: A): Sync<A> => make(() => Result.succeed(value));
export const fail = <E>(error: E): Sync<never, E> => make(() => Result.fail(error));

/** The callback executes only when the owning lifecycle interprets the computation. */
type Foreign =
  | Effect.Effect<unknown, unknown, unknown>
  | PromiseLike<unknown>
  | Result.Result<unknown, unknown>
  | Sync<unknown, unknown, unknown>;
type Value<A> = A extends Foreign ? never : A;

const assertValue = <A>(value: A): A => {
  Match.value(
    Effect.isEffect(value) ||
      Result.isResult(value) ||
      isSync(value) ||
      (typeof value === "object" && value !== null && "then" in value),
  ).pipe(
    Match.when(true, () => {
      throw new TypeError("frappé Sync callback returned a foreign computation");
    }),
    Match.when(false, () => {}),
    Match.exhaustive,
  );
  return value;
};

export const sync = <A>(callback: () => A & Value<A>): Sync<A> =>
  make(() => Result.succeed(assertValue(callback())));

export const fromResult = <A, E>(result: Result.Result<A, E>): Sync<A, E> =>
  make(() =>
    Match.value(Result.isResult(result)).pipe(
      Match.when(true, () => result),
      Match.when(false, () => {
        throw new TypeError("frappé Sync.fromResult requires a Result");
      }),
      Match.exhaustive,
    ),
  );

export const suspend = <A, E, R>(callback: () => Sync<A, E, R>): Sync<A, E, R> =>
  make((context) => interpret({ computation: callback(), context }));

/** Internal adapters for framework-owned synchronous validation and registration. */
export const fromResultLazy = <A, E>(callback: () => Result.Result<A, E>): Sync<A, E> =>
  suspend(() => fromResult(callback()));
/** The interpreter supplies R when this computation executes; expose that requirement to callers. */
export const withContext = <A, E, R = never>(
  callback: (context: Context.Context<R>) => Result.Result<A, E>,
): Sync<A, E, R> =>
  // Context erasure belongs to the private evaluator; the resulting Sync still requires R.
  make((context) => callback(context as Context.Context<R>));
export const runResult = interpret;

export const service = <I, S>(key: Context.Key<I, S>): Sync<S, never, I> =>
  make((context) => Result.succeed(Context.getUnsafe(context, key)));

export const map =
  <A, B>(f: (value: A) => B & Value<B>) =>
  <E, R>(self: Sync<A, E, R>): Sync<B, E, R> =>
    make((context) =>
      interpret({ computation: self, context }).pipe(Result.map((value) => assertValue(f(value)))),
    );

export const flatMap =
  <A, B, E2, R2>(f: (value: A) => Sync<B, E2, R2>) =>
  <E, R>(self: Sync<A, E, R>): Sync<B, E | E2, R | R2> =>
    make((context) =>
      interpret({ computation: self, context }).pipe(
        Result.flatMap((value) => interpret({ computation: f(value), context })),
      ),
    );

export const gen = <Y extends Sync<unknown, unknown, unknown>, A>(
  body: () => Generator<Y, A & Value<A>, unknown>,
): Sync<
  A,
  Y extends Sync<unknown, infer E, unknown> ? E : never,
  Y extends Sync<unknown, unknown, infer R> ? R : never
> =>
  make((context) =>
    Result.gen(function* () {
      const iterator = body();
      let state = iterator.next();
      while (!state.done) {
        const value = yield* interpret({ computation: state.value, context });
        state = iterator.next(value);
      }
      return assertValue(state.value);
    }),
  ) as Sync<
    A,
    Y extends Sync<unknown, infer E, unknown> ? E : never,
    Y extends Sync<unknown, unknown, infer R> ? R : never
  >;

/** Local computation provision does not provide services to deferred descendants. */
export const provideService =
  <I, S>(key: Context.Key<I, S>, value: NoInfer<S>) =>
  <A, E, R>(self: Sync<A, E, R>): Sync<A, E, Exclude<R, I>> =>
    make((context) => interpret({ computation: self, context: Context.add(context, key, value) }));

/** Internal lifecycle bridge; never exported from the public framework module. */
export const toEffect = <A, E, R>(self: Sync<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.context<R>().pipe(
    Effect.flatMap((context) =>
      Effect.suspend(() => Effect.fromResult(interpret({ computation: self, context }))),
    ),
  );
