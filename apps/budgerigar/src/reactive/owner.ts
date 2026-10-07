import type { ReactiveRuntime } from "./runtime";

const OwnerRuntime = Symbol("Budgerigar/OwnerRuntime");

export interface ReactiveOwner {
  readonly [OwnerRuntime]: ReactiveRuntime;
}
export const reactiveOwner = (runtime: ReactiveRuntime): ReactiveOwner => ({
  [OwnerRuntime]: runtime,
});
export const ownerRuntime = (context: ReactiveOwner): ReactiveRuntime => context[OwnerRuntime];
