import { Effect, Match, Option } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { component } from "./framework";
import * as Popover from "./popover";
import * as Sync from "./sync";
import { harness, rendered } from "./test-helpers";

afterEach(() => vi.restoreAllMocks());

const fixture = async (initialOpen = false) => {
  const h = await harness();
  document.body.append(h.parent);
  type Api =
    ReturnType<typeof Popover.make> extends Sync.Sync<infer A, unknown, unknown> ? A : never;
  let api = Option.none<Api>();
  const demo = component((context) =>
    Sync.gen(function* () {
      const popover = yield* Popover.make({
        context,
        initialOpen,
        positioning: { placement: "bottom-end", gap: 8, padding: 12 },
      });
      api = Option.some(popover);
      const trigger = yield* context.he("button", { children: ["Open"] });
      const panel = yield* context.he("section", {
        attrs: { "aria-label": Option.some("Controls"), id: Option.some("existing-popover-panel") },
        children: [yield* context.he("button", { children: ["Action"] })],
      });
      yield* popover.attach({ trigger, panel });
      return { setup: () => Effect.succeed([trigger, panel]) };
    }),
  );
  Effect.runSync(h.ctx.h(h.target, [demo, demo]));
  await rendered({
    parent: h.parent,
    check: () => h.parent.querySelectorAll("section").length === 2,
  });
  const trigger =
    h.parent.querySelector<HTMLButtonElement>("button") ?? document.createElement("button");
  const panel = h.parent.querySelector<HTMLElement>("section") ?? document.createElement("section");
  const action = panel.querySelector("button") ?? document.createElement("button");
  return { ...h, trigger, panel, action, api: Option.getOrThrow(api) };
};

describe("headless popover", () => {
  it("keeps mounted content and independent occurrence relationships", async () => {
    const { parent, trigger, panel, action } = await fixture();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    expect(new Set([...parent.querySelectorAll("section")].map((node) => node.id)).size).toBe(2);
    trigger.click();
    await rendered({ parent, check: () => !panel.hidden });
    action.click();
    expect(panel.hidden).toBe(false);
    trigger.click();
    await rendered({ parent, check: () => panel.hidden === true });
    expect(panel.querySelector("button")).toBe(action);
    expect([...parent.querySelectorAll("section")][1]?.hidden).toBe(true);
  });

  it("handles Escape synchronously and restores focus only for the handled event", async () => {
    const { parent, trigger, panel, action } = await fixture(true);
    action.focus();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    action.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await rendered({ parent, check: () => panel.hidden === true });
    expect(document.activeElement).toBe(trigger);
    const closed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    trigger.dispatchEvent(closed);
    expect(closed.defaultPrevented).toBe(false);
  });

  it("dismisses outside pointer and focus without consuming native interactions", async () => {
    const { parent, trigger, panel } = await fixture(true);
    const outside = document.createElement("button");
    parent.append(outside);
    const pointer = new Event("pointerdown", { bubbles: true, cancelable: true, composed: true });
    outside.dispatchEvent(pointer);
    outside.focus();
    expect(pointer.defaultPrevented).toBe(false);
    await rendered({ parent, check: () => panel.hidden === true });
    expect(document.activeElement).toBe(outside);
    trigger.click();
    await rendered({ parent, check: () => !panel.hidden });
    trigger.focus();
    panel.querySelector("button")?.focus();
    expect(panel.hidden).toBe(false);
    outside.focus();
    await rendered({ parent, check: () => panel.hidden === true });
    expect(document.activeElement).toBe(outside);
  });

  it("exposes a readonly signal, closes programmatically, and retires its listeners", async () => {
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    const { parent, api, close, failures } = await fixture(true);
    const listeners = added.mock.calls.filter(
      ([name]) => name === "pointerdown" || name === "focusin",
    );
    expect(listeners).toHaveLength(4);
    expect("set" in api.isOpen).toBe(false);
    const panels = [...parent.querySelectorAll<HTMLElement>("section")];
    const panel = panels[1] ?? document.createElement("section");
    panel.querySelector("button")?.focus();
    await Effect.runPromise(api.close({ reason: { _tag: "Programmatic" } }));
    expect(panel.hidden).toBe(true);
    expect(document.activeElement?.getAttribute("aria-controls")).toBe(panel.id);
    await Effect.runPromise(api.open());
    await Effect.runPromise(api.open());
    expect(panel.hidden).toBe(false);
    const outside = document.createElement("button");
    parent.append(outside);
    outside.focus();
    await rendered({ parent, check: () => panel.hidden === true });
    await Effect.runPromise(api.close({ reason: { _tag: "Programmatic" } }));
    expect(document.activeElement).toBe(outside);
    for (let index = 0; index < 3; index++) {
      await Effect.runPromise(api.open());
      await Effect.runPromise(api.close({ reason: { _tag: "Programmatic" } }));
    }
    expect(
      added.mock.calls.filter(([name]) => name === "pointerdown" || name === "focusin"),
    ).toHaveLength(4);
    await close();
    for (const [name, listener, options] of listeners)
      expect(removed.mock.calls).toContainEqual([
        name,
        listener,
        Match.value(options).pipe(
          Match.when(
            (value) => typeof value === "boolean",
            (value) => value,
          ),
          Match.orElse((value) => value?.capture ?? false),
        ),
      ]);
    expect(failures).toEqual([]);
    parent.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });

  it("rejects duplicate attachments, conflicting bindings, and foreign owners", async () => {
    const h = await harness();
    const foreign = await harness();
    // Construction runs synchronously, before either pair is adopted.
    const check = component((context) =>
      Sync.gen(function* () {
        const api = yield* Popover.make({
          context,
          initialOpen: false,
          positioning: { placement: "bottom-end", gap: 8, padding: 12 },
        });
        const trigger = yield* context.he("button");
        const panel = yield* context.he("section");
        yield* api.attach({ trigger, panel });
        const duplicate = yield* Sync.sync(
          () =>
            Effect.runSync(Sync.toEffect(api.attach({ trigger, panel })).pipe(Effect.flip)).message,
        );
        expect(duplicate).toContain("one attachment");
        const other = yield* Popover.make({
          context,
          initialOpen: false,
          positioning: { placement: "bottom-end", gap: 8, padding: 12 },
        });
        const conflictPanel = yield* context.he("section");
        const conflicting = yield* context.he("button", {
          attrs: {
            "aria-expanded": yield* context.derive({
              sources: { open: other.isOpen },
              compute: () => Option.some("false"),
            }),
          },
        });
        const conflict = yield* Sync.sync(
          () =>
            Effect.runSync(
              Sync.toEffect(other.attach({ trigger: conflicting, panel: conflictPanel })).pipe(
                Effect.flip,
              ),
            ).message,
        );
        expect(conflict).toContain("Conflicting");
        return { setup: () => Effect.succeed([trigger, panel]) };
      }),
    );
    const foreignButton = await Effect.runPromise(foreign.ctx.he("button"));
    const foreignCheck = component((context) =>
      Sync.gen(function* () {
        const api = yield* Popover.make({
          context,
          initialOpen: false,
          positioning: { placement: "bottom-end", gap: 8, padding: 12 },
        });
        const panel = yield* context.he("section");
        const failure = yield* Sync.sync(
          () =>
            Effect.runSync(
              Sync.toEffect(api.attach({ trigger: foreignButton, panel })).pipe(Effect.flip),
            ).message,
        );
        expect(failure).toContain("issuing runtime");
        return { setup: () => Effect.succeed(panel) };
      }),
    );
    Effect.runSync(h.ctx.h(h.target, [check, foreignCheck]));
    await rendered({
      parent: h.parent,
      check: () => h.parent.querySelectorAll("section").length >= 2,
    });
    expect(h.failures).toEqual([]);
  });
});
