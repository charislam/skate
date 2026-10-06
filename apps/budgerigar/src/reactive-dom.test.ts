import { Deferred, Effect, Exit, Fiber, Match, Result, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { Counter } from "./counter";
import {
  component,
  mounting,
  type ComponentContext,
  type MountFailure,
  type Signal,
  type WritableSignal,
} from "./framework";
import { Home } from "./home";

const run = Effect.runPromise;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

const harness = async () => {
  const scope = await run(Scope.make());
  const failures: MountFailure[] = [];
  const errors = Deferred.makeUnsafe<MountFailure>();
  const { h } = await run(
    mounting({
      scope,
      onError: (failure) => {
        failures.push(failure);
        Effect.runSync(Deferred.succeed(errors, failure));
      },
    }),
  );
  const close = () => run(Scope.close(scope, Exit.void));
  cleanups.push(close);
  return { h, failures, errors, close, scope };
};

const rendered = (options: { parent: Element; check: () => boolean }): Promise<void> =>
  new Promise((resolve) => {
    const check = () =>
      Match.value(options.check()).pipe(
        Match.when(true, () => {
          observer.disconnect();
          resolve();
        }),
        Match.orElse(() => {}),
      );
    const observer = new MutationObserver(check);
    observer.observe(options.parent, { childList: true, characterData: true, subtree: true });
    check();
  });

const mounted = async () => {
  const h = await harness();
  const parent = document.createElement("div");
  const context = Deferred.makeUnsafe<ComponentContext>();
  h.h(
    parent,
    component(() =>
      Result.succeed({
        setup: (ctx) => Deferred.succeed(context, ctx).pipe(Effect.andThen(ctx.he("main"))),
      }),
    ),
  );
  const ctx = await run(Deferred.await(context));
  await rendered({ parent, check: () => parent.querySelector("main") !== null });
  return { ...h, parent, ctx };
};

describe("reactive DOM and ownership", () => {
  it("renders independent counters, negative values, reset, and stable DOM identities", async () => {
    const { h, close } = await harness();
    const parent = document.createElement("div");
    h(parent, [Home, Counter]);
    await rendered({
      parent,
      check: () => parent.querySelectorAll(".counter output").length === 2,
    });
    const [left, right] = Array.from(parent.querySelectorAll(".counter"));
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    const counter = left ?? document.createElement("section");
    const [increment, decrement, reset] = Array.from(counter.querySelectorAll("button"));
    const output = counter.querySelector("output");
    const node = output?.firstChild;
    decrement?.click();
    await rendered({ parent, check: () => output?.textContent === "-1" });
    increment?.click();
    increment?.click();
    reset?.click();
    increment?.click();
    await rendered({ parent, check: () => output?.textContent === "1" });
    expect(right?.querySelector("output")?.textContent).toBe("0");
    expect(output?.firstChild).toBe(node);
    expect(counter.querySelector("button")).toBe(increment);
    expect(
      Array.from(counter.querySelectorAll("button")).every((button) => button.type === "button"),
    ).toBe(true);
    expect(parent.querySelector("h1")?.textContent).toBe("Budgerigar");
    expect(parent.querySelector("p")?.textContent).toBe("Effect-based FRP for the frontend");
    await close();
    increment?.click();
    expect(parent.childNodes.length).toBe(0);
  });

  it("refreshes at adoption, renders literal text, and removes bindings on native replacement", async () => {
    const { ctx, parent } = await mounted();
    const label = await run(ctx.signal({ initial: "old" }));
    const tree = await run(ctx.he("p", { children: ["before", label, label, "after"] }));
    await run(label.set("<b>new</b>"));
    expect(tree.textContent).toBe("beforeoldoldafter");
    ctx.h(parent.querySelector("main") ?? parent, tree);
    await rendered({ parent, check: () => tree.textContent === "before<b>new</b><b>new</b>after" });
    expect(tree.querySelector("b")).toBeNull();
    const nodes = Array.from(tree.childNodes);
    await run(label.set("live"));
    expect(tree.textContent).toBe("beforeliveliveafter");
    expect(Array.from(tree.childNodes)).toEqual(nodes);
    const discarded = await run(ctx.he("p", { children: [label] }));
    ctx.h(
      parent.querySelector("main") ?? parent,
      await run(ctx.he("p", { children: ["replacement"] })),
    );
    await rendered({ parent, check: () => parent.textContent === "replacement" });
    await run(label.set("later"));
    expect(tree.textContent).toBe("beforeliveliveafter");
    expect(discarded.textContent).toBe("live");
  });

  it("flushes all related text before a write completes and leaves DOM unchanged on rollback", async () => {
    const { ctx, parent } = await mounted();
    const x = await run(ctx.signal({ initial: 1 }));
    const y = await run(ctx.derive({ sources: { x }, compute: ({ x }) => x * 2 }));
    const xText = await run(ctx.derive({ sources: { x }, compute: ({ x }) => String(x) }));
    const yText = await run(ctx.derive({ sources: { y }, compute: ({ y }) => String(y) }));
    const tree = await run(ctx.he("p", { children: [xText, "/", yText] }));
    ctx.h(parent.querySelector("main") ?? parent, tree);
    await rendered({ parent, check: () => parent.textContent === "1/2" });
    await run(x.set(2));
    expect(parent.textContent).toBe("2/4");
    await run(ctx.batch(x.set(3).pipe(Effect.andThen(Effect.fail("no")))).pipe(Effect.exit));
    expect(parent.textContent).toBe("2/4");
  });

  it("allows ancestor consumption and rejects unrelated derivation and binding", async () => {
    const { h, errors, failures } = await harness();
    const parent = document.createElement("div");
    const signalReady = Deferred.makeUnsafe<WritableSignal<string>>();
    h(
      parent,
      component(() =>
        Result.succeed({
          setup: (ctx) =>
            Effect.gen(function* () {
              const label = yield* ctx.signal({ initial: "ancestor" });
              yield* Deferred.succeed(signalReady, label);
              const Child = component(() =>
                Result.succeed({
                  setup: (child) =>
                    Effect.gen(function* () {
                      const derived = yield* child.derive({
                        sources: { label },
                        compute: ({ label }) => label.toUpperCase(),
                      });
                      return yield* child.he("p", { children: [derived] });
                    }),
                }),
              );
              return yield* ctx.he("main", { children: [Child] });
            }),
        }),
      ),
    );
    const label = await run(Deferred.await(signalReady));
    await rendered({ parent, check: () => parent.textContent === "ANCESTOR" });
    await run(label.set("updated"));
    expect(parent.textContent).toBe("UPDATED");
    const unrelated = document.createElement("div");
    h(
      unrelated,
      component(() => Result.succeed({ setup: (ctx) => ctx.he("p", { children: [label] }) })),
    );
    await run(Deferred.await(errors));
    expect(unrelated.textContent).toBe("");
    expect(failures).toHaveLength(1);
    const other = await mounted();
    expect(
      Exit.isFailure(
        await run(
          other.ctx.derive({ sources: { label }, compute: ({ label }) => label }).pipe(Effect.exit),
        ),
      ),
    ).toBe(true);
  });

  it("interrupts active batches before asynchronous finalizers and rejects retained handles", async () => {
    const { h, close } = await harness();
    const parent = document.createElement("div");
    const ready = Deferred.makeUnsafe<{
      context: ComponentContext;
      signal: WritableSignal<string>;
    }>();
    const cleaning = Deferred.makeUnsafe<void>();
    const releaseCleanup = Deferred.makeUnsafe<void>();
    h(
      parent,
      component(() =>
        Result.succeed({
          setup: (context) =>
            Effect.gen(function* () {
              const signal = yield* context.signal({ initial: "old" });
              yield* Effect.addFinalizer(() =>
                Deferred.succeed(cleaning, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseCleanup)),
                ),
              );
              yield* Deferred.succeed(ready, { context, signal });
              return yield* context.he("p", { children: [signal] });
            }),
        }),
      ),
    );
    const { context, signal } = await run(Deferred.await(ready));
    await rendered({ parent, check: () => parent.textContent === "old" });
    const staged = Deferred.makeUnsafe<void>();
    const batch = Effect.runFork(
      context.batch(
        signal
          .set("new")
          .pipe(Effect.andThen(Deferred.succeed(staged, undefined)), Effect.andThen(Effect.never)),
      ),
    );
    await run(Deferred.await(staged));
    const closing = close();
    await run(Deferred.await(cleaning));
    expect(parent.textContent).toBe("");
    expect(Exit.isFailure(await run(Fiber.await(batch)))).toBe(true);
    expect(Exit.isFailure(await run(signal.set("late").pipe(Effect.exit)))).toBe(true);
    await run(Deferred.succeed(releaseCleanup, undefined));
    await closing;
    expect(parent.textContent).toBe("");
  });

  it("reports a DOM reducer failure once and handles the next click", async () => {
    const { h, errors, failures } = await harness();
    const parent = document.createElement("div");
    const ready = Deferred.makeUnsafe<{ button: HTMLButtonElement; count: Signal<number> }>();
    let first = true;
    h(
      parent,
      component(() =>
        Result.succeed({
          setup: (ctx) =>
            Effect.gen(function* () {
              const button = yield* ctx.he("button", { children: ["Click"] });
              const clicks = yield* ctx.events(button, "click");
              const count = yield* ctx.fold({
                events: clicks,
                initial: 0,
                reducer: ({ state: n }) => {
                  const previous = first;
                  first = false;
                  expect(previous).toBe(false);
                  return n + 1;
                },
              });
              const label = yield* ctx.derive({
                sources: { count },
                compute: ({ count }) => String(count),
              });
              yield* Deferred.succeed(ready, { button, count });
              return yield* ctx.he("p", { children: [label, button] });
            }),
        }),
      ),
    );
    const { button, count } = await run(Deferred.await(ready));
    await rendered({ parent, check: () => parent.textContent === "0Click" });
    button.click();
    await run(Deferred.await(errors));
    expect(await run(count.get)).toBe(0);
    button.click();
    await rendered({ parent, check: () => parent.textContent === "1Click" });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.operation).toBe("reactive");
    expect(failures[0]?.subject.kind).toBe("component");
  });
});
