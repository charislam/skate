import { Context, Effect, Match, Option, Result } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  component,
  ReactiveError,
  Sync,
  type ComponentContext,
  type DomEventTarget,
  type ElementOutput,
  type EventStream,
  type Signal,
  type SynchronousContext,
} from "./framework";
import { harness, rendered } from "./test-helpers";

describe("external UI library capabilities", () => {
  it("binds existing elements, preserves caller fields, and rejects conflicts before mutation", async () => {
    const h = await harness();
    const foreign = await harness();
    const signal = await Effect.runPromise(h.ctx.signal({ initial: false }));
    const expanded = await Effect.runPromise(
      h.ctx.derive({ sources: { signal }, compute: ({ signal }) => Option.some(String(signal)) }),
    );
    const element = await Effect.runPromise(
      h.ctx.he("button", {
        attrs: { class: Option.some("caller"), id: Option.some("existing") },
        props: { type: "button" },
      }),
    );
    await Effect.runPromise(
      h.ctx.bind({ element, attrs: { "aria-expanded": expanded }, props: { disabled: signal } }),
    );
    const conflict = await Effect.runPromise(
      h.ctx
        .bind({
          element,
          attrs: { title: Option.some("must not apply"), "aria-expanded": expanded },
        })
        .pipe(Effect.flip),
    );
    expect(conflict.message).toContain("Conflicting");
    const native = await Effect.runPromise(h.ctx.events(element, "click"));
    expect(native).toBeDefined();
    await h.adopt(element);
    const button = h.parent.querySelector("button");
    expect(button?.className).toBe("caller");
    expect(button?.id).toBe("existing");
    expect(button?.hasAttribute("title")).toBe(false);
    await Effect.runPromise(signal.set(true));
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(await Effect.runPromise(h.ctx.bind({ element }).pipe(Effect.flip))).toBeInstanceOf(
      ReactiveError,
    );
    const fresh = await Effect.runPromise(h.ctx.he("button"));
    expect(
      await Effect.runPromise(foreign.ctx.bind({ element: fresh }).pipe(Effect.flip)),
    ).toBeInstanceOf(ReactiveError);
    const other = await Effect.runPromise(foreign.ctx.signal({ initial: true }));
    expect(
      await Effect.runPromise(
        h.ctx.bind({ element: fresh, props: { disabled: other } }).pipe(Effect.flip),
      ),
    ).toBeInstanceOf(ReactiveError);
    // Failed validation did not reserve the disabled destination.
    await Effect.runPromise(h.ctx.bind({ element: fresh, props: { disabled: signal } }));
    const aliased = await Effect.runPromise(h.ctx.he("button"));
    expect(
      await Effect.runPromise(
        h.ctx
          .bind({ element: aliased, attrs: { hidden: expanded }, props: { hidden: signal } })
          .pipe(Effect.flip),
      ),
    ).toBeInstanceOf(ReactiveError);
    const invalid = await Effect.runPromise(h.ctx.he("div"));
    expect(
      await Effect.runPromise(
        h.ctx.bind({ element: invalid, attrs: { onclick: Option.some("bad") } }).pipe(Effect.flip),
      ),
    ).toBeInstanceOf(ReactiveError);
    await h.close();
    expect(
      await Effect.runPromise(h.ctx.bind({ element: fresh }).pipe(Effect.flip)),
    ).toBeInstanceOf(ReactiveError);
  });

  it("reads committed state synchronously, including during staging, with ownership checks", async () => {
    const h = await harness();
    const foreign = await harness();
    const state = await Effect.runPromise(h.ctx.signal({ initial: 1 }));
    await Effect.runPromise(
      h.ctx.batch(
        Effect.gen(function* () {
          yield* state.set(2);
          expect(yield* state.get).toBe(2);
          expect(Result.getOrThrow(h.ctx.readCommitted(state))).toBe(1);
        }),
      ),
    );
    expect(Result.getOrThrow(h.ctx.readCommitted(state))).toBe(2);
    expect(Result.isFailure(foreign.ctx.readCommitted(state))).toBe(true);
    await h.close();
    expect(Result.isFailure(h.ctx.readCommitted(state))).toBe(true);
  });

  it("watches committed changes synchronously, skips rollback, and stops at disposal", async () => {
    const h = await harness();
    const foreign = await harness();
    const signal = await Effect.runPromise(h.ctx.signal({ initial: 0 }));
    const values: number[] = [];
    await Effect.runPromise(
      h.ctx.watchSync({
        signal,
        onChange: (value) => {
          values.push(value);
        },
      }),
    );
    expect(values).toEqual([0]);
    await Effect.runPromise(
      h.ctx.batch(
        Effect.gen(function* () {
          yield* signal.set(1);
          yield* signal.set(2);
          expect(values).toEqual([0]);
        }),
      ),
    );
    expect(values).toEqual([0, 2]);
    await Effect.runPromise(
      h.ctx.batch(signal.set(3).pipe(Effect.andThen(Effect.fail("rollback")))).pipe(Effect.flip),
    );
    expect(values).toEqual([0, 2]);
    expect(
      await Effect.runPromise(
        foreign.ctx.watchSync({ signal, onChange: () => {} }).pipe(Effect.flip),
      ),
    ).toBeInstanceOf(ReactiveError);
    await h.close();
    expect(
      await Effect.runPromise(h.ctx.watchSync({ signal, onChange: () => {} }).pipe(Effect.flip)),
    ).toBeInstanceOf(ReactiveError);
    expect(values).toEqual([0, 2]);
  });

  it("disconnects a child watcher while its ancestor signal stays live", async () => {
    const h = await harness();
    const signal = await Effect.runPromise(h.ctx.signal({ initial: 0 }));
    const values: number[] = [];
    const child = component((context) =>
      Sync.gen(function* () {
        yield* context.watchSync({
          signal,
          onChange: (value) => {
            values.push(value);
          },
        });
        const output = yield* context.he("span");
        return { setup: () => Effect.succeed(output) };
      }),
    );
    Effect.runSync(h.ctx.h(h.target, child));
    await rendered({ parent: h.parent, check: () => h.target.querySelector("span") !== null });
    await Effect.runPromise(signal.set(1));
    expect(values).toEqual([0, 1]);
    Effect.runSync(h.ctx.h(h.target, []));
    await rendered({ parent: h.parent, check: () => h.target.childNodes.length === 0 });
    await Effect.runPromise(signal.set(2));
    expect(values).toEqual([0, 1]);
  });

  it("reports observer failures without undoing committed state", async () => {
    const h = await harness();
    const signal = await Effect.runPromise(h.ctx.signal({ initial: 0 }));
    expect(
      await Effect.runPromise(
        h.ctx
          .watchSync({
            signal,
            onChange: () => {
              throw new Error("initial");
            },
          })
          .pipe(Effect.flip),
      ),
    ).toBeInstanceOf(ReactiveError);
    await Effect.runPromise(
      h.ctx.watchSync({
        signal,
        onChange: (value) => {
          Match.value(value).pipe(
            Match.when(1, () => {
              throw new Error("committed");
            }),
            Match.orElse(() => {}),
          );
        },
      }),
    );
    await Effect.runPromise(signal.set(1));
    expect(Result.getOrThrow(h.ctx.readCommitted(signal))).toBe(1);
    await vi.waitFor(() => expect(h.failures).toHaveLength(1));
  });

  it("captures native document events, suppresses defaults synchronously, and removes listeners", async () => {
    const h = await harness();
    const button = document.createElement("button");
    expect(
      await Effect.runPromise(
        h.ctx.events(button as unknown as DomEventTarget, "click").pipe(Effect.flip),
      ),
    ).toBeInstanceOf(ReactiveError);
    document.body.append(button);
    let synchronous = 0;
    let delivered = 0;
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    try {
      const events = await Effect.runPromise(
        h.ctx.events(document, "keydown", {
          capture: true,
          synchronous: (event) => {
            synchronous++;
            event.preventDefault();
          },
        }),
      );
      await Effect.runPromise(
        h.ctx.subscribe(events, () =>
          Effect.sync(() => {
            delivered++;
          }),
        ),
      );
      const listener = added.mock.calls.find(([name]) => name === "keydown");
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
        bubbles: true,
      });
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(synchronous).toBe(1);
      await vi.waitFor(() => expect(delivered).toBe(1));
      await h.close();
      expect(removed.mock.calls).toContainEqual(["keydown", listener?.[1], true]);
      button.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
      expect(synchronous).toBe(1);
      expect(delivered).toBe(1);
    } finally {
      added.mockRestore();
      removed.mockRestore();
      button.remove();
    }
  });

  it("retains native event, property, and signal types through the public entry point", () => {
    class Label extends Context.Service<Label, string>()("ui-library-api/Label") {}
    const proof = (options: {
      context: ComponentContext;
      sync: SynchronousContext;
      button: ElementOutput<HTMLButtonElement>;
      signal: Signal<boolean>;
    }) => {
      expectTypeOf(options.context.readCommitted(options.signal)).toEqualTypeOf<
        Result.Result<boolean, ReactiveError>
      >();
      expectTypeOf(
        options.sync.bind({ element: options.button, props: { disabled: options.signal } }),
      ).toEqualTypeOf<Sync.Sync<void, ReactiveError>>();
      expectTypeOf(options.context.events(document, "keydown")).toEqualTypeOf<
        Effect.Effect<EventStream<KeyboardEvent>, ReactiveError>
      >();
      expectTypeOf(options.context.events(window, "resize")).toEqualTypeOf<
        Effect.Effect<EventStream<UIEvent>, ReactiveError>
      >();
      options.context.subscribe(
        Effect.runSync(options.context.events(document, "keydown")),
        () => Label,
      );
      // @ts-expect-error Button properties are native and retain their types.
      options.context.bind({ element: options.button, props: { disabled: "wrong" } });
      // @ts-expect-error DOM content replacement is not a supported binding.
      options.context.bind({ element: options.button, props: { innerHTML: "wrong" } });
      // @ts-expect-error Window names use WindowEventMap.
      options.context.events(window, "invented");
      options.context.events(document, "keydown", {
        // @ts-expect-error Document keydown handlers receive KeyboardEvent.
        synchronous: (event: MouseEvent) => {
          void event;
        },
      });
      expectTypeOf(
        options.context.subscribe(
          Effect.runSync(options.context.events(window, "resize")),
          () => Label,
        ),
      ).toEqualTypeOf<Effect.Effect<void, ReactiveError, Label>>();
    };
    void proof;
  });
});
