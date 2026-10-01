import { Popover } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { UrlRequest } from "foldkit/navigation";
import { Url } from "foldkit/url";
import { MainMenu, Theme } from "./domain";
import { Auth } from "./domain/auth";
import { Session } from "./domain/session";
import * as CalendarPageMessage from "./page/calendar/message";
import * as Admin from "./page/admin/message";
import * as Login from "./page/login/message";
import { Toast } from "./toast";

export const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
  CompletedRedirect: {},

  AuthStateChanged: { maybeSession: Schema.Option(Session) },
  ClickedLogout: {},
  SucceededSignOut: {},
  FailedSignOut: { kind: Auth.ErrorKind },

  MediaWidthChanged: {
    tabletOrAbove: Schema.Boolean,
  },

  SelectedTheme: {
    theme: Schema.Option(Theme.Theme_),
  },

  SelectedMainMenuAction: {
    ...MainMenu.ActionFields,
  },

  SelectedNavigationLink: {},

  GotCalendarMessage: { message: CalendarPageMessage.Message },
  GotLoginMessage: { message: Login.Message },
  GotAdminMessage: { message: Admin.Message },
  GotThemeMessage: {
    message: Theme.Message,
  },
  GotPopoverMessage: {
    message: Popover.Message,
  },
  GotToastMessage: { message: Toast.Message },
});

export type Message = typeof Message.Type;
