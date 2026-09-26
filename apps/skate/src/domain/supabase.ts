import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { Config, Context, Effect, Layer, Redacted } from "effect";

export class Service extends Context.Service<Service, SupabaseClient>()("skate/Supabase") {}

export const layerConfig = Layer.effect(
  Service,
  Effect.gen(function* () {
    const url = yield* Config.String("VITE_SUPABASE_URL");
    const publishableKey = yield* Config.Redacted("VITE_SUPABASE_PUBLISHABLE_KEY");
    return Service.of(createClient(url, Redacted.value(publishableKey)));
  }).pipe(Effect.orDie),
);

export * as Supabase from "./supabase";
