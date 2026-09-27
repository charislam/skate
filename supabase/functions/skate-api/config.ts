import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import { describeCause } from "./domain/error-details.ts";

export interface Configuration {
  readonly supabaseUrl: string;
  readonly supabaseSecretKey: Redacted.Redacted<string>;
  readonly secretKeys: Readonly<Record<string, Redacted.Redacted<string>>>;
  readonly secretKeyName: string;
  readonly typesafeApiKey: Redacted.Redacted<string>;
  readonly model: string;
  readonly sourceHosts: ReadonlyArray<string>;
}

export class ConfigService
  extends Context.Service<ConfigService, Configuration>()("SkateApi/Config") {}

export const configLayer = Layer.effect(
  ConfigService,
  Effect.gen(function* () {
    const supabaseUrl = yield* Config.String("SUPABASE_URL");
    const rawSecretKeys = yield* Config.String("SUPABASE_SECRET_KEYS");
    const secretKeyName = yield* Config.String("SKATE_API_KEY_NAME").pipe(
      Config.withDefault("default"),
    );
    const secretKeysJson = yield* Effect.try({
      try: () => JSON.parse(rawSecretKeys),
      catch: (cause) =>
        new Error("SUPABASE_SECRET_KEYS must be a JSON object", { cause }),
    });
    const decodedSecretKeys = yield* Schema.decodeUnknownEffect(
      Schema.Record(Schema.String, Schema.String),
    )(secretKeysJson).pipe(
      Effect.mapError((cause) =>
        new Error(
          `SUPABASE_SECRET_KEYS must be a string map: ${describeCause(cause)}`,
          { cause },
        )
      ),
    );
    const secretKeys = Object.fromEntries(
      Object.entries(decodedSecretKeys).map(([name, value]) => [
        name,
        Redacted.make(value),
      ]),
    );
    const selectedSecret = secretKeys[secretKeyName];
    if (selectedSecret === undefined) {
      return yield* Effect.fail(
        new Error(
          `Configured Supabase secret key '${secretKeyName}' is missing`,
        ),
      );
    }
    const supabaseSecretKey = selectedSecret;
    const typesafeApiKey = yield* Config.Redacted("TYPESAFE_API_KEY");
    const model = yield* Config.String("TYPESAFE_MODEL").pipe(
      Config.withDefault("jev-1.13.0"),
    );
    const sourceHosts = yield* Config.String("SKATE_API_TRUSTED_SOURCE_HOSTS")
      .pipe(Config.withDefault(""));

    return ConfigService.of({
      supabaseUrl,
      supabaseSecretKey,
      secretKeys,
      secretKeyName,
      typesafeApiKey,
      model,
      sourceHosts: sourceHosts.split(",").map((host) =>
        host.trim().toLowerCase()
      ).filter(Boolean),
    });
  }),
);
