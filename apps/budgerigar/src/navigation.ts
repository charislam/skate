import { Effect } from "effect";
import { makeNavigationExecution } from "./navigation-execution";
import { makeNavigationIngress } from "./navigation-ingress";
import type { Navigator, NavigationOptions } from "./navigation-types";
import { ownerRuntime } from "./reactive/owner";
import { readSync } from "./reactive/signal";
import type { Route } from "./routes";

export {
  NavigationError,
  type HistoryIntent,
  type NavigationDecision,
  type NavigationEvent,
  type NavigationMode,
  type Navigator,
} from "./navigation-types";

/** All ingress uses one FIFO; queued admission observes the state at execution time. */
export const navigator = Effect.fn("Navigation.make")(function* <
  T extends ReadonlyArray<Route>,
  S,
  E,
>(options: NavigationOptions<T, S, E>) {
  const runtime = ownerRuntime(options.context);
  const execution = makeNavigationExecution(options);
  yield* Effect.fromResult(readSync({ runtime, signal: options.state })).pipe(
    Effect.mapError((cause) => execution.error({ phase: "prepare", cause })),
  );
  const ingress = yield* makeNavigationIngress({
    runtime,
    router: options.router,
    history: options.history,
    execute: execution.execute,
    error: execution.error,
    onError: options.onError,
  });
  const controller: Navigator<T, E> = {
    navigate: (destination, options = {}) =>
      ingress.submit({ _tag: "Navigate", destination, mode: options.mode ?? "push" }),
    dispatch: (event) => ingress.submit({ _tag: "Application", event }),
    initial: ingress.initial,
    committedLocation: execution.committedLocation,
  };
  return controller;
});
