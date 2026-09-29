import { Effect, Layer, Schema } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api, ScrapeInput } from "./api.ts";
import { authLayer } from "./adapters/supabase-auth.ts";
import { htmlSourceLayer } from "./adapters/html-source.ts";
import { jevLayer } from "./adapters/jev.ts";
import { sourceRepositoryLayer } from "./adapters/supabase-source.ts";
import { configLayer } from "./config.ts";
import { describeCause } from "./domain/error-details.ts";
import { scrape } from "./services/source-scraper.ts";

const sendError = (
  status: number,
  code: string,
  message: string,
  requestId: string,
) =>
  HttpServerResponse.json({ code, message, requestId }, { status }).pipe(
    Effect.orDie,
  );

const unexpectedError = (error: never): never => error;

const errorDetails = (error: unknown) => {
  if (error instanceof Error) {
    return {
      tag: "_tag" in error ? error._tag : undefined,
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: "cause" in error ? describeCause(error.cause) : undefined,
      details: Object.fromEntries(
        Object.entries(error).filter(([key]) =>
          key !== "cause" && key !== "stack" && key !== "message" &&
          key !== "name" && key !== "_tag"
        ),
      ),
    };
  }
  return { message: String(error) };
};

const logAndSendError = (
  error: unknown,
  status: number,
  code: string,
  message: string,
  requestId: string,
) =>
  Effect.logError("API error", {
    requestId,
    status,
    code,
    error: errorDetails(error),
  }).pipe(Effect.flatMap(() => sendError(status, code, message, requestId)));

const groupLayer = HttpApiBuilder.group(
  Api,
  "source",
  (
    handlers: HttpApiBuilder.Handlers.FromGroup<
      NonNullable<typeof Api.groups.source>
    >,
  ) =>
    handlers.handleRaw("scrape", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestId = request.headers["x-request-id"] ??
          crypto.randomUUID();
        if (
          (request.headers["content-type"] ?? "").split(";")[0].trim()
            .toLowerCase() !== "application/json"
        ) {
          return yield* sendError(
            415,
            "unsupported_media_type",
            "Content-Type must be application/json",
            requestId,
          );
        }
        const declaredLength = Number(request.headers["content-length"] ?? 0);
        if (declaredLength > 4096) {
          return yield* sendError(
            413,
            "request_too_large",
            "Request body exceeds 4 KiB",
            requestId,
          );
        }
        const rawRequest = request.source as Request;
        const body = rawRequest.body;
        if (body === null) {
          return yield* sendError(
            400,
            "invalid_request",
            "Request body is required",
            requestId,
          );
        }
        const reader = body.getReader();
        const chunks: Array<Uint8Array> = [];
        let size = 0;
        while (true) {
          const part = yield* Effect.tryPromise({
            try: () => reader.read(),
            catch: (cause) => new Error("Request body read failed", { cause }),
          });
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 4096) {
            yield* Effect.tryPromise({
              try: () => reader.cancel(),
              catch: (cause) =>
                new Error("Oversized request body cancellation failed", {
                  cause,
                }),
            });
            return yield* sendError(
              413,
              "request_too_large",
              "Request body exceeds 4 KiB",
              requestId,
            );
          }
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        let json: unknown;
        try {
          json = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return yield* sendError(
            400,
            "invalid_request",
            "Request body must be valid JSON",
            requestId,
          );
        }
        if (
          typeof json !== "object" || json === null || Array.isArray(json) ||
          Object.keys(json).length !== 1 || !("sourceId" in json)
        ) {
          return yield* sendError(
            400,
            "invalid_request",
            "Expected exactly one sourceId string",
            requestId,
          );
        }
        let payload: Schema.Schema.Type<typeof ScrapeInput>;
        try {
          payload = Schema.decodeUnknownSync(ScrapeInput)(json);
        } catch {
          return yield* sendError(
            400,
            "invalid_request",
            "Expected exactly one sourceId string",
            requestId,
          );
        }
        const scrapeResponse = scrape(payload.sourceId, requestId).pipe(
          Effect.timeout("120 seconds"),
          Effect.catchTag("SourceNotFound", (error) =>
            logAndSendError(
              error,
              404,
              "source_not_found",
              "Source was not found",
              requestId,
            )),
          Effect.catchTag(
            "SourceDisabled",
            (error) =>
              logAndSendError(
                error,
                409,
                "source_disabled",
                "Source is disabled",
                requestId,
              ),
          ),
          Effect.catchTag("SourceChanged", (error) =>
            logAndSendError(
              error,
              409,
              "source_changed",
              "Source changed during processing",
              requestId,
            )),
          Effect.catchTag("UnsupportedSourceType", (error) =>
            logAndSendError(
              error,
              422,
              "unsupported_source_type",
              "Source type is not supported",
              requestId,
            )),
          Effect.catchTag("UnsafeSourceUrl", (error) =>
            logAndSendError(
              error,
              422,
              "unsafe_source_url",
              "Source URL is not allowed",
              requestId,
            )),
          Effect.catchTag("SourceContentTooLarge", (error) =>
            logAndSendError(
              error,
              422,
              "source_content_too_large",
              "Source content is too large",
              requestId,
            )),
          Effect.catchTag("ClassifierOverloaded", (error) =>
            logAndSendError(
              error,
              503,
              "classifier_unavailable",
              "Classifier is temporarily unavailable",
              requestId,
            )),
          Effect.catchTag("ClassifierFailure", (error) =>
            logAndSendError(
              error,
              error.status === 504 ? 504 : 502,
              error.status === 504 ? "deadline_exceeded" : "classifier_failure",
              error.status === 504
                ? "Processing deadline exceeded"
                : "Classifier could not process this source",
              requestId,
            )),
          Effect.catchTag("TimeoutError", (error) =>
            logAndSendError(
              error,
              504,
              "deadline_exceeded",
              "Processing deadline exceeded",
              requestId,
            )),
          Effect.catchTag("SourceFailure", (error) => {
            const status = error.operation === "fetch_timeout" ||
                error.operation === "db_timeout"
              ? 504
              : error.operation === "media_type" ||
                  error.operation === "state_too_large"
              ? 422
              : error.operation === "fetch" || error.operation === "read" ||
                  error.operation === "empty_body" ||
                  error.operation === "decode" ||
                  error.operation === "result_validation" ||
                  error.operation === "classifier_budget"
              ? 502
              : 503;
            return logAndSendError(
              error,
              status,
              status === 504
                ? "deadline_exceeded"
                : "source_processing_failure",
              status === 504
                ? "Processing deadline exceeded"
                : "Source processing failed",
              requestId,
            );
          }),
          Effect.catch((error) => Effect.die(unexpectedError(error))),
          Effect.flatMap((summary) =>
            Effect.logInfo("Scrape persistence committed", summary).pipe(
              Effect.as(HttpServerResponse.empty({ status: 204 })),
            )
          ),
        );
        const result = yield* scrapeResponse;
        return result;
      }).pipe(
        Effect.catch((error) =>
          logAndSendError(
            error,
            500,
            "internal_error",
            "Request failed",
            crypto.randomUUID(),
          )
        ),
        Effect.catchDefect((defect) =>
          logAndSendError(
            defect,
            500,
            "internal_error",
            "Request failed",
            crypto.randomUUID(),
          )
        ),
      )),
);

const backendServices = Layer.mergeAll(
  authLayer,
  sourceRepositoryLayer,
  htmlSourceLayer,
  jevLayer,
).pipe(Layer.provide(configLayer));
export const appLayer = HttpApiBuilder.layer(Api).pipe(
  Layer.provideMerge(groupLayer),
  Layer.provideMerge(backendServices),
  Layer.provideMerge(HttpServer.layerServices),
);

export const makeHandler = Effect.sync(() => HttpRouter.toWebHandler(appLayer));
