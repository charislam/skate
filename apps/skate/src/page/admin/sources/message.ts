import { Schema } from "effect";
import { Listbox } from "@foldkit/ui";
import { defineMessageUnion } from "foldkit/message";
import { Sources } from "../../../domain/sources";
import { UserId } from "../../../domain/session";
import { ScopeId } from "./model";

import * as Form from "./form/message";

export const Message = defineMessageUnion({
  CreatedScope: { scopeId: ScopeId, userId: UserId },

  ToggledMobileFilters: { isOpen: Schema.Boolean },

  ClickedCreateSource: {},
  ClickedApply: {},
  PressedEnter: {},
  ClickedClear: {},
  ClickedRefresh: {},
  ClickedRetry: {},
  ClickedLoadMore: {},
  ClickedRetryMore: {},
  ClickedSort: { field: Sources.SourceSortField },
  ClickedDismissErrors: {},

  ObservedLoadMore: {},

  UpdatedSearch: { value: Schema.String },

  SettledPage: {
    requestId: Schema.Number,
    scopeId: ScopeId,
    userId: UserId,
    kind: Schema.Literals(["Initial", "Refresh", "More"]),
    maybeCursor: Schema.Option(Sources.SourceCursor),
    result: Schema.Result(Sources.SourcePage, Sources.SourceError),
  },

  CompletedScrollSourcesTable: {},

  GotFormMessage: { message: Form.Message },
  GotEnabledListboxMessage: { message: Listbox.Message },
  GotTypeListboxMessage: { message: Listbox.Message },
  GotFetchStatusListboxMessage: { message: Listbox.Message },
});

export type Message = typeof Message.Type;
