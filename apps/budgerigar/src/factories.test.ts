import { Cause, Deferred, Effect, Exit, Option, Queue, Result, Scope, Stream } from "effect";
import { afterEach, expect, it } from "vitest";
import {
  component,
  mounting,
  type Component,
  type MountFailure,
  type Signal,
  type SynchronousContext,
  type WritableSignal,
} from "./framework";
import { rendered } from "./test-helpers";

const run = Effect.runPromise;

const gates: Array<Deferred.Deferred<void>> = [];
const closers: Array<() => Promise<void>> = [];
const gate = () => {
  const value = Deferred.makeUnsafe<void>();
  gates.push(value);
  return value;
};

const open = (value: Deferred.Deferred<void>) => run(Deferred.succeed(value, undefined));
const text = (value: string) => document.createTextNode(value);

const shows = (parent: Node, value: string) =>
  rendered({ parent, check: () => parent.textContent === value });

const fixture = async () => {
  const scope = await run(Scope.make());
  const errors = await run(Queue.unbounded<MountFailure>());
  const app = await run(
    mounting({
      scope,
      onError: (failure) => {
        Queue.offerUnsafe(errors, failure);
      },
    }),
  );
  const parent = document.createElement("div");
  const close = () => run(Scope.close(scope, Exit.void));
  closers.push(close);
  return { app, parent, close, failure: () => run(Queue.take(errors)) };
};

afterEach(async () => {
  for (const value of gates.splice(0)) await open(value);
  for (const close of closers.splice(0)) await close();
});

it("invokes inert descriptions once per occurrence and keeps independent factory state", async () => {
  const { app, parent } = await fixture();
  let calls = 0;
  const signals: WritableSignal<string>[] = [];
  const definition = component(({ signal }) =>
    Result.gen(function* () {
      calls += 1;
      const label = yield* signal({ initial: String(calls) });
      signals.push(label);
      return { fallback: ({ he }) => he("p", { children: [label] }), setup: () => Effect.never };
    }),
  );
  const detached = await run(app.he("section", { children: [definition, definition] }));
  expect(calls).toBe(0);
  app.h(parent, detached);
  await shows(parent, "12");
  expect(calls).toBe(2);
  await run(Effect.forEach(signals.slice(0, 1), (signal) => signal.set("first")));
  expect(parent.textContent).toBe("first2");
});

it("binds committed parent and shared progress values without rerunning callbacks", async () => {
  const { app, parent } = await fixture();
  const label = await run(app.signal({ initial: "old" }));
  const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
  app.h(parent, [selected, text("sibling")]);
  await shows(parent, "sibling");
  const release = gate();
  let factories = 0;
  let fallbacks = 0;
  let setups = 0;
  const definition = component(({ signal }) =>
    Result.gen(function* () {
      factories += 1;
      const progress = yield* signal({ initial: "loading" });
      return {
        fallback: ({ he }) => {
          fallbacks += 1;
          return he("p", { children: [label, progress] });
        },
        setup: ({ he }) =>
          Effect.gen(function* () {
            setups += 1;
            yield* progress.set("preparing");
            yield* Deferred.await(release);
            return yield* he("article", { children: [label] });
          }),
      };
    }),
  );
  await run(
    app.batch(
      Effect.gen(function* () {
        yield* selected.set(Option.some(definition));
        yield* label.set("new");
      }),
    ),
  );
  expect(parent.textContent).toBe("newloadingsibling");
  const pending = parent.querySelector("p");
  await shows(parent, "newpreparingsibling");
  await run(selected.set(Option.some(definition)));
  await run(label.set("changed"));
  expect(parent.querySelector("p")).toBe(pending);
  expect(parent.textContent).toBe("changedpreparingsibling");
  expect([factories, fallbacks, setups]).toEqual([1, 1, 1]);
  await open(release);
  await shows(parent, "changedsibling");
});

it("activates mixed and direct fallback children synchronously and skips retired setup", async () => {
  const { app, parent } = await fixture();
  const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
  app.h(parent, [text("left"), selected, text("right")]);
  await shows(parent, "leftright");
  let childFactories = 0;
  let childSetups = 0;
  const child = component(() => {
    childFactories += 1;
    return Result.succeed({
      fallback: () => Result.succeed(text("child")),
      setup: () =>
        Effect.sync(() => {
          childSetups += 1;
          return text("ready child");
        }),
    });
  });
  const branch = component(({ signal }) =>
    Result.gen(function* () {
      const choice = yield* signal({ initial: Option.some(child) });
      return {
        fallback: () => Result.succeed([text("a"), child, choice, text("b")]),
        setup: () => Effect.never,
      };
    }),
  );
  await run(
    Effect.gen(function* () {
      yield* selected.set(Option.some(branch));
      expect(parent.textContent).toBe("leftachildchildbright");
      expect(childFactories).toBe(2);
      yield* selected.set(Option.none());
    }),
  );
  expect(parent.textContent).toBe("leftright");
  await run(Effect.yieldNow);
  expect(childSetups).toBe(0);
});

it("retires pending descendants before attached finalizers and awaits cleanup only at shutdown", async () => {
  const { app, parent, close } = await fixture();
  const ready = gate();
  const cleanupRelease = gate();
  const cleanupStarted = gate();
  const childStarted = gate();
  const order: string[] = [];
  let factoryFinalized = false;
  const child = component(({ addSyncFinalizer }) =>
    Result.gen(function* () {
      yield* addSyncFinalizer(() => {
        order.push(`child:${parent.textContent}`);
      });
      return {
        fallback: () => Result.succeed(text("child")),
        setup: () => Deferred.succeed(childStarted, undefined).pipe(Effect.andThen(Effect.never)),
      };
    }),
  );
  const branch = component(({ addSyncFinalizer }) =>
    Result.gen(function* () {
      yield* addSyncFinalizer(() => {
        factoryFinalized = true;
      });
      return {
        fallback: (ctx) =>
          Result.gen(function* () {
            yield* ctx.addSyncFinalizer(() => {
              order.push(`pending:${parent.textContent}`);
            });
            Effect.runSync(
              Scope.addFinalizer(
                ctx.scope,
                Deferred.succeed(cleanupStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(cleanupRelease)),
                ),
              ),
            );
            return child;
          }),
        setup: () => Deferred.await(ready).pipe(Effect.map(() => text("ready"))),
      };
    }),
  );
  app.h(parent, branch);
  await shows(parent, "child");
  await run(Deferred.await(childStarted));
  await open(ready);
  await shows(parent, "ready");
  expect(order).toEqual(["child:child", "pending:child"]);
  expect(factoryFinalized).toBe(false);
  await run(Deferred.await(cleanupStarted));
  let closed = false;
  const closing = close().then(() => {
    closed = true;
  });
  await run(Effect.yieldNow);
  expect(parent.textContent).toBe("");
  expect(factoryFinalized).toBe(true);
  expect(closed).toBe(false);
  await open(cleanupRelease);
  await closing;
  expect(order).toHaveLength(2);
});

it("keeps factory work alive through readiness and stops pending stream work", async () => {
  const { app, parent } = await fixture();
  const release = gate();
  const factoryWrite = gate();
  const pendingStarted = gate();
  const pendingStopped = gate();
  const definition = component(({ signal, fork }) =>
    Result.gen(function* () {
      const progress = yield* signal({ initial: "initial" });
      yield* fork(Deferred.await(factoryWrite).pipe(Effect.andThen(progress.set("updated"))));
      return {
        fallback: (ctx) =>
          Result.gen(function* () {
            yield* ctx.subscribeStream(
              Stream.fromEffect(
                Deferred.succeed(pendingStarted, undefined).pipe(Effect.andThen(Effect.never)),
              ).pipe(Stream.ensuring(Deferred.succeed(pendingStopped, undefined))),
              () => Effect.void,
            );
            return yield* ctx.he("p", { children: [progress] });
          }),
        setup: ({ he }) =>
          Deferred.await(release).pipe(Effect.andThen(he("article", { children: [progress] }))),
      };
    }),
  );
  app.h(parent, definition);
  await shows(parent, "initial");
  await run(Deferred.await(pendingStarted));
  await open(release);
  await rendered({ parent, check: () => parent.querySelector("article") !== null });
  await run(Deferred.await(pendingStopped));
  await open(factoryWrite);
  await shows(parent, "updated");
});

it("rejects escaped fallback state from setup while retaining ancestor access", async () => {
  const { app, parent, failure } = await fixture();
  const captured = Deferred.makeUnsafe<Signal<string>>();
  app.h(
    parent,
    component(() =>
      Result.succeed({
        fallback: (ctx) =>
          Result.gen(function* () {
            const signal = yield* ctx.signal({ initial: "pending" });
            Effect.runSync(Deferred.succeed(captured, signal));
            return yield* ctx.he("p", { children: [signal] });
          }),
        setup: ({ he }) =>
          Deferred.await(captured).pipe(
            Effect.flatMap((signal) => he("p", { children: [signal] })),
          ),
      }),
    ),
  );
  const error = await failure();
  expect(error.operation).toBe("setup");
  expect(Cause.pretty(error.cause)).toContain("unrelated component lifetime");
  expect(parent.textContent).toBe("");
});

it("cleans failed factory Results, preserves typed causes, and never calls later callbacks", async () => {
  const { app, parent, failure } = await fixture();
  let finalized = 0;
  let deferredWork = 0;
  let callbacks = 0;
  const definition = component((ctx) =>
    Result.gen(function* () {
      yield* ctx.addSyncFinalizer(() => {
        finalized += 1;
      });
      yield* ctx.fork(
        Effect.sync(() => {
          deferredWork += 1;
        }),
      );
      yield* Result.fail("factory failed");
      callbacks += 1;
      return { setup: () => Effect.succeed([]) };
    }),
  );
  app.h(parent, definition);
  const error = await failure();
  expect(error.operation).toBe("factory");
  expect(Cause.hasDies(error.cause)).toBe(false);
  expect(Cause.pretty(error.cause)).toContain("factory failed");
  await run(Effect.yieldNow);
  expect([finalized, deferredWork, callbacks]).toEqual([1, 0, 0]);
  expect(parent.textContent).toBe("");
});

it("cleans a failed fallback Result and continues enclosing setup", async () => {
  const { app, parent, failure } = await fixture();
  const release = gate();
  let pendingFinalized = 0;
  let factoryFinalized = 0;
  app.h(
    parent,
    component((ctx) =>
      Result.gen(function* () {
        yield* ctx.addSyncFinalizer(() => {
          factoryFinalized += 1;
        });
        return {
          fallback: (pending) =>
            Result.gen(function* () {
              yield* pending.addSyncFinalizer(() => {
                pendingFinalized += 1;
              });
              return yield* Result.fail("fallback failed");
            }),
          setup: () => Deferred.await(release).pipe(Effect.map(() => text("ready"))),
        };
      }),
    ),
  );
  expect((await failure()).operation).toBe("fallback");
  expect([pendingFinalized, factoryFinalized]).toEqual([1, 0]);
  await open(release);
  await shows(parent, "ready");
});

it("rejects reentrant writes and batches without invoking thunks and starts fork after commit", async () => {
  const { app, parent } = await fixture();
  const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
  const label = await run(app.signal({ initial: "initial" }));
  app.h(parent, selected);
  await run(Effect.yieldNow);
  let thunks = 0;
  const definition = component((ctx) =>
    Result.gen(function* () {
      expect(Exit.isFailure(Effect.runSyncExit(label.set("illegal")))).toBe(true);
      const batch = ctx.batch(() => {
        thunks += 1;
        return Result.succeed(undefined);
      });
      expect(Result.isFailure(batch)).toBe(true);
      yield* ctx.fork(label.set("deferred"));
      return { fallback: ({ he }) => he("p", { children: [label] }), setup: () => Effect.never };
    }),
  );
  await run(selected.set(Option.some(definition)));
  expect(parent.textContent).toBe("initial");
  expect(thunks).toBe(0);
  await shows(parent, "deferred");
});

it("aborts Result batches and keeps Effect helper execution lazy", async () => {
  const { app, parent } = await fixture();
  const ready = Deferred.makeUnsafe<SynchronousContext>();
  const label = await run(app.signal({ initial: "initial" }));
  app.h(
    parent,
    component((ctx) => {
      Effect.runSync(Deferred.succeed(ready, ctx));
      return Result.succeed({ setup: ({ he }) => he("p", { children: [label] }) });
    }),
  );
  const ctx = await run(Deferred.await(ready));
  await shows(parent, "initial");
  const aborted = ctx.batch(() =>
    Result.gen(function* () {
      Effect.runSync(label.set("staged"));
      return yield* Result.fail("abort");
    }),
  );
  expect(Result.isFailure(aborted)).toBe(true);
  expect(await run(label.get)).toBe("initial");
  expect(parent.textContent).toBe("initial");
  const committed = ctx.batch(() => {
    Effect.runSync(label.set("committed"));
    return Result.succeed(42);
  });
  expect(committed).toEqual(Result.succeed(42));
  expect(parent.textContent).toBe("committed");
  let calculations = 0;
  const lazy = app.derive({
    sources: { label },
    compute: ({ label }) => {
      calculations += 1;
      return label;
    },
  });
  expect(calculations).toBe(0);
  await run(lazy);
  expect(calculations).toBe(1);
});

it("supports direct components, selections, and empty arrays as setup output", async () => {
  const { app, parent } = await fixture();
  const child = component(() => Result.succeed({ setup: () => Effect.sync(() => text("child")) }));
  const selected = await run(app.signal({ initial: Option.some(child) }));
  app.h(
    parent,
    component(() =>
      Result.succeed({ setup: () => Effect.succeed([child, selected, text("end")]) }),
    ),
  );
  await shows(parent, "childchildend");
  app.h(
    parent,
    component(() => Result.succeed({ setup: () => Effect.succeed([]) })),
  );
  await shows(parent, "");
});

it.each([
  {
    name: "throw",
    factory: () => {
      throw new Error("factory defect");
    },
    defect: true,
  },
  { name: "bare lifecycle", factory: () => ({ setup: () => Effect.succeed([]) }), defect: false },
  {
    name: "Promise",
    factory: () => Promise.resolve({ setup: () => Effect.succeed([]) }),
    defect: false,
  },
  {
    name: "Effect",
    factory: () => Effect.succeed({ setup: () => Effect.succeed([]) }),
    defect: false,
  },
])("validates untyped factory $name and preserves cause semantics", async ({ factory, defect }) => {
  const { app, parent, failure } = await fixture();
  const invalid: Component = Reflect.apply(component, undefined, [factory]);
  app.h(parent, invalid);
  const error = await failure();
  expect(error.operation).toBe("factory");
  expect(Cause.hasDies(error.cause)).toBe(defect);
  expect(parent.textContent).toBe("");
});

it.each([
  () => text("bare"),
  () => Promise.resolve([]),
  () => Effect.succeed([]),
  () => Result.succeed([[text("nested")]]),
  () => {
    throw new Error("fallback defect");
  },
])("isolates invalid untyped fallback output and continues setup", async (fallback) => {
  const { app, parent, failure } = await fixture();
  const invalid: Component = Reflect.apply(component, undefined, [
    () => Result.succeed({ fallback, setup: () => Effect.sync(() => text("ready")) }),
  ]);
  app.h(parent, invalid);
  expect((await failure()).operation).toBe("fallback");
  await shows(parent, "ready");
});

it("reports throwing pending finalizers while inserting ready content and blocking reentrant writes", async () => {
  const { app, parent, failure } = await fixture();
  const release = gate();
  const label = await run(app.signal({ initial: "initial" }));
  let attached = false;
  app.h(
    parent,
    component(() =>
      Result.succeed({
        fallback: (ctx) =>
          Result.gen(function* () {
            yield* ctx.addSyncFinalizer(() => {
              attached = parent.textContent === "pending";
              expect(Exit.isFailure(Effect.runSyncExit(label.set("illegal")))).toBe(true);
              throw new Error("pending cleanup defect");
            });
            return text("pending");
          }),
        setup: () => Deferred.await(release).pipe(Effect.map(() => text("ready"))),
      }),
    ),
  );
  await shows(parent, "pending");
  await open(release);
  await shows(parent, "ready");
  expect(attached).toBe(true);
  expect(await run(label.get)).toBe("initial");
  expect((await failure()).operation).toBe("cleanup");
});

it("revokes late uninterruptible pending child adoption without delaying readiness", async () => {
  const { app, parent, close } = await fixture();
  const enclosing = gate();
  const childRelease = gate();
  const childStarted = gate();
  const childFinished = gate();
  let childFinalized = false;
  const child = component(() =>
    Result.succeed({
      fallback: () => Result.succeed(text("child pending")),
      setup: () =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              childFinalized = true;
            }),
          );
          yield* Deferred.succeed(childStarted, undefined);
          yield* Deferred.await(childRelease).pipe(Effect.uninterruptible);
          yield* Deferred.succeed(childFinished, undefined);
          return text("obsolete child");
        }).pipe(Effect.uninterruptible),
    }),
  );
  app.h(
    parent,
    component(() =>
      Result.succeed({
        fallback: () => Result.succeed(child),
        setup: () => Deferred.await(enclosing).pipe(Effect.map(() => text("ready"))),
      }),
    ),
  );
  await run(Deferred.await(childStarted));
  await open(enclosing);
  await shows(parent, "ready");
  expect(childFinalized).toBe(false);
  await open(childRelease);
  await run(Deferred.await(childFinished));
  await run(Effect.yieldNow);
  expect(parent.textContent).toBe("ready");
  await close();
  expect(childFinalized).toBe(true);
});

it("never invokes factories for failed batches, invalid requests, or transient selections", async () => {
  const { app, parent, failure } = await fixture();
  let factories = 0;
  const definition = component(() => {
    factories += 1;
    return Result.succeed({ setup: () => Effect.succeed([]) });
  });
  const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
  app.h(parent, [selected, text("sibling")]);
  await shows(parent, "sibling");
  await run(
    app.batch(
      Effect.gen(function* () {
        yield* selected.set(Option.some(definition));
        yield* selected.set(Option.none());
      }),
    ),
  );
  await run(
    app
      .batch(selected.set(Option.some(definition)).pipe(Effect.andThen(Effect.fail("abort"))))
      .pipe(Effect.result),
  );
  const duplicate = text("duplicate");
  app.h(parent, [definition, duplicate, duplicate]);
  expect((await failure()).operation).toBe("validation");
  expect(factories).toBe(0);
  expect(parent.textContent).toBe("sibling");
});

it("owns synchronous event folds, input bindings, subscriptions, and queued mounts in pending view", async () => {
  const { app, parent } = await fixture();
  const release = gate();
  const handled = gate();
  const pendingSignals: WritableSignal<string>[] = [];
  let handlers = 0;
  app.h(
    parent,
    component(() =>
      Result.succeed({
        fallback: (ctx) =>
          Result.gen(function* () {
            const value = yield* ctx.signal({ initial: "initial" });
            pendingSignals.push(value);
            expect(yield* ctx.read(value)).toBe("initial");
            const source = yield* ctx.source<string>();
            const folded = yield* ctx.fold({
              events: source.events,
              initial: "fold",
              reducer: ({ event }) => event,
            });
            const combined = yield* ctx.combine({ value, folded });
            const label = yield* ctx.derive({
              sources: { combined },
              compute: ({ combined }) => `${combined.value}:${combined.folded}`,
            });
            const input = yield* ctx.he("input");
            yield* ctx.bindValue({ element: input, signal: value });
            const button = yield* ctx.he("button", { children: ["emit"] });
            yield* ctx.subscribe(yield* ctx.events(button, "click"), () => source.emit("event"));
            yield* ctx.subscribeStream(yield* ctx.toStream(source.events), () =>
              Effect.sync(() => {
                handlers += 1;
              }).pipe(Effect.andThen(Deferred.succeed(handled, undefined))),
            );
            const streamFold = yield* ctx.foldStream({
              stream: Stream.make("stream"),
              initial: "waiting",
              reducer: ({ event }) => event,
            });
            const target = yield* ctx.he("aside");
            yield* ctx.h(target, text("queued"));
            expect(target.textContent).toBe("");
            return yield* ctx.he("section", {
              children: [input, button, label, streamFold, target],
            });
          }),
        setup: () => Deferred.await(release).pipe(Effect.map(() => text("ready"))),
      }),
    ),
  );
  await shows(parent, "emitinitial:foldstreamqueued");
  const button = parent.querySelector("button");
  const input = parent.querySelector("input");
  button?.click();
  await run(Deferred.await(handled));
  expect(parent.textContent).toBe("emitinitial:eventstreamqueued");
  input?.dispatchEvent(new InputEvent("input"));
  await open(release);
  await shows(parent, "ready");
  button?.click();
  await run(Effect.yieldNow);
  expect(handlers).toBe(1);
  for (const signal of pendingSignals) {
    expect(Exit.isFailure(await run(Effect.exit(signal.set("retired"))))).toBe(true);
  }
  expect(parent.textContent).toBe("ready");
});
