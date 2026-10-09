import { Effect, Exit, Result, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { browserHistory } from "./browser-history";

describe("browser history resource", () => {
  it("acquires a gap-free snapshot, writes without synthetic traversal, reports failures and cleans up", async () => {
    window.history.replaceState(null, "", "/initial");
    const scope = await Effect.runPromise(Scope.make());
    const adapter = await Effect.runPromise(
      browserHistory(window).pipe(Effect.provideService(Scope.Scope, scope)),
    );
    const observed: string[] = [];
    const observation = adapter.observe((url) => observed.push(url));
    expect(observation.initial).toBe("/initial");
    Result.getOrThrow(adapter.push("/next?x=1#part"));
    expect(window.location.pathname).toBe("/next");
    expect(observed).toEqual([]);
    Result.getOrThrow(adapter.replace("/replacement"));
    expect(observed).toEqual([]);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(observed).toEqual(["/replacement"]);
    expect(Result.isFailure(adapter.push("https://other.example/"))).toBe(true);
    const push = window.history.pushState;
    window.history.pushState = () => {
      throw new Error("Browser refused write");
    };
    expect(Result.isFailure(adapter.push("/denied"))).toBe(true);
    window.history.pushState = push;
    observation.dispose();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(observed).toHaveLength(1);
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(Result.isFailure(adapter.replace("/disposed"))).toBe(true);
  });
  it("rejects competing controllers in a document and releases acquisition ownership on disposal", async () => {
    const first = await Effect.runPromise(Scope.make());
    const second = await Effect.runPromise(Scope.make());
    await Effect.runPromise(browserHistory(window).pipe(Effect.provideService(Scope.Scope, first)));
    expect(
      Exit.isFailure(
        await Effect.runPromise(
          browserHistory(window).pipe(Effect.provideService(Scope.Scope, second), Effect.exit),
        ),
      ),
    ).toBe(true);
    await Effect.runPromise(Scope.close(first, Exit.void));
    await Effect.runPromise(
      browserHistory(window).pipe(Effect.provideService(Scope.Scope, second)),
    );
    await Effect.runPromise(Scope.close(second, Exit.void));
  });
});
