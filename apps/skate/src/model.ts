import { Popover } from "@foldkit/ui";
import { Schema } from "effect";
import { Calendar } from "foldkit";
import { taggedStruct } from "foldkit/schema";
import { ActiveDate, Theme } from "./domain";
import { Session } from "./domain/session";
import { LoggedInRoute, LoggedOutRoute } from "./route";
import * as Login from "./page/login/model";

const HomeFields = {
  today: Calendar.CalendarDate,
  activeDateRange: ActiveDate.Model,
  menu: Popover.Model,
  theme: Theme.Model,
  tabletOrAbove: Schema.Boolean,
};

export const LoggedOutModel = taggedStruct("LoggedOut", {
  route: LoggedOutRoute,
  ...HomeFields,
  loginModel: Login.Model,
});

export const LoggedInModel = taggedStruct("LoggedIn", {
  route: LoggedInRoute,
  session: Session,
  maybeSignOutError: Schema.Option(Schema.String),
  ...HomeFields,
});

export const Model = Schema.Union([LoggedOutModel, LoggedInModel]);

export type Model = typeof Model.Type;
