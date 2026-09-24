import { Schema } from "effect";
import { Calendar } from "foldkit";
import { ActiveDate, Theme } from "./domain";
import { Popover } from "@foldkit/ui";
import { AppRoute } from "./route";

export const Model = Schema.Struct({
  route: AppRoute,
  today: Calendar.CalendarDate,
  activeDateRange: ActiveDate.Model,
  menu: Popover.Model,
  theme: Theme.Model,
  tabletOrAbove: Schema.Boolean,
});

export type Model = typeof Model.Type;
