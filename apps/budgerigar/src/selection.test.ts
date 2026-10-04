import { Cause, Deferred, Effect, Exit, Fiber, Match, Option, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { AccessExample } from "./access";
import {
  component,
  mounting,
  type Component,
  type ComponentContext,
  type MountFailure,
  type WritableSignal,
} from "./framework";
import { signalData } from "./reactive/signal";
import { rendered } from "./test-helpers";

const run = Effect.runPromise;
const gates: Array<Deferred.Deferred<void>> = [];
const gate = () => {
  const deferred = Deferred.makeUnsafe<void>();
  gates.push(deferred);
  return deferred;
};
const open = (value: Deferred.Deferred<void>) => run(Deferred.succeed(value, undefined));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const deferred of gates.splice(0)) await run(Deferred.succeed(deferred, undefined));
  for (const close of cleanups.splice(0)) await close();
});
const harness = async (onError: (failure: MountFailure) => void = () => {}) => {
  const scope = await run(Scope.make());
  const failures: MountFailure[] = [];
  const app = await run(
    mounting({
      scope,
      onError: (failure) => {
        failures.push(failure);
        onError(failure);
      },
    }),
  );
  const parent = document.createElement("div");
  const close = () => run(Scope.close(scope, Exit.void));
  cleanups.push(close);
  return { app, parent, close, scope, failures };
};
const text = (value: string) => component({ setup: ({ he }) => he("span", { children: [value] }) });
const shows = (parent: Node, value: string) =>
  rendered({ parent, check: () => parent.textContent === value });
const installed = (parent: Node) => rendered({ parent, check: () => parent.childNodes.length > 0 });

describe("signal-selected subtrees", () => {
  it("adopts the latest committed selection, keeps siblings, and deduplicates definitions", async () => {
    const { app, parent } = await harness();
    let setups = 0;
    const page = component({
      setup: () =>
        Effect.sync(() => {
          setups += 1;
          return document.createTextNode("page");
        }),
    });
    const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
    const sibling = await run(app.he("b", { children: ["before"] }));
    const tree = await run(app.he("div", { children: [sibling, selected, "after"] }));
    expect(setups).toBe(0);
    await run(selected.set(Option.some(page)));
    expect(setups).toBe(0);
    app.h(parent, tree);
    await shows(parent, "beforepageafter");
    const node = sibling.nextSibling?.nextSibling;
    await run(selected.set(Option.some(page)));
    expect(setups).toBe(1);
    expect(sibling.nextSibling?.nextSibling).toBe(node);
    await run(selected.set(Option.some(text("other"))));
    await shows(parent, "beforeotherafter");
    expect(tree.firstChild).toBe(sibling);
    await run(selected.set(Option.none()));
    await shows(parent, "beforeafter");
  });

  it("removes outgoing DOM immediately, overlaps cleanup with setup, and resets local state", async () => {
    const { app, parent } = await harness();
    const cleaning = gate();
    const finish = gate();
    let setups = 0;
    let warnings = 0;
    const values: Array<WritableSignal<number>> = [];
    const page = component({
      setup: (ctx) =>
        Effect.gen(function* () {
          setups += 1;
          const count = yield* ctx.signal({ initial: 0 });
          values.push(count);
          const label = yield* ctx.derive({
            sources: { count },
            compute: ({ count }) => String(count),
          });
          const node = yield* ctx.he("output", { children: [label] });
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              expect(parent.contains(node)).toBe(false);
              yield* Deferred.succeed(cleaning, undefined);
              yield* Deferred.await(finish);
            }),
          );
          return node;
        }),
    });
    const warning = component({
      setup: () =>
        Effect.sync(() => {
          warnings += 1;
          return document.createTextNode("denied");
        }),
    });
    const selected = await run(app.signal({ initial: Option.some(page) }));
    app.h(parent, selected);
    await shows(parent, "0");
    const counter = values[0];
    expect(counter).toBeDefined();
    await run(
      Option.match(Option.fromUndefinedOr(counter), {
        onNone: () => Effect.die("missing counter"),
        onSome: (value) => value.set(4),
      }),
    );
    await shows(parent, "4");
    await run(selected.set(Option.some(warning)));
    expect(parent.textContent).toBe("");
    await run(Deferred.await(cleaning));
    await shows(parent, "denied");
    await run(selected.set(Option.some(page)));
    await shows(parent, "0");
    expect(setups).toBe(2);
    expect(warnings).toBe(1);
    await open(finish);
  });

  it("revokes pending setup authority, preserves same pending definition, and doesn't block other regions", async () => {
    const { app, parent } = await harness();
    const started = gate();
    const cancelled = gate();
    const release = gate();
    let starts = 0;
    const slow = component({
      setup: () =>
        Effect.gen(function* () {
          starts += 1;
          yield* Effect.addFinalizer(() => Deferred.succeed(cancelled, undefined));
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return document.createTextNode("obsolete");
        }),
    });
    const first = await run(app.signal<Option.Option<Component>>({ initial: Option.some(slow) }));
    const second = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
    app.h(parent, [first, second]);
    await run(Deferred.await(started));
    await run(first.set(Option.some(slow)));
    expect(starts).toBe(1);
    await run(second.set(Option.some(text("independent"))));
    await shows(parent, "independent");
    await run(first.set(Option.some(text("latest"))));
    await run(Deferred.await(cancelled));
    await shows(parent, "latestindependent");
    await open(release);
    expect(parent.textContent).toBe("latestindependent");
  });

  it("does no lifecycle work for transient or aborted batch values and validates candidates atomically", async () => {
    const { app, parent } = await harness();
    let starts = 0;
    const branch = component({
      setup: () =>
        Effect.sync(() => {
          starts += 1;
          return document.createTextNode("branch");
        }),
    });
    const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
    const label = await run(app.signal({ initial: "original" }));
    app.h(parent, await run(app.he("div", { children: [label, selected] })));
    await shows(parent, "original");
    await run(
      app.batch(
        Effect.gen(function* () {
          yield* selected.set(Option.some(branch));
          yield* selected.set(Option.none());
        }),
      ),
    );
    expect(starts).toBe(0);
    await run(
      app
        .batch(selected.set(Option.some(branch)).pipe(Effect.andThen(Effect.fail("rollback"))))
        .pipe(Effect.exit),
    );
    expect(starts).toBe(0);
    // Deliberately exercise the untyped runtime boundary.
    const invalid: unknown = Option.some(false);
    const exit = await run(
      app
        .batch(
          Effect.gen(function* () {
            yield* label.set("changed");
            // @ts-expect-error Invalid selection values are rejected before any state installs.
            yield* selected.set(invalid);
          }),
        )
        .pipe(Effect.exit),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(await run(label.get)).toBe("original");
    expect(parent.textContent).toBe("original");
    await run(selected.set(Option.some(branch)));
    await shows(parent, "originalbranch");
  });

  it("supports independent occurrences, multiple/empty roots, nested selection and ancestor inputs", async () => {
    const { app, parent } = await harness();
    const label = await run(app.signal({ initial: "root" }));
    const nested = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(text("nested")) }),
    );
    let occurrences = 0;
    const branch = component({
      setup: ({ he }) =>
        Effect.gen(function* () {
          occurrences += 1;
          return [
            yield* he("span", { children: [label] }),
            yield* he("div", { children: [nested] }),
          ];
        }),
    });
    const selected = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(branch) }),
    );
    app.h(parent, [selected, selected]);
    await shows(parent, "rootnestedrootnested");
    expect(occurrences).toBe(2);
    await run(label.set("new"));
    expect(parent.textContent).toBe("newnestednewnested");
    await run(nested.set(Option.some(component({ setup: () => Effect.succeed([]) }))));
    await shows(parent, "newnew");
    await run(selected.set(Option.none()));
    await shows(parent, "");
  });

  it("reports failures without retry, re-arms on changed requests, and isolates throwing reporters", async () => {
    const error = gate();
    const secondFailure = gate();
    let reports = 0;
    const { app, parent, failures } = await harness(() => {
      reports += 1;
      Effect.runSync(
        Deferred.succeed(
          Match.value(reports).pipe(
            Match.when(1, () => error),
            Match.orElse(() => secondFailure),
          ),
          undefined,
        ),
      );
      throw new Error("reporter");
    });
    let attempts = 0;
    const failed = component({
      setup: () =>
        Effect.sync(() => {
          attempts += 1;
        }).pipe(Effect.andThen(Effect.fail("setup error"))),
    });
    const selected = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(failed) }),
    );
    app.h(parent, selected);
    await run(Deferred.await(error));
    expect(attempts).toBe(1);
    expect(failures[0]?.subject.kind).toBe("component");
    expect(parent.textContent).toBe("");
    await run(selected.set(Option.some(failed)));
    expect(attempts).toBe(1);
    // Re-arm even when these two commits coalesce before reconciliation.
    await run(selected.set(Option.none()));
    await run(selected.set(Option.some(failed)));
    const recovered = text("recovered");
    await run(selected.set(Option.some(recovered)));
    await shows(parent, "recovered");
    await run(selected.set(Option.some(failed)));
    await run(Deferred.await(secondFailure));
    expect(parent.textContent).toBe("");
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it("waits for running cleanup on target replacement and scope closure exactly once", async () => {
    const { app, parent, close } = await harness();
    const cleaning = gate();
    const release = gate();
    let finalizers = 0;
    const branch = component({
      setup: () =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              finalizers += 1;
              yield* Deferred.succeed(cleaning, undefined);
              yield* Deferred.await(release);
            }),
          );
          return document.createTextNode("old");
        }),
    });
    const selected = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(branch) }),
    );
    app.h(parent, selected);
    await shows(parent, "old");
    await run(selected.set(Option.none()));
    await run(Deferred.await(cleaning));
    app.h(parent, text("late"));
    const closing = close();
    expect(Exit.isFailure(await run(selected.get.pipe(Effect.exit)))).toBe(true);
    expect(Exit.isFailure(await run(app.he("div").pipe(Effect.exit)))).toBe(true);
    app.h(parent, text("ignored"));
    await open(release);
    await closing;
    expect(finalizers).toBe(1);
    expect(parent.childNodes.length).toBe(0);
  });

  it("demonstrates all access states and preserves reachable controls", async () => {
    const { app, parent } = await harness();
    app.h(parent, AccessExample);
    await rendered({ parent, check: () => parent.querySelectorAll("button").length === 3 });
    const click = (label: string) =>
      Array.from(parent.querySelectorAll("button"))
        .find((button) => button.textContent === label)
        ?.click();
    expect(parent.querySelector("article")).toBeNull();
    click("Denied");
    await rendered({ parent, check: () => parent.querySelector('[role="alert"]') !== null });
    click("Allowed");
    await rendered({ parent, check: () => parent.querySelector("output")?.textContent === "0" });
    click("Increment page counter");
    await rendered({ parent, check: () => parent.querySelector("output")?.textContent === "1" });
    const article = parent.querySelector("article");
    click("Allowed");
    expect(parent.querySelector("article")).toBe(article);
    click("Unknown");
    await rendered({ parent, check: () => parent.querySelector("article") === null });
    click("Allowed");
    await rendered({ parent, check: () => parent.querySelector("output")?.textContent === "0" });
    expect(parent.querySelectorAll('.access-example > button[type="button"]').length).toBe(3);
  });
});

describe("application reactive ownership", () => {
  it("shares committed root snapshots across targets and retains root resources when a target clears", async () => {
    const { app, parent } = await harness();
    const right = document.createElement("div");
    const leftValue = await run(app.signal({ initial: "L" }));
    const rightValue = await run(app.signal({ initial: "R" }));
    const label = await run(
      app.derive({
        sources: { leftValue, rightValue },
        compute: ({ leftValue, rightValue }) => leftValue + rightValue,
      }),
    );
    const branch = component({
      setup: ({ he }) => he("p", { children: [label], props: { hidden: false } }),
    });
    const selected = await run(
      app.signal<Option.Option<Component>>({ initial: Option.some(branch) }),
    );
    const node = await run(
      app.he("div", {
        children: [label, selected],
        attrs: {
          title: await run(
            app.derive({ sources: { label }, compute: ({ label }) => Option.some(label) }),
          ),
        },
      }),
    );
    app.h(parent, node);
    app.h(right, selected);
    await Promise.all([shows(parent, "LRLR"), shows(right, "LR")]);
    const observations: string[] = [];
    await run(
      app.subscribeStream(await run(label.changes), (value) =>
        Effect.sync(() => {
          observations.push(value);
        }),
      ),
    );
    await run(
      app.batch(
        Effect.gen(function* () {
          yield* leftValue.set("A");
          yield* rightValue.set("B");
        }),
      ),
    );
    expect(parent.textContent).toBe("ABAB");
    expect(right.textContent).toBe("AB");
    app.h(parent, []);
    await shows(parent, "");
    await run(leftValue.set("C"));
    expect(right.textContent).toBe("CB");
    expect(await run(leftValue.get)).toBe("C");
    // Root subscription remains owned by the application.
    const observed = gate();
    await run(
      app.subscribeStream(await run(label.changes), () => Deferred.succeed(observed, undefined)),
    );
    await run(Deferred.await(observed));
    expect(observations).toContain("AB");
  });

  it("rejects descendant, sibling, separate-root and disposed resources", async () => {
    const { app, parent, scope } = await harness();
    const ready = Deferred.makeUnsafe<ComponentContext>();
    app.h(
      parent,
      component({
        setup: (ctx) => Deferred.succeed(ready, ctx).pipe(Effect.andThen(ctx.he("div"))),
      }),
    );
    const child = await run(Deferred.await(ready));
    const owned = await run(child.signal<Option.Option<Component>>({ initial: Option.none() }));
    expect(Exit.isFailure(await run(app.he("div", { children: [owned] }).pipe(Effect.exit)))).toBe(
      true,
    );
    expect(
      Exit.isFailure(
        await run(
          app.derive({ sources: { owned }, compute: ({ owned }) => owned }).pipe(Effect.exit),
        ),
      ),
    ).toBe(true);
    const second = await run(mounting({ scope, onError: () => {} }));
    const foreign = await run(second.signal<Option.Option<Component>>({ initial: Option.none() }));
    expect(
      Exit.isFailure(await run(app.he("div", { children: [foreign] }).pipe(Effect.exit))),
    ).toBe(true);
    const siblingReady = Deferred.makeUnsafe<ComponentContext>();
    const target = document.createElement("div");
    app.h(
      target,
      component({
        setup: (ctx) => Deferred.succeed(siblingReady, ctx).pipe(Effect.andThen(ctx.he("div"))),
      }),
    );
    const sibling = await run(Deferred.await(siblingReady));
    expect(
      Exit.isFailure(await run(sibling.he("div", { children: [owned] }).pipe(Effect.exit))),
    ).toBe(true);
    await rendered({ parent, check: () => parent.querySelector("div") !== null });
    app.h(parent, []);
    await rendered({ parent, check: () => parent.childNodes.length === 0 });
    expect(Exit.isFailure(await run(owned.get.pipe(Effect.exit)))).toBe(true);
  });

  it("unregisters component signals from shared coordination across replacements", async () => {
    const { app, parent } = await harness();
    const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
    const coordinator = signalData(selected).participant;
    const childSignals: Array<typeof coordinator> = [];
    const branch = component({
      setup: ({ signal, derive, he }) =>
        Effect.gen(function* () {
          const local = yield* signal({ initial: 0 });
          yield* derive({ sources: { selected }, compute: ({ selected }) => selected });
          childSignals.push(signalData(local).participant);
          return yield* he("span", { children: ["child"] });
        }),
    });
    app.h(parent, selected);
    await installed(parent);
    for (let index = 0; index < 5; index += 1) {
      await run(selected.set(Option.some(branch)));
      await shows(parent, "child");
      await run(selected.set(Option.none()));
      await shows(parent, "");
      expect(childSignals.every((signal) => !signal.lifetime.active())).toBe(true);
      expect(coordinator.dependents.size).toBe(0);
    }
  });

  it("reports root work before mounting, supplies its scope, and stops root handles before descendant cleanup", async () => {
    const failed = Deferred.makeUnsafe<MountFailure>();
    const { app, parent, close } = await harness((failure) => {
      Effect.runSync(Deferred.succeed(failed, failure));
    });
    const finalized = gate();
    await run(
      app.fork(
        Effect.addFinalizer(() => Deferred.succeed(finalized, undefined)).pipe(
          Effect.andThen(Effect.fail("root failure")),
        ),
      ),
    );
    const failure = await run(Deferred.await(failed));
    expect(failure.subject.kind).toBe("application");
    expect("parent" in failure).toBe(false);
    expect(Cause.hasFails(failure.cause)).toBe(true);
    const cleaning = gate();
    const release = gate();
    const value = await run(app.signal({ initial: "root" }));
    app.h(
      parent,
      component({
        setup: ({ he }) =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release))),
            );
            return yield* he("p", { children: [value] });
          }),
      }),
    );
    await shows(parent, "root");
    const closing = close();
    await run(Deferred.await(cleaning));
    expect(Exit.isFailure(await run(value.set("late").pipe(Effect.exit)))).toBe(true);
    await open(release);
    await closing;
    await run(Deferred.await(finalized));
    expect(parent.textContent).toBe("");
  });
});

it("supports the direct root access derivation and reactive native values", async () => {
  const { app, parent } = await harness();
  const access = await run(app.signal<Option.Option<boolean>>({ initial: Option.none() }));
  const page = text("allowed");
  const warning = text("denied");
  const selected = await run(
    app.derive({
      sources: { access },
      compute: ({ access }): Option.Option<Component> =>
        Option.match(access, {
          onNone: () => Option.none(),
          onSome: (allowed) =>
            Match.value(allowed).pipe(
              Match.when(false, () => Option.some(warning)),
              Match.when(true, () => Option.some(page)),
              Match.exhaustive,
            ),
        }),
    }),
  );
  const hidden = await run(app.signal({ initial: false }));
  const title = await run(app.signal({ initial: Option.some("initial") }));
  const node = await run(
    app.he("div", { children: [selected], props: { hidden }, attrs: { title } }),
  );
  app.h(parent, node);
  await installed(parent);
  await run(access.set(Option.some(false)));
  await shows(parent, "denied");
  await run(access.set(Option.some(true)));
  await shows(parent, "allowed");
  await run(app.batch(hidden.set(true).pipe(Effect.andThen(title.set(Option.some("changed"))))));
  expect(node.hidden).toBe(true);
  expect(node.title).toBe("changed");
  await run(access.set(Option.none()));
  await shows(parent, "");
});

it("rejects invalid initial selections and revalidates unadopted trees before replacement", async () => {
  const failed = Deferred.makeUnsafe<MountFailure>();
  const { app, parent } = await harness((failure) => {
    Effect.runSync(Deferred.succeed(failed, failure));
  });
  const original = await run(app.he("p", { children: ["installed"] }));
  app.h(parent, original);
  await shows(parent, "installed");
  for (const invalid of [
    false,
    Option.some(false),
    text("bare"),
    Option.some(document.createElement("div")),
    null,
    undefined,
  ]) {
    const signal = await run(app.signal({ initial: invalid }));
    // @ts-expect-error Exercise invalid signal payloads at the runtime construction boundary.
    expect(Exit.isFailure(await run(app.he("div", { children: [signal] }).pipe(Effect.exit)))).toBe(
      true,
    );
  }
  const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
  const unused = await run(app.he("div", { children: [selected] }));
  // Detached construction has no live validation sink: the state can change before adoption.
  // @ts-expect-error Exercise adoption revalidation of an invalid committed payload.
  await run(selected.set(Option.some(false)));
  app.h(parent, unused);
  await run(Deferred.await(failed));
  expect(parent.firstChild).toBe(original);
  expect(parent.textContent).toBe("installed");
});

it("prevents late uninterruptible setup from adopting while replacement setup proceeds", async () => {
  const { app, parent } = await harness();
  const ready = gate();
  const release = gate();
  const finished = gate();
  let replacementStarts = 0;
  const slow = component({
    setup: () =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Deferred.succeed(finished, undefined));
        yield* Deferred.succeed(ready, undefined);
        yield* Deferred.await(release).pipe(Effect.uninterruptible);
        return document.createTextNode("late obsolete result");
      }),
  });
  const replacement = component({
    setup: () =>
      Effect.sync(() => {
        replacementStarts += 1;
        return document.createTextNode("latest");
      }),
  });
  const selected = await run(app.signal({ initial: Option.some(slow) }));
  app.h(parent, selected);
  await run(Deferred.await(ready));
  await run(selected.set(Option.some(replacement)));
  expect(parent.textContent).toBe("");
  expect(replacementStarts).toBe(0);
  await shows(parent, "latest");
  expect(replacementStarts).toBe(1);
  await open(release);
  await run(Deferred.await(finished));
  expect(parent.textContent).toBe("latest");
});

it("publishes observations and ordinary DOM while selection cleanup is awaiting", async () => {
  const { app, parent } = await harness();
  const cleaning = gate();
  const release = gate();
  const observed = gate();
  const branch = component({
    setup: () =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release))),
        );
        return document.createTextNode("outgoing");
      }),
  });
  const selected = await run(
    app.signal<Option.Option<Component>>({ initial: Option.some(branch) }),
  );
  const label = await run(app.signal({ initial: "old" }));
  app.h(parent, await run(app.he("div", { children: [label, selected] })));
  await shows(parent, "oldoutgoing");
  await run(
    app.subscribeStream(await run(selected.changes), (value) =>
      Option.match(value, {
        onSome: () => Effect.void,
        onNone: () => Deferred.succeed(observed, undefined),
      }),
    ),
  );
  await run(app.batch(label.set("new").pipe(Effect.andThen(selected.set(Option.none())))));
  expect(parent.textContent).toBe("new");
  await run(Deferred.await(cleaning));
  await run(Deferred.await(observed));
  expect(await run(selected.get)).toEqual(Option.none());
  await open(release);
  await shows(parent, "new");
});

it("keeps latest requests received during failure cleanup and continues after cleanup failures", async () => {
  const { app, parent, failures, close } = await harness();
  const cleaning = gate();
  const release = gate();
  const broken = component({
    setup: () =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(cleaning, undefined);
            yield* Deferred.await(release);
            yield* Effect.die("cleanup failure");
          }),
        );
        return yield* Effect.fail("setup failure");
      }),
  });
  const selected = await run(app.signal({ initial: Option.some(broken) }));
  app.h(parent, selected);
  await run(Deferred.await(cleaning));
  await run(selected.set(Option.some(text("latest"))));
  await open(release);
  await shows(parent, "latest");
  await close();
  expect(failures.map((failure) => failure.operation)).toEqual(["setup", "cleanup"]);
});

it("cleans selected adoption failures and retries only after a changed definition", async () => {
  const failed = Deferred.makeUnsafe<MountFailure>();
  const { app, parent } = await harness((failure) => {
    Effect.runSync(Deferred.succeed(failed, failure));
  });
  let cleanups = 0;
  const cleaned = gate();
  const attached = document.createElement("div");
  document.body.append(attached);
  const broken = component({
    setup: () =>
      Effect.addFinalizer(() =>
        Effect.sync(() => {
          cleanups += 1;
        }).pipe(Effect.andThen(Deferred.succeed(cleaned, undefined))),
      ).pipe(Effect.as(attached)),
  });
  const selected = await run(
    app.signal<Option.Option<Component>>({ initial: Option.some(broken) }),
  );
  app.h(parent, [document.createTextNode("sibling"), selected]);
  const failure = await run(Deferred.await(failed));
  expect(failure.operation).toBe("validation");
  await run(Deferred.await(cleaned));
  expect(cleanups).toBe(1);
  expect(parent.textContent).toBe("sibling");
  await run(selected.set(Option.some(broken)));
  expect(cleanups).toBe(1);
  attached.remove();
  await run(selected.set(Option.none()));
  await run(selected.set(Option.some(broken)));
  await rendered({ parent, check: () => parent.contains(attached) });
  expect(cleanups).toBe(1);
});

it("preserves root batch conflicts and cancels pending batches on shutdown", async () => {
  const { app, parent, close } = await harness();
  let obsoleteStarts = 0;
  const obsolete = component({
    setup: () =>
      Effect.sync(() => {
        obsoleteStarts += 1;
        return document.createTextNode("obsolete");
      }),
  });
  const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
  app.h(parent, selected);
  await installed(parent);
  const staged = gate();
  const release = gate();
  const batch = Effect.runFork(
    app.batch(
      Effect.gen(function* () {
        yield* selected.set(Option.some(obsolete));
        yield* Deferred.succeed(staged, undefined);
        yield* Deferred.await(release);
      }),
    ),
  );
  await run(Deferred.await(staged));
  await run(selected.set(Option.some(text("committed"))));
  await shows(parent, "committed");
  await open(release);
  expect(Exit.isFailure(await run(Fiber.await(batch)))).toBe(true);
  expect(obsoleteStarts).toBe(0);
  const waiting = gate();
  const pending = Effect.runFork(
    app.batch(
      Effect.gen(function* () {
        yield* selected.set(Option.none());
        yield* Deferred.succeed(waiting, undefined);
        yield* Effect.never;
      }),
    ),
  );
  await run(Deferred.await(waiting));
  await close();
  expect(Exit.isFailure(await run(Fiber.await(pending)))).toBe(true);
  expect(parent.childNodes.length).toBe(0);
});

it("does not visit unrelated root signals or selection regions during commits", async () => {
  const { app, parent } = await harness();
  const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
  const unrelated = await run(app.signal({ initial: 0 }));
  let computations = 0;
  await run(
    app.derive({
      sources: { unrelated },
      compute: ({ unrelated }) => {
        computations += 1;
        return unrelated;
      },
    }),
  );
  let validations = 0;
  let flushes = 0;
  const disconnect = signalData(unrelated).bind({
    validate: () =>
      Effect.sync(() => {
        validations += 1;
      }),
    flush: () =>
      Effect.sync(() => {
        flushes += 1;
      }),
  });
  app.h(parent, selected);
  await installed(parent);
  await run(selected.set(Option.some(text("selected"))));
  await shows(parent, "selected");
  expect(computations).toBe(1);
  expect(validations).toBe(0);
  expect(flushes).toBe(0);
  disconnect();
});

it("interrupts root work before descendant finalizers and closes application resources afterward", async () => {
  const { app, parent, close } = await harness();
  const ready = gate();
  let interrupted = false;
  const order: string[] = [];
  const value = await run(app.signal({ initial: 0 }));
  await run(
    app.fork(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            order.push("root");
          }),
        );
        yield* Deferred.succeed(ready, undefined);
        yield* Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        );
      }),
    ),
  );
  await run(Deferred.await(ready));
  app.h(
    parent,
    component({
      setup: () =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              expect(interrupted).toBe(true);
              expect(Exit.isFailure(yield* value.get.pipe(Effect.exit))).toBe(true);
              order.push("child");
            }),
          );
          return document.createTextNode("child");
        }),
    }),
  );
  await shows(parent, "child");
  await close();
  expect(order).toEqual(["child", "root"]);
});

it("re-arms failed selection even when None is coalesced before the next setup", async () => {
  const first = gate();
  const second = gate();
  let attempts = 0;
  const { app, parent } = await harness(() => {
    Effect.runSync(
      Deferred.succeed(
        Match.value(attempts).pipe(
          Match.when(1, () => first),
          Match.orElse(() => second),
        ),
        undefined,
      ),
    );
  });
  const failed = component({
    setup: () =>
      Effect.sync(() => {
        attempts += 1;
      }).pipe(Effect.andThen(Effect.fail("failed"))),
  });
  const selected = await run(
    app.signal<Option.Option<Component>>({ initial: Option.some(failed) }),
  );
  app.h(parent, selected);
  await run(Deferred.await(first));
  await run(selected.set(Option.some(failed)));
  expect(attempts).toBe(1);
  await run(
    Effect.gen(function* () {
      yield* selected.set(Option.none());
      yield* selected.set(Option.some(failed));
    }),
  );
  await run(Deferred.await(second));
  expect(attempts).toBe(2);
});

it("shuts down during pending uninterruptible selection setup without adopting its result", async () => {
  const { app, parent, close } = await harness();
  const started = gate();
  const release = gate();
  let cleanups = 0;
  const branch = component({
    setup: () =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            cleanups += 1;
          }),
        );
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release).pipe(Effect.uninterruptible);
        return document.createTextNode("late result");
      }),
  });
  const selected = await run(app.signal({ initial: Option.some(branch) }));
  app.h(parent, selected);
  await run(Deferred.await(started));
  const closing = close();
  expect(Exit.isFailure(await run(selected.get.pipe(Effect.exit)))).toBe(true);
  await open(release);
  await closing;
  expect(parent.childNodes.length).toBe(0);
  expect(cleanups).toBe(1);
});

it("keeps concrete adoption context for failures of root-owned DOM bindings", async () => {
  const error = Deferred.makeUnsafe<MountFailure>();
  const { app, parent } = await harness((failure) => {
    Effect.runSync(Deferred.succeed(error, failure));
  });
  const label = await run(app.signal({ initial: "original" }));
  const node = await run(app.he("input", { props: { value: label } }));
  app.h(parent, node);
  await installed(parent);
  Object.defineProperty(node, "value", {
    configurable: true,
    set: () => {
      throw new Error("assignment");
    },
  });
  await run(label.set("committed"));
  const failure = await run(Deferred.await(error));
  expect(failure.operation).toBe("reactive-dom");
  expect(failure.subject.kind).toBe("replacement");
  expect("parent" in failure && failure.parent === parent).toBe(true);
  expect(await run(label.get)).toBe("committed");
});

it("revokes adoption authority when a branch supersedes itself during synchronous setup", async () => {
  const { app, parent } = await harness();
  const selected = await run(app.signal<Option.Option<Component>>({ initial: Option.none() }));
  const replacement = text("latest");
  let cleaned = false;
  const obsolete = component({
    setup: () =>
      Effect.gen(function* () {
        const node = document.createTextNode("obsolete");
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            expect(node.parentNode).toBeNull();
            cleaned = true;
          }),
        );
        yield* selected.set(Option.some(replacement));
        return node;
      }),
  });
  await run(selected.set(Option.some(obsolete)));
  app.h(parent, selected);
  await shows(parent, "latest");
  expect(cleaned).toBe(true);
});

it("removes partially adopted output before asynchronous failure cleanup while preserving siblings", async () => {
  const failed = Deferred.makeUnsafe<MountFailure>();
  const { app, parent } = await harness((failure) => {
    Effect.runSync(Deferred.succeed(failed, failure));
  });
  const first = document.createTextNode("partial");
  const last = document.createTextNode("throws");
  const insert = parent.insertBefore.bind(parent);
  parent.insertBefore = <T extends Node>(node: T, child: Node | null): T => {
    Match.value(Object.is(node, last)).pipe(
      Match.when(true, () => {
        throw new Error("native insertion failure");
      }),
      Match.when(false, () => {}),
      Match.exhaustive,
    );
    return insert(node, child);
  };
  let cleanupSawAttachedOutput = false;
  const cleaned = gate();
  const broken = component({
    setup: () =>
      Effect.addFinalizer(() =>
        Effect.sync(() => {
          cleanupSawAttachedOutput = parent.contains(first);
        }).pipe(Effect.andThen(Deferred.succeed(cleaned, undefined))),
      ).pipe(Effect.as([first, last])),
  });
  const selected = await run(app.signal({ initial: Option.some(broken) }));
  app.h(parent, [document.createTextNode("sibling"), selected]);
  const failure = await run(Deferred.await(failed));
  expect(failure.operation).toBe("validation");
  await run(Deferred.await(cleaned));
  expect(cleanupSawAttachedOutput).toBe(false);
  expect(parent.textContent).toBe("sibling");
  expect(first.parentNode).toBeNull();
});
