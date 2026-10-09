import { Option, Result, Schema } from "effect";

export type UrlCodec = Schema.Codec<unknown, string, never, never>;
export interface Parameter<N extends string = string, S extends UrlCodec = UrlCodec> {
  readonly kind: "parameter";
  readonly name: N;
  readonly schema: S;
}
export const parameter = <const N extends string, S extends UrlCodec>(
  name: N,
  schema: S,
): Parameter<N, S> => ({ kind: "parameter", name, schema });
export interface Remaining<N extends string = string> {
  readonly kind: "remaining";
  readonly name: N;
}
export const remaining = <const N extends string>(name: N): Remaining<N> => ({
  kind: "remaining",
  name,
});
export type Segment = string | Parameter | Remaining;
export interface Query<S extends UrlCodec = UrlCodec, M extends string = string> {
  readonly schema: S;
  readonly mode: M;
  readonly defaultValue: Option.Option<S["Type"]>;
}
export const requiredQuery = <S extends UrlCodec>(schema: S): Query<S, "required"> => ({
  schema,
  mode: "required",
  defaultValue: Option.none(),
});
export const optionalQuery = <S extends UrlCodec>(schema: S): Query<S, "optional"> => ({
  schema,
  mode: "optional",
  defaultValue: Option.none(),
});
export const arrayQuery = <S extends UrlCodec>(schema: S): Query<S, "array"> => ({
  schema,
  mode: "array",
  defaultValue: Option.none(),
});
export const defaultQuery = <S extends UrlCodec>(
  schema: S,
  value: S["Type"],
): Query<S, "default"> => ({ schema, mode: "default", defaultValue: Option.some(value) });
export interface Route {
  readonly tag: string;
  readonly path: ReadonlyArray<Segment>;
  readonly query: Readonly<Record<string, Query>>;
  readonly children: ReadonlyArray<Route>;
}
interface RouteInput {
  readonly tag: string;
  readonly path: ReadonlyArray<Segment>;
  readonly query?: Readonly<Record<string, Query>>;
  readonly children?: ReadonlyArray<Route>;
}
type DefinedRoute<O extends RouteInput> = {
  readonly tag: O["tag"];
  readonly path: O["path"];
  readonly query: O extends { readonly query: infer Q } ? Q : {};
  readonly children: O extends { readonly children: infer C } ? C : readonly [];
};
export const route = <const O extends RouteInput>(options: O): DefinedRoute<O> =>
  ({
    ...options,
    query: options.query ?? {},
    children: options.children ?? [],
  }) as unknown as DefinedRoute<O>;

type Params<P extends ReadonlyArray<Segment>> = {
  readonly [
    S in P[number] as S extends Parameter<infer N> | Remaining<infer N> ? N : never
  ]: S extends Parameter<string, infer C> ? C["Type"] : ReadonlyArray<string>;
};
type Queries<Q extends Readonly<Record<string, Query>>> = {
  readonly [K in keyof Q]: Q[K]["mode"] extends "optional"
    ? Option.Option<Q[K]["schema"]["Type"]>
    : Q[K]["mode"] extends "array"
      ? ReadonlyArray<Q[K]["schema"]["Type"]>
      : Q[K]["schema"]["Type"];
};
interface TypedDestination<
  Tag extends string,
  P extends Readonly<Record<string, unknown>>,
  Q extends Readonly<Record<string, unknown>>,
> extends UntypedDestination {
  readonly _tag: Tag;
  readonly params: P;
  readonly query: Q;
}

type Destinations<
  R extends Route,
  P extends Readonly<Record<string, unknown>> = {},
  Q extends Readonly<Record<string, unknown>> = {},
> = R extends Route
  ? string extends R["tag"]
    ? UntypedDestination
    :
        | TypedDestination<R["tag"], P & Params<R["path"]>, Q & Queries<R["query"]>>
        | Destinations<R["children"][number], P & Params<R["path"]>, Q & Queries<R["query"]>>
  : never;
export type Destination<T extends ReadonlyArray<Route>> = Destinations<T[number]>;
export type Prefix<T extends ReadonlyArray<Route>> =
  Destination<T> extends infer D
    ? D extends { _tag: infer Tag; params: infer P; query: infer Q }
      ? { readonly _tag: Tag; readonly params: P; readonly query: Q }
      : never
    : never;
export interface UrlIssue {
  readonly route: Option.Option<string>;
  readonly location: "url" | "path" | "query" | "fragment";
  readonly name: Option.Option<string>;
  readonly cause: unknown;
}
export type ParseResult<T extends ReadonlyArray<Route>> =
  | {
      readonly _tag: "Matched";
      readonly original: string;
      readonly destination: Destination<T>;
      readonly ancestry: ReadonlyArray<Prefix<T>>;
    }
  | {
      readonly _tag: "NotFound";
      readonly original: string;
      readonly ancestry: ReadonlyArray<Prefix<T>>;
      readonly remainder: ReadonlyArray<string>;
    }
  | {
      readonly _tag: "InvalidUrl";
      readonly original: string;
      readonly ancestry: ReadonlyArray<Prefix<T>>;
      readonly matched: Option.Option<string>;
      readonly issue: UrlIssue;
    };
export class UrlBuildError extends Schema.TaggedError<UrlBuildError>()("UrlBuildError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}
export interface UntypedDestination {
  readonly _tag: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly fragment: Option.Option<string>;
}
export interface UntypedPrefix {
  readonly _tag: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
}
export interface Router<T extends ReadonlyArray<Route>> {
  readonly definitions: T;
  readonly parse: (url: string) => ParseResult<T>;
  readonly build: (destination: Destination<T>) => Result.Result<string, UrlBuildError>;
}
