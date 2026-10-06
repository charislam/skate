import { Deferred, Effect, Exit, Match, Option, Result, Scope, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  component,
  keyed,
  mounting,
  row,
  type ComponentContext,
  type Key,
  type MountFailure,
  type RowInputs,
  type Signal,
} from "./framework";
import { planKeyed } from "./keyed";
import { signalData } from "./reactive/signal";
import { rendered } from "./test-helpers";

const run = Effect.runPromise;

const cleanups: Array<() => Promise<void>> = [];
const gates: Array<Deferred.Deferred<void>> = [];
const gate = () => {
  const value = Deferred.makeUnsafe<void>();
  gates.push(value);
  return value;
};
const open = (value: Deferred.Deferred<void>) => run(Deferred.succeed(value, undefined));

afterEach(async () => {
  for (const value of gates.splice(0)) await open(value);
  for (const close of cleanups.splice(0)) await close();
  document.body.replaceChildren();
});

const harness = async (onError: (failure: MountFailure) => void = () => {}) => {
  const scope = await run(Scope.make());
  const failures: MountFailure[] = [];
  const reported = Deferred.makeUnsafe<void>();
  const app = await run(
    mounting({
      scope,
      onError: (failure) => {
        failures.push(failure);
        Effect.runSync(Deferred.succeed(reported, undefined));
        onError(failure);
      },
    }),
  );
  const parent = document.createElement("div");
  document.body.append(parent);
  const close = () => run(Scope.close(scope, Exit.void));
  cleanups.push(close);
  return { app, parent, failures, close, reported };
};

interface Item {
  readonly id: Key;
  readonly label: string;
  readonly alternate?: boolean;
}

const shows = (options: { parent: Node; text: string }) =>
  rendered({ parent: options.parent, check: () => options.parent.textContent === options.text });

const labelRow = row<Item>()(({ context, inputs }) =>
  Result.gen(function* () {
    const label = yield* context.derive({
      sources: { item: inputs.item, index: inputs.index },
      compute: ({ item, index }) => `${index}:${item.label};`,
    });
    return { setup: ({ he }) => he("span", { children: [label] }) };
  }),
);

describe("keyed lists", () => {
  it("preserves occurrences and native editing state through insert, update, reorder, and removal", async () => {
    const { app, parent, failures } = await harness();
    const a = { id: "a", label: "A" };
    const b = { id: "b", label: "B" };
    const items = await run(app.signal<ReadonlyArray<Item>>({ initial: [a, b] }));
    let factories = 0;
    let finalized = 0;
    const inputsByKey = new Map<Key, RowInputs<Item>>();
    const editable = row<Item>()(({ context, inputs }) =>
      Result.gen(function* () {
        factories++;
        inputsByKey.set(inputs.key, inputs);
        const draft = yield* context.signal({ initial: "draft" });
        yield* context.addSyncFinalizer(() => {
          finalized++;
        });
        const label = yield* context.derive({
          sources: { item: inputs.item, index: inputs.index },
          compute: ({ item, index }) => `${index}:${item.label};`,
        });
        return {
          setup: (ctx) =>
            Effect.gen(function* () {
              const input = yield* ctx.he("input", { props: { type: "text" } });
              yield* ctx.bindValue({ element: input, signal: draft });
              return [yield* ctx.he("span", { children: [label] }), input];
            }),
        };
      }),
    );
    const tree = await run(
      app.he("section", {
        children: [
          "before",
          keyed({ items, key: (item) => item.id, row: () => editable }),
          "after",
        ],
      }),
    );
    expect(factories).toBe(0);
    app.h(parent, tree);
    await shows({ parent, text: "before0:A;1:B;after" });
    const original = Array.from(parent.querySelectorAll("input"));
    const first = original[0];
    expect(first).toBeDefined();
    first?.focus();
    first?.setSelectionRange(1, 3, "backward");
    const oldInputs = inputsByKey.get("a");
    await run(items.set([b, { ...a, label: "new A" }]));
    expect(parent.textContent).toBe("before0:B;1:new A;after");
    expect(Array.from(parent.querySelectorAll("input"))).toEqual([original[1], first]);
    expect(document.activeElement).toBe(first);
    expect([first?.selectionStart, first?.selectionEnd, first?.selectionDirection]).toEqual([
      1,
      3,
      "backward",
    ]);
    expect(inputsByKey.get("a")).toBe(oldInputs);
    expect(oldInputs?.item).not.toHaveProperty("set");
    expect(factories).toBe(2);
    expect(finalized).toBe(0);
    const c = { id: "c", label: "C" };
    await run(items.set([c, a, b]));
    await shows({ parent, text: "before0:C;1:A;2:B;after" });
    await run(items.set([a, b]));
    expect(finalized).toBe(1);
    await run(items.set([]));
    expect(parent.textContent).toBe("beforeafter");
    expect(finalized).toBe(3);
    expect(failures).toEqual([]);
  });

  it("rejects invalid snapshots and selectors atomically, with strict key domains", async () => {
    const { app, parent } = await harness();
    const initial = [
      { id: 1, label: "number" },
      { id: "1", label: "string" },
    ];
    const items = await run(app.signal<ReadonlyArray<Item>>({ initial }));
    const selectorCause = new Error("selector");
    const list = keyed({
      items,
      key: (item) =>
        Match.value(item.label).pipe(
          Match.when("throw", () => {
            throw selectorCause;
          }),
          Match.orElse(() => item.id),
        ),
      row: () => labelRow,
    });
    app.h(parent, list);
    await shows({ parent, text: "0:number;1:string;" });
    const nodes = Array.from(parent.childNodes);
    for (const candidate of [
      [
        { id: 0, label: "zero" },
        { id: -0, label: "negative zero" },
      ],
      [{ id: NaN, label: "nan" }],
      [{ id: Infinity, label: "infinite" }],
      [{ id: "x", label: "throw" }],
      [
        { id: "x", label: "A" },
        { id: "x", label: "B" },
      ],
    ]) {
      const result = await run(items.set(candidate).pipe(Effect.result));
      expect(Result.isFailure(result)).toBe(true);
      Match.value(candidate.some((item) => item.label === "throw")).pipe(
        Match.when(true, () =>
          Result.match(result, {
            onFailure: (error) => expect(error.cause).toBe(selectorCause),
            onSuccess: () => {
              throw new Error("Expected selector failure");
            },
          }),
        ),
        Match.orElse(() => {}),
      );
      expect(await run(items.get)).toBe(initial);
      expect(Array.from(parent.childNodes)).toEqual(nodes);
    }
  });

  it("propagates plan failures through staged derived reads without wrapping errors or running downstream compute", async () => {
    const { app, parent } = await harness();
    const initial = [{ id: "a", label: "A" }];
    const items = await run(app.signal<ReadonlyArray<Item>>({ initial }));
    let snapshot = Option.none<Signal<string>>();
    let computations = 0;
    const descriptor = row<Item>()(({ context, inputs }) =>
      Result.gen(function* () {
        const label = yield* context.derive({
          sources: { item: inputs.item, index: inputs.index },
          compute: ({ item, index }) => {
            computations++;
            return `${index}:${item.label}`;
          },
        });
        snapshot = Option.some(label);
        return { setup: ({ he }) => he("span", { children: [label] }) };
      }),
    );
    app.h(parent, keyed({ items, key: (item) => item.id, row: () => descriptor }));
    await shows({ parent, text: "0:A" });
    const label = Option.getOrThrow(snapshot);
    const before = computations;
    const result = await run(
      app
        .batch(
          Effect.gen(function* () {
            yield* items.set([
              { id: "a", label: "B" },
              { id: "a", label: "C" },
            ]);
            const read = yield* label.get.pipe(Effect.result);
            Result.match(read, {
              onFailure: (error) => expect(error.message).toBe("Duplicate list key: a"),
              onSuccess: () => {
                throw new Error("Expected invalid staged plan to fail the read");
              },
            });
            yield* items.set(initial);
          }),
        )
        .pipe(Effect.result),
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(computations).toBe(before);
    expect(await run(items.get)).toBe(initial);
    expect(parent.textContent).toBe("0:A");
  });

  it("updates item, index, and parent dependencies in one snapshot and rolls back invalid retained bindings", async () => {
    const { app, parent } = await harness();
    const a = { id: "a", label: "A" };
    const b = { id: "b", label: "B" };
    const items = await run(app.signal<ReadonlyArray<Item>>({ initial: [a, b] }));
    const suffix = await run(app.signal({ initial: "old" }));
    const observed: string[] = [];
    const ready = gate();
    const initialObservations = gate();
    const committedObservations = gate();
    let subscriptions = 0;
    const checked = row<Item>()(({ context, inputs }) =>
      Result.gen(function* () {
        const snapshot = yield* context.derive({
          sources: { item: inputs.item, index: inputs.index, suffix },
          compute: ({ item, index, suffix }) => `${item.label}:${index}:${suffix};`,
        });
        const title = yield* context.derive({
          sources: { item: inputs.item },
          compute: ({ item }) => {
            return Match.value(item.label === "invalid").pipe(
              Match.when(true, () => "bad attribute" as unknown as Option.Option<string>),
              Match.when(false, () => Option.some(item.label)),
              Match.exhaustive,
            );
          },
        });
        return {
          setup: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.fork(
                snapshot.changes.pipe(
                  Effect.flatMap((stream) =>
                    Stream.runForEach(stream, (value) =>
                      Effect.sync(() => {
                        observed.push(value);
                        Match.value(observed.length).pipe(
                          Match.when(2, () =>
                            Effect.runSync(Deferred.succeed(initialObservations, undefined)),
                          ),
                          Match.when(4, () =>
                            Effect.runSync(Deferred.succeed(committedObservations, undefined)),
                          ),
                          Match.orElse(() => {}),
                        );
                      }),
                    ),
                  ),
                ),
              );
              subscriptions++;
              Match.value(subscriptions === 2).pipe(
                Match.when(true, () => Effect.runSync(Deferred.succeed(ready, undefined))),
                Match.orElse(() => {}),
              );
              return yield* ctx.he("span", { attrs: { title }, children: [snapshot] });
            }),
        };
      }),
    );
    app.h(parent, keyed({ items, key: (item) => item.id, row: () => checked }));
    await run(Deferred.await(ready));
    await shows({ parent, text: "A:0:old;B:1:old;" });
    await run(Deferred.await(initialObservations));
    await run(
      app.batch(
        Effect.gen(function* () {
          yield* suffix.set("new");
          yield* items.set([{ ...b, label: "BB" }, a]);
        }),
      ),
    );
    expect(parent.textContent).toBe("BB:0:new;A:1:new;");
    await run(Deferred.await(committedObservations));
    const exit = await run(
      app
        .batch(
          Effect.gen(function* () {
            yield* suffix.set("rejected");
            yield* items.set([{ ...a, label: "invalid" }, b]);
          }),
        )
        .pipe(Effect.result),
    );
    expect(Result.isFailure(exit)).toBe(true);
    expect(await run(suffix.get)).toBe("new");
    expect(parent.textContent).toBe("BB:0:new;A:1:new;");
    await run(Effect.yieldNow);
    expect(observed).toHaveLength(4);
    expect(new Set(observed)).toEqual(new Set(["A:0:old;", "B:1:old;", "BB:0:new;", "A:1:new;"]));
  });

  it("replaces descriptors and isolates identity between mounts, with disposal on filtered removal", async () => {
    const { app, parent, close } = await harness();
    const a = { id: "a", label: "A" };
    const b = { id: "b", label: "B" };
    const items = await run(app.signal<ReadonlyArray<Item>>({ initial: [a, b] }));
    let factories = 0;
    let finalizers = 0;
    const regular = row<Item>()(({ context }) =>
      Result.gen(function* () {
        factories++;
        yield* context.addSyncFinalizer(() => {
          finalizers++;
        });
        return { setup: ({ he }) => he("b", { children: ["regular"] }) };
      }),
    );
    const alternate = row<Item>()(() =>
      Result.succeed({ setup: ({ he }) => he("i", { children: ["alternate"] }) }),
    );
    const list = keyed({
      items,
      key: (item) => item.id,
      row: (item) =>
        Match.value(item.alternate === true).pipe(
          Match.when(true, () => alternate),
          Match.orElse(() => regular),
        ),
    });
    app.h(parent, [list, list]);
    await shows({ parent, text: "regularregularregularregular" });
    expect(factories).toBe(4);
    await run(items.set([{ ...a, alternate: true }, b]));
    await shows({ parent, text: "alternateregularalternateregular" });
    expect(finalizers).toBe(2);
    expect(factories).toBe(4);
    await run(items.set([b]));
    expect(parent.textContent).toBe("regularregular");
    await run(items.set([a, b]));
    await shows({ parent, text: "regularregularregularregular" });
    expect(factories).toBe(6);
    await close();
    expect(finalizers).toBe(6);
    expect(signalData(items).participant.dependents.size).toBe(0);
  });

  it("moves and updates pending fallbacks without restarting setup, adopting into the current position", async () => {
    const { app, parent } = await harness();
    const release = gate();
    const started = gate();
    let starts = 0;
    let fallbackFinalizers = 0;
    const items = await run(
      app.signal<ReadonlyArray<Item>>({
        initial: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }),
    );
    const slow = row<Item>()(({ context, inputs }) =>
      Result.gen(function* () {
        const label = yield* context.derive({
          sources: { item: inputs.item, index: inputs.index },
          compute: ({ item, index }) => `${item.label}:${index}`,
        });
        return {
          fallback: (ctx) =>
            Result.gen(function* () {
              yield* ctx.addSyncFinalizer(() => {
                fallbackFinalizers++;
              });
              return yield* ctx.he("em", { children: [label] });
            }),
          setup: (ctx) =>
            Effect.gen(function* () {
              starts++;
              Match.value(starts === 2).pipe(
                Match.when(true, () => Effect.runSync(Deferred.succeed(started, undefined))),
                Match.orElse(() => {}),
              );
              yield* Deferred.await(release);
              return yield* ctx.he("strong", { children: [label] });
            }),
        };
      }),
    );
    app.h(parent, keyed({ items, key: (item) => item.id, row: () => slow }));
    await run(Deferred.await(started));
    const first = parent.querySelector("em");
    await run(
      items.set([
        { id: "b", label: "BB" },
        { id: "a", label: "AA" },
      ]),
    );
    expect(parent.textContent).toBe("BB:0AA:1");
    expect(parent.querySelectorAll("em")[1]).toBe(first);
    expect(starts).toBe(2);
    expect(fallbackFinalizers).toBe(0);
    await open(release);
    await rendered({ parent, check: () => parent.querySelectorAll("strong").length === 2 });
    expect(parent.textContent).toBe("BB:0AA:1");
    expect(fallbackFinalizers).toBe(2);
  });

  it("retries failed rows once per committed item change, preserving other rows and index-only changes", async () => {
    const { app, parent, failures } = await harness(() => {
      throw new Error("reporter");
    });
    let attempts = 0;
    const bad = { id: "bad", label: "bad" };
    const good = { id: "good", label: "good" };
    const items = await run(app.signal<ReadonlyArray<Item>>({ initial: [bad, good] }));
    const flaky = row<Item>()(({ inputs }) => {
      return Match.value(inputs.key === "bad").pipe(
        Match.when(true, () => {
          attempts++;
          return Result.fail("factory failure");
        }),
        Match.when(false, () =>
          Result.succeed({
            setup: ({ he }: ComponentContext) => he("span", { children: ["good"] }),
          }),
        ),
        Match.exhaustive,
      );
    });
    app.h(parent, keyed({ items, key: (item) => item.id, row: () => flaky }));
    await shows({ parent, text: "good" });
    expect(attempts).toBe(1);
    await run(items.set([good, bad]));
    expect(attempts).toBe(1);
    await run(
      app.batch(
        Effect.gen(function* () {
          yield* items.set([good, { ...bad }]);
          yield* items.set([good, bad]);
        }),
      ),
    );
    expect(attempts).toBe(1);
    await run(items.set([good, { ...bad }]));
    expect(attempts).toBe(2);
    const last = await run(items.get);
    await run(items.set([...last]));
    expect(attempts).toBe(2);
    expect(
      Result.isFailure(await run(items.set([{ ...bad }, { ...bad }]).pipe(Effect.result))),
    ).toBe(true);
    expect(attempts).toBe(2);
    await run(items.set([good]));
    await run(items.set([good, bad]));
    expect(attempts).toBe(3);
    expect(failures.map((failure) => failure.operation)).toEqual(["factory", "factory", "factory"]);
    expect(
      failures.every((failure) =>
        Match.value(failure.subject).pipe(
          Match.when({ kind: "component" }, (subject) =>
            Option.exists(subject.row, (row) => row.key === "bad"),
          ),
          Match.orElse(() => false),
        ),
      ),
    ).toBe(true);
  });

  it("waits for the next item change after pending setup fails rather than retrospectively retrying", async () => {
    const { app, parent, reported } = await harness();
    const release = gate();
    const started = gate();
    let attempts = 0;
    const items = await run(
      app.signal<ReadonlyArray<Item>>({ initial: [{ id: "a", label: "A" }] }),
    );
    const failing = row<Item>()(() => {
      attempts++;
      return Result.succeed({
        fallback: ({ he }) => he("em", { children: ["pending"] }),
        setup: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Effect.fail("setup failed")),
          ),
      });
    });
    app.h(parent, keyed({ items, key: (item) => item.id, row: () => failing }));
    await run(Deferred.await(started));
    const changed = { id: "a", label: "changed" };
    await run(items.set([changed]));
    expect(attempts).toBe(1);
    await open(release);
    await run(Deferred.await(reported));
    expect(parent.textContent).toBe("");
    await run(items.set([changed]));
    expect(attempts).toBe(1);
    await run(items.set([{ ...changed }]));
    expect(attempts).toBe(2);
  });

  it("does no lifecycle work for aborted batches and rejects foreign row inputs", async () => {
    const { app, parent } = await harness();
    const item = { id: "a", label: "A" };
    const items = await run(app.signal<ReadonlyArray<Item>>({ initial: [item] }));
    let factories = 0;
    let finalized = 0;
    let captured = Option.none<Signal<Item>>();
    const descriptor = row<Item>()(({ context, inputs }) =>
      Result.gen(function* () {
        factories++;
        captured = Option.some(inputs.item);
        yield* context.addSyncFinalizer(() => {
          finalized++;
        });
        return { setup: ({ he }) => he("span", { children: ["row"] }) };
      }),
    );
    app.h(parent, keyed({ items, key: (item) => item.id, row: () => descriptor }));
    await shows({ parent, text: "row" });
    await run(
      app.batch(items.set([]).pipe(Effect.andThen(Effect.fail("abort")))).pipe(Effect.result),
    );
    expect(factories).toBe(1);
    expect(finalized).toBe(0);
    expect(parent.textContent).toBe("row");
    const input = Option.getOrThrow(captured);
    expect(
      Result.isFailure(
        await run(
          app
            .derive({ sources: { input }, compute: ({ input }) => input.label })
            .pipe(Effect.result),
        ),
      ),
    ).toBe(true);
    await run(items.set([]));
    expect(finalized).toBe(1);
    expect(Result.isFailure(await run(input.get.pipe(Effect.result)))).toBe(true);
  });

  it("suppresses invalid descendant computations and nested list activation when an ancestor row retires", async () => {
    const { app, parent } = await harness();
    const items = await run(
      app.signal<ReadonlyArray<Item>>({ initial: [{ id: "a", label: "A" }] }),
    );
    const trigger = await run(app.signal({ initial: false }));
    let deepItems: Signal<ReadonlyArray<Item>> = items;
    for (let depth = 0; depth < 3; depth++) {
      deepItems = await run(
        app.derive({ sources: { items: deepItems }, compute: ({ items }) => items }),
      );
    }
    let innerFactories = 0;
    const child = row<Item>()(() => {
      innerFactories++;
      return Result.succeed({ setup: ({ he }) => he("b", { children: ["inner"] }) });
    });
    const outer = row<Item>()(({ context }) =>
      Result.gen(function* () {
        const inner = yield* context.derive({
          sources: { trigger },
          compute: ({ trigger }) => {
            return Match.value(trigger).pipe(
              Match.when(true, () => {
                throw new Error("retired computation must be skipped");
              }),
              Match.when(false, () => [{ id: "x", label: "X" }]),
              Match.exhaustive,
            );
          },
        });
        return {
          setup: () =>
            Effect.succeed(keyed({ items: inner, key: (item) => item.id, row: () => child })),
        };
      }),
    );
    app.h(parent, keyed({ items: deepItems, key: (item) => item.id, row: () => outer }));
    await shows({ parent, text: "inner" });
    await run(
      app.batch(
        Effect.gen(function* () {
          yield* trigger.set(true);
          yield* items.set([]);
        }),
      ),
    );
    expect(parent.textContent).toBe("");
    expect(innerFactories).toBe(1);
  });

  it("validates untyped keys, snapshots, and row descriptors before construction or commit", async () => {
    const { app, parent, failures } = await harness();
    const items = await run(app.signal<ReadonlyArray<Item>>({ initial: [] }));
    let keyValue: unknown = "valid";
    let descriptorValue: unknown = labelRow;
    const list = keyed({ items, key: () => "valid", row: () => labelRow });
    // Reflect simulates untyped JavaScript callers at the validation boundary.
    Reflect.set(list, "key", () => keyValue);
    Reflect.set(list, "row", () => descriptorValue);
    for (const invalid of [null, undefined, {}, Symbol("key"), NaN, Infinity, -Infinity]) {
      keyValue = invalid;
      expect(Result.isFailure(planKeyed({ description: list, value: [{}] }))).toBe(true);
    }
    keyValue = "valid";
    for (const invalid of [null, undefined, {}, labelRow.factory]) {
      descriptorValue = invalid;
      expect(Result.isFailure(planKeyed({ description: list, value: [{}] }))).toBe(true);
    }
    descriptorValue = labelRow;
    expect(Result.isFailure(planKeyed({ description: list, value: null }))).toBe(true);
    expect(Result.isSuccess(planKeyed({ description: list, value: [{}] }))).toBe(true);
    const invalidItems = await run(
      app.signal<ReadonlyArray<Item>>({ initial: [{ id: NaN, label: "invalid" }] }),
    );
    const invalid = keyed({ items: invalidItems, key: (item) => item.id, row: () => labelRow });
    expect(
      Result.isFailure(await run(app.he("div", { children: [invalid] }).pipe(Effect.result))),
    ).toBe(true);
    app.h(parent, invalid);
    expect(failures.map((failure) => failure.operation)).toEqual(["validation"]);
    expect(parent.childNodes).toHaveLength(0);
  });

  it("adopts the latest snapshot and skips unused construction and superseded deferred row setup", async () => {
    const { app, parent } = await harness();
    const items = await run(
      app.signal<ReadonlyArray<Item>>({ initial: [{ id: "a", label: "A" }] }),
    );
    let factories = 0;
    let setups = 0;
    let finalizers = 0;
    const descriptor = row<Item>()(({ context }) =>
      Result.gen(function* () {
        factories++;
        yield* context.addSyncFinalizer(() => {
          finalizers++;
        });
        return {
          fallback: ({ he }) => he("b", { children: ["pending"] }),
          setup: () =>
            Effect.sync(() => {
              setups++;
              return [];
            }),
        };
      }),
    );
    const list = keyed({ items, key: (item) => item.id, row: () => descriptor });
    const unused = await run(app.he("div", { children: [list] }));
    await run(items.set([]));
    app.h(parent, unused);
    await rendered({ parent, check: () => parent.contains(unused) });
    expect(factories).toBe(0);
    const enclosing = component(() =>
      Result.succeed({
        fallback: ({ he }) => he("section", { children: [list] }),
        setup: () => Effect.succeed(document.createTextNode("ready")),
      }),
    );
    await run(items.set([{ id: "a", label: "A" }]));
    expect(factories).toBe(1);
    // Two admitted replacements retire the enclosing fallback before its row setup starts.
    app.h(parent, enclosing);
    app.h(parent, document.createTextNode("replacement"));
    await shows({ parent, text: "replacement" });
    expect(finalizers).toBe(factories);
    expect(setups).toBeLessThan(factories);
  });

  it("revokes removed setup authority even when uninterruptible old setup completes after reinsertion", async () => {
    const { app, parent, failures } = await harness();
    const release = gate();
    const started = gate();
    const finished = gate();
    const items = await run(
      app.signal<ReadonlyArray<Item>>({ initial: [{ id: "a", label: "old" }] }),
    );
    let attempts = 0;
    const descriptor = row<Item>()(() => {
      const attempt = ++attempts;
      return Result.succeed({
        setup: () =>
          Match.value(attempt).pipe(
            Match.when(1, () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release).pipe(Effect.uninterruptible);
                return document.createTextNode("obsolete");
              }).pipe(Effect.ensuring(Deferred.succeed(finished, undefined))),
            ),
            Match.orElse(() => Effect.succeed(document.createTextNode("fresh"))),
          ),
      });
    });
    app.h(parent, keyed({ items, key: (item) => item.id, row: () => descriptor }));
    await run(Deferred.await(started));
    await run(items.set([]));
    await run(items.set([{ id: "a", label: "new" }]));
    await shows({ parent, text: "fresh" });
    await open(release);
    await run(Deferred.await(finished));
    await run(Effect.yieldNow);
    expect(parent.textContent).toBe("fresh");
    expect(attempts).toBe(2);
    expect(failures).toEqual([]);
  });

  it("isolates fallback failures, supports empty rows, and preserves list binding lifetime independently of source", async () => {
    const { app, parent, failures } = await harness();
    const items = await run(
      app.signal<ReadonlyArray<Item>>({
        initial: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }),
    );
    const descriptor = row<Item>()(({ inputs }) =>
      Result.succeed({
        fallback: () => Result.fail("fallback"),
        setup: () =>
          Effect.succeed(
            Match.value(inputs.key).pipe(
              Match.when("a", () => []),
              Match.orElse(() => document.createTextNode("B")),
            ),
          ),
      }),
    );
    app.h(parent, keyed({ items, key: (item) => item.id, row: () => descriptor }));
    await shows({ parent, text: "B" });
    expect(failures.map((failure) => failure.operation)).toEqual(["fallback", "fallback"]);
    const empty = document.createTextNode("cleared");
    app.h(parent, empty);
    await shows({ parent, text: "cleared" });
    expect(signalData(items).participant.dependents.size).toBe(0);
    await run(items.set([{ id: "c", label: "C" }]));
    expect(parent.textContent).toBe("cleared");
  });

  it("keeps synchronous finalizers attached and waits for retired asynchronous cleanup at shutdown", async () => {
    const { app, parent, close } = await harness();
    const cleaning = gate();
    const release = gate();
    const items = await run(
      app.signal<ReadonlyArray<Item>>({ initial: [{ id: "a", label: "A" }] }),
    );
    let finalized = 0;
    const descriptor = row<Item>()(() =>
      Result.succeed({
        setup: (ctx) =>
          Effect.gen(function* () {
            const node = yield* ctx.he("span", { children: ["row"] });
            yield* ctx.addSyncFinalizer(() => {
              expect(parent.contains(node)).toBe(true);
              finalized++;
            });
            yield* Effect.addFinalizer(() =>
              Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release))),
            );
            return node;
          }),
      }),
    );
    app.h(parent, keyed({ items, key: (item) => item.id, row: () => descriptor }));
    await shows({ parent, text: "row" });
    await run(items.set([]));
    expect(finalized).toBe(1);
    expect(parent.textContent).toBe("");
    await run(Deferred.await(cleaning));
    await run(items.set([{ id: "a", label: "fresh" }]));
    await shows({ parent, text: "row" });
    let closed = false;
    const closing = close().then(() => {
      closed = true;
    });
    await run(Effect.yieldNow);
    expect(closed).toBe(false);
    await open(release);
    await closing;
    expect(finalized).toBe(2);
    expect(signalData(items).participant.dependents.size).toBe(0);
  });

  it("discards conflicting batches without retiring rows or resetting their current committed inputs", async () => {
    const { app, parent } = await harness();
    const staged = gate();
    const release = gate();
    const items = await run(
      app.signal<ReadonlyArray<Item>>({ initial: [{ id: "a", label: "A" }] }),
    );
    let finalized = 0;
    let factories = 0;
    const descriptor = row<Item>()(({ context, inputs }) =>
      Result.gen(function* () {
        factories++;
        yield* context.addSyncFinalizer(() => {
          finalized++;
        });
        const label = yield* context.derive({
          sources: { item: inputs.item },
          compute: ({ item }) => item.label,
        });
        return { setup: ({ he }) => he("span", { children: [label] }) };
      }),
    );
    app.h(parent, keyed({ items, key: (item) => item.id, row: () => descriptor }));
    await shows({ parent, text: "A" });
    const pending = run(
      app
        .batch(
          Effect.gen(function* () {
            yield* items.set([]);
            yield* Deferred.succeed(staged, undefined);
            yield* Deferred.await(release);
          }),
        )
        .pipe(Effect.result),
    );
    await run(Deferred.await(staged));
    await run(items.set([{ id: "a", label: "new committed value" }]));
    await open(release);
    expect(Result.isFailure(await pending)).toBe(true);
    expect(parent.textContent).toBe("new committed value");
    expect(factories).toBe(1);
    expect(finalized).toBe(0);
  });

  it("releases row dependencies through repeated add/remove cycles and honors source equality", async () => {
    const { app, parent } = await harness();
    const a = { id: "a", label: "A" };
    const items = await run(
      app.signal<ReadonlyArray<Item>>({
        initial: [a],
        equals: ({ previous, proposed }) => previous.length === proposed.length,
      }),
    );
    const list = keyed({ items, key: (item) => item.id, row: () => labelRow });
    app.h(parent, list);
    await shows({ parent, text: "0:A;" });
    await run(items.set([{ id: "a", label: "suppressed" }]));
    expect(await run(items.get)).toEqual([a]);
    expect(parent.textContent).toBe("0:A;");
    const plan = Option.getOrThrow(
      Option.fromUndefinedOr(Array.from(signalData(items).participant.dependents)[0]),
    );
    for (let cycle = 0; cycle < 20; cycle++) {
      await run(items.set([]));
      expect(plan.dependents.size).toBe(0);
      await run(items.set([a]));
      await shows({ parent, text: "0:A;" });
      expect(plan.dependents.size).toBe(2);
      expect(signalData(items).participant.dependents.size).toBe(1);
    }
  });
});
