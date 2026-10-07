import { Match, Option, Result, Schema } from "effect";
import { type Route, type Router, UrlBuildError } from "./route-definition";
import { buildUrl } from "./route-builder";
import { parseUrl } from "./route-parser";

export {
  defaultQuery,
  arrayQuery,
  optionalQuery,
  parameter,
  remaining,
  requiredQuery,
  route,
  UrlBuildError,
  type Destination,
  type Parameter,
  type ParseResult,
  type Prefix,
  type Query,
  type Remaining,
  type Route,
  type Router,
  type Segment,
  type UrlCodec,
  type UrlIssue,
} from "./route-definition";

export const router = <const T extends ReadonlyArray<Route>>(definitions: T): Router<T> => {
  const index = new Map<string, ReadonlyArray<Route>>();

  const visit = (routes: ReadonlyArray<Route>, ancestors: ReadonlyArray<Route>) => {
    for (const definition of routes) {
      const levels = [...ancestors, definition];

      const params = new Set<string>();
      const queries = new Set<string>();

      for (const level of levels) {
        for (const [position, segment] of level.path.entries())
          Match.value(segment).pipe(
            Match.when(
              (s): s is string => typeof s === "string",
              () => {},
            ),
            Match.orElse((segment) => {
              Match.value(params.has(segment.name)).pipe(
                Match.when(true, () => {
                  throw new TypeError(`Conflicting inherited parameter: ${segment.name}`);
                }),
                Match.orElse(() => {}),
              );
              params.add(segment.name);
              Match.value(
                segment.kind === "remaining" &&
                  (position !== level.path.length - 1 || level.children.length > 0),
              ).pipe(
                Match.when(true, () => {
                  throw new TypeError("Catch-all segments must be terminal");
                }),
                Match.orElse(() => {}),
              );
            }),
          );

        for (const name of Object.keys(level.query)) {
          Match.value(queries.has(name)).pipe(
            Match.when(true, () => {
              throw new TypeError(`Conflicting inherited query: ${name}`);
            }),
            Match.orElse(() => {}),
          );
          const descriptor = level.query[name];
          Option.match(Option.fromUndefinedOr(descriptor), {
            onNone: () => {},
            onSome: (descriptor) =>
              Option.match(descriptor.defaultValue, {
                onNone: () => {},
                onSome: (value) => {
                  const valid = Result.try({
                    try: () =>
                      Schema.encodeUnknownResult(descriptor.schema)(value).pipe(
                        Result.flatMap((encoded) =>
                          Schema.decodeUnknownResult(descriptor.schema)(encoded),
                        ),
                      ),
                    catch: (cause) => cause,
                  }).pipe(Result.flatMap((result) => result));
                  Match.value(Result.isFailure(valid)).pipe(
                    Match.when(true, () => {
                      throw new TypeError(`Invalid or asynchronous query default: ${name}`);
                    }),
                    Match.orElse(() => {}),
                  );
                },
              }),
          });
          queries.add(name);
        }
      }

      Match.value(index.has(definition.tag)).pipe(
        Match.when(true, () => {
          throw new TypeError(`Duplicate route tag: ${definition.tag}`);
        }),
        Match.orElse(() => {}),
      );
      index.set(definition.tag, levels);

      visit(definition.children, levels);
    }
  };

  visit(definitions, []);

  return {
    definitions,
    parse: (original) => parseUrl({ definitions, original }),
    build: (destination) =>
      Result.try({
        try: () =>
          Result.gen(function* () {
            const href = yield* buildUrl({
              index,
              destination,
            });
            const parsed = parseUrl({ definitions, original: href });
            yield* Match.value(parsed).pipe(
              Match.tag("Matched", ({ destination: normalized }) =>
                Match.value(normalized._tag === destination._tag).pipe(
                  Match.when(true, () => Result.succeed(undefined)),
                  Match.orElse(() =>
                    Result.fail(
                      new UrlBuildError({
                        message: "Destination is shadowed by an earlier route",
                        cause: parsed,
                      }),
                    ),
                  ),
                ),
              ),
              Match.orElse(() =>
                Result.fail(
                  new UrlBuildError({
                    message: "Encoded destination does not match its route",
                    cause: parsed,
                  }),
                ),
              ),
            );
            return href;
          }),
        catch: (cause) =>
          new UrlBuildError({ message: "Malformed destination or encoding defect", cause }),
      }).pipe(Result.flatMap((result) => result)),
  };
};
