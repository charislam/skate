import {
  Cause,
  Context,
  Data,
  Effect,
  Match,
  Option,
  Queue,
  Schema,
  Stream,
  type Fiber,
  type Scope,
} from "effect";

export class ReactiveError extends Schema.TaggedError<ReactiveError>()("ReactiveError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Unknown),
}) {}

export const requireValid = (valid: boolean, message: string) =>
  Match.value(valid).pipe(
    Match.when(true, () => Effect.void),
    Match.when(false, () => Effect.fail(new ReactiveError({ message }))),
    Match.exhaustive,
  );

export const calculate = <A>(work: () => A): Effect.Effect<A, ReactiveError> =>
  Effect.try({ try: work, catch: (cause) => new ReactiveError({ message: String(cause), cause }) });

/** State used only while evaluating writes, preparing candidates, or after closure. */
export type TransactionPhase = Data.TaggedEnum<{
  Staging: { readonly revision: number };
  Preparing: { readonly prepared: Set<SignalCommit> };
  Closed: {};
}>;
export const TransactionPhase = Data.taggedEnum<TransactionPhase>();

export interface Transaction {
  readonly coordinator: CommitCoordinator;
  readonly fiberId: number;
  readonly touched: Set<SignalCommit>;
  readonly reads: Map<SignalCommit, number>;
  readonly publications: Array<() => void>;
  failure: Option.Option<Cause.Cause<unknown>>;
  phase: TransactionPhase;
}

// Only transaction context is ambient; allocation authority always comes from a
// runtime.
export const CurrentTransaction = Context.Reference<Option.Option<Transaction>>(
  "Budgerigar/Transaction",
  {
    defaultValue: Option.none,
  },
);

export interface SignalCommit {
  readonly lifetime: ComponentLifetime;
  readonly dependencies: ReadonlyArray<SignalCommit>;
  readonly dependents: Set<SignalCommit>;
  readonly depth: number;
  version: number;
  readonly prepare: (transaction: Transaction) => Effect.Effect<void, ReactiveError>;
  readonly apply: (transaction: Transaction) => void;
  readonly validateDom: (transaction: Transaction) => Effect.Effect<void, ReactiveError>;
  readonly flushDom: () => Effect.Effect<void>;
  readonly publishChanges: () => void;
  readonly hasChange: (transaction: Transaction) => boolean;
}

/** Shared signal membership; commits run synchronously without yielding. */
export interface CommitCoordinator {
  readonly signals: Set<SignalCommit>;
}

export interface ReactiveFailure {
  readonly operation: "reactive" | "reactive-dom";
  readonly resource: object;
  readonly cause: Cause.Cause<unknown>;
}

/** Component ownership and teardown; independent of signals and transactions. */
export interface ComponentLifetime {
  readonly active: () => boolean;
  readonly parent: Option.Option<ComponentLifetime>;
  readonly fork: (work: Effect.Effect<unknown, unknown, Scope.Scope>) => Effect.Effect<void>;
  readonly report: (failure: ReactiveFailure) => Effect.Effect<void>;
  readonly cleanups: Set<() => void>;
  readonly batchFibers: Set<Fiber.Fiber<unknown, unknown>>;
}

interface EventWork {
  readonly resource: object;
  readonly work: Effect.Effect<void, ReactiveError>;
}

/** Connects component lifetime, shared commits, and ordered DOM event ingress. */
export interface ReactiveRuntime {
  readonly lifetime: ComponentLifetime;
  readonly coordinator: CommitCoordinator;
  readonly eventQueue: Queue.Queue<EventWork>;
}

export const makeReactiveRuntime = Effect.fn("Budgerigar.makeReactiveRuntime")(function* (options: {
  readonly active: () => boolean;
  readonly parent: Option.Option<ReactiveRuntime>;
  readonly fork: ComponentLifetime["fork"];
  readonly report: ComponentLifetime["report"];
}) {
  const eventQueue = yield* Queue.unbounded<EventWork>();
  const coordinator = Option.match(options.parent, {
    onNone: (): CommitCoordinator => ({ signals: new Set() }),
    onSome: (parent) => parent.coordinator,
  });
  const lifetime: ComponentLifetime = {
    active: options.active,
    parent: Option.map(options.parent, (parent) => parent.lifetime),
    fork: options.fork,
    report: options.report,
    cleanups: new Set(),
    batchFibers: new Set(),
  };
  const runtime: ReactiveRuntime = { lifetime, coordinator, eventQueue };
  lifetime.cleanups.add(() => {
    Effect.runSync(Queue.shutdown(eventQueue));
  });
  yield* lifetime.fork(
    Stream.runForEach(Stream.fromQueue(eventQueue), ({ work, resource }) =>
      work.pipe(Effect.catchCause((cause) => reportFailure({ runtime, resource, cause }))),
    ).pipe(Effect.provideService(CurrentTransaction, Option.none())),
  );
  return runtime;
});

export const stopReactiveRuntime = (runtime: ReactiveRuntime): void => {
  for (const fiber of runtime.lifetime.batchFibers) fiber.interruptUnsafe();
  for (const cleanup of runtime.lifetime.cleanups) cleanup();
  runtime.lifetime.cleanups.clear();
};

export const reportFailure = (options: {
  runtime: ReactiveRuntime;
  resource: object;
  cause: Cause.Cause<unknown>;
}) =>
  Match.value(Cause.hasInterruptsOnly(options.cause) && !options.runtime.lifetime.active()).pipe(
    Match.when(true, () => Effect.void),
    Match.orElse(() =>
      options.runtime.lifetime
        .report({ operation: "reactive", resource: options.resource, cause: options.cause })
        .pipe(Effect.catchCause(() => Effect.void)),
    ),
  );

const canConsume = (options: {
  consumer: ComponentLifetime;
  producer: ComponentLifetime;
}): boolean =>
  options.consumer === options.producer ||
  Option.match(options.consumer.parent, {
    onNone: () => false,
    onSome: (parent) => canConsume({ consumer: parent, producer: options.producer }),
  });

export const accessible = (options: { consumer: ComponentLifetime; producer: ComponentLifetime }) =>
  requireValid(
    options.consumer.active() && options.producer.active() && canConsume(options),
    "Reactive resource is disposed or belongs to an unrelated component lifetime",
  );

export const transactionFor = Effect.fn("Budgerigar.transactionFor")(function* (
  runtime: ReactiveRuntime,
) {
  const context = yield* CurrentTransaction;
  const fiberId = yield* Effect.fiberId;
  return yield* Option.match(context, {
    onNone: () => Effect.succeed(Option.none<Transaction>()),
    onSome: (transaction) =>
      poison({
        transaction,
        work: requireValid(
          transaction.phase._tag === "Staging" &&
            transaction.fiberId === fiberId &&
            transaction.coordinator === runtime.coordinator,
          "Batch writes require the owning fiber and a live transaction in the same coordinator",
        ).pipe(Effect.as(Option.some(transaction))),
      }),
  });
});

export const poison = <A, E, R>(options: {
  transaction: Transaction;
  work: Effect.Effect<A, E, R>;
}) =>
  options.work.pipe(
    Effect.tapCause((cause) =>
      Effect.sync(() => {
        options.transaction.failure = Option.some(
          Option.match(options.transaction.failure, {
            onNone: () => cause,
            onSome: (previous) =>
              Match.value(previous === cause).pipe(
                Match.when(true, () => previous),
                Match.orElse(() => Cause.combine(previous, cause)),
              ),
          }),
        );
      }),
    ),
  );

const commit = (transaction: Transaction): Effect.Effect<void, ReactiveError> =>
  // Run the complete synchronous Effect in one section of the calling fiber.
  // The sync runner drains cooperative continuations before returning; validation cannot race a
  // competing commit, and publication cannot precede the DOM flush.
  Effect.sync(() =>
    Effect.runSyncExit(
      Effect.gen(function* () {
        for (const [participant, version] of transaction.reads) {
          yield* requireValid(
            participant.lifetime.active() && participant.version === version,
            "Batch conflict: a signal read or written by this batch changed or was disposed",
          );
        }
        const affected = new Set(transaction.touched);
        for (const participant of affected)
          for (const dependent of participant.dependents) affected.add(dependent);
        const ordered = Array.from(affected).sort((a, b) => a.depth - b.depth);
        transaction.phase = TransactionPhase.Preparing({ prepared: new Set() });
        for (const participant of ordered) {
          yield* Match.value(
            participant.lifetime.active() &&
              (transaction.touched.has(participant) ||
                participant.dependencies.some((dependency) => transaction.touched.has(dependency))),
          ).pipe(
            Match.when(true, () => participant.prepare(transaction)),
            Match.orElse(() => Effect.void),
          );
        }
        const changed = Array.from(transaction.touched).filter((participant) =>
          participant.hasChange(transaction),
        );
        for (const participant of changed) yield* participant.validateDom(transaction);
        for (const participant of changed) participant.apply(transaction);
        for (const participant of changed) yield* participant.flushDom();
        for (const participant of changed) participant.publishChanges();
        for (const publish of transaction.publications) publish();
      }),
    ),
  ).pipe(Effect.flatMap((exit) => exit));

const evaluateBatch = <A, E, R>(options: {
  runtime: ReactiveRuntime;
  work: Effect.Effect<A, E, R>;
}): Effect.Effect<A, E | ReactiveError, R> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* requireValid(options.runtime.lifetime.active(), "Reactive runtime has been disposed");
      const transaction: Transaction = {
        coordinator: options.runtime.coordinator,
        fiberId: yield* Effect.fiberId,
        touched: new Set(),
        reads: new Map(),
        publications: [],
        failure: Option.none(),
        phase: TransactionPhase.Staging({ revision: 0 }),
      };
      return yield* Effect.gen(function* () {
        const value = yield* restore(options.work).pipe(
          Effect.provideService(CurrentTransaction, Option.some(transaction)),
        );
        yield* Option.match(transaction.failure, {
          onNone: () => Effect.void,
          onSome: (cause) =>
            Effect.fail(
              new ReactiveError({
                message: "Batch was invalidated by a failed nested operation",
                cause,
              }),
            ),
        });
        yield* requireValid(
          options.runtime.lifetime.active(),
          "Reactive runtime was disposed during batch",
        );
        yield* commit(transaction);
        return value;
      }).pipe(
        Effect.catchCause((cause) =>
          Option.match(transaction.failure, {
            onNone: () => Effect.failCause(cause),
            onSome: (previous) =>
              Match.value(previous === cause).pipe(
                Match.when(true, () => Effect.failCause(cause)),
                Match.orElse(() =>
                  Effect.fail(
                    new ReactiveError({
                      message: "Batch failed",
                      cause: Cause.combine(previous, cause),
                    }),
                  ),
                ),
              ),
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            transaction.phase = TransactionPhase.Closed();
            transaction.publications.length = 0;
            transaction.touched.clear();
            transaction.reads.clear();
          }),
        ),
      );
    }),
  );

export const runBatch = <A, E, R>(options: {
  runtime: ReactiveRuntime;
  work: Effect.Effect<A, E, R>;
}): Effect.Effect<A, E | ReactiveError, R> =>
  Effect.gen(function* () {
    yield* requireValid(options.runtime.lifetime.active(), "Reactive runtime has been disposed");
    const inherited = yield* transactionFor(options.runtime);
    return yield* Option.match(inherited, {
      onSome: (transaction) => poison({ transaction, work: options.work }),
      onNone: () =>
        Effect.withFiber((fiber) => {
          options.runtime.lifetime.batchFibers.add(fiber);
          return evaluateBatch(options).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                options.runtime.lifetime.batchFibers.delete(fiber);
              }),
            ),
          );
        }),
    });
  });
