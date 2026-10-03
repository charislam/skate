import { Effect } from "effect";
import { expect, it } from "vitest";
import { checkStructure, construct, ConstructionError, inspect, reserve } from "./construction";

const owner = { active: true, ownsTarget: () => false };

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
  const context = { active: true, ownsTarget: () => false };
  const he = construct(context);

  const pending = he("div");
  context.active = false;

  for (const construction of [pending, he("div")]) {
    const error = await Effect.runPromise(construction.pipe(Effect.flip));

    expect(error).toBeInstanceOf(ConstructionError);
    expect(error.message).toContain("disposed");
  }
});
