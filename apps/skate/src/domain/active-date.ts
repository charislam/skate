import { Match, Option, Schema } from "effect";
import { Calendar } from "foldkit";
import { Machine } from "foldkit/experimental";
import { to } from "foldkit/experimental/machine";
import { defineTaggedUnion } from "foldkit/schema";
import { evo } from "foldkit/struct";
import { Message as ActiveDateMessage, MessageSchema } from "./active-date-message";

// MODEL

export const Model = defineTaggedUnion({
  Initial: {},
  Day: {
    date: Calendar.CalendarDate,
  },
  Week: {
    startDate: Calendar.CalendarDate,
  },
  Month: {
    startDate: Calendar.CalendarDate,
  },
});

export type Model = typeof Model.Type;

// MESSAGE

export const Message = MessageSchema;

// UTILS

export const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const isDateRangeCurrent = (dateRange: Model, today: Calendar.CalendarDate): boolean =>
  Match.value(dateRange).pipe(
    Match.tagsExhaustive({
      Initial: () => true,
      Day: ({ date }) => Calendar.isEqual(date, today),
      Week: ({ startDate }) => Calendar.isEqual(startDate, Calendar.startOfWeek(today, "Monday")),
      Month: ({ startDate }) => Calendar.isEqual(startDate, Calendar.firstOfMonth(today)),
    }),
  );

export const formatMonth = (
  options: { format: "long" | "short" },
  date: Calendar.CalendarDate,
): Option.Option<string> => {
  const fullFormattedDate =
    options.format === "long"
      ? Calendar.formatLong(Calendar.defaultEnglishLocale)(date)
      : Calendar.formatShort(Calendar.defaultEnglishLocale)(date);
  return Option.fromUndefinedOr(fullFormattedDate.split(" ")[0]);
};

// MACHINE

export const machine = Machine.define({
  state: Model,
  message: ActiveDateMessage,
  context: Schema.Struct({ today: Calendar.CalendarDate }),
})({
  initial: Model.Initial(),
  states: {
    Initial: {
      on: {
        SyncedInitialDate: to("Day", ({ message }) => ({
          model: Model.Day({ date: message.date }),
        })),
      },
    },

    Day: {
      on: {
        SelectedNextDateRange: to("Day", ({ state }) => ({
          model: evo(state, {
            date: () => Calendar.addDays(state.date, 1),
          }),
        })),
        SelectedPreviousDateRange: to("Day", ({ state }) => ({
          model: evo(state, {
            date: () => Calendar.subtractDays(state.date, 1),
          }),
        })),
        SelectedCurrentDateRange: to("Day", ({ state, context }) => ({
          model: evo(state, {
            date: () => context.today,
          }),
        })),

        SelectedDayView: to("Day", ({ state }) => ({
          model: state,
        })),
        SelectedWeekView: to("Week", ({ state }) => ({
          model: Model.Week({ startDate: Calendar.startOfWeek(state.date, "Monday") }),
        })),
        SelectedMonthView: to("Month", ({ state }) => ({
          model: Model.Month({ startDate: Calendar.firstOfMonth(state.date) }),
        })),
      },
    },

    Week: {
      on: {
        SelectedNextDateRange: to("Week", ({ state }) => ({
          model: evo(state, {
            startDate: () => Calendar.addDays(state.startDate, 7),
          }),
        })),
        SelectedPreviousDateRange: to("Week", ({ state }) => ({
          model: evo(state, {
            startDate: () => Calendar.subtractDays(state.startDate, 7),
          }),
        })),
        SelectedCurrentDateRange: to("Week", ({ state, context }) => ({
          model: evo(state, {
            startDate: () => Calendar.startOfWeek(context.today, "Monday"),
          }),
        })),

        SelectedDayView: to("Day", ({ state }) => ({
          model: Model.Day({ date: state.startDate }),
        })),
        SelectedWeekView: to("Week", ({ state }) => ({
          model: state,
        })),
        SelectedMonthView: to("Month", ({ state }) => ({
          model: Model.Month({ startDate: Calendar.firstOfMonth(state.startDate) }),
        })),
      },
    },

    Month: {
      on: {
        SelectedNextDateRange: to("Month", ({ state }) => ({
          model: evo(state, {
            startDate: () => Calendar.addMonths(state.startDate, 1),
          }),
        })),
        SelectedPreviousDateRange: to("Month", ({ state }) => ({
          model: evo(state, {
            startDate: () => Calendar.subtractMonths(state.startDate, 1),
          }),
        })),
        SelectedCurrentDateRange: to("Month", ({ state, context }) => ({
          model: evo(state, {
            startDate: () => Calendar.firstOfMonth(context.today),
          }),
        })),

        SelectedDayView: to("Day", ({ state }) => ({
          model: Model.Day({ date: state.startDate }),
        })),
        SelectedWeekView: to("Week", ({ state }) => ({
          model: Model.Week({ startDate: Calendar.startOfWeek(state.startDate, "Monday") }),
        })),
        SelectedMonthView: to("Month", ({ state }) => ({
          model: state,
        })),
      },
    },
  },
});

export * as ActiveDate from "./active-date";
