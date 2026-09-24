import { Effect, Schema } from "effect";
import { Calendar, Command as FoldkitCommand } from "foldkit";
import { load, pushUrl } from "foldkit/navigation";
import { Message } from "~/message";

export const NavigateInternal = FoldkitCommand.define("NavigateInternal", {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigateInternal],
  execute: ({ url }) =>
    pushUrl(url).pipe(
      Effect.as(Message.CompletedNavigateInternal()),
      Effect.catch(() => Effect.succeed(Message.CompletedNavigateInternal())),
    ),
});

export const LoadExternal = FoldkitCommand.define("LoadExternal", {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  execute: ({ href }) =>
    load(href).pipe(
      Effect.as(Message.CompletedLoadExternal()),
      Effect.catch(() => Effect.succeed(Message.CompletedLoadExternal())),
    ),
});

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
