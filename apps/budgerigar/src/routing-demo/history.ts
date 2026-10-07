import { Effect, Option, Result } from "effect";
import { HistoryError, type HistoryAdapter } from "~/history";

/** Deterministic demo failure injection; the resource still owns the transport. */
export const controlledHistory = (history: HistoryAdapter) => {
  let next = Option.none<HistoryError>();
  const write = (operation: () => Result.Result<void, HistoryError>) => {
    const failure = next;
    next = Option.none();
    return Option.match(failure, { onNone: operation, onSome: Result.fail });
  };
  const adapter: HistoryAdapter = {
    ...history,
    push: (href) => write(() => history.push(href)),
    replace: (href) => write(() => history.replace(href)),
  };
  return {
    adapter,
    rejectNext: Effect.sync(() => {
      next = Option.some(
        new HistoryError({ operation: "demo", cause: "Mock browser rejected the history write" }),
      );
    }),
  };
};
