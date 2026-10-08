import { Effect, Match, Option } from "effect";
import { branch, cases } from "./branch";
import { component } from "./component";
import { Examples } from "./examples";
import { History } from "./history";
import { Home } from "./home";
import { navigator } from "./navigation";
import { link } from "./router-link";
import { route, router, type Destination, type ParseResult } from "./routes";
import { RoutingDemo } from "./routing-demo/app";
import * as Sync from "./sync";

const urls = router([
  route({ tag: "Home", path: [] }),
  route({ tag: "Examples", path: ["examples"] }),
  route({ tag: "Routing", path: ["routing"] }),
]);
type Page =
  | { readonly _tag: "Home" }
  | { readonly _tag: "Examples" }
  | { readonly _tag: "Routing" }
  | { readonly _tag: "NotFound" };
const page = (target: ParseResult<typeof urls.definitions>): Page =>
  Match.value(target).pipe(
    Match.tag("Matched", ({ destination }) => ({ _tag: destination._tag })),
    Match.orElse(({ ancestry }) =>
      Match.value(ancestry.some((route) => route._tag === "Routing")).pipe(
        Match.when(true, (): Page => ({ _tag: "Routing" })),
        Match.orElse((): Page => ({ _tag: "NotFound" })),
      ),
    ),
  );
const HomePage = branch<Extract<Page, { _tag: "Home" }>>()(() =>
  Sync.succeed({ setup: () => Effect.succeed(Home) }),
);
const ExamplesPage = branch<Extract<Page, { _tag: "Examples" }>>()(() =>
  Sync.succeed({ setup: () => Effect.succeed(Examples) }),
);
const RoutingPage = branch<Extract<Page, { _tag: "Routing" }>>()(() =>
  Sync.succeed({ setup: () => Effect.succeed(RoutingDemo) }),
);
const NotFound = branch<Extract<Page, { _tag: "NotFound" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* context.he("main", { children: ["Page not found"] });
    return { setup: () => Effect.succeed(output) };
  }),
);

export const App = component(() =>
  Sync.succeed({
    setup: (context) =>
      Effect.gen(function* () {
        const history = yield* History;
        const state = yield* context.signal<Page>({ initial: { _tag: "Home" } });
        const navigation = yield* navigator<typeof urls.definitions, Page, never>({
          context,
          router: urls,
          state,
          history,
          transition: ({ state, event }) =>
            Match.value(event).pipe(
              Match.tag("Navigate", ({ destination, mode }) => ({
                state: { _tag: destination._tag },
                history: {
                  _tag: Match.value(mode).pipe(
                    Match.when("push", () => "Push" as const),
                    Match.when("replace", () => "Replace" as const),
                    Match.exhaustive,
                  ),
                  destination,
                },
              })),
              Match.tag("Location", ({ target }) => ({
                state: page(target),
                history: { _tag: "Keep" as const },
              })),
              Match.tag("Application", () => ({ state, history: { _tag: "Keep" as const } })),
              Match.exhaustive,
            ),
          onError: (error) => console.error("App navigation failed", error),
        });
        yield* navigation.initial;
        return component((context) =>
          Sync.gen(function* () {
            const links = [];
            for (const tag of ["Home", "Examples", "Routing"] as const) {
              const destination: Destination<typeof urls.definitions> = {
                _tag: tag,
                params: {},
                query: {},
                fragment: Option.none(),
              };
              const active = yield* context.derive({
                sources: { state },
                compute: ({ state }) =>
                  Match.value(state._tag === tag).pipe(
                    Match.when(true, () => Option.some("page")),
                    Match.orElse(() => Option.none<string>()),
                  ),
              });
              links.push(
                yield* link({
                  context,
                  router: urls,
                  navigator: navigation,
                  destination,
                  attrs: { "aria-current": active },
                  children: [tag],
                }),
              );
            }
            const output = yield* context.he("div", {
              attrs: { class: Option.some("app-shell") },
              children: [
                yield* context.he("header", {
                  attrs: { class: Option.some("app-header") },
                  children: [
                    yield* context.he("span", { children: ["Budgerigar"] }),
                    yield* context.he("nav", {
                      attrs: { "aria-label": Option.some("Main navigation") },
                      children: links,
                    }),
                  ],
                }),
                cases({
                  state,
                  branches: {
                    Home: { branch: HomePage },
                    Examples: { branch: ExamplesPage },
                    Routing: { branch: RoutingPage },
                    NotFound: { branch: NotFound },
                  },
                }),
              ],
            });
            return { setup: () => Effect.succeed(output) };
          }),
        );
      }),
  }),
);
