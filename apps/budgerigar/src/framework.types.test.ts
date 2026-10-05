import { Effect, Match, Option, Result } from "effect";
import { expectTypeOf, it } from "vitest";
import type { ConstructionError } from "./construction";
import { component } from "./framework";
import type {
  ApplicationContext,
  Component,
  ComponentContext,
  MountFailure,
  Construct,
  Mount,
  ReactiveError,
  Signal,
  WritableSignal,
  SynchronousContext,
} from "./framework";

it("retains native tag and property types and restricts static construction", () => {
  // This function is checked by TypeScript but deliberately never executed.
  const author = (options: { he: Construct; h: Mount; parent: Element }) => {
    const { he, h, parent } = options;

    // @ts-expect-error A setup method alone does not carry the component type id.
    const unbranded: Component = {
      factory: () => Result.succeed({ setup: () => Effect.succeed([]) }),
    };
    void unbranded;

    expectTypeOf(he("input")).toEqualTypeOf<Effect.Effect<HTMLInputElement, ConstructionError>>();
    expectTypeOf(he("select")).toEqualTypeOf<Effect.Effect<HTMLSelectElement, ConstructionError>>();

    he("input", { props: { value: "current", checked: true, disabled: false } });
    he("div", {
      attrs: {
        class: Option.some("panel"),
        hidden: Option.some(true),
        "aria-expanded": Option.some("false"),
      },
    });

    // @ts-expect-error Only known HTML tags are supported.
    he("custom-widget");

    // @ts-expect-error SVG is outside this API.
    he("svg");

    // @ts-expect-error Input values retain their native string type.
    he("input", { props: { value: 1 } });

    // @ts-expect-error Properties depend on the chosen tag.
    he("div", { props: { checked: true } });

    // @ts-expect-error Readonly native properties cannot be assigned.
    he("div", { props: { offsetHeight: 42 } });

    // @ts-expect-error Readonly collections cannot be assigned.
    he("div", { props: { childNodes: document.createElement("div").childNodes } });

    // @ts-expect-error Native methods are not data properties.
    he("div", { props: { append: () => {} } });

    // @ts-expect-error Event handlers are deferred to a later API.
    he("button", { props: { onclick: () => {} } });

    // @ts-expect-error HTML parsing is excluded.
    he("div", { props: { innerHTML: "<b>hello</b>" } });

    // @ts-expect-error Structural text properties conflict with children.
    he("div", { props: { textContent: "hello" } });

    // @ts-expect-error Structural text properties conflict with children.
    he("div", { props: { innerText: "hello" } });

    // @ts-expect-error HTML parsing is excluded.
    he("iframe", { props: { srcdoc: "hello" } });

    // @ts-expect-error Style objects are not part of the static API.
    he("div", { props: { style: {} } });

    // @ts-expect-error Attributes accept strings and booleans only.
    he("div", { attrs: { tabindex: 0 } });

    // @ts-expect-error Null attributes are unsupported.
    he("div", { attrs: { hidden: null } });

    // @ts-expect-error Undefined attributes are unsupported.
    he("div", { attrs: { hidden: undefined } });

    // @ts-expect-error Construct child elements before supplying them as children.
    he("div", { children: [he("span")] });

    // @ts-expect-error Children do not flatten nested arrays.
    he("div", { children: [["hello"]] });

    // @ts-expect-error Number children are unsupported.
    he("div", { children: [42] });

    // @ts-expect-error Null children are unsupported.
    he("div", { children: [null] });

    // @ts-expect-error There is no separate text option.
    he("div", { text: "hello" });

    // @ts-expect-error Evaluate construction before submitting a native node.
    h(parent, he("div"));

    // @ts-expect-error Mounting requires an explicit text node.
    h(parent, "hello");

    // @ts-expect-error Mount arrays cannot be nested.
    h(parent, [[he("div")]]);
  };

  expectTypeOf(author).toBeFunction();
});

it("retains reactive value and event types and hides mutation on derived and folded signals", () => {
  const author = (context: ComponentContext) =>
    Effect.gen(function* () {
      const count = yield* context.signal({ initial: 0 });
      expectTypeOf(count).toEqualTypeOf<WritableSignal<number>>();
      expectTypeOf(count.get).toEqualTypeOf<Effect.Effect<number, ReactiveError>>();
      const label = yield* context.derive({
        sources: { count },
        compute: ({ count }) => String(count),
      });
      expectTypeOf(label).toEqualTypeOf<Signal<string>>();
      context.he("p", { children: [label] });
      // @ts-expect-error Numeric signals must be explicitly formatted for text.
      context.he("p", { children: [count] });
      // @ts-expect-error Writable signal values retain their inferred type.
      count.set("one");
      // @ts-expect-error Derived signals have no mutation capability.
      label.set("new");
      // @ts-expect-error Derivation sources retain their value types.
      context.derive({ sources: { count }, compute: ({ count }) => count.toUpperCase() });
      const source = yield* context.source<number>();
      // @ts-expect-error Event source emissions retain their payload type.
      source.emit("event");
      const folded = yield* context.fold({
        events: source.events,
        initial: 0,
        reducer: ({ state, event }) => state + event,
      });
      expectTypeOf(folded).toEqualTypeOf<Signal<number>>();
      // @ts-expect-error A fold reducer must return the state type.
      context.fold({ events: source.events, initial: 0, reducer: () => "invalid" });
      // @ts-expect-error Folded signals are read-only.
      folded.update((n: number) => n + 1);
      const button = yield* context.he("button");
      const clicks = yield* context.events(button, "click");
      context.subscribe(clicks, (event) => {
        expectTypeOf(event).toEqualTypeOf<HTMLElementEventMap["click"]>();
        return Effect.void;
      });
      // @ts-expect-error DOM event names are native and typed.
      context.events(button, "invented-event");
    });
  expectTypeOf(author).toBeFunction();
});

it("types independent reactive attributes, native properties, and writable text bindings", () => {
  const author = (ctx: ComponentContext) =>
    Effect.gen(function* () {
      const text = yield* ctx.signal({ initial: "text" });
      const optional = yield* ctx.signal({ initial: Option.some("hint") });
      const present = yield* ctx.signal({ initial: Option.some(true as const) });
      const disabled = yield* ctx.signal({ initial: false });
      const tabIndex = yield* ctx.signal({ initial: 0 });
      const input = yield* ctx.he("input", {
        attrs: { title: optional, required: present, hidden: Option.none() },
        props: { disabled, tabIndex, value: text, files: null },
      });
      const textarea = yield* ctx.he("textarea");
      ctx.bindValue({ element: textarea, signal: text });
      // @ts-expect-error Bare strings are not optional attributes.
      ctx.he("div", { attrs: { title: "hint" } });
      // @ts-expect-error Bare booleans are not optional attributes.
      ctx.he("div", { attrs: { hidden: false } });
      // @ts-expect-error Some(false) is not attribute removal.
      ctx.he("div", { attrs: { hidden: Option.some(false) } });
      // @ts-expect-error Attributes do not accept arbitrary objects.
      ctx.he("div", { attrs: { title: {} } });
      // @ts-expect-error Reactive native values retain the tag-specific type.
      ctx.he("input", { props: { disabled: text } });
      // @ts-expect-error Reactive attributes must be Option-wrapped.
      ctx.he("input", { attrs: { title: text } });
      // @ts-expect-error Readonly properties remain excluded even with signals.
      ctx.he("input", { props: { offsetHeight: tabIndex } });
      const derived = yield* ctx.derive({ sources: { text }, compute: ({ text }) => text });
      // @ts-expect-error Two-way binding requires a writable signal.
      ctx.bindValue({ element: input, signal: derived });
      // @ts-expect-error Two-way input values must be strings.
      ctx.bindValue({ element: input, signal: disabled });
      // @ts-expect-error Only input/textarea elements support two-way text binding.
      ctx.bindValue({ element: yield* ctx.he("select"), signal: text });
    });
  expectTypeOf(author).toBeFunction();
});

it("accepts covariant Option component signals at both construction boundaries", () => {
  const author = (
    ctx: ApplicationContext,
    parent: Element,
    signals: {
      empty: Signal<Option.Option<never>>;
      specific: Signal<Option.Option<Component & { readonly name: string }>>;
      boolean: Signal<boolean>;
      optionalBoolean: Signal<Option.Option<boolean>>;
      bare: Signal<Component>;
      node: Signal<Option.Option<Node>>;
      nullable: Signal<Component | null>;
      undefined: Signal<Component | undefined>;
    },
  ) => {
    ctx.h(parent, signals.empty);
    ctx.h(parent, [signals.specific, document.createTextNode("sibling")]);
    ctx.he("div", { children: [signals.empty, signals.specific] });
    // @ts-expect-error Selection requires an Option of a component definition.
    ctx.h(parent, signals.boolean);
    // @ts-expect-error Option booleans must first be derived into definitions.
    ctx.he("div", { children: [signals.optionalBoolean] });
    // @ts-expect-error Component selection requires explicit Option absence.
    ctx.h(parent, signals.bare);
    // @ts-expect-error Native node signals cannot select reusable definitions.
    ctx.h(parent, signals.node);
    // @ts-expect-error Null is not Option absence.
    ctx.he("div", { children: [signals.nullable] });
    // @ts-expect-error Undefined is not Option absence.
    ctx.h(parent, signals.undefined);
  };
  const describe = (failure: MountFailure) =>
    Match.value(failure).pipe(
      Match.when({ subject: { kind: "application" } }, (failure) => {
        // @ts-expect-error Application failures have no DOM parent.
        void failure.parent;
        return failure.subject.id;
      }),
      Match.when({ subject: { kind: "component" } }, (failure) => {
        expectTypeOf(failure.parent).toEqualTypeOf<Element>();
        return failure.subject.region;
      }),
      Match.when({ subject: { kind: "replacement" } }, (failure) => {
        expectTypeOf(failure.parent).toEqualTypeOf<Element>();
        return failure.subject.items;
      }),
      Match.exhaustive,
    );
  expectTypeOf(author).toBeFunction();
  expectTypeOf(describe).toBeFunction();
});

it("requires Result factories and fallbacks and preserves helper errors", () => {
  const author = (ctx: SynchronousContext, yieldSignal: Signal<string>) => {
    expectTypeOf(
      component(() => Result.succeed({ setup: () => Effect.succeed([]) })),
    ).toEqualTypeOf<Component<never, never, never>>();
    const valid = component(({ signal }) =>
      Result.gen(function* () {
        const label = yield* signal({ initial: "loading" });
        return {
          fallback: ({ he }) => he("p", { children: [label] }),
          setup: ({ he }) => he("article"),
        };
      }),
    );
    expectTypeOf(valid).toEqualTypeOf<
      Component<ReactiveError, ConstructionError, ConstructionError>
    >();
    ctx.he("div", { children: [valid] });
    expectTypeOf(ctx.signal({ initial: 0 })).toEqualTypeOf<
      Result.Result<WritableSignal<number>, ReactiveError>
    >();
    expectTypeOf(ctx.he("input")).toEqualTypeOf<
      Result.Result<HTMLInputElement, ConstructionError>
    >();
    expectTypeOf(ctx.read(yieldSignal)).toEqualTypeOf<Result.Result<string, ReactiveError>>();
    const composed = Result.gen(function* () {
      yield* ctx.signal({ initial: 0 });
      return yield* ctx.he("div");
    });
    expectTypeOf(composed).toEqualTypeOf<
      Result.Result<HTMLDivElement, ReactiveError | ConstructionError>
    >();
    ctx.addSyncFinalizer(() => {});
    // @ts-expect-error Synchronous finalizers cannot return a Promise.
    ctx.addSyncFinalizer(async () => {});
    // @ts-expect-error Factories require Result wrappers.
    component(() => ({ setup: () => Effect.succeed([]) }));
    // @ts-expect-error Factories cannot return Effects.
    component(() => Effect.succeed({ setup: () => Effect.succeed([]) }));
    // @ts-expect-error Factories cannot suspend.
    component(async () => ({ setup: () => Effect.succeed([]) }));
    component(() =>
      // @ts-expect-error Fallbacks require Result wrappers.
      Result.succeed({
        fallback: () => document.createElement("div"),
        setup: () => Effect.succeed([]),
      }),
    );
    component(() =>
      // @ts-expect-error Fallbacks cannot return Effects.
      Result.succeed({ fallback: () => Effect.succeed([]), setup: () => Effect.succeed([]) }),
    );
    // @ts-expect-error Fallbacks cannot return promises.
    component(() => Result.succeed({ fallback: async () => [], setup: () => Effect.succeed([]) }));
    // @ts-expect-error Batches accept thunks only.
    ctx.batch(Result.succeed(undefined));
    // @ts-expect-error Strings remain children, not root output.
    component(() => Result.succeed({ setup: () => Effect.succeed("text") }));
    // @ts-expect-error Root arrays cannot be nested.
    component(() => Result.succeed({ setup: () => Effect.succeed([[]]) }));
  };
  expectTypeOf(author).toBeFunction();
});
