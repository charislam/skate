import { Context, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/unstable/httpapi";
import { Result } from "./domain/schedule.ts";
import { SourceId } from "./domain/source.ts";

export const ScrapeInput = Schema.Struct({ sourceId: SourceId });
export const PublicError = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  requestId: Schema.String,
});
export class AuthenticatedService
  extends Context.Service<AuthenticatedService, { readonly keyName: string }>()(
    "SkateApi/AuthenticatedService",
  ) {}

export class AuthMiddleware extends HttpApiMiddleware.Service<
  AuthMiddleware,
  { provides: AuthenticatedService }
>()("SkateApi/Auth", {
  error: PublicError,
}) {}

export const Api = HttpApi.make("SkateApi")
  .add(
    HttpApiGroup.make("source").add(
      HttpApiEndpoint.post("scrape", "/source/scrape", {
        payload: ScrapeInput,
        success: Result,
        error: PublicError,
      }).middleware(AuthMiddleware),
    ),
  ).prefix("/skate-api");
