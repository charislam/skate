import { createClient } from "@supabase/supabase-js";
import { describeCause } from "../domain/error-details.ts";
import { ConfigService } from "../config.ts";
import {
  Source,
  SourceChanged,
  SourceFailure,
  SourceId,
  SourceNotFound,
} from "../domain/source.ts";
import { SourceRepository } from "../services/source-repository.ts";
import { Cause, Effect, Layer, Redacted, Schema } from "effect";

const DatabaseRow = Schema.Struct({
  id_text: SourceId,
  name: Schema.String,
  type: Schema.String,
  url: Schema.String,
  notes: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  updated_at: Schema.String,
});

export const sourceRepositoryLayer = Layer.effect(
  SourceRepository.Service,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const client = createClient(
      config.supabaseUrl,
      Redacted.value(config.supabaseSecretKey),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    const find = Effect.fn("SourceRepository.find")(function* (id: SourceId) {
      const result = yield* Effect.tryPromise({
        try: (signal) =>
          client.from("source").select(
            "id_text:id::text,name,type,url,notes,enabled,updated_at",
          ).eq("id", id).abortSignal(signal).maybeSingle(),
        catch: (cause) =>
          new SourceFailure({ operation: "find", cause: describeCause(cause) }),
      }).pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError((error) =>
          new SourceFailure({
            operation: Cause.isTimeoutError(error) ? "db_timeout" : "find",
            cause: describeCause(error),
          })
        ),
      );
      if (result.error !== null) {
        return yield* Effect.fail(
          new SourceFailure({
            operation: "find",
            cause: describeCause(result.error),
          }),
        );
      }
      if (result.data === null) {
        return yield* Effect.fail(
          new SourceNotFound({
            sourceId: id,
            cause: "The source query returned no matching row",
          }),
        );
      }
      const row = yield* Schema.decodeUnknownEffect(DatabaseRow)(result.data)
        .pipe(
          Effect.mapError((cause) =>
            new SourceFailure({
              operation: "decode",
              cause: describeCause(cause),
            })
          ),
        );
      return Source.make({
        id: row.id_text,
        name: row.name,
        type: row.type,
        url: row.url,
        notes: row.notes,
        enabled: row.enabled,
        updatedAt: row.updated_at,
      });
    });
    const complete = Effect.fn("SourceRepository.complete")(
      function* (source: Source, completedAt: string) {
        const result = yield* Effect.tryPromise({
          try: (signal) =>
            client.from("source").update({ last_fetched: completedAt }).eq(
              "id",
              source.id,
            ).eq("updated_at", source.updatedAt).eq("enabled", true)
              .abortSignal(signal).select("last_fetched").maybeSingle(),
          catch: (cause) =>
            new SourceFailure({
              operation: "complete",
              cause: describeCause(cause),
            }),
        }).pipe(
          Effect.timeout("10 seconds"),
          Effect.mapError((error) =>
            new SourceFailure({
              operation: Cause.isTimeoutError(error)
                ? "db_timeout"
                : "complete",
              cause: describeCause(error),
            })
          ),
        );
        if (result.error !== null) {
          return yield* Effect.fail(
            new SourceFailure({
              operation: "complete",
              cause: describeCause(result.error),
            }),
          );
        }
        if (
          result.data === null || typeof result.data.last_fetched !== "string"
        ) {
          return yield* Effect.fail(
            new SourceChanged({
              sourceId: source.id,
              cause:
                "The conditional last_fetched update matched no enabled unchanged source row",
            }),
          );
        }
        return result.data.last_fetched;
      },
    );
    return SourceRepository.Service.of({ find, complete });
  }),
);
