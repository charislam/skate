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
  rink_id_text: Schema.String,
  enabled: Schema.Boolean,
  updated_at: Schema.String,
});

const summarySchema = Schema.Struct({
  inserted: Schema.Number,
  updated: Schema.Number,
  unchanged: Schema.Number,
  missingMarkedUncertain: Schema.Number,
  lastFetched: Schema.String,
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
            "id_text:id::text,name,type,url,notes,enabled,updated_at,rink_id_text:rink_id::text",
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
        rinkId: row.rink_id_text,
      });
    });
    const persist = Effect.fn("SourceRepository.persist")(
      function* (
        source: Source,
        completedAt: string,
        sessions: ReadonlyArray<SourceRepository.SessionWrite>,
        resolvedDays: ReadonlyArray<string>,
      ) {
        const result = yield* Effect.tryPromise({
          try: (signal) =>
            client.rpc("persist_scraped_sessions", {
              p_source_id: source.id,
              p_expected_updated_at: source.updatedAt,
              p_expected_rink_id: source.rinkId,
              p_completed_at: completedAt,
              p_sessions: sessions.map((session) => ({
                start: session.start,
                end: session.end,
                audience: session.audience,
                is_cancelled: session.isCancelled,
                certainty: session.certainty,
              })),
              p_resolved_days: resolvedDays,
            }).abortSignal(signal),
          catch: (cause) =>
            new SourceFailure({
              operation: "persist",
              cause: describeCause(cause),
            }),
        }).pipe(
          Effect.timeout("10 seconds"),
          Effect.mapError((error) =>
            new SourceFailure({
              operation: Cause.isTimeoutError(error) ? "db_timeout" : "persist",
              cause: describeCause(error),
            })
          ),
        );
        if (
          result.error !== null &&
          result.error.message.includes("SourceChanged")
        ) {
          return yield* Effect.fail(
            new SourceChanged({
              sourceId: source.id,
              cause: "The persistence transaction found a changed source",
            }),
          );
        }
        if (result.error !== null) {
          return yield* Effect.fail(
            new SourceFailure({
              operation: "persist",
              cause: describeCause(result.error),
            }),
          );
        }
        if (result.data === null) {
          return yield* Effect.fail(
            new SourceFailure({
              operation: "persist_decode",
              cause: "Persistence returned no summary",
            }),
          );
        }
        return yield* Schema.decodeUnknownEffect(summarySchema)(result.data)
          .pipe(Effect.mapError((cause) =>
            new SourceFailure({
              operation: "persist_decode",
              cause: describeCause(cause),
            })
          ));
      },
    );
    return SourceRepository.Service.of({ find, persist });
  }),
);
