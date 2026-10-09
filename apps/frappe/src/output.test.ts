import { Deferred, Effect, Option } from "effect";
import { expect, it } from "vitest";
import { component, nativeNode, Sync } from "./framework";
import { importNativeSync } from "./construction";
import { toEffect } from "./sync";
import { harness, rendered } from "./test-helpers";

it("imports detached native trees lazily and mounts their original nodes", async () => {
  const { ctx, adopt } = await harness();
  const node = document.createElement("input");
  node.value = "native";
  const delayed = ctx.importNative(node);
  const output = await Effect.runPromise(delayed);
  expect(nativeNode(output)).toBe(node);
  expect(node.parentNode).toBeNull();
  expect((await Effect.runPromise(delayed.pipe(Effect.flip))).message).toContain("unmanaged");
  const values = await Effect.runPromise(ctx.signal({ initial: "bound" }));
  await Effect.runPromise(ctx.bindValue({ element: output, signal: values }));
  await adopt(output);
  expect(node.value).toBe("bound");
});

it("rejects exports, wrappers containing managed descendants, and detached tracked nodes", async () => {
  const { ctx, adopt, target } = await harness();
  const managed = await Effect.runPromise(ctx.he("span"));
  const wrapper = document.createElement("div");
  wrapper.append(nativeNode(managed));
  for (const node of [nativeNode(managed), wrapper]) {
    expect((await Effect.runPromise(ctx.importNative(node).pipe(Effect.exit)))._tag).toBe(
      "Failure",
    );
  }
  wrapper.removeChild(nativeNode(managed));
  expect(
    (await Effect.runPromise(ctx.importNative(nativeNode(managed)).pipe(Effect.flip))).message,
  ).toContain("unmanaged");
  const node = document.createElement("p");
  const imported = await Effect.runPromise(ctx.importNative(node));
  await adopt(imported);
  target.removeChild(node);
  expect((await Effect.runPromise(ctx.importNative(node).pipe(Effect.exit)))._tag).toBe("Failure");
});

it("rejects framework regions, wrapped reactive text, connected roots, and invalid node kinds", async () => {
  const { ctx } = await harness();
  const definition = component(() => Sync.succeed({ setup: () => Effect.succeed([]) }));
  const region = await Effect.runPromise(ctx.he("section", { children: [definition] }));
  const text = await Effect.runPromise(ctx.signal({ initial: "reactive" }));
  const bound = await Effect.runPromise(ctx.he("p", { children: [text] }));
  const wrapper = document.createElement("aside");
  wrapper.append(...nativeNode(bound).childNodes);
  const parent = document.createElement("div");
  const connected = document.createElement("span");
  parent.append(connected);
  for (const node of [
    nativeNode(region).firstChild!,
    wrapper,
    connected,
    document,
    document.createDocumentFragment(),
  ]) {
    expect((await Effect.runPromise(ctx.importNative(node).pipe(Effect.exit)))._tag).toBe(
      "Failure",
    );
  }
});

it("rechecks imported structure before both construction and adoption without retiring active content", async () => {
  const { ctx, target, failures, adopt } = await harness();
  const installed = await Effect.runPromise(ctx.he("p", { children: ["installed"] }));
  await adopt(installed);
  const node = document.createElement("section");
  const imported = await Effect.runPromise(ctx.importNative(node));
  node.append(document.createTextNode("changed"));
  expect(
    (await Effect.runPromise(ctx.he("main", { children: [imported] }).pipe(Effect.flip))).message,
  ).toContain("changed");
  Effect.runSync(ctx.h(target, imported));
  expect(failures.at(-1)?.operation).toBe("validation");
  expect(target.textContent).toBe("installed");
});

it("keeps imports owner-bound and offers the same checks in Sync", async () => {
  const { ctx, close, target } = await harness();
  const release = Deferred.makeUnsafe<void>();
  const ready = await Effect.runPromise(ctx.importNative(document.createTextNode("ready")));
  const definition = component(({ importNative }) =>
    Sync.gen(function* () {
      const pending = yield* importNative(document.createTextNode("pending"));
      return {
        fallback: () => Sync.succeed(pending),
        setup: () => Deferred.await(release).pipe(Effect.as(ready)),
      };
    }),
  );
  const constructed = await Effect.runPromise(ctx.he("section", { children: [definition] }));
  expect(nativeNode(constructed).childNodes).toHaveLength(2);
  Effect.runSync(ctx.h(target, constructed));
  await rendered({ parent: target, check: () => target.textContent === "pending" });
  Effect.runSync(Deferred.succeed(release, undefined));
  await rendered({ parent: target, check: () => target.textContent === "ready" });
  const delayed = ctx.importNative(document.createElement("span"));
  await close();
  expect((await Effect.runPromise(delayed.pipe(Effect.flip))).message).toContain("disposed");
  const inactive = { active: false, ownsTarget: () => false, reactiveRuntime: Option.none() };
  // Validate the Sync adapter without publishing an interpreter on the framework API.
  expect(
    (
      await Effect.runPromise(
        toEffect(importNativeSync(inactive)(document.createElement("p"))).pipe(Effect.flip),
      )
    ).message,
  ).toContain("disposed");
});
