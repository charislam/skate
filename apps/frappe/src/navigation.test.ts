import { Deferred, Effect, Exit, Option, Result, Scope, Match } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { component } from "./component";
import { memoryHistory } from "./history";
import {
  navigator,
  type NavigationDecision,
  type NavigationEvent,
  type Navigator,
} from "./navigation";
import { ReactiveError } from "./reactive/runtime";
import { signalData } from "./reactive/signal";
import { router, route, type Destination } from "./routes";
import * as Sync from "./sync";
import { harness, rendered } from "./test-helpers";

const urls = router([
  route({ tag: "Login", path: ["login"] }),
  route({ tag: "Home", path: [] }),
  route({ tag: "Private", path: ["private"] }),
]);
type Target = Destination<typeof urls.definitions>;
const target = (tag: Target["_tag"]): Target => ({
  _tag: tag,
  params: {},
  query: {},
  fragment: Option.none(),
});
interface State {
  readonly signedIn: boolean;
  readonly page: Target["_tag"];
  readonly decisions: number;
}
type Event = "login" | "logout";
const transitions = (options: {
  state: State;
  event: NavigationEvent<typeof urls.definitions, Event>;
}): NavigationDecision<State, Target> => {
  const { state, event } = options;
  const requested = Match.value(event).pipe(
    Match.tag("Navigate", ({ destination }) => destination),
    Match.tag("Location", ({ target: parsed }) =>
      Match.value(parsed).pipe(
        Match.tag("Matched", ({ destination }) => destination),
        Match.orElse(() => target("Home")),
      ),
    ),
    Match.tag("Application", ({ event }) =>
      Match.value(event).pipe(
        Match.when("login", () => target("Private")),
        Match.when("logout", () => target("Login")),
        Match.exhaustive,
      ),
    ),
    Match.exhaustive,
  );
  const signedIn = Match.value(event).pipe(
    Match.tag("Application", ({ event }) => event === "login"),
    Match.orElse(() => state.signedIn),
  );
  const denied = requested._tag === "Private" && !signedIn;
  const destination = Match.value(denied).pipe(
    Match.when(true, () => target("Login")),
    Match.orElse(() => requested),
  );
  const history = Match.value(denied || event._tag === "Application").pipe(
    Match.when(true, () => ({ _tag: "Replace" as const, destination })),
    Match.orElse(() =>
      Match.value(event).pipe(
        Match.tag("Navigate", ({ mode }) => ({
          _tag: Match.value(mode).pipe(
            Match.when("push", () => "Push" as const),
            Match.orElse(() => "Replace" as const),
          ),
          destination,
        })),
        Match.orElse(() => ({ _tag: "Keep" as const })),
      ),
    ),
  );
  return { state: { signedIn, page: destination._tag, decisions: state.decisions + 1 }, history };
};
const closeHistory: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closeHistory.splice(0)) await close();
});
const fixture = async (initial = "/", signedIn = false) => {
  const test = await harness();
  const scope = await Effect.runPromise(Scope.make());
  const history = await Effect.runPromise(
    memoryHistory({ initial }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  closeHistory.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const state = await Effect.runPromise(
    test.ctx.signal<State>({ initial: { signedIn, page: "Home", decisions: 0 } }),
  );
  const failures: unknown[] = [];
  const reported = Deferred.makeUnsafe<void>();
  const controller = await Effect.runPromise(
    navigator({
      context: test.ctx,
      router: urls,
      history,
      state,
      transition: transitions,
      onError: (error) => {
        failures.push(error);
        Effect.runSync(Deferred.succeed(reported, undefined));
      },
    }),
  );
  await Effect.runPromise(controller.initial);
  return { ...test, history, state, controller, failures, reported };
};
describe("serialized navigation and prepared history commits", () => {
  it("admits initial private URLs with one replacement and no intermediate push", async () => {
    const f = await fixture("/private");
    expect(f.history.entries()).toEqual(["/login"]);
    expect((await Effect.runPromise(f.state.get)).page).toBe("Login");
    await Effect.runPromise(f.controller.dispatch("login"));
    expect(f.history.entries()).toEqual(["/private"]);
    await Effect.runPromise(f.controller.navigate(target("Home")));
    expect(f.history.entries()).toEqual(["/private", "/"]);
    const previous = await Effect.runPromise(f.state.get);
    await Effect.runPromise(f.controller.navigate(target("Home")));
    expect(await Effect.runPromise(f.state.get)).toBe(previous);
    await Effect.runPromise(f.controller.navigate(target("Home"), { mode: "replace" }));
    expect((await Effect.runPromise(f.state.get)).decisions).toBe(previous.decisions + 1);
  });
  it("checks preparation before history, and history before state installation", async () => {
    const f = await fixture();
    const original = await Effect.runPromise(f.state.get);
    const disconnect = signalData(f.state).bind({
      validate: () => Result.fail(new ReactiveError({ message: "Invalid DOM candidate" })),
      flush: () => Effect.void,
    });
    expect(
      Exit.isFailure(
        await Effect.runPromise(f.controller.navigate(target("Login")).pipe(Effect.exit)),
      ),
    ).toBe(true);
    expect(f.history.entries()).toEqual(["/"]);
    expect(await Effect.runPromise(f.state.get)).toBe(original);
    disconnect();
    f.history.failNextWrite("denied write");
    expect(
      Exit.isFailure(
        await Effect.runPromise(f.controller.navigate(target("Login")).pipe(Effect.exit)),
      ),
    ).toBe(true);
    expect(f.history.entries()).toEqual(["/"]);
    expect(await Effect.runPromise(f.state.get)).toBe(original);
    await Effect.runPromise(f.controller.navigate(target("Login")));
    expect(f.history.entries()).toEqual(["/", "/login"]);
  });
  it("serializes session events and navigation, reevaluating admission at execution", async () => {
    const f = await fixture();
    await Effect.runPromise(
      Effect.all(
        [
          f.controller.dispatch("login"),
          f.controller.navigate(target("Private")),
          f.controller.dispatch("logout"),
          f.controller.navigate(target("Private")),
        ],
        { concurrency: "unbounded" },
      ),
    );
    expect((await Effect.runPromise(f.state.get)).signedIn).toBe(false);
    expect((await Effect.runPromise(f.state.get)).page).toBe("Login");
    expect(f.history.entries()).toEqual(["/login"]);
  });
  it("traversal reapplies admission, preserves moved URL on failure, and cleans listeners", async () => {
    const f = await fixture("/private", true);
    await Effect.runPromise(f.controller.navigate(target("Home")));
    await Effect.runPromise(f.controller.dispatch("logout"));
    const original = await Effect.runPromise(f.state.get);
    f.history.failNextWrite("redirect fails");
    Result.getOrThrow(f.history.traverse(-1));
    await Effect.runPromise(Deferred.await(f.reported));
    expect(f.history.location()).toBe("/private");
    expect(await Effect.runPromise(f.state.get)).toBe(original);
    expect(f.failures).toMatchObject([
      { phase: "traversal", observed: Option.some("/private"), lastCommittedLocation: "/login" },
    ]);
    await Effect.runPromise(f.controller.navigate(target("Login"), { mode: "replace" }));
    expect(f.history.location()).toBe("/login");
    await f.close();
    expect(f.history.listenerCount()).toBe(0);
    expect(
      Exit.isFailure(
        await Effect.runPromise(f.controller.navigate(target("Home")).pipe(Effect.exit)),
      ),
    ).toBe(true);
  });
});

it("keeps external normalization until explicit replace and rejects competing navigators", async () => {
  const f = await fixture("/login/");
  expect(f.history.entries()).toEqual(["/login/"]);
  await Effect.runPromise(f.controller.navigate(target("Login")));
  expect(f.history.entries()).toEqual(["/login/"]);
  await Effect.runPromise(f.controller.navigate(target("Login"), { mode: "replace" }));
  expect(f.history.entries()).toEqual(["/login"]);
  const duplicate = await Effect.runPromise(
    navigator({
      context: f.ctx,
      router: urls,
      history: { ...f.history },
      state: f.state,
      transition: transitions,
      onError: () => {},
    }).pipe(Effect.exit),
  );
  expect(Exit.isFailure(duplicate)).toBe(true);
  expect(f.history.listenerCount()).toBe(1);
});

it("orders initial admission before traversal arriving during observation acquisition", async () => {
  const test = await harness();
  const scope = await Effect.runPromise(Scope.make());
  closeHistory.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const history = await Effect.runPromise(
    memoryHistory({ initial: "/login" }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const state = await Effect.runPromise(
    test.ctx.signal<State>({ initial: { signedIn: true, page: "Home", decisions: 0 } }),
  );
  const processed = Deferred.makeUnsafe<void>();
  const controller = await Effect.runPromise(
    navigator({
      context: test.ctx,
      router: urls,
      state,
      history: {
        ...history,
        observe: (listener) => {
          const acquired = history.observe(listener);
          listener("/private");
          return acquired;
        },
      },
      transition: (options: {
        state: State;
        event: NavigationEvent<typeof urls.definitions, Event>;
      }) => {
        const decision = transitions(options);
        Match.value(options.event).pipe(
          Match.tag("Location", ({ observed }) =>
            Match.value(observed === "/private").pipe(
              Match.when(true, () => {
                Deferred.doneUnsafe(processed, Effect.void);
              }),
              Match.orElse(() => {}),
            ),
          ),
          Match.orElse(() => {}),
        );
        return decision;
      },
      onError: () => {},
    }),
  );
  await Effect.runPromise(controller.initial);
  await Effect.runPromise(Deferred.await(processed));
  expect((await Effect.runPromise(state.get)).page).toBe("Private");
  expect((await Effect.runPromise(state.get)).decisions).toBe(2);
});

it("owns navigation in its explicit child context while the ancestor state stays live", async () => {
  const test = await harness();
  const scope = await Effect.runPromise(Scope.make());
  closeHistory.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const history = await Effect.runPromise(
    memoryHistory({ initial: "/" }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const state = await Effect.runPromise(
    test.ctx.signal<State>({ initial: { signedIn: true, page: "Home", decisions: 0 } }),
  );
  const ready = Deferred.makeUnsafe<Navigator<typeof urls.definitions, Event>>();
  Effect.runSync(
    test.ctx.h(
      test.target,
      component(() =>
        Sync.succeed({
          setup: (context) =>
            Effect.gen(function* () {
              const controller = yield* navigator({
                context,
                router: urls,
                state,
                history,
                transition: transitions,
                onError: () => {},
              });
              yield* controller.initial;
              yield* Deferred.succeed(ready, controller);
              return yield* context.he("output", { children: ["child"] });
            }),
        }),
      ),
    ),
  );
  const controller = await Effect.runPromise(Deferred.await(ready));
  await rendered({ parent: test.parent, check: () => test.target.textContent === "child" });
  await Effect.runPromise(controller.navigate(target("Private")));
  expect((await Effect.runPromise(state.get)).page).toBe("Private");
  Effect.runSync(test.ctx.h(test.target, []));
  await rendered({ parent: test.parent, check: () => test.target.textContent === "" });
  expect(history.listenerCount()).toBe(0);
  expect(
    Exit.isFailure(await Effect.runPromise(controller.navigate(target("Home")).pipe(Effect.exit))),
  ).toBe(true);
  const previous = await Effect.runPromise(state.get);
  await Effect.runPromise(state.set({ ...previous, page: "Home" }));
  expect((await Effect.runPromise(state.get)).page).toBe("Home");
});

it("rejects an unrelated navigation context before acquiring history", async () => {
  const test = await harness();
  const other = await harness();
  const scope = await Effect.runPromise(Scope.make());
  closeHistory.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const history = await Effect.runPromise(
    memoryHistory({ initial: "/" }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const state = await Effect.runPromise(
    test.ctx.signal<State>({ initial: { signedIn: true, page: "Home", decisions: 0 } }),
  );
  const rejected = await Effect.runPromise(
    navigator({
      context: other.ctx,
      router: urls,
      state,
      history,
      transition: transitions,
      onError: () => {},
    }).pipe(Effect.exit),
  );
  expect(Exit.isFailure(rejected)).toBe(true);
  expect(history.listenerCount()).toBe(0);
  const controller = await Effect.runPromise(
    navigator({
      context: test.ctx,
      router: urls,
      state,
      history,
      transition: transitions,
      onError: () => {},
    }),
  );
  await Effect.runPromise(controller.initial);
  expect(history.listenerCount()).toBe(1);
});
