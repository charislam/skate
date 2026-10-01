import { Dialog, Popover } from "@foldkit/ui";
import { DateTime, HashMap, Option, Result } from "effect";
import { Calendar } from "foldkit";
import {
  Command,
  Mount,
  click,
  expect,
  given,
  role,
  scene,
  selector,
  text,
  type,
} from "foldkit/scene";
import { describe, test } from "vitest";

import { ActiveDate, Theme } from "./domain";
import * as CalendarCache from "./domain/calendar-cache";
import * as CalendarPageMessage from "./page/calendar/message";
import * as CalendarPageCommand from "./page/calendar/command";
import { Calendar as CalendarDomain } from "./domain/calendar";
import { AdminAccess, PermissionError } from "./domain/admin-access";
import { UserId } from "./domain/session";
import { type Model } from "./model";
import { Toast } from "./toast";
import { AppRoute, LoggedOutRoute } from "./route";
import * as Login from "./page/login/model";
import { Message as LoginMessage } from "./page/login/message";
import { SignInWithPassword } from "./page/login/update";
import * as Admin from "./page/admin/model";
import { update, view } from "./main";

const today = Calendar.make(2024, 5, 17);

const modelWith = (
  activeDateRange: ActiveDate.Model,
  route: typeof LoggedOutRoute.Type = AppRoute.Home(),
): Model => ({
  _tag: "LoggedOut",
  route,
  calendar: {
    today,
    pageVisible: true,
    activeDateRange,
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
});

const acknowledgeAnchor = Mount.resolve(
  Popover.AnchorPopover,
  Popover.Message.CompletedAnchorPopover(),
);
const acknowledgeBackdrop = Mount.resolve(
  Popover.PortalPopoverBackdrop,
  Popover.Message.CompletedPortalPopoverBackdrop(),
);
const resolveCalendarPreparation = Command.resolve(
  CalendarPageCommand.PrepareCalendarDates,
  CalendarPageMessage.Message.PreparedCalendarDates({
    dates: [],
    now: 0,
    force: false,
    origin: "automatic",
  }),
);

describe("view", () => {
  const calendar = ActiveDate.Model.Week({ startDate: Calendar.make(2024, 5, 13) });
  const admin: Model = {
    ...modelWith(calendar),
    _tag: "LoggedIn",
    route: AppRoute.Admin({ section: "Overview" }),
    adminModel: {
      ...Admin.init(),
      adminAccess: AdminAccess.Success({ data: true }),
    },
    session: { userId: UserId.make("user-1"), email: Option.none() },
  };

  test.each([
    ["allowed", AdminAccess.Success({ data: true }), true],
    ["denied", AdminAccess.Success({ data: false }), false],
    ["loading", AdminAccess.Loading(), false],
    ["refreshing", AdminAccess.Refreshing({ data: true }), true],
    [
      "failed refresh",
      AdminAccess.Stale({ data: true, error: new PermissionError({ message: "Unavailable" }) }),
      true,
    ],
  ] as const)("admin navigation is permission gated when %s", (_, adminAccess, allowed) => {
    scene(
      { update, view },
      given({ ...admin, route: AppRoute.Home(), adminModel: { ...admin.adminModel, adminAccess } }),
      click(role("button", { name: "Main menu" })),
      acknowledgeAnchor,
      acknowledgeBackdrop,
      allowed
        ? expect(role("link", { name: "Admin" })).toExist()
        : expect(role("link", { name: "Admin" })).not.toExist(),
      expect(role("button", { name: "Sign out" })).toExist(),
    );
  });

  test("admin content stays mounted during permission revalidation", () => {
    scene(
      { update, view },
      given({
        ...admin,
        adminModel: { ...admin.adminModel, adminAccess: AdminAccess.Refreshing({ data: true }) },
      }),
      expect(role("heading", { name: "Admin" })).toExist(),
      expect(role("region", { name: "Overview content" })).toExist(),
    );
  });

  test("tablet admin navigation is a sidebar with the active section", () => {
    scene(
      { update, view },
      given({ ...admin, route: AppRoute.Admin({ section: "Sources" }) }),
      expect(role("navigation", { name: "Admin navigation" })).toExist(),
      expect(role("link", { name: "Sources" })).toHaveAttr("aria-current", "page"),
      expect(role("link", { name: "Overview" })).toHaveAttr("href", "/admin"),
      expect(role("region", { name: "Sources content" })).toExist(),
      expect(role("button", { name: "Sources" })).not.toExist(),
    );
  });

  test("below tablet admin navigation opens as a disclosure", () => {
    scene(
      { update, view },
      given({ ...admin, tabletOrAbove: false }),
      expect(role("button", { name: "Overview" })).toHaveAttr("aria-expanded", "false"),
      expect(selector('[aria-hidden="true"] #admin-navigation-panel')).toExist(),
      click(role("button", { name: "Overview" })),
      expect(role("button", { name: "Overview" })).toHaveAttr("aria-expanded", "true"),
      expect(role("navigation", { name: "Admin navigation" })).toExist(),
      expect(selector('[aria-hidden="true"] #admin-navigation-panel')).not.toExist(),
      expect(role("link", { name: "Sources" })).toHaveAttr("href", "/admin/sources"),
      click(role("button", { name: "Overview" })),
      expect(selector('[aria-hidden="true"] #admin-navigation-panel')).toExist(),
    );
  });

  test.each([
    ["login", modelWith(calendar, AppRoute.Login())],
    ["admin", admin],
    ["not found", modelWith(calendar, AppRoute.NotFound({ path: "/missing" }))],
  ])("the %s page shares the brand and theme menu without calendar controls", (_, model) => {
    scene(
      { update, view },
      given(model),
      expect(role("heading", { name: "skate" })).toExist(),
      expect(role("main")).toExist(),
      expect(role("button", { name: "Next week" })).not.toExist(),
      expect(role("button", { name: "Showing all" })).not.toExist(),
      click(role("button", { name: "Main menu" })),
      acknowledgeAnchor,
      acknowledgeBackdrop,
      expect(role("group", { name: "Theme" })).toExist(),
      expect(role("group", { name: "View" })).not.toExist(),
      click(role("button", { name: "Dark" })),
      expect(role("button", { name: "Main menu" })).toHaveAttr("aria-expanded", "false"),
      Mount.expectEnded(Popover.AnchorPopover, Popover.PortalPopoverBackdrop),
      Command.expectHas(
        Theme.ResolveTheme({ userTheme: Option.some("dark"), systemTheme: "light" }),
      ),
      Command.expectHas(Theme.SaveUserTheme({ theme: Option.some("dark") })),
      Command.resolve(Popover.FocusButton, Popover.Message.CompletedFocusButton()),
      Command.resolve(Theme.ResolveTheme, Theme.Message.CompletedResolveTheme()),
      Command.resolve(Theme.SaveUserTheme, Theme.Message.CompletedSaveUserTheme()),
      click(role("button", { name: "Main menu" })),
      acknowledgeAnchor,
      acknowledgeBackdrop,
      expect(role("button", { name: "Dark" })).toBeDisabled(),
    );
  });

  test("the login page keeps its live alert mounted before and after an error", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Day({ date: today }), AppRoute.Login())),
      expect(text("Email")).toExist(),
      expect(role("alert")).toExist(),
      type('input[type="email"]', "person@example.com"),
      type('input[type="password"]', "secret123"),
      click(role("button", { name: "Sign in" })),
      Command.expectHas(SignInWithPassword),
      Command.resolve(
        SignInWithPassword,
        LoginMessage.FailedSignIn({ kind: "InvalidCredentials" }),
      ),
      expect(role("alert")).toHaveText("The email or password is incorrect."),
    );
  });

  test("the day view shows the date and accessible navigation buttons", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Day({ date: today }))),
      expect(role("heading", { name: "skate" })).toExist(),
      expect(text("17")).toExist(),
      expect(text("May")).toExist(),
      expect(text("Friday")).toExist(),
      expect(role("button", { name: "Previous day" })).toExist(),
      expect(role("button", { name: "Next day" })).toExist(),
      expect(role("button", { name: "Main menu" })).toExist(),
    );
  });

  test("selecting a navigation link closes the menu and navigates", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Day({ date: today }))),
      click(role("button", { name: "Main menu" })),
      acknowledgeAnchor,
      acknowledgeBackdrop,
      expect(role("link", { name: "Sign in" })).toExist(),
      expect(role("link", { name: "Home" })).not.toExist(),
      click(role("link", { name: "Sign in" })),
      expect(role("button", { name: "Main menu" })).toHaveAttr("aria-expanded", "false"),
      Mount.expectEnded(Popover.AnchorPopover, Popover.PortalPopoverBackdrop),
      Command.expectHas(Popover.FocusButton({ id: "main-menu" })),
      Command.resolve(Popover.FocusButton, Popover.Message.CompletedFocusButton()),
    );
  });

  test.each(["Day", "Week", "Month"] as const)(
    "selecting %s in the main menu closes the popover and changes the view",
    (action) => {
      const range =
        action === "Day"
          ? ActiveDate.Model.Week({ startDate: Calendar.make(2024, 5, 13) })
          : ActiveDate.Model.Day({ date: today });

      scene(
        { update, view },
        given(modelWith(range)),
        click(role("button", { name: "Main menu" })),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        click(role("button", { name: action })),
        expect(role("button", { name: "Main menu" })).toHaveAttr("aria-expanded", "false"),
        Mount.expectEnded(Popover.AnchorPopover, Popover.PortalPopoverBackdrop),
        Command.expectHas(Popover.FocusButton({ id: "main-menu" })),
        Command.resolve(Popover.FocusButton, Popover.Message.CompletedFocusButton()),
        Command.expectHas(CalendarPageCommand.PrepareCalendarDates),
        resolveCalendarPreparation,
        click(role("button", { name: "Main menu" })),
        acknowledgeAnchor,
        acknowledgeBackdrop,
        expect(role("button", { name: action })).toHaveAttr("aria-pressed", "true"),
      );
    },
  );

  test("day navigation updates the rendered date", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Day({ date: today }))),
      click(role("button", { name: "Next day" })),
      resolveCalendarPreparation,
      expect(text("18")).toExist(),
      expect(text("Saturday")).toExist(),
      click(role("button", { name: "Previous day" })),
      resolveCalendarPreparation,
      expect(text("17")).toExist(),
    );
  });

  test("a past day shows the action to return to today", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Day({ date: Calendar.make(2024, 5, 16) }))),
      expect(role("button", { name: /Go to today/ })).toExist(),
      click(role("button", { name: /Go to today/ })),
      resolveCalendarPreparation,
      expect(text("17")).toExist(),
      expect(role("button", { name: /Go to today/ })).not.toExist(),
    );
  });

  test("the week view lists each day and changes its displayed range", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Week({ startDate: Calendar.make(2024, 5, 13) }))),
      expect(text("Mon 13")).toExist(),
      expect(text("Tue 14")).toExist(),
      expect(text("Wed 15")).toExist(),
      expect(text("Thu 16")).toExist(),
      expect(text("Fri 17")).toExist(),
      expect(text("Sat 18")).toExist(),
      expect(text("Sun 19")).toExist(),
      click(role("button", { name: "Next week" })),
      resolveCalendarPreparation,
      expect(text("Mon 20")).toExist(),
      expect(text("May 20-26")).toExist(),
    );
  });

  test("week headings stay explicit across a year boundary", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Week({ startDate: Calendar.make(2024, 12, 30) }))),
      expect(text("December 30 – January 5, 2024 – 2025")).toExist(),
    );
  });

  test("the month view shows its month and year and navigates forward", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Month({ startDate: Calendar.make(2024, 5, 1) }))),
      expect(text("May 2024")).toExist(),
      expect(role("button", { name: "Previous month" })).toExist(),
      click(role("button", { name: "Next month" })),
      resolveCalendarPreparation,
      expect(text("June 2024")).toExist(),
      click(role("button", { name: "Previous month" })),
      resolveCalendarPreparation,
      expect(text("May 2024")).toExist(),
    );
  });

  test("session actions open an accessible menu with details and a protected rink link", () => {
    const calendarDate = Calendar.make(2024, 5, 17);
    const requested = CalendarCache.cacheVisible(CalendarCache.init(), {
      dates: [calendarDate],
      now: 1,
    });
    const request = requested.requests[0];
    if (!request) throw new Error("Expected the visible day to be requested");

    const calendarCache = CalendarCache.settleDay(requested.model, {
      ...request,
      now: 2,
      result: Result.succeed([
        {
          id: CalendarDomain.SessionId.make("9223372036854775000"),
          start: DateTime.makeZonedUnsafe(
            { year: 2024, month: 5, day: 17, hour: 10 },
            { timeZone: "America/Toronto", adjustForTimeZone: true },
          ),
          end: DateTime.makeZonedUnsafe(
            { year: 2024, month: 5, day: 17, hour: 11 },
            { timeZone: "America/Toronto", adjustForTimeZone: true },
          ),
          raw_start: "2024-05-17 10:00:00",
          raw_end: "2024-05-17 11:00:00",
          audience: "general",
          is_cancelled: false,
          certainty: "certain",
          rink_id: "7",
          rink_name: "Central rink",
          rink_address: null,
          rink_url: Option.some("https://example.com/rink"),
        },
      ]),
    });

    scene(
      { update, view },
      given({
        ...modelWith(ActiveDate.Model.Day({ date: Calendar.make(2024, 5, 17) })),
        calendar: {
          ...modelWith(ActiveDate.Model.Day({ date: Calendar.make(2024, 5, 17) })).calendar,
          calendarCache,
        },
      }),
      click(role("button", { name: "Actions for Central rink 10:00 AM" })),
      Mount.resolve(Popover.AnchorPopover, Popover.Message.CompletedAnchorPopover()),
      Mount.resolve(
        Popover.PortalPopoverBackdrop,
        Popover.Message.CompletedPortalPopoverBackdrop(),
      ),
      expect(role("button", { name: "View details" })).toExist(),
      expect(role("link", { name: "Open rink website" })).toHaveAttr("rel", "noopener noreferrer"),
    );
  });

  test("opens the first day dialog from the month view", () => {
    const date = Calendar.make(2024, 5, 17);

    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Month({ startDate: Calendar.make(2024, 5, 1) }))),
      expect(selector("#calendar-day")).toExist(),
      click(text(date.day.toString())),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      resolveCalendarPreparation,
      expect(role("button", { name: "Refresh day" })).toExist(),
    );
  });

  test("the theme switcher keeps the chosen theme selected", () => {
    const model = modelWith(ActiveDate.Model.Day({ date: today }));

    scene(
      { update, view },
      given(model),
      expect(role("button", { name: "Dark" })).not.toExist(),
      click(role("button", { name: "Main menu" })),
      acknowledgeAnchor,
      acknowledgeBackdrop,
      expect(role("button", { name: "Dark" })).toExist(),
      click(role("button", { name: "Dark" })),
      expect(role("button", { name: "Main menu" })).toHaveAttr("aria-expanded", "false"),
      expect(role("button", { name: "Dark" })).not.toExist(),
      Mount.expectEnded(Popover.AnchorPopover, Popover.PortalPopoverBackdrop),
      Command.expectHas(Popover.FocusButton({ id: "main-menu" })),
      Command.resolve(Popover.FocusButton, Popover.Message.CompletedFocusButton()),
      Command.expectHas(
        Theme.ResolveTheme({ userTheme: Option.some("dark"), systemTheme: "light" }),
      ),
      Command.expectHas(Theme.SaveUserTheme({ theme: Option.some("dark") })),
      Command.resolve(Theme.ResolveTheme, Theme.Message.CompletedResolveTheme()),
      Command.resolve(Theme.SaveUserTheme, Theme.Message.CompletedSaveUserTheme()),
      click(role("button", { name: "Main menu" })),
      acknowledgeAnchor,
      acknowledgeBackdrop,
      Command.expectNone(),
      expect(role("button", { name: "Dark" })).toBeDisabled(),
      expect(role("button", { name: "Light" })).not.toBeDisabled(),
      click(role("button", { name: "System" })),
      expect(role("button", { name: "Main menu" })).toHaveAttr("aria-expanded", "false"),
      Mount.expectEnded(Popover.AnchorPopover, Popover.PortalPopoverBackdrop),
      Command.expectHas(Popover.FocusButton({ id: "main-menu" })),
      Command.resolve(Popover.FocusButton, Popover.Message.CompletedFocusButton()),
      Command.expectHas(Theme.ResolveTheme({ userTheme: Option.none(), systemTheme: "light" })),
      Command.expectHas(Theme.SaveUserTheme({ theme: Option.none() })),
      Command.resolve(Theme.ResolveTheme, Theme.Message.CompletedResolveTheme()),
      Command.resolve(Theme.SaveUserTheme, Theme.Message.CompletedSaveUserTheme()),
      click(role("button", { name: "Main menu" })),
      acknowledgeAnchor,
      acknowledgeBackdrop,
      Command.expectNone(),
      expect(role("button", { name: "System" })).toBeDisabled(),
      expect(role("button", { name: "Dark" })).not.toBeDisabled(),
    );
  });

  test("mobile calendar controls offer only the Day view and retain Refresh", () => {
    scene(
      { update, view },
      given({ ...modelWith(ActiveDate.Model.Day({ date: today })), tabletOrAbove: false }),
      click(role("button", { name: "Main menu" })),
      acknowledgeAnchor,
      acknowledgeBackdrop,
      expect(role("button", { name: "Day" })).toExist(),
      expect(role("button", { name: "Week" })).not.toExist(),
      expect(role("button", { name: "Month" })).not.toExist(),
      expect(role("button", { name: "Refresh" })).toExist(),
    );
  });

  test("an unknown route renders the requested path", () => {
    scene(
      { update, view },
      given(
        modelWith(ActiveDate.Model.Day({ date: today }), AppRoute.NotFound({ path: "/missing" })),
      ),
      expect(role("heading", { name: "Page not found: /missing" })).toExist(),
    );
  });
});
