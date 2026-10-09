import { Match, Option } from "effect";
import type { ReactiveRuntime, SignalCommit, Transaction } from "~/reactive/runtime";
import { signalData, type Signal } from "~/reactive/signal";

/** Invalidate projections in the existing transaction without starting requests in preparation. */
export const trackInputs = (options: {
  readonly runtime: ReactiveRuntime;
  readonly input: Signal<unknown>;
  readonly pulse: Signal<number>;
}): (() => void) => {
  const roots = new Set<SignalCommit>();
  const visited = new Set<SignalCommit>();
  const visit = (signal: SignalCommit): void => {
    Match.value(visited.has(signal)).pipe(
      Match.when(false, () => {
        visited.add(signal);
        Match.value(signal.dependencies.length === 0).pipe(
          Match.when(true, () => {
            roots.add(signal);
          }),
          Match.when(false, () => {
            for (const source of signal.dependencies) visit(source);
          }),
          Match.exhaustive,
        );
      }),
      Match.orElse(() => {}),
    );
  };
  visit(signalData(options.input).participant);
  const invalidate = (transaction: Transaction): void => {
    transaction.touched.add(signalData(options.pulse).participant);
  };
  for (const root of roots) {
    const checks = Option.getOrElse(
      Option.fromUndefinedOr(options.runtime.coordinator.stagedChecks.get(root)),
      () => new Set<(transaction: Transaction) => void>(),
    );
    checks.add(invalidate);
    options.runtime.coordinator.stagedChecks.set(root, checks);
  }
  return () => {
    for (const root of roots) {
      Option.match(Option.fromUndefinedOr(options.runtime.coordinator.stagedChecks.get(root)), {
        onNone: () => {},
        onSome: (checks) => {
          checks.delete(invalidate);
          Match.value(checks.size === 0).pipe(
            Match.when(true, () => options.runtime.coordinator.stagedChecks.delete(root)),
            Match.orElse(() => {}),
          );
        },
      });
    }
  };
};
