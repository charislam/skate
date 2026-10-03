import { Cause, Deferred, Effect, Exit, Match, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap } from "./bootstrap";
import { component, mounting, type MountFailure } from "./framework";
import { Home } from "./home";

const run = Effect.runPromise;

const gate = () => Deferred.makeUnsafe<void>();
const open = (deferred: Deferred.Deferred<void>) => run(Deferred.succeed(deferred, undefined));

const text = (value: string) => document.createTextNode(value);
const simple = (value: string) => component({ setup: () => Effect.sync(() => text(value)) });

const cleanups: Array<() => Promise<void>> = [];

const harness = async () => {
  const scope = await run(Scope.make());
  const errors: MountFailure[] = [];
  const h = await run(
    mounting({
      scope,
      onError: (failure) => {
        errors.push(failure);
      },
    }),
  );
  const close = () => run(Scope.close(scope, Exit.void));
  cleanups.push(close);
  return { h, errors, close };
};

// Observe actual insertion rather than guessing how many scheduler turns mounting takes.
const rendered = (parent: Element, value: string): Promise<void> =>
  new Promise((resolve) => {
    const observer = new MutationObserver(check);
    function check() {
      Match.value(parent.textContent === value).pipe(
        Match.when(true, () => {
          observer.disconnect();
          resolve();
        }),
        Match.when(false, () => {}),
        Match.exhaustive,
      );
    }
    observer.observe(parent, { childList: true, subtree: true });
    check();
  });

afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

describe("scoped component mounting", () => {
  it("creates independent welcome nodes and supports ordered and empty roots", async () => {
    const { h, close } = await harness();
    const left = document.createElement("div");
    const right = document.createElement("div");
    h(left, Home);
    h(right, Home);
    await Promise.all([
      rendered(left, "BudgerigarWelcome home."),
      rendered(right, "BudgerigarWelcome home."),
    ]);
    expect(left.firstChild).not.toBe(right.firstChild);
    expect(left.querySelector("main > h1")?.textContent).toBe("Budgerigar");
    h(left, component({ setup: () => Effect.sync(() => [text("a"), text("b")]) }));
    await rendered(left, "ab");
    expect(left.childNodes.length).toBe(2);
    const emptyStarted = gate();
    h(
      left,
      component({ setup: () => Deferred.succeed(emptyStarted, undefined).pipe(Effect.as([])) }),
    );
    await run(Deferred.await(emptyStarted));
    await rendered(left, "");
    await close();
    expect(right.childNodes.length).toBe(0);
  });

  it("awaits cleanup with old DOM attached, clears all children, and mounts every request", async () => {
    const { h } = await harness();

    const parent = document.createElement("div");
    parent.append(text("pre-existing"));

    const cleaning = gate();
    const releaseCleanup = gate();
    const settingUp = gate();
    const releaseSetup = gate();

    const events: string[] = [];

    h(
      parent,
      component({
        setup: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                events.push(`cleanup:${parent.textContent}`);
                yield* Deferred.succeed(cleaning, undefined);
                yield* Deferred.await(releaseCleanup);
              }),
            );
            return text("old");
          }),
      }),
    );

    await rendered(parent, "old");

    parent.append(text("external"));

    h(
      parent,
      component({
        setup: () =>
          Effect.gen(function* () {
            events.push(`setup:${parent.textContent}`);
            yield* Deferred.succeed(settingUp, undefined);
            yield* Deferred.await(releaseSetup);
            return text("middle");
          }),
      }),
    );

    h(
      parent,
      component({
        setup: () =>
          Effect.sync(() => {
            events.push("last");
            return text("last");
          }),
      }),
    );

    await run(Deferred.await(cleaning));
    expect(parent.textContent).toBe("oldexternal");
    expect(events).toEqual(["cleanup:oldexternal"]);

    await open(releaseCleanup);
    await run(Deferred.await(settingUp));
    expect(parent.textContent).toBe("");
    expect(events).toEqual(["cleanup:oldexternal", "setup:"]);

    await open(releaseSetup);
    await rendered(parent, "last");
    expect(events).toEqual(["cleanup:oldexternal", "setup:", "last"]);
  });

  it("lets another parent's queue progress during slow setup", async () => {
    const { h } = await harness();
    const slow = document.createElement("div");
    const fast = document.createElement("div");

    const ready = gate();
    const release = gate();

    h(
      slow,
      component({
        setup: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(ready, undefined);
            yield* Deferred.await(release);
            return text("slow");
          }),
      }),
    );

    await run(Deferred.await(ready));

    h(fast, simple("fast"));
    await rendered(fast, "fast");
    expect(slow.childNodes.length).toBe(0);

    await open(release);
    await rendered(slow, "slow");
  });

  it("cleans detached descendant mounts before an interrupted owner's finalizer", async () => {
    const { h, close, errors } = await harness();

    const parent = document.createElement("div");
    const child = document.createElement("section");

    const childReady = gate();
    const parentReady = gate();

    const events: string[] = [];

    h(
      parent,
      component({
        setup: ({ h: nested }) =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                events.push("parent");
              }),
            );
            nested(
              child,
              component({
                setup: () =>
                  Effect.gen(function* () {
                    yield* Effect.addFinalizer(() =>
                      Effect.sync(() => {
                        events.push("child");
                      }),
                    );
                    yield* Deferred.succeed(childReady, undefined);
                    return text("child");
                  }),
              }),
            );
            yield* Deferred.succeed(parentReady, undefined);
            return yield* Effect.never;
          }),
      }),
    );

    await run(Deferred.await(parentReady));
    await run(Deferred.await(childReady));

    await rendered(child, "child");
    await close();

    expect(events).toEqual(["child", "parent"]);
    expect(child.childNodes.length).toBe(0);
    expect(parent.childNodes.length).toBe(0);
    expect(errors).toEqual([]);
  });

  it("keeps enclosing DOM attached until asynchronous child and parent cleanup finish", async () => {
    const { h, close } = await harness();

    const parent = document.createElement("div");
    const child = document.createElement("section");

    const childCleaning = gate();
    const releaseChild = gate();
    const parentCleaning = gate();
    const releaseParent = gate();

    h(
      parent,
      component({
        setup: ({ h: nested }) =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                yield* Deferred.succeed(parentCleaning, undefined);
                yield* Deferred.await(releaseParent);
              }),
            );
            nested(
              child,
              component({
                setup: () =>
                  Effect.gen(function* () {
                    yield* Effect.addFinalizer(() =>
                      Effect.gen(function* () {
                        yield* Deferred.succeed(childCleaning, undefined);
                        yield* Deferred.await(releaseChild);
                      }),
                    );
                    return text("child");
                  }),
              }),
            );
            return child;
          }),
      }),
    );

    await rendered(parent, "child");

    const closing = close();
    await run(Deferred.await(childCleaning));
    expect(parent.firstChild).toBe(child);
    expect(child.textContent).toBe("child");

    await open(releaseChild);
    await run(Deferred.await(parentCleaning));
    expect(parent.firstChild).toBe(child);
    expect(child.textContent).toBe("");

    await open(releaseParent);
    await closing;
    expect(parent.childNodes.length).toBe(0);
  });

  it("cleans failed setup and preserves both setup and cleanup causes before progressing", async () => {
    const { h, errors } = await harness();

    const parent = document.createElement("div");

    const events: string[] = [];
    const original = new Error("setup failed");

    h(
      parent,
      component({
        setup: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                events.push("remaining");
              }),
            );
            yield* Effect.addFinalizer(() => Effect.die("cleanup failed"));
            parent.append(text("partial"));
            return yield* Effect.fail(original);
          }),
      }),
    );

    h(parent, simple("recovered"));
    await rendered(parent, "recovered");

    expect(events).toEqual(["remaining"]);
    expect(errors.map((error) => error.operation)).toEqual(["cleanup", "setup"]);
    expect(Cause.pretty(errors.at(1)?.cause ?? Cause.empty)).toContain("setup failed");
    expect(Cause.pretty(errors.at(0)?.cause ?? Cause.empty)).toContain("cleanup failed");
  });

  it("discards pending work, interrupts setup and background work, and rejects late requests", async () => {
    const { h, close, errors } = await harness();

    const parent = document.createElement("div");
    const ready = gate();
    const backgroundReady = gate();
    const stopped = gate();
    const release = gate();

    let pendingRan = false;

    h(
      parent,
      component({
        setup: ({ fork }) =>
          Effect.gen(function* () {
            yield* fork(
              Deferred.succeed(backgroundReady, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(stopped, undefined)),
              ),
            );
            yield* Deferred.await(backgroundReady);
            yield* Deferred.succeed(ready, undefined);
            yield* Deferred.await(release);
            return text("late");
          }),
      }),
    );

    h(
      parent,
      component({
        setup: () =>
          Effect.sync(() => {
            pendingRan = true;
            return text("pending");
          }),
      }),
    );

    await run(Deferred.await(ready));
    await run(Deferred.await(backgroundReady));

    await close();
    await run(Deferred.await(stopped));
    await open(release);

    h(parent, simple("after disposal"));

    expect(parent.childNodes.length).toBe(0);
    expect(pendingRan).toBe(false);
    expect(errors).toEqual([]);
  });

  it("continues after throwing setup and error callbacks and reports all cleanup defects", async () => {
    const scope = await run(Scope.make());
    const errors: MountFailure[] = [];

    const h = await run(
      mounting({
        scope,
        onError: (error) => {
          errors.push(error);
          throw new Error("reporter");
        },
      }),
    );
    cleanups.push(() => run(Scope.close(scope, Exit.void)));

    const parent = document.createElement("div");

    h(
      parent,
      component({
        setup: () => {
          throw new Error("throwing setup");
        },
      }),
    );

    h(
      parent,
      component({
        setup: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Effect.die("first cleanup"));
            yield* Effect.addFinalizer(() => Effect.die("second cleanup"));
            return text("old");
          }),
      }),
    );

    await rendered(parent, "old");

    h(parent, simple("new"));
    await rendered(parent, "new");

    expect(errors.map((error) => error.operation)).toEqual(["setup", "cleanup"]);
    expect(Cause.pretty(errors.at(1)?.cause ?? Cause.empty)).toContain("first cleanup");
    expect(Cause.pretty(errors.at(1)?.cause ?? Cause.empty)).toContain("second cleanup");
  });

  it("does not transfer targets to another live owner", async () => {
    const first = await harness();
    const second = await harness();

    const parent = document.createElement("div");

    first.h(parent, simple("first"));
    await rendered(parent, "first");

    second.h(parent, simple("second"));
    await Effect.runPromise(Effect.yieldNow);

    expect(parent.textContent).toBe("first");
    expect(first.errors).toEqual([]);
    expect(second.errors.map((failure) => failure.operation)).toEqual(["ownership"]);

    await first.close();
    second.h(parent, simple("second"));
    await rendered(parent, "second");
  });

  it("does not start replacement setup when disposed during old cleanup", async () => {
    const { h, close, errors } = await harness();

    const parent = document.createElement("div");

    const cleaning = gate();
    const release = gate();
    let replacementRan = false;

    h(
      parent,
      component({
        setup: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                yield* Deferred.succeed(cleaning, undefined);
                yield* Deferred.await(release);
              }),
            );
            return text("old");
          }),
      }),
    );

    await rendered(parent, "old");

    h(
      parent,
      component({
        setup: () =>
          Effect.sync(() => {
            replacementRan = true;
            return text("replacement");
          }),
      }),
    );

    await run(Deferred.await(cleaning));
    const closing = close();

    expect(parent.textContent).toBe("old");

    await open(release);
    await closing;

    expect(replacementRan).toBe(false);
    expect(parent.textContent).toBe("");
    expect(errors).toEqual([]);
  });

  it("prevents late uninterruptible setup from inserting DOM and reports cleanup defects on disposal", async () => {
    const { h, close, errors } = await harness();

    const parent = document.createElement("div");

    const ready = gate();
    const release = gate();
    let finalized = 0;

    h(
      parent,
      component({
        setup: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                finalized += 1;
              }),
            );
            yield* Effect.addFinalizer(() => Effect.die("disposal cleanup"));
            yield* Deferred.succeed(ready, undefined);
            yield* Deferred.await(release).pipe(Effect.uninterruptible);
            return text("late");
          }).pipe(Effect.uninterruptible),
      }),
    );

    await run(Deferred.await(ready));

    const inserted: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) inserted.push(...record.addedNodes);
    });
    observer.observe(parent, { childList: true });

    const closing = close();
    await open(release);
    await closing;
    observer.disconnect();

    expect(inserted).toEqual([]);
    expect(parent.textContent).toBe("");
    expect(finalized).toBe(1);
    expect(errors.map((failure) => failure.operation)).toEqual(["cleanup"]);

    await close();
    expect(finalized).toBe(1);
  });

  it("isolates component scopes across mounts", async () => {
    const first = await harness();
    const second = await harness();

    let nextInstance = 0;
    const finalized: number[] = [];

    const definition = component({
      setup: ({ scope }) =>
        Effect.gen(function* () {
          const instance = ++nextInstance;
          yield* Scope.addFinalizer(
            scope,
            Effect.sync(() => {
              finalized.push(instance);
            }),
          );
          return text(String(instance));
        }),
    });

    const left = document.createElement("div");
    const right = document.createElement("div");

    first.h(left, definition);
    await rendered(left, "1");

    second.h(right, definition);
    await rendered(right, "2");

    await first.close();
    expect(finalized).toEqual([1]);
    expect(right.textContent).toBe("2");

    await second.close();
    expect(finalized).toEqual([1, 2]);
  });

  it("bootstrap fails clearly without the existing app root", async () => {
    document.body.replaceChildren();
    const exit = await run(bootstrap(() => {}).pipe(Effect.exit));
    expect(Exit.isFailure(exit)).toBe(true);
    Exit.match(exit, {
      onSuccess: () => {
        throw new Error("Expected missing-root failure");
      },
      onFailure: (cause) => expect(Cause.pretty(cause)).toContain('id="app"'),
    });
    expect(document.getElementById("app")).toBeNull();
  });

  it("interrupts owned background work before descendant cleanup and preserves background cleanup defects", async () => {
    const { h, close, errors } = await harness();

    const parent = document.createElement("div");

    const ready = gate();
    const events: string[] = [];

    h(
      parent,
      component({
        setup: ({ fork, h: nested }) =>
          Effect.gen(function* () {
            yield* fork(
              Deferred.succeed(ready, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(
                  Effect.sync(() => {
                    events.push("background");
                  }).pipe(Effect.andThen(Effect.die("background cleanup failed"))),
                ),
              ),
            );
            yield* Deferred.await(ready);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                events.push("parent");
              }),
            );
            const child = document.createElement("section");
            nested(
              child,
              component({
                setup: () =>
                  Effect.gen(function* () {
                    yield* Effect.addFinalizer(() =>
                      Effect.sync(() => {
                        events.push("child");
                      }),
                    );
                    return text("child");
                  }),
              }),
            );
            return child;
          }),
      }),
    );

    await rendered(parent, "child");
    await close();

    expect(events).toEqual(["background", "child", "parent"]);
    expect(errors.map((failure) => failure.operation)).toEqual(["cleanup"]);
    expect(Cause.pretty(errors.at(0)?.cause ?? Cause.empty)).toContain("background cleanup failed");
  });

  it("scopes ordinary Effect background forks and allows descendants to finish after owner insertion", async () => {
    const { h, close } = await harness();

    const parent = document.createElement("div");

    const ready = gate();
    const stopped = gate();
    const childRelease = gate();

    h(
      parent,
      component({
        setup: ({ h: nested }) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(ready, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(stopped, undefined)),
              Effect.forkScoped,
            );
            const child = document.createElement("section");
            nested(
              child,
              component({
                setup: () => Deferred.await(childRelease).pipe(Effect.map(() => text("child"))),
              }),
            );
            const main = document.createElement("main");
            main.append(text("owner"), child);
            return main;
          }),
      }),
    );
    await run(Deferred.await(ready));
    await rendered(parent, "owner");

    await open(childRelease);
    await rendered(parent, "ownerchild");

    await close();
    await run(Deferred.await(stopped));
  });
});
