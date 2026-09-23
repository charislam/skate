import { Context, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";

export interface Interface {
  readonly fetch: () => Effect.Effect<void>;
}

export class Service extends Context.Service<Service, Interface>()("@inflow/RinkSource") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    return {
      fetch: () => Effect.void,
    };
  }),
);

export * as RinkSource from "./rink-source.js";
