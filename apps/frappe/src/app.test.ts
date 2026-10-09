import { Effect, Exit, Layer, Result, Scope } from "effect";
import { expect, it } from "vitest";
import { App } from "./app";
import { AuthLive } from "./auth";
import { mounting } from "./framework";
import { History, memoryHistory } from "./history";
import { LocalStorageMemory } from "./local-storage";
import { mockResources } from "./routing-demo/resources";
import { rendered } from "./test-helpers";

it("routes between the home, examples, and routing pages and traverses browser history", async () => {
  const scope = await Effect.runPromise(Scope.make());
  try {
    const history = await Effect.runPromise(
      memoryHistory({ initial: "/" }).pipe(Effect.provideService(Scope.Scope, scope)),
    );
    const failures: unknown[] = [];
    const app = await Effect.runPromise(
      mounting({
        scope,
        resources: Layer.mergeAll(
          Layer.succeed(History, history),
          AuthLive,
          LocalStorageMemory,
          mockResources,
        ),
        onError: (failure) => {
          failures.push(failure);
        },
      }),
    );
    const parent = document.createElement("div");
    Effect.runSync(app.h(parent, App));
    const shows = (check: () => boolean) => rendered({ parent, check });
    const press = (label: string) => {
      const node = [
        ...parent.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main navigation"] a'),
      ].find((node) => node.textContent === label);
      expect(node).toBeDefined();
      node?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    };
    await shows(() => parent.querySelector("main h1")?.textContent === "frappé");
    expect(parent.querySelector(".counter")).toBeNull();
    expect(parent.querySelector(".routing-page")).toBeNull();
    press("Examples");
    await shows(() => parent.querySelector(".todos") !== null);
    expect(history.location()).toBe("/examples");
    expect(parent.querySelector(".routing-page")).toBeNull();
    press("Routing");
    await shows(() => parent.querySelector(".routing-controls") !== null);
    expect(history.location()).toBe("/routing");
    expect(parent.querySelector(".counter")).toBeNull();
    expect(parent.querySelectorAll(".routing-controls section")).toHaveLength(3);
    expect(parent.querySelector<HTMLElement>(".routing-controls")?.hidden).toBe(true);
    expect(parent.querySelector(".routing-heading button")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(parent.querySelector(".routing-content nav")).not.toBeNull();
    Result.getOrThrow(history.traverse(-1));
    await shows(() => parent.querySelector(".todos") !== null);
    Result.getOrThrow(history.traverse(1));
    await shows(() => parent.querySelector(".routing-controls") !== null);
    expect(failures).toEqual([]);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
});
