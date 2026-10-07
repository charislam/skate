import { Match, Option, Result, Schema } from "effect";
import type { ParseResult, Route, UntypedPrefix, UrlCodec, UrlIssue } from "./route-definition";

interface OwnedPath {
  readonly levels: ReadonlyArray<{
    readonly route: Route;
    readonly values: Readonly<Record<string, string | ReadonlyArray<string>>>;
  }>;
  readonly remainder: ReadonlyArray<string>;
}

/** Match structure first, without decoding. A chosen sibling owns even an invalid parameter. */
const ownPath = (options: {
  routes: ReadonlyArray<Route>;
  segments: ReadonlyArray<string>;
}): OwnedPath => {
  return Option.getOrElse(
    options.routes.reduce<Option.Option<OwnedPath>>(
      (selected, definition) =>
        Option.orElse(selected, () => {
          let offset = 0;
          let matches =
            definition.path.length > 0 ||
            definition.children.length > 0 ||
            options.segments.length === 0;

          const values: Record<string, string | ReadonlyArray<string>> = {};

          for (const segment of definition.path) {
            Match.value(segment).pipe(
              Match.when(
                (s): s is string => typeof s === "string",
                (literal) => {
                  matches =
                    matches &&
                    Result.match(
                      decode({
                        raw: options.segments[offset] ?? "",
                        route: Option.none(),
                        location: "path",
                        name: Option.none(),
                      }),
                      { onFailure: () => false, onSuccess: (value) => value === literal },
                    );
                  offset += 1;
                },
              ),
              Match.when({ kind: "parameter" }, (parameter) => {
                const value = Option.fromUndefinedOr(options.segments[offset]);
                matches = matches && Option.isSome(value);
                Option.match(value, {
                  onNone: () => {},
                  onSome: (value) => {
                    values[parameter.name] = value;
                  },
                });
                offset += 1;
              }),
              Match.when({ kind: "remaining" }, (remaining) => {
                values[remaining.name] = options.segments.slice(offset);
                offset = options.segments.length;
              }),
              Match.exhaustive,
            );
          }
          const owned = Match.value(matches).pipe(
            Match.when(false, () => Option.none<OwnedPath>()),
            Match.when(true, () => {
              const child = ownPath({
                routes: definition.children,
                segments: options.segments.slice(offset),
              });
              return Option.some({
                levels: [{ route: definition, values }, ...child.levels],
                remainder: child.remainder,
              });
            }),
            Match.exhaustive,
          );
          return owned;
        }),
      Option.none(),
    ),
    () => ({ levels: [], remainder: options.segments }),
  );
};

const decode = (options: {
  raw: string;
  route: Option.Option<string>;
  location: UrlIssue["location"];
  name: Option.Option<string>;
}): Result.Result<string, UrlIssue> =>
  Result.try({
    try: () => decodeURIComponent(options.raw),
    catch: (cause) => ({
      route: options.route,
      location: options.location,
      name: options.name,
      cause,
    }),
  });

const codecDecode = (options: {
  schema: UrlCodec;
  raw: string;
  route: string;
  location: "path" | "query";
  name: string;
}): Result.Result<unknown, UrlIssue> => {
  const issue = (cause: unknown): UrlIssue => ({
    route: Option.some(options.route),
    location: options.location,
    name: Option.some(options.name),
    cause,
  });
  return Result.try({
    try: () => Schema.decodeUnknownResult(options.schema)(options.raw).pipe(Result.mapError(issue)),
    catch: issue,
  }).pipe(Result.flatMap((result) => result));
};

export const parseUrl = <T extends ReadonlyArray<Route>>(options: {
  definitions: T;
  original: string;
}): ParseResult<T> => {
  const { definitions, original } = options;

  const ancestry: UntypedPrefix[] = [];
  let matched = Option.none<string>();

  const parsed = Result.gen(function* () {
    const url = yield* Result.try({
      try: () => new URL(original, "http://budgerigar.local"),
      catch: (cause): UrlIssue => ({
        route: Option.none(),
        location: "url",
        name: Option.none(),
        cause,
      }),
    });

    const path = url.pathname.replace(/\/$/, "");
    const raw = Match.value(path === "").pipe(
      Match.when(true, () => []),
      Match.orElse(() => path.slice(1).split("/")),
    );

    const owned = ownPath({ routes: definitions, segments: raw });

    matched = Option.fromUndefinedOr(owned.levels.at(-1)?.route.tag);
    const query = new Map<string, string[]>();
    const params: Record<string, unknown> = {};
    const queryValues: Record<string, unknown> = {};

    // Decode raw pairs explicitly: URLSearchParams tolerates malformed percent
    // encoding.
    for (const pair of url.search
      .slice(1)
      .split("&")
      .filter((pair) => pair !== "")) {
      const equals = pair.indexOf("=");
      const [nameRaw, valueRaw] = Match.value(equals < 0).pipe(
        Match.when(true, () => [pair, ""] as const),
        Match.orElse(() => [pair.slice(0, equals), pair.slice(equals + 1)] as const),
      );
      const name = yield* decode({
        raw: nameRaw.replace(/\+/g, " "),
        route: Option.none(),
        location: "query",
        name: Option.none(),
      });
      query.set(name, [...(query.get(name) ?? []), valueRaw.replace(/\+/g, " ")]);
    }

    for (const { route: level, values } of owned.levels) {
      for (const segment of level.path)
        yield* Match.value(segment).pipe(
          Match.when(
            (s): s is string => typeof s === "string",
            (literal) =>
              decode({
                raw: encodeURIComponent(literal),
                route: Option.some(level.tag),
                location: "path",
                name: Option.none(),
              }).pipe(Result.map(() => undefined)),
          ),
          Match.when({ kind: "parameter" }, (parameter) =>
            Result.gen(function* () {
              const raw = values[parameter.name] as string;
              const value = yield* decode({
                raw,
                route: Option.some(level.tag),
                location: "path",
                name: Option.some(parameter.name),
              });
              params[parameter.name] = yield* codecDecode({
                schema: parameter.schema,
                raw: value,
                route: level.tag,
                location: "path",
                name: parameter.name,
              });
            }),
          ),
          Match.when({ kind: "remaining" }, (remaining) =>
            Result.gen(function* () {
              const decoded: string[] = [];
              for (const raw of values[remaining.name] as ReadonlyArray<string>)
                decoded.push(
                  yield* decode({
                    raw,
                    route: Option.some(level.tag),
                    location: "path",
                    name: Option.some(remaining.name),
                  }),
                );
              params[remaining.name] = decoded;
            }),
          ),
          Match.exhaustive,
        );

      for (const [name, descriptor] of Object.entries(level.query)) {
        const raw = query.get(name) ?? [];
        yield* Match.value(descriptor.mode !== "array" && raw.length > 1).pipe(
          Match.when(true, () =>
            Result.fail<UrlIssue>({
              route: Option.some(level.tag),
              location: "query",
              name: Option.some(name),
              cause: "Repeated scalar query",
            }),
          ),
          Match.orElse(() => Result.succeed(undefined)),
        );
        const decoded: unknown[] = [];
        for (const rawValue of raw) {
          const value = yield* decode({
            raw: rawValue,
            route: Option.some(level.tag),
            location: "query",
            name: Option.some(name),
          });
          decoded.push(
            yield* codecDecode({
              schema: descriptor.schema,
              raw: value,
              route: level.tag,
              location: "query",
              name,
            }),
          );
        }
        queryValues[name] = yield* Match.value(descriptor.mode).pipe(
          Match.when("array", () => Result.succeed(decoded)),
          Match.when("optional", () => Result.succeed(Option.fromUndefinedOr(decoded[0]))),
          Match.orElse(() =>
            Option.match(
              Option.orElse(Option.fromUndefinedOr(decoded[0]), () => descriptor.defaultValue),
              {
                onNone: () =>
                  Result.fail<UrlIssue>({
                    route: Option.some(level.tag),
                    location: "query",
                    name: Option.some(name),
                    cause: "Missing required query",
                  }),
                onSome: Result.succeed,
              },
            ),
          ),
        );
      }
      ancestry.push({ _tag: level.tag, params: { ...params }, query: { ...queryValues } });
    }

    const remainder: string[] = [];
    for (const raw of owned.remainder)
      remainder.push(yield* decode({ raw, route: matched, location: "path", name: Option.none() }));

    const fragment = yield* Option.match(
      Option.filter(Option.some(url.href.slice(url.href.indexOf("#") + 1)), () =>
        url.href.includes("#"),
      ),
      {
        onNone: () => Result.succeed(Option.none<string>()),
        onSome: (raw) =>
          decode({ raw, route: matched, location: "fragment", name: Option.none() }).pipe(
            Result.map(Option.some),
          ),
      },
    );

    return { remainder, params, query: queryValues, fragment };
  });

  // The definition tree validates the private erased data; public outcomes retain its inferred union.
  return Result.match(parsed, {
    onFailure: (issue) => ({ _tag: "InvalidUrl", original, ancestry, matched, issue }),
    onSuccess: ({ remainder, ...values }) =>
      Match.value(remainder.length === 0 && Option.isSome(matched)).pipe(
        Match.when(true, () => ({
          _tag: "Matched",
          original,
          ancestry,
          destination: { _tag: Option.getOrElse(matched, () => ""), ...values },
        })),
        Match.orElse(() => ({ _tag: "NotFound", original, ancestry, remainder })),
      ),
  }) as unknown as ParseResult<T>;
};
