import { Context, Deferred, Effect, Exit, Layer, Scope } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  component,
  mounting,
  Resource,
  type ApplicationContext,
  type ComponentContext,
  type SynchronousContext,
} from "./framework";
import { ownerRuntime } from "./reactive/owner";
import { ReactiveError } from "./reactive/runtime";
import * as Sync from "./sync";
import { harness } from "./test-helpers";

const operations = [
  "addFinalizer",
  "addSyncFinalizer",
  "batch",
  "bind",
  "bindValue",
  "combine",
  "derive",
  "events",
  "fold",
  "foldStream",
  "fork",
  "h",
  "he",
  "importNative",
  "read",
  "readCommitted",
  "signal",
  "source",
  "subscribe",
  "subscribeStream",
  "toStream",
  "watchSync",
].sort();

class Probe extends Resource.Service<Probe, string>()("Budgerigar/owner-context/Probe") {}

class Label extends Context.Service<Label, string>()("Budgerigar/owner-context/Label") {}

const constructionContext = async () => {
  const h = await harness();
  const ready = Deferred.makeUnsafe<SynchronousContext>();
  Effect.runSync(
    h.ctx.h(
      h.target,
      component((context) =>
        Sync.sync(() => {
          Deferred.doneUnsafe(ready, Effect.succeed(context));
          return { setup: () => Effect.succeed([]) };
        }),
      ),
    ),
  );
  return { ...h, construction: await Effect.runPromise(Deferred.await(ready)) };
};

describe("component-facing owner contexts", () => {
  it("exposes only operations on construction, setup, and application contexts", async () => {
    const h = await constructionContext();
    for (const context of [h.ctx, h.construction]) {
      expect(Reflect.ownKeys(context).sort()).toEqual(operations);
      expect(ownerRuntime(context)).toBeDefined();
      expect(() => ownerRuntime({ ...context })).toThrow("original framework context");
    }
    const scope = await Effect.runPromise(Scope.make());
    try {
      const application = Effect.runSync(mounting({ scope, onError: () => {} }));
      expect(Reflect.ownKeys(application).sort()).toEqual(operations);
      expect(ownerRuntime(application)).toBeDefined();
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("captures cleanup dependencies, supplies the owner scope, and rejects retired registration", async () => {
    const { ctx, construction, close } = await constructionContext();
    const cleanups: string[] = [];
    const register = (label: string) =>
      Effect.gen(function* () {
        expect(yield* Scope.Scope).toBeDefined();
        cleanups.push(`${label}:${yield* Label}`);
      });
    await Effect.runPromise(
      ctx.addFinalizer(register("setup")).pipe(Effect.provideService(Label, "setup environment")),
    );
    await Effect.runPromise(
      Sync.toEffect(construction.addFinalizer(register("construction"))).pipe(
        Effect.provideService(Label, "factory environment"),
      ),
    );
    expect(cleanups).toEqual([]);
    await close();
    expect(cleanups).toEqual(["construction:factory environment", "setup:setup environment"]);
    expect(await Effect.runPromise(ctx.addFinalizer(Effect.void).pipe(Effect.flip))).toBeInstanceOf(
      ReactiveError,
    );
    expect(
      await Effect.runPromise(
        Sync.toEffect(construction.addFinalizer(Effect.void)).pipe(Effect.flip),
      ),
    ).toBeInstanceOf(ReactiveError);
  });

  it("supplies application resources to cleanup before releasing them", async () => {
    const scope = await Effect.runPromise(Scope.make());
    const events: string[] = [];
    const resources = Layer.effect(
      Probe,
      Effect.acquireRelease(Effect.succeed("resource"), () =>
        Effect.sync(() => {
          events.push("released");
        }),
      ),
    );
    const application = await Effect.runPromise(mounting({ scope, resources, onError: () => {} }));
    await Effect.runPromise(
      application.addFinalizer(
        Probe.pipe(
          Effect.flatMap((value) =>
            Effect.sync(() => {
              events.push(value);
            }),
          ),
        ),
      ),
    );
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(events).toEqual(["resource", "released"]);
  });

  it("preserves required cleanup services and removes only owner-supplied Scope", () => {
    const proof = (options: {
      setup: ComponentContext;
      construction: SynchronousContext;
      application: ApplicationContext<Probe>;
    }) => {
      const cleanup = Effect.gen(function* () {
        yield* Scope.Scope;
        yield* Label;
      });
      expectTypeOf(options.setup.addFinalizer(cleanup)).toEqualTypeOf<
        Effect.Effect<void, ReactiveError, Label>
      >();
      expectTypeOf(options.construction.addFinalizer(cleanup)).toEqualTypeOf<
        Sync.Sync<void, ReactiveError, Label>
      >();
      expectTypeOf(options.application.addFinalizer(Probe)).toEqualTypeOf<
        Effect.Effect<void, ReactiveError>
      >();
      expectTypeOf(options.application.addFinalizer(Label)).toEqualTypeOf<
        Effect.Effect<void, ReactiveError, Label>
      >();
      // @ts-expect-error Component contexts do not expose scope authority.
      void options.setup.scope;
      // @ts-expect-error Construction contexts do not expose scope authority.
      void options.construction.scope;
      // @ts-expect-error Missing registration-time service cannot be erased.
      Effect.runSync(options.setup.addFinalizer(cleanup));
      // @ts-expect-error Synchronous registration retains the service requirement.
      Effect.runSync(Sync.toEffect(options.construction.addFinalizer(cleanup)));
    };
    void proof;
  });
});
