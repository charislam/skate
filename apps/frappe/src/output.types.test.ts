import { Effect, Option, Scope } from "effect";
import { expectTypeOf, it } from "vitest";
import * as frappeContext from "./context";
import {
  Sync,
  component,
  nativeNode,
  provideContext,
  type ApplicationContext,
  type Component,
  type ComponentContext,
  type ConstructionError,
  type ElementOutput,
  type EventStream,
  type Output,
  type ReactiveError,
  type SynchronousContext,
} from "./framework";

class User extends frappeContext.Service<User, string>()("frappe/output/User") {}
class Theme extends frappeContext.Service<Theme, string>()("frappe/output/Theme") {}

const Account = component(() =>
  Sync.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("p", { children: [yield* User] });
      }),
  }),
);
const Settings = component(() =>
  Sync.succeed({ setup: ({ he }) => he("section", { children: [Account] }) }),
);
const Themed = component(() => Sync.succeed({ setup: () => Theme.pipe(Effect.as([])) }));

it("infers nested opaque output requirements without consuming them at construction", () => {
  expectTypeOf(Account).toEqualTypeOf<Component<User, never, ConstructionError, never>>();
  expectTypeOf(Settings).toEqualTypeOf<Component<User, never, ConstructionError, never>>();
  const proof = (options: {
    ctx: ComponentContext;
    sync: SynchronousContext;
    app: ApplicationContext;
    target: Element;
  }) => {
    const mixed = options.ctx.he("div", {
      children: [
        Account,
        Themed,
        "text",
        component(() => Sync.succeed({ setup: () => Effect.succeed([]) })),
      ],
    });
    expectTypeOf(mixed).toEqualTypeOf<
      Effect.Effect<ElementOutput<HTMLDivElement, User | Theme>, ConstructionError>
    >();
    const synchronous = options.sync.he("input", { children: [Settings] });
    expectTypeOf(synchronous).toEqualTypeOf<
      Sync.Sync<ElementOutput<HTMLInputElement, User>, ConstructionError>
    >();
    const locallyProvided = component(() =>
      Sync.succeed({
        setup: () =>
          mixed.pipe(Effect.provideService(User, "local"), Effect.provideService(Theme, "local")),
      }),
    );
    // @ts-expect-error Local provision does not supply deferred children.
    options.app.h(options.target, locallyProvided);
    const syncProvided = component(({ he }) =>
      Sync.gen(function* () {
        const output = yield* he("div", { children: [Account] }).pipe(
          Sync.provideService(User, "local"),
        );
        return { setup: () => Effect.succeed(output) };
      }),
    );
    // @ts-expect-error Sync provision does not remove requirements from output.
    options.app.h(options.target, syncProvided);
    const closed = provideContext({
      key: Theme,
      value: "dark",
      child: provideContext({ key: User, value: "reader", child: locallyProvided }),
    });
    options.app.h(options.target, closed);
    // @ts-expect-error Framework scope cannot discharge a deferred output requirement.
    options.app.h(options.target, {} as ElementOutput<HTMLElement, Scope.Scope>);
  };
  void proof;
});

it("retains native types while preventing native widening and provider misuse", () => {
  const proof = (options: {
    ctx: ComponentContext;
    app: ApplicationContext;
    target: Element;
    input: ElementOutput<HTMLInputElement, User>;
  }) => {
    expectTypeOf(nativeNode(options.input)).toEqualTypeOf<HTMLInputElement>();
    expectTypeOf(options.ctx.events(options.input, "click")).toEqualTypeOf<
      Effect.Effect<EventStream<PointerEvent>, ReactiveError>
    >();
    options.ctx.bindValue({
      element: options.input,
      signal: {} as Parameters<ComponentContext["bindValue"]>[0]["signal"],
    });
    // @ts-expect-error Open output cannot widen to a closed handle.
    const closed: ElementOutput<HTMLInputElement> = options.input;
    // @ts-expect-error Handles do not implicitly convert to native elements.
    const native: HTMLInputElement = options.input;
    // @ts-expect-error Broad public output remains closed.
    const output: Output = options.input;
    // @ts-expect-error Explicit native export is not mountable.
    options.app.h(options.target, nativeNode(options.input));
    // @ts-expect-error Providers accept descriptions, not constructed handles.
    provideContext({ key: User, value: "reader", child: options.input });
    options.ctx.h(options.input, provideContext({ key: User, value: "reader", child: Account }));
    options.ctx.he("input", { props: { checked: true }, attrs: { title: Option.some("typed") } });
    // @ts-expect-error Tag-specific properties remain checked.
    options.ctx.he("div", { props: { checked: true } });
    void [closed, native, output];
  };
  void proof;
});
