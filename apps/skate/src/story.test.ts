import { Popover } from "@foldkit/ui";
import { Option } from "effect";
import { Calendar } from "foldkit";
import { Command, given, message, model, story } from "foldkit/story";
import { describe, expect, test } from "vitest";

import { Command as AppCommand } from "./command";
import { ActiveDate } from "./domain";
import { Message } from "./message";
import type { Model } from "./model";
import { AppRoute } from "./route";
import { update } from "./main";

const today = Calendar.make(2024, 5, 17);

const initialModel: Model = {
  route: AppRoute.Home(),
  today,
  activeDateRange: ActiveDate.Model.Day({ date: today }),
  menu: Popover.init({ id: "main-menu", contentFocus: true }),
  theme: { userTheme: Option.none(), systemTheme: "light" },
  tabletOrAbove: true,
};

describe("update", () => {
  describe("date range navigation", () => {
    test("moves a day across month boundaries", () => {
      story(
        update,
        given({
          ...initialModel,
          activeDateRange: ActiveDate.Model.Day({ date: Calendar.make(2024, 2, 29) }),
        }),
        message(Message.SelectedNextDateRange()),
        model((nextModel) => {
          expect(nextModel.activeDateRange).toEqual(
            ActiveDate.Model.Day({ date: Calendar.make(2024, 3, 1) }),
          );
        }),
        message(Message.SelectedPreviousDateRange()),
        model((nextModel) => {
          expect(nextModel.activeDateRange).toEqual(
            ActiveDate.Model.Day({ date: Calendar.make(2024, 2, 29) }),
          );
        }),
      );
    });

    test("moves a week by seven days and preserves Monday as its start", () => {
      story(
        update,
        given({
          ...initialModel,
          activeDateRange: ActiveDate.Model.Week({ startDate: Calendar.make(2024, 12, 30) }),
        }),
        message(Message.SelectedNextDateRange()),
        model((nextModel) => {
          expect(nextModel.activeDateRange).toEqual(
            ActiveDate.Model.Week({ startDate: Calendar.make(2025, 1, 6) }),
          );
        }),
      );
    });

    test("moves a month across the year boundary", () => {
      story(
        update,
        given({
          ...initialModel,
          activeDateRange: ActiveDate.Model.Month({ startDate: Calendar.make(2024, 12, 1) }),
        }),
        message(Message.SelectedNextDateRange()),
        model((nextModel) => {
          expect(nextModel.activeDateRange).toEqual(
            ActiveDate.Model.Month({ startDate: Calendar.make(2025, 1, 1) }),
          );
        }),
      );
    });

    test("selects the current date range at the existing granularity", () => {
      story(
        update,
        given({
          ...initialModel,
          activeDateRange: ActiveDate.Model.Week({ startDate: Calendar.make(2020, 1, 6) }),
        }),
        message(Message.SelectedCurrentDateRange()),
        model((nextModel) => {
          expect(nextModel.activeDateRange).toEqual(
            ActiveDate.Model.Week({ startDate: Calendar.make(2024, 5, 13) }),
          );
        }),
      );
    });
  });

  describe("view selection", () => {
    test("selects week view from a day using its Monday", () => {
      story(
        update,
        given(initialModel),
        message(Message.SelectedWeekView()),
        model((nextModel) => {
          expect(nextModel.activeDateRange).toEqual(
            ActiveDate.Model.Week({ startDate: Calendar.make(2024, 5, 13) }),
          );
        }),
      );
    });

    test("selects month view from a week using its start date", () => {
      story(
        update,
        given({
          ...initialModel,
          activeDateRange: ActiveDate.Model.Week({ startDate: Calendar.make(2024, 5, 13) }),
        }),
        message(Message.SelectedMonthView()),
        model((nextModel) => {
          expect(nextModel.activeDateRange).toEqual(
            ActiveDate.Model.Month({ startDate: Calendar.make(2024, 5, 1) }),
          );
        }),
      );
    });
  });

  describe("responsive controls", () => {
    test("switches to day view when the viewport drops below tablet width", () => {
      story(
        update,
        given({
          ...initialModel,
          activeDateRange: ActiveDate.Model.Month({ startDate: Calendar.make(2024, 5, 1) }),
        }),
        message(Message.MediaWidthChanged({ tabletOrAbove: false })),
        model((nextModel) => {
          expect(nextModel.tabletOrAbove).toBe(false);
        }),
        Command.expectHas(AppCommand.SelectDayView),
        Command.resolve(AppCommand.SelectDayView, Message.SelectedDayView()),
        model((nextModel) => {
          expect(nextModel.activeDateRange).toEqual(
            ActiveDate.Model.Day({ date: Calendar.make(2024, 5, 1) }),
          );
        }),
      );
    });

    test("keeps the selected range when the viewport grows", () => {
      story(
        update,
        given({ ...initialModel, tabletOrAbove: false }),
        message(Message.MediaWidthChanged({ tabletOrAbove: true })),
        model((nextModel) => {
          expect(nextModel.tabletOrAbove).toBe(true);
          expect(nextModel.activeDateRange).toEqual(initialModel.activeDateRange);
        }),
        Command.expectNone(),
      );
    });
  });

  describe("main menu", () => {
    test("selecting a menu action closes the popover and changes the range", () => {
      story(
        update,
        given({ ...initialModel, menu: { ...initialModel.menu, isOpen: true } }),
        message(Message.SelectedMainMenuAction({ action: "Week" })),
        model((nextModel) => {
          expect(nextModel.menu.isOpen).toBe(false);
        }),
        Command.expectHas(Popover.FocusButton({ id: "main-menu" })),
        Command.resolve(Popover.FocusButton, Popover.Message.CompletedFocusButton()),
        Command.expectHas(AppCommand.SelectWeekView),
        Command.resolve(AppCommand.SelectWeekView, Message.SelectedWeekView()),
        model((nextModel) => {
          expect(nextModel.activeDateRange).toEqual(
            ActiveDate.Model.Week({ startDate: Calendar.make(2024, 5, 13) }),
          );
        }),
      );
    });
  });
});
