import { Context, Effect, type Scope } from "effect";
import { expectTypeOf, it } from "vitest";
import { Sync } from "./framework";
import type { Normalize, Structural } from "./requirements";

class User extends Context.Service<User, string>()("frappe/type/User") {}
class Settings extends Context.Service<Settings, string>()("frappe/type/Settings") {}

/** Type-only prototypes: structural markers never perform runtime context reads. */
declare const mountEffect: <R>() => Effect.Effect<void, never, Structural<R>>;
declare const mountSync: <R>() => Sync.Sync<void, never, Structural<R>>;
declare const registerEffect: <A, E, R>(
  work: Effect.Effect<A, E, R>,
) => Effect.Effect<void, never, Exclude<R, Scope.Scope>>;
declare const registerSync: <A, E, R>(
  work: Sync.Sync<A, E, R>,
) => Sync.Sync<void, never, Exclude<R, Scope.Scope>>;

type Requirements<T> = T extends
  | Effect.Effect<unknown, unknown, infer R>
  | Sync.Sync<unknown, unknown, infer R>
  ? Normalize<R>
  : never;

it("preserves structural requirements through ordinary Effect and Sync provision", () => {
  const proof = () => {
    const localEffect = Effect.gen(function* () {
      yield* User;
      yield* mountEffect<User>();
    }).pipe(Effect.provideService(User, "local"));
    expectTypeOf(localEffect).toEqualTypeOf<Effect.Effect<void, never, Structural<User>>>();
    expectTypeOf<Requirements<typeof localEffect>>().toEqualTypeOf<User>();

    const localSync = Sync.gen(function* () {
      yield* Sync.service(User);
      yield* mountSync<User>();
    }).pipe(Sync.provideService(User, "local"));
    expectTypeOf(localSync).toEqualTypeOf<Sync.Sync<void, never, Structural<User>>>();
    expectTypeOf<Requirements<typeof localSync>>().toEqualTypeOf<User>();

    const ordinaryEffect = Effect.gen(function* () {
      return yield* User;
    }).pipe(Effect.provideService(User, "local"));
    expectTypeOf<Requirements<typeof ordinaryEffect>>().toEqualTypeOf<never>();
    const ordinarySync = Sync.service(User).pipe(Sync.provideService(User, "local"));
    expectTypeOf<Requirements<typeof ordinarySync>>().toEqualTypeOf<never>();
  };
  void proof;
});

it("keeps requirement unions through nested registration and helper composition", () => {
  const proof = () => {
    const effect = registerEffect(
      registerEffect(
        Effect.gen(function* () {
          yield* User;
          yield* mountEffect<Settings>();
        }),
      ),
    );
    expectTypeOf<Requirements<typeof effect>>().toEqualTypeOf<User | Settings>();
    const sync = registerSync(
      registerSync(
        Sync.gen(function* () {
          yield* Sync.service(User);
          yield* mountSync<Settings>();
        }),
      ),
    );
    expectTypeOf<Requirements<typeof sync>>().toEqualTypeOf<User | Settings>();

    // Framework Scope provision must not erase scope stored in deferred output.
    const owned = registerEffect(mountEffect<Scope.Scope>());
    expectTypeOf<Requirements<typeof owned>>().toEqualTypeOf<Scope.Scope>();
  };
  void proof;
});

it("normalizes structural unions distributively without conflating identifier types", () => {
  expectTypeOf<Normalize<User | Structural<Settings>>>().toEqualTypeOf<User | Settings>();
  expectTypeOf<Normalize<Structural<Structural<User> | Settings>>>().toEqualTypeOf<
    User | Settings
  >();
  expectTypeOf<Normalize<never>>().toEqualTypeOf<never>();
  expectTypeOf<Exclude<User | Settings, User>>().toEqualTypeOf<Settings>();
});
