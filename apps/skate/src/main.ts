import { Popover } from "@foldkit/ui";
import { BrowserKeyValueStore } from "@effect/platform-browser";
import { Console, Effect, Match, Option, Schema, Stream } from "effect";
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
import type { Resource } from "./resource";
import { Session } from "./domain/session";
import { canAccessAdmin } from "./domain/admin-access";
import * as Admin from "./page/admin/model";
import * as AdminMessage from "./page/admin/message";
import {
  type Context as AdminContext,
  enterSection as enterAdminSectionModel,
  revalidateAccess as revalidateAdminAccess,
  update as updateAdmin,
} from "./page/admin/update";
import { headerEnd as adminHeaderEnd, view as adminView } from "./page/admin/view";
import { Message } from "./message";
import { LoggedInModel, LoggedOutModel, type Model } from "./model";
import { Toast } from "./toast";
import type { ShowInput } from "./toast";
import {
  type AdminSection,
  AppRoute,
  type LoggedInRoute,
  type LoggedOutRoute,
  type RedirectDestination,
  guardLoggedInRoute,
  guardLoggedOutRoute,
  urlToAppRoute,
} from "./route";
import { MainMenuView } from "./view";
import * as Layout from "./view/layout";
import * as CalendarView from "./view/calendar";
import * as Login from "./page/login/model";
import * as LoginMessage from "./page/login/message";
import { type Input as LoginInput, update as updateLogin } from "./page/login/update";
import { view as loginView } from "./page/login/view";
import { cn } from "cn";

// FLAGS

export const Flags = Schema.Struct({
  today: Calendar.CalendarDate,
  systemTheme: Theme.Theme_,
  maybeUserTheme: Schema.Option(Theme.Theme_),
  tabletOrAbove: Schema.Boolean,
  maybeSession: Schema.Option(Session),
});

export type Flags = typeof Flags.Type;

export const flags = Effect.gen(function* () {
  const today = yield* Calendar.today.local;
  const tabletOrAbove = window.matchMedia("(min-width: 1024px)").matches;
  const systemTheme: Theme.Theme_ = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  const maybeUserTheme = yield* Theme.loadUserTheme().pipe(
    Effect.provide(BrowserKeyValueStore.layerLocalStorage),
    Effect.catch(() => Effect.succeed(Option.none())),
  );
  const auth = yield* Auth.Service;
  const maybeSession = yield* auth.getSession.pipe(
    Effect.tapError((error) => Console.warn("Could not restore Supabase session:", error.message)),
    Effect.catch(() => Effect.succeed(Option.none())),
  );
  return { today, tabletOrAbove, systemTheme, maybeUserTheme, maybeSession };
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

const foldToast = Update.foldChild({
  update: Toast.update,
  read: (model: Model) => Option.some(model.toast),
  write: (model, toast) => evo(model, { toast: () => toast }),
  toParentMessage: (message) => Message.GotToastMessage({ message }),
  foldOutMessage: Toast.OutMessage.match<Update.Step<Model, Message>>({
    DismissedToast: () => (model) => ({ model }),
  }),
});

const foldToastShow = Update.foldChild({
  update: (toast, input: ShowInput<string>) => Toast.show(toast, input),
  read: (model: Model) => Option.some(model.toast),
  write: (model, toast) => evo(model, { toast: () => toast }),
  toParentMessage: (message) => Message.GotToastMessage({ message }),
  foldOutMessage: Toast.OutMessage.match<Update.Step<Model, Message>>({
    DismissedToast: () => (model) => ({ model }),
  }),
});

const foldLogin = Update.foldChild({
  update: (model, input: LoginInput) => updateLogin(model, input.message, input.context),
  read: (model: Model) =>
    model._tag === "LoggedOut" ? Option.some(model.loginModel) : Option.none(),
  write: (model, nextLoginModel) =>
    model._tag === "LoggedOut" ? evo(model, { loginModel: () => nextLoginModel }) : model,
  toParentMessage: (message) => Message.GotLoginMessage({ message }),
  foldOutMessage: LoginMessage.OutMessage.match<Update.Step<Model, Message, Resource>>({
    SucceededLogin:
      ({ session }) =>
      (model) =>
        updateLoggedInSession(model, session),
  }),
});

const foldAdminOutMessage = AdminMessage.OutMessage.match<Update.Step<Model, Message, Resource>>({
  RequestedLogout: () => (stepModel) => ({ model: stepModel, commands: [SignOut()] }),
  DeniedAccess: () => (stepModel) =>
    stepModel._tag === "LoggedIn" && stepModel.route._tag === "Admin"
      ? withRouteRedirect(evo(stepModel, { route: () => AppRoute.Home() }), Option.some("Home"))
      : { model: stepModel },
});

const writeAdminModel = (model: Model, nextAdminModel: Admin.Model): Model =>
  model._tag === "LoggedIn"
    ? evo(model, {
        adminModel: () => nextAdminModel,
      })
    : model;

const readAdminModel = (model: Model): Option.Option<Admin.Model> =>
  model._tag === "LoggedIn" ? Option.some(model.adminModel) : Option.none();

const adminSectionForRoute = (route: LoggedInRoute): Option.Option<AdminSection> =>
  route._tag === "Admin" ? Option.some(route.section) : Option.none();

const foldAdmin = Update.foldChild({
  update: (
    adminModel: Admin.Model,
    input: { message: AdminMessage.Message; context: AdminContext },
  ) => updateAdmin(adminModel, input.message, input.context),
  read: readAdminModel,
  write: writeAdminModel,
  toParentMessage: (message) => Message.GotAdminMessage({ message }),
  foldOutMessage: foldAdminOutMessage,
});

const foldAdminAccessRevalidation = Update.foldChild({
  update: revalidateAdminAccess,
  read: readAdminModel,
  write: writeAdminModel,
  toParentMessage: (message) => Message.GotAdminMessage({ message }),
  foldOutMessage: foldAdminOutMessage,
});

const foldAdminSectionEntry = Update.foldChild({
  update: (adminModel: Admin.Model, input: { section: AdminSection; userId: Session["userId"] }) =>
    enterAdminSectionModel(adminModel, input.section, { userId: input.userId }),
  read: readAdminModel,
  write: writeAdminModel,
  toParentMessage: (message) => Message.GotAdminMessage({ message }),
  foldOutMessage: foldAdminOutMessage,
});

export const update = (model: Model, message: Message) =>
  Match.value(message).pipe(
    Match.withReturnType<Update.Return<Model, Message, Resource>>(),
    Match.tag("CompletedNavigateInternal", "CompletedLoadExternal", "CompletedRedirect", () => ({
      model,
    })),
    Match.tag("SucceededSignOut", () => ({
      model: makeLoggedOut(model, AppRoute.Home()),
      commands: [RedirectForAuthentication({ destination: "Home" })],
    })),
    Match.tag("FailedSignOut", ({ kind }) =>
      model._tag === "LoggedIn"
        ? foldToastShow(model, {
            variant: "Error",
            payload: Auth.messageForOperation(kind, "signOut"),
          })
        : { model },
    ),
    Match.tag("ClickedLink", ({ request }) =>
      Update.combine(model, [
        foldPopoverClose,
        (currentModel) =>
          UrlRequest.match<Update.Return<Model, Message, Resource>>(request, {
            Internal: ({ url }) => ({
              model: currentModel,
              commands: [NavigateInternal({ url: urlToString(url) })],
            }),
            External: ({ href }) => ({ model: currentModel, commands: [LoadExternal({ href })] }),
          }),
      ]),
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
    Match.tag("GotToastMessage", ({ message }) => foldToast(model, message)),
    Match.tag("ClickedLogout", () =>
      model._tag === "LoggedIn" ? { model, commands: [SignOut()] } : { model },
    ),
    Match.tag("AuthStateChanged", ({ maybeSession }) =>
      Option.match(maybeSession, {
        onNone: () =>
          model._tag === "LoggedOut" ? { model } : updateLoggedOutRoute(model, model.route),
        onSome: (session) => updateLoggedInSession(model, session),
      }),
    ),
    Match.tag("GotAdminMessage", ({ message }) =>
      model._tag === "LoggedIn"
        ? foldAdmin(model, {
            message,
            context: {
              userId: model.session.userId,
              maybeAdminSection: adminSectionForRoute(model.route),
            },
          })
        : { model },
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
    Match.tag("SelectedNavigationLink", () => foldPopoverClose(model)),
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

const rootSubscriptions = Subscription.make<Model, Message, Resource>()((entry) => ({
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

const themeSubscriptions = Subscription.lift(Theme.subscriptions)<Model, Message>({
  toChildModel: (model) => model.theme,
  toParentMessage: (message) => Message.GotThemeMessage({ message }),
});

export const subscriptions = Subscription.aggregate<Model, Message, Resource>()(
  rootSubscriptions,
  themeSubscriptions,
);

// VIEW

type Page = Layout.PageSlots & { readonly title: string };

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const page = pageView(model, h);
  return {
    title: page.title,
    body: h.div(
      [],
      [
        Layout.view(
          {
            ...page,
            menu: MainMenuView.view(
              { menu: model.menu, theme: model.theme },
              {
                loggedIn: model._tag === "LoggedIn",
                navigationLinks: (model._tag === "LoggedIn"
                  ? MainMenu.navigationLinks.loggedIn
                  : MainMenu.navigationLinks.loggedOut
                ).filter(
                  ({ route }) =>
                    route !== model.route._tag &&
                    (route !== "Admin" ||
                      (model._tag === "LoggedIn" && canAccessAdmin(model.adminModel.adminAccess))),
                ),
                sections:
                  model.route._tag === "Home" && model.tabletOrAbove
                    ? [CalendarView.calendarViewSection(model.activeDateRange, h)]
                    : [],
              },
              h,
            ),
          },
          h,
        ),
        toastView(model, h),
      ],
    ),
  };
};

const toastView = (model: Model, h: HtmlBuilder<Message>) =>
  h.submodel({
    slotId: "app-toast",
    model: model.toast,
    view: Toast.view,
    viewInputs: {
      position: "BottomRight",
      entryClassName: cn(
        "w-80 max-w-9/10",
        "relative",
        "rounded-md border border-slate-400 bg-white shadow",
        "text-slate-800",
        "data-[variant=Error]:border-red-200 data-[variant=Error]:bg-red-50 data-[variant=Error]:text-red-800",
        "dark:border-slate-900 dark:bg-slate-800 dark:text-slate-200",
        "dark:data-[variant=Error]:border-red-200 dark:data-[variant=Error]:bg-slate-800 dark:data-[variant=Error]:text-red-200",
      ),
      entryToView: (entry, handlers) =>
        h.div(
          [h.Class(cn("py-2 px-3 pr-5"))],
          [
            h.span([h.Class("font-light")], [entry.payload]),
            h.button(
              [
                ...handlers.dismiss,
                h.AriaLabel("Dismiss"),
                h.Class("absolute top-0 right-2 cursor-pointer text-lg hover:text-slate-950"),
              ],
              ["x"],
            ),
          ],
        ),
    },
    toParentMessage: (message) => Message.GotToastMessage({ message }),
  });

const pageView = (model: Model, h: HtmlBuilder<Message>): Page => {
  if (model.route._tag === "NotFound") {
    return {
      title: "skate.to",
      width: "compact",
      content: h.section([], [h.h1([], [`Page not found: ${model.route.path}`])]),
    };
  }

  if (model.route._tag === "Login") {
    return {
      title: "Sign in · skate.to",
      width: "compact",
      content:
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
      width: "wide",
      headerEnd:
        model._tag === "LoggedIn" && canAccessAdmin(model.adminModel.adminAccess)
          ? adminHeaderEnd(h)
          : h.empty,
      content:
        model._tag === "LoggedIn"
          ? h.submodel({
              slotId: "admin",
              model: model.adminModel,
              view: adminView,
              viewInputs: {
                section: model.route.section,
                tabletOrAbove: model.tabletOrAbove,
              },
              toParentMessage: (message) => Message.GotAdminMessage({ message }),
            })
          : h.empty,
    };
  }

  return { title: "skate.to", ...CalendarView.slots(model, h) };
};

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message, Flags, Resource> = (
  flags: Flags,
  url,
) => {
  const themeBoot = Theme.boot({
    systemTheme: flags.systemTheme,
    maybeUserTheme: flags.maybeUserTheme,
  });
  const route = urlToAppRoute(url);
  const common = {
    today: flags.today,
    activeDateRange: ActiveDate.machine.initial,
    menu: Popover.init({ id: "main-menu", contentFocus: true }),
    theme: themeBoot.model,
    tabletOrAbove: flags.tabletOrAbove,
    toast: Toast.init({ id: "app-toast" }),
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
      const loggedInModel = makeLoggedIn(common, session, access.route);
      const permissionLoad =
        access.route._tag === "Admin"
          ? enterAdminSection(loggedInModel, session, access.route.section)
          : revalidateAdminOnRoot(loggedInModel);
      return {
        model: permissionLoad.model,
        commands: [
          ...routeRedirectCommands(access.maybeRedirect),
          ...(permissionLoad.commands ?? []),
        ],
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

type HomeState = Pick<
  Model,
  "today" | "activeDateRange" | "menu" | "theme" | "tabletOrAbove" | "toast"
> & {
  readonly loginModel?: typeof Login.Model.Type;
};

const homeState = (model: HomeState) => ({
  today: model.today,
  activeDateRange: model.activeDateRange,
  menu: model.menu,
  theme: model.theme,
  tabletOrAbove: model.tabletOrAbove,
  toast: model.toast,
});

const makeLoggedOut = (model: HomeState, route: LoggedOutRoute) =>
  LoggedOutModel({
    ...homeState(model),
    route,
    loginModel: model.loginModel ?? Login.init(),
  });

const makeLoggedIn = (model: HomeState, session: Session, route: LoggedInRoute = AppRoute.Home()) =>
  LoggedInModel({
    adminModel: Admin.init(),
    route,
    session,
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
  const nextModel = evo(model, { route: () => access.route });
  if (access.route._tag === "Admin" && model.route._tag !== "Admin") {
    return enterAdminSection(nextModel, model.session, access.route.section);
  }
  if (
    access.route._tag === "Admin" &&
    model.route._tag === "Admin" &&
    access.route.section !== model.route.section
  ) {
    return foldAdminSectionEntry(nextModel, {
      section: access.route.section,
      userId: model.session.userId,
    });
  }
  return withRouteRedirect(nextModel, access.maybeRedirect);
};

const updateLoggedInSession = (
  model: Model,
  session: Session,
): Update.Return<Model, Message, Resource> => {
  if (model._tag === "LoggedIn" && model.session.userId === session.userId) {
    return Update.combine(evo(model, { session: () => session }), [
      foldAdminAccessRevalidation({
        userId: session.userId,
        maybeAdminSection: adminSectionForRoute(model.route),
      }),
    ]);
  }
  const access = guardLoggedInRoute(model.route);
  const loggedInModel = makeLoggedIn(model, session, access.route);
  const permissionLoad =
    access.route._tag === "Admin"
      ? enterAdminSection(loggedInModel, session, access.route.section)
      : revalidateAdminOnRoot(loggedInModel);
  return {
    model: permissionLoad.model,
    commands: [...routeRedirectCommands(access.maybeRedirect), ...(permissionLoad.commands ?? [])],
  };
};

const revalidateAdminOnRoot = (model: Model): Update.Return<Model, Message, Resource> => {
  if (model._tag !== "LoggedIn") {
    return { model };
  }
  return foldAdminAccessRevalidation(model, {
    userId: model.session.userId,
    maybeAdminSection: adminSectionForRoute(model.route),
  });
};

const enterAdminSection = (
  model: Model,
  session: Session,
  section: AdminSection,
): Update.Return<Model, Message, Resource> => {
  if (model._tag !== "LoggedIn") {
    return { model };
  }
  return Update.combine(model, [
    foldAdminAccessRevalidation({
      userId: session.userId,
      maybeAdminSection: Option.some(section),
    }),
    foldAdminSectionEntry({ section, userId: session.userId }),
  ]);
};
