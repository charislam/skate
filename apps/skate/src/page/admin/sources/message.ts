import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { Sources } from "../../../domain/sources";
import { UserId } from "../../../domain/session";
import { ScopeId } from "./model";

import * as Form from "./form/message";

export const Message = defineMessageUnion({
  ClickedCreateSource: {},
  GotFormMessage: { message: Form.Message },
  UpdatedSearch: { value: Schema.String },
  UpdatedType: { maybeValue: Schema.Option(Sources.SourceType) },
  UpdatedEnabled: { maybeValue: Schema.Option(Schema.Boolean) },
  UpdatedFetchStatus: { maybeValue: Schema.Option(Schema.Literals(["never", "fetched"])) },
  ClickedApply: {},
  PressedEnter: {},
  ClickedClear: {},
  ClickedRefresh: {},
  ClickedRetry: {},
  ClickedLoadMore: {},
  ClickedRetryMore: {},
  ObservedLoadMore: {},
  ClickedSort: { field: Sources.SourceSortField },
  CreatedScope: { scopeId: ScopeId, userId: UserId },
  SettledPage: {
    requestId: Schema.Number,
    scopeId: ScopeId,
    userId: UserId,
    kind: Schema.Literals(["Initial", "Refresh", "More"]),
    maybeCursor: Schema.Option(Sources.SourceCursor),
    result: Schema.Result(Sources.SourcePage, Sources.SourceError),
  },
  CompletedScrollSourcesTable: {},
});
export type Message = typeof Message.Type;
