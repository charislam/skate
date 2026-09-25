import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { PermissionError } from "../../domain/admin-access";
import { UserId } from "../../domain/session";

export const Message = defineMessageUnion({
  ClickedRetryAccess: {},
  InvalidatedAccess: {},
  ClickedLogout: {},
  SettledFetchAccess: {
    userId: UserId,
    requestId: Schema.Number,
    result: Schema.Result(Schema.Boolean, PermissionError),
  },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  RequestedLogout: {},
  DeniedAccess: {},
});
export type OutMessage = typeof OutMessage.Type;
