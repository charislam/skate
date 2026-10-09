import { Deferred, Effect, Exit } from "effect";
import { expect, it } from "vitest";
import { component, focus, type WritableSignal } from "./framework";
import * as Sync from "./sync";
import { harness, rendered } from "./test-helpers";

it("owns a focused projection in its explicit context while its ancestor source stays live", async () => {
  const test = await harness();
  const source = await Effect.runPromise(test.ctx.signal({ initial: { count: 0 } }));
  const ready = Deferred.makeUnsafe<WritableSignal<number>>();
  Effect.runSync(
    test.ctx.h(
      test.target,
      component((context) =>
        Sync.gen(function* () {
          const count = yield* focus({ context, source, key: "count" });
          Deferred.doneUnsafe(ready, Effect.succeed(count));
          return { setup: (context) => context.he("output", { children: ["child"] }) };
        }),
      ),
    ),
  );
  const count = await Effect.runPromise(Deferred.await(ready));
  await rendered({ parent: test.parent, check: () => test.target.textContent === "child" });
  await Effect.runPromise(count.set(2));
  expect(await Effect.runPromise(source.get)).toEqual({ count: 2 });
  Effect.runSync(test.ctx.h(test.target, []));
  await rendered({ parent: test.parent, check: () => test.target.textContent === "" });
  expect(Exit.isFailure(await Effect.runPromise(count.get.pipe(Effect.exit)))).toBe(true);
  expect(Exit.isFailure(await Effect.runPromise(count.set(99).pipe(Effect.exit)))).toBe(true);
  await Effect.runPromise(source.set({ count: 3 }));
  expect(await Effect.runPromise(source.get)).toEqual({ count: 3 });
});

it("rejects allocating projections from unrelated or ancestor contexts", async () => {
  const test = await harness();
  const other = await harness();
  const source = await Effect.runPromise(test.ctx.signal({ initial: { count: 0 } }));
  const foreign = await Effect.runPromise(
    Sync.toEffect(focus({ context: other.ctx, source, key: "count" })).pipe(Effect.exit),
  );
  expect(Exit.isFailure(foreign)).toBe(true);
  const ready = Deferred.makeUnsafe<WritableSignal<{ count: number }>>();
  Effect.runSync(
    test.ctx.h(
      test.target,
      component((context) =>
        Sync.gen(function* () {
          const childSource = yield* context.signal({ initial: { count: 1 } });
          Deferred.doneUnsafe(ready, Effect.succeed(childSource));
          return { setup: (context) => context.he("output", { children: ["child"] }) };
        }),
      ),
    ),
  );
  const childSource = await Effect.runPromise(Deferred.await(ready));
  const ancestor = await Effect.runPromise(
    Sync.toEffect(focus({ context: test.ctx, source: childSource, key: "count" })).pipe(
      Effect.exit,
    ),
  );
  expect(Exit.isFailure(ancestor)).toBe(true);
  expect(await Effect.runPromise(source.get)).toEqual({ count: 0 });
});
