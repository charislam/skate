import { Schema } from "effect";
import { Machine } from "foldkit/experimental";
import { to } from "foldkit/experimental/machine";
import { defineTaggedUnion } from "foldkit/schema";
import { evo } from "foldkit/struct";
import { GetCurrentDate } from "~/command";
import { Message as GlobalMessage } from "~/message";

// MODEL

export const Model = defineTaggedUnion({
  Initial: {},
  Day: {
    date: Schema.Date,
  },
  Week: {
    startDate: Schema.Date,
  },
  Month: {
    startDate: Schema.Date,
  },
});

export type Model = typeof Model.Type;

// MESSAGE

export const Message = {
  SelectedNextDateRange: {},
  SelectedPreviousDateRange: {},
  SelectedCurrentDateRange: {},

  SelectedDayView: {},
  SelectedWeekView: {},
  SelectedMonthView: {},

  ReceivedCurrentDate: {
    date: Schema.Date,
  },
} as const;

// MACHINE

export const machine = Machine.define({
  state: Model,
  message: GlobalMessage,
})({
  initial: Model.Initial(),
  states: {
    Initial: {
      on: {
        ReceivedCurrentDate: to("Day", ({ message }) => ({
          model: Model.Day({ date: message.date }),
        })),
      },
    },

    Day: {
      on: {
        SelectedNextDateRange: to("Day", ({ state }) => ({
          model: evo(state, {
            date: () => new Date(state.date.getTime() + 24 * 60 * 60 * 1000),
          }),
        })),
        SelectedPreviousDateRange: to("Day", ({ state }) => ({
          model: evo(state, {
            date: () => new Date(state.date.getTime() - 24 * 60 * 60 * 1000),
          }),
        })),
        SelectedCurrentDateRange: to("Day", ({ state }) => ({
          model: state,
          commands: [GetCurrentDate()],
        })),

        SelectedDayView: to("Day", ({ state }) => ({
          model: state,
        })),

        ReceivedCurrentDate: to("Day", ({ state, message }) => ({
          model: evo(state, {
            date: () => message.date,
          }),
        })),
      },
    },

    Week: {
      on: {
        SelectedNextDateRange: to("Week", ({ state }) => ({
          model: evo(state, {
            startDate: () => new Date(state.startDate.getTime() + 7 * 24 * 60 * 60 * 1000),
          }),
        })),
        SelectedPreviousDateRange: to("Week", ({ state }) => ({
          model: evo(state, {
            startDate: () => new Date(state.startDate.getTime() - 7 * 24 * 60 * 60 * 1000),
          }),
        })),
        SelectedCurrentDateRange: to("Week", ({ state }) => ({
          model: state,
          commands: [GetCurrentDate()],
        })),

        SelectedWeekView: to("Week", ({ state }) => ({
          model: state,
        })),
      },
    },
  },
});

export * as ActiveDate from "./active-date";
