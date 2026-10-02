import { Dialog, Popover } from "@foldkit/ui";
import { HashMap, Option, Schema } from "effect";
import { Calendar, Update } from "foldkit";
import { ActiveDate } from "~/domain";
import * as CalendarCache from "~/domain/calendar-cache";
import { Message } from "./message";
import { CalendarView, resolveCalendarView, viewMessage } from "./view-preference";

export const Model = Schema.Struct({
  today: Calendar.CalendarDate,
  activeDateRange: ActiveDate.Model,

  pageVisible: Schema.Boolean,
  maybeUserTabletView: Schema.Option(CalendarView),

  calendarCache: CalendarCache.Model,

  sessionMenus: Schema.HashMap(Schema.String, Popover.Model),
  sessionDialog: Dialog.Model,
  dayDialog: Dialog.Model,
  maybeDayDialogDate: Schema.Option(Calendar.CalendarDate),

  refreshingDates: Schema.Array(Calendar.CalendarDate),
});

export type Model = typeof Model.Type;

export const boot = (input: {
  today: Calendar.CalendarDate;
  pageVisible: boolean;
  tabletOrAbove: boolean;
  maybeUserTabletView: Option.Option<CalendarView>;
}): Update.Return<Model, typeof Message.Type> => {
  const context = { today: input.today };
  const initialized = ActiveDate.initialize(input.today);
  const resolved = ActiveDate.machine.transition(
    initialized,
    viewMessage(resolveCalendarView(input)),
    context,
  );

  return {
    model: {
      today: input.today,
      activeDateRange: resolved.model,

      pageVisible: input.pageVisible,
      maybeUserTabletView: input.maybeUserTabletView,

      calendarCache: CalendarCache.init(),

      sessionMenus: HashMap.empty(),
      sessionDialog: Dialog.init({ id: "session-details" }),

      dayDialog: Dialog.init({ id: "calendar-day" }),
      maybeDayDialogDate: Option.none(),

      refreshingDates: [],
    },
  };
};
