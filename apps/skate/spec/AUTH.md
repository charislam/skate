# Skate authentication plan

## Goal and access rules

Add Supabase Auth to the FoldKit app in `apps/skate` and introduce an authenticated `/admin` page. Authentication is email and password for existing Supabase users; this app will not expose a sign-up flow.

| Route | Signed out | Signed in |
| --- | --- | --- |
| `/` (`Home`) | Public | Public |
| `/login` (`Login`) | Login page | Redirect to `/` (`Home`) |
| `/admin` (`Admin`) | Redirect to `/login` | Admin page |
| Unmatched path (`NotFound`) | Public not-found page | Public not-found page |

Use the FoldKit `examples/auth` app as the architecture precedent: root-owned `LoggedOut | LoggedIn` state, route subsets, Commands for auth side effects, and root-level route guards/redirects. Provide the Auth service through FoldKit's application-level `resources` Layer. The auth example simulates authentication; replace its simulated credential command with the `Auth` service described below.

## Supabase client and configuration

Put authentication behind an Effect service in `src/domain/auth.ts`. Only that service's layer should construct or call the Supabase client. Read the project URL and publishable key through Effect `Config` recipes in a Config-backed layer; do not read `import.meta.env`, `process.env`, or individual env keys in Auth operations, Commands, or UI code. The publishable key is expected in browser code; never place a `service_role` or secret key in this app.

```ts
// src/domain/auth.ts — illustrative layer shape
import { Config, Context, Effect, Layer, Redacted } from "effect";
import { createClient } from "@supabase/supabase-js";

export interface Interface {
  readonly getSession: Effect.Effect<Option.Option<Session>, AuthError>;
  readonly signInWithPassword: (credentials: Credentials) => Effect.Effect<Session, AuthError>;
  readonly signOut: Effect.Effect<void, AuthError>;
  readonly authStateChanges: Stream.Stream<AuthStateChange, AuthError>;
}

export class Service extends Context.Service<Service, Interface>()("skate/Auth") {}

export const layerConfig = Layer.effect(
  Service,
  Effect.gen(function* () {
    const url = yield* Config.string("VITE_SUPABASE_URL");
    const publishableKey = yield* Config.redacted("VITE_SUPABASE_PUBLISHABLE_KEY");
    const client = createClient(url, Redacted.value(publishableKey));
    return Service.of(makeAuthInterface(client));
  }),
);
```

The exported Auth interface is the only place Commands and other app modules should see auth operations; it must not expose the raw Supabase client. Use `ConfigProvider` to supply a browser-backed configuration provider, mapping Vite's public values to the names read by `Config` (for example, from `import.meta.env` once in a dedicated provider module). Provide that ConfigProvider to the Auth layer when composing the runtime `resources` Layer. This keeps Auth configuration reads in a Config layer and makes tests able to replace the provider with `ConfigProvider.fromUnknown(...)`.

The client library's default browser Auth configuration persists sessions in local storage and refreshes tokens. Use its session persistence rather than duplicating tokens in FoldKit storage. Add the package as a pinned workspace dependency and commit the lockfile update.

Document the two public Vite variables in `apps/skate/.env.example` (or the repo's existing env example convention if one is found during implementation). Configure local and deployed values separately; do not commit credentials beyond the public publishable key.

## Routes and state model

Add `Login` and `Admin` variants while preserving the existing route constructors and fallback behavior. Add typed route builders for `/login` and `/admin`; `Home` remains `Route.root` and `NotFound` remains the fallback.

```ts
export const AppRoute = defineRouteUnion({
  Home: {},
  Login: {},
  Admin: {},
  NotFound: { path: Schema.String },
});

export const LoggedOutRoute = AppRoute.subset(["Home", "Login", "NotFound"]);
export const LoggedInRoute = AppRoute.subset(["Home", "Admin", "NotFound"]);
```

Replace the flat root Model with a tagged union that makes an authenticated session impossible to omit from the signed-in state. Keep Skate's existing calendar, theme, menu, and viewport fields in whichever child/root state owns the rendered Home page; keep route ownership at the app root so the root update can guard every URL change.

```ts
export const Model = Schema.Union([LoggedOut.Model, LoggedIn.Model]);
// LoggedIn.Model includes route: LoggedInRoute and session: Session.
// LoggedOut.Model includes route: LoggedOutRoute and login-page state.
```

`Session` should be a small app-owned schema containing only the identity fields required for UI display (initially Supabase user ID and email). Keep the access and refresh tokens inside Supabase's client; do not put token strings in the FoldKit Model, Messages, devtools history, or persisted app state.

## Auth state and FoldKit flow

### Auth service and runtime Resource

Create `Auth.Service` in `src/domain/auth.ts` following the Effect skill's service pattern: `Context.Service<Service, Interface>()`, a Config-backed `Layer.effect`, `Service.of(...)`, and named `Effect.fn` methods for non-trivial operations. The service wraps `getSession`, `signInWithPassword`, `signOut`, and the auth-state event stream, maps SDK errors into a typed `AuthError`, and translates SDK sessions to the app-owned `Session`. Export the module namespace as `Auth` and consume it as `Auth.Service` / `Auth.layerConfig`.

Provide `Auth.layerConfig` through FoldKit's app-level `resources` field on `Runtime.makeApplication`. Compose it with the browser ConfigProvider layer. FoldKit builds this Layer once in the runtime scope and provides its services to Flags, Commands, and Subscriptions. Commands must not import the Supabase client or call Supabase directly; they obtain `Auth.Service` from Effect's environment. This static Resource pattern provides one client for the runtime lifetime, rather than a Model-dependent ManagedResource. If the Auth layer registers a finalizer (for example, to dispose the Supabase client), FoldKit runs it when the runtime scope ends.

```ts
// src/entry.ts — shape only
const application = Runtime.makeApplication({
  Model,
  Flags,
  flags,
  init,
  update,
  subscriptions,
  view,
  resources: Auth.layerConfig.pipe(Layer.provide(AuthConfig.layer)),
  // routing, container, devTools...
});
```

Restore the session in `flags: Effect<Flags>` by yielding `Auth.Service` and calling `auth.getSession`. The Flags schema carries `maybeSession: Schema.Option(Session)`; `Runtime.makeApplication` provides its `resources` layer to the Flags effect. Handle lookup errors as signed out while reporting a useful diagnostic, or represent them explicitly if startup should show a recoverable error. `init(flags, url)` parses the initial route and applies the access table before anything can render: a missing session on `/admin` redirects to `/login`; a session on `/login` redirects to `/` (`Home`). This keeps auth loading out of the root Model and uses the same Auth service instance for startup, Commands, and Subscriptions.

### Login and logout Commands

Keep auth effects behind `Auth.Service`, not in view code or update logic. A Command obtains `Auth.Service` from its Effect environment and calls the interface. The login page collects email and password as Model state; submit emits a Message, and update returns the Command. The service adapter uses the current Supabase JS v2 API:

```ts
supabase.auth.signInWithPassword({ email, password })
// Promise result: { data: { user, session }, error }

supabase.auth.signOut()
// Promise result: { error }

supabase.auth.getSession()
// Promise result: { data: { session }, error }
```

Suggested service and Command contracts (exact Effect and FoldKit type annotations should follow the installed package inference):

```ts
interface Interface {
  readonly getSession: Effect.Effect<Option.Option<Session>, AuthError>;
  readonly signInWithPassword: (
    credentials: Credentials,
  ) => Effect.Effect<Session, AuthError>;
  readonly signOut: Effect.Effect<void, AuthError>;
  readonly authStateChanges: Stream.Stream<AuthStateChange, AuthError>;
}

// FoldKit Command.define infers Auth.Service as an Effect requirement from
// the `yield* Auth.Service` inside execute.
const SignInWithPassword = Command.define("SignInWithPassword", {
  args: { email: Schema.String, password: Schema.String },
  messages: [Message.SucceededSignIn, Message.FailedSignIn],
  execute: ({ email, password }) =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const session = yield* auth.signInWithPassword({ email, password });
      return Message.SucceededSignIn({ session });
    }).pipe(Effect.catchTag("AuthError", error =>
      Effect.succeed(Message.FailedSignIn({ error: error.message })),
    )),
});
```

The `SignInWithPassword` execute effect yields `Auth.Service` and calls `auth.signInWithPassword(credentials)`. It maps the service's typed failure to `FailedSignIn` and emits a success Message containing only the app-owned Session. The root handles successful login by switching to `LoggedIn`; since the user is on `/login`, it replaces the URL with `/` (`Home`). Failed credentials stay on the login page and show an accessible inline error. Logout calls `auth.signOut`, transitions to `LoggedOut`, and replaces the URL with `/`.

Use `Effect.tryPromise` (or the installed Effect equivalent) to bridge promise-based Supabase APIs, and make each Command convert failures into result Messages so an auth request cannot crash the FoldKit runtime.

### Auth changes outside the login form

Implement `authStateChanges` in the Auth service using `supabase.auth.onAuthStateChange` so token refresh, logout in another tab, and other client auth changes can update the root Model. The service converts SDK callbacks into an Effect `Stream` with a scoped finalizer that unsubscribes the listener. Consume it from FoldKit's root `Subscription`, whose Effect environment includes the app's `resources` Layer. Keep the Supabase callback synchronous and only publish the event there; do not call additional async Supabase methods from inside it.

```ts
const { data: { subscription } } = supabase.auth.onAuthStateChange(
  (event, session) => {
    // Convert the event/session to a Message for FoldKit; do not await here.
  },
);
subscription.unsubscribe();
```

The FoldKit subscription should be represented as one app subscription keyed at the root. A signed-out event moves to `LoggedOut` and guards the current route; a valid signed-in event moves to `LoggedIn`. Ignore token-only refresh events when the app-visible identity has not changed, so they do not cause needless route or view transitions.

## Route guards and navigation

Keep internal link handling in the root update. `ChangedUrl` parses with `urlToAppRoute` and matches both the current auth-state variant and route:

- Signed out: update for `Home`, `Login`, and `NotFound`; replace `/admin` with `/login`.
- Signed in: update for `Home`, `Admin`, and `NotFound`; replace `/login` with `/` (`Home`).

Add a `returnTo` query only if preserving the originally requested route after sign-in is desired. For the first version, use a fixed destination: `/login` goes to `/` after sign-in, and an unauthenticated `/admin` request goes to `/login`.

For client navigation, use FoldKit `replaceUrl` for auth redirects as in `repos/foldkit/examples/auth/src/update.ts`. Direct loads and browser back/forward must go through the same `init`/`ChangedUrl` checks.

## Page/view boundaries

Extract the existing Home rendering into a page/view module with the least disruptive refactor, keeping its current calendar and menu behavior intact. Add a Login page module with a semantic `<form>`, labeled email/password fields, submit state, and an accessible error message. Add an Admin page module with a minimal authenticated placeholder and a sign-out action. Root `view` delegates by route/state and continues to render `NotFound` publicly.

The root Model is the access-control boundary for the UI only. If `/admin` later reads or mutates Supabase tables, those operations must also be protected by database RLS policies; hiding a route in a browser app is not server-side authorization.

## Files to change

- `apps/skate/package.json` — add a pinned `@supabase/supabase-js` runtime dependency.
- `pnpm-lock.yaml` — record the dependency resolution.
- `apps/skate/src/route.ts` — add `Login`/`Admin` routes, routers, and route subsets.
- `apps/skate/src/model.ts` — expose the `LoggedOut | LoggedIn` root Model.
- `apps/skate/src/message.ts` — add login/logout/session/auth-state result Messages and child-message forwarding as needed.
- `apps/skate/src/command.ts` — add typed redirect Commands; auth Commands declare `Auth.Service` in their Effect environment.
- `apps/skate/src/main.ts` — refactor Flags/init/update/view to restore auth state, enforce route access, and fold page updates; preserve existing Home behavior.
- `apps/skate/src/entry.ts` — pass root subscriptions and the Auth Config-backed Layer through `resources` to the FoldKit runtime; retain routing/devtools wiring.
- `apps/skate/src/scene.test.ts` and/or new auth scene/story tests — exercise auth and route behavior.
- `apps/skate/.env.example` — document required public client configuration.

## New file layout

```text
apps/skate/
  spec/
    AUTH.md                         # this plan
  src/
    domain/
      auth.ts                       # Auth Effect service, Config layer, Supabase adapter
      auth-config.ts                # ConfigProvider adapter for Vite's public config values
      session.ts                    # app-owned minimal Session schema
    page/
      loggedOut/
        model.ts                    # logged-out state and login form state
        message.ts                  # login page messages
        update.ts                   # login page update and child result mapping
        view.ts                     # login view
      loggedIn/
        model.ts                    # authenticated state, route, Session
        update.ts                   # Admin/logout update behavior
        view.ts                     # Home/Admin delegation or page views
```

Adjust the exact split after comparing the current root `main.ts` seams with FoldKit's auth example. Avoid moving unrelated domain modules just to match the example's directory names.

## Verification checklist for implementation

- `/` and an unmatched URL render without requiring Supabase sign-in.
- Direct `/admin` load without a session replaces the URL with `/login` and never renders Admin.
- Direct `/admin` load with a restored session renders Admin.
- A successful login enters Home; a failed login shows a useful accessible error.
- `/login` while signed in redirects to Home; logout returns to Home.
- Browser back/forward, cross-tab sign-out, and token refresh preserve the same access rules.
- Existing Home calendar/menu interactions and NotFound rendering continue to work.
- Run `pnpm fmt`, `pnpm lint`, and `pnpm typecheck` per repository conventions, plus focused app tests.

## References

- Vendored FoldKit auth example: `repos/foldkit/examples/auth/src/` (read-only reference).
- Supabase JS `signInWithPassword`: https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- Supabase JS `getSession`: https://supabase.com/docs/reference/javascript/auth-getsession
- Supabase JS `onAuthStateChange`: https://supabase.com/docs/reference/javascript/auth-onauthstatechange
- Supabase JS Auth overview/session persistence: https://supabase.com/docs/reference/javascript/auth
- FoldKit runtime Resource Layer examples: `repos/foldkit/packages/foldkit/src/runtime/resources.test.ts` and `repos/foldkit/packages/foldkit/src/runtime/resourceProvider.ts`
