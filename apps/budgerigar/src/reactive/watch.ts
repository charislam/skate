import { Effect, Match, Option, Result } from "effect";
import { activeInTransaction, calculateSync, reportFailure, type ReactiveRuntime } from "./runtime";
import { readSync, signalData, type Signal } from "./signal";

export interface WatchOptions<A> {
  readonly signal: Signal<A>;
  /** Initial committed value, then each committed change. Must not write signals. */
  readonly onChange: (value: A) => void;
}

export const watchSync = <A>(options: { runtime: ReactiveRuntime; watch: WatchOptions<A> }) =>
  Result.gen(function* () {
    const { runtime, watch } = options;
    const initial = yield* readSync({ runtime, signal: watch.signal });
    yield* calculateSync(() => watch.onChange(initial));
    const disconnect = signalData(watch.signal).bind({
      validate: (transaction) =>
        Match.value(
          Option.match(transaction, {
            onNone: () => runtime.lifetime.active(),
            onSome: (transaction) =>
              activeInTransaction({ lifetime: runtime.lifetime, transaction }),
          }),
        ).pipe(
          Match.when(true, () =>
            signalData(watch.signal)
              .candidate(transaction)
              .pipe(Result.map(() => undefined)),
          ),
          Match.when(false, () => Result.succeed(undefined)),
          Match.exhaustive,
        ),
      flush: () =>
        Effect.suspend(() =>
          Match.value(runtime.lifetime.active()).pipe(
            Match.when(false, () => Effect.void),
            Match.when(true, () =>
              Effect.fromResult(readSync({ runtime, signal: watch.signal })).pipe(
                Effect.flatMap((value) =>
                  Effect.fromResult(calculateSync(() => watch.onChange(value))),
                ),
                Effect.catchCause((cause) =>
                  reportFailure({ runtime, resource: watch.signal, cause }),
                ),
              ),
            ),
            Match.exhaustive,
          ),
        ),
    });
    runtime.lifetime.cleanups.add(disconnect);
  });
