import { Schema } from "effect";
import { Machine } from "foldkit/experimental";
import { to, when } from "foldkit/experimental/machine";
import { defineTaggedUnion } from "foldkit/schema";
import { evo } from "foldkit/struct";
import { ActiveDateUtils } from "./active-date-utils";
import { Message as ActiveDateMessage, MessageSchema } from "./active-date-message";
import { Command } from "~/command";

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

export const Message = MessageSchema;

// MACHINE

export const machine = Machine.define({
  state: Model,
  message: ActiveDateMessage,
})({
  initial: Model.Initial(),
  shared: [
    Machine.forStates(["Initial", "Day", "Week", "Month"]).on({
      ResolvedCurrentDateRange: [
        when(
          (_state, message) => message.granularity === "Day",
          "Day",
          ({ message }) => ({
            model: Model.Day({ date: message.date }),
          }),
        ),
        when(
          (_state, message) => message.granularity === "Week",
          "Week",
          ({ message }) => ({
            model: Model.Week({ startDate: message.date }),
          }),
        ),
        when(
          (_state, message) => message.granularity === "Month",
          "Month",
          ({ message }) => ({
            model: Model.Month({ startDate: message.date }),
          }),
        ),
      ],
    }),
  ],
  states: {
    Day: {
      on: {
        SelectedNextDateRange: to("Day", ({ state }) => ({
          model: evo(state, {
            date: () => ActiveDateUtils.incrementDay(state.date),
          }),
        })),
        SelectedPreviousDateRange: to("Day", ({ state }) => ({
          model: evo(state, {
            date: () => ActiveDateUtils.decrementDay(state.date),
          }),
        })),
        SelectedCurrentDateRange: to("Day", ({ state }) => ({
          model: state,
          commands: [
            Command.ResolveCurrentDateRange({
              granularity: "Day",
            }),
          ],
        })),

        SelectedDayView: to("Day", ({ state }) => ({
          model: state,
        })),
        SelectedWeekView: to("Week", ({ state }) => {
          const startDate = ActiveDateUtils.getStartOfWeek(state.date);

          return {
            model: Model.Week({ startDate }),
          };
        }),
        SelectedMonthView: to("Month", ({ state }) => {
          const startDate = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
          return {
            model: Model.Month({ startDate }),
          };
        }),
      },
    },

    Week: {
      on: {
        SelectedNextDateRange: to("Week", ({ state }) => ({
          model: evo(state, {
            startDate: () => ActiveDateUtils.incrementWeek(state.startDate),
          }),
        })),
        SelectedPreviousDateRange: to("Week", ({ state }) => ({
          model: evo(state, {
            startDate: () => ActiveDateUtils.decrementWeek(state.startDate),
          }),
        })),
        SelectedCurrentDateRange: to("Week", ({ state }) => ({
          model: state,
          commands: [
            Command.ResolveCurrentDateRange({
              granularity: "Week",
            }),
          ],
        })),

        SelectedDayView: to("Week", ({ state }) => ({
          model: state,
          commands: [
            Command.ResolveCurrentDateRange({
              granularity: "Day",
            }),
          ],
        })),
        SelectedWeekView: to("Week", ({ state }) => ({
          model: state,
        })),
        SelectedMonthView: to("Week", ({ state }) => ({
          model: state,
          commands: [
            Command.ResolveCurrentDateRange({
              granularity: "Month",
            }),
          ],
        })),
      },
    },

    Month: {
      on: {
        SelectedNextDateRange: to("Month", ({ state }) => ({
          model: evo(state, {
            startDate: () => ActiveDateUtils.incrementMonth(state.startDate),
          }),
        })),
        SelectedPreviousDateRange: to("Month", ({ state }) => ({
          model: evo(state, {
            startDate: () => ActiveDateUtils.decrementMonth(state.startDate),
          }),
        })),
        SelectedCurrentDateRange: to("Month", ({ state }) => ({
          model: state,
          commands: [
            Command.ResolveCurrentDateRange({
              granularity: "Month",
            }),
          ],
        })),

        SelectedDayView: to("Month", ({ state }) => ({
          model: state,
          commands: [
            Command.ResolveCurrentDateRange({
              granularity: "Day",
            }),
          ],
        })),
        SelectedWeekView: to("Month", ({ state }) => ({
          model: state,
          commands: [
            Command.ResolveCurrentDateRange({
              granularity: "Week",
            }),
          ],
        })),
        SelectedMonthView: to("Month", ({ state }) => ({
          model: state,
        })),
      },
    },
  },
});

export * as ActiveDate from "./active-date";
