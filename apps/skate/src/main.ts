import { Popover } from "@foldkit/ui";
import { cn } from "cn";
import { Console, Effect, Equal, Match, Option, Schema, Stream } from "effect";
import { Calendar, Command as FoldkitCommand, type Runtime, Subscription, Update } from "foldkit";
import { Machine } from "foldkit/experimental";
import type { Document, HtmlBuilder } from "foldkit/html";
import { UrlRequest } from "foldkit/navigation";
import { evo } from "foldkit/struct";
import { toString as urlToString } from "foldkit/url";
import {
  Command,
  LoadExternal,
  NavigateInternal,
  RedirectForAuthentication,
  SignOut,
} from "./command";
import { ActiveDate, MainMenu, Theme } from "./domain";
import { Auth } from "./domain/auth";
import { Session } from "./domain/session";
import { Message } from "./message";
import { LoggedInModel, LoggedOutModel, type Model } from "./model";
import {
  AppRoute,
  type LoggedInRoute,
  type LoggedOutRoute,
  type RedirectDestination,
  guardLoggedInRoute,
  guardLoggedOutRoute,
  urlToAppRoute,
} from "./route";
import { MainMenuView, WeekMonthSelector } from "./view";
import * as Login from "./page/login/model";
import * as LoginMessage from "./page/login/message";
import { type Input as LoginInput, update as updateLogin } from "./page/login/update";
import { view as loginView } from "./page/login/view";

// FLAGS

export const Flags = Schema.Struct({
  today: Calendar.CalendarDate,
  theme: Theme.Theme_,
  tabletOrAbove: Schema.Boolean,
  maybeSession: Schema.Option(Session),
});

export type Flags = typeof Flags.Type;

export const flags = Effect.gen(function* () {
  const today = yield* Calendar.today.local;
  const tabletOrAbove = window.matchMedia("(min-width: 1024px)").matches;
  const theme: Theme.Theme_ = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  const auth = yield* Auth.Service;
  const maybeSession = yield* auth.getSession.pipe(
    Effect.tapError((error) => Console.warn("Could not restore Supabase session:", error.message)),
    Effect.catch(() => Effect.succeed(Option.none())),
  );
  return { today, tabletOrAbove, theme, maybeSession };
});

// UPDATE

const foldActiveDate = Machine.fold({
  machine: ActiveDate.machine,
  context: (model: Model) => ({ today: model.today }),
  read: (model: Model) => Option.some(model.activeDateRange),
  write: (model: Model, nextActiveDateRange: ActiveDate.Model) =>
    evo(model, {
      activeDateRange: () => nextActiveDateRange,
    }),
});

const foldTheme = Update.foldChild({
  update: Theme.update,
  read: (model: Model) => Option.some(model.theme),
  write: (model, nextTheme) => evo(model, { theme: () => nextTheme }),
  toParentMessage: (message) => Message.GotThemeMessage({ message }),
});

const foldThemeSet = Update.foldChild({
  update: Theme.setTheme,
  read: (model: Model) => Option.some(model.theme),
  write: (model, nextTheme) => evo(model, { theme: () => nextTheme }),
  toParentMessage: (message) => Message.GotThemeMessage({ message }),
});

const foldPopoverOutMessage = Popover.OutMessage.match<Update.Step<Model, Message>>({
  Opened: () => (model) => ({ model }),
  Closed: () => (model) => ({ model }),
});

const foldPopover = Update.foldChild({
  update: MainMenu.Popover.update,
  read: (model: Model) => Option.some(model.menu),
  write: (model, nextMenu) => evo(model, { menu: () => nextMenu }),
  toParentMessage: (message) => Message.GotPopoverMessage({ message }),
  foldOutMessage: foldPopoverOutMessage,
});

const foldPopoverClose = Update.foldChildStep({
  update: Popover.close,
  read: (model: Model) => Option.some(model.menu),
  write: (model, nextMenu) => evo(model, { menu: () => nextMenu }),
  toParentMessage: (message) => Message.GotPopoverMessage({ message }),
  foldOutMessage: foldPopoverOutMessage,
});

const foldLogin = Update.foldChild({
  update: (model, input: LoginInput) => updateLogin(model, input.message, input.context),
  read: (model: Model) =>
    model._tag === "LoggedOut" ? Option.some(model.loginModel) : Option.none(),
  write: (model, nextLoginModel) =>
    model._tag === "LoggedOut" ? evo(model, { loginModel: () => nextLoginModel }) : model,
  toParentMessage: (message) => Message.GotLoginMessage({ message }),
  foldOutMessage: LoginMessage.OutMessage.match<Update.Step<Model, Message>>({
    SucceededLogin:
      ({ session }) =>
      (model) => ({
        model: makeLoggedIn(model, session),
        commands: [RedirectForAuthentication({ destination: "Home" })],
      }),
  }),
});

export const update = (model: Model, message: Message) =>
  Match.value(message).pipe(
    Match.withReturnType<Update.Return<Model, Message, Auth.Service>>(),
    Match.tag("CompletedNavigateInternal", "CompletedLoadExternal", "CompletedRedirect", () => ({
      model,
    })),
    Match.tag("SucceededSignOut", () => ({
      model: makeLoggedOut(model, AppRoute.Home()),
      commands: [RedirectForAuthentication({ destination: "Home" })],
    })),
    Match.tag("FailedSignOut", ({ kind }) =>
      model._tag === "LoggedIn"
        ? {
            model: evo(model, {
              maybeSignOutError: () => Option.some(Auth.messageForOperation(kind, "signOut")),
            }),
          }
        : { model },
    ),
    Match.tag("ClickedLink", ({ request }) =>
      UrlRequest.match<Update.Return<Model, Message, Auth.Service>>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [NavigateInternal({ url: urlToString(url) })],
        }),
        External: ({ href }) => ({ model, commands: [LoadExternal({ href })] }),
      }),
    ),
    Match.tag("ChangedUrl", ({ url }) => {
      const route = urlToAppRoute(url);
      return model._tag === "LoggedOut"
        ? updateLoggedOutRoute(model, route)
        : updateLoggedInRoute(model, route);
    }),
    Match.tag("GotLoginMessage", ({ message }) =>
      foldLogin(model, { message, context: { route: model.route } }),
    ),
    Match.tag("ClickedLogout", () =>
      model._tag === "LoggedIn"
        ? { model: evo(model, { maybeSignOutError: () => Option.none() }), commands: [SignOut()] }
        : { model },
    ),
    Match.tag("AuthStateChanged", ({ maybeSession }) =>
      Option.match(maybeSession, {
        onNone: () =>
          model._tag === "LoggedOut" ? { model } : updateLoggedOutRoute(model, model.route),
        onSome: (session) =>
          model._tag === "LoggedIn" && Equal.equals(model.session, session)
            ? { model }
            : updateLoggedInSession(model, session),
      }),
    ),
    Match.tag(
      "SelectedNextDateRange",
      "SelectedPreviousDateRange",
      "SelectedCurrentDateRange",
      "SelectedDayView",
      "SelectedWeekView",
      "SelectedMonthView",
      "SyncedInitialDate",
      (activeDateMessage) => foldActiveDate(model, activeDateMessage),
    ),
    Match.tag("MediaWidthChanged", ({ tabletOrAbove }) => ({
      model: evo(model, { tabletOrAbove: () => tabletOrAbove }),
      ...(tabletOrAbove ? {} : { commands: [Command.SelectDayView()] }),
    })),
    Match.tag("GotPopoverMessage", ({ message }) => foldPopover(model, message)),
    Match.tag("GotThemeMessage", ({ message }) => foldTheme(model, message)),
    Match.tag("SelectedTheme", ({ theme }) =>
      Update.combine(model, [
        foldPopoverClose,
        (currentModel) => foldThemeSet(currentModel, theme),
      ]),
    ),
    Match.tag("SelectedMainMenuAction", ({ action }) =>
      Update.combine(model, [
        foldPopoverClose,
        (currentModel) => ({
          model: currentModel,
          commands: [
            Match.value(action).pipe(
              Match.when("Day", () => Command.SelectDayView()),
              Match.when("Week", () => Command.SelectWeekView()),
              Match.when("Month", () => Command.SelectMonthView()),
              Match.exhaustive,
            ),
          ],
        }),
      ]),
    ),
    Match.exhaustive,
  );

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message, Auth.Service>()((entry) => ({
  mediaWidth: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Stream.unwrap(
          Effect.sync(() => {
            const mediaQuery = window.matchMedia("(min-width: 1024px)");

            return Subscription.fromEvent<MediaQueryListEvent, Message>({
              target: mediaQuery,
              type: "change",
              toMessage: (event) => Message.MediaWidthChanged({ tabletOrAbove: event.matches }),
            });
          }),
        ),
    },
  ),
  authState: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Stream.unwrap(
          Effect.gen(function* () {
            const auth = yield* Auth.Service;
            return Stream.map(auth.authStateChanges, ({ maybeSession }) =>
              Message.AuthStateChanged({ maybeSession }),
            );
          }),
        ),
    },
  ),
}));

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  if (model.route._tag === "NotFound") {
    return {
      title: "skate.to",
      body: h.main([h.Class("p-8")], [h.h1([], [`Page not found: ${model.route.path}`])]),
    };
  }

  if (model.route._tag === "Login") {
    return {
      title: "Sign in · skate.to",
      body:
        model._tag === "LoggedOut"
          ? h.submodel({
              slotId: "login",
              model: model.loginModel,
              view: loginView,
              toParentMessage: (message) => Message.GotLoginMessage({ message }),
            })
          : h.empty,
    };
  }

  if (model.route._tag === "Admin") {
    return {
      title: "Admin · skate.to",
      body: h.main(
        [h.Class("p-8")],
        [
          h.h1([h.Class("text-3xl")], ["Admin"]),
          h.p(
            [],
            [
              model._tag === "LoggedIn"
                ? Option.match(model.session.email, {
                    onNone: () => "Signed in",
                    onSome: (email) => `Signed in as ${email}`,
                  })
                : "",
            ],
          ),
          model._tag === "LoggedIn"
            ? h.p(
                [h.Role("alert"), h.AriaLive("assertive")],
                [
                  Option.match(model.maybeSignOutError, {
                    onNone: () => "",
                    onSome: (error) => error,
                  }),
                ],
              )
            : h.empty,
          h.button([h.OnClick(Message.ClickedLogout())], ["Sign out"]),
        ],
      ),
    };
  }

  const isDayView = model.activeDateRange._tag === "Day";

  return {
    title: "skate.to",
    body: h.div(
      [
        h.Class(
          cn(
            "h-screen mx-auto px-4 xl:px-12 py-6 flex flex-col gap-8 lg:gap-12 bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100",
            isDayView && "max-w-xl",
          ),
        ),
      ],
      [
        h.div(
          [h.Class("flex gap-2 justify-between items-baseline")],
          [
            h.hgroup(
              [h.Class("flex items-baseline")],
              [
                h.h1([h.Class("text-4xl")], ["skate"]),
                h.p(
                  [h.Class("text-sm text-slate-800 dark:text-slate-300 translate-y-1/4")],
                  ["TO"],
                ),
              ],
            ),
            Match.value(model.activeDateRange).pipe(
              Match.tags({
                Week: ({ startDate }) =>
                  WeekMonthSelector.selector({ granularity: "Week", startDate }, h),
                Month: ({ startDate }) =>
                  WeekMonthSelector.selector({ granularity: "Month", startDate }, h),
              }),
              Match.orElse(() => null),
            ),
          ],
        ),
        h.main(
          [h.Class("flex-1")],
          Match.value(model.activeDateRange).pipe(
            Match.tagsExhaustive({
              Initial: () => [],
              Day: ({ date }) => [
                h.div(
                  [h.Class("flex gap-2 justify-between")],
                  [
                    h.h2(
                      [h.Class("flex gap-2")],
                      [
                        h.span([h.Class("text-6xl")], [date.day.toString()]),
                        h.span(
                          [h.Class("py-2 flex flex-col justify-between")],
                          [
                            h.span(
                              [h.Class("uppercase text-sm text-slate-600 dark:text-slate-400")],
                              [
                                Option.match(ActiveDate.formatMonth({ format: "short" }, date), {
                                  onSome: (month) => month,
                                  onNone: () => "",
                                }),
                              ],
                            ),
                            h.span(
                              [
                                h.Class(
                                  "text-slate-600 dark:text-slate-400 font-light tracking-wide",
                                ),
                              ],
                              [Calendar.dayOfWeek(date)],
                            ),
                          ],
                        ),
                      ],
                    ),
                    h.div(
                      [h.Class("flex gap-4")],
                      [
                        h.button(
                          [
                            h.Class(
                              "flex items-center text-4xl text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800",
                            ),
                            h.OnClick(Message.SelectedPreviousDateRange()),
                          ],
                          [
                            h.span([h.Class("sr-only")], ["Previous day"]),
                            h.span([h.AriaHidden(true), h.InnerHTML("&#8826;")]),
                          ],
                        ),
                        h.button(
                          [
                            h.Class(
                              "flex items-center text-4xl text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800",
                            ),
                            h.OnClick(Message.SelectedNextDateRange()),
                          ],
                          [
                            h.span([h.Class("sr-only")], ["Next day"]),
                            h.span([h.AriaHidden(true), h.InnerHTML("&#8827;")]),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ],
              Week: ({ startDate }) => [
                h.div(
                  [h.Class("flex flex-col gap-2")],
                  [
                    h.div(
                      [h.Class("grid grid-cols-7 gap-2")],
                      [
                        ...ActiveDate.DAYS_OF_WEEK.map((dayOfWeek, index) =>
                          h.keyed("div")(
                            dayOfWeek,
                            [h.Class("text-md tracking-wide")],
                            [`${dayOfWeek.slice(0, 3)} ${Calendar.addDays(startDate, index).day}`],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ],
              Month: () => [],
            }),
          ),
        ),
        h.footer(
          [h.Class("flex gap-2 justify-between items-baseline")],
          [
            h.div(
              [h.Class("flex divide-x-2 divide-slate-300 dark:divide-slate-700")],
              [
                h.button(
                  [
                    h.Class(
                      "px-2 text-sm text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800",
                    ),
                  ],
                  ["Showing all"],
                ),
                ActiveDate.isDateRangeCurrent(model.activeDateRange, model.today)
                  ? null
                  : h.button(
                      [
                        h.Class(
                          "px-2 text-sm text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800",
                        ),
                        h.OnClick(Message.SelectedCurrentDateRange()),
                      ],
                      ["Go to today →"],
                    ),
              ],
            ),
            MainMenuView.view(model, h),
          ],
        ),
      ],
    ),
  };
};

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message, Flags> = (flags: Flags, url) => {
  const themeBoot = Theme.boot({ systemTheme: flags.theme });
  const route = urlToAppRoute(url);
  const common = {
    today: flags.today,
    activeDateRange: ActiveDate.machine.initial,
    menu: Popover.init({ id: "main-menu", contentFocus: true }),
    theme: themeBoot.model,
    tabletOrAbove: flags.tabletOrAbove,
  };
  const initial = Option.match(flags.maybeSession, {
    onNone: () => {
      const access = guardLoggedOutRoute(route);
      return {
        model: makeLoggedOut(common, access.route),
        commands: routeRedirectCommands(access.maybeRedirect),
      };
    },
    onSome: (session) => {
      const access = guardLoggedInRoute(route);
      return {
        model: makeLoggedIn(common, session, access.route),
        commands: routeRedirectCommands(access.maybeRedirect),
      };
    },
  });
  return {
    model: initial.model,
    commands: [
      ...initial.commands,
      ...FoldkitCommand.mapMessages(themeBoot.commands, (message) =>
        Message.GotThemeMessage({ message }),
      ),
      Command.SyncInitialDate({ today: flags.today }),
    ],
  };
};

type HomeState = Pick<Model, "today" | "activeDateRange" | "menu" | "theme" | "tabletOrAbove"> & {
  readonly loginModel?: typeof Login.Model.Type;
};

const homeState = (model: HomeState) => ({
  today: model.today,
  activeDateRange: model.activeDateRange,
  menu: model.menu,
  theme: model.theme,
  tabletOrAbove: model.tabletOrAbove,
});

const makeLoggedOut = (model: HomeState, route: LoggedOutRoute) =>
  LoggedOutModel({
    ...homeState(model),
    route,
    loginModel: model.loginModel ?? Login.init(),
  });

const makeLoggedIn = (model: HomeState, session: Session, route: LoggedInRoute = AppRoute.Home()) =>
  LoggedInModel({
    route,
    session,
    maybeSignOutError: Option.none(),
    ...homeState(model),
  });

const routeRedirectCommands = (maybeDestination: Option.Option<RedirectDestination>) =>
  Option.match(maybeDestination, {
    onNone: () => [],
    onSome: (destination) => [RedirectForAuthentication({ destination })],
  });

const withRouteRedirect = <ResultModel>(
  model: ResultModel,
  maybeDestination: Option.Option<RedirectDestination>,
) =>
  Option.match(maybeDestination, {
    onNone: () => ({ model }),
    onSome: (destination) => ({ model, commands: [RedirectForAuthentication({ destination })] }),
  });

const updateLoggedOutRoute = (model: Model, route: AppRoute) => {
  const access = guardLoggedOutRoute(route);
  return withRouteRedirect(makeLoggedOut(model, access.route), access.maybeRedirect);
};

const updateLoggedInRoute = (
  model: Extract<Model, { readonly _tag: "LoggedIn" }>,
  route: AppRoute,
) => {
  const access = guardLoggedInRoute(route);
  return withRouteRedirect(evo(model, { route: () => access.route }), access.maybeRedirect);
};

const updateLoggedInSession = (model: Model, session: Session) => {
  const access = guardLoggedInRoute(model.route);
  return withRouteRedirect(makeLoggedIn(model, session, access.route), access.maybeRedirect);
};
