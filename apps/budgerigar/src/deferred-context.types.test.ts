import { Context, Effect, Result, Scope } from "effect";
import { expectTypeOf, it } from "vitest";
import { capturedWork } from "./deferred-context";
import type { Structural } from "./requirements";
import { toEffect, withContext, type Sync } from "./sync";

class Label extends Context.Service<Label, string>()("Budgerigar/capture/Label") {}
class OtherLabel extends Context.Service<OtherLabel, string>()("Budgerigar/capture/OtherLabel") {}

it("requires captured contexts to supply every service used by deferred work", () => {
  const proof = () => {
    const label = Context.make(Label, "registered");
    const other = Context.make(OtherLabel, "other");
    const both = Context.merge(label, other);
    const work = Effect.gen(function* () {
      yield* Scope.Scope;
      return `${yield* Label}:${yield* OtherLabel}`;
    });
    expectTypeOf(capturedWork({ work, context: both })).toEqualTypeOf<
      Effect.Effect<string, never, Scope.Scope>
    >();
    // @ts-expect-error Empty context cannot supply Label.
    capturedWork({ work: Label, context: Context.empty() });
    // @ts-expect-error Matching value shapes do not make distinct service identifiers interchangeable.
    capturedWork({ work: Label, context: other });
    // @ts-expect-error Partially supplied requirements remain missing.
    capturedWork({ work, context: label });
    const erased: Context.Context<never> = both;
    // @ts-expect-error Erased storage cannot prove the required service exists.
    capturedWork({ work: Label, context: erased });
    // @ts-expect-error A closed type argument cannot hide the work's requirement.
    capturedWork<string, never, never>({ work: Label, context: Context.empty() });
    expectTypeOf(capturedWork({ work: Scope.Scope, context: Context.empty() })).toEqualTypeOf<
      Effect.Effect<Scope.Scope, never, Scope.Scope>
    >();
    expectTypeOf(
      capturedWork({
        work: Label.pipe(Effect.andThen(Effect.fail("expected" as const))),
        context: label,
      }),
    ).toEqualTypeOf<Effect.Effect<never, "expected", Scope.Scope>>();
  };
  void proof;
});

it("retains structural requirements and types the synchronous capture boundary", () => {
  const proof = (options: {
    context: Context.Context<Structural<Label>>;
    work: Effect.Effect<void, never, Scope.Scope | Structural<Label>>;
  }) => {
    expectTypeOf(capturedWork(options)).toEqualTypeOf<Effect.Effect<void, never, Scope.Scope>>();
    // @ts-expect-error Providing the user service does not discharge structural requirements.
    capturedWork({ work: options.work, context: Context.make(Label, "local") });
    const registration = withContext((context: Context.Context<Label>) =>
      Result.succeed(capturedWork({ work: Label, context })),
    );
    expectTypeOf(registration).toEqualTypeOf<
      Sync<Effect.Effect<string, never, Scope.Scope>, never, Label>
    >();
    // @ts-expect-error Synchronous context capture propagates its requirement to the interpreter bridge.
    Effect.runSync(toEffect(registration));
  };
  void proof;
});
