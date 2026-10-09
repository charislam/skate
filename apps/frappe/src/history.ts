import { Effect, Match, Option, Result, Schema } from "effect";
import * as Resource from "./resource";

export class HistoryError extends Schema.TaggedError<HistoryError>()("HistoryError", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}
export interface HistoryAdapter {
  /** Stable transport identity, preserved by decorators. */
  readonly identity: object;
  readonly origin: string;
  /** Snapshot and traversal observation are acquired in one synchronous section. */
  readonly observe: (listener: (location: string) => void) => {
    readonly initial: string;
    readonly dispose: () => void;
  };
  readonly push: (location: string) => Result.Result<void, HistoryError>;
  readonly replace: (location: string) => Result.Result<void, HistoryError>;
}
export class History extends Resource.Service<History, HistoryAdapter>()("History") {}
export interface MemoryHistory extends HistoryAdapter {
  readonly entries: () => ReadonlyArray<string>;
  readonly location: () => string;
  readonly traverse: (delta: number) => Result.Result<void, HistoryError>;
  readonly failNextWrite: (cause: unknown) => void;
  readonly listenerCount: () => number;
}
export const memoryHistory = Effect.fn("History.memory")(function* (options: {
  readonly initial: string;
}) {
  let entries = [options.initial];
  let position = 0;
  let disposed = false;
  let failure = Option.none<unknown>();
  const listeners = new Set<(location: string) => void>();
  const location = () => entries[position] ?? options.initial;
  const operation = (name: string, work: () => void) =>
    Result.gen(function* () {
      yield* Match.value(disposed).pipe(
        Match.when(true, () =>
          Result.fail(new HistoryError({ operation: name, cause: "Disposed history" })),
        ),
        Match.orElse(() => Result.succeed(undefined)),
      );
      const next = Match.value(name === "traverse").pipe(
        Match.when(true, () => Option.none<unknown>()),
        Match.orElse(() => {
          const next = failure;
          failure = Option.none();
          return next;
        }),
      );
      yield* Option.match(next, {
        onNone: () => Result.succeed(undefined),
        onSome: (cause) => Result.fail(new HistoryError({ operation: name, cause })),
      });
      work();
    });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      disposed = true;
      listeners.clear();
    }),
  );
  const adapter: MemoryHistory = {
    identity: {},
    origin: "http://frappe.local",
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
    location,
    entries: () => [...entries],
    listenerCount: () => listeners.size,
    failNextWrite: (cause) => {
      failure = Option.some(cause);
    },
    push: (href) =>
      operation("push", () => {
        entries = [...entries.slice(0, position + 1), href];
        position += 1;
      }),
    replace: (href) =>
      operation("replace", () => {
        entries[position] = href;
      }),
    traverse: (delta) =>
      operation("traverse", () => {
        const next = Math.max(0, Math.min(entries.length - 1, position + delta));
        Match.value(next !== position).pipe(
          Match.when(true, () => {
            position = next;
            for (const listener of listeners) listener(location());
          }),
          Match.orElse(() => {}),
        );
      }),
  };
  return adapter;
});
