import { describe, expect, it } from "vitest";
import { Message as GlobalMessage } from "~/message";
import { ActiveDate } from "./active-date";

const { machine, Model } = ActiveDate;

describe("ActiveDate machine", () => {
  describe("date range navigation", () => {
    it("moves the selected day forwards and backwards across boundaries", () => {
      const day = Model.Day({ date: new Date(2024, 1, 29) });

      expect(machine.transition(day, GlobalMessage.SelectedNextDateRange()).model).toEqual(
        Model.Day({ date: new Date(2024, 2, 1) }),
      );
      expect(machine.transition(day, GlobalMessage.SelectedPreviousDateRange()).model).toEqual(
        Model.Day({ date: new Date(2024, 1, 28) }),
      );
    });

    it("moves the selected week forwards and backwards", () => {
      const week = Model.Week({ startDate: new Date(2024, 11, 30) });

      expect(machine.transition(week, GlobalMessage.SelectedNextDateRange()).model).toEqual(
        Model.Week({ startDate: new Date(2025, 0, 6) }),
      );
      expect(machine.transition(week, GlobalMessage.SelectedPreviousDateRange()).model).toEqual(
        Model.Week({ startDate: new Date(2024, 11, 23) }),
      );
    });

    it("moves the selected month forwards and backwards", () => {
      const month = Model.Month({ startDate: new Date(2024, 11, 1) });

      expect(machine.transition(month, GlobalMessage.SelectedNextDateRange()).model).toEqual(
        Model.Month({ startDate: new Date(2025, 0, 1) }),
      );
      expect(machine.transition(month, GlobalMessage.SelectedPreviousDateRange()).model).toEqual(
        Model.Month({ startDate: new Date(2024, 10, 1) }),
      );
    });
  });

  describe("view selection", () => {
    it("keeps the day date when selecting day view", () => {
      const day = Model.Day({ date: new Date(2024, 4, 17, 14, 30) });
      expect(machine.transition(day, GlobalMessage.SelectedDayView()).model).toEqual(day);
    });

    it("converts a day to its containing Monday-start week", () => {
      expect(
        machine.transition(
          Model.Day({ date: new Date(2024, 4, 19, 12) }),
          GlobalMessage.SelectedWeekView(),
        ).model,
      ).toEqual(Model.Week({ startDate: new Date(2024, 4, 13) }));
    });

    it("converts a day to the first of its month", () => {
      expect(
        machine.transition(
          Model.Day({ date: new Date(2024, 4, 17, 12) }),
          GlobalMessage.SelectedMonthView(),
        ).model,
      ).toEqual(Model.Month({ startDate: new Date(2024, 4, 1) }));
    });

    it("requests resolution when changing from a week to day or month view", () => {
      const week = Model.Week({ startDate: new Date(2024, 4, 13) });

      for (const [message, granularity] of [
        [GlobalMessage.SelectedDayView(), "Day"],
        [GlobalMessage.SelectedMonthView(), "Month"],
      ] as const) {
        const result = machine.transition(week, message);
        expect(result.model).toEqual(week);
        expect(result.commands).toHaveLength(1);
        expect(result.commands?.[0]).toMatchObject({ args: { granularity } });
      }
    });

    it("keeps the week when selecting week view", () => {
      const week = Model.Week({ startDate: new Date(2024, 4, 13) });
      expect(machine.transition(week, GlobalMessage.SelectedWeekView()).model).toEqual(week);
    });

    it("requests resolution when changing from a month to day or week view", () => {
      const month = Model.Month({ startDate: new Date(2024, 4, 1) });

      for (const [message, granularity] of [
        [GlobalMessage.SelectedDayView(), "Day"],
        [GlobalMessage.SelectedWeekView(), "Week"],
      ] as const) {
        const result = machine.transition(month, message);
        expect(result.model).toEqual(month);
        expect(result.commands).toHaveLength(1);
        expect(result.commands?.[0]).toMatchObject({ args: { granularity } });
      }
    });

    it("keeps the month when selecting month view", () => {
      const month = Model.Month({ startDate: new Date(2024, 4, 1) });
      expect(machine.transition(month, GlobalMessage.SelectedMonthView()).model).toEqual(month);
    });
  });

  describe("current range selection", () => {
    it.each([
      [Model.Initial(), "Day"],
      [Model.Day({ date: new Date(2024, 4, 17) }), "Day"],
      [Model.Week({ startDate: new Date(2024, 4, 13) }), "Week"],
      [Model.Month({ startDate: new Date(2024, 4, 1) }), "Month"],
    ] as const)("requests the current range in %s", (state, expectedGranularity) => {
      if (state._tag === "Initial") {
        expect(machine.step(state, GlobalMessage.SelectedCurrentDateRange())).toMatchObject({
          _tag: "Ignored",
          reason: "NotApplicable",
        });
        return;
      }

      const result = machine.transition(state, GlobalMessage.SelectedCurrentDateRange());
      expect(result.model).toEqual(state);
      expect(result.commands).toHaveLength(1);
      expect(result.commands?.[0]).toMatchObject({ args: { granularity: expectedGranularity } });
    });

    it.each([
      ["Day", new Date(2024, 4, 17), Model.Day({ date: new Date(2024, 4, 17) })],
      ["Week", new Date(2024, 4, 13), Model.Week({ startDate: new Date(2024, 4, 13) })],
      ["Month", new Date(2024, 4, 1), Model.Month({ startDate: new Date(2024, 4, 1) })],
    ] as const)(
      "resolves the shared current range as %s from every state",
      (granularity, date, expected) => {
        const states = [
          Model.Initial(),
          Model.Day({ date: new Date(2020, 0, 1) }),
          Model.Week({ startDate: new Date(2020, 0, 6) }),
          Model.Month({ startDate: new Date(2020, 0, 1) }),
        ];

        for (const state of states) {
          const result = machine.step(
            state,
            GlobalMessage.ResolvedCurrentDateRange({ granularity, date }),
          );
          expect(result._tag).toBe("Transitioned");
          if (result._tag === "Transitioned") {
            expect(result.target).toBe(expected._tag);
            expect(result.state).toEqual(expected);
            expect(result.commands).toEqual([]);
          }
        }
      },
    );
  });

  it("reports unhandled range navigation from Initial as ignored", () => {
    const initial = Model.Initial();
    expect(machine.step(initial, GlobalMessage.SelectedNextDateRange())).toEqual({
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
