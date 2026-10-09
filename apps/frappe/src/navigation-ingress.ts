import { Cause, Deferred, Effect, Match, Option, Queue, Stream, type Exit } from "effect";
import type { HistoryAdapter } from "./history";
import { NavigationError, type NavigationEvent } from "./navigation-types";
import { observeHistory } from "./navigation-observation";
import type { ReactiveRuntime } from "./reactive/runtime";
import type { Route, Router } from "./routes";

const claimedHistories = new WeakSet<object>();

/** Own the FIFO, history subscription, and completion/disposal of every request. */
export const makeNavigationIngress = Effect.fn("Navigation.makeIngress")(function* <
  T extends ReadonlyArray<Route>,
  E,
>(options: {
  readonly runtime: ReactiveRuntime;
  readonly router: Router<T>;
  readonly history: HistoryAdapter;
  readonly execute: (event: NavigationEvent<T, E>) => Effect.Effect<void, NavigationError>;
  readonly error: (options: { phase: NavigationError["phase"]; cause: unknown }) => NavigationError;
  readonly onError: (error: NavigationError) => void;
}) {
  const { runtime, history, router, execute, error } = options;
  const queue = yield* Queue.unbounded<{
    readonly event: NavigationEvent<T, E>;
    readonly result: Deferred.Deferred<void, NavigationError>;
  }>();
  const pending = new Set<Deferred.Deferred<void, NavigationError>>();
  let disposed = false;
  const submit = (event: NavigationEvent<T, E>) =>
    Effect.gen(function* () {
      yield* Match.value(disposed).pipe(
        Match.when(true, () =>
          Effect.fail(error({ phase: "disposed", cause: "Disposed navigator" })),
        ),
        Match.orElse(() => Effect.void),
      );
      const result = Deferred.makeUnsafe<void, NavigationError>();
      pending.add(result);
      yield* Queue.offer(queue, { event, result });
      return yield* Deferred.await(result);
    });
  yield* Match.value(claimedHistories.has(history.identity)).pipe(
    Match.when(true, () =>
      Effect.fail(
        error({ phase: "prepare", cause: "This history adapter already has a navigator" }),
      ),
    ),
    Match.orElse(() => Effect.void),
  );
  claimedHistories.add(history.identity);
  runtime.lifetime.cleanups.add(() => claimedHistories.delete(history.identity));
  const initial = Deferred.makeUnsafe<void, NavigationError>();
  pending.add(initial);
  const observation = yield* Effect.try({
    try: () =>
      observeHistory({
        history,
        enqueue: ({ observed, initial: isInitial }) => {
          const result = Match.value(isInitial).pipe(
            Match.when(true, () => initial),
            Match.orElse(() => Deferred.makeUnsafe<void, NavigationError>()),
          );
          pending.add(result);
          Queue.offerUnsafe(queue, {
            event: {
              _tag: "Location",
              target: router.parse(observed),
              observed,
              initial: isInitial,
            },
            result,
          });
        },
      }),
    catch: (cause) => error({ phase: "prepare", cause }),
  });
  const complete = (completion: {
    readonly result: Deferred.Deferred<void, NavigationError>;
    readonly exit: Exit.Exit<void, NavigationError>;
  }) => {
    pending.delete(completion.result);
    Deferred.doneUnsafe(completion.result, completion.exit);
    Match.value(completion.exit).pipe(
      Match.tag("Failure", ({ cause }) => {
        const failure = Option.getOrElse(Cause.findErrorOption(cause), () =>
          error({ phase: "prepare", cause }),
        );
        try {
          options.onError(failure);
        } catch {
          /* Error observers cannot break the ingress loop. */
        }
      }),
      Match.orElse(() => {}),
    );
  };
  yield* runtime.lifetime.fork(
    Stream.runForEach(Stream.fromQueue(queue), ({ event, result }) =>
      execute(event).pipe(
        Effect.exit,
        Effect.tap((exit) => Effect.sync(() => complete({ result, exit }))),
      ),
    ),
  );
  runtime.lifetime.cleanups.add(() => {
    disposed = true;
    observation.dispose();
    for (const result of pending)
      Deferred.doneUnsafe(
        result,
        Effect.fail(error({ phase: "disposed", cause: "Disposed navigator" })),
      );
    pending.clear();
    Effect.runSync(Queue.shutdown(queue));
  });
  return { submit, initial: Deferred.await(initial) };
});
