import { Cause, Deferred, Effect, Exit, Fiber, Match, Option, Queue, Scope, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeReactiveRuntime,
  mapEvents,
  mergeEvents,
  reactive,
  stopReactiveRuntime,
  type ReactiveFailure,
  type ReactiveRuntime,
} from "./reactive";
import { signalData } from "./reactive/signal";

const run = Effect.runPromise;
const closes: Array<() => Promise<void>> = [];
const harness = async (parent: Option.Option<ReactiveRuntime> = Option.none()) => {
  const scope = await run(Scope.make());
  let active = true;
  const failures: ReactiveFailure[] = [];
  const owner = await run(
    makeReactiveRuntime({
      active: () => active,
      parent,
      fork: (work) => Effect.forkIn(work.pipe(Scope.provide(scope)), scope).pipe(Effect.asVoid),
      report: (failure) =>
        Effect.sync(() => {
          failures.push(failure);
        }),
    }),
  );
  const close = async () => {
    active = false;
    stopReactiveRuntime(owner);
    await run(Scope.close(scope, Exit.void));
  };
  closes.push(close);
  return { ...reactive(owner), owner, failures, close, scope };
};

afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});

const collect = async <A>(signal: { changes: Effect.Effect<Stream.Stream<A>, unknown> }) => {
  const observed = await run(Queue.unbounded<A>());
  const stream = await run(signal.changes);
  const fiber = run(Stream.runForEach(stream, (value) => Queue.offer(observed, value)));
  void fiber.catch(() => {});
  return observed;
};

describe("reactive commits", () => {
  it("propagates chains and diamonds as one consistent snapshot", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 1 }));
    const doubled = await run(r.derive({ sources: { x }, compute: ({ x }) => x * 2 }));
    const plusOne = await run(r.derive({ sources: { x }, compute: ({ x }) => x + 1 }));
    const sum = await run(
      r.derive({
        sources: { doubled, plusOne },
        compute: ({ doubled, plusOne }) => doubled + plusOne,
      }),
    );
    const all = await run(r.combine({ x, doubled, plusOne, sum }));
    const observed = await collect(all);
    expect(await run(Queue.take(observed))).toEqual({ x: 1, doubled: 2, plusOne: 2, sum: 4 });
    await run(x.set(2));
    expect(await run(all.get)).toEqual({ x: 2, doubled: 4, plusOne: 3, sum: 7 });
    expect(await run(Queue.take(observed))).toEqual({ x: 2, doubled: 4, plusOne: 3, sum: 7 });
  });

  it("stages awaited batches privately while unrelated writers proceed, and nests without intermediate commits", async () => {
    const r = await harness();
    const a = await run(r.signal({ initial: 1 }));
    const b = await run(r.signal({ initial: 2 }));
    const c = await run(r.signal({ initial: 0 }));
    const both = await run(r.combine({ a, b }));
    const observed = await collect(both);
    expect(await run(Queue.take(observed))).toEqual({ a: 1, b: 2 });
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const batch = run(
      r.batch(
        Effect.gen(function* () {
          yield* a.set(2);
          expect(yield* both.get).toEqual({ a: 2, b: 2 });
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          yield* r.batch(b.set(3));
          expect(yield* both.get).toEqual({ a: 2, b: 3 });
        }),
      ),
    );
    await run(Deferred.await(started));
    expect(await run(both.get)).toEqual({ a: 1, b: 2 });
    await run(c.set(5));
    expect(await run(c.get)).toBe(5);
    expect(await run(both.get)).toEqual({ a: 1, b: 2 });
    await run(Deferred.succeed(release, undefined));
    await batch;
    await run(a.set(4));
    expect(await run(Queue.take(observed))).toEqual({ a: 2, b: 3 });
    expect(await run(Queue.take(observed))).toEqual({ a: 4, b: 3 });
  });

  it("rejects stale batches without replaying their bodies or publishing staged events", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 1 }));
    const y = await run(r.signal({ initial: 0 }));
    const source = await run(r.source<number>());
    const folded = await run(
      r.fold({ events: source.events, initial: 0, reducer: ({ state, event }) => state + event }),
    );
    const observed = await collect(folded);
    expect(await run(Queue.take(observed))).toBe(0);
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    let invocations = 0;
    const pending = run(
      r
        .batch(
          Effect.gen(function* () {
            invocations++;
            const initial = yield* x.get;
            yield* y.set(initial + 10);
            yield* source.emit(7);
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            expect(yield* x.get).toBe(initial);
          }),
        )
        .pipe(Effect.exit),
    );
    await run(Deferred.await(started));
    await run(x.set(2));
    await run(Deferred.succeed(release, undefined));
    const result = await pending;
    expect(Exit.isFailure(result)).toBe(true);
    expect(Exit.isFailure(result) && Cause.pretty(result.cause)).toContain("Batch conflict");
    expect(invocations).toBe(1);
    expect(await run(y.get)).toBe(0);
    expect(await run(folded.get)).toBe(0);
    await run(source.emit(3));
    expect(await run(Queue.take(observed))).toBe(3);
  });

  it("rejects conflicting writes, including changes that return to the original value", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 1 }));
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const pending = run(
      r
        .batch(
          Effect.gen(function* () {
            yield* x.update((n) => n + 1);
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
          }),
        )
        .pipe(Effect.exit),
    );
    await run(Deferred.await(started));
    await run(x.set(3));
    await run(x.set(1));
    await run(Deferred.succeed(release, undefined));
    expect(Exit.isFailure(await pending)).toBe(true);
    expect(await run(x.get)).toBe(1);
  });

  it("combines disjoint commits into consistent shared downstream snapshots", async () => {
    const r = await harness();
    const child = await harness(Option.some(r.owner));
    expect(child.owner.coordinator).toBe(r.owner.coordinator);
    const a = await run(r.signal({ initial: 1 }));
    const b = await run(child.signal({ initial: 2 }));
    const both = await run(child.combine({ a, b }));
    const observed = await collect(both);
    expect(await run(Queue.take(observed))).toEqual({ a: 1, b: 2 });
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const pending = run(
      r.batch(
        Effect.gen(function* () {
          yield* a.set(3);
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
        }),
      ),
    );
    await run(Deferred.await(started));
    await run(b.set(4));
    expect(await run(Queue.take(observed))).toEqual({ a: 1, b: 4 });
    await run(Deferred.succeed(release, undefined));
    await pending;
    expect(await run(Queue.take(observed))).toEqual({ a: 3, b: 4 });
  });

  it("visits only affected dependencies and prunes propagation at equal values", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 1 }));
    const compute = vi.fn(({ x }: { x: number }) => x % 2);
    const parity = await run(r.derive({ sources: { x }, compute }));
    const downstream = vi.fn(({ parity }: { parity: number }) => parity * 10);
    const result = await run(r.derive({ sources: { parity }, compute: downstream }));
    for (let index = 0; index < 1000; index++) await run(r.signal({ initial: index }));
    const scan = vi.spyOn(r.owner.coordinator.signals, Symbol.iterator);
    await run(x.set(3));
    expect(scan).not.toHaveBeenCalled();
    expect(compute).toHaveBeenCalledTimes(2);
    expect(downstream).toHaveBeenCalledTimes(1);
    await run(x.set(4));
    expect(await run(result.get)).toBe(0);
    expect(downstream).toHaveBeenCalledTimes(2);
    scan.mockRestore();
  });

  it("unlinks disposed descendants from ancestor signals", async () => {
    const parent = await harness();
    const x = await run(parent.signal({ initial: 1 }));
    const child = await harness(Option.some(parent.owner));
    const compute = vi.fn(({ x }: { x: number }) => x * 2);
    await run(child.derive({ sources: { x }, compute }));
    expect(signalData(x).participant.dependents.size).toBe(1);
    await child.close();
    expect(signalData(x).participant.dependents.size).toBe(0);
    await run(x.set(2));
    expect(compute).toHaveBeenCalledTimes(1);
    expect(parent.owner.coordinator.signals.size).toBe(1);
  });

  it("tracks source dependencies of derived reads when detecting conflicts", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 1 }));
    const y = await run(r.signal({ initial: 0 }));
    const doubled = await run(r.derive({ sources: { x }, compute: ({ x }) => x * 2 }));
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const pending = run(
      r
        .batch(
          Effect.gen(function* () {
            yield* y.set(yield* doubled.get);
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
          }),
        )
        .pipe(Effect.exit),
    );
    await run(Deferred.await(started));
    await run(x.set(2));
    await run(Deferred.succeed(release, undefined));
    expect(Exit.isFailure(await pending)).toBe(true);
    expect(await run(y.get)).toBe(0);
    expect(await run(doubled.get)).toBe(4);
  });

  it("rolls back body, nested, and commit failures and allows subsequent writes", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 0 }));
    const derived = await run(
      r.derive({
        sources: { x },
        compute: ({ x }) => {
          expect(x).not.toBe(99);
          return x * 2;
        },
      }),
    );
    const failed = await run(
      r.batch(x.set(1).pipe(Effect.andThen(Effect.fail("body")))).pipe(Effect.exit),
    );
    expect(Exit.isFailure(failed)).toBe(true);
    expect(await run(x.get)).toBe(0);
    const nested = await run(
      r
        .batch(
          Effect.gen(function* () {
            yield* x.set(2);
            yield* r.batch(Effect.fail("nested")).pipe(Effect.catch(() => Effect.void));
          }),
        )
        .pipe(Effect.exit),
    );
    expect(Exit.isFailure(nested)).toBe(true);
    const commitFailed = await run(x.set(99).pipe(Effect.exit));
    expect(Exit.isFailure(commitFailed)).toBe(true);
    expect(await run(x.get)).toBe(0);
    expect(await run(derived.get)).toBe(0);
    await run(x.set(3));
    expect(await run(derived.get)).toBe(6);
  });

  it("restricts private transaction writes to the owning fiber while child reads see committed values", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 0 }));
    const result = await run(
      r
        .batch(
          Effect.gen(function* () {
            yield* x.set(2);
            const reader = yield* Effect.forkChild(x.get);
            expect(yield* Fiber.join(reader)).toBe(0);
            const writer = yield* Effect.forkChild(x.set(3));
            yield* Fiber.join(writer);
          }),
        )
        .pipe(Effect.exit),
    );
    expect(Exit.isFailure(result)).toBe(true);
    expect(await run(x.get)).toBe(0);
  });

  it("discards interrupted batches and handles owner disposal", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 0 }));
    const started = Deferred.makeUnsafe<void>();
    const fiber = await run(
      Effect.forkIn(
        r.batch(
          Effect.gen(function* () {
            yield* x.set(1);
            yield* Deferred.succeed(started, undefined);
            yield* Effect.never;
          }),
        ),
        r.scope,
      ),
    );
    await run(Deferred.await(started));
    await run(Fiber.interrupt(fiber));
    expect(await run(x.get)).toBe(0);
    await run(x.set(2));
    await r.close();
    expect(Exit.isFailure(await run(x.get.pipe(Effect.exit)))).toBe(true);
  });

  it("supports custom equality, net-zero batches, NaN, and undefined values", async () => {
    const r = await harness();
    const x = await run(r.signal<number | undefined>({ initial: 0 }));
    const observed = await collect(x);
    expect(await run(Queue.take(observed))).toBe(0);
    await run(r.batch(x.set(1).pipe(Effect.andThen(x.set(0)))));
    await run(x.set(undefined));
    expect(await run(x.get)).toBeUndefined();
    expect(await run(Queue.take(observed))).toBeUndefined();
    const source = await run(r.signal({ initial: 1 }));
    const equal = await run(
      r.derive({
        sources: { source },
        compute: ({ source }) => ({ parity: source % 2 }),
        equals: ({ previous: a, proposed: b }) => a.parity === b.parity,
      }),
    );
    const original = await run(equal.get);
    const downstream = await run(r.derive({ sources: { equal }, compute: ({ equal }) => equal }));
    await run(source.set(3));
    expect(await run(equal.get)).toBe(original);
    expect(await run(downstream.get)).toBe(original);
    const nan = await run(r.signal({ initial: NaN }));
    let calls = 0;
    await run(
      r.derive({
        sources: { nan },
        compute: () => {
          calls++;
          return 0;
        },
      }),
    );
    await run(nan.set(NaN));
    expect(calls).toBe(1);
  });

  it("serializes concurrent updates without lost increments", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 0 }));
    await run(
      Effect.forEach(Array.from({ length: 1000 }), () => x.update((n) => n + 1), {
        concurrency: "unbounded",
      }),
    );
    expect(await run(x.get)).toBe(1000);
  });

  it("installs observation queues before returning and retains every intervening commit", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 0 }));
    const stream = await run(x.changes);
    await run(x.set(1));
    await run(x.set(2));
    expect(await run(Stream.runCollect(stream.pipe(Stream.take(3))))).toEqual([0, 1, 2]);
  });

  it("evaluates allocation effects lazily and rejects them after disposal", async () => {
    const r = await harness();
    const signal = r.signal({ initial: 0 });
    const source = r.source<number>();
    const emptyFold = r.fold({
      events: mergeEvents<number>([]),
      initial: 0,
      reducer: ({ state: n }) => n,
    });
    const subscription = r.subscribeStream(Stream.never, () => Effect.void);
    await r.close();
    for (const work of [signal, source, emptyFold, subscription]) {
      expect(Exit.isFailure(await run(work.pipe(Effect.exit)))).toBe(true);
    }
    expect(r.owner.coordinator.signals.size).toBe(0);
  });

  it("rejects equality and caught staged derivation failures without publishing", async () => {
    const r = await harness();
    const x = await run(
      r.signal({
        initial: 0,
        equals: ({ previous: a, proposed: b }) => {
          expect(b).not.toBe(9);
          return Object.is(a, b);
        },
      }),
    );
    const y = await run(
      r.derive({
        sources: { x },
        compute: ({ x }) => {
          expect(x).not.toBe(8);
          return x * 2;
        },
      }),
    );
    const failed = await run(
      r
        .batch(
          Effect.gen(function* () {
            yield* x.set(8);
            yield* y.get.pipe(Effect.catch(() => Effect.void));
          }),
        )
        .pipe(Effect.exit),
    );
    expect(Exit.isFailure(failed)).toBe(true);
    expect(await run(x.get)).toBe(0);
    expect(Exit.isFailure(await run(x.set(9).pipe(Effect.exit)))).toBe(true);
    expect(await run(x.get)).toBe(0);
    await run(x.set(2));
    expect(await run(y.get)).toBe(4);
  });

  it("snapshots explicit dependencies so caller mutation cannot change the graph", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 1 }));
    const other = await run(r.signal({ initial: 10 }));
    const sources = { x };
    const all = await run(r.combine(sources));
    sources.x = other;
    await run(x.set(2));
    expect(await run(all.get)).toEqual({ x: 2 });
  });

  it("preserves multiple caught failures when rejecting the outer batch", async () => {
    const r = await harness();
    const result = await run(
      r
        .batch(
          Effect.gen(function* () {
            yield* r.batch(Effect.fail("first")).pipe(Effect.catch(() => Effect.void));
            yield* r.batch(Effect.fail("second")).pipe(Effect.catch(() => Effect.void));
          }),
        )
        .pipe(Effect.exit),
    );
    Exit.match(result, {
      onSuccess: () => expect.fail("Expected batch rejection"),
      onFailure: (cause) => {
        const error = Option.getOrThrow(Cause.findErrorOption(cause));
        const original = Match.value(error.cause).pipe(
          Match.when(Cause.isCause, (cause) => Cause.pretty(cause)),
          Match.orElse(() => ""),
        );
        expect(original).toContain("first");
        expect(original).toContain("second");
      },
    });
  });

  it("retains custom-equal identities during staged reads and ignores stale private caches on commit", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 1 }));
    const parity = await run(
      r.derive({
        sources: { x },
        compute: ({ x }) => ({ parity: x % 2 }),
        equals: ({ previous, proposed }) => previous.parity === proposed.parity,
      }),
    );
    const original = await run(parity.get);
    const doubled = await run(r.derive({ sources: { x }, compute: ({ x }) => x * 2 }));
    const child = await run(
      r.derive({ sources: { doubled }, compute: ({ doubled }) => doubled + 1 }),
    );
    const z = await run(r.signal({ initial: 0 }));
    const all = await run(r.combine({ child, z }));
    await run(
      r.batch(
        Effect.gen(function* () {
          yield* x.set(3);
          expect(yield* parity.get).toBe(original);
          yield* x.set(2);
          expect(yield* child.get).toBe(5);
          yield* x.set(1);
          yield* z.set(1);
        }),
      ),
    );
    expect(await run(all.get)).toEqual({ child: 3, z: 1 });
    expect(await run(parity.get)).toBe(original);
  });

  it("rejects an escaped child's stale transaction after the batch closes", async () => {
    const r = await harness();
    const x = await run(r.signal({ initial: 0 }));
    const release = Deferred.makeUnsafe<void>();
    const child = await run(
      r.batch(
        Effect.gen(function* () {
          yield* x.set(1);
          return yield* Effect.forkIn(
            Deferred.await(release).pipe(Effect.andThen(x.set(2))),
            r.scope,
          );
        }),
      ),
    );
    await run(Deferred.succeed(release, undefined));
    expect(Exit.isFailure(await run(Fiber.await(child)))).toBe(true);
    expect(await run(x.get)).toBe(1);
  });
});

describe("event sources", () => {
  it("folds one emission into multiple signals atomically and preserves all handler events", async () => {
    const r = await harness();
    const source = await run(r.source<number>());
    const a = await run(
      r.fold({ events: source.events, initial: 0, reducer: ({ state: n, event }) => n + event }),
    );
    const b = await run(
      r.fold({
        events: mapEvents(source.events, (n) => n * 2),
        initial: 0,
        reducer: ({ state: n, event }) => n + event,
      }),
    );
    const both = await run(r.combine({ a, b }));
    const snapshots = await collect(both);
    const handled = await run(Queue.unbounded<number>());
    await run(r.subscribe(source.events, (event) => Queue.offer(handled, event)));
    expect(await run(Queue.take(snapshots))).toEqual({ a: 0, b: 0 });
    await run(
      r.batch(source.emit(1).pipe(Effect.andThen(source.emit(2)), Effect.andThen(source.emit(0)))),
    );
    expect(await run(Queue.take(snapshots))).toEqual({ a: 3, b: 6 });
    expect(await run(Queue.take(handled))).toBe(1);
    expect(await run(Queue.take(handled))).toBe(2);
    expect(await run(Queue.take(handled))).toBe(0);
    await run(r.batch(source.emit(4).pipe(Effect.andThen(Effect.fail("no")))).pipe(Effect.exit));
    expect(await run(both.get)).toEqual({ a: 3, b: 6 });
    await run(source.emit(1));
    expect(await run(Queue.take(handled))).toBe(1);
  });

  it("recovers from failed reducers and sequential handler invocations", async () => {
    const r = await harness();
    const source = await run(r.source<number>());
    const count = await run(
      r.fold({
        events: source.events,
        initial: 0,
        reducer: ({ state, event }) => {
          expect(event).not.toBe(99);
          return state + event;
        },
      }),
    );
    const ready = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const finished = await run(Queue.unbounded<number>());
    await run(
      r.subscribe(source.events, (event) =>
        Effect.gen(function* () {
          yield* Effect.when(
            Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(release))),
            Effect.succeed(event === 1),
          );
          yield* Effect.when(Effect.fail("handler"), Effect.succeed(event === 2));
          yield* Queue.offer(finished, event);
        }),
      ),
    );
    await run(source.emit(99).pipe(Effect.exit));
    expect(await run(count.get)).toBe(0);
    await run(source.emit(1));
    await run(Deferred.await(ready));
    await run(source.emit(2));
    await run(source.emit(3));
    await run(Deferred.succeed(release, undefined));
    expect(await run(Queue.take(finished))).toBe(1);
    expect(await run(Queue.take(finished))).toBe(3);
    expect(r.failures).toHaveLength(1);
  });

  it("subscribes before returning and preserves dispatch order across merged buttons", async () => {
    const r = await harness();
    const increment = document.createElement("button");
    const reset = document.createElement("button");
    const a = await run(r.events(increment, "click"));
    const b = await run(r.events(reset, "click"));
    const count = await run(
      r.fold({
        events: mergeEvents([mapEvents(a, () => "increment"), mapEvents(b, () => "reset")]),
        initial: 0,
        reducer: ({ state: n, event }) =>
          Match.value(event).pipe(
            Match.when("reset", () => 0),
            Match.orElse(() => n + 1),
          ),
      }),
    );
    const observed = await collect(count);
    expect(await run(Queue.take(observed))).toBe(0);
    increment.click();
    increment.click();
    reset.click();
    increment.click();
    expect(await run(Queue.take(observed))).toBe(1);
    expect(await run(Queue.take(observed))).toBe(2);
    expect(await run(Queue.take(observed))).toBe(0);
    expect(await run(Queue.take(observed))).toBe(1);
    await r.close();
    increment.click();
    expect(r.failures).toEqual([]);
  });

  it("reports upstream failures and continues unrelated subscriptions", async () => {
    const r = await harness();
    const reported = Deferred.makeUnsafe<void>();
    const owner = {
      ...r.owner,
      lifetime: {
        ...r.owner.lifetime,
        report: () => Deferred.succeed(reported, undefined).pipe(Effect.asVoid),
      },
    };
    await run(reactive(owner).subscribeStream(Stream.fail("upstream"), () => Effect.void));
    await run(Deferred.await(reported));
    const source = await run(r.source<number>());
    const handled = Deferred.makeUnsafe<number>();
    await run(r.subscribe(source.events, (n) => Deferred.succeed(handled, n)));
    await run(source.emit(3));
    expect(await run(Deferred.await(handled))).toBe(3);
  });

  it("does not replay queued DOM occurrences to subscribers acquired after dispatch", async () => {
    const r = await harness();
    const button = document.createElement("button");
    const events = await run(r.events(button, "click"));
    const early = await run(r.fold({ events, initial: 0, reducer: ({ state: n }) => n + 1 }));
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const holding = run(
      r.batch(Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)))),
    );
    await run(Deferred.await(started));
    button.click();
    const late = await run(r.fold({ events, initial: 0, reducer: ({ state: n }) => n + 1 }));
    const observed = await collect(early);
    expect(await run(Queue.take(observed))).toBe(0);
    await run(Deferred.succeed(release, undefined));
    await holding;
    expect(await run(Queue.take(observed))).toBe(1);
    expect(await run(late.get)).toBe(0);
  });

  it("folds ordinary streams and keeps their completed state", async () => {
    const r = await harness();
    const fold = await run(
      r.foldStream({
        stream: Stream.make(1, 2, 3),
        initial: 0,
        reducer: ({ state: n, event }) => n + event,
      }),
    );
    const observed = await collect(fold);
    const final = await run(
      Stream.runCollect(Stream.fromQueue(observed).pipe(Stream.takeUntil((n) => n === 6))),
    );
    expect(final.at(-1)).toBe(6);
    expect(await run(fold.get)).toBe(6);
  });

  it("does not let a throwing reporter stall later handler events", async () => {
    const r = await harness();
    const owner = {
      ...r.owner,
      lifetime: { ...r.owner.lifetime, report: () => Effect.die("reporter") },
    };
    const api = reactive(owner);
    const source = await run(api.source<number>());
    const handled = Deferred.makeUnsafe<number>();
    await run(
      api.subscribe(source.events, (n) =>
        Match.value(n).pipe(
          Match.when(1, () => Effect.fail("handler")),
          Match.orElse(() => Deferred.succeed(handled, n)),
        ),
      ),
    );
    await run(source.emit(1));
    await run(source.emit(2));
    expect(await run(Deferred.await(handled))).toBe(2);
  });

  it("detaches managed handlers from their acquisition batch and supplies the owning scope", async () => {
    const r = await harness();
    const source = await run(r.source<number>());
    const x = await run(r.signal({ initial: 0 }));
    const handled = Deferred.makeUnsafe<void>();
    let cleaned = false;
    await run(
      r.batch(
        r.subscribe(source.events, (n) =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                cleaned = true;
              }),
            );
            yield* x.set(n);
            yield* Deferred.succeed(handled, undefined);
          }),
        ),
      ),
    );
    await run(source.emit(3));
    await run(Deferred.await(handled));
    expect(await run(x.get)).toBe(3);
    expect(r.failures).toEqual([]);
    await r.close();
    expect(cleaned).toBe(true);
  });
});
