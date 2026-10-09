import { Cause, DateTime, Effect, Option, Schedule } from "effect";
import { expectTypeOf, it } from "vitest";
import {
  component,
  Context,
  Query,
  QueryState,
  Resource,
  Sync,
  type ApplicationContext,
  type Component,
  type ReactiveError as importReactiveError,
  type Signal,
} from "./framework";
import type { Structural } from "./requirements";

class Projects extends Resource.Service<
  Projects,
  { readonly get: (id: string) => Effect.Effect<string, "missing"> }
>()("query/types/Projects") {}
class Binding extends Context.Service<Binding, string>()("query/types/Binding") {}
const project = Query.define({
  name: "project",
  load: (input: { readonly id: string }) => Projects.pipe(Effect.flatMap((s) => s.get(input.id))),
});

it("preserves definition, observer, mounting, retry, and Option inference", () => {
  expectTypeOf(project).toEqualTypeOf<
    Query.Definition<{ readonly id: string }, string, "missing", Projects>
  >();
  const proof = (
    app: ApplicationContext<Projects>,
    empty: ApplicationContext,
    input: Signal<Option.Option<{ readonly id: string }>>,
  ) => {
    const handle = Query.observe({ context: app, query: project, input });
    expectTypeOf(handle).toEqualTypeOf<
      Effect.Effect<
        Query.Handle<{ readonly id: string }, string, "missing", false>,
        importReactiveError
      >
    >();
    const retained = Query.observe({ context: app, query: project, input, retainPrevious: true });
    expectTypeOf(retained).toEqualTypeOf<
      Effect.Effect<
        Query.Handle<{ readonly id: string }, string, "missing", true>,
        importReactiveError
      >
    >();
    Query.observe({
      context: app,
      query: project,
      // @ts-expect-error Inputs must express availability through Option.
      input: null as unknown as Signal<{ id: string }>,
    });
    // @ts-expect-error Observer retry cannot change shared execution policy.
    Query.observe({ context: app, query: project, input, retry: Query.disabled() });
    const Child = component(() =>
      Sync.succeed({
        setup: (ui) => Query.observe({ context: ui, query: project, input }).pipe(Effect.as([])),
      }),
    );
    expectTypeOf(Child).toEqualTypeOf<Component<Projects, never, importReactiveError, never>>();
    app.h(document.createElement("div"), Child);
    // @ts-expect-error Runtime resources must be supplied at mounting.
    empty.h(document.createElement("div"), Child);
    const LocallyProvided = component(() =>
      Sync.succeed({
        setup: (ui) =>
          Query.observe({ context: ui, query: project, input }).pipe(
            Effect.provideService(Projects, { get: () => Effect.succeed("local") }),
            Effect.as([]),
          ),
      }),
    );
    // @ts-expect-error Local services cannot satisfy a query's runtime requirements.
    empty.h(document.createElement("div"), LocallyProvided);
    expectTypeOf(Query.observe({ context: empty, query: project, input })).toEqualTypeOf<
      Effect.Effect<
        Query.Handle<{ readonly id: string }, string, "missing", false>,
        importReactiveError,
        Structural<Projects>
      >
    >();
    const partition = app.signal({ initial: Option.some("anonymous") });
    void partition;
  };
  void proof;
  // @ts-expect-error Ancestor context cannot become a query loader dependency.
  Query.define({ name: "context", load: () => Binding });
  Query.define({
    name: "private",
    load: () => Binding.pipe(Effect.provideService(Binding, "private")),
  });
  const retry = Schedule.recurs(1).pipe(Schedule.setInputType<"missing">());
  Query.define({ name: "retry", load: project.load, retry: Query.retry(retry) });
  Query.define({
    name: "retry mismatch",
    load: project.load,
    // @ts-expect-error Retry inputs must accept the loader's error.
    retry: Query.retry(Schedule.recurs(1).pipe(Schedule.setInputType<number>())),
  });
});

it("has plain current data and one typed history field, guards, and exhaustive dual match", () => {
  const proof = (
    state: QueryState.QueryState<{ id: string }, number, "failed">,
    simple: QueryState.QueryState<{ id: string }, number, "failed", false>,
  ) => {
    const result = QueryState.match(state, {
      onInitial: (s) => {
        expectTypeOf(s.waiting).toEqualTypeOf<boolean>();
        return "initial" as const;
      },
      onSuccess: (s) => {
        expectTypeOf(s.value).toEqualTypeOf<number>();
        expectTypeOf(s.timestamp).toEqualTypeOf<DateTime.Utc>();
        return s.value;
      },
      onFailure: (s) => {
        expectTypeOf(s.cause).toEqualTypeOf<Cause.Cause<"failed">>();
        return false as const;
      },
    });
    expectTypeOf(result).toEqualTypeOf<"initial" | number | false>();
    expectTypeOf(
      state.pipe(
        QueryState.match({
          onInitial: () => "initial" as const,
          onSuccess: (s) => {
            expectTypeOf(s.value).toEqualTypeOf<number>();
            return s.value;
          },
          onFailure: () => false as const,
        }),
      ),
    ).toEqualTypeOf<"initial" | number | false>();
    // @ts-expect-error All three handlers are required.
    QueryState.match(state, { onSuccess: () => 1, onFailure: () => 2 });
    if (QueryState.isSuccess(state)) {
      expectTypeOf(state.value).toEqualTypeOf<number>();
      // @ts-expect-error Success has no duplicated history.
      void state.previousSuccess;
    }
    if (QueryState.isInitial(simple) && Option.isSome(simple.previousSuccess))
      expectTypeOf(simple.previousSuccess.value._tag).toEqualTypeOf<"SameKey">();
    if (QueryState.isFailure(state) && Option.isSome(state.previousSuccess)) {
      // @ts-expect-error Only PreviousKey has a key.
      void state.previousSuccess.value.key;
    }
    expectTypeOf(QueryState.map(state, String)).toEqualTypeOf<
      QueryState.QueryState<{ id: string }, string, "failed">
    >();
  };
  void proof;
});
