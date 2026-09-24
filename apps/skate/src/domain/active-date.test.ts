import { describe, expect, it } from "vitest";
import { Calendar } from "foldkit";
import { Message as GlobalMessage } from "~/message";
import { ActiveDate } from "./active-date";

const { machine, Model } = ActiveDate;
const context = { today: Calendar.make(2024, 5, 17) };
const transition = (state: ActiveDate.Model, message: GlobalMessage) =>
  machine.transition(state, message, context);
const step = (state: ActiveDate.Model, message: GlobalMessage) =>
  machine.step(state, message, context);

describe("ActiveDate machine", () => {
  describe("date range navigation", () => {
    it("moves the selected day forwards and backwards across boundaries", () => {
      const day = Model.Day({ date: Calendar.make(2024, 2, 29) });

      expect(transition(day, GlobalMessage.SelectedNextDateRange()).model).toEqual(
        Model.Day({ date: Calendar.make(2024, 3, 1) }),
      );
      expect(transition(day, GlobalMessage.SelectedPreviousDateRange()).model).toEqual(
        Model.Day({ date: Calendar.make(2024, 2, 28) }),
      );
    });

    it("moves the selected week forwards and backwards", () => {
      const week = Model.Week({ startDate: Calendar.make(2024, 12, 30) });

      expect(transition(week, GlobalMessage.SelectedNextDateRange()).model).toEqual(
        Model.Week({ startDate: Calendar.make(2025, 1, 6) }),
      );
      expect(transition(week, GlobalMessage.SelectedPreviousDateRange()).model).toEqual(
        Model.Week({ startDate: Calendar.make(2024, 12, 23) }),
      );
    });

    it("moves the selected month forwards and backwards", () => {
      const month = Model.Month({ startDate: Calendar.make(2024, 12, 1) });

      expect(transition(month, GlobalMessage.SelectedNextDateRange()).model).toEqual(
        Model.Month({ startDate: Calendar.make(2025, 1, 1) }),
      );
      expect(transition(month, GlobalMessage.SelectedPreviousDateRange()).model).toEqual(
        Model.Month({ startDate: Calendar.make(2024, 11, 1) }),
      );
    });
  });

  describe("view selection", () => {
    it("keeps the day date when selecting day view", () => {
      const day = Model.Day({ date: Calendar.make(2024, 5, 17) });
      expect(transition(day, GlobalMessage.SelectedDayView()).model).toEqual(day);
    });

    it("converts a day to its containing Monday-start week", () => {
      expect(
        transition(
          Model.Day({ date: Calendar.make(2024, 5, 19) }),
          GlobalMessage.SelectedWeekView(),
        ).model,
      ).toEqual(Model.Week({ startDate: Calendar.make(2024, 5, 13) }));
    });

    it("converts a day to the first of its month", () => {
      expect(
        transition(
          Model.Day({ date: Calendar.make(2024, 5, 17) }),
          GlobalMessage.SelectedMonthView(),
        ).model,
      ).toEqual(Model.Month({ startDate: Calendar.make(2024, 5, 1) }));
    });

    it("converts a week to day or month view using its start date", () => {
      const week = Model.Week({ startDate: Calendar.make(2024, 5, 13) });

      expect(transition(week, GlobalMessage.SelectedDayView()).model).toEqual(
        Model.Day({ date: Calendar.make(2024, 5, 13) }),
      );
      expect(transition(week, GlobalMessage.SelectedMonthView()).model).toEqual(
        Model.Month({ startDate: Calendar.make(2024, 5, 1) }),
      );
    });

    it("keeps the week when selecting week view", () => {
      const week = Model.Week({ startDate: Calendar.make(2024, 5, 13) });
      expect(transition(week, GlobalMessage.SelectedWeekView()).model).toEqual(week);
    });

    it("converts a month to day or week view using its start date", () => {
      const month = Model.Month({ startDate: Calendar.make(2024, 5, 1) });

      expect(transition(month, GlobalMessage.SelectedDayView()).model).toEqual(
        Model.Day({ date: Calendar.make(2024, 5, 1) }),
      );
      expect(transition(month, GlobalMessage.SelectedWeekView()).model).toEqual(
        Model.Week({ startDate: Calendar.make(2024, 4, 29) }),
      );
    });

    it("keeps the month when selecting month view", () => {
      const month = Model.Month({ startDate: Calendar.make(2024, 5, 1) });
      expect(transition(month, GlobalMessage.SelectedMonthView()).model).toEqual(month);
    });
  });

  describe("current range selection", () => {
    it.each([
      [Model.Day({ date: Calendar.make(2020, 1, 1) }), Model.Day({ date: context.today })],
      [
        Model.Week({ startDate: Calendar.make(2020, 1, 6) }),
        Model.Week({ startDate: Calendar.make(2024, 5, 13) }),
      ],
      [
        Model.Month({ startDate: Calendar.make(2020, 1, 1) }),
        Model.Month({ startDate: Calendar.make(2024, 5, 1) }),
      ],
    ] as const)("selects the current range from %s", (state, expected) => {
      const result = transition(state, GlobalMessage.SelectedCurrentDateRange());
      expect(result.model).toEqual(expected);
      expect(result.commands).toEqual([]);
    });

    it("ignores current range selection from Initial", () => {
      expect(step(Model.Initial(), GlobalMessage.SelectedCurrentDateRange())).toMatchObject({
        _tag: "Ignored",
        reason: "NotApplicable",
      });
    });
  });

  it("reports unhandled range navigation from Initial as ignored", () => {
    const initial = Model.Initial();
    expect(step(initial, GlobalMessage.SelectedNextDateRange())).toEqual({
      _tag: "Ignored",
      stateTag: "Initial",
      messageTag: "SelectedNextDateRange",
      state: initial,
      reason: "NotApplicable",
    });
  });

  it("keeps every state reachable and every declared transition live", () => {
    expect(machine.unreachableStates()).toEqual([]);
    expect(machine.deadTransitions()).toEqual([]);
  });
});
