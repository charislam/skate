import { Effect, Match, Result } from "effect";
import { HistoryError, type HistoryAdapter } from "./history";

const controllers = new WeakSet<Window>();
/** One acquired navigation transport per document; push/replace never synthesize traversal. */
export const browserHistory = Effect.fn("History.browser")(function* (window: Window) {
  yield* Effect.acquireRelease(
    Effect.gen(function* () {
      yield* Match.value(controllers.has(window)).pipe(
        Match.when(true, () =>
          Effect.fail(
            new HistoryError({
              operation: "acquire",
              cause: "This document already has a history controller",
            }),
          ),
        ),
        Match.orElse(() => Effect.void),
      );
      controllers.add(window);
    }),
    () => Effect.sync(() => controllers.delete(window)),
  );
  const listeners = new Set<(location: string) => void>();
  let disposed = false;
  const location = () => window.location.pathname + window.location.search + window.location.hash;
  const traversal = () => {
    for (const listener of listeners) listener(location());
  };
  window.addEventListener("popstate", traversal);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      disposed = true;
      listeners.clear();
      window.removeEventListener("popstate", traversal);
    }),
  );
  const write = (options: { mode: "push" | "replace"; href: string }) =>
    Result.try({
      try: () => {
        Match.value(disposed).pipe(
          Match.when(true, () => {
            throw new Error("Disposed history");
          }),
          Match.orElse(() => {}),
        );
        const url = new URL(options.href, window.location.href);
        Match.value(url.origin !== window.location.origin).pipe(
          Match.when(true, () => {
            throw new Error("History destinations must be same origin");
          }),
          Match.orElse(() => {}),
        );
        Match.value(options.mode).pipe(
          Match.when("push", () => window.history.pushState(null, "", options.href)),
          Match.when("replace", () => window.history.replaceState(null, "", options.href)),
          Match.exhaustive,
        );
      },
      catch: (cause) => new HistoryError({ operation: options.mode, cause }),
    });
  const adapter: HistoryAdapter = {
    identity: window.document,
    origin: window.location.origin,
    observe: (listener) => {
      Match.value(disposed).pipe(
        Match.when(true, () => {
          throw new Error("Disposed history");
        }),
        Match.orElse(() => {}),
      );
      listeners.add(listener);
      return {
        initial: location(),
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    push: (href) => write({ mode: "push", href }),
    replace: (href) => write({ mode: "replace", href }),
  };
  return adapter;
});
