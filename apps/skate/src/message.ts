import { Popover } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { UrlRequest } from "foldkit/navigation";
import { Url } from "foldkit/url";
import { Theme } from "./domain";
import { ActiveDateMessage } from "./domain/active-date-message";
import { Session } from "./domain/session";
import { Auth } from "./domain/auth";
import { Toast } from "./toast";
import * as Login from "./page/login/message";
import * as Admin from "./page/admin/message";

export const Message = defineMessageUnion({
  ...ActiveDateMessage.MessageSchema,
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
  CompletedRedirect: {},
  ClickedLogout: {},
  SucceededSignOut: {},
  FailedSignOut: { kind: Auth.ErrorKind },
  AuthStateChanged: { maybeSession: Schema.Option(Session) },
  GotLoginMessage: { message: Login.Message },
  GotAdminMessage: { message: Admin.Message },
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
  SelectedNavigationLink: {},
  GotThemeMessage: {
    message: Theme.Message,
  },
  GotPopoverMessage: {
    message: Popover.Message,
  },
  GotToastMessage: { message: Toast.Message },
});

export type Message = typeof Message.Type;
