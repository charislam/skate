import { Result } from "effect";
import { makeLens } from "./reactive/lens";
import { ownerRuntime, type ReactiveOwner } from "./reactive/owner";
import { requireValidSync, type ReactiveError } from "./reactive/runtime";
import { type Signal, type WritableSignal } from "./reactive/signal";
import { fromResultLazy, type Sync } from "./sync";

type Field<A> = Exclude<keyof A, "_tag">;
export function focus<A, K extends Field<A>>(options: {
  context: ReactiveOwner;
  source: WritableSignal<A>;
  key: K;
}): Sync<WritableSignal<A[K]>, ReactiveError>;
export function focus<A, K extends Field<A>>(options: {
  context: ReactiveOwner;
  source: Signal<A>;
  key: K;
}): Sync<Signal<A[K]>, ReactiveError>;
export function focus<A, K extends Field<A>>(options: {
  context: ReactiveOwner;
  source: Signal<A>;
  key: K;
}): Sync<Signal<A[K]>, ReactiveError> {
  return fromResultLazy(() =>
    requireValidSync(String(options.key) !== "_tag", "Discriminant projection is excluded").pipe(
      Result.flatMap(() =>
        makeLens({
          runtime: ownerRuntime(options.context),
          source: options.source,
          project: (parent) => parent[options.key],
          replace: ({ parent, value }) => ({ ...parent, [options.key]: value }),
        }),
      ),
    ),
  );
}
