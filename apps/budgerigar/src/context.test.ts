import { Cause, Deferred, Effect, Exit, Match, Option, Queue, Scope, Stream } from "effect";
import { afterEach, expect, expectTypeOf, it } from "vitest";
import * as BudgerigarContext from "./context";
import {
  component,
  keyed,
  mounting,
  provideContext,
  readonlySignal,
  row,
  Sync,
  type Component,
  type ConstructionError,
  type KeyedList,
  type Mount,
  type MountFailure,
  type Output,
  type ReactiveError,
  type Signal,
  type WritableSignal,
} from "./framework";
import { CurrentTransaction } from "./reactive/runtime";
import { toEffect } from "./sync";
import { rendered } from "./test-helpers";

class CurrentUser extends BudgerigarContext.Service<CurrentUser, Signal<Option.Option<string>>>()(
  "Budgerigar/test/CurrentUser",
) {}
class Label extends BudgerigarContext.Service<Label, string>()("Budgerigar/test/Label") {}
class OtherLabel extends BudgerigarContext.Service<OtherLabel, string>()(
  "Budgerigar/test/OtherLabel",
) {}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const fixture = async () => {
  const scope = await Effect.runPromise(Scope.make());
  const errors = await Effect.runPromise(Queue.unbounded<MountFailure>());
  const app = await Effect.runPromise(
    mounting({
      scope,
      onError: (failure) => {
        Queue.offerUnsafe(errors, failure);
      },
    }),
  );
  const parent = document.createElement("main");
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  closers.push(close);
  return { app, parent, close, failure: () => Effect.runPromise(Queue.take(errors)) };
};

it("infers ancestor services, keeps signed-out values valid, and updates without rerunning setup", async () => {
  const { app, parent, close } = await fixture();
  const ready = Deferred.makeUnsafe<WritableSignal<Option.Option<string>>>();
  let accounts = 0;
  let settings = 0;
  const Account = component(() =>
    Sync.succeed({
      setup: ({ derive, he }) =>
        Effect.gen(function* () {
          accounts += 1;
          const user = yield* CurrentUser;
          const email = yield* derive({
            sources: { user },
            compute: ({ user }) => Option.getOrElse(user, () => "Signed out"),
          });
          return yield* he("p", { children: [email] });
        }),
    }),
  );
  const Settings = component(() =>
    Sync.succeed({
      setup: ({ he }) =>
        Effect.sync(() => {
          settings += 1;
        }).pipe(Effect.andThen(he("section", { children: [Account] }))),
    }),
  );
  const Root = component(() =>
    Sync.succeed({
      setup: ({ signal }) =>
        Effect.gen(function* () {
          const user = yield* signal<Option.Option<string>>({ initial: Option.none() });
          yield* Deferred.succeed(ready, user);
          return provideContext({ key: CurrentUser, value: readonlySignal(user), child: Settings });
        }),
    }),
  );
  expectTypeOf(Account).toEqualTypeOf<
    Component<CurrentUser, never, ConstructionError | ReactiveError, never>
  >();
  expectTypeOf(Settings).toEqualTypeOf<Component<CurrentUser, never, ConstructionError, never>>();
  expectTypeOf(Root).toExtend<Component>();
  Effect.runSync(app.h(parent, Root));
  const user = await Effect.runPromise(Deferred.await(ready));
  await rendered({ parent, check: () => parent.textContent === "Signed out" });
  await Effect.runPromise(user.set(Option.some("reader@example.com")));
  expect(parent.textContent).toBe("reader@example.com");
  expect([accounts, settings]).toEqual([1, 1]);
  await close();
  expect(parent.textContent).toBe("");
});

it("installs providers before synchronous factories and fallbacks and isolates occurrences", async () => {
  const first = await fixture();
  const second = await fixture();
  const gate = Deferred.makeUnsafe<void>();
  const Consumer = component(() =>
    Sync.gen(function* () {
      const factoryLabel = yield* Sync.service(Label);
      return {
        fallback: ({ he }) =>
          Sync.gen(function* () {
            const fallbackLabel = yield* Sync.service(Label);
            return yield* he("p", { children: [`${factoryLabel}:${fallbackLabel}`] });
          }),
        setup: ({ he }) =>
          Effect.gen(function* () {
            yield* Deferred.await(gate);
            const label = yield* Label;
            return yield* he("p", { children: [label] });
          }),
      };
    }),
  );
  const one = provideContext({ key: Label, value: "one", child: Consumer });
  const two = provideContext({ key: Label, value: "two", child: Consumer });
  Effect.runSync(first.app.h(first.parent, [one, two, one]));
  Effect.runSync(second.app.h(second.parent, two));
  await rendered({
    parent: first.parent,
    check: () => first.parent.textContent === "one:onetwo:twoone:one",
  });
  await rendered({ parent: second.parent, check: () => second.parent.textContent === "two:two" });
  await Effect.runPromise(Deferred.succeed(gate, undefined));
  await rendered({ parent: first.parent, check: () => first.parent.textContent === "onetwoone" });
  await rendered({ parent: second.parent, check: () => second.parent.textContent === "two" });
});

it("captures local registration environments for forks and event handlers without changing descendants", async () => {
  const { app, parent } = await fixture();
  const release = Deferred.makeUnsafe<void>();
  const messages = await Effect.runPromise(Queue.unbounded<string>());
  const Consumer = component(() =>
    Sync.succeed({
      setup: ({ signal, source, subscribe, fork, he, h }) =>
        Effect.gen(function* () {
          const label = yield* Label;
          const text = yield* signal({ initial: label });
          const events = yield* source<void>();
          const target = yield* he("aside");
          const Child = component(() =>
            Sync.succeed({
              setup: ({ he }) =>
                Effect.gen(function* () {
                  return yield* he("b", { children: [yield* Label] });
                }),
            }),
          );
          yield* subscribe(events.events, () =>
            Effect.gen(function* () {
              yield* Queue.offer(messages, yield* Label);
              yield* h(target, Child);
            }),
          ).pipe(Effect.provideService(Label, "handler"));
          yield* fork(
            Deferred.await(release).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  yield* text.set(yield* Label);
                }),
              ),
            ),
          ).pipe(Effect.provideService(Label, "fork"));
          yield* events.emit(undefined);
          return yield* he("section", { children: [text, target] });
        }),
    }),
  );
  Effect.runSync(app.h(parent, provideContext({ key: Label, value: "subtree", child: Consumer })));
  expect(await Effect.runPromise(Queue.take(messages))).toBe("handler");
  await rendered({ parent, check: () => parent.textContent === "subtreesubtree" });
  await Effect.runPromise(Deferred.succeed(release, undefined));
  await rendered({ parent, check: () => parent.textContent === "forksubtree" });
});

it("captures synchronous registrations lazily and provisions stream acquisition", async () => {
  const { app, parent } = await fixture();
  const started = Deferred.makeUnsafe<string>();
  const Consumer = component(({ subscribeStream }) =>
    Sync.gen(function* () {
      const registration = subscribeStream(Stream.fromEffect(Label), (label) =>
        Deferred.succeed(started, label),
      );
      yield* registration.pipe(Sync.provideService(Label, "registered"));
      return { setup: ({ he }) => he("p", { children: ["ready"] }) };
    }),
  );
  Effect.runSync(app.h(parent, Consumer));
  expect(await Effect.runPromise(Deferred.await(started))).toBe("registered");
  await rendered({ parent, check: () => parent.textContent === "ready" });
});

it("keeps unexecuted mounting inert and rejects unsafe missing service reads as phase defects", async () => {
  const { app, parent, failure } = await fixture();
  let factories = 0;
  const description = component(() => {
    factories += 1;
    return Sync.succeed({ setup: () => Effect.succeed([]) });
  });
  const unexecuted = app.h(parent, description);
  expect(factories).toBe(0);
  expect(parent.childNodes).toHaveLength(0);
  Effect.runSync(unexecuted);
  await rendered({ parent, check: () => factories === 1 });
  const Open = component(() =>
    Sync.gen(function* () {
      yield* Sync.service(Label);
      return { setup: () => Effect.succeed([]) };
    }),
  );
  const unsafe = Open as unknown as Component;
  Effect.runSync(app.h(parent, unsafe));
  const error = await failure();
  expect(error.operation).toBe("factory");
  expect(Cause.hasDies(error.cause)).toBe(true);
  expect(Cause.pretty(error.cause)).toContain("Budgerigar/test/Label");
});

it("rejects unresolved, partially provided, and locally discharged structural requirements", () => {
  const proof = async () => {
    const { app, parent } = await fixture();
    const Open = component(() =>
      Sync.succeed({
        setup: () =>
          Effect.gen(function* () {
            yield* Label;
            yield* OtherLabel;
            return [];
          }),
      }),
    );
    // @ts-expect-error A same-shape service does not supply the other identifier.
    app.h(parent, provideContext({ key: Label, value: "one", child: Open }));
    // @ts-expect-error Provider value comes from the token.
    provideContext({ key: Label, value: 1, child: Open });
    // @ts-expect-error Requirements cannot widen to a closed component.
    const closed: Component = Open;
    void closed;
    // @ts-expect-error Mixed arrays cannot erase deferred requirements.
    const closedOutput: Output = [Open];
    void closedOutput;
    const selection = await Effect.runPromise(
      app.signal<Option.Option<Component<Label | OtherLabel>>>({ initial: Option.some(Open) }),
    );
    // @ts-expect-error Selection signals preserve future component requirements.
    const closedSelection: Signal<Option.Option<Component>> = selection;
    void closedSelection;
    // @ts-expect-error Application helpers cannot widen to an owner helper accepting open content.
    const genericMount: Mount = app.h;
    void genericMount;
    const Mounted = component(() =>
      Sync.succeed({
        setup: ({ h }) =>
          Effect.gen(function* () {
            yield* h(parent, Open).pipe(Effect.provideService(Label, "local"));
            return [];
          }),
      }),
    );
    // @ts-expect-error Local provision does not provide mounted descendants.
    app.h(parent, Mounted);
    const SyncMounted = component(({ h }) =>
      Sync.gen(function* () {
        yield* h(parent, Open).pipe(Sync.provideService(Label, "local"));
        return { setup: () => Effect.succeed([]) };
      }),
    );
    // @ts-expect-error Sync provision cannot remove structural mounting requirements.
    app.h(parent, SyncMounted);
    const Forked = component(() =>
      Sync.succeed({
        setup: ({ fork }) =>
          Effect.gen(function* () {
            yield* fork(Label);
            return [];
          }),
      }),
    );
    // @ts-expect-error Registered fork requirements contribute to the component.
    app.h(parent, Forked);
    const Folded = component(({ foldStream }) =>
      Sync.gen(function* () {
        yield* foldStream({
          stream: Stream.fromEffect(Label),
          initial: "",
          reducer: ({ event }) => event,
        });
        return { setup: () => Effect.succeed([]) };
      }),
    );
    // @ts-expect-error Stream acquisition requirements contribute to the component.
    app.h(parent, Folded);
    // @ts-expect-error Application mounting rejects open output even with local provision.
    app.h(parent, Open).pipe(Effect.provideService(Label, "local"));
    const both = provideContext({
      key: OtherLabel,
      value: "two",
      child: provideContext({ key: Label, value: "one", child: Open }),
    });
    app.h(parent, both);
    // Public runners must have enough requirements even for Sync computations.
    // @ts-expect-error The internal typed bridge still preserves missing requirements.
    Effect.runSync(toEffect(Sync.service(Label)));
  };
  void proof;
});

it("infers requirements of all possible heterogeneous rows", () => {
  const proof = (items: Signal<ReadonlyArray<number>>) => {
    const first = row<number>()(() =>
      Sync.gen(function* () {
        yield* Sync.service(Label);
        return { setup: () => Effect.succeed([]) };
      }),
    );
    const second = row<number>()(() =>
      Sync.succeed({
        setup: () =>
          Effect.gen(function* () {
            yield* OtherLabel;
            return [];
          }),
      }),
    );
    const list = keyed({
      items,
      key: (item) => item,
      row: (item) =>
        Match.value(item > 0).pipe(
          Match.when(true, () => first),
          Match.when(false, () => second),
          Match.exhaustive,
        ),
    });
    expectTypeOf(list).toEqualTypeOf<KeyedList<number, Label | OtherLabel>>();
    const firstComponent = component(() =>
      Sync.succeed({
        setup: () =>
          Effect.gen(function* () {
            yield* Label;
            return [];
          }),
      }),
    );
    const secondComponent = component(() =>
      Sync.succeed({
        setup: () =>
          Effect.gen(function* () {
            yield* OtherLabel;
            return [];
          }),
      }),
    );
    const mixed = component(() =>
      Sync.succeed({ setup: () => Effect.succeed([firstComponent, secondComponent]) }),
    );
    expectTypeOf(mixed).toEqualTypeOf<Component<Label | OtherLabel, never, never, never>>();
  };
  void proof;
});

it("uses the nearest provider through selections and keyed row occurrences", async () => {
  const { app, parent } = await fixture();
  const controls = Deferred.makeUnsafe<{
    readonly selection: WritableSignal<Option.Option<Component<Label>>>;
    readonly items: WritableSignal<ReadonlyArray<string>>;
  }>();
  let calls = 0;
  const Consumer = component(() =>
    Sync.succeed({
      setup: ({ he }) =>
        Effect.gen(function* () {
          calls += 1;
          return yield* he("p", { children: [yield* Label] });
        }),
    }),
  );
  const descriptor = row<string>()(({ context, inputs }) =>
    Sync.gen(function* () {
      const item = yield* context.read(inputs.item);
      const label = yield* Sync.service(Label);
      return { setup: ({ he }) => he("b", { children: [`${label}:${item}`] }) };
    }),
  );
  const Root = component(() =>
    Sync.succeed({
      setup: ({ signal }) =>
        Effect.gen(function* () {
          const selection = yield* signal<Option.Option<Component<Label>>>({
            initial: Option.some(Consumer),
          });
          const items = yield* signal<ReadonlyArray<string>>({ initial: ["a", "b"] });
          yield* Deferred.succeed(controls, { selection, items });
          const Descendants = component(() =>
            Sync.succeed({
              setup: () =>
                Effect.succeed([
                  selection,
                  keyed({ items, key: (item) => item, row: () => descriptor }),
                  provideContext({ key: Label, value: "inner", child: Consumer }),
                ]),
            }),
          );
          return provideContext({ key: Label, value: "outer", child: Descendants });
        }),
    }),
  );
  Effect.runSync(app.h(parent, Root));
  const { selection, items } = await Effect.runPromise(Deferred.await(controls));
  await rendered({ parent, check: () => parent.textContent === "outerouter:aouter:binner" });
  await Effect.runPromise(items.set(["b", "a"]));
  expect(parent.textContent).toBe("outerouter:bouter:ainner");
  await Effect.runPromise(selection.set(Option.some(Consumer)));
  expect(calls).toBe(2);
  await Effect.runPromise(selection.set(Option.none()));
  expect(parent.textContent).toBe("outer:bouter:ainner");
  await Effect.runPromise(selection.set(Option.some(Consumer)));
  await rendered({ parent, check: () => parent.textContent === "outerouter:bouter:ainner" });
  expect(calls).toBe(3);
});

it("starts applications without the mounting caller's services and reserves framework capabilities", async () => {
  const errors = await Effect.runPromise(Queue.unbounded<MountFailure>());
  const scope = await Effect.runPromise(Scope.make());
  closers.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const app = await Effect.runPromise(
    mounting({
      scope,
      onError: (failure) => {
        Queue.offerUnsafe(errors, failure);
      },
    }).pipe(Effect.provideService(Label, "caller")),
  );
  const Open = component(() =>
    Sync.succeed({
      setup: () =>
        Effect.gen(function* () {
          yield* Label;
          return [];
        }),
    }),
  );
  Effect.runSync(app.h(document.createElement("main"), Open as unknown as Component));
  const failure = await Effect.runPromise(Queue.take(errors));
  expect(failure.operation).toBe("setup");
  expect(Cause.hasDies(failure.cause)).toBe(true);
  expect(() =>
    provideContext({
      // @ts-expect-error Framework capabilities are not context tokens.
      key: Scope.Scope,
      value: scope,
      child: component(() => Sync.succeed({ setup: () => Effect.succeed([]) })),
    }),
  ).toThrow("Budgerigar context token");
});

it("replaces captured Scope and staging authority while cleanup retains the registration environment", async () => {
  const { app, parent, close } = await fixture();
  const registered = Deferred.makeUnsafe<void>();
  const retiring = Deferred.makeUnsafe<string>();
  const releaseCleanup = Deferred.makeUnsafe<void>();
  const foreignScope = await Effect.runPromise(Scope.make());
  const Consumer = component(() =>
    Sync.succeed({
      setup: ({ source, subscribe, batch, he }) =>
        Effect.gen(function* () {
          const scope = yield* Scope.Scope;
          const events = yield* source<void>();
          yield* batch(
            subscribe(events.events, () =>
              Effect.gen(function* () {
                expect(yield* Scope.Scope).toBe(scope);
                expect(Option.isNone(yield* CurrentTransaction)).toBe(true);
                expect(yield* Label).toBe("registered");
                yield* Effect.addFinalizer(() =>
                  Effect.gen(function* () {
                    yield* Deferred.succeed(retiring, yield* Label);
                    yield* Deferred.await(releaseCleanup);
                  }),
                );
                yield* Deferred.succeed(registered, undefined);
              }),
            ).pipe(Effect.provideService(Label, "registered"), Scope.provide(foreignScope)),
          );
          yield* batch(events.emit(undefined));
          return yield* he("p", { children: [yield* Label] });
        }),
    }),
  );
  Effect.runSync(app.h(parent, provideContext({ key: Label, value: "old", child: Consumer })));
  await Effect.runPromise(Deferred.await(registered));
  await rendered({ parent, check: () => parent.textContent === "old" });
  const Next = component(() =>
    Sync.succeed({
      setup: ({ he }) => Label.pipe(Effect.flatMap((label) => he("p", { children: [label] }))),
    }),
  );
  Effect.runSync(app.h(parent, provideContext({ key: Label, value: "new", child: Next })));
  expect(await Effect.runPromise(Deferred.await(retiring))).toBe("registered");
  await rendered({ parent, check: () => parent.textContent === "new" });
  await Effect.runPromise(Deferred.succeed(releaseCleanup, undefined));
  await close();
  await Effect.runPromise(Scope.close(foreignScope, Exit.void));
});
