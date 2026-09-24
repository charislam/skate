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

export * as Command from "./command";
