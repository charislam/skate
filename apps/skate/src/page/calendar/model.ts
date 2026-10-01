import { Dialog, Popover } from "@foldkit/ui";
import { HashMap, Option, Schema } from "effect";
import { Calendar, Update } from "foldkit";
import { ActiveDate } from "~/domain";
import * as CalendarCache from "~/domain/calendar-cache";
import { SyncInitialDate } from "./command";
import { Message } from "./message";

export const Model = Schema.Struct({
  today: Calendar.CalendarDate,
  pageVisible: Schema.Boolean,
  activeDateRange: ActiveDate.Model,

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
}): Update.Return<Model, typeof Message.Type> => ({
  model: {
    today: input.today,
    pageVisible: input.pageVisible,
    activeDateRange: ActiveDate.machine.initial,
    calendarCache: CalendarCache.init(),
    sessionMenus: HashMap.empty(),
    sessionDialog: Dialog.init({ id: "session-details" }),
    dayDialog: Dialog.init({ id: "calendar-day" }),
    maybeDayDialogDate: Option.none(),
    refreshingDates: [],
  },
  commands: [SyncInitialDate({ today: input.today })],
});
