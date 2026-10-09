import { Option } from "effect";
import type { ReactiveContext, SynchronousReactiveContext } from "./context";
import type { ReactiveRuntime } from "./runtime";

/** Public helpers accept contexts through their component-facing operations. */
export type ReactiveOwner = ReactiveContext | SynchronousReactiveContext;

const runtimes = new WeakMap<object, ReactiveRuntime>();

/** Internal registration; contexts carry no runtime fields or symbols. */
export const registerOwner = <A extends object>(context: A, runtime: ReactiveRuntime): A => {
  runtimes.set(context, runtime);
  return context;
};

/** Internal checked lookup, deliberately absent from public framework exports. */
export const ownerRuntime = (context: ReactiveOwner): ReactiveRuntime =>
  Option.match(Option.fromUndefinedOr(runtimes.get(context)), {
    onSome: (runtime) => runtime,
    onNone: () => {
      throw new TypeError("frappé owner access requires an original framework context");
    },
  });
