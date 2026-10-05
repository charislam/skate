import { Effect, Match, Option, Result, Queue, Stream } from "effect";
import { lazy } from "~/synchronous";
import {
  accessibleSync,
  calculate,
  calculateSync,
  CurrentTransaction,
  poison,
  requireValid,
  requireValidSync,
  runBatch,
  synchronousTransactions,
  transactionFor,
  type ReactiveRuntime,
  type SignalCommit,
  type Transaction,
  ReactiveError,
  TransactionPhase,
} from "./runtime";

export interface DomSink {
  readonly validate: (
    transaction: Option.Option<Transaction>,
  ) => Result.Result<void, ReactiveError>;
  readonly flush: () => Effect.Effect<void>;
}

const SignalTypeId = "~budgerigar/Signal";
const SignalState = Symbol("Budgerigar/SignalState");
interface SignalData<A> {
  readonly participant: SignalCommit;
  readonly candidate: (transaction: Option.Option<Transaction>) => A;
  readonly bind: (sink: DomSink) => () => void;
}
export interface Signal<A> {
  readonly [SignalTypeId]: typeof SignalTypeId;
  readonly get: Effect.Effect<A, ReactiveError>;
  /** Acquisition installs the initial snapshot and future subscription atomically. */
  readonly changes: Effect.Effect<Stream.Stream<A>, ReactiveError>;
  readonly [SignalState]: SignalData<A>;
}

export const signalData = <A>(signal: Signal<A>): SignalData<A> => signal[SignalState];

export interface WritableSignal<A> extends Signal<A> {
  readonly set: (value: A) => Effect.Effect<void, ReactiveError>;
  readonly update: (f: (value: A) => A) => Effect.Effect<void, ReactiveError>;
}

export const isSignal = (value: unknown): value is Signal<unknown> =>
  typeof value === "object" && value !== null && SignalTypeId in value && SignalState in value;

export interface SignalOptions<A> {
  readonly initial: A;
  readonly equals?: Equality<A>;
}

export type Equality<A> = (options: { readonly previous: A; readonly proposed: A }) => boolean;

interface CellOptions<A> extends SignalOptions<A> {
  readonly runtime: ReactiveRuntime;
  readonly dependencies: ReadonlyArray<SignalCommit>;
  readonly compute: Option.Option<(transaction: Option.Option<Transaction>) => A>;
}

export const makeCell = <A>(options: CellOptions<A>): WritableSignal<A> => {
  let value = options.initial;
  const staged = new WeakMap<Transaction, { readonly value: A }>();
  const readCache = new WeakMap<Transaction, { readonly value: A; readonly revision: number }>();
  const bindings = new Set<DomSink>();
  const observers = new Set<Queue.Queue<A>>();
  const equals: Equality<A> =
    options.equals ?? (({ previous, proposed }) => Object.is(previous, proposed));
  const stagedValue = (transaction: Transaction): A =>
    Option.getOrElse(Option.fromUndefinedOr(staged.get(transaction)), () => ({ value })).value;
  const readSource = (transaction: Transaction): A =>
    Match.value(transaction.phase).pipe(
      Match.tag("Staging", () => {
        // Capture a repeatable source snapshot on first access. A concurrent
        // change invalidates the batch at commit instead of losing an update.
        Match.value(transaction.reads.has(participant)).pipe(
          Match.when(false, () => {
            transaction.reads.set(participant, participant.version);
            staged.set(transaction, { value });
          }),
          Match.orElse(() => {}),
        );
        return { value: stagedValue(transaction) };
      }),
      Match.tag("Preparing", () => ({ value: stagedValue(transaction) })),
      Match.tag("Closed", () => ({ value })),
      Match.exhaustive,
    ).value;
  const derivedCandidate = (options: {
    transaction: Transaction;
    compute: (transaction: Option.Option<Transaction>) => A;
  }): A => {
    const { transaction, compute } = options;
    return Match.value(transaction.phase).pipe(
      Match.tag("Staging", ({ revision }) => ({
        value: Option.match(
          Option.filter(
            Option.fromUndefinedOr(readCache.get(transaction)),
            (entry) => entry.revision === revision,
          ),
          {
            onSome: (entry) => entry.value,
            onNone: () => {
              const proposed = compute(Option.some(transaction));
              const previous = Option.getOrElse(
                Option.fromUndefinedOr(readCache.get(transaction)),
                () => ({ value }),
              ).value;
              const entry = {
                value: Match.value(equals({ previous, proposed })).pipe(
                  Match.when(true, () => ({ value: previous })),
                  Match.orElse(() => ({ value: proposed })),
                ).value,
                revision,
              };
              readCache.set(transaction, entry);
              return entry.value;
            },
          },
        ),
      })),
      Match.tag("Preparing", ({ prepared }) =>
        Match.value(prepared.has(participant)).pipe(
          Match.when(true, () => ({ value: stagedValue(transaction) })),
          Match.orElse(() => ({ value })),
        ),
      ),
      Match.tag("Closed", () => ({ value })),
      Match.exhaustive,
    ).value;
  };
  const candidate = (transaction: Option.Option<Transaction>): A =>
    Option.match(transaction, {
      onNone: () => value,
      onSome: (tx) =>
        Option.match(options.compute, {
          onNone: () => readSource(tx),
          onSome: (compute) => derivedCandidate({ transaction: tx, compute }),
        }),
    });
  const participant: SignalCommit = {
    lifetime: options.runtime.lifetime,
    dependencies: options.dependencies,
    dependents: new Set(),
    depth: options.dependencies.reduce(
      (depth, dependency) => Math.max(depth, dependency.depth + 1),
      0,
    ),
    version: 0,
    prepare: (transaction) =>
      Effect.gen(function* () {
        const prepared = yield* Match.value(transaction.phase).pipe(
          Match.tag("Preparing", ({ prepared }) => Effect.succeed(prepared)),
          Match.orElse(() =>
            Effect.fail(
              new ReactiveError({ message: "Signal preparation requires the preparing phase" }),
            ),
          ),
        );
        yield* calculate(() => {
          const proposed = Option.match(options.compute, {
            onNone: () => stagedValue(transaction),
            onSome: (compute) => compute(Option.some(transaction)),
          });
          Match.value(equals({ previous: value, proposed })).pipe(
            Match.when(true, () => {
              staged.set(transaction, { value });
              transaction.touched.delete(participant);
            }),
            Match.when(false, () => {
              staged.set(transaction, { value: proposed });
              transaction.touched.add(participant);
            }),
            Match.exhaustive,
          );
          prepared.add(participant);
        });
      }),
    hasChange: (transaction) => !Object.is(stagedValue(transaction), value),
    apply: (transaction) => {
      value = stagedValue(transaction);
      participant.version += 1;
    },
    validateDom: (transaction) =>
      Effect.forEach(bindings, (sink) => lazy(() => sink.validate(Option.some(transaction))), {
        discard: true,
      }),
    flushDom: () => Effect.forEach(bindings, (sink) => sink.flush(), { discard: true }),
    publishChanges: () => {
      for (const queue of observers) Queue.offerUnsafe(queue, value);
    },
  };
  options.runtime.coordinator.signals.add(participant);
  for (const dependency of options.dependencies) dependency.dependents.add(participant);
  options.runtime.lifetime.cleanups.add(() => {
    bindings.clear();
    for (const queue of observers) Effect.runSync(Queue.shutdown(queue));
    observers.clear();
    options.runtime.coordinator.signals.delete(participant);
    for (const dependency of options.dependencies) dependency.dependents.delete(participant);
    participant.dependents.clear();
  });
  const write = (f: (previous: A) => A) =>
    runBatch({
      runtime: options.runtime,
      work: Effect.gen(function* () {
        const transaction = yield* transactionFor(options.runtime).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new ReactiveError({ message: "Missing write transaction" })),
              onSome: Effect.succeed,
            }),
          ),
        );
        yield* poison({
          transaction,
          work: Effect.gen(function* () {
            const change = yield* calculate(() => {
              const previous = readSource(transaction);
              const proposed = f(previous);
              return { proposed, equal: equals({ previous, proposed }) };
            });
            yield* Match.value(change.equal).pipe(
              Match.when(true, () => Effect.void),
              Match.when(false, () =>
                Match.value(transaction.phase).pipe(
                  Match.tag("Staging", ({ revision }) =>
                    Effect.sync(() => {
                      transaction.phase = TransactionPhase.Staging({ revision: revision + 1 });
                      staged.set(transaction, { value: change.proposed });
                      transaction.touched.add(participant);
                    }),
                  ),
                  Match.orElse(() =>
                    Effect.fail(
                      new ReactiveError({ message: "Signal writes require the staging phase" }),
                    ),
                  ),
                ),
              ),
              Match.exhaustive,
            );
          }),
        });
      }),
    });
  return {
    [SignalTypeId]: SignalTypeId,
    [SignalState]: {
      participant,
      candidate,
      bind: (sink) => {
        bindings.add(sink);
        return () => {
          bindings.delete(sink);
        };
      },
    },
    get: Effect.gen(function* () {
      yield* requireValid(options.runtime.lifetime.active(), "Signal runtime has been disposed");
      const inherited = yield* CurrentTransaction;
      const synchronous = Option.fromUndefinedOr(
        synchronousTransactions.get(options.runtime.coordinator),
      );
      const transaction = Option.orElse(inherited, () => synchronous);
      const id = yield* Effect.fiberId;
      const visible = Option.filter(
        transaction,
        (tx) =>
          tx.phase._tag === "Staging" &&
          (tx.fiberId === id || Option.contains(synchronous, tx)) &&
          tx.coordinator === options.runtime.coordinator,
      );
      const work = calculate(() => candidate(visible));
      return yield* Option.match(visible, {
        onNone: () => work,
        onSome: (transaction) => poison({ transaction, work }),
      });
    }),
    changes: Effect.gen(function* () {
      yield* requireValid(options.runtime.lifetime.active(), "Signal runtime has been disposed");
      const queue = yield* Queue.unbounded<A>();
      // This synchronous section has no read/subscribe race.
      yield* Effect.sync(() => {
        observers.add(queue);
        Queue.offerUnsafe(queue, value);
      });
      return Stream.fromQueue(queue).pipe(
        Stream.ensuring(
          Effect.sync(() => {
            observers.delete(queue);
            Effect.runSync(Queue.shutdown(queue));
          }),
        ),
      );
    }),
    set: (next) => write(() => next),
    update: write,
  };
};

export type Sources = Readonly<Record<string, Signal<unknown>>>;
export type Values<S extends Sources> = {
  readonly [K in keyof S]: S[K] extends Signal<infer A> ? A : never;
};

export const sourceValues = <S extends Sources>(
  sources: S,
  transaction: Option.Option<Transaction>,
): Values<S> =>
  Object.fromEntries(
    Object.entries(sources).map(([key, signal]) => [
      key,
      signalData(signal).candidate(transaction),
    ]),
  ) as Values<S>;

export const deriveSync = <S extends Sources, A>(options: {
  readonly runtime: ReactiveRuntime;
  readonly sources: S;
  readonly compute: (values: Values<S>) => A;
  readonly equals?: Equality<A>;
}): Result.Result<Signal<A>, ReactiveError> =>
  Result.gen(function* () {
    yield* requireValidSync(
      options.runtime.lifetime.active(),
      "Reactive runtime has been disposed",
    );
    const sources = { ...options.sources };
    for (const signal of Object.values(sources))
      yield* accessibleSync({
        consumer: options.runtime.lifetime,
        producer: signalData(signal).participant.lifetime,
      });
    const calculateValue = options.compute;
    const compute = (tx: Option.Option<Transaction>) => calculateValue(sourceValues(sources, tx));
    const initial = yield* calculateSync(() => compute(Option.none()));
    const cell = makeCell({
      ...options,
      initial,
      compute: Option.some(compute),
      dependencies: Object.values(sources).map((signal) => signalData(signal).participant),
    });
    // Hide mutation capabilities of derived signals at runtime as well as in types.
    const { set: _set, update: _update, ...signal } = cell;
    return signal;
  });

export const readSync = <A>(options: {
  runtime: ReactiveRuntime;
  signal: Signal<A>;
}): Result.Result<A, ReactiveError> =>
  Result.gen(function* () {
    yield* accessibleSync({
      consumer: options.runtime.lifetime,
      producer: signalData(options.signal).participant.lifetime,
    });
    return signalData(options.signal).candidate(Option.none());
  });

export const derive = <S extends Sources, A>(options: {
  readonly runtime: ReactiveRuntime;
  readonly sources: S;
  readonly compute: (values: Values<S>) => A;
  readonly equals?: Equality<A>;
}) => lazy(() => deriveSync(options));
