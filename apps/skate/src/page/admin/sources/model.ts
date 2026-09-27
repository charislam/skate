import { Listbox } from "@foldkit/ui";
import { Option, Schema } from "effect";
import { AsyncData, FieldValidation } from "foldkit";
import { defineTaggedUnion } from "foldkit/schema";
import { Sources } from "~/domain/sources";
import { UserId } from "~/domain/session";
import * as Form from "./form/model";
import {
  EnabledFilterListboxId,
  FetchStatusFilterListboxId,
  TypeFilterListboxId,
} from "./listboxes";

export const ScopeId = Schema.String.pipe(Schema.brand("SourcesScopeId"));

export const More = defineTaggedUnion({
  Ready: { cursor: Sources.SourceCursor },
  Loading: { cursor: Sources.SourceCursor },
  Failed: { cursor: Sources.SourceCursor, error: Sources.SourceError },
  End: {},
});
export type More = typeof More.Type;
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

  feed: Feed.schema,
  query: Sources.SourceQuery,
  nextRequestId: Schema.Number,
  pendingRequest: Schema.Option(PendingRequest),

  draftFilters: DraftFilters,
  isMobileFiltersOpen: Schema.Boolean,
  enabledListbox: Listbox.Model,
  typeListbox: Listbox.Model,
  fetchStatusListbox: Listbox.Model,

  form: Form.Model,
  optimisticSources: Schema.Array(
    Schema.Struct({ requestId: Schema.Number, input: Sources.CreateSource }),
  ),
  creationErrors: Schema.Array(
    Schema.Struct({ requestId: Schema.Number, name: Schema.String, error: Sources.SourceError }),
  ),
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
  scopeId: Option.none(),

  feed: Feed.Idle(),
  query: defaultQuery(),
  nextRequestId: 1,
  pendingRequest: Option.none(),

  draftFilters: emptyFilters(),
  isMobileFiltersOpen: false,
  enabledListbox: Listbox.init({ id: EnabledFilterListboxId }),
  typeListbox: Listbox.init({ id: TypeFilterListboxId }),
  fetchStatusListbox: Listbox.init({ id: FetchStatusFilterListboxId }),

  form: Form.init(),
  optimisticSources: [],
  creationErrors: [],
});

type PerKeyCheck<T> = {
  [K in keyof T]: (filters: T) => boolean;
};

const filterToActiveCheck: PerKeyCheck<Model["query"]["filters"]> = {
  searchText: (filters) => filters.searchText.trim() !== "",
  type: (filters) => Option.isSome(filters.type),
  enabled: (filters) => Option.isSome(filters.enabled),
  fetchStatus: (filters) => Option.isSome(filters.fetchStatus),
};

export const hasActiveFilters = (filters: Model["query"]["filters"]): boolean =>
  Object.values(filterToActiveCheck).some((check) => check(filters));
