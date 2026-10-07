import {
  Context as EffectContext,
  Effect,
  Layer,
  Option,
  Ref,
  SubscriptionRef,
  type Stream,
} from "effect";
import { AuthError, type Credentials, type User } from "./auth-model";
import { Resource } from "./framework";

export class Auth extends Resource.Service<
  Auth,
  {
    readonly signIn: (credentials: Credentials) => Effect.Effect<void, AuthError>;
    readonly logout: () => Effect.Effect<void, AuthError>;
    readonly sessions: Stream.Stream<Option.Option<User>>;
  }
>()("Budgerigar/Auth") {}

/** A self-contained adapter: session discovery finishes during layer acquisition. */
export const AuthLive = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const session = yield* SubscriptionRef.make<Option.Option<User>>(Option.none());
    return Auth.of({
      signIn: Effect.fn("Auth.signIn")(function* (credentials: Credentials) {
        yield* SubscriptionRef.set(session, Option.some({ email: credentials.email }));
      }),
      logout: Effect.fn("Auth.logout")(function* () {
        yield* SubscriptionRef.set(session, Option.none());
      }),
      sessions: SubscriptionRef.changes(session),
    });
  }),
);

export class AuthControl extends Resource.Service<
  AuthControl,
  {
    readonly publish: (user: Option.Option<User>) => Effect.Effect<void>;
    readonly failNextLogout: (error: AuthError) => Effect.Effect<void>;
  }
>()("Budgerigar/AuthControl") {}

/** Allocate a fresh replaying session and controls for every runtime acquisition. */
export const authMock = (options: { readonly initial: Option.Option<User> }) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const session = yield* SubscriptionRef.make(options.initial);
      const failure = yield* Ref.make<Option.Option<AuthError>>(Option.none());
      const auth = Auth.of({
        sessions: SubscriptionRef.changes(session),
        signIn: Effect.fn("AuthMock.signIn")(function* (credentials: Credentials) {
          yield* SubscriptionRef.set(session, Option.some({ email: credentials.email }));
        }),
        logout: Effect.fn("AuthMock.logout")(function* () {
          const next = yield* Ref.getAndSet(failure, Option.none());
          yield* Option.match(next, {
            onNone: () => SubscriptionRef.set(session, Option.none()),
            onSome: Effect.fail,
          });
        }),
      });
      const controls = AuthControl.of({
        publish: (user) => SubscriptionRef.set(session, user),
        failNextLogout: (error) => Ref.set(failure, Option.some(error)),
      });
      return Auth.context(auth).pipe(EffectContext.add(AuthControl, controls));
    }),
  );
