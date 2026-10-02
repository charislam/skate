import { BrowserKeyValueStore, Clipboard } from "@effect/platform-browser";
import { Effect, Schema } from "effect";
import { Calendar, Command as FoldkitCommand } from "foldkit";
import { Calendar as CalendarDomain } from "~/domain/calendar";
import { sessionRouter } from "~/route";
import { Message } from "./message";
import { CalendarView, saveUserCalendarView } from "./view-preference";

export const SaveUserCalendarView = FoldkitCommand.define("SaveUserCalendarView", {
  args: { view: CalendarView },
  messages: [Message.CompletedSaveUserCalendarView, Message.FailedSaveUserCalendarView],
  execute: ({ view }) =>
    saveUserCalendarView(view).pipe(
      Effect.provide(BrowserKeyValueStore.layerLocalStorage),
      Effect.as(Message.CompletedSaveUserCalendarView()),
      Effect.catchCause(() => Effect.succeed(Message.FailedSaveUserCalendarView())),
    ),
});

export const FetchCalendarDay = FoldkitCommand.define("FetchCalendarDay", {
  args: { date: Calendar.CalendarDate, requestId: Schema.Number },
  messages: [Message.SettledCalendarDay],
  execute: ({ date, requestId }) =>
    Effect.gen(function* () {
      const calendar = yield* CalendarDomain.Service;
      const [result, now] = yield* Effect.all(
        [
          Effect.result(calendar.listDay(date)),
          Effect.clockWith((clock) => clock.currentTimeMillis),
        ],
        { concurrency: 2 },
      );
      return Message.SettledCalendarDay({ date, requestId, now, result });
    }),
});

export const PrepareCalendarDates = FoldkitCommand.define("PrepareCalendarDates", {
  args: {
    dates: Schema.Array(Calendar.CalendarDate),
    force: Schema.Boolean,
    origin: Schema.Literals(["automatic", "manual", "retry"]),
  },
  messages: [Message.PreparedCalendarDates],
  execute: ({ dates, force, origin }) =>
    Effect.clockWith((clock) => clock.currentTimeMillis).pipe(
      Effect.map((now) => Message.PreparedCalendarDates({ dates, now, force, origin })),
      Effect.catch(() =>
        Effect.succeed(Message.PreparedCalendarDates({ dates, now: 0, force, origin })),
      ),
    ),
});

export const FetchCalendarDetail = FoldkitCommand.define("FetchCalendarDetail", {
  args: { id: CalendarDomain.SessionId, requestId: Schema.Number },
  messages: [Message.SettledCalendarDetail],
  execute: ({ id, requestId }) =>
    Effect.gen(function* () {
      const calendar = yield* CalendarDomain.Service;
      const [result, now] = yield* Effect.all(
        [
          Effect.result(calendar.findById(id)),
          Effect.clockWith((clock) => clock.currentTimeMillis),
        ],
        { concurrency: 2 },
      );
      return Message.SettledCalendarDetail({ id, requestId, now, result });
    }),
});

export const PrepareSessionDetail = FoldkitCommand.define("PrepareSessionDetail", {
  args: { id: CalendarDomain.SessionId },
  messages: [Message.PreparedSessionDetail],
  execute: ({ id }) =>
    Effect.clockWith((clock) => clock.currentTimeMillis).pipe(
      Effect.map((now) => Message.PreparedSessionDetail({ id, now })),
      Effect.catch(() => Effect.succeed(Message.PreparedSessionDetail({ id, now: 0 }))),
    ),
});

export const CopySessionLink = FoldkitCommand.define("CopySessionLink", {
  args: { id: CalendarDomain.SessionId },
  messages: [Message.CompletedCopySessionLink],
  execute: ({ id }) =>
    Effect.gen(function* () {
      const clipboard = yield* Clipboard.Clipboard;
      const url = new URL(sessionRouter({ id }), window.location.href).href;
      const result = yield* Effect.result(clipboard.writeString(url));
      return Message.CompletedCopySessionLink({ success: result._tag === "Success" });
    }),
});

export * as Command from "./command";
