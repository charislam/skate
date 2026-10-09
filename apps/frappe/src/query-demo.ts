import { Cause, Effect, Layer, Match, Option, Ref, Schedule, Schema } from "effect";
import {
  component,
  Context,
  Query,
  QueryState,
  Resource,
  Sync,
  type Signal,
  type WritableSignal,
} from "./framework";

export class QueryDemoSession extends Context.Service<
  QueryDemoSession,
  WritableSignal<Option.Option<string>>
>()("QueryDemoSession") {}
class DemoFailure extends Schema.TaggedError<DemoFailure>()("QueryDemoFailure", {}) {}
export class QueryDemoData extends Resource.Service<
  QueryDemoData,
  {
    readonly read: (label: string) => Effect.Effect<string, DemoFailure>;
    readonly failRefresh: Effect.Effect<void>;
  }
>()("QueryDemoData") {}
export const queryDemoResources = Layer.effect(
  QueryDemoData,
  Effect.gen(function* () {
    const failures = yield* Ref.make(0);
    const requests = yield* Ref.make(0);
    return QueryDemoData.of({
      read: Effect.fn("QueryDemo.read")(function* (label: string) {
        const request = yield* Ref.updateAndGet(requests, (n) => n + 1);
        yield* Effect.sleep("250 millis");
        const fail = yield* Ref.modify(failures, (n) => [n > 0, Math.max(0, n - 1)]);
        return yield* Match.value(fail).pipe(
          Match.when(true, () => Effect.fail(new DemoFailure())),
          Match.when(false, () => Effect.succeed(`${label} · request ${request}`)),
          Match.exhaustive,
        );
      }),
      failRefresh: Ref.set(failures, 2),
    });
  }),
);
type ProjectInput = { readonly id: string; readonly session: string };
const ProjectQuery = Query.define({
  name: "DemoProject",
  staleTime: "30 seconds",
  retry: Query.retry(Schedule.recurs(1)),
  load: (input: ProjectInput) =>
    QueryDemoData.pipe(
      Effect.flatMap((data) => data.read(`${input.session}: project ${input.id}`)),
    ),
});
const SearchQuery = Query.define({
  name: "DemoSearch",
  retry: Query.retry(Schedule.recurs(1)),
  load: (input: { readonly page: number; readonly session: string }) =>
    QueryDemoData.pipe(
      Effect.flatMap((data) => data.read(`${input.session}: search results, page ${input.page}`)),
    ),
});
const describeState = <I>(state: QueryState.QueryState<I, string, DemoFailure>): string => {
  const previous = (history: Option.Option<QueryState.PreviousSuccess<I, string>>) =>
    Option.match(history, {
      onNone: () => "",
      onSome: (data) =>
        Match.value(data).pipe(
          Match.tag("SameKey", (s) => ` · last result: ${s.previousData}`),
          Match.tag("PreviousKey", (s) => ` · previous selection: ${s.previousData}`),
          Match.exhaustive,
        ),
    });
  return QueryState.match(state, {
    onInitial: (s) =>
      `${Match.value(s.waiting).pipe(
        Match.when(true, () => "Loading"),
        Match.orElse(() => "Choose a project or session"),
      )}${previous(s.previousSuccess)}`,
    onSuccess: (s) =>
      `${s.value}${Match.value(s.waiting).pipe(
        Match.when(true, () => " · refreshing"),
        Match.orElse(() => ""),
      )}`,
    onFailure: (s) => `Request failed: ${Cause.pretty(s.cause)}${previous(s.previousSuccess)}`,
  });
};
const ProjectPanel = (options: {
  readonly title: string;
  readonly input: Signal<Option.Option<ProjectInput>>;
}) =>
  component(() =>
    Sync.succeed({
      setup: (ui) =>
        Effect.gen(function* () {
          const data = yield* QueryDemoData;
          const project = yield* Query.observe({
            context: ui,
            query: ProjectQuery,
            input: options.input,
          });
          const label = yield* ui.derive({
            sources: { state: project.state },
            compute: ({ state }) => describeState(state),
          });
          const refresh = yield* ui.he("button", {
            props: { type: "button" },
            children: ["Refresh shared project"],
          });
          const fail = yield* ui.he("button", {
            props: { type: "button" },
            children: ["Fail next refresh (including retry)"],
          });
          yield* ui.subscribe(yield* ui.events(refresh, "click"), () => project.refresh);
          yield* ui.subscribe(yield* ui.events(fail, "click"), () =>
            data.failRefresh.pipe(Effect.andThen(project.refresh)),
          );
          return yield* ui.he("section", {
            children: [
              yield* ui.he("h3", { children: [options.title] }),
              yield* ui.he("output", { children: [label] }),
              refresh,
              fail,
            ],
          });
        }),
    }),
  );
export const QueryExample = component(() =>
  Sync.succeed({
    setup: (ui) =>
      Effect.gen(function* () {
        const session = yield* QueryDemoSession;
        const selected = yield* ui.signal<Option.Option<string>>({ initial: Option.some("A") });
        const page = yield* ui.signal({ initial: 1 });
        const input = yield* ui.derive({
          sources: { selected, session },
          compute: ({ selected, session }) =>
            Option.flatMap(session, (session) => Option.map(selected, (id) => ({ id, session }))),
        });
        const searchInput = yield* ui.derive({
          sources: { page, session },
          compute: ({ page, session }) => Option.map(session, (session) => ({ page, session })),
        });
        const search = yield* Query.observe({
          context: ui,
          query: SearchQuery,
          input: searchInput,
          retainPrevious: true,
        });
        const results = yield* ui.derive({
          sources: { state: search.state },
          compute: ({ state }) => describeState(state),
        });
        const controls = [];
        for (const id of ["A", "B"] as const) {
          const button = yield* ui.he("button", {
            props: { type: "button" },
            children: [`Project ${id}`],
          });
          yield* ui.subscribe(yield* ui.events(button, "click"), () =>
            selected.set(Option.some(id)),
          );
          controls.push(button);
        }
        const clear = yield* ui.he("button", {
          props: { type: "button" },
          children: ["Clear selection"],
        });
        const next = yield* ui.he("button", {
          props: { type: "button" },
          children: ["Next results page"],
        });
        const switchSession = yield* ui.he("button", {
          props: { type: "button" },
          children: ["Switch query session"],
        });
        yield* ui.subscribe(yield* ui.events(clear, "click"), () => selected.set(Option.none()));
        yield* ui.subscribe(yield* ui.events(next, "click"), () => page.update((n) => n + 1));
        yield* ui.subscribe(yield* ui.events(switchSession, "click"), () =>
          session.update((s) =>
            Option.some(
              Match.value(Option.contains(s, "guest")).pipe(
                Match.when(true, () => "member"),
                Match.orElse(() => "guest"),
              ),
            ),
          ),
        );
        return yield* ui.he("section", {
          attrs: { class: Option.some("card"), "aria-label": Option.some("Shared data queries") },
          children: [
            yield* ui.he("h2", { children: ["Shared data queries"] }),
            yield* ui.he("p", {
              children: [
                "Both project panels share one request. Page changes retain the previous results; switching session clears every query.",
              ],
            }),
            ...controls,
            clear,
            switchSession,
            ProjectPanel({ title: "Project overview", input }),
            ProjectPanel({ title: "Project sidebar", input }),
            yield* ui.he("h3", { children: ["Search pages"] }),
            yield* ui.he("output", { children: [results] }),
            next,
          ],
        });
      }),
  }),
);
