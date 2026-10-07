import { Context as EffectContext } from "effect";

export const ResourceIdentifier: unique symbol = Symbol("Budgerigar/ResourceIdentifier");
export const TokenKind: unique symbol = Symbol("Budgerigar/TokenKind");

export interface Identifier {
  readonly [ResourceIdentifier]: typeof ResourceIdentifier;
}

/** Effect service classes whose identifier retains the resource kind. */
export const Service =
  <Self, Shape>() =>
  <const Name extends string>(name: Name) => {
    class ResourceService extends EffectContext.Service<Self, Shape>()(
      `Budgerigar/Resource/${name}`,
    ) {
      declare readonly [ResourceIdentifier]: typeof ResourceIdentifier;
      static readonly [TokenKind] = "resource" as const;
    }
    return ResourceService;
  };
