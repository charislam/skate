import { Effect, Option } from "effect";
import { Auth } from "./auth";
import type { User } from "./auth-model";
import { Context, component, provideContext, readonlySignal, Sync, type Signal } from "./framework";
import { LocalStorage } from "./local-storage";

export class CurrentUser extends Context.Service<CurrentUser, Signal<Option.Option<User>>>()(
  "frappe/CurrentUser",
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

export const Settings = component(() =>
  Sync.succeed({ setup: ({ he }) => he("section", { children: [Account] }) }),
);

/** Reads Auth independently of Root; it can only read the ancestor user signal. */
export const Navigation = component(() =>
  Sync.succeed({
    setup: ({ he, derive, events, subscribe }) =>
      Effect.gen(function* () {
        const auth = yield* Auth;
        const user = yield* CurrentUser;
        const isSignedOut = yield* derive({
          sources: { user },
          compute: ({ user }) => Option.isNone(user),
        });
        const signOut = yield* he("button", {
          props: {
            disabled: isSignedOut,
          },
          children: ["Sign out"],
        });
        yield* subscribe(yield* events(signOut, "click"), () => auth.logout());
        return yield* he("nav", {
          attrs: {
            "aria-label": Option.some("Accounts example navigation"),
          },
          children: [Settings, signOut],
        });
      }),
  }),
);

/** Root owns UI state; Auth owns session state and its replaying stream. */
export const AccountExample = component(({ signal }) =>
  Sync.gen(function* () {
    const user = yield* signal<Option.Option<User>>({ initial: Option.none() });
    return {
      setup: ({ he, events, subscribe, subscribeStream, derive }) =>
        Effect.gen(function* () {
          const auth = yield* Auth;
          const storage = yield* LocalStorage;
          const isSignedIn = yield* derive({
            sources: { user },
            compute: ({ user }) => Option.isSome(user),
          });
          yield* subscribeStream(auth.sessions, (session) => user.set(session));
          const signIn = yield* he("button", {
            props: { disabled: isSignedIn },
            children: ["Sign in"],
          });
          yield* subscribe(yield* events(signIn, "click"), () =>
            Effect.gen(function* () {
              const email = Option.getOrElse(
                yield* storage.get("demo-email"),
                () => "reader@example.com",
              );
              yield* auth.signIn({ email });
              yield* storage.set({ key: "demo-email", value: email });
            }),
          );
          const NavigationWithUser = provideContext({
            key: CurrentUser,
            value: readonlySignal(user),
            child: Navigation,
          });
          return yield* he("section", {
            attrs: { class: Option.some("card account-example") },
            children: [
              yield* he("h2", { children: ["Runtime resources and ancestor context"] }),
              signIn,
              NavigationWithUser,
            ],
          });
        }),
    };
  }),
);
