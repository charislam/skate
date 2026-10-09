import { Context as EffectContext, Effect, Layer, Scope, Stream } from "effect";
import { expectTypeOf, it } from "vitest";
import {
  component,
  Context,
  mounting,
  provideContext,
  Resource,
  Sync,
  type ApplicationContext,
  type Component,
  type ReactiveError,
  type Signal,
} from "./framework";
import type { Structural } from "./requirements";

class First extends Resource.Service<First, string>()("types/First") {}
class Second extends Resource.Service<Second, string>()("types/Second") {}
class Binding extends Context.Service<Binding, string>()("types/First") {}
class OtherBinding extends Context.Service<OtherBinding, string>()("types/OtherBinding") {}
class Infrastructure extends EffectContext.Service<Infrastructure, string>()(
  "types/Infrastructure",
) {}

const ReadFirst = component(() =>
  Sync.gen(function* () {
    yield* Sync.service(First);
    return { setup: () => First.pipe(Effect.as([])) };
  }),
);
const ReadSecond = component(() => Sync.succeed({ setup: () => Second.pipe(Effect.as([])) }));
const ReadBinding = component(() => Sync.succeed({ setup: () => Binding.pipe(Effect.as([])) }));
const ReadOrdinary = component(() =>
  Sync.succeed({ setup: () => Infrastructure.pipe(Effect.as([])) }),
);

it("retains identifier kinds, names, ordinary Effect and Layer interoperability", () => {
  expectTypeOf<Exclude<First | Second, First>>().toEqualTypeOf<Second>();
  expectTypeOf<Exclude<First | Binding, First>>().toEqualTypeOf<Binding>();
  expectTypeOf<Exclude<Binding | OtherBinding, Binding>>().toEqualTypeOf<OtherBinding>();
  expectTypeOf(
    Effect.gen(function* () {
      return yield* First;
    }),
  ).toEqualTypeOf<Effect.Effect<string, never, First>>();
  expectTypeOf(Sync.service(Binding)).toEqualTypeOf<Sync.Sync<string, never, Binding>>();
  expectTypeOf(Layer.effect(First, Effect.succeed(First.of("first")))).toEqualTypeOf<
    Layer.Layer<First>
  >();
  expectTypeOf(Layer.succeed(Binding, Binding.of("binding"))).toEqualTypeOf<Layer.Layer<Binding>>();
});

it("validates the exported graph and preserves acquisition inputs and errors", () => {
  const proof = (scope: Scope.Scope) => {
    const options = { scope, onError: () => {} };
    expectTypeOf(mounting(options)).toEqualTypeOf<Effect.Effect<ApplicationContext>>();
    expectTypeOf(mounting({ ...options, resources: Layer.empty })).toEqualTypeOf<
      Effect.Effect<ApplicationContext>
    >();
    const layer = Layer.effect(
      First,
      Infrastructure.pipe(Effect.andThen(Effect.fail("acquisition" as const))),
    );
    expectTypeOf(mounting({ ...options, resources: layer })).toEqualTypeOf<
      Effect.Effect<ApplicationContext<First>, "acquisition", Infrastructure>
    >();
    mounting({
      ...options,
      resources: layer.pipe(Layer.provide(Layer.succeed(Infrastructure, "private"))),
    });
    // @ts-expect-error Context outputs cannot become runtime resources.
    mounting({ ...options, resources: Layer.succeed(Binding, "binding") });
    // @ts-expect-error Ordinary outputs require explicit resource adapter tags.
    mounting({ ...options, resources: Layer.succeed(Infrastructure, "ordinary") });
    // @ts-expect-error Scope cannot be a runtime resource.
    mounting({ ...options, resources: Layer.succeed(Scope.Scope, scope) });
    mounting({
      ...options,
      // @ts-expect-error Framework bookkeeping cannot be a runtime resource.
      resources: Layer.succeed(Layer.CurrentMemoMap, Layer.makeMemoMapUnsafe()),
    });
    // @ts-expect-error Component contexts cannot satisfy acquisition inputs.
    mounting({ ...options, resources: Layer.effect(First, Binding) });
    mounting({
      ...options,
      // @ts-expect-error Framework memoization is owned by each runtime, not an acquisition input.
      resources: Layer.effect(First, Layer.CurrentMemoMap.pipe(Effect.as("invalid"))),
    });
    mounting({
      ...options,
      // @ts-expect-error Structural acquisition inputs cannot be resolved as services.
      resources: Layer.effect(
        First,
        Effect.never as Effect.Effect<string, never, Structural<Infrastructure>>,
      ),
    });
    const invalid = { ...options, resources: Layer.succeed(Infrastructure, "ordinary") };
    // @ts-expect-error A variable must not fall through to the resource-free overload.
    mounting(invalid);
    // @ts-expect-error Generic arguments cannot claim resources without supplying a layer.
    mounting<First, never, never>(options);
  };
  void proof;
});

it("mounts exactly the supplied resources through nested heterogeneous outputs", () => {
  const proof = (options: {
    app: ApplicationContext<First | Second>;
    partial: ApplicationContext<First>;
    empty: ApplicationContext;
    parent: Element;
  }) => {
    const { app, partial, empty, parent } = options;
    app.h(parent, [ReadFirst, ReadSecond]);
    partial.h(parent, ReadFirst);
    const FallbackResource = component(() =>
      Sync.succeed({
        fallback: () => Sync.service(Second).pipe(Sync.map(() => [])),
        setup: () => Effect.succeed([]),
      }),
    );
    // @ts-expect-error Fallback requirements must also be supplied.
    partial.h(parent, FallbackResource);
    app.h(parent, FallbackResource);
    const Mixed = component(() =>
      Sync.succeed({ setup: ({ he }) => he("div", { children: [ReadFirst, ReadSecond] }) }),
    );
    app.h(parent, Mixed);
    // @ts-expect-error Partial graphs cannot mount heterogeneous requirements.
    partial.h(parent, Mixed);
    // @ts-expect-error Resource-free callers cannot mount resource consumers.
    empty.h(parent, ReadFirst);
    // @ts-expect-error Resources do not satisfy unprovided context requirements.
    app.h(parent, ReadBinding);
    app.h(parent, provideContext({ key: Binding, value: "binding", child: ReadBinding }));
    // @ts-expect-error Direct ordinary service dependencies cannot mount.
    app.h(parent, ReadOrdinary);
    const Private = component(() =>
      Sync.succeed({
        setup: () =>
          Infrastructure.pipe(Effect.provideService(Infrastructure, "local"), Effect.as([])),
      }),
    );
    app.h(parent, Private);
    // @ts-expect-error Providers cannot satisfy or override resources.
    provideContext({ key: First, value: "resource", child: ReadFirst });
    // @ts-expect-error Providers reject ordinary tokens.
    provideContext({ key: Infrastructure, value: "ordinary", child: ReadOrdinary });
    const NeedsBoth = component(() =>
      Sync.succeed({
        setup: () =>
          Effect.gen(function* () {
            yield* Binding;
            yield* First;
            return [];
          }),
      }),
    );
    const ContextClosed = provideContext({ key: Binding, value: "binding", child: NeedsBoth });
    expectTypeOf(ContextClosed).toEqualTypeOf<Component<First, never, never, never>>();
    // @ts-expect-error Providing context retains resources.
    empty.h(parent, ContextClosed);
    // @ts-expect-error An application with fewer resources cannot widen to a larger graph.
    const widened: ApplicationContext<First | Second> = partial;
    void widened;
  };
  void proof;
});

it("discharges application helper resources while preserving residual and structural requirements", () => {
  const proof = (app: ApplicationContext<First>) => {
    expectTypeOf(app.fork(First)).toEqualTypeOf<Effect.Effect<void>>();
    expectTypeOf(app.fork(Second)).toEqualTypeOf<Effect.Effect<void, never, Second>>();
    expectTypeOf(app.batch(First)).toEqualTypeOf<Effect.Effect<string, ReactiveError>>();
    expectTypeOf(app.subscribeStream(Stream.fromEffect(First), () => Second)).toEqualTypeOf<
      Effect.Effect<void, ReactiveError, Second>
    >();
    expectTypeOf(
      app.foldStream({
        stream: Stream.fromEffect(First),
        initial: "",
        reducer: ({ event }) => event,
      }),
    ).toEqualTypeOf<Effect.Effect<Signal<string>, ReactiveError>>();
    expectTypeOf(
      app.fork(Effect.never as Effect.Effect<void, never, Structural<First>>),
    ).toEqualTypeOf<Effect.Effect<void, never, Structural<First>>>();
    const Registered = component(() =>
      Sync.succeed({
        setup: ({ fork, subscribeStream }) =>
          Effect.gen(function* () {
            yield* fork(First);
            yield* subscribeStream(Stream.fromEffect(Second), () => Binding);
            return [];
          }),
      }),
    );
    expectTypeOf(Registered).toEqualTypeOf<
      Component<First | Second | Binding, never, ReactiveError, never>
    >();
    // @ts-expect-error Helper registrations retain unsupplied requirements.
    app.h(document.createElement("div"), Registered);
    const DeferredChild = component(() =>
      Sync.succeed({
        setup: ({ h }) =>
          Effect.gen(function* () {
            yield* h(document.createElement("div"), ReadSecond).pipe(
              Effect.provideService(Second, "local"),
            );
            return [];
          }),
      }),
    );
    // @ts-expect-error Local computation provision cannot erase structural children.
    app.h(document.createElement("div"), DeferredChild);
  };
  void proof;
});
