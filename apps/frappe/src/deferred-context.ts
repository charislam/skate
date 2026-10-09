import { Context, Effect, Option, Scope } from "effect";
import { CurrentTransaction } from "./reactive/runtime";

/**
 * The context proves non-Scope requirements, including structural bookkeeping.
 * Execution replaces Scope and transaction authority with the owner's
 * capabilities.
 */
export const capturedWork = <A, E, R>(options: {
  readonly work: Effect.Effect<A, E, R>;
  readonly context: Context.Context<NoInfer<Exclude<R, Scope.Scope>>>;
}): Effect.Effect<A, E, Scope.Scope> =>
  Scope.Scope.pipe(
    Effect.flatMap((scope) =>
      options.work.pipe(
        Scope.provide(scope),
        Effect.provide(
          options.context.pipe(
            Context.add(Scope.Scope, scope),
            Context.add(CurrentTransaction, Option.none()),
          ),
        ),
      ),
    ),
  );
