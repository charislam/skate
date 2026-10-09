import { Cause, Context, Effect, Exit, Result } from "effect";
import { expect, expectTypeOf, it } from "vitest";
import { Sync } from "./framework";
import { toEffect } from "./sync";

class Name extends Context.Service<Name, string>()("frappe/test/Name") {}
class OtherName extends Context.Service<OtherName, string>()("frappe/test/OtherName") {}

it("constructs inert computations and evaluates them anew on each execution", () => {
  let calls = 0;
  const computation = Sync.gen(function* () {
    const value = yield* Sync.sync(() => ++calls);
    return yield* Sync.succeed(value).pipe(Sync.map((value) => value * 2));
  });
  expect(calls).toBe(0);
  expect(Effect.runSync(toEffect(computation))).toBe(2);
  expect(Effect.runSync(toEffect(computation))).toBe(4);
});

it("composes expected errors without evaluating subsequent work", () => {
  let called = false;
  const computation = Sync.gen(function* () {
    yield* Sync.fromResult(Result.fail("expected"));
    return yield* Sync.sync(() => {
      called = true;
      return 1;
    });
  });
  expect(Effect.runSync(toEffect(computation).pipe(Effect.result))).toEqual(
    Result.fail("expected"),
  );
  expect(called).toBe(false);
});

it("reads ordinary tokens and keeps local overrides scoped to their computation", () => {
  const computation = Sync.gen(function* () {
    const outer = yield* Sync.service(Name);
    const inner = yield* Sync.service(Name).pipe(Sync.provideService(Name, "inner"));
    const restored = yield* Sync.service(Name);
    return [outer, inner, restored];
  }).pipe(Sync.provideService(Name, "outer"));
  expect(Effect.runSync(toEffect(computation))).toEqual(["outer", "inner", "outer"]);
});

it("lifts Results explicitly and suspends adapter evaluation when requested", () => {
  let calls = 0;
  const computation = Sync.suspend(() => Sync.fromResult(Result.succeed(++calls))).pipe(
    Sync.flatMap((value) => Sync.succeed(value + 1)),
  );
  expect(calls).toBe(0);
  expect(Effect.runSync(toEffect(computation))).toBe(2);
});

it("reports exceptions and absent services as defects", () => {
  const thrown = new Error("broken callback");
  const exit = Effect.runSyncExit(
    toEffect(
      Sync.sync(() => {
        throw thrown;
      }),
    ),
  );
  expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  const missing = Effect.runSyncExit(
    toEffect(Sync.service(Name)).pipe(Effect.provide(Context.empty() as Context.Context<Name>)),
  );
  expect(Exit.isFailure(missing) && Cause.hasDies(missing.cause)).toBe(true);
});

it("rejects foreign yields and returns from unsafe callers at runtime", () => {
  const foreign = [Effect.succeed(1), Promise.resolve(1), Result.succeed(1), Name];
  for (const value of foreign) {
    const computation = Sync.gen(function* () {
      yield* value as unknown as Sync.Sync<number>;
      return 1;
    });
    const exit = Effect.runSyncExit(toEffect(computation));
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  }
  const callback = (() => Promise.resolve(1)) as unknown as () => number;
  expect(Exit.isFailure(Effect.runSyncExit(toEffect(Sync.sync(callback))))).toBe(true);
  const returned = Sync.gen(function* () {
    yield* Sync.succeed(undefined);
    return callback();
  });
  expect(Exit.isFailure(Effect.runSyncExit(toEffect(returned)))).toBe(true);
});

it("infers errors and requirements and rejects foreign computations statically", () => {
  const computation = Sync.gen(function* () {
    const name = yield* Sync.service(Name);
    yield* Sync.fromResult(Result.succeed(1) as Result.Result<number, "failure">);
    return name;
  });
  expectTypeOf(computation).toEqualTypeOf<Sync.Sync<string, "failure", Name>>();
  expectTypeOf(computation.pipe(Sync.provideService(Name, "supplied"))).toEqualTypeOf<
    Sync.Sync<string, "failure">
  >();
  expectTypeOf(computation.pipe(Sync.provideService(OtherName, "other"))).toEqualTypeOf<
    Sync.Sync<string, "failure", Name>
  >();
  const invalid = () => {
    // @ts-expect-error Token value inference cannot widen to accept a number.
    Sync.service(Name).pipe(Sync.provideService(Name, 1));
    // @ts-expect-error Direct token yields are Effects.
    Sync.gen(function* () {
      return yield* Name;
    });
    // @ts-expect-error Effects are not synchronous computations.
    Sync.gen(function* () {
      return yield* Effect.succeed(1);
    });
    // @ts-expect-error Results require the explicit adapter.
    Sync.gen(function* () {
      return yield* Result.succeed(1);
    });
    // @ts-expect-error Promise callbacks cannot be lifted as synchronous values.
    Sync.sync(() => Promise.resolve(1));
    // @ts-expect-error Effect callbacks cannot be lifted as synchronous values.
    Sync.sync(() => Effect.succeed(1));
    // @ts-expect-error Promise returns are not synchronous generator bodies.
    Sync.gen(function* () {
      yield* Sync.succeed(undefined);
      return Promise.resolve(1);
    });
    // @ts-expect-error Effect returns are not synchronous generator bodies.
    Sync.gen(function* () {
      yield* Sync.succeed(undefined);
      return Effect.succeed(1);
    });
    // @ts-expect-error Requirements cannot widen to a closed computation.
    const closed: Sync.Sync<string> = Sync.service(Name);
    void closed;
  };
  void invalid;
});
