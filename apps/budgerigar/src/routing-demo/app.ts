import { Effect, Option } from "effect";
import { cases } from "~/branch";
import { component, provideContext } from "~/component";
import { History } from "~/history";
import { navigator } from "~/navigation";
import * as Sync from "~/sync";
import { Anonymous, Authenticated, Resolving } from "./app-views";
import { Navigation } from "./context";
import { controlledHistory } from "./history";
import type { AppState } from "./model";
import { MockAuth, MockProjects } from "./resources";
import { ProjectId, projectDestination, urls } from "./routes";
import { transition } from "./transitions";
import { button, routeLink } from "./ui";

export const RoutingDemo = component(() =>
  Sync.succeed({
    setup: (context) =>
      Effect.gen(function* () {
        const transport = yield* History;
        const { adapter: history, rejectNext } = controlledHistory(transport);
        const auth = yield* MockAuth;
        const projects = yield* MockProjects;

        const state = yield* context.signal<AppState>({
          initial: { _tag: "ResolvingSession", requested: urls.parse("/"), revision: 0 },
        });
        const error = yield* context.signal({ initial: "" });

        const navigation = yield* navigator({
          context,
          router: urls,
          state,
          history,
          transition,
          onError: (failure) => {
            Effect.runSync(
              error.set(
                `${failure.phase}: navigation failed. Last committed URL: ${failure.lastCommittedLocation}. Use Reconcile URL to restore it.`,
              ),
            );
          },
        });
        yield* navigation.initial;

        yield* context.subscribeStream(auth.sessions, (event) =>
          navigation.dispatch({ _tag: "Auth", event }),
        );

        const pending = yield* context.foldStream({
          stream: projects.pending,
          initial: 0,
          reducer: ({ event }) => event,
        });
        const pendingLabel = yield* context.derive({
          sources: { pending },
          compute: ({ pending }) => `Pending project acquisitions: ${pending}`,
        });

        const root = component((context) =>
          Sync.gen(function* () {
            const controls = yield* context.he("div", {
              attrs: { class: Option.some("routing-controls") },
              children: [
                yield* button(context, {
                  label: "Discover anonymous",
                  action: auth.resolve(Option.none()),
                }),
                yield* button(context, {
                  label: "Discover Ada",
                  action: auth.resolve(Option.some({ name: "Ada" })),
                }),
                yield* button(context, {
                  label: "Switch to Grace",
                  action: auth.signIn({ name: "Grace" }),
                }),
                yield* button(context, {
                  label: "New Ada session",
                  action: auth.signIn({ name: "Ada" }),
                }),
                yield* button(context, { label: "Refresh session", action: auth.refresh }),
                yield* button(context, { label: "Log out", action: auth.logout }),
                yield* button(context, { label: "Expire session", action: auth.expire }),
                yield* button(context, {
                  label: "Immediate projects",
                  action: projects.mode("Immediate"),
                }),
                yield* button(context, {
                  label: "Delay projects",
                  action: projects.mode("Delayed"),
                }),
                yield* button(context, { label: "Fail projects", action: projects.mode("Failed") }),
                yield* button(context, {
                  label: "Complete acquisitions",
                  action: projects.complete(true),
                }),
                yield* button(context, {
                  label: "Fail acquisitions",
                  action: projects.complete(false),
                }),
                yield* button(context, {
                  label: "Reject next history write",
                  action: rejectNext,
                }),
                yield* button(context, {
                  label: "Reconcile URL",
                  action: navigation
                    .dispatch({ _tag: "Reconcile" })
                    .pipe(Effect.andThen(error.set(""))),
                }),
              ],
            });

            const output = yield* context.he("section", {
              attrs: {
                class: Option.some("routing-demo"),
                "aria-label": Option.some("Typed routing demo"),
              },
              children: [
                yield* context.he("h2", { children: ["Typed routing and scoped branches"] }),
                yield* context.he("p", {
                  children: [
                    "Session discovery is explicit. Delay projects to test cancellation, and use browser Back/Forward to reapply admission.",
                  ],
                }),
                controls,
                yield* context.he("nav", {
                  children: [
                    yield* routeLink(context, {
                      label: "Private deep link: project 123 settings",
                      destination: projectDestination({ id: ProjectId.make(123), settings: true }),
                    }),
                    yield* routeLink(context, {
                      label: "Project 456 overview",
                      destination: projectDestination({ id: ProjectId.make(456) }),
                    }),
                    yield* context.he("a", {
                      attrs: { href: Option.some("/projects/wrong-id") },
                      children: ["Malformed project URL (reload)"],
                    }),
                    yield* context.he("a", {
                      attrs: { href: Option.some("/projects/123/doesnt-exist") },
                      children: ["Unknown project child (reload)"],
                    }),
                  ],
                }),
                yield* context.he("output", { children: [pendingLabel] }),
                yield* context.he("p", {
                  attrs: { role: Option.some("alert") },
                  children: [error],
                }),
                cases({
                  state,
                  branches: {
                    ResolvingSession: { branch: Resolving },
                    Anonymous: { branch: Anonymous },
                    Authenticated: { branch: Authenticated, key: (state) => state.sessionId },
                  },
                }),
              ],
            });
            return { setup: () => Effect.succeed(output) };
          }),
        );
        return provideContext({ key: Navigation, value: navigation, child: root });
      }),
  }),
);
