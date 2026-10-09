import { Effect, Option } from "effect";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { component } from "./framework";
import { nativeNode } from "./output";
import * as Popover from "./popover";
import { geometry } from "./positioning";
import * as Sync from "./sync";
import { harness, rendered } from "./test-helpers";

const base = {
  anchor: { left: 200, right: 300, top: 100, bottom: 130 },
  width: 320,
  height: 200,
  viewport: { width: 600, height: 500 },
  placement: "bottom-end" as const,
  gap: 8,
  padding: 12,
};
describe("anchored geometry", () => {
  it("aligns to the end and shifts within viewport padding", () => {
    expect(geometry(base)).toEqual({ left: 12, top: 138, width: 320, maxHeight: 350 });
    expect(
      geometry({ ...base, anchor: { left: 400, right: 500, top: 100, bottom: 130 } }).left,
    ).toBe(180);
  });
  it("flips when above has more space and constrains tall content", () => {
    expect(
      geometry({ ...base, anchor: { left: 200, right: 300, top: 400, bottom: 430 }, height: 600 }),
    ).toEqual({ left: 12, top: 12, width: 320, maxHeight: 380 });
  });
  it("keeps geometry inside the viewport when the anchor scrolls offscreen", () => {
    expect(
      geometry({ ...base, anchor: { left: 200, right: 300, top: -100, bottom: -70 }, height: 800 }),
    ).toMatchObject({ top: 12, maxHeight: 476 });
    expect(
      geometry({ ...base, anchor: { left: 200, right: 300, top: 600, bottom: 630 }, height: 800 }),
    ).toMatchObject({ top: 12, maxHeight: 476 });
  });
  it("constrains width on narrow viewports", () => {
    expect(geometry({ ...base, viewport: { width: 250, height: 300 } })).toMatchObject({
      left: 12,
      width: 226,
    });
  });
});

afterEach(() => vi.restoreAllMocks());

it("waits for connection, coalesces measurements, and cancels on close and disposal", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  const h = await harness();
  type Api =
    ReturnType<typeof Popover.make> extends Sync.Sync<infer A, unknown, unknown> ? A : never;
  let api = Option.none<Api>();
  let measure = Option.none<MockInstance<() => DOMRect>>();
  const demo = component((context) =>
    Sync.gen(function* () {
      const popover = yield* Popover.make({
        context,
        initialOpen: true,
        positioning: { placement: "bottom-end", gap: 8, padding: 12 },
      });
      api = Option.some(popover);
      const trigger = yield* context.he("button");
      const panel = yield* context.he("section");
      measure = Option.some(
        vi
          .spyOn(nativeNode(trigger), "getBoundingClientRect")
          .mockReturnValue(new DOMRect(200, 100, 100, 30)),
      );
      yield* popover.attach({ trigger, panel });
      return { setup: () => Effect.succeed([trigger, panel]) };
    }),
  );
  Effect.runSync(h.ctx.h(h.target, demo));
  await rendered({ parent: h.parent, check: () => h.parent.querySelector("section") !== null });
  const tick = () => {
    const scheduled = [...frames.values()];
    frames.clear();
    for (const callback of scheduled) callback(0);
  };
  expect(frames.size).toBe(1);
  tick();
  expect(Option.getOrThrow(measure)).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  document.body.append(h.parent);
  window.dispatchEvent(new Event("resize"));
  window.dispatchEvent(new Event("resize"));
  expect(frames.size).toBe(1);
  tick();
  expect(Option.getOrThrow(measure)).toHaveBeenCalledTimes(1);
  expect(h.parent.querySelector("section")?.style.top).toBe("138px");
  expect(h.parent.querySelector("section")?.style.maxWidth).toBe(`${window.innerWidth - 24}px`);
  window.dispatchEvent(new Event("resize"));
  expect(frames.size).toBe(1);
  await Effect.runPromise(Option.getOrThrow(api).close({ reason: { _tag: "Programmatic" } }));
  expect(frames.size).toBe(0);
  window.dispatchEvent(new Event("resize"));
  expect(frames.size).toBe(0);
  await Effect.runPromise(Option.getOrThrow(api).open());
  expect(frames.size).toBe(1);
  await h.close();
  expect(frames.size).toBe(0);
  window.dispatchEvent(new Event("resize"));
  expect(frames.size).toBe(0);
  h.parent.remove();
});
