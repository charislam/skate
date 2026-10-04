import { Effect, Option, Scope } from "effect";
import { expect, it } from "vitest";
import { checkStructure, construct, ConstructionError, inspect, reserve } from "./construction";
import { makeReactiveRuntime, reactive, stopReactiveRuntime } from "./reactive";

const owner = { active: true, ownsTarget: () => false, reactiveRuntime: Option.none() };

const makeRuntime = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const lifetime = { active: true };
  const runtime = yield* makeReactiveRuntime({
    active: () => lifetime.active,
    parent: Option.none(),
    fork: (work) => Effect.forkIn(work.pipe(Scope.provide(scope)), scope).pipe(Effect.asVoid),
    report: () => Effect.void,
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      lifetime.active = false;
      stopReactiveRuntime(runtime);
    }),
  );
  return runtime;
});

it("constructs fresh text nodes from string signals when a reactive runtime exists", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* makeRuntime;
        const text = yield* reactive(runtime).signal({ initial: "<strong>count: 0</strong>" });
        const context = { ...owner, reactiveRuntime: Option.some(runtime) };
        const pending = construct(context)("p", { children: ["Before ", text, " after"] });
        const first = yield* pending;
        expect(first.childNodes).toHaveLength(3);
        expect(first.childNodes[1]).toBeInstanceOf(Text);
        expect(first.childNodes[1]?.textContent).toBe("<strong>count: 0</strong>");
        expect(first.textContent).toBe("Before <strong>count: 0</strong> after");
        expect(first.children).toHaveLength(0);
        yield* inspect({ roots: [first], owner: context });

        yield* text.set("count: 1");
        const second = yield* pending;
        expect(second.childNodes[1]).not.toBe(first.childNodes[1]);
        expect(second.textContent).toBe("Before count: 1 after");
        // Construction reads the signal but does not bind an unadopted tree.
        expect(first.textContent).toBe("Before <strong>count: 0</strong> after");
      }),
    ),
  );
});

it("fails string signal construction through the error channel without a reactive runtime", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* makeRuntime;
        const text = yield* reactive(runtime).signal({ initial: "count: 0" });
        const construction = construct(owner)("p", { children: [text] });
        const error = yield* construction.pipe(Effect.flip);
        expect(error).toBeInstanceOf(ConstructionError);
        expect(error.message).toBe("Reactive text requires a component owner");
        expect(yield* text.get).toBe("count: 0");
      }),
    ),
  );
});

it("returns validation failures through the Effect error channel without moving nodes", async () => {
  const node = document.createTextNode("duplicate");
  const error = await Effect.runPromise(inspect({ roots: [node, node], owner }).pipe(Effect.flip));
  expect(error).toBeInstanceOf(ConstructionError);
  expect(error.message).toContain("duplicate");
  expect(node.parentNode).toBeNull();
});

it("permits revalidation only for the request that reserved a tree", async () => {
  const root = document.createElement("main");
  const tree = await Effect.runPromise(inspect({ roots: [root], owner }));

  const reservation = {};
  reserve(tree, reservation);

  await Effect.runPromise(inspect({ roots: [root], owner, reservation }));

  const error = await Effect.runPromise(
    inspect({ roots: [root], owner, reservation: {} }).pipe(Effect.flip),
  );

  expect(error).toBeInstanceOf(ConstructionError);
  expect(error.message).toContain("reserved");

  root.append(document.createTextNode("changed"));
  const mutation = await Effect.runPromise(checkStructure(tree).pipe(Effect.flip));

  expect(mutation).toBeInstanceOf(ConstructionError);
  expect(mutation.message).toContain("structure changed");
});

it("keeps construction lazy and creates fresh elements on each evaluation", async () => {
  const he = construct(owner);

  const child = document.createTextNode("child");
  const tree = he("main", { children: [child] });

  expect(child.parentNode).toBeNull();

  const main = await Effect.runPromise(tree);

  expect(main.firstChild).toBe(child);

  const input = he("input", { props: { value: "current" } });

  const first = await Effect.runPromise(input);
  const second = await Effect.runPromise(input);

  expect(first).not.toBe(second);
  expect(first.value).toBe("current");
  expect(second.parentNode).toBeNull();
});

it("fails effects evaluated after disposal, including those created before disposal", async () => {
  const context = { active: true, ownsTarget: () => false, reactiveRuntime: Option.none() };
  const he = construct(context);

  const pending = he("div");
  context.active = false;

  for (const construction of [pending, he("div")]) {
    const error = await Effect.runPromise(construction.pipe(Effect.flip));

    expect(error).toBeInstanceOf(ConstructionError);
    expect(error.message).toContain("disposed");
  }
});
