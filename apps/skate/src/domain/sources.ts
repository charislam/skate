import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import { createClient } from "@supabase/supabase-js";
import { AsyncData } from "foldkit";

export class SourceError extends Schema.TaggedError<SourceError>()("SourceError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export const ActiveSourceCount = AsyncData.Schema(Schema.Number, SourceError);
export type ActiveSourceCount = typeof ActiveSourceCount.schema.Type;

export interface Interface {
  readonly countActive: Effect.Effect<number, SourceError>;
}

export class Service extends Context.Service<Service, Interface>()("skate/Sources") {}

const makeInterface = (url: string, publishableKey: string): Interface => {
  const client = createClient(url, publishableKey);
  return {
    countActive: Effect.gen(function* () {
      const { count, error } = yield* Effect.tryPromise({
        try: (signal) =>
          client
            .from("source")
            .select("*", { count: "exact", head: true })
            .eq("enabled", true)
            .abortSignal(signal),
        catch: (cause) => new SourceError({ message: "Could not load active sources.", cause }),
      });
      if (error || count === null) {
        return yield* Effect.fail(
          new SourceError({
            message: "Could not load active sources.",
            cause: error ?? new Error("Supabase returned no count."),
          }),
        );
      }
      return count;
    }),
  };
};

export const layerConfig = Layer.effect(
  Service,
  Effect.gen(function* () {
    const url = yield* Config.String("VITE_SUPABASE_URL");
    const publishableKey = yield* Config.Redacted("VITE_SUPABASE_PUBLISHABLE_KEY");
    return Service.of(makeInterface(url, Redacted.value(publishableKey)));
  }).pipe(Effect.orDie),
);

export * as Sources from "./sources";
