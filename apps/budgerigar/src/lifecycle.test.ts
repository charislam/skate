import { Cause, Deferred, Effect, Exit, Match, Option, Queue, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { component, mounting, type Component, type MountFailure } from "./framework";
import { nativeNode } from "./output";
import { importTestNode, testText } from "./output-test-helpers";
import * as Sync from "./sync-public";
import { rendered } from "./test-helpers";

const run = Effect.runPromise;
const gates: Array<Deferred.Deferred<void>> = [];
const gate = () => {
  const deferred = Deferred.makeUnsafe<void>();
  gates.push(deferred);
  return deferred;
};
const open = (deferred: Deferred.Deferred<void>) => run(Deferred.succeed(deferred, undefined));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const deferred of gates.splice(0)) await open(deferred);
  for (const close of cleanups.splice(0)) await close();
});
const harness = async (onError: (failure: MountFailure) => void = () => {}) => {
  const scope = await run(Scope.make());
  const errors = await run(Queue.unbounded<MountFailure>());
  const app = await run(
    mounting({
      scope,
      onError: (failure) => {
        Queue.offerUnsafe(errors, failure);
        onError(failure);
      },
    }),
  );
  const parent = document.createElement("div");
  document.body.append(parent);
  const close = () => run(Scope.close(scope, Exit.void));
  cleanups.push(async () => {
    await close();
    parent.remove();
  });
  return { app, parent, close, errors };
};
const shows = (parent: Node, value: string) =>
  rendered({ parent, check: () => parent.textContent === value });
const text = (value: string) =>
  component(() => Sync.succeed({ setup: () => Effect.succeed(testText(value)) }));

describe("synchronous finalizers and setup fallbacks", () => {
  it("captures outgoing focus while attached and transfers it to surviving controls", async () => {
    const { app, parent } = await harness();
    const trigger = await run(app.he("button", { children: ["open"], props: { type: "button" } }));
    let synchronous = 0;
    const asyncCleaned = gate();
    const dialog = component(() =>
      Sync.succeed({
        setup: ({ he, signal, addSyncFinalizer }) =>
          Effect.gen(function* () {
            const local = yield* signal({ initial: "local" });
            const input = yield* he("input");
            yield* addSyncFinalizer(() => {
              synchronous += 1;
              expect(nativeNode(input).isConnected).toBe(true);
              expect(document.activeElement).toBe(nativeNode(input));
              expect(Exit.isFailure(Effect.runSync(local.get.pipe(Effect.exit)))).toBe(true);
              nativeNode(trigger).focus();
            });
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                expect(nativeNode(input).isConnected).toBe(false);
                expect(document.activeElement).toBe(nativeNode(trigger));
              }).pipe(Effect.andThen(Deferred.succeed(asyncCleaned, undefined))),
            );
            return input;
          }),
      }),
    );
    const selected = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(dialog) }),
    );
    Effect.runSync(app.h(parent, [trigger, selected]));
    await rendered({ parent, check: () => parent.querySelector("input") !== null });
    parent.querySelector("input")?.focus();
    await run(selected.set(Option.none()));
    expect(synchronous).toBe(1);
    expect(parent.querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(nativeNode(trigger));
    await run(Deferred.await(asyncCleaned));
  });

  it("runs descendants and last-registered synchronous finalizers first before detaching any outgoing DOM", async () => {
    const { app, parent, close } = await harness();
    const order: string[] = [];
    const child = component(() =>
      Sync.succeed({
        setup: ({ he, addSyncFinalizer }) =>
          Effect.gen(function* () {
            yield* addSyncFinalizer(() => {
              expect(parent.textContent).toBe("child");
              order.push("child-first");
            });
            yield* addSyncFinalizer(() => {
              expect(parent.textContent).toBe("child");
              order.push("child-last");
            });
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                expect(parent.textContent).toBe("");
                order.push("child-async");
              }),
            );
            return yield* he("span", { children: ["child"] });
          }),
      }),
    );
    const owner = component(() =>
      Sync.succeed({
        setup: ({ he, addSyncFinalizer }) =>
          Effect.gen(function* () {
            yield* addSyncFinalizer(() => {
              expect(parent.textContent).toBe("child");
              order.push("owner-sync");
            });
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                expect(parent.textContent).toBe("");
                order.push("owner-async");
              }),
            );
            return yield* he("div", { children: [child] });
          }),
      }),
    );
    await run(
      app.addSyncFinalizer(() => {
        expect(parent.textContent).toBe("child");
        order.push("root-sync");
      }),
    );
    await run(
      Scope.addFinalizer(
        app.scope,
        Effect.sync(() => {
          order.push("root-async");
        }),
      ),
    );
    Effect.runSync(app.h(parent, owner));
    await shows(parent, "child");
    const closing = close();
    expect(parent.childNodes.length).toBe(0);
    expect(order.slice(0, 4)).toEqual(["child-last", "child-first", "owner-sync", "root-sync"]);
    await closing;
    expect(order).toEqual([
      "child-last",
      "child-first",
      "owner-sync",
      "root-sync",
      "child-async",
      "owner-async",
      "root-async",
    ]);
    await close();
    expect(order.length).toBe(7);
    expect(Exit.isFailure(await run(app.addSyncFinalizer(() => {}).pipe(Effect.exit)))).toBe(true);
  });

  it("atomically flushes ordinary DOM and the fallback while old cleanup and new setup are pending", async () => {
    const { app, parent } = await harness();
    const cleaning = gate();
    const releaseCleanup = gate();
    const setupStarted = gate();
    const releaseSetup = gate();
    const observed = gate();
    const old = component(() =>
      Sync.succeed({
        setup: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Deferred.succeed(cleaning, undefined).pipe(
                Effect.andThen(Deferred.await(releaseCleanup)),
              ),
            );
            return testText("outgoing");
          }),
      }),
    );
    let factories = 0;
    const incoming = component(() =>
      Sync.succeed({
        fallback: () => {
          factories += 1;
          return Sync.succeed(testText("pending"));
        },
        setup: () =>
          Deferred.succeed(setupStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseSetup)),
            Effect.as(testText("ready")),
          ),
      }),
    );
    const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.some(old) }));
    const label = await run(app.signal({ initial: "old" }));
    Effect.runSync(app.h(parent, await run(app.he("div", { children: [label, selected] }))));
    await shows(parent, "oldoutgoing");
    await run(
      app.subscribeStream(await run(selected.changes), (value) =>
        Match.value(Option.exists(value, (value) => value === incoming)).pipe(
          Match.when(true, () =>
            Effect.sync(() => {
              expect(parent.textContent).toBe("newpending");
            }).pipe(Effect.andThen(Deferred.succeed(observed, undefined))),
          ),
          Match.when(false, () => Effect.void),
          Match.exhaustive,
        ),
      ),
    );
    await run(
      app.batch(label.set("new").pipe(Effect.andThen(selected.set(Option.some(incoming))))),
    );
    expect(parent.textContent).toBe("newpending");
    expect(factories).toBe(1);
    await run(Deferred.await(cleaning));
    await run(Deferred.await(setupStarted));
    await run(Deferred.await(observed));
    const pending = parent.querySelector("div")?.lastChild?.previousSibling;
    await run(selected.set(Option.some(incoming)));
    expect(factories).toBe(1);
    expect(parent.querySelector("div")?.lastChild?.previousSibling).toBe(pending);
    await open(releaseSetup);
    await shows(parent, "newready");
    await open(releaseCleanup);
    expect(parent.textContent).toBe("newready");
  });

  it("shows empty pending content immediately when no fallback is provided", async () => {
    const { app, parent } = await harness();
    const release = gate();
    const started = gate();
    const incoming = component(() =>
      Sync.succeed({
        setup: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.as(testText("ready")),
          ),
      }),
    );
    const selected = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(text("outgoing")) }),
    );
    Effect.runSync(app.h(parent, selected));
    await shows(parent, "outgoing");
    await run(selected.set(Option.some(incoming)));
    expect(parent.textContent).toBe("");
    await run(Deferred.await(started));
    await open(release);
    await shows(parent, "ready");
  });

  it("uses fresh multiple-root fallbacks for independent occurrences and replaces them with empty output", async () => {
    const { app, parent } = await harness();
    const release = gate();
    let factories = 0;
    let setups = 0;
    const branch = component(() =>
      Sync.succeed({
        fallback: () => {
          factories += 1;
          return Sync.succeed([testText("one"), testText("two")]);
        },
        setup: () =>
          Effect.sync(() => {
            setups += 1;
          }).pipe(Effect.andThen(Deferred.await(release)), Effect.as([])),
      }),
    );
    const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
    Effect.runSync(app.h(parent, [selected, selected]));
    await rendered({ parent, check: () => parent.childNodes.length === 4 });
    await run(selected.set(Option.some(branch)));
    expect(parent.textContent).toBe("onetwoonetwo");
    expect(factories).toBe(2);
    await open(release);
    await shows(parent, "");
    expect(setups).toBe(2);
  });

  it("coalesces superseded setup and cannot let its output or cleanup remove a newer fallback", async () => {
    const { app, parent } = await harness();
    const firstStarted = gate();
    const firstRelease = gate();
    const cleaning = gate();
    const releaseCleanup = gate();
    let intermediateStarts = 0;
    const first = component(() =>
      Sync.succeed({
        fallback: () => Sync.succeed(testText("first pending")),
        setup: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Deferred.succeed(cleaning, undefined).pipe(
                Effect.andThen(Deferred.await(releaseCleanup)),
              ),
            );
            yield* Deferred.succeed(firstStarted, undefined);
            yield* Deferred.await(firstRelease).pipe(Effect.uninterruptible);
            return testText("obsolete");
          }),
      }),
    );
    const middle = component(() =>
      Sync.succeed({
        fallback: () => Sync.succeed(testText("middle pending")),
        setup: () =>
          Effect.sync(() => {
            intermediateStarts += 1;
            return testText("middle");
          }),
      }),
    );
    const finalRelease = gate();
    const latest = component(() =>
      Sync.succeed({
        fallback: () => Sync.succeed(testText("latest pending")),
        setup: () => Deferred.await(finalRelease).pipe(Effect.as(testText("latest"))),
      }),
    );
    const selected = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(first) }),
    );
    Effect.runSync(app.h(parent, selected));
    await run(Deferred.await(firstStarted));
    await run(
      Effect.gen(function* () {
        yield* selected.set(Option.some(middle));
        yield* selected.set(Option.some(latest));
      }),
    );
    expect(parent.textContent).toBe("latest pending");
    await open(firstRelease);
    await run(Deferred.await(cleaning));
    expect(parent.textContent).toBe("latest pending");
    expect(intermediateStarts).toBe(0);
    await open(releaseCleanup);
    await open(finalRelease);
    await shows(parent, "latest");
  });

  it("isolates synchronous finalizer and reporter exceptions and continues the transition exactly once", async () => {
    const { app, parent, close, errors } = await harness(() => {
      throw new Error("reporter");
    });
    const order: string[] = [];
    const release = gate();
    const old = component(() =>
      Sync.succeed({
        setup: ({ addSyncFinalizer }) =>
          Effect.gen(function* () {
            yield* addSyncFinalizer(() => {
              order.push("first");
            });
            yield* addSyncFinalizer(() => {
              order.push("throw");
              throw new Error("synchronous cleanup");
            });
            yield* Effect.addFinalizer(() => Deferred.await(release));
            return testText("old");
          }),
      }),
    );
    const next = component(() =>
      Sync.succeed({
        fallback: () => Sync.succeed(testText("pending")),
        setup: () => Effect.never,
      }),
    );
    const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.some(old) }));
    Effect.runSync(app.h(parent, selected));
    await shows(parent, "old");
    await run(selected.set(Option.some(next)));
    expect(parent.textContent).toBe("pending");
    expect(order).toEqual(["throw", "first"]);
    const failure = await run(Queue.take(errors));
    expect(failure.operation).toBe("cleanup");
    expect(Cause.pretty(failure.cause)).toContain("synchronous cleanup");
    const closing = close();
    expect(parent.textContent).toBe("");
    await open(release);
    await closing;
    expect(order).toEqual(["throw", "first"]);
  });

  it("reports fallback failures, continues setup, and preserves the occurrence until definitions change", async () => {
    const { app, parent, errors } = await harness();
    const release = gate();
    let factories = 0;
    let setups = 0;
    const broken = component(() =>
      Sync.succeed({
        fallback: () => {
          factories += 1;
          throw new Error("fallback failed");
        },
        setup: () =>
          Effect.gen(function* () {
            setups += 1;
            yield* Deferred.await(release);
            return testText("ready");
          }),
      }),
    );
    const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
    Effect.runSync(app.h(parent, [testText("sibling"), selected]));
    await shows(parent, "sibling");
    await run(selected.set(Option.some(broken)));
    const failure = await run(Queue.take(errors));
    expect(failure.operation).toBe("fallback");
    expect(Cause.pretty(failure.cause)).toContain("fallback failed");
    expect(parent.textContent).toBe("sibling");
    await open(release);
    await shows(parent, "siblingready");
    expect(setups).toBe(1);
    await run(selected.set(Option.some(broken)));
    expect(factories).toBe(1);
    expect(setups).toBe(1);
    expect(parent.textContent).toBe("siblingready");
    await run(selected.set(Option.some(text("recovered"))));
    await shows(parent, "siblingrecovered");
    await run(selected.set(Option.some(broken)));
    await run(Queue.take(errors));
    await shows(parent, "siblingready");
    expect(factories).toBe(2);
    expect(setups).toBe(2);
  });

  it("reports both fallback and setup failures and recovers after changing definitions", async () => {
    const { app, parent, errors } = await harness();
    const broken = component(() =>
      Sync.succeed({
        fallback: () => {
          throw new Error("fallback failed");
        },
        setup: () => Effect.fail("setup failed"),
      }),
    );
    const selected = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(broken) }),
    );
    Effect.runSync(app.h(parent, [testText("sibling"), selected]));
    const fallbackFailure = await run(Queue.take(errors));
    const setupFailure = await run(Queue.take(errors));
    expect(fallbackFailure.operation).toBe("fallback");
    expect(Cause.pretty(fallbackFailure.cause)).toContain("fallback failed");
    expect(setupFailure.operation).toBe("setup");
    expect(Cause.pretty(setupFailure.cause)).toContain("setup failed");
    expect(parent.textContent).toBe("sibling");
    await run(selected.set(Option.some(text("recovered"))));
    await shows(parent, "siblingrecovered");
  });

  it("validates fallback roots as a group and rejects reused or connected native nodes", async () => {
    const { app, parent, errors } = await harness();
    const node = document.createElement("span");
    node.textContent = "pending";
    const output = await run(importTestNode(node));
    const branch = component(() =>
      Sync.succeed({ fallback: () => Sync.succeed(output), setup: () => Effect.never }),
    );
    const selected = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(branch) }),
    );
    Effect.runSync(app.h(parent, [testText("sibling"), selected]));
    await shows(parent, "siblingpending");
    await run(selected.set(Option.none()));
    await run(selected.set(Option.some(branch)));
    await run(Queue.take(errors));
    expect(parent.textContent).toBe("sibling");
    const duplicate = testText("duplicate");
    await run(
      selected.set(
        Option.some(
          component(() =>
            Sync.succeed({
              fallback: () => Sync.succeed([duplicate, duplicate]),
              setup: () => Effect.never,
            }),
          ),
        ),
      ),
    );
    expect((await run(Queue.take(errors))).operation).toBe("fallback");
    expect(nativeNode(duplicate).parentNode).toBeNull();
    const connected = testText("connected");
    parent.append(nativeNode(connected));
    await run(
      selected.set(
        Option.some(
          component(() =>
            Sync.succeed({
              fallback: () => Sync.succeed(connected),
              setup: () => Effect.never,
            }),
          ),
        ),
      ),
    );
    await run(Queue.take(errors));
    expect(nativeNode(connected).parentNode).toBe(parent);
  });

  it("removes fallback immediately on setup failure while failure cleanup remains pending", async () => {
    const { app, parent, errors } = await harness();
    const cleanup = gate();
    const release = gate();
    const broken = component(() =>
      Sync.succeed({
        fallback: () => Sync.succeed(testText("pending")),
        setup: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Deferred.succeed(cleanup, undefined).pipe(Effect.andThen(Deferred.await(release))),
            );
            return yield* Effect.fail("setup failed");
          }),
      }),
    );
    const selected = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(broken) }),
    );
    Effect.runSync(app.h(parent, selected));
    await run(Queue.take(errors));
    await run(Deferred.await(cleanup));
    expect(parent.textContent).toBe("");
    await run(selected.set(Option.some(text("recovered"))));
    await shows(parent, "recovered");
    await open(release);
    expect(parent.textContent).toBe("recovered");
  });

  it("aborted batches and invalid candidates never call fallback factories or synchronous finalizers", async () => {
    const { app, parent } = await harness();
    let finalizers = 0;
    let factories = 0;
    const old = component(() =>
      Sync.succeed({
        setup: ({ addSyncFinalizer }) =>
          addSyncFinalizer(() => {
            finalizers += 1;
          }).pipe(Effect.as(testText("old"))),
      }),
    );
    const next = component(() =>
      Sync.succeed({
        fallback: () => {
          factories += 1;
          return Sync.succeed(testText("pending"));
        },
        setup: () => Effect.never,
      }),
    );
    const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.some(old) }));
    Effect.runSync(app.h(parent, selected));
    await shows(parent, "old");
    await run(
      app
        .batch(selected.set(Option.some(next)).pipe(Effect.andThen(Effect.fail("abort"))))
        .pipe(Effect.exit),
    );
    await run(
      app.batch(
        Effect.gen(function* () {
          yield* selected.set(Option.some(next));
          yield* selected.set(Option.some(old));
        }),
      ),
    );
    // @ts-expect-error Runtime candidate validation rejects an invalid payload before DOM lifecycle work.
    expect(Exit.isFailure(await run(selected.set(Option.some(false)).pipe(Effect.exit)))).toBe(
      true,
    );
    expect(finalizers).toBe(0);
    expect(factories).toBe(0);
    expect(parent.textContent).toBe("old");
  });

  it("awaits every retired cleanup on shutdown and prevents fallback/setup from repopulating the target", async () => {
    const { app, parent, close } = await harness();
    const release = gate();
    const cleanings = await run(Queue.unbounded<number>());
    let finalizers = 0;
    const make = (index: number) =>
      component(() =>
        Sync.succeed({
          fallback: () => Sync.succeed(testText(`pending${index}`)),
          setup: () =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Queue.offer(cleanings, index).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(
                    Effect.sync(() => {
                      finalizers += 1;
                    }),
                  ),
                ),
              );
              return testText(`ready${index}`);
            }),
        }),
      );
    const selected = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(make(0)) }),
    );
    Effect.runSync(app.h(parent, selected));
    await shows(parent, "ready0");
    for (let index = 1; index < 4; index += 1) {
      await run(selected.set(Option.some(make(index))));
      await shows(parent, `ready${index}`);
    }
    for (let index = 0; index < 3; index += 1) await run(Queue.take(cleanings));
    const closing = close();
    await run(Queue.take(cleanings));
    expect(parent.childNodes.length).toBe(0);
    expect(finalizers).toBe(0);
    expect(Exit.isFailure(await run(selected.get.pipe(Effect.exit)))).toBe(true);
    await open(release);
    await closing;
    expect(finalizers).toBe(4);
    await close();
    expect(finalizers).toBe(4);
  });

  it("rejects reentrant signal commits from synchronous finalizers without corrupting the outer batch", async () => {
    const { app, parent } = await harness();
    const label = await run(app.signal({ initial: "old" }));
    let reentrant = false;
    const old = component(() =>
      Sync.succeed({
        setup: ({ addSyncFinalizer }) =>
          addSyncFinalizer(() => {
            reentrant = Exit.isFailure(Effect.runSync(label.set("reentrant").pipe(Effect.exit)));
          }).pipe(Effect.as(testText("outgoing"))),
      }),
    );
    const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.some(old) }));
    Effect.runSync(app.h(parent, await run(app.he("div", { children: [label, selected] }))));
    await shows(parent, "oldoutgoing");
    await run(app.batch(label.set("new").pipe(Effect.andThen(selected.set(Option.none())))));
    expect(reentrant).toBe(true);
    expect(await run(label.get)).toBe("new");
    expect(parent.textContent).toBe("new");
    await run(label.set("after"));
    expect(parent.textContent).toBe("after");
  });
});
