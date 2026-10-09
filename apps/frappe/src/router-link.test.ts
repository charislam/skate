import { Deferred, Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { component, nativeNode, type ElementOutput } from "./framework";
import type { Navigator } from "./navigation";
import { link } from "./router-link";
import { parameter, route, router } from "./routes";
import * as Sync from "./sync";
import { harness, rendered } from "./test-helpers";

const urls = router([route({ tag: "Page", path: ["page"] })]);
const destination = { _tag: "Page", params: {}, query: {}, fragment: Option.none() } as const;

const fixture = async () => {
  const test = await harness();
  let calls = 0;
  const navigated = Deferred.makeUnsafe<void>();
  const navigation: Navigator<typeof urls.definitions, never> = {
    navigate: () =>
      Effect.sync(() => {
        calls += 1;
        Deferred.doneUnsafe(navigated, Effect.void);
      }),
    dispatch: () => Effect.void,
    initial: Effect.void,
    committedLocation: () => "/",
  };
  const ready = Deferred.makeUnsafe<ElementOutput<HTMLAnchorElement>>();
  Effect.runSync(
    test.ctx.h(
      test.target,
      component((context) =>
        Sync.gen(function* () {
          const node = yield* link({
            context,
            router: urls,
            navigator: navigation,
            destination,
            children: ["Page"],
          });
          const ordinary = yield* context.he("a", {
            attrs: { href: Option.some("/ordinary") },
            children: ["Ordinary"],
          });
          Deferred.doneUnsafe(ready, Effect.succeed(node));
          return { setup: () => Effect.succeed([node, ordinary]) };
        }),
      ),
    ),
  );
  const node = nativeNode(await Effect.runPromise(Deferred.await(ready)));
  await rendered({ parent: test.parent, check: () => test.target.contains(node) });
  return { ...test, node, calls: () => calls, navigated };
};

describe("explicit typed links", () => {
  it("renders real hrefs and intercepts ordinary primary and keyboard activation synchronously", async () => {
    const f = await fixture();
    expect(f.node.getAttribute("href")).toBe("/page");
    const click = new MouseEvent("click", {
      button: 0,
      bubbles: true,
      cancelable: true,
      detail: 0,
    });
    expect(f.node.dispatchEvent(click)).toBe(false);
    expect(click.defaultPrevented).toBe(true);
    await Effect.runPromise(Deferred.await(f.navigated));
    expect(f.calls()).toBe(1);
  });

  it("preserves modifiers, buttons, targets, downloads, external origins and ordinary anchors", async () => {
    const f = await fixture();
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
      { button: 1 },
      { button: 2 },
    ]) {
      const event = new MouseEvent("click", {
        button: 0,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      f.node.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    for (const [attribute, value] of [
      ["target", "_blank"],
      ["target", "frame"],
      ["download", "file.txt"],
      ["href", "https://other.example/page"],
    ] as const) {
      f.node.setAttribute(attribute, value);
      const event = new MouseEvent("click", { cancelable: true });
      f.node.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      f.node.removeAttribute(attribute);
      f.node.setAttribute("href", "/page");
    }

    const ordinary = f.target.querySelector('a[href="/ordinary"]');
    const event = new MouseEvent("click", { cancelable: true });
    ordinary?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    f.node.setAttribute("target", "_self");
    f.node.dispatchEvent(new MouseEvent("click", { cancelable: true }));
    await Effect.runPromise(Deferred.await(f.navigated));
    expect(f.calls()).toBe(1);
  });

  it("does not navigate for an already prevented click", async () => {
    const f = await fixture();
    const prevented = new MouseEvent("click", { cancelable: true });
    prevented.preventDefault();
    expect(f.node.dispatchEvent(prevented)).toBe(false);
    expect(prevented.defaultPrevented).toBe(true);

    // Await a later eligible click so queued ingress has processed both events.
    const eligible = new MouseEvent("click", { cancelable: true });
    expect(f.node.dispatchEvent(eligible)).toBe(false);
    await Effect.runPromise(Deferred.await(f.navigated));
    expect(f.calls()).toBe(1);
  });

  it("reports builder errors at construction and removes event ownership on disposal", async () => {
    const f = await fixture();
    await f.close();

    const event = new MouseEvent("click", { cancelable: true });
    f.node.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(f.calls()).toBe(0);

    const badUrls = router([
      route({
        tag: "Bad",
        path: [
          parameter("number", Schema.NumberFromString.pipe(Schema.check(Schema.isGreaterThan(0)))),
        ],
      }),
    ]);
    const reported = Deferred.makeUnsafe<void>();
    const test = await harness({
      onError: () => {
        Deferred.doneUnsafe(reported, Effect.void);
      },
    });
    const navigation: Navigator<typeof badUrls.definitions, never> = {
      navigate: () => Effect.void,
      dispatch: () => Effect.void,
      initial: Effect.void,
      committedLocation: () => "/",
    };
    Effect.runSync(
      test.ctx.h(
        test.target,
        component((context) =>
          Sync.gen(function* () {
            const node = yield* link({
              context,
              router: badUrls,
              navigator: navigation,
              destination: {
                _tag: "Bad",
                params: { number: -1 },
                query: {},
                fragment: Option.none(),
              },
            });
            return { setup: () => Effect.succeed(node) };
          }),
        ),
      ),
    );

    await Effect.runPromise(Deferred.await(reported));
    expect(test.target.querySelector("a")).toBeNull();
    expect(test.failures).toHaveLength(1);
  });
});
