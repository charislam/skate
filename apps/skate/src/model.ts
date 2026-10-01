import { Popover } from "@foldkit/ui";
import { Schema } from "effect";
import { taggedStruct } from "foldkit/schema";
import { Theme } from "./domain";
import { Session } from "./domain/session";
import * as Admin from "./page/admin/model";
import * as CalendarPage from "./page/calendar/model";
import * as Login from "./page/login/model";
import { LoggedInRoute, LoggedOutRoute } from "./route";
import { Toast } from "./toast";

const HomeFields = {
  calendar: CalendarPage.Model,

  menu: Popover.Model,
  toast: Toast.Model,

  theme: Theme.Model,
  tabletOrAbove: Schema.Boolean,
};

export const LoggedOutModel = taggedStruct("LoggedOut", {
  route: LoggedOutRoute,
  ...HomeFields,
  loginModel: Login.Model,
});

export const LoggedInModel = taggedStruct("LoggedIn", {
  adminModel: Admin.Model,
  route: LoggedInRoute,
  session: Session,
  ...HomeFields,
});

export const Model = Schema.Union([LoggedOutModel, LoggedInModel]);

export type Model = typeof Model.Type;
