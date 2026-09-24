import { defineMessageUnion } from "foldkit/message";
import { Schema } from "effect";
import { ActiveDateMessage } from "./domain/active-date-message";

export const Message = defineMessageUnion({
  ...ActiveDateMessage.MessageSchema,
  MediaWidthChanged: {
    tabletOrAbove: Schema.Boolean,
  },
});

export type Message = typeof Message.Type;
