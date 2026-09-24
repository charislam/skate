import { Popover } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { ActiveDateMessage } from "./domain/active-date-message";

export const Message = defineMessageUnion({
  ...ActiveDateMessage.MessageSchema,
  MediaWidthChanged: {
    tabletOrAbove: Schema.Boolean,
  },
  GotPopoverMessage: {
    message: Popover.Message,
  },
  SelectedMainMenuAction: {
    action: Schema.Literals(["Day", "Week", "Month"]),
  },
});

export type Message = typeof Message.Type;
