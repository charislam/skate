import { Context as EffectContext, Predicate, type Unify } from "effect";
import { TokenKind } from "./resource";

export const ContextIdentifier: unique symbol = Symbol("frappe/ContextIdentifier");

export interface Identifier {
  readonly [ContextIdentifier]: typeof ContextIdentifier;
}

export type Token<I extends Identifier, S> = Omit<
  EffectContext.Key<I, S>,
  typeof Unify.unifySymbol | typeof Unify.typeSymbol | typeof Unify.ignoreSymbol
> & {
  readonly [TokenKind]: "context";
};

/** Ancestor bindings use Effect keys, in a namespace separate from resources. */
export const Service =
  <Self, Shape>() =>
  <const Name extends string>(name: Name) => {
    class ContextService extends EffectContext.Service<Self, Shape>()(`frappe/Context/${name}`) {
      declare readonly [ContextIdentifier]: typeof ContextIdentifier;
      static readonly [TokenKind] = "context" as const;
    }
    return ContextService;
  };

export const isToken = (value: unknown): value is Token<Identifier, unknown> =>
  EffectContext.isKey(value) &&
  Predicate.hasProperty(value, TokenKind) &&
  value[TokenKind] === "context" &&
  typeof value.key === "string" &&
  value.key.startsWith("frappe/Context/");
