import { Effect, Match, Option } from "effect";
import { cases } from "~/branch";
import { component, provideContext } from "~/component";
import { History } from "~/history";
import { navigator } from "~/navigation";
import * as Sync from "~/sync";
import { Anonymous, Authenticated, Resolving } from "./app-views";
import { Navigation } from "./context";
import { routingControls } from "./controls";
import { controlledHistory } from "./history";
import type { AppState } from "./model";
import { MockAuth, MockProjects } from "./resources";
import { ProjectId, projectDestination, urls } from "./routes";
import { transition } from "./transitions";
import { routeLink } from "./ui";

export const RoutingDemo = component(() =>
  Sync.succeed({
    setup: (context) =>
      Effect.gen(function* () {
        const transport = yield* History;
        const { adapter: history, rejectNext } = controlledHistory({
          ...transport,
          identity: {},
          observe: (listener) =>
            transport.observe((location) => {
              Match.value(new URL(location, transport.origin).pathname).pipe(
                Match.when(
                  (path) => path === "/routing" || path.startsWith("/routing/"),
                  () => listener(location),
                ),
                Match.orElse(() => {}),
              );
            }),
        });
        const auth = yield* MockAuth;
        const projects = yield* MockProjects;

        const state = yield* context.signal<AppState>({
          initial: { _tag: "ResolvingSession", requested: urls.parse("/routing"), revision: 0 },
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

        const controls = routingControls({
          pendingLabel,
          rejectNext,
          reconcile: navigation.dispatch({ _tag: "Reconcile" }).pipe(Effect.andThen(error.set(""))),
        });

        const root = component((context) =>
          Sync.gen(function* () {
            const output = yield* context.he("section", {
              attrs: {
                class: Option.some("routing-page"),
                "aria-label": Option.some("Typed routing demo"),
              },
              children: [
                yield* context.he("header", {
                  attrs: { class: Option.some("routing-heading") },
                  children: [yield* context.he("h1", { children: ["Routing"] }), controls],
                }),
                yield* context.he("p", {
                  children: [
                    "Session discovery is explicit. Delay projects to test cancellation, and use browser Back/Forward to reapply admission.",
                  ],
                }),
                yield* context.he("div", {
                  attrs: { class: Option.some("routing-content") },
                  children: [
                    yield* context.he("nav", {
                      attrs: { "aria-label": Option.some("Demo destinations") },
                      children: [
                        yield* routeLink(context, {
                          label: "Private deep link: project 123 settings",
                          destination: projectDestination({
                            id: ProjectId.make(123),
                            settings: true,
                          }),
                        }),
                        yield* routeLink(context, {
                          label: "Project 456 overview",
                          destination: projectDestination({ id: ProjectId.make(456) }),
                        }),
                        yield* context.he("a", {
                          attrs: { href: Option.some("/routing/projects/wrong-id") },
                          children: ["Malformed project URL (reload)"],
                        }),
                        yield* context.he("a", {
                          attrs: { href: Option.some("/routing/projects/123/doesnt-exist") },
                          children: ["Unknown project child (reload)"],
                        }),
                      ],
                    }),
                    yield* context.he("p", {
                      attrs: { role: Option.some("alert") },
                      children: [error],
                    }),
                    cases({
                      state,
                      branches: {
                        ResolvingSession: { branch: Resolving },
                        Anonymous: { branch: Anonymous },
                        Authenticated: {
                          branch: Authenticated,
                          key: (state) => state.sessionId,
                        },
                      },
                    }),
                  ],
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
