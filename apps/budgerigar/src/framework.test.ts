import { Cause, Deferred, Effect, Exit, Match, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap } from "./bootstrap";
import type { ConstructionError } from "./construction";
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
    expect(left.childNodes.length).toBe(4);
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
    await rendered(parent, "last");
    await open(releaseSetup);

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
    expect(slow.childNodes.length).toBe(2);

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
    expect(parent.firstElementChild).toBe(child);
    expect(child.textContent).toBe("child");

    await open(releaseChild);
    await run(Deferred.await(parentCleaning));
    expect(parent.firstElementChild).toBe(child);
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

    await run(Deferred.await(ready));
    await run(Deferred.await(backgroundReady));

    const closing = close();

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

    await closing;
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

describe("static DOM construction and regions", () => {
  it("constructs native properties after literal children and attributes", async () => {
    const { h } = await harness();

    const parent = document.createElement("div");

    h(
      parent,
      component({
        setup: ({ he }) =>
          Effect.gen(function* () {
            const input = yield* he("input", {
              attrs: {
                value: "default",
                disabled: false,
                required: true,
                "aria-expanded": "false",
                "data-empty": "",
              },
              props: { value: "current", checked: true },
            });

            expect(input.defaultValue).toBe("default");
            expect(input.value).toBe("current");
            expect(input.checked).toBe(true);

            expect(input.hasAttribute("disabled")).toBe(false);
            expect(input.getAttribute("required")).toBe("");
            expect(input.getAttribute("aria-expanded")).toBe("false");
            expect(input.getAttribute("data-empty")).toBe("");

            const select = yield* he("select", {
              children: [
                yield* he("option", { attrs: { value: "apple" }, children: ["Apple"] }),
                yield* he("option", { attrs: { value: "banana" }, children: ["Banana"] }),
              ],
              props: { value: "banana" },
            });

            expect(select.value).toBe("banana");

            return yield* he("main", {
              attrs: { class: "welcome" },
              children: [input, select, "<b>literal</b>"],
            });
          }),
      }),
    );

    await rendered(parent, "AppleBanana<b>literal</b>");
    expect(parent.querySelector("b")).toBeNull();
    expect(parent.querySelector("main")?.className).toBe("welcome");
  });

  it("preflights construction children and rejects unsupported structural features", async () => {
    const { h, errors } = await harness();

    const parent = document.createElement("div");

    h(
      parent,
      component({
        setup: ({ he }) =>
          Effect.gen(function* () {
            const first = yield* he("span");
            expect(
              (yield* he("div", { children: [first, first] }).pipe(Effect.flip)).message,
            ).toContain("duplicate");
            expect(first.parentNode).toBeNull();
            const attached = yield* he("div", { children: [yield* he("span")] });
            expect(
              (yield* he("div", { children: [first, attached.firstChild as Node] }).pipe(
                Effect.flip,
              )).message,
            ).toContain("detached");
            expect(first.parentNode).toBeNull();
            expect(attached.childNodes.length).toBe(1);
            expect(
              (yield* he("div", { attrs: { onclick: "alert(1)" } }).pipe(Effect.flip)).message,
            ).toContain("unsupported attribute");
            expect(
              (yield* he("iframe", { attrs: { srcdoc: "<p>hello</p>" } }).pipe(Effect.flip))
                .message,
            ).toContain("unsupported attribute");
            return yield* he("div", { children: ["valid"] });
          }),
      }),
    );
    await rendered(parent, "valid");
    expect(errors).toEqual([]);
  });

  it("defers discarded trees and independently mounts repeated inline definitions", async () => {
    const { h, close } = await harness();
    const parent = document.createElement("div");
    let started = 0;
    let cleaned = 0;
    const child = component({
      setup: () =>
        Effect.gen(function* () {
          started += 1;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              cleaned += 1;
            }),
          );
          return [text("child"), text(String(started))];
        }),
    });
    h(
      parent,
      component({
        setup: ({ he }) =>
          Effect.gen(function* () {
            yield* he("section", { children: [child] });
            expect(started).toBe(0);
            return yield* he("main", {
              children: ["before", child, yield* he("hr"), child, "after"],
            });
          }),
      }),
    );
    await rendered(parent, "beforechild1child2after");
    expect(parent.querySelector("main")?.children.length).toBe(1);
    expect(started).toBe(2);
    await close();
    expect(cleaned).toBe(2);
  });

  it("preserves region order when asynchronous children finish out of order", async () => {
    const { h, close } = await harness();
    const parent = document.createElement("div");
    const firstReady = gate();
    const secondReady = gate();
    const firstRelease = gate();
    const secondRelease = gate();
    const events: string[] = [];
    const child = (options: {
      ready: Deferred.Deferred<void>;
      release: Deferred.Deferred<void>;
      value: string;
    }) =>
      component({
        setup: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                events.push(options.value);
              }),
            );
            yield* Deferred.succeed(options.ready, undefined);
            yield* Deferred.await(options.release);
            return [text(options.value), text("!")];
          }),
      });
    h(
      parent,
      component({
        setup: ({ he }) =>
          he("main", {
            children: [
              "before",
              child({ ready: firstReady, release: firstRelease, value: "first" }),
              "between",
              child({ ready: secondReady, release: secondRelease, value: "second" }),
              "after",
            ],
          }),
      }),
    );
    await Promise.all([run(Deferred.await(firstReady)), run(Deferred.await(secondReady))]);
    await rendered(parent, "beforebetweenafter");
    await open(secondRelease);
    await rendered(parent, "beforebetweensecond!after");
    await open(firstRelease);
    await rendered(parent, "beforefirst!betweensecond!after");
    await close();
    expect(events).toEqual(["first", "second"]);
  });

  it("isolates inline failure and empty roots without failing the enclosing setup", async () => {
    const { h, errors } = await harness();
    const parent = document.createElement("div");
    const ready = gate();
    const release = gate();
    let cleaned = 0;
    const failed = component({
      setup: () =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              cleaned += 1;
            }),
          );
          yield* Deferred.succeed(ready, undefined);
          yield* Deferred.await(release);
          return yield* Effect.fail("inline failure");
        }),
    });
    h(
      parent,
      component({
        setup: ({ he }) =>
          he("main", {
            children: ["a", failed, component({ setup: () => Effect.succeed([]) }), "b"],
          }),
      }),
    );
    await run(Deferred.await(ready));
    await rendered(parent, "ab");
    await open(release);
    expect(cleaned).toBe(1);
    expect(parent.textContent).toBe("ab");
    expect(errors.map((failure) => failure.operation)).toEqual(["setup"]);
    expect(errors[0]?.subject.kind).toBe("component");
  });

  for (const array of [false, true]) {
    it(`cancels pending ${Match.value(array).pipe(
      Match.when(true, () => "one-item array"),
      Match.orElse(() => "standalone component"),
    )} setup and awaits cleanup`, async () => {
      const { h, errors } = await harness();
      const parent = document.createElement("div");
      const ready = gate();
      const setupRelease = gate();
      const cleaning = gate();
      const cleanupRelease = gate();
      const slow = component({
        setup: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Deferred.succeed(cleaning, undefined).pipe(
                Effect.andThen(Deferred.await(cleanupRelease)),
              ),
            );
            yield* Deferred.succeed(ready, undefined);
            yield* Deferred.await(setupRelease);
            return text("stale");
          }),
      });
      h(
        parent,
        Match.value(array).pipe(
          Match.when(true, () => [slow]),
          Match.orElse(() => slow),
        ),
      );
      await run(Deferred.await(ready));
      h(parent, text("next"));
      await run(Deferred.await(cleaning));
      expect(parent.textContent).toBe("");
      await open(setupRelease);
      expect(parent.textContent).toBe("");
      await open(cleanupRelease);
      await rendered(parent, "next");
      expect(errors).toEqual([]);
    });
  }

  it("installs mixed replacement arrays once, snapshots membership, and clears empty arrays", async () => {
    const { h } = await harness();
    const parent = document.createElement("div");
    let occurrence = 0;
    const child = component({ setup: () => Effect.sync(() => text(String(++occurrence))) });
    const items = [text("a"), child, text("b"), child];
    h(parent, items);
    items.splice(0, items.length, text("mutated"));
    await rendered(parent, "a1b2");
    expect(occurrence).toBe(2);
    h(parent, []);
    await rendered(parent, "");
    expect(parent.childNodes.length).toBe(0);
  });

  it("leaves pending valid setup active after invalid mixed requests", async () => {
    const { h, errors } = await harness();
    const parent = document.createElement("div");
    const ready = gate();
    const release = gate();
    let badStarted = false;
    h(
      parent,
      component({
        setup: () =>
          Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.map(() => text("valid")),
          ),
      }),
    );
    await run(Deferred.await(ready));
    const duplicate = text("duplicate");
    h(parent, [
      component({
        setup: () =>
          Effect.sync(() => {
            badStarted = true;
            return text("bad");
          }),
      }),
      duplicate,
      duplicate,
    ]);
    expect(badStarted).toBe(false);
    expect(errors.map((failure) => failure.operation)).toEqual(["validation"]);
    expect(errors[0]?.subject.kind).toBe("replacement");
    await open(release);
    await rendered(parent, "valid");
  });

  it("rejects invalid node kinds, parented roots, reserved and previously adopted nodes", async () => {
    const { h, errors } = await harness();
    const parent = document.createElement("div");
    h(parent, text("old"));
    await rendered(parent, "old");
    const reserved = text("reserved");
    h(parent, reserved);
    h(parent, reserved);
    const attached = document.createElement("aside");
    const root = text("attached");
    attached.append(root);
    for (const node of [
      root,
      document,
      document.createDocumentFragment(),
      document.implementation.createDocumentType("html", "", ""),
    ])
      h(parent, node);
    await rendered(parent, "reserved");
    h(parent, text("fresh"));
    await rendered(parent, "fresh");
    h(parent, reserved);
    expect(parent.textContent).toBe("fresh");
    expect(attached.textContent).toBe("attached");
    expect(errors.length).toBe(6);
    expect(errors.every((failure) => failure.operation === "validation")).toBe(true);
  });

  it("rejects queued reparenting and mutation before cleaning the active view", async () => {
    const { h, errors } = await harness();
    const parent = document.createElement("div");
    const cleaning = gate();
    const release = gate();
    h(
      parent,
      component({
        setup: () =>
          Effect.addFinalizer(() =>
            Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release))),
          ).pipe(Effect.as(text("old"))),
      }),
    );
    await rendered(parent, "old");
    h(parent, text("middle"));
    await run(Deferred.await(cleaning));
    const reparented = text("stolen");
    const mutated = document.createElement("section");
    mutated.append(text("original"));
    h(parent, reparented);
    h(parent, mutated);
    const external = document.createElement("aside");
    external.append(reparented);
    mutated.append(text("changed"));
    await open(release);
    await rendered(parent, "middle");
    h(parent, text("last"));
    await rendered(parent, "last");
    expect(errors.map((failure) => failure.operation)).toEqual(["validation", "validation"]);
    expect(external.textContent).toBe("stolen");
  });

  it("rejects foreign constructed regions, missing anchors, and explicit anchor roots", async () => {
    const { h, errors } = await harness();
    const parent = document.createElement("div");
    const foreign = document.createElement("div");
    let tree = document.createElement("main");
    let started = 0;
    const child = component({
      setup: () =>
        Effect.sync(() => {
          started += 1;
          return text("child");
        }),
    });
    h(
      parent,
      component({
        setup: ({ he, h: nested }) =>
          Effect.gen(function* () {
            tree = yield* he("main", { children: [child] });
            const tampered = yield* he("section", { children: [child] });
            tampered.replaceChildren();
            expect(
              (yield* he("div", { children: [tampered] }).pipe(Effect.flip)).message,
            ).toContain("missing region");
            nested(foreign, tree.firstChild as Node);
            return yield* he("p", { children: ["owner"] });
          }),
      }),
    );
    await rendered(parent, "owner");
    h(foreign, tree);
    expect(started).toBe(0);
    expect(tree.parentNode).toBeNull();
    expect(errors.map((failure) => failure.operation)).toEqual(["validation", "validation"]);
  });

  it("disposes inline setup and background work on native replacement with DOM attached", async () => {
    const { h, close, errors } = await harness();
    const parent = document.createElement("div");
    const ready = gate();
    const backgroundStopped = gate();
    const pendingReady = gate();
    const pendingRelease = gate();
    const events: string[] = [];
    let staleConstruct: () => Effect.Effect<Node, ConstructionError> = () =>
      Effect.succeed(text("unused"));
    h(
      parent,
      component({
        setup: ({ he, h: nested }) =>
          Effect.gen(function* () {
            staleConstruct = () => he("div");
            const child = component({
              setup: ({ fork }) =>
                Effect.gen(function* () {
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      events.push(`child:${parent.textContent}`);
                    }),
                  );
                  yield* fork(
                    Deferred.succeed(ready, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.ensuring(Deferred.succeed(backgroundStopped, undefined)),
                    ),
                  );
                  return text("child");
                }),
            });
            const pending = component({
              setup: () =>
                Deferred.succeed(pendingReady, undefined).pipe(
                  Effect.andThen(Deferred.await(pendingRelease)),
                  Effect.map(() => text("stale")),
                ),
            });
            const target = yield* he("section");
            nested(target, yield* he("main", { children: ["before", child, pending, "after"] }));
            return target;
          }),
      }),
    );
    await Promise.all([run(Deferred.await(ready)), run(Deferred.await(pendingReady))]);
    await rendered(parent, "beforechildafter");
    h(parent, text("next"));
    await rendered(parent, "next");
    await run(Deferred.await(backgroundStopped));
    await open(pendingRelease);
    expect(events).toEqual(["child:beforechildafter"]);
    expect((await run(staleConstruct().pipe(Effect.flip))).message).toContain("disposed");
    await close();
    expect(events.length).toBe(1);
    expect(errors).toEqual([]);
  });
});

describe("replacement resource boundaries", () => {
  it("disposes a native replacement's inline regions while its issuing context stays alive", async () => {
    const { h, close, errors } = await harness();
    const parent = document.createElement("div");
    const ready = gate();
    const release = gate();
    const stopped = gate();
    let replace: () => Effect.Effect<void, ConstructionError> = () => Effect.void;
    let finalized = 0;
    h(
      parent,
      component({
        setup: ({ he, h: nested }) =>
          Effect.gen(function* () {
            const target = yield* he("section");
            const pending = component({
              setup: ({ fork }) =>
                Effect.gen(function* () {
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      finalized += 1;
                    }),
                  );
                  yield* fork(
                    Effect.never.pipe(Effect.ensuring(Deferred.succeed(stopped, undefined))),
                  );
                  yield* Deferred.succeed(ready, undefined);
                  yield* Deferred.await(release);
                  return text("stale");
                }),
            });
            nested(target, yield* he("main", { children: ["native", pending] }));
            replace = () =>
              he("p", { children: ["replacement"] }).pipe(
                Effect.map((node) => nested(target, node)),
              );
            return target;
          }),
      }),
    );
    await run(Deferred.await(ready));
    await rendered(parent, "native");
    await run(replace());
    await rendered(parent, "replacement");
    await run(Deferred.await(stopped));
    await open(release);
    expect(finalized).toBe(1);
    await run(replace());
    await close();
    expect(finalized).toBe(1);
    expect(errors).toEqual([]);
  });

  it("reports genuine cleanup defects in interrupted setup without reporting expected cancellation", async () => {
    const { h, errors } = await harness();
    const parent = document.createElement("div");
    const ready = gate();
    h(
      parent,
      component({
        setup: () =>
          Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Effect.die("interruption cleanup defect")),
          ),
      }),
    );
    await run(Deferred.await(ready));
    h(parent, text("next"));
    await rendered(parent, "next");
    expect(errors.map((failure) => failure.operation)).toEqual(["cleanup"]);
    expect(Cause.pretty(errors[0]?.cause ?? Cause.empty)).toContain("interruption cleanup defect");
  });

  it("composes a native target after its explicitly mounted descendants have completed", async () => {
    const { h, errors } = await harness();
    const parent = document.createElement("div");
    const ready = gate();
    h(
      parent,
      component({
        setup: ({ he, h: nested }) =>
          Effect.gen(function* () {
            const target = yield* he("section");
            nested(
              target,
              component({
                setup: ({ he: childElement }) =>
                  childElement("p", { children: ["child"] }).pipe(
                    Effect.tap(() => Deferred.succeed(ready, undefined)),
                  ),
              }),
            );
            yield* Deferred.await(ready);
            return yield* he("main", { children: ["before", target, "after"] });
          }),
      }),
    );
    await rendered(parent, "beforechildafter");
    expect(errors).toEqual([]);
  });

  it("rejects invalid component output as a group and preserves native siblings", async () => {
    const { h, errors } = await harness();
    const parent = document.createElement("div");
    const supplied = text("duplicate");
    let cleaned = false;
    h(parent, [
      text("before"),
      component({
        setup: () =>
          Effect.addFinalizer(() =>
            Effect.sync(() => {
              cleaned = true;
            }),
          ).pipe(Effect.as([supplied, supplied])),
      }),
      text("after"),
    ]);
    await rendered(parent, "beforeafter");
    expect(supplied.parentNode).toBeNull();
    expect(cleaned).toBe(true);
    expect(errors.map((failure) => failure.operation)).toEqual(["validation"]);
    expect(errors[0]?.subject.kind).toBe("component");
  });
});

it("cleans setup resources and reports a typed construction failure", async () => {
  const { h, errors } = await harness();
  const parent = document.createElement("div");
  const cleaned = gate();
  h(
    parent,
    component({
      setup: ({ he }) =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Deferred.succeed(cleaned, undefined));
          return yield* he("div", { attrs: { onclick: "unsupported" } });
        }),
    }),
  );
  await run(Deferred.await(cleaned));
  h(parent, text("recovered"));
  await rendered(parent, "recovered");
  expect(errors.map((failure) => failure.operation)).toEqual(["setup"]);
  expect(Cause.hasFails(errors[0]?.cause ?? Cause.empty)).toBe(true);
  expect(Cause.pretty(errors[0]?.cause ?? Cause.empty)).toContain("unsupported attribute");
});
