import { Option, Result } from "effect";
import { Calendar } from "foldkit";
import { Command, given, message, model, story } from "foldkit/story";
import { fromString } from "foldkit/url";
import { describe, expect, test } from "vitest";
import * as CalendarCache from "~/domain/calendar-cache";
import { Flags, init, update } from "~/main";
import { Message as RootMessage } from "~/message";
import { FetchCalendarDay, PrepareCalendarDates, SaveUserCalendarView } from "./command";
import { Message } from "./message";
import { CalendarView } from "./view-preference";

const today = Calendar.make(2024, 5, 17);

const initialModel = (input: {
  view: Option.Option<CalendarView>;
  wide: boolean;
  path?: string;
}) => {
  const flags: Flags = {
    today,
    pageVisible: true,
    tabletOrAbove: input.wide,
    maybeUserTabletView: input.view,
    maybeUserTheme: Option.none(),
    systemTheme: "light",
    maybeSession: Option.none(),
  };
  return init(flags, Option.getOrThrow(fromString(`https://skate.to/${input.path ?? ""}`))).model;
};

const calendarMessage = (value: Message) => RootMessage.GotCalendarMessage({ message: value });

const resolvePreparation = Command.resolve(
  PrepareCalendarDates,
  Message.PreparedCalendarDates({ dates: [], now: 0, force: false, origin: "automatic" }),
);
const resolveSave = Command.resolve(SaveUserCalendarView, Message.CompletedSaveUserCalendarView());

describe("calendar preference stories", () => {
  test("selection before data, failed save, shrink, expand and explicit Day", () => {
    story(
      update,
      given(initialModel({ view: Option.none(), wide: true })),
      message(calendarMessage(Message.SelectedMainMenuAction({ action: "Month" }))),
      Command.expectExact(PrepareCalendarDates, SaveUserCalendarView({ view: "Month" })),
      model((next) => {
        expect(next.calendar.activeDateRange._tag).toBe("Month");
        expect(next.calendar.maybeUserTabletView).toEqual(Option.some("Month"));
        expect(next.menu.isOpen).toBe(false);
      }),
      Command.resolve(SaveUserCalendarView, Message.FailedSaveUserCalendarView()),
      resolvePreparation,
      message(RootMessage.MediaWidthChanged({ tabletOrAbove: false })),
      model((next) => {
        expect(next.calendar.activeDateRange._tag).toBe("Day");
        expect(next.calendar.maybeUserTabletView).toEqual(Option.some("Month"));
      }),
      Command.expectExact(PrepareCalendarDates),
      resolvePreparation,
      message(RootMessage.MediaWidthChanged({ tabletOrAbove: true })),
      model((next) => expect(next.calendar.activeDateRange._tag).toBe("Month")),
      Command.expectExact(PrepareCalendarDates),
      resolvePreparation,
      message(RootMessage.MediaWidthChanged({ tabletOrAbove: true })),
      Command.expectNone(),
      message(calendarMessage(Message.SelectedMainMenuAction({ action: "Day" }))),
      model((next) => expect(next.calendar.maybeUserTabletView).toEqual(Option.some("Day"))),
      Command.expectExact(PrepareCalendarDates, SaveUserCalendarView({ view: "Day" })),
      resolveSave,
      resolvePreparation,
    );
  });

  test.each(CalendarView.literals)(
    "mobile action %s cannot overwrite a reloaded Week",
    (action) => {
      story(
        update,
        given(initialModel({ view: Option.some("Week"), wide: false })),
        message(calendarMessage(Message.SelectedMainMenuAction({ action }))),
        model((next) => {
          expect(next.calendar.activeDateRange._tag).toBe("Day");
          expect(next.calendar.maybeUserTabletView).toEqual(Option.some("Week"));
        }),
        Command.expectExact(PrepareCalendarDates),
        resolvePreparation,
        message(RootMessage.MediaWidthChanged({ tabletOrAbove: true })),
        model((next) => expect(next.calendar.activeDateRange._tag).toBe("Week")),
        Command.expectExact(PrepareCalendarDates),
        resolvePreparation,
      );
    },
  );

  test.each([
    Message.SelectedNextDateRange(),
    Message.SelectedPreviousDateRange(),
    Message.SelectedCurrentDateRange(),
    Message.SelectedWeekView(),
  ])("$_tag retains preference without saving", (value) => {
    story(
      update,
      given(initialModel({ view: Option.some("Month"), wide: true })),
      message(calendarMessage(value)),
      model((next) => expect(next.calendar.maybeUserTabletView).toEqual(Option.some("Month"))),
      Command.expectExact(PrepareCalendarDates),
      resolvePreparation,
    );
  });

  test("late entry preparation does not restore a previous view", () => {
    story(
      update,
      given(initialModel({ view: Option.some("Week"), wide: true })),
      message(calendarMessage(Message.CalendarFreshnessTick({ today, now: 0 }))),
      Command.expectExact(PrepareCalendarDates),
      Command.resolve(
        PrepareCalendarDates,
        Message.PreparedCalendarDates({ dates: [], now: 0, force: false, origin: "automatic" }),
      ),
      message(calendarMessage(Message.SelectedMainMenuAction({ action: "Month" }))),
      resolveSave,
      resolvePreparation,
      message(
        calendarMessage(
          Message.PreparedCalendarDates({
            dates: [today],
            now: 0,
            force: false,
            origin: "automatic",
          }),
        ),
      ),
      model((next) => {
        expect(next.calendar.activeDateRange._tag).toBe("Month");
        expect(next.calendar.maybeUserTabletView).toEqual(Option.some("Month"));
      }),
      Command.expectExact(FetchCalendarDay({ date: today, requestId: 1 })),
      Command.resolve(
        FetchCalendarDay,
        Message.SettledCalendarDay({
          date: today,
          requestId: 1,
          now: 1,
          result: Result.succeed([]),
        }),
      ),
      resolvePreparation,
      model((next) => {
        expect(next.calendar.activeDateRange._tag).toBe("Month");
        expect(next.calendar.maybeUserTabletView).toEqual(Option.some("Month"));
        expect(Option.isSome(CalendarCache.dayEntry(next.calendar.calendarCache, today))).toBe(
          true,
        );
      }),
      Command.expectNone(),
    );
  });

  test("resize on another route restores preference without preparing dates", () => {
    story(
      update,
      given(initialModel({ view: Option.some("Month"), wide: true, path: "login" })),
      message(RootMessage.MediaWidthChanged({ tabletOrAbove: false })),
      model((next) => {
        expect(next.calendar.activeDateRange._tag).toBe("Day");
        expect(next.calendar.maybeUserTabletView).toEqual(Option.some("Month"));
      }),
      Command.expectNone(),
      message(RootMessage.MediaWidthChanged({ tabletOrAbove: true })),
      model((next) => expect(next.calendar.activeDateRange._tag).toBe("Month")),
      Command.expectNone(),
    );
  });

  test("calendar entry tick prepares the currently resolved range", () => {
    const initial = initialModel({ view: Option.some("Month"), wide: true });
    story(
      update,
      given(initial),
      message(calendarMessage(Message.CalendarFreshnessTick({ today, now: 0 }))),
      Command.expectExact(
        PrepareCalendarDates({
          dates: CalendarCache.displayedDates(initial.calendar.activeDateRange),
          force: false,
          origin: "automatic",
        }),
      ),
      model((next) =>
        expect(next.calendar.activeDateRange).toEqual(initial.calendar.activeDateRange),
      ),
      resolvePreparation,
    );
  });
});
