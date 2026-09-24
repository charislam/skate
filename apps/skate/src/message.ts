import { Menu } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { ActiveDateMessage } from "./domain/active-date-message";

export const Message = defineMessageUnion({
  ...ActiveDateMessage.MessageSchema,
  MediaWidthChanged: {
    tabletOrAbove: Schema.Boolean,
  },
  GotMenuMessage: {
    message: Menu.Message,
  },
});

export type Message = typeof Message.Type;
