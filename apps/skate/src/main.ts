import { Popover } from "@foldkit/ui";
import { cn } from "cn";
import { Effect, Match, Option, Schema, Stream } from "effect";
import { Calendar, Command as FoldkitCommand, type Runtime, Subscription, Update } from "foldkit";
import { Machine } from "foldkit/experimental";
import type { Document, HtmlBuilder } from "foldkit/html";
import { UrlRequest } from "foldkit/navigation";
import { evo } from "foldkit/struct";
import { toString as urlToString } from "foldkit/url";
import { Command, LoadExternal, NavigateInternal } from "./command";
import { ActiveDate, MainMenu, Theme } from "./domain";
import { Message } from "./message";
import type { Model } from "./model";
import { urlToAppRoute } from "./route";
import { MainMenuView, WeekMonthSelector } from "./view";

// FLAGS

export const Flags = Schema.Struct({
  today: Calendar.CalendarDate,
  theme: Theme.Theme_,
  tabletOrAbove: Schema.Boolean,
});

export type Flags = typeof Flags.Type;

export const flags: Effect.Effect<Flags> = Effect.gen(function* () {
  const today = yield* Calendar.today.local;
  const tabletOrAbove = window.matchMedia("(min-width: 1024px)").matches;
  const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return { today, tabletOrAbove, theme };
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

export const update = (model: Model, message: Message) =>
  Match.value(message).pipe(
    Match.withReturnType<Update.Return<Model, Message>>(),
    Match.tag("CompletedNavigateInternal", "CompletedLoadExternal", () => ({ model })),
    Match.tag("ClickedLink", ({ request }) =>
      UrlRequest.match<Update.Return<Model, Message>>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [NavigateInternal({ url: urlToString(url) })],
        }),
        External: ({ href }) => ({ model, commands: [LoadExternal({ href })] }),
      }),
    ),
    Match.tag("ChangedUrl", ({ url }) => ({
      model: evo(model, { route: () => urlToAppRoute(url) }),
    })),
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

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
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
}));

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  if (model.route._tag === "NotFound") {
    return {
      title: "skate.to",
      body: h.main([h.Class("p-8")], [h.h1([], [`Page not found: ${model.route.path}`])]),
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
                  : h.button([
                      h.Class(
                        "px-2 text-sm text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800",
                      ),
                      h.OnClick(Message.SelectedCurrentDateRange()),
                      h.InnerHTML("Go to today &rarr;"),
                    ]),
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

  return {
    model: {
      route: urlToAppRoute(url),
      today: flags.today,
      activeDateRange: ActiveDate.machine.initial,
      menu: Popover.init({ id: "main-menu", contentFocus: true }),
      theme: themeBoot.model,
      tabletOrAbove: flags.tabletOrAbove,
    },
    commands: [
      ...FoldkitCommand.mapMessages(themeBoot.commands, (message) =>
        Message.GotThemeMessage({ message }),
      ),
      Command.SyncInitialDate({ today: flags.today }),
    ],
  };
};
