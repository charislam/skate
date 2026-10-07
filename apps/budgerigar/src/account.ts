import { Context, Effect, Option } from "effect";
import { component, provideContext, readonlySignal, Sync, type Signal } from "./framework";

interface User {
  readonly email: string;
}

export class CurrentUser extends Context.Service<CurrentUser, Signal<Option.Option<User>>>()(
  "Budgerigar/CurrentUser",
) {}

export const Account = component(() =>
  Sync.succeed({
    setup: ({ derive, he }) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const email = yield* derive({
          sources: { user },
          compute: ({ user }) =>
            Option.match(user, {
              onNone: () => "Not signed in",
              onSome: ({ email }) => email,
            }),
        });
        return yield* he("p", { children: [email] });
      }),
  }),
);

/** Element construction preserves the requirements of nested descriptions. */
export const Settings = component(() =>
  Sync.succeed({ setup: ({ he }) => he("section", { children: [Account] }) }),
);

export const AccountExample = component(({ signal }) =>
  Sync.gen(function* () {
    const user = yield* signal<Option.Option<User>>({ initial: Option.none() });
    return {
      setup: ({ he, events, subscribe }) =>
        Effect.gen(function* () {
          const signIn = yield* he("button", { children: ["Sign in"] });
          const signOut = yield* he("button", { children: ["Sign out"] });
          yield* subscribe(yield* events(signIn, "click"), () =>
            user.set(Option.some({ email: "reader@example.com" })),
          );
          yield* subscribe(yield* events(signOut, "click"), () => user.set(Option.none()));
          return yield* he("section", {
            attrs: { class: Option.some("account-example") },
            children: [
              yield* he("h2", { children: ["Ancestor-provided account"] }),
              signIn,
              signOut,
              provideContext({ key: CurrentUser, value: readonlySignal(user), child: Settings }),
            ],
          });
        }),
    };
  }),
);
