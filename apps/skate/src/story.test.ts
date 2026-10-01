import { Dialog, Popover, Toast as UiToast } from "@foldkit/ui";
import { DateTime, HashMap, Option, Result } from "effect";
import { Calendar } from "foldkit";
import { fromString } from "foldkit/url";
import { Command, given, message, model, story } from "foldkit/story";
import { describe, expect, test } from "vitest";

import { Command as AppCommand } from "./command";
import { ActiveDate } from "./domain";
import { Calendar as CalendarDomain } from "./domain/calendar";
import * as CalendarCache from "./domain/calendar-cache";
import { AdminAccess } from "./domain/admin-access";
import * as Admin from "./page/admin/model";
import { Message as AdminMessage } from "./page/admin/message";
import * as CalendarPageCommand from "./page/calendar/command";
import * as CalendarPageMessage from "./page/calendar/message";
import { UserId } from "./domain/session";
import { Message } from "./message";
import type { Model } from "./model";
import { Toast } from "./toast";
import { AppRoute, sessionRouter, urlToAppRoute } from "./route";
import * as Login from "./page/login/model";
import { update } from "./main";

const today = Calendar.make(2024, 5, 17);
const url = (value: string) =>
  Option.getOrThrowWith(fromString(value), () => new Error("Invalid test URL"));

const initialModel: Model = {
  _tag: "LoggedOut",
  route: AppRoute.Home(),
  calendar: {
    today,
    pageVisible: true,
    activeDateRange: ActiveDate.Model.Day({ date: today }),
    sessionMenus: HashMap.empty(),
    calendarCache: CalendarCache.init(),
    sessionDialog: Dialog.init({ id: "session-details" }),
    dayDialog: Dialog.init({ id: "calendar-day" }),
    maybeDayDialogDate: Option.none(),
    refreshingDates: [],
  },
  menu: Popover.init({ id: "main-menu", contentFocus: true }),
  theme: { userTheme: Option.none(), systemTheme: "light" },
  tabletOrAbove: true,
  toast: Toast.init({ id: "app-toast" }),
  loginModel: Login.init(),
};

const resolveCalendarPreparation = Command.resolve(
  CalendarPageCommand.PrepareCalendarDates,
  CalendarPageMessage.Message.PreparedCalendarDates({
    dates: [],
    now: 0,
    force: false,
    origin: "automatic",
  }),
);

const calendarMessage = (message: typeof CalendarPageMessage.Message.Type) =>
  Message.GotCalendarMessage({ message });

describe("update", () => {
  describe("calendar outmessages", () => {
    test("routes session-detail navigation through the parent", () => {
      const id = CalendarDomain.SessionId.make("session-1");
      story(
        update,
        given(initialModel),
        message(
          calendarMessage(
            CalendarPageMessage.Message.ClickedSessionDetails({ menuId: "menu-1", id }),
          ),
        ),
        Command.expectHas(
          AppCommand.NavigateInternal({
            url: sessionRouter({ id }),
          }),
        ),
        Command.resolve(AppCommand.NavigateInternal, Message.CompletedNavigateInternal()),
      );
    });

    test("routes returning home through the parent", () => {
      story(
        update,
        given(initialModel),
        message(calendarMessage(CalendarPageMessage.Message.ClickedBackToDayDialog())),
        Command.expectHas(AppCommand.RedirectForAuthentication({ destination: "Home" })),
        Command.resolve(AppCommand.RedirectForAuthentication, Message.CompletedRedirect()),
      );
    });
  });

  test("moves a desktop calendar to the settled session date when entered from calendar", () => {
    const id = CalendarDomain.SessionId.make("session-1");
    const requested = CalendarCache.requestDetail(initialModel.calendar.calendarCache, {
      id,
      now: 0,
    });
    if (Option.isNone(requested.request)) throw new Error("Expected a session detail request");

    const session: CalendarDomain.CalendarSession = {
      id,
      start: DateTime.makeZonedUnsafe(
        { year: 2024, month: 6, day: 4, hour: 10 },
        { timeZone: "America/Toronto", adjustForTimeZone: true },
      ),
      end: DateTime.makeZonedUnsafe(
        { year: 2024, month: 6, day: 4, hour: 11 },
        { timeZone: "America/Toronto", adjustForTimeZone: true },
      ),
      raw_start: "2024-06-04 10:00:00",
      raw_end: "2024-06-04 11:00:00",
      audience: "general",
      is_cancelled: false,
      certainty: "certain",
      rink_id: "7",
      rink_name: "Central rink",
      rink_address: null,
      rink_url: Option.none(),
    };
    const model: Model = {
      ...initialModel,
      route: AppRoute.Session({ id }),
      calendar: {
        ...initialModel.calendar,
        activeDateRange: ActiveDate.Model.Month({ startDate: Calendar.make(2024, 5, 1) }),
        calendarCache: requested.model,
      },
    };

    const settled = update(
      model,
      calendarMessage(
        CalendarPageMessage.Message.SettledCalendarDetail({
          id,
          requestId: requested.request.value.requestId,
          now: 1,
          result: Result.succeed(Option.some(session)),
        }),
      ),
    );

    expect(settled.model.calendar.activeDateRange).toEqual(
      ActiveDate.Model.Month({ startDate: Calendar.make(2024, 6, 1) }),
    );
  });

  describe("route access", () => {
    test.each([
      ["/admin", "Overview"],
      ["/admin/sources", "Sources"],
    ] as const)("parses %s as an admin section", (path, section) => {
      expect(urlToAppRoute(url(`http://localhost${path}`))).toEqual(AppRoute.Admin({ section }));
    });

    test("brands session IDs when they enter through the route", () => {
      const id = "9223372036854775000";
      expect(urlToAppRoute(url(`http://localhost/sessions/${id}`))).toEqual(
        AppRoute.Session({ id: CalendarDomain.SessionId.make(id) }),
      );
    });

    test.each(["/admin", "/admin/sources"])("redirects logged-out users away from %s", (path) => {
      story(
        update,
        given(initialModel),
        message(Message.ChangedUrl({ url: url(`http://localhost${path}`) })),
        model((next) => {
          expect(next._tag).toBe("LoggedOut");
          expect(next.route).toEqual(AppRoute.Login());
        }),
        Command.expectHas(AppCommand.RedirectForAuthentication({ destination: "Login" })),
        Command.resolve(AppCommand.RedirectForAuthentication, Message.CompletedRedirect()),
      );
    });

    test("revalidates access on /admin/sources and redirects when denied", () => {
      const loggedIn: Model = {
        ...initialModel,
        _tag: "LoggedIn",
        route: AppRoute.Home(),
        adminModel: {
          ...Admin.init(),
          adminAccess: AdminAccess.Success({ data: true }),
        },
        session: { userId: UserId.make("user-1"), email: Option.none() },
      };
      const navigating = update(
        loggedIn,
        Message.ChangedUrl({ url: url("http://localhost/admin/sources") }),
      );
      expect(navigating.model.route).toEqual(AppRoute.Admin({ section: "Sources" }));
      if (navigating.model._tag !== "LoggedIn") {
        throw new Error("Expected logged-in model");
      }
      expect(navigating.model.adminModel.adminAccess._tag).toBe("Refreshing");
      expect(
        "commands" in navigating &&
          navigating.commands?.some((command) => command.name === "FetchAdminAccess"),
      ).toBe(true);

      const denied = update(
        navigating.model,
        Message.GotAdminMessage({
          message: AdminMessage.SettledFetchAccess({
            userId: loggedIn.session.userId,
            adminRequestId: navigating.model.adminModel.adminRequestId,
            result: Result.succeed(false),
          }),
        }),
      );
      expect(denied.model.route).toEqual(AppRoute.Home());
      expect(
        "commands" in denied &&
          denied.commands?.some(
            (command) =>
              command.name === "RedirectForAuthentication" &&
              command.args?.["destination"] === "Home",
          ),
      ).toBe(true);
    });

    test.each([
      ["Overview", "/admin/sources", "Sources"],
      ["Sources", "/admin", "Overview"],
    ] as const)("switches from %s to %s and starts that section's load", (current, path, next) => {
      const loggedIn: Model = {
        ...initialModel,
        _tag: "LoggedIn",
        route: AppRoute.Admin({ section: current }),
        adminModel: {
          ...Admin.init(),
          adminAccess: AdminAccess.Success({ data: true }),
        },
        session: { userId: UserId.make("user-1"), email: Option.none() },
      };
      const navigating = update(
        loggedIn,
        Message.ChangedUrl({ url: url(`http://localhost${path}`) }),
      );
      expect(navigating.model.route).toEqual(AppRoute.Admin({ section: next }));
      if (navigating.model._tag !== "LoggedIn") {
        throw new Error("Expected logged-in model");
      }
      if (next === "Sources") {
        expect(navigating.model.adminModel.sourcesTable.feed._tag).toBe("Idle");
        expect(
          "commands" in navigating &&
            navigating.commands?.some((command) => command.name === "CreateSourcesScope"),
        ).toBe(true);
      } else {
        expect(navigating.model.adminModel.activeSourceCount._tag).toBe("Loading");
        expect(
          "commands" in navigating &&
            navigating.commands?.some((command) => command.name === "FetchActiveSources"),
        ).toBe(true);
        expect(
          "commands" in navigating &&
            navigating.commands?.some((command) => command.name === "FetchAdminAccess"),
        ).toBe(false);
      }
    });

    test("keeps Sources state cached when navigating away from Admin", () => {
      const adminModel = {
        ...Admin.init(),
        adminAccess: AdminAccess.Success({ data: true }),
      };
      const loggedIn: Model = {
        ...initialModel,
        _tag: "LoggedIn",
        route: AppRoute.Admin({ section: "Sources" }),
        adminModel,
        session: { userId: UserId.make("user-1"), email: Option.none() },
      };

      const navigating = update(loggedIn, Message.ChangedUrl({ url: url("http://localhost/") }));

      expect(navigating.model.route).toEqual(AppRoute.Home());
      if (navigating.model._tag !== "LoggedIn") {
        throw new Error("Expected logged-in model");
      }
      expect(navigating.model.adminModel.sourcesTable).toBe(adminModel.sourcesTable);
    });

    test("redirects logged-in users away from the login route", () => {
      const loggedIn = {
        ...initialModel,
        _tag: "LoggedIn" as const,
        route: AppRoute.Home(),
        adminModel: {
          ...Admin.init(),
          adminAccess: AdminAccess.Success({ data: true }),
        },
        session: { userId: UserId.make("user-1"), email: Option.none() },
      };
      story(
        update,
        given(loggedIn),
        message(Message.ChangedUrl({ url: url("http://localhost/login") })),
        model((next) => {
          expect(next._tag).toBe("LoggedIn");
          expect(next.route).toEqual(AppRoute.Home());
        }),
        Command.expectHas(AppCommand.RedirectForAuthentication({ destination: "Home" })),
        Command.resolve(AppCommand.RedirectForAuthentication, Message.CompletedRedirect()),
      );
    });
  });

  test("shows a toast after sign out fails", () => {
    const loggedIn = {
      ...initialModel,
      _tag: "LoggedIn" as const,
      adminModel: {
        ...Admin.init(),
        adminAccess: AdminAccess.Success({ data: true }),
      },
      session: { userId: UserId.make("user-1"), email: Option.none() },
    };
    story(
      update,
      given(loggedIn),
      message(Message.ClickedLogout()),
      Command.expectHas(AppCommand.SignOut),
      Command.resolve(AppCommand.SignOut, Message.FailedSignOut({ kind: "Unexpected" })),
      model((next) => {
        expect(next._tag).toBe("LoggedIn");
        if (next._tag === "LoggedIn")
          expect(next.toast.entries[0]?.payload).toBe("We couldn't sign you out. Try again.");
      }),
      UiToast.test.drainEntry({ entryId: "app-toast-entry-0" }),
    );
  });

  describe("date range navigation", () => {
    test("moves a day across month boundaries", () => {
      story(
        update,
        given({
          ...initialModel,
          calendar: {
            ...initialModel.calendar,
            activeDateRange: ActiveDate.Model.Day({ date: Calendar.make(2024, 2, 29) }),
          },
        }),
        message(calendarMessage(CalendarPageMessage.Message.SelectedNextDateRange())),
        resolveCalendarPreparation,
        model((nextModel) => {
          expect(nextModel.calendar.activeDateRange).toEqual(
            ActiveDate.Model.Day({ date: Calendar.make(2024, 3, 1) }),
          );
        }),
        message(calendarMessage(CalendarPageMessage.Message.SelectedPreviousDateRange())),
        resolveCalendarPreparation,
        model((nextModel) => {
          expect(nextModel.calendar.activeDateRange).toEqual(
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
          calendar: {
            ...initialModel.calendar,
            activeDateRange: ActiveDate.Model.Week({ startDate: Calendar.make(2024, 12, 30) }),
          },
        }),
        message(calendarMessage(CalendarPageMessage.Message.SelectedNextDateRange())),
        resolveCalendarPreparation,
        model((nextModel) => {
          expect(nextModel.calendar.activeDateRange).toEqual(
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
          calendar: {
            ...initialModel.calendar,
            activeDateRange: ActiveDate.Model.Month({ startDate: Calendar.make(2024, 12, 1) }),
          },
        }),
        message(calendarMessage(CalendarPageMessage.Message.SelectedNextDateRange())),
        resolveCalendarPreparation,
        model((nextModel) => {
          expect(nextModel.calendar.activeDateRange).toEqual(
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
          calendar: {
            ...initialModel.calendar,
            activeDateRange: ActiveDate.Model.Week({ startDate: Calendar.make(2020, 1, 6) }),
          },
        }),
        message(calendarMessage(CalendarPageMessage.Message.SelectedCurrentDateRange())),
        resolveCalendarPreparation,
        model((nextModel) => {
          expect(nextModel.calendar.activeDateRange).toEqual(
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
        message(calendarMessage(CalendarPageMessage.Message.SelectedWeekView())),
        resolveCalendarPreparation,
        model((nextModel) => {
          expect(nextModel.calendar.activeDateRange).toEqual(
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
          calendar: {
            ...initialModel.calendar,
            activeDateRange: ActiveDate.Model.Week({ startDate: Calendar.make(2024, 5, 13) }),
          },
        }),
        message(calendarMessage(CalendarPageMessage.Message.SelectedMonthView())),
        resolveCalendarPreparation,
        model((nextModel) => {
          expect(nextModel.calendar.activeDateRange).toEqual(
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
          calendar: {
            ...initialModel.calendar,
            activeDateRange: ActiveDate.Model.Month({ startDate: Calendar.make(2024, 5, 1) }),
          },
        }),
        message(Message.MediaWidthChanged({ tabletOrAbove: false })),
        model((nextModel) => {
          expect(nextModel.tabletOrAbove).toBe(false);
        }),
        Command.expectHas(CalendarPageCommand.PrepareCalendarDates),
        resolveCalendarPreparation,
        model((nextModel) => {
          expect(nextModel.calendar.activeDateRange).toEqual(
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
          expect(nextModel.calendar.activeDateRange).toEqual(initialModel.calendar.activeDateRange);
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
        message(
          Message.GotCalendarMessage({
            message: CalendarPageMessage.Message.SelectedMainMenuAction({ action: "Week" }),
          }),
        ),
        model((nextModel) => {
          expect(nextModel.menu.isOpen).toBe(false);
        }),
        Command.expectHas(Popover.FocusButton({ id: "main-menu" })),
        Command.resolve(Popover.FocusButton, Popover.Message.CompletedFocusButton()),
        Command.expectHas(CalendarPageCommand.PrepareCalendarDates),
        resolveCalendarPreparation,
        model((nextModel) => {
          expect(nextModel.calendar.activeDateRange).toEqual(
            ActiveDate.Model.Week({ startDate: Calendar.make(2024, 5, 13) }),
          );
        }),
      );
    });
  });
});
