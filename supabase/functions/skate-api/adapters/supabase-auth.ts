import { verifyAuth } from "@supabase/server/core";
import { ConfigService } from "../config.ts";
import { describeCause } from "../domain/error-details.ts";
import { Effect, Layer, Redacted } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { AuthenticatedService, AuthMiddleware } from "../api.ts";

export const authLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const selectedSecret = config.secretKeys[config.secretKeyName];
    const secretKeys = Object.fromEntries(
      Object.entries(config.secretKeys).map(([name, value]) => [
        name,
        Redacted.value(value),
      ]),
    );

    return Layer.succeed(AuthMiddleware)((httpEffect, _options) =>
      Effect.gen(function* () {
        if (selectedSecret === undefined) {
          return yield* HttpServerResponse.json({
            code: "internal_error",
            message: "Authentication is not configured",
            requestId: crypto.randomUUID(),
          }, { status: 500 }).pipe(Effect.orDie);
        }
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestId = request.headers["x-request-id"] ??
          crypto.randomUUID();
        const verification = yield* Effect.tryPromise({
          try: () =>
            verifyAuth(
              new Request("https://skate-api.invalid/", {
                headers: { apikey: request.headers.apikey ?? "" },
              }),
              {
                auth: `secret:${config.secretKeyName}`,
                env: {
                  url: config.supabaseUrl,
                  secretKeys,
                  publishableKeys: {},
                  jwks: null,
                },
              },
            ),
          catch: (cause) =>
            new Error("credential_verification_failed", { cause }),
        }).pipe(
          Effect.catch((cause) =>
            Effect.logError("Credential verification threw", {
              requestId,
              cause: describeCause(cause),
            }).pipe(Effect.as(null))
          ),
        );
        if (verification === null || verification.error !== null) {
          return yield* HttpServerResponse.json({
            code: "unauthorized",
            message: "A valid secret API key is required",
            requestId,
          }, { status: 401 }).pipe(Effect.orDie);
        }
        return yield* Effect.provideService(httpEffect, AuthenticatedService, {
          keyName: config.secretKeyName,
        });
      })
    );
  }),
);
