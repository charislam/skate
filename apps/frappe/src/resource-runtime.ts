import { Option, type Clock, type Context } from "effect";
import type { CommitCoordinator, ReactiveRuntime } from "./reactive/runtime";

interface Environment {
  readonly environment: Context.Context<never>;
  readonly clock: Clock.Clock;
}
const environments = new WeakMap<CommitCoordinator, Environment>();
/** Runtime-owned execution environment, independent of ancestor and local context. */
export const installResourceEnvironment = (
  options: Environment & { readonly runtime: ReactiveRuntime },
): void => {
  environments.set(options.runtime.coordinator, options);
};
export const resourceEnvironment = (runtime: ReactiveRuntime): Environment =>
  Option.getOrThrowWith(
    Option.fromUndefinedOr(environments.get(runtime.coordinator)),
    () => new TypeError("frappé runtime execution requires a mounting resource environment"),
  );
