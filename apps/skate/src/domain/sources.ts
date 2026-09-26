import { Array, Config, Context, Effect, Layer, Match, Option, Redacted, Schema } from "effect";
import { createClient } from "@supabase/supabase-js";
import { AsyncData } from "foldkit";
import { defineTaggedUnion } from "foldkit/schema";

export class SourceError extends Schema.TaggedError<SourceError>()("SourceError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export const SourceId = Schema.String.pipe(Schema.brand("SourceId"));
export const SourceType = Schema.Literals(["web_scrape"]);
export const SourceRow = Schema.Struct({
  id: SourceId,
  name: Schema.NonEmptyString,
  type: SourceType,
  url: Schema.URLFromString,
  notes: Schema.OptionFromNullOr(Schema.String),
  enabled: Schema.Boolean,
  last_fetched: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString,
});
export interface SourceRow extends Schema.Schema.Type<typeof SourceRow> {}

// DateTime.Utc is millisecond-precision; retain the database value for exact page cursors.
const CursorRow = Schema.Struct({
  last_fetched: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
});

const CursorBase = { id: SourceId };
export const SourceCursor = defineTaggedUnion({
  Name: { name: Schema.String },
  Kind: { type: SourceType, name: Schema.String },
  Enabled: { enabled: Schema.Boolean, name: Schema.String },
  LastFetchedNull: CursorBase,
  LastFetched: { timestamp: Schema.String, ...CursorBase },
  CreatedAt: { timestamp: Schema.String, ...CursorBase },
  UpdatedAt: { timestamp: Schema.String, ...CursorBase },
});
export type SourceCursor = typeof SourceCursor.Type;

export const SourcePage = Schema.Struct({
  items: Schema.Array(SourceRow),
  nextCursor: Schema.Option(SourceCursor),
});
export type SourcePage = typeof SourcePage.Type;
export const SourceSortField = Schema.Literals([
  "name",
  "type",
  "enabled",
  "last_fetched",
  "created_at",
  "updated_at",
]);
export type SourceSortField = typeof SourceSortField.Type;
export const SourceFilters = Schema.Struct({
  searchText: Schema.String,
  type: Schema.Option(SourceType),
  enabled: Schema.Option(Schema.Boolean),
  fetchStatus: Schema.Option(Schema.Literals(["never", "fetched"])),
});
export const SourceQuery = Schema.Struct({
  filters: SourceFilters,
  sortField: SourceSortField,
  direction: Schema.Literals(["asc", "desc"]),
});
export type SourceQuery = typeof SourceQuery.Type;

export const ActiveSourceCount = AsyncData.Schema(Schema.Number, SourceError);
export type ActiveSourceCount = typeof ActiveSourceCount.schema.Type;
export interface Interface {
  readonly countActive: () => Effect.Effect<number, SourceError>;
  readonly listPage: (
    query: SourceQuery,
    maybeCursor: Option.Option<SourceCursor>,
  ) => Effect.Effect<SourcePage, SourceError>;
}
export class Service extends Context.Service<Service, Interface>()("skate/Sources") {}

const cursorFor = (query: SourceQuery, row: SourceRow, cursorRow: typeof CursorRow.Type) =>
  Match.value(query.sortField).pipe(
    Match.when("name", () => SourceCursor.Name({ name: row.name })),
    Match.when("type", () => SourceCursor.Kind({ type: row.type, name: row.name })),
    Match.when("enabled", () => SourceCursor.Enabled({ enabled: row.enabled, name: row.name })),
    Match.when("last_fetched", () =>
      cursorRow.last_fetched === null
        ? SourceCursor.LastFetchedNull({ id: row.id })
        : SourceCursor.LastFetched({ timestamp: cursorRow.last_fetched, id: row.id }),
    ),
    Match.when("created_at", () =>
      SourceCursor.CreatedAt({ timestamp: cursorRow.created_at, id: row.id }),
    ),
    Match.when("updated_at", () =>
      SourceCursor.UpdatedAt({ timestamp: cursorRow.updated_at, id: row.id }),
    ),
    Match.exhaustive,
  );

const makeInterface = (url: string, publishableKey: string): Interface => {
  const client = createClient(url, publishableKey);
  const countActive = Effect.fn("Sources.countActive")(function* () {
    const { count, error } = yield* Effect.tryPromise({
      try: (signal) =>
        client
          .from("source")
          .select("id", { count: "exact", head: true })
          .eq("enabled", true)
          .abortSignal(signal),
      catch: (cause) => new SourceError({ message: "Could not load active sources.", cause }),
    });
    if (error || count === null) {
      return yield* Effect.fail(
        new SourceError({
          message: "Could not load active sources.",
          cause: error ?? new Error("Supabase returned no count."),
        }),
      );
    }
    return count;
  });
  const listPage = Effect.fn("Sources.listPage")(function* (
    query: SourceQuery,
    maybeCursor: Option.Option<SourceCursor>,
  ) {
    const cursor = Option.match(maybeCursor, { onNone: () => null, onSome: (value) => value });
    const { data, error } = yield* Effect.tryPromise({
      try: (signal) =>
        client
          .rpc("list_source_page", {
            p_search_text: query.filters.searchText.trim(),
            p_type: Option.getOrNull(query.filters.type),
            p_enabled: Option.getOrNull(query.filters.enabled),
            p_fetch_status: Option.getOrNull(query.filters.fetchStatus),
            p_sort_field: query.sortField,
            p_direction: query.direction,
            p_cursor: cursor,
          })
          .abortSignal(signal),
      catch: (cause) => new SourceError({ message: "Could not load sources.", cause }),
    });
    if (error)
      return yield* Effect.fail(
        new SourceError({ message: "Could not load sources.", cause: error }),
      );
    const rows = yield* Schema.decodeUnknownEffect(Schema.Array(SourceRow))(data).pipe(
      Effect.mapError(
        (cause) => new SourceError({ message: "The source response was invalid.", cause }),
      ),
    );
    const hasMore = Array.length(rows) > 50;
    const items = Array.take(rows, 50);
    const boundary = Option.product(Array.get(items, 49), Array.get(data, 49));
    const nextCursor = hasMore
      ? yield* Option.match(boundary, {
          onNone: () =>
            Effect.fail(
              new SourceError({
                message: "The source response was invalid.",
                cause: new Error("Missing page boundary."),
              }),
            ),
          onSome: ([lastItem, rawBoundary]) =>
            Schema.decodeUnknownEffect(CursorRow)(rawBoundary).pipe(
              Effect.map((cursorRow) => Option.some(cursorFor(query, lastItem, cursorRow))),
              Effect.mapError(
                (cause) => new SourceError({ message: "The source response was invalid.", cause }),
              ),
            ),
        })
      : Option.none<SourceCursor>();
    return {
      items,
      nextCursor,
    };
  });
  return { countActive, listPage };
};

export const layerConfig = Layer.effect(
  Service,
  Effect.gen(function* () {
    const url = yield* Config.String("VITE_SUPABASE_URL");
    const publishableKey = yield* Config.Redacted("VITE_SUPABASE_PUBLISHABLE_KEY");
    return Service.of(makeInterface(url, Redacted.value(publishableKey)));
  }).pipe(Effect.orDie),
);

export * as Sources from "./sources";
