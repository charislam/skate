import {
  Cause,
  Clock,
  DateTime,
  Deferred,
  Effect,
  Equal,
  Hash,
  Layer,
  Exit,
  Fiber,
  Match,
  Option,
  Queue,
  Ref,
  Schedule,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, it } from "vitest";
import { component, mounting, Query, QueryState, Resource, Sync, type Signal } from "./framework";
import { snapshot } from "./query/key";

const run = Effect.runPromise;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
const harness = async (
  policy: { staleTime?: number; gcTime?: number; retry?: Query.Retry<unknown> } = {},
) => {
  const scope = await run(Scope.make());
  const failures: unknown[] = [];
  const clock = await run(TestClock.make().pipe(Scope.provide(scope)));
  const app = await run(
    mounting({ scope, onError: (e) => failures.push(e) }).pipe(
      Effect.provideService(Clock.Clock, clock),
    ),
  );
  const partition = await run(
    app.signal<Option.Option<{ session: string }>>({ initial: Option.some({ session: "one" }) }),
  );
  const client = await run(Query.configure({ context: app, partition, ...policy }));
  const close = () => run(Scope.close(scope, Exit.void));
  cleanups.push(close);
  return { app, client, partition, close, failures, clock };
};
const controlled = () => {
  const requests = Effect.runSync(
    Queue.unbounded<{ input: { id: string }; result: Deferred.Deferred<string, string> }>(),
  );
  const query = Query.define({
    name: "controlled",
    load: (input: { id: string }) =>
      Effect.gen(function* () {
        const result = Deferred.makeUnsafe<string, string>();
        yield* Queue.offer(requests, { input, result });
        return yield* Deferred.await(result);
      }),
  });
  return { query, take: () => run(Queue.take(requests)), requests };
};
const states = async <A>(signal: Signal<A>) => {
  const queue = await run(Queue.unbounded<A>());
  const stream = await run(signal.changes);
  const fiber = Effect.runFork(Stream.runForEach(stream, (value) => Queue.offer(queue, value)));
  cleanups.push(() => run(Fiber.interrupt(fiber)).then(() => {}));
  return queue;
};
const nextSuccess = <I, A, E, T extends boolean>(
  queue: Queue.Queue<QueryState.QueryState<I, A, E, T>>,
) =>
  run(
    Stream.fromQueue(queue).pipe(
      Stream.filter(QueryState.isSuccess),
      Stream.take(1),
      Stream.runCollect,
    ),
  ).then((values) => values[0]);

describe("query structural keys", () => {
  it("uses Effect equality and hashing for records, ordered arrays, Options, and immutable snapshots", () => {
    const input = { b: [1, Option.some("x")], a: "hello" };
    const key = snapshot(input);
    expect(Equal.equals(key, snapshot({ a: "hello", b: [1, Option.some("x")] }))).toBe(true);
    expect(Hash.hash(key)).toBe(Hash.hash(snapshot({ a: "hello", b: [1, Option.some("x")] })));
    expect(Equal.equals(key, snapshot({ a: "hello", b: [Option.some("x"), 1] }))).toBe(false);
    input.b.push(2);
    expect(key.input.b).toHaveLength(2);
    expect(Object.isFrozen(key.input)).toBe(true);
    expect(Equal.equals(snapshot(Option.none()), snapshot({ _tag: "None" }))).toBe(false);
    expect(Equal.equals(snapshot(-0), snapshot(0))).toBe(true);
    expect(Equal.equals(snapshot(["a", "b"]), snapshot(["a:sb"]))).toBe(false);
  });
  it("rejects cycles, opaque objects, accessors, functions, and symbols", () => {
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    for (const value of [
      cycle,
      new Date(),
      () => {},
      Symbol(),
      {
        get id() {
          return "x";
        },
      },
    ])
      expect(() => snapshot(value)).toThrow(TypeError);
  });
});

describe("runtime query coordination", () => {
  it("deduplicates observation and imperative reads, sharing accepted results", async () => {
    const { app, client } = await harness();
    const c = controlled();
    const input = await run(app.signal({ initial: Option.some({ id: "A" }) }));
    const a = await run(Query.observe({ context: app, query: c.query, input }));
    const b = await run(Query.observe({ context: app, query: c.query, input }));
    const observed = await states(a.state);
    const read = run(client.get({ query: c.query, input: { id: "A" } }));
    const request = await c.take();
    expect(Queue.sizeUnsafe(c.requests)).toBe(0);
    await run(Deferred.succeed(request.result, "project A"));
    expect(await read).toBe("project A");
    expect((await nextSuccess(observed))?.value).toBe("project A");
    expect(await run(b.state.get)).toMatchObject({
      _tag: "Success",
      value: "project A",
      waiting: false,
    });
  });
  it("keeps retained provenance through A → B → C failure and return to A", async () => {
    const { app } = await harness({ staleTime: Infinity });
    const c = controlled();
    const input = await run(
      app.signal<Option.Option<{ id: string }>>({ initial: Option.some({ id: "A" }) }),
    );
    const handle = await run(
      Query.observe({ context: app, query: c.query, input, retainPrevious: true }),
    );
    const queue = await states(handle.state);
    await run(Deferred.succeed((await c.take()).result, "A data"));
    await nextSuccess(queue);
    await run(input.set(Option.some({ id: "B" })));
    await c.take();
    await run(input.set(Option.some({ id: "C" })));
    const request = await c.take();
    expect(await run(handle.state.get)).toMatchObject({
      _tag: "Initial",
      waiting: true,
      previousSuccess: Option.some({
        _tag: "PreviousKey",
        key: { id: "A" },
        previousData: "A data",
      }),
    });
    const failure = run(
      Stream.fromQueue(queue).pipe(
        Stream.filter(QueryState.isFailure),
        Stream.take(1),
        Stream.runCollect,
      ),
    );
    await run(Deferred.fail(request.result, "C failed"));
    expect((await failure)[0]).toMatchObject({
      _tag: "Failure",
      previousSuccess: Option.some({
        _tag: "PreviousKey",
        key: { id: "A" },
        previousData: "A data",
      }),
    });
    await run(input.set(Option.some({ id: "A" })));
    expect(await run(handle.state.get)).toMatchObject({ _tag: "Success", value: "A data" });
    await run(input.set(Option.none()));
    expect(await run(handle.state.get)).toMatchObject({
      _tag: "Initial",
      waiting: false,
      previousSuccess: Option.none(),
    });
  });
  it("strict refreshes supersede pending work and imperative waiters follow the replacement", async () => {
    const { app, client } = await harness();
    const c = controlled();
    const input = await run(app.signal({ initial: Option.some({ id: "A" }) }));
    const handle = await run(Query.observe({ context: app, query: c.query, input }));
    await c.take();
    const read = run(client.get({ query: c.query, input: { id: "A" } }));
    await run(
      app.batch(
        Effect.gen(function* () {
          yield* handle.refresh;
          yield* handle.refresh;
        }),
      ),
    );
    const latest = await c.take();
    await run(Deferred.succeed(latest.result, "replacement"));
    expect(await read).toBe("replacement");
    expect(await run(handle.state.get)).toMatchObject({ value: "replacement" });
  });
  it("partition retirement terminates old waiters and clears history in the commit", async () => {
    const { app, client, partition } = await harness();
    const c = controlled();
    const input = await run(app.signal({ initial: Option.some({ id: "A" }) }));
    const handle = await run(
      Query.observe({ context: app, query: c.query, input, retainPrevious: true }),
    );
    const old = run(client.get({ query: c.query, input: { id: "A" } }).pipe(Effect.exit));
    await c.take();
    await run(partition.set(Option.none()));
    expect(await run(handle.state.get)).toMatchObject({
      _tag: "Initial",
      waiting: false,
      previousSuccess: Option.none(),
    });
    expect(await old).toMatchObject({
      _tag: "Failure",
      cause: Cause.fail(new Query.PartitionChanged()),
    });
    expect(
      await run(client.get({ query: c.query, input: { id: "A" } }).pipe(Effect.exit)),
    ).toMatchObject({ _tag: "Failure" });
    await run(partition.set(Option.some({ session: "one" })));
    const fresh = await c.take();
    expect(await run(handle.state.get)).toMatchObject({
      _tag: "Initial",
      waiting: true,
      previousSuccess: Option.none(),
    });
    await run(Deferred.succeed(fresh.result, "new session"));
  });
  it("failure after refresh retains same-key success and preserves timestamps while waiting", async () => {
    const { app } = await harness();
    const c = controlled();
    const input = await run(app.signal({ initial: Option.some({ id: "A" }) }));
    const handle = await run(Query.observe({ context: app, query: c.query, input }));
    const queue = await states(handle.state);
    await run(Deferred.succeed((await c.take()).result, "data"));
    const success = await nextSuccess(queue);
    await run(handle.refresh);
    const refresh = await c.take();
    expect(await run(handle.state.get)).toMatchObject({
      _tag: "Success",
      waiting: true,
      timestamp: success?.timestamp,
    });
    const failure = run(
      Stream.fromQueue(queue).pipe(
        Stream.filter(QueryState.isFailure),
        Stream.take(1),
        Stream.runCollect,
      ),
    );
    await run(Deferred.fail(refresh.result, "nope"));
    await failure;
    expect(await run(handle.state.get)).toMatchObject({
      _tag: "Failure",
      waiting: false,
      previousSuccess: Option.some({ _tag: "SameKey", previousData: "data" }),
    });
  });
  it("retries typed failures with a fresh driver and reports defects once", async () => {
    const { client, failures } = await harness();
    let calls = 0;
    const query = Query.define({
      name: "retry",
      load: () =>
        Effect.suspend(() => {
          calls += 1;
          return Match.value(calls % 3).pipe(
            Match.when(0, () => Effect.succeed("ok")),
            Match.orElse(() => Effect.fail("retry")),
          );
        }),
      retry: Query.retry(Schedule.recurs(2)),
    });
    expect(await run(client.get({ query, input: undefined }))).toBe("ok");
    expect(await run(client.refresh({ query, input: undefined }))).toBe("ok");
    expect(calls).toBe(6);
    const defect = Query.define({ name: "defect", load: () => Effect.die("broken") });
    expect(
      await run(client.get({ query: defect, input: undefined }).pipe(Effect.exit)),
    ).toMatchObject({ _tag: "Failure" });
    expect(failures).toHaveLength(1);
  });
});

describe("query policies and runtime isolation", () => {
  it("uses consumer-specific freshness, shares revalidation, and never polls", async () => {
    const { app, client, clock } = await harness({ staleTime: Infinity });
    const c = controlled();
    const first = run(client.get({ query: c.query, input: { id: "A" } }));
    await run(Deferred.succeed((await c.take()).result, "old"));
    await first;
    await run(clock.adjust("30 seconds"));
    const input = await run(app.signal({ initial: Option.some({ id: "A" }) }));
    const tolerant = await run(
      Query.observe({ context: app, query: c.query, input, staleTime: "5 minutes" }),
    );
    expect(Queue.sizeUnsafe(c.requests)).toBe(0);
    const strict = await run(
      Query.observe({ context: app, query: c.query, input, staleTime: "10 seconds" }),
    );
    const request = await c.take();
    expect(await run(tolerant.state.get)).toMatchObject({
      _tag: "Success",
      value: "old",
      waiting: true,
    });
    expect(await run(strict.state.get)).toMatchObject({ _tag: "Success", waiting: true });
    const joined = run(client.get({ query: c.query, input: { id: "A" } }));
    await run(Deferred.succeed(request.result, "new"));
    await joined;
    expect(await run(tolerant.state.get)).toMatchObject({
      timestamp: DateTime.makeUnsafe(30_000),
      value: "new",
    });
    await run(clock.adjust("10 minutes"));
    expect(Queue.sizeUnsafe(c.requests)).toBe(0);
    expect(await run(client.get({ query: c.query, input: { id: "A" } }))).toBe("new");
  });
  it("idle GC runs from detachment, completion does not extend it, and zero GC reclassifies retained data", async () => {
    const { app, client, clock } = await harness({ gcTime: 1000, staleTime: Infinity });
    const c = controlled();
    const input = await run(
      app.signal<Option.Option<{ id: string }>>({ initial: Option.some({ id: "A" }) }),
    );
    const handle = await run(Query.observe({ context: app, query: c.query, input }));
    await c.take();
    await run(input.set(Option.none()));
    await run(clock.adjust("1 second"));
    const read = run(client.get({ query: c.query, input: { id: "A" } }));
    const request = await c.take();
    await run(Deferred.succeed(request.result, "fresh"));
    await read;
    await run(clock.adjust("1 second"));
    const again = run(client.get({ query: c.query, input: { id: "A" } }));
    const replacement = await c.take();
    await run(Deferred.succeed(replacement.result, "collected"));
    expect(await again).toBe("collected");
    expect(await run(handle.state.get)).toMatchObject({ _tag: "Initial", waiting: false });
    const zero = Query.define({ name: "zero", load: c.query.load, gcTime: 0, staleTime: Infinity });
    await run(input.set(Option.some({ id: "A" })));
    const retained = await run(
      Query.observe({ context: app, query: zero, input, retainPrevious: true }),
    );
    const queue = await states(retained.state);
    await run(Deferred.succeed((await c.take()).result, "A"));
    await nextSuccess(queue);
    await run(input.set(Option.some({ id: "B" })));
    await c.take();
    await run(input.set(Option.some({ id: "A" })));
    await c.take();
    expect(await run(retained.state.get)).toMatchObject({
      _tag: "Initial",
      waiting: true,
      previousSuccess: Option.some({ _tag: "SameKey", previousData: "A" }),
    });
  });
  it("exact and family invalidation override infinite freshness and isolate other definitions", async () => {
    const { client } = await harness({ staleTime: Infinity });
    let calls = 0;
    const query = Query.define({
      name: "same name",
      load: (id: string) => Effect.sync(() => `${id}:${++calls}`),
    });
    const other = Query.define({ name: "same name", load: query.load });
    expect(await run(client.get({ query, input: "A" }))).toBe("A:1");
    expect(await run(client.get({ query, input: "B" }))).toBe("B:2");
    expect(await run(client.get({ query: other, input: "A" }))).toBe("A:3");
    await run(client.invalidate({ query, input: "A" }));
    expect(await run(client.get({ query, input: "A" }))).toBe("A:4");
    expect(await run(client.get({ query, input: "B" }))).toBe("B:2");
    await run(client.invalidateDefinition({ query }));
    expect(await run(client.get({ query, input: "B" }))).toBe("B:5");
    expect(await run(client.get({ query: other, input: "A" }))).toBe("A:3");
  });
  it("cancellation releases only the caller, and shutdown settles pending waiters", async () => {
    const { app, client, close } = await harness();
    const c = controlled();
    const input = await run(app.signal({ initial: Option.some({ id: "A" }) }));
    const handle = await run(Query.observe({ context: app, query: c.query, input }));
    const canceled = Effect.runFork(client.get({ query: c.query, input: { id: "A" } }));
    const waiting = run(client.get({ query: c.query, input: { id: "A" } }));
    const request = await c.take();
    await run(Fiber.interrupt(canceled));
    await run(Deferred.succeed(request.result, "shared"));
    expect(await waiting).toBe("shared");
    const pending = run(client.refresh({ query: c.query, input: { id: "A" } }).pipe(Effect.exit));
    await c.take();
    await close();
    expect(await pending).toMatchObject({
      _tag: "Failure",
      cause: Cause.fail(new Query.Disposed()),
    });
    expect(await run(handle.refresh.pipe(Effect.exit))).toMatchObject({ _tag: "Failure" });
  });
});

it("uncooperative old generations cannot publish success or failure after replacement", async () => {
  const { app, client } = await harness({ staleTime: Infinity });
  const attempts = await run(Queue.unbounded<Deferred.Deferred<string, string>>());
  const finished = await run(Queue.unbounded<void>());
  const query = Query.define({
    name: "uncooperative",
    load: (_id: string) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const result = Deferred.makeUnsafe<string, string>();
          yield* Queue.offer(attempts, result);
          return yield* Deferred.await(result).pipe(
            Effect.ensuring(Queue.offer(finished, undefined)),
          );
        }),
      ),
  });
  const input = await run(app.signal({ initial: Option.some("A") }));
  const handle = await run(Query.observe({ context: app, query, input }));
  const old = await run(Queue.take(attempts));
  const latest = run(client.refresh({ query, input: "A" }));
  const replacement = await run(Queue.take(attempts));
  await run(Deferred.succeed(replacement, "new"));
  expect(await latest).toBe("new");
  await run(Queue.take(finished));
  await run(Deferred.succeed(old, "obsolete"));
  await run(Queue.take(finished));
  expect(await run(client.get({ query, input: "A" }))).toBe("new");
  const staleFailure = run(client.refresh({ query, input: "A" }));
  const failed = await run(Queue.take(attempts));
  const newer = run(client.refresh({ query, input: "A" }));
  const newest = await run(Queue.take(attempts));
  await run(Deferred.succeed(newest, "newest"));
  expect(await newer).toBe("newest");
  expect(await staleFailure).toBe("newest");
  await run(Queue.take(finished));
  await run(Deferred.fail(failed, "obsolete failure"));
  await run(Queue.take(finished));
  expect(await run(handle.state.get)).toMatchObject({
    _tag: "Success",
    value: "newest",
    waiting: false,
  });
});

it("partition resets every observer atomically and equal identities preserve work", async () => {
  const { app, client, partition } = await harness({ staleTime: Infinity });
  let calls = 0;
  const query = Query.define({
    name: "partition",
    load: (id: string) => Effect.sync(() => `${id}:${++calls}`),
  });
  const input = await run(app.signal({ initial: Option.some("A") }));
  const one = await run(Query.observe({ context: app, query, input, retainPrevious: true }));
  const two = await run(Query.observe({ context: app, query, input, retainPrevious: true }));
  await run(client.get({ query, input: "A" }));
  const snapshots: unknown[] = [];
  const combined = await run(app.combine({ one: one.state, two: two.state }));
  await run(app.watchSync({ signal: combined, onChange: (value) => snapshots.push(value) }));
  await run(partition.set(Option.some({ session: "one" })));
  expect(calls).toBe(1);
  await run(partition.set(Option.some({ session: "two" })));
  expect(snapshots.at(-1)).toMatchObject({
    one: { _tag: "Initial", previousSuccess: Option.none() },
    two: { _tag: "Initial", previousSuccess: Option.none() },
  });
  expect(await run(client.get({ query, input: "A" }))).toBe("A:2");
  await run(partition.set(Option.some({ session: "one" })));
  expect(await run(client.get({ query, input: "A" }))).toBe("A:3");
});

it("runtime loaders ignore local overrides and isolated mounting graphs never share entries", async () => {
  class Value extends Resource.Service<Value, string>()("query/runtime/Value") {}
  const query = Query.define({ name: "resources", load: () => Value });
  const create = async (value: string) => {
    const scope = await run(Scope.make());
    cleanups.push(() => run(Scope.close(scope, Exit.void)));
    const app = await run(
      mounting({ scope, onError: () => {}, resources: Layer.succeed(Value, value) }),
    );
    const partition = await run(app.signal({ initial: Option.some("same partition") }));
    const client = await run(Query.configure({ context: app, partition, staleTime: Infinity }));
    return client;
  };
  const first = await create("first");
  const second = await create("second");
  expect(
    await run(
      first.get({ query, input: undefined }).pipe(Effect.provideService(Value, "local override")),
    ),
  ).toBe("first");
  expect(await run(second.get({ query, input: undefined }))).toBe("second");
});

it("QueryState maps data and history while preserving keys, causes, waiting, and UTC timestamps", () => {
  const timestamp = DateTime.makeUnsafe(1234);
  const success = QueryState.success(10, { timestamp, waiting: true });
  expect(QueryState.map(success, String)).toMatchObject({ value: "10", timestamp, waiting: true });
  const key = { id: "A" };
  const history = QueryState.PreviousSuccess.PreviousKey({ key, previousData: 10 });
  const failure = QueryState.failure(Cause.fail("failed"), {
    waiting: true,
    previousSuccess: Option.some(history),
  });
  const mapped = QueryState.map(failure, String);
  expect(mapped).toMatchObject({
    cause: failure.cause,
    waiting: true,
    previousSuccess: Option.some({ _tag: "PreviousKey", previousData: "10", key }),
  });
  expect(
    Option.getOrThrow(
      QueryState.match(mapped, {
        onInitial: (s) => s.previousSuccess,
        onFailure: (s) => s.previousSuccess,
        onSuccess: () => Option.none(),
      }),
    )._tag,
  ).toBe("PreviousKey");
});

it("GC invalidates entry identity even when an old request ignores interruption", async () => {
  const { app, client, clock } = await harness({ gcTime: 1000, staleTime: Infinity });
  const attempts = await run(Queue.unbounded<Deferred.Deferred<string>>());
  const finished = await run(Queue.unbounded<void>());
  const query = Query.define({
    name: "GC race",
    load: (_id: string) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const result = Deferred.makeUnsafe<string>();
          yield* Queue.offer(attempts, result);
          return yield* Deferred.await(result).pipe(
            Effect.ensuring(Queue.offer(finished, undefined)),
          );
        }),
      ),
  });
  const input = await run(app.signal<Option.Option<string>>({ initial: Option.some("A") }));
  await run(Query.observe({ context: app, query, input }));
  const old = await run(Queue.take(attempts));
  await run(input.set(Option.none()));
  await run(clock.adjust("1 second"));
  const read = run(client.get({ query, input: "A" }));
  const replacement = await run(Queue.take(attempts));
  await run(Deferred.succeed(replacement, "live"));
  expect(await read).toBe("live");
  await run(Queue.take(finished));
  await run(Deferred.succeed(old, "removed entry"));
  await run(Queue.take(finished));
  expect(await run(client.get({ query, input: "A" }))).toBe("live");
});

it("each retry releases attempt resources, and unexpected interruption settles waiting", async () => {
  const { app, client } = await harness();
  const events: string[] = [];
  let attempts = 0;
  const query = Query.define({
    name: "attempt scopes",
    retry: Query.retry(Schedule.recurs(1)),
    load: () =>
      Effect.gen(function* () {
        const index = ++attempts;
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            events.push(`acquire ${index}`);
          }),
          () =>
            Effect.sync(() => {
              events.push(`release ${index}`);
            }),
        );
        return yield* Match.value(index).pipe(
          Match.when(1, () => Effect.fail("retry")),
          Match.orElse(() => Effect.succeed("ok")),
        );
      }),
  });
  expect(await run(client.get({ query, input: undefined }))).toBe("ok");
  expect(events).toEqual(["acquire 1", "release 1", "acquire 2", "release 2"]);
  const interrupted = Query.define({
    name: "unexpected interruption",
    load: () => Effect.interrupt,
  });
  const input = await run(app.signal({ initial: Option.some(undefined) }));
  const handle = await run(Query.observe({ context: app, query: interrupted, input }));
  const result = await run(client.get({ query: interrupted, input: undefined }).pipe(Effect.exit));
  expect(Exit.isFailure(result)).toBe(true);
  expect(await run(handle.state.get)).toMatchObject({ _tag: "Failure", waiting: false });
});

it("configuration rejects missing setup, foreign partition signals, and reconfiguration", async () => {
  const scope = await run(Scope.make());
  cleanups.push(() => run(Scope.close(scope, Exit.void)));
  const app = await run(mounting({ scope, onError: () => {} }));
  const input = await run(app.signal({ initial: Option.some("A") }));
  const query = Query.define({ name: "setup", load: (id: string) => Effect.succeed(id) });
  expect(await run(Query.observe({ context: app, query, input }).pipe(Effect.exit))).toMatchObject({
    _tag: "Failure",
  });
  const other = await harness();
  expect(
    await run(Query.configure({ context: app, partition: other.partition }).pipe(Effect.exit)),
  ).toMatchObject({ _tag: "Failure" });
  await run(Query.configure({ context: app, partition: input }));
  expect(
    await run(Query.configure({ context: app, partition: input }).pipe(Effect.exit)),
  ).toMatchObject({ _tag: "Failure" });
});

it("an input change into a stale shared key marks every observer waiting in one commit", async () => {
  const { app, clock } = await harness({ staleTime: Infinity });
  const c = controlled();
  const tolerantInput = await run(app.signal({ initial: Option.some({ id: "A" }) }));
  const strictInput = await run(
    app.signal<Option.Option<{ id: string }>>({ initial: Option.none() }),
  );
  const tolerant = await run(
    Query.observe({ context: app, query: c.query, input: tolerantInput, staleTime: Infinity }),
  );
  const strict = await run(
    Query.observe({ context: app, query: c.query, input: strictInput, staleTime: "10 seconds" }),
  );
  const queue = await states(tolerant.state);
  await run(Deferred.succeed((await c.take()).result, "old"));
  await nextSuccess(queue);
  await run(clock.adjust("30 seconds"));
  const combined = await run(app.combine({ tolerant: tolerant.state, strict: strict.state }));
  const snapshots: Array<{ tolerant: boolean; strict: boolean }> = [];
  await run(
    app.watchSync({
      signal: combined,
      onChange: ({ tolerant, strict }) =>
        snapshots.push({ tolerant: tolerant.waiting, strict: strict.waiting }),
    }),
  );
  await run(strictInput.set(Option.some({ id: "A" })));
  expect(snapshots.at(-1)).toEqual({ tolerant: true, strict: true });
  await c.take();
});

it("definition retry replacement and disablement override the global schedule", async () => {
  const { client } = await harness({ retry: Query.retry(Schedule.recurs(4)) });
  const counts = await run(Ref.make<Record<string, number>>({}));
  const load = (id: string) =>
    Effect.gen(function* () {
      const attempt = yield* Ref.modify(counts, (counts) => {
        const next = (counts[id] ?? 0) + 1;
        return [next, { ...counts, [id]: next }];
      });
      return yield* Match.value(attempt >= 3).pipe(
        Match.when(true, () => Effect.succeed("ok")),
        Match.orElse(() => Effect.fail("retry")),
      );
    });
  const inherited = Query.define({ name: "inherit", load });
  const replaced = Query.define({ name: "replace", load, retry: Query.retry(Schedule.recurs(1)) });
  const disabled = Query.define({ name: "disable", load, retry: Query.disabled() });
  expect(await run(client.get({ query: inherited, input: "inherited" }))).toBe("ok");
  expect(
    await run(client.get({ query: replaced, input: "replaced" }).pipe(Effect.exit)),
  ).toMatchObject({ _tag: "Failure" });
  expect(
    await run(client.get({ query: disabled, input: "disabled" }).pipe(Effect.exit)),
  ).toMatchObject({ _tag: "Failure" });
  expect(await run(Ref.get(counts))).toEqual({ inherited: 3, replaced: 2, disabled: 1 });
});

it("a final equal input in a batch avoids intermediate attachments and zero-GC swaps preserve consumers", async () => {
  const { app, client } = await harness({ gcTime: 0, staleTime: Infinity });
  let calls = 0;
  const query = Query.define({
    name: "swaps",
    load: (id: string) =>
      Effect.sync(() => {
        calls += 1;
        return id;
      }),
  });
  const first = await run(app.signal({ initial: Option.some("A") }));
  const second = await run(app.signal({ initial: Option.some("B") }));
  const a = await run(Query.observe({ context: app, query, input: first }));
  const b = await run(Query.observe({ context: app, query, input: second }));
  await run(client.get({ query, input: "A" }));
  await run(client.get({ query, input: "B" }));
  await run(
    app.batch(
      Effect.gen(function* () {
        yield* first.set(Option.some("C"));
        yield* first.set(Option.some("A"));
      }),
    ),
  );
  expect(calls).toBe(2);
  await run(
    app.batch(
      Effect.gen(function* () {
        yield* first.set(Option.some("B"));
        yield* second.set(Option.some("A"));
      }),
    ),
  );
  expect(await run(a.state.get)).toMatchObject({ _tag: "Success", value: "B", waiting: false });
  expect(await run(b.state.get)).toMatchObject({ _tag: "Success", value: "A", waiting: false });
  expect(await run(client.get({ query, input: "A" }))).toBe("A");
  expect(calls).toBe(2);
});

it("disposing one component observer preserves another observer's shared request", async () => {
  const { app } = await harness();
  const c = controlled();
  const input = await run(app.signal({ initial: Option.some({ id: "A" }) }));
  const ready = await run(Queue.unbounded<Query.Handle<{ id: string }, string, string>>());
  const disposed = await run(Queue.unbounded<void>());
  const panel = component(() =>
    Sync.succeed({
      setup: (ui) =>
        Effect.gen(function* () {
          const handle = yield* Query.observe({ context: ui, query: c.query, input });
          yield* ui.addSyncFinalizer(() => {
            Queue.offerUnsafe(disposed, undefined);
          });
          yield* Queue.offer(ready, handle);
          return [];
        }),
    }),
  );
  const first = document.createElement("div");
  const second = document.createElement("div");
  await run(app.h(first, panel));
  const retired = await run(Queue.take(ready));
  await run(app.h(second, panel));
  const live = await run(Queue.take(ready));
  const queue = await states(live.state);
  const request = await c.take();
  await run(app.h(first, []));
  await run(Queue.take(disposed));
  expect(await run(retired.refresh.pipe(Effect.exit))).toMatchObject({ _tag: "Failure" });
  await run(Deferred.succeed(request.result, "still shared"));
  expect((await nextSuccess(queue))?.value).toBe("still shared");
});

it("partition replacement starts new work while old cleanup is blocked", async () => {
  const { app, client, partition } = await harness();
  const requests = await run(Queue.unbounded<Deferred.Deferred<string>>());
  const cleanupStarted = Deferred.makeUnsafe<void>();
  const releaseCleanup = Deferred.makeUnsafe<void>();
  const counter = await run(Ref.make(0));
  const query = Query.define({
    name: "detached cleanup",
    load: (_id: string) =>
      Effect.gen(function* () {
        const index = yield* Ref.updateAndGet(counter, (n) => n + 1);
        yield* Effect.acquireRelease(Effect.void, () =>
          Match.value(index).pipe(
            Match.when(1, () =>
              Deferred.succeed(cleanupStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseCleanup)),
              ),
            ),
            Match.orElse(() => Effect.void),
          ),
        );
        const result = Deferred.makeUnsafe<string>();
        yield* Queue.offer(requests, result);
        return yield* Deferred.await(result);
      }),
  });
  const input = await run(app.signal({ initial: Option.some("A") }));
  await run(Query.observe({ context: app, query, input }));
  await run(Queue.take(requests));
  await run(partition.set(Option.some({ session: "replacement" })));
  await run(Deferred.await(cleanupStarted));
  const newRequest = await run(Queue.take(requests));
  const accepted = run(client.get({ query, input: "A" }));
  await run(Deferred.succeed(newRequest, "new partition"));
  expect(await accepted).toBe("new partition");
  await run(Deferred.succeed(releaseCleanup, undefined));
});

it("runtime shutdown awaits query cleanup before releasing mounting resources", async () => {
  class RuntimeResource extends Resource.Service<RuntimeResource, string>()(
    "query/runtime/cleanup",
  ) {}
  const cleanupStarted = Deferred.makeUnsafe<void>();
  const releaseCleanup = Deferred.makeUnsafe<void>();
  const started = Deferred.makeUnsafe<void>();
  let resourceReleased = false;
  const scope = await run(Scope.make());
  cleanups.push(() => run(Scope.close(scope, Exit.void)));
  const app = await run(
    mounting({
      scope,
      onError: () => {},
      resources: Layer.effect(
        RuntimeResource,
        Effect.acquireRelease(Effect.succeed("resource"), () =>
          Effect.sync(() => {
            resourceReleased = true;
          }),
        ),
      ),
    }),
  );
  const partition = await run(app.signal({ initial: Option.some("session") }));
  await run(Query.configure({ context: app, partition }));
  const query = Query.define({
    name: "cleanup",
    load: () =>
      Effect.gen(function* () {
        yield* RuntimeResource;
        yield* Effect.acquireRelease(Effect.void, () =>
          Deferred.succeed(cleanupStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseCleanup)),
          ),
        );
        yield* Deferred.succeed(started, undefined);
        return yield* Effect.never;
      }),
  });
  const input = await run(app.signal({ initial: Option.some(undefined) }));
  await run(Query.observe({ context: app, query, input }));
  await run(Deferred.await(started));
  const closing = run(Scope.close(scope, Exit.void));
  await run(Deferred.await(cleanupStarted));
  expect(resourceReleased).toBe(false);
  await run(Deferred.succeed(releaseCleanup, undefined));
  await closing;
  expect(resourceReleased).toBe(true);
});
