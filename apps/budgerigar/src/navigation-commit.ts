import { Effect, Match, Option, Result } from "effect";
import type { HistoryAdapter } from "./history";
import type { HistoryIntent, NavigationError } from "./navigation-types";
import { CurrentTransaction, navigationWrites, ReactiveError } from "./reactive/runtime";

/** Progress remains private until the reactive commit succeeds. */
export interface NavigationProgress {
  phase: NavigationError["phase"];
  location: string;
  canonical: string;
  wroteHistory: boolean;
}

/** Register the synchronous write after validation and before state installation. */
export const stageHistoryWrite = Effect.fn("Navigation.stageHistoryWrite")(function* <D>(options: {
  readonly history: HistoryAdapter;
  readonly intent: HistoryIntent<D>;
  readonly href: string;
  readonly progress: NavigationProgress;
}) {
  const transaction = yield* CurrentTransaction;
  const { history, intent, href, progress } = options;
  yield* Option.match(transaction, {
    onNone: () => Effect.die("Missing navigation transaction"),
    onSome: (transaction) =>
      Effect.sync(() => {
        navigationWrites.set(transaction, () =>
          Match.value(intent).pipe(
            Match.tag("Keep", () => {
              progress.location = href;
              return Result.succeed(undefined);
            }),
            Match.orElse(({ _tag }) => {
              progress.phase = "history";
              return Match.value(_tag).pipe(
                Match.when("Push", () => history.push(href)),
                Match.when("Replace", () => history.replace(href)),
                Match.when("ReplaceUrl", () => history.replace(href)),
                Match.exhaustive,
                Result.map(() => {
                  progress.wroteHistory = true;
                  progress.location = href;
                }),
                Result.mapError(
                  (cause) => new ReactiveError({ message: "History write rejected", cause }),
                ),
              );
            }),
          ),
        );
      }),
  });
});
