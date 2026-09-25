import { Popover } from "@foldkit/ui";
import { Option } from "effect";
import { Calendar } from "foldkit";
import { Command, Mount, click, expect, given, role, scene, text, type } from "foldkit/scene";
import { describe, test } from "vitest";

import { ActiveDate, Theme } from "./domain";
import { type Model } from "./model";
import { AppRoute, LoggedOutRoute } from "./route";
import * as Login from "./page/login/model";
import { Message as LoginMessage } from "./page/login/message";
import { SignInWithPassword } from "./page/login/update";
import { update, view } from "./main";

const today = Calendar.make(2024, 5, 17);

const modelWith = (
  activeDateRange: ActiveDate.Model,
  route: typeof LoggedOutRoute.Type = AppRoute.Home(),
): Model => ({
  _tag: "LoggedOut",
  route,
  today,
  activeDateRange,
  menu: Popover.init({ id: "main-menu", contentFocus: true }),
  theme: { userTheme: Option.none(), systemTheme: "light" },
  tabletOrAbove: true,
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

describe("view", () => {
  test("the login page keeps its live alert mounted before and after an error", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Day({ date: today }), AppRoute.Login())),
      expect(role("heading", { name: "Sign in" })).toExist(),
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

  test("day navigation updates the rendered date", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Day({ date: today }))),
      click(role("button", { name: "Next day" })),
      expect(text("18")).toExist(),
      expect(text("Saturday")).toExist(),
      click(role("button", { name: "Previous day" })),
      expect(text("17")).toExist(),
    );
  });

  test("a past day shows the action to return to today", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Day({ date: Calendar.make(2024, 5, 16) }))),
      expect(role("button", { name: /Go to today/ })).toExist(),
      click(role("button", { name: /Go to today/ })),
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
      expect(text("Mon 20")).toExist(),
      expect(text("May 20-26")).toExist(),
    );
  });

  test("the month view shows its month and year and navigates forward", () => {
    scene(
      { update, view },
      given(modelWith(ActiveDate.Model.Month({ startDate: Calendar.make(2024, 5, 1) }))),
      expect(text("May 2024")).toExist(),
      expect(role("button", { name: "Previous month" })).toExist(),
      click(role("button", { name: "Next month" })),
      expect(text("June 2024")).toExist(),
      click(role("button", { name: "Previous month" })),
      expect(text("May 2024")).toExist(),
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
      Command.resolve(Theme.ResolveTheme, Theme.Message.CompletedResolveTheme()),
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
      Command.resolve(Theme.ResolveTheme, Theme.Message.CompletedResolveTheme()),
      click(role("button", { name: "Main menu" })),
      acknowledgeAnchor,
      acknowledgeBackdrop,
      Command.expectNone(),
      expect(role("button", { name: "System" })).toBeDisabled(),
      expect(role("button", { name: "Dark" })).not.toBeDisabled(),
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
