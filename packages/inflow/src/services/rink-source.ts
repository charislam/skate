import { Context, Effect, Layer } from "effect";

export interface Interface {
  readonly fetch: () => Effect.Effect<void>;
}

export class Service extends Context.Service<Service, Interface>()("@inflow/RinkSource") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return {
      fetch: () => Effect.void,
    };
  }),
);

export * as RinkSource from "./rink-source.js";
