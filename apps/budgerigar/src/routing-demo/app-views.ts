import { Effect, Option } from "effect";
import { branch, cases } from "~/branch";
import { component, provideContext } from "~/component";
import { focus } from "~/focus";
import * as Sync from "~/sync";
import { CurrentUser, SessionIdentity } from "./context";
import type { AppState, PrivatePage, PublicPage } from "./model";
import { InvalidProject, MissingProject, ProjectBranch, ProjectIndex } from "./project-views";
import { MockAuth } from "./resources";
import { dashboard, projects } from "./routes";
import { button, counter, message, routeLink } from "./ui";

const Login = branch<Extract<PublicPage, { _tag: "Login" }>>()(({ context }) =>
  Sync.gen(function* () {
    const auth = yield* Sync.service(MockAuth);
    const output = yield* context.he("article", {
      children: [
        yield* context.he("h3", { children: ["Login"] }),
        yield* message(context, "Sign in to resume your requested destination."),
        yield* button(context, { label: "Sign in as Ada", action: auth.signIn({ name: "Ada" }) }),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);

const PublicNotFound = branch<Extract<PublicPage, { _tag: "NotFound" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(context, "Root page not found");
    return { setup: () => Effect.succeed(output) };
  }),
);

const PublicInvalid = branch<Extract<PublicPage, { _tag: "InvalidUrl" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(context, "Invalid URL");
    return { setup: () => Effect.succeed(output) };
  }),
);

export const Anonymous = branch<Extract<AppState, { _tag: "Anonymous" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const page = yield* focus({ context, source: inputs.state, key: "page" });
    return {
      setup: () =>
        Effect.succeed(
          cases({
            state: page,
            branches: {
              Login: { branch: Login },
              NotFound: { branch: PublicNotFound },
              InvalidUrl: { branch: PublicInvalid },
            },
          }),
        ),
    };
  }),
);

export const Resolving = branch<Extract<AppState, { _tag: "ResolvingSession" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(context, "Resolving session… choose a discovery result above.");
    return { setup: () => Effect.succeed(output) };
  }),
);

const Dashboard = branch<Extract<PrivatePage, { _tag: "Dashboard" }>>()(({ context }) =>
  Sync.gen(function* () {
    const user = yield* Sync.service(CurrentUser);
    const title = yield* context.derive({
      sources: { user },
      compute: ({ user }) => `Dashboard for ${user.name}`,
    });
    const output = yield* context.he("article", {
      children: [
        yield* context.he("h3", { children: [title] }),
        yield* counter(context, "dashboard"),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);

const Projects = branch<Extract<PrivatePage, { _tag: "Projects" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const page = yield* focus({ context, source: inputs.state, key: "page" });
    const output = yield* context.he("section", {
      attrs: { "aria-label": Option.some("Projects shell") },
      children: [
        yield* context.he("h3", { children: ["Projects"] }),
        cases({
          state: page,
          branches: {
            Index: { branch: ProjectIndex },
            InvalidUrl: { branch: InvalidProject },
            NotFound: { branch: MissingProject },
            Project: { branch: ProjectBranch, key: (state) => state.projectId },
          },
        }),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);

const RootNotFound = branch<Extract<PrivatePage, { _tag: "NotFound" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(context, "Root page not found");
    return { setup: () => Effect.succeed(output) };
  }),
);

const RootInvalid = branch<Extract<PrivatePage, { _tag: "InvalidUrl" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(context, "Invalid root URL");
    return { setup: () => Effect.succeed(output) };
  }),
);

export const Authenticated = branch<Extract<AppState, { _tag: "Authenticated" }>>()(
  ({ context, inputs }) =>
    Sync.gen(function* () {
      const user = yield* context.derive({
        sources: { state: inputs.state },
        compute: ({ state }) => state.user,
      });
      const { sessionId } = yield* context.read(inputs.state);
      const page = yield* focus({ context, source: inputs.state, key: "page" });

      const shell = component((context) =>
        Sync.gen(function* () {
          const user = yield* Sync.service(CurrentUser);
          const title = yield* context.derive({
            sources: { user },
            compute: ({ user }) => `Signed in as ${user.name}`,
          });
          const output = yield* context.he("section", {
            attrs: { "aria-label": Option.some("Authenticated shell") },
            children: [
              yield* context.he("h3", { children: [title] }),
              yield* counter(context, "authenticated shell"),
              yield* context.he("nav", {
                children: [
                  yield* routeLink(context, { label: "Dashboard", destination: dashboard }),
                  yield* routeLink(context, { label: "Projects index", destination: projects }),
                ],
              }),
              cases({
                state: page,
                branches: {
                  Dashboard: { branch: Dashboard },
                  Projects: { branch: Projects },
                  NotFound: { branch: RootNotFound },
                  InvalidUrl: { branch: RootInvalid },
                },
              }),
            ],
          });
          return { setup: () => Effect.succeed(output) };
        }),
      );

      const withSession = provideContext({ key: SessionIdentity, value: sessionId, child: shell });

      return {
        setup: () =>
          Effect.succeed(provideContext({ key: CurrentUser, value: user, child: withSession })),
      };
    }),
);
