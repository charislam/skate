import { Effect } from "effect";
import { expect, it } from "vitest";
import { component, isComponent } from "./component";
import { Sync } from "./framework";

it("recognizes branded components and rejects objects with only a setup method", () => {
  const definition = () => Sync.succeed({ setup: () => Effect.succeed([]) });
  const created = component(definition);
  expect(isComponent(created)).toBe(true);
  expect(created.factory).toBe(definition);
  expect(isComponent(definition)).toBe(false);
  expect(isComponent(null)).toBe(false);
  expect(isComponent(undefined)).toBe(false);
  expect(isComponent({})).toBe(false);
});
