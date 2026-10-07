import { Cause, Deferred, Effect, Exit, Fiber, Match, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  branch,
  cases,
  component,
  focus,
  readonlySignal,
  type Signal,
  type WritableSignal,
} from "./framework";
import { ReactiveError } from "./reactive/runtime";
import { signalData } from "./reactive/signal";
import * as Sync from "./sync";
import { harness, rendered } from "./test-helpers";

type Active = {
  readonly _tag: "Active";
  readonly id: number;
  readonly fields: { readonly left: number; readonly right: number };
};
type State = Active | { readonly _tag: "Empty" };
const active = (id = 1): Active => ({ _tag: "Active", id, fields: { left: 0, right: 0 } });
const Empty = branch<{ readonly _tag: "Empty" }>()(() =>
  Sync.succeed({ setup: () => Effect.succeed([]) }),
);
const fixture = async () => {
  const test = await harness();
  const source = await Effect.runPromise(test.ctx.signal<State>({ initial: active() }));
  const lenses: WritableSignal<Active>[] = [];
  const fields: Array<{ left: WritableSignal<number>; right: WritableSignal<number> }> = [];
  let factories = 0;
  const Active = branch<Active>()(({ context, inputs }) =>
    Sync.gen(function* () {
      factories += 1;
      lenses.push(inputs.state);
      const projection = yield* focus({ context, source: inputs.state, key: "fields" });
      const left = yield* focus({ context, source: projection, key: "left" });
      const right = yield* focus({ context, source: projection, key: "right" });
      fields.push({ left, right });
      const local = yield* context.signal({ initial: factories });
      const label = yield* context.derive({
        sources: { state: inputs.state, local },
        compute: ({ state, local }) =>
          `${state.id}:${state.fields.left}:${state.fields.right}:${local}`,
      });
      return { setup: (ctx) => ctx.he("output", { children: [label] }) };
    }),
  );
  const selection = cases({
    state: source,
    branches: { Active: { branch: Active, key: (state) => state.id }, Empty: { branch: Empty } },
  });
  Effect.runSync(test.ctx.h(test.target, selection));
  await rendered({ parent: test.parent, check: () => test.target.textContent === "1:0:0:1" });
  const lens = lenses[0];
  const input = Match.value(lens).pipe(
    Match.when(
      (value): value is WritableSignal<Active> => value !== undefined,
      (value) => value,
    ),
    Match.orElse(() => {
      throw new Error("Missing lens");
    }),
  );
  return { ...test, source, lenses, fields, lens: input, selection, factories: () => factories };
};
describe("scoped branches and authoritative lenses", () => {
  it("retains inputs, composes nested sibling writes, and expires rekeyed occurrences", async () => {
    const f = await fixture();
    const { left, right } = Option.getOrThrow(Option.fromUndefinedOr(f.fields[0]));
    await Effect.runPromise(
      f.ctx.batch(
        Effect.gen(function* () {
          yield* left.set(2);
          yield* right.update((n) => n + 3);
          yield* f.source.update((state) =>
            Match.value(state).pipe(
              Match.tag("Active", (state) => ({ ...state, fields: { ...state.fields, left: 4 } })),
              Match.orElse((state) => state),
            ),
          );
          yield* left.update((n) => n + 1);
        }),
      ),
    );
    expect(f.target.textContent).toBe("1:5:3:1");
    expect(f.factories()).toBe(1);
    await Effect.runPromise(f.lens.update((state) => ({ ...state, id: 2 })));
    expect(Exit.isFailure(await Effect.runPromise(left.set(99).pipe(Effect.exit)))).toBe(true);
    await rendered({ parent: f.parent, check: () => f.target.textContent === "2:5:3:2" });
    await Effect.runPromise(f.source.set(active()));
    await rendered({ parent: f.parent, check: () => f.factories() === 3 });
    expect(Exit.isFailure(await Effect.runPromise(f.lens.set(active()).pipe(Effect.exit)))).toBe(
      true,
    );
  });
  it("poisons staged leave/reentry writes, restores validity on rollback, and coalesces final identity", async () => {
    const f = await fixture();
    const exit = await Effect.runPromise(
      f.ctx
        .batch(
          Effect.gen(function* () {
            yield* f.source.set({ _tag: "Empty" });
            yield* f.source.set(active());
            yield* f.lens.set(active()).pipe(Effect.catch(() => Effect.void));
          }),
        )
        .pipe(Effect.exit),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(await Effect.runPromise(f.lens.get)).toEqual(active());
    await Effect.runPromise(
      f.ctx.batch(
        Effect.gen(function* () {
          yield* f.source.set({ _tag: "Empty" });
          yield* f.source.set(active());
        }),
      ),
    );
    expect(f.factories()).toBe(1);
    await Effect.runPromise(
      f.lens.update((state) => ({ ...state, fields: { ...state.fields, left: 8 } })),
    );
    expect(f.target.textContent).toBe("1:8:0:1");
  });
  it("rejects invalid keys before removal and suppresses outgoing narrowing", async () => {
    const f = await fixture();
    expect(
      Exit.isFailure(await Effect.runPromise(f.source.set(active(NaN)).pipe(Effect.exit))),
    ).toBe(true);
    expect(f.target.textContent).toBe("1:0:0:1");
    await Effect.runPromise(f.source.set({ _tag: "Empty" }));
    expect(f.target.textContent).toBe("");
    expect(f.failures).toEqual([]);
    expect(Exit.isFailure(await Effect.runPromise(f.lens.get.pipe(Effect.exit)))).toBe(true);
  });
  it("isolates mounted occurrences and removes writable capabilities for read-only sources", async () => {
    const f = await fixture();
    Effect.runSync(f.ctx.h(f.target, [f.selection, f.selection]));
    await rendered({ parent: f.parent, check: () => f.factories() === 3 });
    expect(Exit.isFailure(await Effect.runPromise(f.lens.get.pipe(Effect.exit)))).toBe(true);
    const readOnly = readonlySignal(f.source);
    const ready = Deferred.makeUnsafe<boolean>();
    const read = branch<Active, Signal<Active>>()(({ inputs }) => {
      Effect.runSync(Deferred.succeed(ready, "set" in inputs.state));
      return Sync.succeed({ setup: () => Effect.succeed([]) });
    });
    const empty = branch<{ readonly _tag: "Empty" }, Signal<{ readonly _tag: "Empty" }>>()(() =>
      Sync.succeed({ setup: () => Effect.succeed([]) }),
    );
    Effect.runSync(
      f.ctx.h(
        f.target,
        cases({
          state: readOnly,
          branches: { Active: { branch: read }, Empty: { branch: empty } },
        }),
      ),
    );
    expect(await Effect.runPromise(Deferred.await(ready))).toBe(false);
  });
  it("detects concurrent conflicts and rejects child-fiber lens writes", async () => {
    const f = await fixture();
    const staged = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const batch = Effect.runFork(
      f.ctx.batch(
        Effect.gen(function* () {
          yield* f.lens.update((state) => ({ ...state, fields: { ...state.fields, left: 1 } }));
          yield* Deferred.succeed(staged, undefined);
          yield* Deferred.await(release);
        }),
      ),
    );
    await Effect.runPromise(Deferred.await(staged));
    await Effect.runPromise(
      f.lens.update((state) => ({ ...state, fields: { ...state.fields, right: 2 } })),
    );
    await Effect.runPromise(Deferred.succeed(release, undefined));
    expect(Exit.isFailure(await Effect.runPromise(Fiber.await(batch)))).toBe(true);
    expect(f.target.textContent).toBe("1:0:2:1");
    expect(
      Exit.isFailure(
        await Effect.runPromise(
          f.ctx
            .batch(
              Effect.gen(function* () {
                const child = yield* f.lens.set(active()).pipe(Effect.forkChild);
                yield* Fiber.join(child);
              }),
            )
            .pipe(Effect.exit),
        ),
      ),
    ).toBe(true);
  });
});

it("updates pending input/fallback without restarting setup and isolates superseded output", async () => {
  const test = await harness();
  const source = await Effect.runPromise(test.ctx.signal<State>({ initial: active() }));
  const release = Deferred.makeUnsafe<void>();
  const started = Deferred.makeUnsafe<void>();
  let factories = 0;
  const pending = branch<Active>()(({ context, inputs }) =>
    Sync.gen(function* () {
      factories += 1;
      const label = yield* context.derive({
        sources: { state: inputs.state },
        compute: ({ state }) => `pending:${state.id}:${state.fields.left}`,
      });
      const readyLabel = yield* context.derive({
        sources: { state: inputs.state },
        compute: ({ state }) => `ready:${state.id}:${state.fields.left}`,
      });
      return {
        fallback: (context) => context.he("span", { children: [label] }),
        setup: (context) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release).pipe(Effect.uninterruptible);
            return yield* context.he("output", { children: [readyLabel] });
          }),
      };
    }),
  );
  Effect.runSync(
    test.ctx.h(
      test.target,
      cases({
        state: source,
        branches: {
          Active: { branch: pending, key: (state) => state.id },
          Empty: { branch: Empty },
        },
      }),
    ),
  );
  await Effect.runPromise(Deferred.await(started));
  expect(test.target.textContent).toBe("pending:1:0");
  await Effect.runPromise(source.set({ ...active(), fields: { left: 4, right: 0 } }));
  expect(test.target.textContent).toBe("pending:1:4");
  expect(factories).toBe(1);
  await Effect.runPromise(source.set(active(2)));
  expect(test.target.textContent).toBe("pending:2:0");
  await Effect.runPromise(Deferred.succeed(release, undefined));
  await rendered({ parent: test.parent, check: () => test.target.textContent === "ready:2:0" });
  expect(factories).toBe(2);
  expect(test.failures).toEqual([]);
});

it("retries failed branch setup only on identity change and performs no aborted factory work", async () => {
  const reported = Deferred.makeUnsafe<void>();
  const test = await harness({
    onError: () => {
      Deferred.doneUnsafe(reported, Effect.void);
    },
  });
  const source = await Effect.runPromise(test.ctx.signal<State>({ initial: { _tag: "Empty" } }));
  let starts = 0;
  const failed = branch<Active>()(() =>
    Sync.succeed({
      setup: () =>
        Effect.sync(() => {
          starts += 1;
        }).pipe(Effect.andThen(Effect.fail("setup failed"))),
    }),
  );
  Effect.runSync(
    test.ctx.h(
      test.target,
      cases({
        state: source,
        branches: {
          Active: { branch: failed, key: (state) => state.id },
          Empty: { branch: Empty },
        },
      }),
    ),
  );
  await Effect.runPromise(
    test.ctx
      .batch(source.set(active()).pipe(Effect.andThen(Effect.fail("rollback"))))
      .pipe(Effect.exit),
  );
  expect(starts).toBe(0);
  await Effect.runPromise(source.set(active()));
  await Effect.runPromise(Deferred.await(reported));
  expect(starts).toBe(1);
  expect(test.target.textContent).toBe("");
  await Effect.runPromise(source.set({ ...active(), fields: { left: 10, right: 0 } }));
  expect(starts).toBe(1);
  await Effect.runPromise(source.set({ _tag: "Empty" }));
  await Effect.runPromise(source.set(active()));
  const barrier = Deferred.makeUnsafe<void>();
  // Queued owned work provides a deterministic barrier after the restarted setup.
  await Effect.runPromise(
    test.ctx.fork(Effect.yieldNow.pipe(Effect.andThen(Deferred.succeed(barrier, undefined)))),
  );
  await Effect.runPromise(Deferred.await(barrier));
  expect(starts).toBe(2);
});

it("validates malformed setters and projections, preserves one source commit, and replaces descriptors", async () => {
  const f = await fixture();
  const malformed: unknown = { _tag: "Empty" };
  // @ts-expect-error Untyped callers cannot replace another variant through a lens.
  expect(Exit.isFailure(await Effect.runPromise(f.lens.set(malformed).pipe(Effect.exit)))).toBe(
    true,
  );
  const invalidKey: unknown = "_tag";
  expect(
    Exit.isFailure(
      Effect.runSync(
        // @ts-expect-error Discriminant projection is rejected at the runtime boundary too.
        Sync.toEffect(focus({ context: f.ctx, source: f.lens, key: invalidKey })).pipe(Effect.exit),
      ),
    ),
  ).toBe(true);
  let commits = 0;
  const disconnect = signalData(f.source).bind({
    validate: () => Result.succeed(undefined),
    flush: () =>
      Effect.sync(() => {
        commits += 1;
      }),
  });
  await Effect.runPromise(
    f.ctx.batch(
      Effect.gen(function* () {
        yield* f.lens.update((value) => ({ ...value, fields: { ...value.fields, left: 1 } }));
        yield* f.lens.update((value) => ({ ...value, fields: { ...value.fields, right: 2 } }));
      }),
    ),
  );
  expect(commits).toBe(1);
  disconnect();
  const replacement = branch<Active>()(({ context }) =>
    Sync.gen(function* () {
      const output = yield* context.he("span", { children: ["replacement"] });
      return { setup: () => Effect.succeed(output) };
    }),
  );
  Reflect.set(f.selection.branches, "Active", { branch: replacement });
  await Effect.runPromise(f.source.set(active()));
  await rendered({ parent: f.parent, check: () => f.target.textContent === "replacement" });
  expect(Exit.isFailure(await Effect.runPromise(f.lens.get.pipe(Effect.exit)))).toBe(true);
});

it("reports adoption-time branch planning failures as typed errors", async () => {
  const reported = Deferred.makeUnsafe<void>();
  const test = await harness({
    onError: () => {
      Deferred.doneUnsafe(reported, Effect.void);
    },
  });
  const source = await Effect.runPromise(test.ctx.signal<State>({ initial: active() }));
  let rejectKey = false;
  let factories = 0;
  const activeBranch = branch<Active>()(() => {
    factories += 1;
    return Sync.succeed({ setup: (context) => context.he("output", { children: ["ready"] }) });
  });
  const selection = cases({
    state: source,
    branches: {
      Active: {
        branch: activeBranch,
        key: (state) =>
          Match.value(rejectKey).pipe(
            Match.when(true, () => NaN),
            Match.orElse(() => state.id),
          ),
      },
      Empty: { branch: Empty },
    },
  });
  Effect.runSync(
    test.ctx.h(
      test.target,
      component(() =>
        Sync.succeed({
          setup: (context) =>
            Effect.gen(function* () {
              const output = yield* context.he("section", { children: [selection] });
              // Construction succeeds, but adoption must validate the latest plan again.
              rejectKey = true;
              return output;
            }),
        }),
      ),
    ),
  );
  await Effect.runPromise(Deferred.await(reported));
  expect(test.failures).toHaveLength(1);
  for (const failure of test.failures) {
    expect(Option.getOrThrow(Cause.findErrorOption(failure.cause))).toBeInstanceOf(ReactiveError);
  }
  expect(factories).toBe(0);
  rejectKey = false;
  Effect.runSync(test.ctx.h(test.target, selection));
  await rendered({ parent: test.parent, check: () => test.target.textContent === "ready" });
  expect(factories).toBe(1);
});
