import { Effect, Match, Option, Result } from "effect";
import { lazy } from "~/synchronous";
import {
  calculate,
  calculateSync,
  poison,
  requireValidSync,
  runBatch,
  type ReactiveError,
  type ReactiveRuntime,
  type Transaction,
} from "./runtime";
import {
  deriveSync,
  isWritableSignal,
  readTransaction,
  signalData,
  signalView,
  type Signal,
  type WritableSignal,
} from "./signal";

/** Internal authoritative lens. The derived cell participates in the parent's commit graph. */
export const makeLens = <A, B>(options: {
  readonly runtime: ReactiveRuntime;
  readonly source: Signal<A>;
  readonly project: (value: A) => B;
  readonly replace: (options: { parent: A; value: B }) => A;
  readonly valid?: (options: { value: A; transaction: Option.Option<Transaction> }) => boolean;
}): Result.Result<Signal<B> | WritableSignal<B>, ReactiveError> =>
  Result.gen(function* () {
    const { runtime, source } = options;
    const invalidated = new WeakSet<Transaction>();
    const data = signalData(source);
    const check = (transaction: Option.Option<Transaction>) =>
      Result.gen(function* () {
        yield* requireValidSync(runtime.lifetime.active(), "Lens occurrence has expired");
        yield* requireValidSync(
          !Option.exists(transaction, (tx) => tx.phase._tag === "Staging" && invalidated.has(tx)),
          "Lens occurrence left or rekeyed during this batch",
        );
        const value = yield* data.candidate(transaction);
        const valid = yield* calculateSync(() => options.valid?.({ value, transaction }) ?? true);
        yield* requireValidSync(valid, "Lens occurrence no longer matches its source");
        return value;
      });
    const stagedCheck = (transaction: Transaction) => {
      Match.value(Result.isFailure(check(Option.some(transaction)))).pipe(
        Match.when(true, () => invalidated.add(transaction)),
        Match.orElse(() => {}),
      );
    };
    const derived = yield* deriveSync({
      runtime,
      sources: { source },
      compute: ({ source }) => options.project(source),
    });
    const candidate = (transaction: Option.Option<Transaction>) =>
      check(transaction).pipe(
        Result.flatMap((value) => calculateSync(() => options.project(value))),
      );
    const checks =
      runtime.coordinator.stagedChecks.get(data.writableRoot) ??
      new Set<(transaction: Transaction) => void>();
    checks.add(stagedCheck);
    runtime.coordinator.stagedChecks.set(data.writableRoot, checks);
    runtime.lifetime.cleanups.add(() => {
      checks.delete(stagedCheck);
      Match.value(checks.size === 0).pipe(
        Match.when(true, () => runtime.coordinator.stagedChecks.delete(data.writableRoot)),
        Match.orElse(() => {}),
      );
    });
    const get = Effect.gen(function* () {
      const transaction = yield* readTransaction(runtime);
      const work = lazy(() => candidate(transaction));
      return yield* Option.match(transaction, {
        onNone: () => work,
        onSome: (transaction) => poison({ transaction, work }),
      });
    });
    const lens = signalView({ signal: derived, candidate, writableRoot: data.writableRoot, get });
    return Match.value(isWritableSignal(source)).pipe(
      Match.when(false, () => lens),
      Match.when(true, () => {
        // The predicate establishes this capability at the private erasure boundary.
        const writable = source as WritableSignal<A>;
        const update = (f: (value: B) => B) =>
          runBatch({
            runtime,
            work: Effect.gen(function* () {
              const current = yield* get;
              const next = yield* calculate(() => f(current));
              yield* writable.update((parent) => options.replace({ parent, value: next }));
            }),
          });
        return { ...lens, set: (value: B) => update(() => value), update };
      }),
      Match.exhaustive,
    );
  });
