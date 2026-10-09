import { Effect, Schema } from "effect";
import type { HistoryAdapter } from "./history";
import type { ReactiveOwner } from "./reactive/owner";
import type { WritableSignal } from "./reactive/signal";
import type { Destination, ParseResult, Route, Router } from "./routes";

export type NavigationMode = "push" | "replace";
export type NavigationEvent<T extends ReadonlyArray<Route>, E> =
  | {
      readonly _tag: "Navigate";
      readonly destination: Destination<T>;
      readonly mode: NavigationMode;
    }
  | {
      readonly _tag: "Location";
      readonly target: ParseResult<T>;
      readonly observed: string;
      readonly initial: boolean;
    }
  | { readonly _tag: "Application"; readonly event: E };
export type HistoryIntent<D> =
  | { readonly _tag: "Keep" }
  | { readonly _tag: "ReplaceUrl"; readonly url: string }
  | { readonly _tag: "Push" | "Replace"; readonly destination: D };
export interface NavigationDecision<S, D> {
  readonly state: S;
  readonly history: HistoryIntent<D>;
}
export class NavigationError extends Schema.TaggedError<NavigationError>()("NavigationError", {
  phase: Schema.Literals(["build", "prepare", "history", "traversal", "reconcile", "disposed"]),
  cause: Schema.Unknown,
  observed: Schema.Option(Schema.String),
  lastCommittedLocation: Schema.String,
  lastCommittedState: Schema.Unknown,
}) {}
export interface Navigator<T extends ReadonlyArray<Route>, E> {
  readonly navigate: (
    destination: Destination<T>,
    options?: { readonly mode?: NavigationMode },
  ) => Effect.Effect<void, NavigationError>;
  readonly dispatch: (event: E) => Effect.Effect<void, NavigationError>;
  readonly initial: Effect.Effect<void, NavigationError>;
  readonly committedLocation: () => string;
}
export interface NavigationOptions<T extends ReadonlyArray<Route>, S, E> {
  readonly context: ReactiveOwner;
  readonly router: Router<T>;
  readonly state: WritableSignal<S>;
  readonly history: HistoryAdapter;
  readonly transition: (options: {
    readonly state: S;
    readonly event: NavigationEvent<T, E>;
  }) => NavigationDecision<S, Destination<T>>;
  readonly onError: (error: NavigationError) => void;
}
