import { Popover } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { UrlRequest } from "foldkit/navigation";
import { Url } from "foldkit/url";
import { Theme } from "./domain";
import { ActiveDateMessage } from "./domain/active-date-message";

export const Message = defineMessageUnion({
  ...ActiveDateMessage.MessageSchema,
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
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
