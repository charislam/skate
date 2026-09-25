import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { PermissionError } from "../../domain/admin-access";
import { SourceError } from "../../domain/sources";
import { UserId } from "../../domain/session";

export const Message = defineMessageUnion({
  ClickedRetryAccess: {},
  InvalidatedAccess: {},
  ClickedLogout: {},
  ToggledNavigation: { isOpen: Schema.Boolean },
  SettledFetchAccess: {
    userId: UserId,
    adminRequestId: Schema.Number,
    result: Schema.Result(Schema.Boolean, PermissionError),
  },
  SettledFetchActiveSources: {
    sourceRequestId: Schema.Number,
    result: Schema.Result(Schema.Number, SourceError),
  },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  RequestedLogout: {},
  DeniedAccess: {},
});
export type OutMessage = typeof OutMessage.Type;
