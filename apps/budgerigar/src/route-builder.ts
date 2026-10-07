import { Match, Option, Result, Schema } from "effect";
import {
  type UntypedDestination,
  type UrlCodec,
  type Route,
  UrlBuildError,
} from "./route-definition";

const codecEncode = (options: {
  schema: UrlCodec;
  value: unknown;
}): Result.Result<string, UrlBuildError> => {
  const issue = (cause: unknown) =>
    new UrlBuildError({
      message: "URL parameter encoding failed (URL codecs must be synchronous and service-free)",
      cause,
    });
  return Result.try({
    try: () =>
      Schema.encodeUnknownResult(options.schema)(options.value).pipe(Result.mapError(issue)),
    catch: issue,
  }).pipe(Result.flatMap((result) => result));
};

export const buildUrl = (options: {
  index: ReadonlyMap<string, ReadonlyArray<Route>>;
  destination: UntypedDestination;
}): Result.Result<string, UrlBuildError> =>
  Result.gen(function* () {
    const { index, destination } = options;
    const levels = yield* Option.match(Option.fromUndefinedOr(index.get(destination._tag)), {
      onNone: () =>
        Result.fail(new UrlBuildError({ message: "Unknown destination", cause: destination._tag })),
      onSome: Result.succeed,
    });
    const segments: string[] = [];
    const query = new URLSearchParams();
    for (const level of levels) {
      for (const segment of level.path)
        yield* Match.value(segment).pipe(
          Match.when(
            (s): s is string => typeof s === "string",
            (value) => Result.succeed(segments.push(encodeURIComponent(value))),
          ),
          Match.when({ kind: "parameter" }, (parameter) =>
            codecEncode({
              schema: parameter.schema,
              value: destination.params[parameter.name],
            }).pipe(Result.map((value) => segments.push(encodeURIComponent(value)))),
          ),
          Match.when({ kind: "remaining" }, (remaining) =>
            Result.try({
              try: () => {
                const value = destination.params[remaining.name];
                Match.value(
                  Array.isArray(value) && value.every((value) => typeof value === "string"),
                ).pipe(
                  Match.when(false, () => {
                    throw new TypeError("Catch-all requires string segments");
                  }),
                  Match.orElse(() => {}),
                );
                for (const part of value as ReadonlyArray<string>)
                  segments.push(encodeURIComponent(part));
              },
              catch: (cause) => new UrlBuildError({ message: "Invalid catch-all", cause }),
            }),
          ),
          Match.exhaustive,
        );
      for (const [name, descriptor] of Object.entries(level.query)) {
        const value = destination.query[name];
        const values = Match.value(descriptor.mode).pipe(
          Match.when("optional", () => Option.toArray(value as Option.Option<unknown>)),
          Match.when("array", () => value as ReadonlyArray<unknown>),
          Match.orElse(() => [value]),
        );
        for (const item of values) {
          const encoded = yield* codecEncode({ schema: descriptor.schema, value: item });
          const omit = yield* Match.value(descriptor.mode === "default").pipe(
            Match.when(true, () =>
              Option.match(descriptor.defaultValue, {
                onNone: () => Result.succeed(false),
                onSome: (value) =>
                  codecEncode({ schema: descriptor.schema, value }).pipe(
                    Result.map((defaultEncoded) => defaultEncoded === encoded),
                  ),
              }),
            ),
            Match.orElse(() => Result.succeed(false)),
          );
          Match.value(omit).pipe(
            Match.when(false, () => query.append(name, encoded)),
            Match.orElse(() => {}),
          );
        }
      }
    }
    yield* Match.value(segments.at(-1) === "").pipe(
      Match.when(true, () =>
        Result.fail(
          new UrlBuildError({
            message: "A terminal path segment cannot be empty",
            cause: destination,
          }),
        ),
      ),
      Match.orElse(() => Result.succeed(undefined)),
    );
    const path = `/${segments.join("/")}`;
    const search = Match.value(query.size > 0).pipe(
      Match.when(true, () => `?${query.toString()}`),
      Match.orElse(() => ""),
    );
    const hash = Option.match(destination.fragment, {
      onNone: () => "",
      onSome: (value) => `#${encodeURIComponent(value)}`,
    });
    return path + search + hash;
  });
