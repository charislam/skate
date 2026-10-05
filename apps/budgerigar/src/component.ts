import { Predicate, type Effect, type Result, type Scope } from "effect";
import type { ComponentContext, SynchronousContext, Output } from "./framework";

const TypeId = "~budgerigar/Component";
export interface Lifecycle<ESetup = unknown, EFallback = unknown> {
  readonly fallback?: (context: SynchronousContext) => Result.Result<Output, EFallback>;
  readonly setup: (context: ComponentContext) => Effect.Effect<Output, ESetup, Scope.Scope>;
}
export interface Component<EFactory = unknown, ESetup = unknown, EFallback = unknown> {
  readonly [TypeId]: typeof TypeId;
  readonly factory: (
    context: SynchronousContext,
  ) => Result.Result<Lifecycle<ESetup, EFallback>, EFactory>;
}
/** Descriptions are inert; each committed mount creates its own closure. */
export const component = <EFactory = never, ESetup = never, EFallback = never>(
  factory: (context: SynchronousContext) => Result.Result<Lifecycle<ESetup, EFallback>, EFactory>,
): Component<EFactory, ESetup, EFallback> => ({ factory, [TypeId]: TypeId });
export const isComponent = (value: unknown): value is Component =>
  Predicate.hasProperty(value, TypeId);
