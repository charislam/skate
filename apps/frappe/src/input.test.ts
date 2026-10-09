import { Effect, Exit, Option, Queue } from "effect";
import { describe, expect, it } from "vitest";
import { type WritableSignal } from "./framework";
import { nativeNode, type ElementOutput } from "./output";
import { importTestNode } from "./output-test-helpers";
import { harness, rendered } from "./test-helpers";
import { TextInput } from "./text-input";

const run = Effect.runPromise;
const inputHarness = async () => {
  const h = await harness();
  const signal = await run(h.ctx.signal({ initial: "initial" }));
  const input = await run(h.ctx.he("input", { props: { type: "text" } }));
  await run(h.ctx.bindValue({ element: input, signal }));
  await h.adopt(input);
  const observations = await run(Queue.unbounded<string>());
  await run(
    h.ctx.subscribeStream(await run(signal.changes), (value) => Queue.offer(observations, value)),
  );
  expect(await run(Queue.take(observations))).toBe("initial");
  const edit = (value: string) => {
    nativeNode(input).value = value;
    nativeNode(input).dispatchEvent(new InputEvent("input", { bubbles: true }));
  };
  return { ...h, signal, input, observations, edit };
};

describe("two-way text input", () => {
  it("rejects ineligible, foreign, adopted, readonly, and duplicate destinations before listeners", async () => {
    const { ctx, adopt } = await harness();
    const signal = await run(ctx.signal({ initial: "x" }));
    for (const type of ["checkbox", "number", "date", "file", "range", "radio", "button"]) {
      const element = await run(ctx.he("input", { props: { type } }));
      expect((await run(ctx.bindValue({ element, signal }).pipe(Effect.flip))).message).toContain(
        "text-editing",
      );
    }
    const readonly = await run(
      ctx.derive({ sources: { signal }, compute: ({ signal }) => signal }),
    );
    const node = await run(ctx.he("input"));
    expect(
      (
        await run(
          ctx
            .bindValue({ element: node, signal: readonly as WritableSignal<string> })
            .pipe(Effect.flip),
        )
      ).message,
    ).toContain("writable");
    const foreign = await harness();
    expect(
      Exit.isFailure(await run(foreign.ctx.bindValue({ element: node, signal }).pipe(Effect.exit))),
    ).toBe(true);
    expect(
      Exit.isFailure(
        await run(
          ctx
            .bindValue({
              element: await run(importTestNode(document.createElement("input"))),
              signal,
            })
            .pipe(Effect.exit),
        ),
      ),
    ).toBe(true);
    const bound = await run(ctx.he("input", { props: { value: signal } }));
    expect(
      (await run(ctx.bindValue({ element: bound, signal }).pipe(Effect.flip))).message,
    ).toContain("Conflicting");
    const defaulted = await run(ctx.he("input", { attrs: { value: Option.some("default") } }));
    expect(
      (await run(ctx.bindValue({ element: defaulted, signal }).pipe(Effect.flip))).message,
    ).toContain("Conflicting");
    await run(ctx.bindValue({ element: node, signal }));
    expect(
      (await run(ctx.bindValue({ element: node, signal }).pipe(Effect.flip))).message,
    ).toContain("Conflicting");
    nativeNode(node).value = "detached edit";
    nativeNode(node).dispatchEvent(new InputEvent("input"));
    await run(signal.set("refresh"));
    expect(nativeNode(node).value).toBe("detached edit");
    await adopt(node);
    expect(nativeNode(node).value).toBe("refresh");
    expect(
      (await run(ctx.bindValue({ element: node, signal }).pipe(Effect.flip))).message,
    ).toContain("before adoption");
  });

  it("supports all text-editing types and textarea, applies programmatic changes without events", async () => {
    const { ctx, adopt } = await harness();
    const signal = await run(ctx.signal({ initial: "a" }));
    const nodes: Array<ElementOutput<HTMLInputElement | HTMLTextAreaElement>> = [];
    for (const type of ["text", "search", "tel", "url", "email", "password"]) {
      const node = await run(ctx.he("input", { props: { type } }));
      await run(ctx.bindValue({ element: node, signal }));
      nodes.push(node);
    }
    const textarea = await run(ctx.he("textarea"));
    await run(ctx.bindValue({ element: textarea, signal }));
    nodes.push(textarea);
    const container = await run(ctx.he("div", { children: nodes }));
    await adopt(container);
    let events = 0;
    for (const node of nodes) {
      nativeNode(node).addEventListener("input", () => {
        events += 1;
      });
      nativeNode(node).addEventListener("change", () => {
        events += 1;
      });
    }
    await run(signal.set("programmatic"));
    expect(nodes.every((node) => nativeNode(node).value === "programmatic")).toBe(true);
    expect(events).toBe(0);
  });

  it("keeps immutable rapid snapshots in order, avoids stale echo, and preserves caret and focus", async () => {
    const { input, edit, observations, parent } = await inputHarness();
    document.body.append(parent);
    nativeNode(input).focus();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    let writes = 0;
    Object.defineProperty(nativeNode(input), "value", {
      configurable: true,
      get: () => descriptor?.get?.call(nativeNode(input)),
      set: (value: string) => {
        writes += 1;
        descriptor?.set?.call(nativeNode(input), value);
      },
    });
    edit("first");
    edit("second");
    edit("third");
    nativeNode(input).setSelectionRange(2, 2);
    expect(await run(Queue.take(observations))).toBe("first");
    expect(await run(Queue.take(observations))).toBe("second");
    expect(await run(Queue.take(observations))).toBe("third");
    expect(writes).toBe(3);
    expect(nativeNode(input).value).toBe("third");
    expect(nativeNode(input).selectionStart).toBe(2);
    expect(nativeNode(input).selectionEnd).toBe(2);
    expect(document.activeElement).toBe(nativeNode(input));
    parent.remove();
  });

  it("defers composition publication, preserves the editing buffer, and lets completion win over programmatic writes", async () => {
    const { input, signal, observations, edit } = await inputHarness();
    nativeNode(input).dispatchEvent(new CompositionEvent("compositionstart"));
    nativeNode(input).value = "partial";
    nativeNode(input).dispatchEvent(new InputEvent("input", { isComposing: true }));
    expect(await run(signal.get)).toBe("initial");
    await run(signal.set("programmatic"));
    expect(await run(Queue.take(observations))).toBe("programmatic");
    expect(nativeNode(input).value).toBe("partial");
    nativeNode(input).value = "completed";
    nativeNode(input).dispatchEvent(new CompositionEvent("compositionend"));
    nativeNode(input).dispatchEvent(new InputEvent("input"));
    expect(await run(Queue.take(observations))).toBe("completed");
    expect(await run(signal.get)).toBe("completed");
    expect(nativeNode(input).value).toBe("completed");
    edit("next");
    expect(await run(Queue.take(observations))).toBe("next");
    expect(Queue.sizeUnsafe(observations)).toBe(0);
    await run(signal.set("later"));
    expect(await run(Queue.take(observations))).toBe("later");
    expect(nativeNode(input).value).toBe("later");
  });

  it("stops ingress and queued completion on replacement or component disposal", async () => {
    const { ctx, adopt, input, signal, observations } = await inputHarness();
    nativeNode(input).dispatchEvent(new CompositionEvent("compositionstart"));
    nativeNode(input).value = "partial";
    await adopt(await run(ctx.he("p", { children: ["replacement"] })));
    nativeNode(input).dispatchEvent(new CompositionEvent("compositionend"));
    nativeNode(input).dispatchEvent(new InputEvent("input"));
    await run(signal.set("after"));
    expect(await run(Queue.take(observations))).toBe("after");
    expect(nativeNode(input).value).toBe("partial");
    const other = await inputHarness();
    nativeNode(other.input).dispatchEvent(new CompositionEvent("compositionstart"));
    nativeNode(other.input).value = "finished";
    nativeNode(other.input).dispatchEvent(new CompositionEvent("compositionend"));
    await other.close();
    expect(Exit.isFailure(await run(other.signal.get.pipe(Effect.exit)))).toBe(true);
    nativeNode(other.input).dispatchEvent(new CompositionEvent("compositionend"));
    expect(other.failures).toHaveLength(0);
  });

  it("demonstrates input, reset, disabled toggling, optional hint removal, and independent occurrences", async () => {
    const { ctx, target, parent } = await harness();
    Effect.runSync(ctx.h(target, [TextInput, TextInput]));
    await rendered({ parent, check: () => parent.querySelectorAll(".text-input").length === 2 });
    const sections = Array.from(parent.querySelectorAll(".text-input"));
    const left = sections[0] ?? document.createElement("section");
    const right = sections[1];
    const input = left.querySelector("input") ?? document.createElement("input");
    const buttons = Array.from(left.querySelectorAll("button"));
    expect(input.id).not.toBe(right?.querySelector("input")?.id);
    expect(left.querySelector("label")?.htmlFor).toBe(input.id);
    expect(input.hasAttribute("title")).toBe(false);
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input"));
    await rendered({ parent, check: () => left.querySelector("output")?.textContent === "hello" });
    expect(input.title).toBe("Reset to clear your text");
    expect(right?.querySelector("output")?.textContent).toBe("");
    buttons[1]?.click();
    await rendered({ parent, check: () => buttons[1]?.textContent === "Enable input" });
    expect(input.disabled).toBe(true);
    buttons[1]?.click();
    await rendered({ parent, check: () => buttons[1]?.textContent === "Disable input" });
    expect(input.disabled).toBe(false);
    buttons[0]?.click();
    await rendered({ parent, check: () => left.querySelector("output")?.textContent === "" });
    expect(input.value).toBe("");
    expect(input.hasAttribute("title")).toBe(false);
    expect(left.querySelector("input")).toBe(input);
    expect(buttons.every((button) => button.type === "button")).toBe(true);
  });
});
