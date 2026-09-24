import { Popover } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { Theme } from "./domain";
import { ActiveDateMessage } from "./domain/active-date-message";

export const Message = defineMessageUnion({
  ...ActiveDateMessage.MessageSchema,
  MediaWidthChanged: {
    tabletOrAbove: Schema.Boolean,
  },
  SelectedTheme: {
    theme: Schema.Option(Theme.Theme_),
  },
  SelectedMainMenuAction: {
    action: Schema.Literals(["Day", "Week", "Month"]),
  },
  GotThemeMessage: {
    message: Theme.Message,
  },
  GotPopoverMessage: {
    message: Popover.Message,
  },
});

export type Message = typeof Message.Type;
