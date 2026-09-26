import { Option, Schema } from "effect";
import { AsyncData, FieldValidation } from "foldkit";
import { defineTaggedUnion } from "foldkit/schema";
import { Sources } from "../../../domain/sources";
import { UserId } from "../../../domain/session";

export const ScopeId = Schema.String.pipe(Schema.brand("SourcesScopeId"));

export const More = defineTaggedUnion({
  Ready: { cursor: Sources.SourceCursor },
  Loading: { cursor: Sources.SourceCursor },
  Failed: { cursor: Sources.SourceCursor, error: Sources.SourceError },
  End: {},
});
export const FeedData = Schema.Struct({ items: Schema.Array(Sources.SourceRow), more: More });
export type FeedData = typeof FeedData.Type;
export const Feed = AsyncData.Schema(FeedData, Sources.SourceError);
export const DraftFilters = Schema.Struct({
  searchText: FieldValidation.Field(Schema.String),
  type: Schema.Option(Sources.SourceType),
  enabled: Schema.Option(Schema.Boolean),
  fetchStatus: Schema.Option(Schema.Literals(["never", "fetched"])),
});
export const PendingRequest = defineTaggedUnion({
  Initial: { requestId: Schema.Number, scopeId: ScopeId, userId: UserId },
  Refresh: { requestId: Schema.Number, scopeId: ScopeId, userId: UserId },
  More: {
    requestId: Schema.Number,
    scopeId: ScopeId,
    userId: UserId,
    cursor: Sources.SourceCursor,
  },
});
export const Model = Schema.Struct({
  scopeId: Schema.Option(ScopeId),
  draftFilters: DraftFilters,
  query: Sources.SourceQuery,
  nextRequestId: Schema.Number,
  pendingRequest: Schema.Option(PendingRequest),
  feed: Feed.schema,
});
export type Model = typeof Model.Type;

export const emptyFilters = (): typeof DraftFilters.Type => ({
  searchText: FieldValidation.NotValidated({ value: "" }),
  type: Option.none(),
  enabled: Option.none(),
  fetchStatus: Option.none(),
});
export const defaultQuery = (): Sources.SourceQuery => ({
  filters: { ...emptyFilters(), searchText: "" },
  sortField: "name",
  direction: "asc",
});
export const init = (): Model => ({
  draftFilters: emptyFilters(),
  query: defaultQuery(),
  scopeId: Option.none(),
  nextRequestId: 1,
  pendingRequest: Option.none(),
  feed: Feed.Idle(),
});
