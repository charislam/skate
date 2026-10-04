import { Cause, Effect, Exit, Match, Option, Queue } from "effect";
import { describe, expect, it } from "vitest";
import { construct, type ConstructionError } from "./construction";
import { component } from "./framework";
import { attributeNameValid, claimDestination, validateAttribute } from "./reactive/dom";
import { harness, rendered } from "./test-helpers";

const run = Effect.runPromise;

describe("reactive attributes and properties", () => {
  it("accepts DOM attribute names that do not follow XML name grammar", () => {
    for (const name of [
      "1name",
      "-name",
      ".name",
      "data-😀",
      "a\u00a0b",
      "a\u000bb",
      'a"b',
      "a'b",
      "a<b",
    ]) {
      expect(attributeNameValid(name)).toBe(true);
    }
    expect(attributeNameValid("ONCLICK")).toBe(false);
    expect(attributeNameValid("SRCDOC")).toBe(false);
  });

  it("returns lazy Effects for DOM validation and destination conflicts", async () => {
    const invalid = validateAttribute("bare");
    expect((await run(invalid.pipe(Effect.flip)))._tag).toBe("ReactiveError");
    expect(await run(validateAttribute(Option.some("literal")))).toEqual(Option.some("literal"));
    const element = document.createElement("input");
    const pending = claimDestination({ element, kind: "property", name: "value", reactive: true });
    // Creating the Effect reserves nothing; another writer can claim it first.
    await run(claimDestination({ element, kind: "property", name: "value", reactive: true }));
    expect((await run(pending.pipe(Effect.flip))).message).toContain("Conflicting");
  });

  it("refreshes mixed bindings at adoption, keeps literal values, removes None, and retains node identity", async () => {
    const { ctx, adopt, parent } = await harness();
    const hint = await run(ctx.signal({ initial: Option.some("old") }));
    const present = await run(ctx.signal<Option.Option<true>>({ initial: Option.none() }));
    const disabled = await run(ctx.signal({ initial: false }));
    const node = await run(
      ctx.he("input", {
        attrs: { title: hint, required: present, "data-static": Option.some("null") },
        props: { type: "text", disabled },
      }),
    );
    await run(ctx.batch(hint.set(Option.some("new")).pipe(Effect.andThen(disabled.set(true)))));
    expect(node.title).toBe("old");
    expect(node.disabled).toBe(false);
    await adopt(node);
    expect(node.title).toBe("new");
    expect(node.disabled).toBe(true);
    for (const text of ["", "false", "true", "null"]) {
      await run(hint.set(Option.some(text)));
      expect(node.getAttribute("title")).toBe(text);
    }
    await run(present.set(Option.some(true)));
    expect(node.getAttribute("required")).toBe("");
    await run(present.set(Option.none()));
    expect(node.hasAttribute("required")).toBe(false);
    await run(hint.set(Option.none()));
    expect(node.hasAttribute("title")).toBe(false);
    expect(parent.querySelector("input")).toBe(node);
    const replacement = await run(ctx.he("p"));
    await adopt(replacement);
    await run(hint.set(Option.some("late")));
    expect(node.hasAttribute("title")).toBe(false);
  });

  it("rejects invalid attribute runtime values and names before moving children", async () => {
    const { ctx } = await harness();
    const child = document.createElement("span");
    for (const value of [
      "bare",
      true,
      false,
      Option.some(false),
      1,
      {},
      null,
      undefined,
      Option.some({}),
    ]) {
      const options = { attrs: { title: value }, children: [child] } as unknown as Parameters<
        typeof ctx.he<"div">
      >[1];
      const error = await run(ctx.he("div", options).pipe(Effect.flip));
      expect(error._tag).toBe("ConstructionError");
      expect(child.parentNode).toBeNull();
    }
    for (const name of [
      "",
      "has space",
      "has\t tab",
      "a\n",
      "a\r",
      "a\f",
      "onclick",
      "srcdoc",
      "a/b",
      "a=b",
      "a>b",
      "a\u0000",
    ]) {
      const error = await run(
        ctx.he("div", { attrs: { [name]: Option.some("x") }, children: [child] }).pipe(Effect.flip),
      );
      expect(error._tag).toBe("ConstructionError");
      expect(child.parentNode).toBeNull();
    }
    const node = await run(ctx.he("input", { attrs: { disabled: Option.some("false") } }));
    expect(node.disabled).toBe(true);
    const staticOwner = { active: true, ownsTarget: () => false, reactiveRuntime: Option.none() };
    const value = await run(ctx.signal({ initial: Option.some("x") }));
    expect(
      (await run(construct(staticOwner)("div", { attrs: { title: value } }).pipe(Effect.flip)))
        .message,
    ).toContain("component owner");
  });

  it("rejects normalized reflections and coupled destinations before child adoption", async () => {
    const { ctx } = await harness();
    const value = await run(ctx.signal({ initial: "live" }));
    const disabled = await run(ctx.signal({ initial: true }));
    const klass = await run(ctx.signal({ initial: "live" }));
    const index = await run(ctx.signal({ initial: 0 }));
    const optional = await run(ctx.signal({ initial: Option.some("x") }));
    const child = await run(ctx.he("span"));
    const errors: Array<Effect.Effect<HTMLElement, ConstructionError>> = [
      ctx.he("input", {
        attrs: { disabled: Option.none() },
        props: { disabled },
        children: [child],
      }),
      ctx.he("input", {
        attrs: { value: Option.some("initial") },
        props: { value },
        children: [child],
      }),
      ctx.he("input", { props: { value, defaultValue: "default" }, children: [child] }),
      ctx.he("div", {
        attrs: { CLASS: Option.some("static") },
        props: { className: klass },
        children: [child],
      }),
      ctx.he("div", {
        attrs: { TABINDEX: Option.some("1") },
        props: { tabIndex: index },
        children: [child],
      }),
      ctx.he("label", {
        attrs: { for: optional },
        props: { htmlFor: "static" },
        children: [child],
      }),
      ctx.he("div", {
        attrs: { TITLE: optional, title: Option.some("static") },
        children: [child],
      }),
    ];
    for (const effect of errors) {
      expect((await run(effect.pipe(Effect.flip))).message).toContain("Conflicting");
      expect(child.parentNode).toBeNull();
    }
    const staticInput = await run(
      ctx.he("input", { attrs: { value: Option.some("default") }, props: { value: "live" } }),
    );
    expect(staticInput.defaultValue).toBe("default");
    expect(staticInput.value).toBe("live");
  });

  it("validates a candidate before installing any state or DOM, then flushes everything before observations", async () => {
    const { ctx, adopt } = await harness();
    const source = await run(ctx.signal({ initial: "initial" }));
    const hint = await run(
      ctx.derive({
        sources: { source },
        compute: ({ source }) =>
          Match.value(source).pipe(
            Match.when("invalid", () => Option.some(false)),
            Match.orElse((value) => Option.some(value)),
          ),
      }),
    );
    // Deliberately bypass the type boundary to verify proposal validation.
    const attrs = { title: hint } as unknown as NonNullable<
      NonNullable<Parameters<typeof ctx.he<"input">>[1]>["attrs"]
    >;
    const node = await run(ctx.he("input", { attrs, props: { value: source }, children: [] }));
    const label = await run(ctx.he("p", { children: [source, node] }));
    await adopt(label);
    expect(Exit.isFailure(await run(source.set("invalid").pipe(Effect.exit)))).toBe(true);
    expect(await run(source.get)).toBe("initial");
    expect(node.title).toBe("initial");
    expect(node.value).toBe("initial");
    expect(label.textContent).toBe("initial");
    const observations = await run(
      Queue.unbounded<{ value: string; title: string; text: string | null; property: string }>(),
    );
    const changes = await run(source.changes);
    await run(
      ctx.subscribeStream(changes, (value) =>
        Queue.offer(observations, {
          value,
          title: node.title,
          text: label.textContent,
          property: node.value,
        }),
      ),
    );
    await run(Queue.take(observations));
    await run(source.set("committed"));
    expect(node.value).toBe("committed");
    expect(await run(Queue.take(observations))).toEqual({
      value: "committed",
      title: "committed",
      text: "committed",
      property: "committed",
    });
    await run(
      ctx.batch(source.set("aborted").pipe(Effect.andThen(Effect.fail("abort")))).pipe(Effect.exit),
    );
    expect(node.value).toBe("committed");
  });

  it("reports a throwing setter once, publishes committed state, recovers later, and skips equal retries", async () => {
    const { ctx, adopt, failures } = await harness();
    const source = await run(ctx.signal({ initial: "good" }));
    const node = await run(
      ctx.he("input", { props: { value: source }, attrs: { title: Option.some("static") } }),
    );
    const label = await run(ctx.he("p", { children: [source, node] }));
    await adopt(label);
    const cause = new Error("setter rejected");
    let actual = "good";
    let attempts = 0;
    Object.defineProperty(node, "value", {
      configurable: true,
      get: () => actual,
      set: (value: string) => {
        attempts += 1;
        Match.value(value).pipe(
          Match.when("bad", () => {
            throw cause;
          }),
          Match.orElse((value) => {
            actual = value;
          }),
        );
      },
    });
    const queue = await run(Queue.unbounded<string>());
    await run(ctx.subscribeStream(await run(source.changes), (value) => Queue.offer(queue, value)));
    await run(Queue.take(queue));
    await run(source.set("bad"));
    expect(await run(Queue.take(queue))).toBe("bad");
    expect(await run(source.get)).toBe("bad");
    expect(label.textContent).toBe("bad");
    expect(node.value).toBe("good");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.operation).toBe("reactive-dom");
    expect(failures[0]?.resource).toEqual({ element: node, kind: "property", name: "value" });
    expect(Cause.findDefect(failures[0]?.cause ?? Cause.empty)).toEqual(
      expect.objectContaining({ success: cause }),
    );
    await run(source.set("bad"));
    expect(attempts).toBe(1);
    expect(failures).toHaveLength(1);
    await run(source.set("recovered"));
    expect(node.value).toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("rejects foreign/disposed attribute and property signals and refreshes ancestor bindings", async () => {
    const { ctx, h, parent, target } = await harness();
    const text = await run(ctx.signal({ initial: "ancestor" }));
    const optional = await run(ctx.signal({ initial: Option.some("ancestor") }));
    ctx.h(
      target,
      component({
        setup: (child) => child.he("input", { attrs: { title: optional }, props: { value: text } }),
      }),
    );
    await rendered({ parent, check: () => parent.querySelector("input") !== null });
    const node = parent.querySelector("input");
    await run(text.set("changed"));
    await run(optional.set(Option.some("changed")));
    expect(node?.value).toBe("changed");
    expect(node?.title).toBe("changed");
    const other = await harness();
    expect(
      Exit.isFailure(
        await run(other.ctx.he("input", { props: { value: text } }).pipe(Effect.exit)),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        await run(other.ctx.he("input", { attrs: { title: optional } }).pipe(Effect.exit)),
      ),
    ).toBe(true);
    const detached = await run(ctx.he("input", { props: { value: text } }));
    h(document.createElement("div"), detached);
    await other.close();
    const disposed = await run(other.ctx.he("input").pipe(Effect.flip));
    expect(disposed.message).toContain("disposed");
  });

  it("continues other sinks and publication even when reporting throws", async () => {
    const { ctx, adopt, failures } = await harness({
      onError: () => {
        throw new Error("handler failed");
      },
    });
    const source = await run(ctx.signal({ initial: "good" }));
    const optional = await run(
      ctx.derive({ sources: { source }, compute: ({ source }) => Option.some(source) }),
    );
    const bad = await run(ctx.he("input", { props: { value: source } }));
    const good = await run(
      ctx.he("input", { props: { value: source }, attrs: { title: optional } }),
    );
    const tree = await run(ctx.he("p", { children: [source, bad, good] }));
    await adopt(tree);
    Object.defineProperty(bad, "value", {
      configurable: true,
      get: () => "good",
      set: () => {
        throw new Error("failed assignment");
      },
    });
    await run(source.set("changed"));
    expect(await run(source.get)).toBe("changed");
    expect(good.value).toBe("changed");
    expect(good.title).toBe("changed");
    expect(tree.textContent).toBe("changed");
    expect(failures).toHaveLength(1);
  });

  it("reports initialization and adoption failures per attempt and retains the binding for recovery", async () => {
    const { ctx, adopt, failures } = await harness();
    const source = await run(ctx.signal({ initial: "initial" }));
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    expect(descriptor).toBeDefined();
    let attempts = 0;
    Object.defineProperty(HTMLInputElement.prototype, "value", {
      configurable: true,
      get: function (this: HTMLInputElement) {
        return descriptor?.get?.call(this);
      },
      set: () => {
        attempts += 1;
        throw new Error("initial assignment");
      },
    });
    try {
      const node = await run(ctx.he("input", { props: { value: source } }));
      expect(failures).toHaveLength(1);
      expect(attempts).toBe(1);
      await adopt(node);
      expect(failures).toHaveLength(2);
      expect(attempts).toBe(2);
      Option.match(Option.fromUndefinedOr(descriptor), {
        onNone: () => {},
        onSome: (descriptor) => {
          Object.defineProperty(HTMLInputElement.prototype, "value", descriptor);
        },
      });
      await run(source.set("recovered"));
      expect(node.value).toBe("recovered");
      expect(failures.every((failure) => failure.operation === "reactive-dom")).toBe(true);
    } finally {
      Option.match(Option.fromUndefinedOr(descriptor), {
        onNone: () => {},
        onSome: (descriptor) => {
          Object.defineProperty(HTMLInputElement.prototype, "value", descriptor);
        },
      });
    }
  });

  it("rejects invalid initial and candidate native property types and invalid adoption snapshots", async () => {
    const { ctx, adopt, target } = await harness();
    const source = await run(ctx.signal<unknown>({ initial: false }));
    const props = { disabled: source } as unknown as NonNullable<
      NonNullable<Parameters<typeof ctx.he<"input">>[1]>["props"]
    >;
    const node = await run(ctx.he("input", { props }));
    await adopt(node);
    expect(Exit.isFailure(await run(source.set("invalid").pipe(Effect.exit)))).toBe(true);
    expect(await run(source.get)).toBe(false);
    expect(node.disabled).toBe(false);
    const readonly = { props: { offsetHeight: 1 } } as unknown as NonNullable<
      Parameters<typeof ctx.he<"input">>[1]
    >;
    expect(Exit.isFailure(await run(ctx.he("input", readonly).pipe(Effect.exit)))).toBe(true);
    const invalid = await run(ctx.signal<unknown>({ initial: Option.some("valid") }));
    const attrs = { title: invalid } as unknown as NonNullable<
      NonNullable<Parameters<typeof ctx.he<"div">>[1]>["attrs"]
    >;
    const detached = await run(ctx.he("div", { attrs }));
    await run(invalid.set(Option.some(false)));
    expect(
      Exit.isFailure(await run(ctx.he("section", { children: [detached] }).pipe(Effect.exit))),
    ).toBe(true);
    expect(target.contains(node)).toBe(true);
    expect(detached.parentNode).toBeNull();
  });
});
