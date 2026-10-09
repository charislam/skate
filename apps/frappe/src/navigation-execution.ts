import { Effect, Match, Option } from "effect";
import { stageHistoryWrite, type NavigationProgress } from "./navigation-commit";
import {
  NavigationError,
  type HistoryIntent,
  type NavigationEvent,
  type NavigationOptions,
} from "./navigation-types";
import { ReactiveError, runBatch, requireValid } from "./reactive/runtime";
import { ownerRuntime } from "./reactive/owner";
import { signalData } from "./reactive/signal";
import type { Destination, Route } from "./routes";

const observedLocation = <T extends ReadonlyArray<Route>, E>(event: NavigationEvent<T, E>) =>
  Match.value(event).pipe(
    Match.tag("Location", ({ observed }) => Option.some(observed)),
    Match.orElse(() => Option.none<string>()),
  );

const failurePhase = <T extends ReadonlyArray<Route>, E>(options: {
  readonly event: NavigationEvent<T, E>;
  readonly progress: NavigationProgress;
}): NavigationError["phase"] =>
  Match.value(options.event).pipe(
    Match.when({ _tag: "Location", initial: false }, () => "traversal" as const),
    Match.orElse(() =>
      Match.value(options.progress.wroteHistory).pipe(
        Match.when(true, () => "reconcile" as const),
        Match.orElse(() => options.progress.phase),
      ),
    ),
  );

/** Execute one admitted request; the ingress owner supplies serialization. */
export const makeNavigationExecution = <T extends ReadonlyArray<Route>, S, E>(
  options: NavigationOptions<T, S, E>,
) => {
  const { state, history, router } = options;
  const runtime = ownerRuntime(options.context);
  let location = "";
  let canonical = "";
  const error = (options: {
    phase: NavigationError["phase"];
    cause: unknown;
    observed?: Option.Option<string>;
    previousState?: Option.Option<S>;
  }) =>
    new NavigationError({
      phase: options.phase,
      cause: options.cause,
      observed: options.observed ?? Option.none(),
      lastCommittedLocation: location,
      lastCommittedState: Option.getOrElse(options.previousState ?? Option.none(), () =>
        signalData(state).committed(),
      ),
    });
  const canonicalize = (url: string) =>
    Match.value(router.parse(url)).pipe(
      Match.tag("Matched", ({ destination }) => Effect.fromResult(router.build(destination))),
      Match.orElse(() => Effect.succeed(url)),
    );
  const intentHref = (options: { intent: HistoryIntent<Destination<T>>; observed: string }) =>
    Match.value(options.intent).pipe(
      Match.tag("Keep", () => Effect.succeed(options.observed)),
      Match.tag("ReplaceUrl", ({ url }) => Effect.succeed(url)),
      Match.orElse(({ destination }) => Effect.fromResult(router.build(destination))),
    );
  const commitRequest = Effect.fn("Navigation.commitRequest")(function* (
    event: NavigationEvent<T, E>,
  ) {
    const observed = observedLocation(event);
    const previousState = signalData(state).committed();
    const progress: NavigationProgress = {
      phase: "prepare",
      location: Option.getOrElse(observed, () => location),
      canonical,
      wroteHistory: false,
    };
    yield* runBatch({
      runtime,
      work: Effect.gen(function* () {
        const previous = yield* state.get;
        const decision = yield* Effect.try({
          try: () => options.transition({ state: previous, event }),
          catch: (cause) => new ReactiveError({ message: "Navigation transition failed", cause }),
        });
        progress.phase = "build";
        const href = yield* intentHref({ intent: decision.history, observed: progress.location });
        progress.canonical = yield* canonicalize(href);
        progress.phase = "prepare";
        yield* state.set(decision.state);
        yield* stageHistoryWrite({ history, intent: decision.history, href, progress });
      }),
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.fail(
          error({
            phase: failurePhase({ event, progress }),
            cause,
            observed,
            previousState: Option.some(previousState),
          }),
        ),
      ),
    );
    location = progress.location;
    canonical = progress.canonical;
  });
  const execute = Effect.fn("Navigation.execute")(
    function* (event: NavigationEvent<T, E>) {
      yield* requireValid(runtime.lifetime.active(), "Navigation owner disposed");
      const requestHref = yield* Match.value(event).pipe(
        Match.tag("Navigate", ({ destination }) => Effect.fromResult(router.build(destination))),
        Match.orElse(() => Effect.succeed("")),
        Effect.mapError((cause) =>
          error({ phase: "build", cause, observed: observedLocation(event) }),
        ),
      );
      const noop = event._tag === "Navigate" && event.mode === "push" && requestHref === canonical;
      yield* Match.value(noop).pipe(
        Match.when(true, () => Effect.void),
        Match.when(false, () => commitRequest(event)),
        Match.exhaustive,
      );
    },
    Effect.mapError((cause) =>
      Match.value(cause).pipe(
        Match.when(
          (cause): cause is NavigationError => cause instanceof NavigationError,
          (cause) => cause,
        ),
        Match.orElse((cause) => error({ phase: "prepare", cause })),
      ),
    ),
  );
  return { execute, error, committedLocation: () => location };
};
