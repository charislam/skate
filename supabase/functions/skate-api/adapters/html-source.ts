import { ConfigService } from "../config.ts";
import { describeCause } from "../domain/error-details.ts";
import {
  SourceContentTooLarge,
  SourceFailure,
  UnsafeSourceUrl,
} from "../domain/source.ts";
import { HtmlSource, normalizeHtml } from "../services/html-source.ts";
import { Clock, Effect, Layer } from "effect";

const maxHtmlBytes = 2 * 1024 * 1024;
const maxStateBytes = 24 * 1024;

const allowedUrl = (
  value: string,
  hosts: ReadonlyArray<string>,
): URL | undefined => {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" || url.password !== ""
    ) return undefined;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || /^\d+(\.\d+){3}$/.test(host) ||
      host.includes(":")
    ) return undefined;
    if (!hosts.includes(host)) return undefined;
    return url;
  } catch {
    return undefined;
  }
};

export const htmlSourceLayer = Layer.effect(
  HtmlSource.Service,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const fetch = Effect.fn("HtmlSource.fetch")(function* (rawUrl: string) {
      const initialUrl = allowedUrl(rawUrl, config.sourceHosts);
      if (initialUrl === undefined) {
        return yield* Effect.fail(
          new UnsafeSourceUrl({
            cause:
              "URL must use HTTP(S), contain no credentials or IP literal, and match an exact trusted host",
          }),
        );
      }
      const fetchedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetchWithSafeRedirects(
            initialUrl,
            config.sourceHosts,
            AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          ),
        catch: (cause) =>
          new SourceFailure({
            operation:
              cause instanceof DOMException && cause.name === "TimeoutError"
                ? "fetch_timeout"
                : "fetch",
            cause: describeCause(cause),
          }),
      });
      if (!response.ok) {
        yield* Effect.tryPromise({
          try: () => response.body?.cancel() ?? Promise.resolve(),
          catch: (cause) =>
            new SourceFailure({
              operation: "cancel",
              cause: describeCause(cause),
            }),
        });
        return yield* Effect.fail(
          new SourceFailure({
            operation: "fetch",
            cause:
              `Source returned HTTP ${response.status} ${response.statusText}`,
          }),
        );
      }
      if (
        !/^text\/html(?:\s*;|$)/i.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        yield* Effect.tryPromise({
          try: () => response.body?.cancel() ?? Promise.resolve(),
          catch: (cause) =>
            new SourceFailure({
              operation: "cancel",
              cause: describeCause(cause),
            }),
        });
        return yield* Effect.fail(
          new SourceFailure({
            operation: "media_type",
            cause: `Expected text/html, received ${
              response.headers.get("content-type") ?? "no Content-Type"
            }`,
          }),
        );
      }
      const reader = response.body?.getReader();
      if (reader === undefined) {
        return yield* Effect.fail(
          new SourceFailure({
            operation: "empty_body",
            cause: "The successful HTML response had no readable body",
          }),
        );
      }
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({
          try: () => reader.cancel(),
          catch: () => undefined,
        }).pipe(Effect.catch(() => Effect.void))
      );
      const chunks: Array<Uint8Array> = [];
      let byteLength = 0;
      while (true) {
        const part = yield* Effect.tryPromise({
          try: () => reader.read(),
          catch: (cause) =>
            new SourceFailure({
              operation: "read",
              cause: describeCause(cause),
            }),
        });
        if (part.done) break;
        byteLength += part.value.byteLength;
        if (byteLength > maxHtmlBytes) {
          yield* Effect.tryPromise({
            try: () => reader.cancel(),
            catch: (cause) =>
              new SourceFailure({
                operation: "cancel",
                cause: describeCause(cause),
              }),
          });
          return yield* Effect.fail(
            new SourceContentTooLarge({
              cause:
                `HTML response exceeded the ${maxHtmlBytes}-byte limit at ${byteLength} bytes`,
            }),
          );
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      });
      const html = new TextDecoder().decode(bytes);
      const blocks = normalizeHtml(html);
      const context = JSON.stringify(blocks);
      if (new TextEncoder().encode(context).byteLength > maxStateBytes) {
        return yield* Effect.fail(
          new SourceContentTooLarge({
            cause:
              `Normalized source context exceeded the ${maxStateBytes}-byte limit`,
          }),
        );
      }
      return { fetchedAt, blocks, context };
    });
    return HtmlSource.Service.of({ fetch });
  }),
);

const fetchWithSafeRedirects = async (
  url: URL,
  hosts: ReadonlyArray<string>,
  signal: AbortSignal,
): Promise<Response> => {
  let next = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(next, {
      redirect: "manual",
      signal,
      headers: { accept: "text/html" },
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (location === null || redirects === 3) {
      throw new Error("Invalid redirect");
    }
    const validated = allowedUrl(new URL(location, next).toString(), hosts);
    if (validated === undefined) throw new Error("Unsafe redirect");
    next = validated;
  }
  throw new Error("Too many redirects");
};
