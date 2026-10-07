import { Context, Effect, Match, Predicate, Scope } from "effect";
import type { ComponentContext, SynchronousContext, Output } from "./framework";
import type { Normalize, OutputRequirements } from "./requirements";
import { CurrentTransaction } from "./reactive/runtime";
import { succeed, type Sync } from "./sync";

const TypeId = "~budgerigar/Component";
export interface Lifecycle<
  ESetup = unknown,
  EFallback = unknown,
  RO = never,
  RS = never,
  RB = never,
> {
  readonly fallback?: (context: SynchronousContext) => Sync<Output<RO>, EFallback, RB>;
  readonly setup: (
    context: ComponentContext,
  ) => Effect.Effect<Output<RO>, ESetup, RS | Scope.Scope>;
}
/** Infer complete output shapes before taking their distributive requirement union. */
export interface FactoryLifecycle<
  ES,
  EB,
  OS extends Output<unknown>,
  OB extends Output<unknown>,
  RS,
  RB,
> {
  readonly setup: (context: ComponentContext) => Effect.Effect<OS, ES, RS | Scope.Scope>;
  readonly fallback?: (context: SynchronousContext) => Sync<OB, EB, RB>;
}
export interface Component<
  out R = never,
  out EFactory = unknown,
  out ESetup = unknown,
  out EFallback = unknown,
> {
  readonly [TypeId]: typeof TypeId;
  readonly requirements?: () => R;
  readonly factory: (
    context: SynchronousContext,
  ) => Sync<Lifecycle<ESetup, EFallback, unknown, unknown, unknown>, EFactory, unknown>;
}
/** Descriptions are inert; each committed mount creates its own closure. */
export const component = <
  EFactory = never,
  ESetup = never,
  EFallback = never,
  RF = never,
  RS = never,
  RB = never,
  OS extends Output<unknown> = never,
  OB extends Output<unknown> = never,
>(
  factory: (
    context: SynchronousContext,
  ) => Sync<FactoryLifecycle<ESetup, EFallback, OS, OB, RS, RB>, EFactory, RF>,
): Component<
  Normalize<Exclude<RF | RS | RB, Scope.Scope>> | OutputRequirements<OS | OB>,
  EFactory,
  ESetup,
  EFallback
> => ({ factory, [TypeId]: TypeId });
export const isComponent = (value: unknown): value is Component<unknown> =>
  Predicate.hasProperty(value, TypeId);

const providers = new WeakMap<object, (parent: Context.Context<never>) => Context.Context<never>>();

/** Providers are descriptions; their binding is installed separately for each occurrence. */
export const provideContext = <I, S, R>(options: {
  readonly key: Context.Key<I, S>;
  readonly value: NoInfer<S>;
  readonly child: Component<R>;
}): Component<Exclude<R, I>, never, never, never> => {
  Match.value(
    isComponent(options.child) &&
      options.key.key !== Scope.Scope.key &&
      options.key.key !== CurrentTransaction.key,
  ).pipe(
    Match.when(true, () => {}),
    Match.when(false, () => {
      throw new TypeError("Budgerigar providers require a component and a user service token");
    }),
    Match.exhaustive,
  );
  const definition: Component<Exclude<R, I>, never, never, never> = {
    [TypeId]: TypeId,
    factory: () => succeed({ setup: () => Effect.succeed(options.child) }),
  };
  providers.set(definition, (parent) => Context.add(parent, options.key, options.value));
  return definition;
};

/** Internal owner-tree provision, independent of local computation environments. */
export const subtreeContext = (options: {
  readonly definition: Component<unknown>;
  readonly parent: Context.Context<never>;
}): Context.Context<never> => providers.get(options.definition)?.(options.parent) ?? options.parent;
