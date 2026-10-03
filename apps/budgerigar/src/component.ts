import { Predicate, type Effect, type Scope } from "effect";
import type { ComponentContext, Output } from "./framework";

const TypeId = "~budgerigar/Component";

export interface Component {
  readonly [TypeId]: typeof TypeId;
  readonly setup: (context: ComponentContext) => Effect.Effect<Output, unknown, Scope.Scope>;
}

export const component = (definition: Omit<Component, typeof TypeId>): Component => ({
  ...definition,
  [TypeId]: TypeId,
});

export const isComponent = (value: unknown): value is Component =>
  Predicate.hasProperty(value, TypeId);
