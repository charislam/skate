import { Effect } from "effect";
import { Calendar, Command as FoldkitCommand } from "foldkit";
import { Message } from "~/message";

export const SyncInitialDate = FoldkitCommand.define("SyncInitialDate", {
  args: {
    today: Calendar.CalendarDate,
  },
  messages: [Message.SyncedInitialDate],
  execute: ({ today }) => Effect.succeed(Message.SyncedInitialDate({ date: today })),
});

export const SelectDayView = FoldkitCommand.define("SelectDayView", {
  messages: [Message.SelectedDayView],
  execute: Effect.succeed(Message.SelectedDayView()),
});

export const SelectWeekView = FoldkitCommand.define("SelectWeekView", {
  messages: [Message.SelectedWeekView],
  execute: Effect.succeed(Message.SelectedWeekView()),
});

export const SelectMonthView = FoldkitCommand.define("SelectMonthView", {
  messages: [Message.SelectedMonthView],
  execute: Effect.succeed(Message.SelectedMonthView()),
});

export * as Command from "./command";
