import { Context, Effect, Layer } from "effect";

export interface Interface {
  readonly fetchRinks: () => Effect.Effect<void>;
}

export class Service extends Context.Service<Service, Interface>()("@inflow/RinkSource") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return {
      fetchRinks: () => Effect.void,
    };
  }),
);

export * as RinkSource from "./rink-source.js";
