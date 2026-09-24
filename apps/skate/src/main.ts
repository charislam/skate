import { Popover } from "@foldkit/ui";
import { cn } from "cn";
import { Effect, Match, Option, Schema, Stream } from "effect";
import { Calendar, type Runtime, Subscription, Update } from "foldkit";
import { Machine } from "foldkit/experimental";
import type { Document, HtmlBuilder } from "foldkit/html";
import { evo } from "foldkit/struct";
import { Command } from "./command";
import { ActiveDate, MainMenu } from "./domain";
import { Message } from "./message";

// MODEL

export const Model = Schema.Struct({
  today: Calendar.CalendarDate,
  activeDateRange: ActiveDate.Model,
  menu: Popover.Model,
  tabletOrAbove: Schema.Boolean,
});

export type Model = typeof Model.Type;

// FLAGS

export const Flags = Schema.Struct({
  today: Calendar.CalendarDate,
  tabletOrAbove: Schema.Boolean,
});

export type Flags = typeof Flags.Type;

export const flags = Effect.gen(function* () {
  const today = yield* Calendar.today.local;
  const tabletOrAbove = window.matchMedia("(min-width: 1024px)").matches;
  return { today, tabletOrAbove };
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
    })),
    Match.tag("GotPopoverMessage", ({ message }) => foldPopover(model, message)),
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
  const isDayView = model.activeDateRange._tag === "Day";

  return {
    title: "skate",
    body: h.div(
      [
        h.Class(
          cn(
            "h-screen mx-auto px-4 xl:px-12 py-6 flex flex-col gap-8 lg:gap-12",
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
                h.p([h.Class("text-sm text-slate-800 translate-y-1/4")], ["TO"]),
              ],
            ),
            Match.value(model.activeDateRange).pipe(
              Match.tags({
                Week: ({ startDate }) =>
                  h.div(
                    [h.Class("flex gap-2 items-center")],
                    [
                      h.button(
                        [
                          h.Class("text-slate-400 hover:bg-slate-100 cursor-pointer"),
                          h.AriaLabel("Previous week"),
                          h.OnClick(Message.SelectedPreviousDateRange()),
                        ],
                        [h.span([h.AriaHidden(true)], ["<"])],
                      ),
                      h.h2(
                        [h.Class("text-md text-slate-600 font-light uppercase tracking-widest")],
                        [
                          `${Option.match(ActiveDate.formatMonth({ format: "long" }, startDate), {
                            onSome: (month) => month,
                            onNone: () => "",
                          })} ${startDate.day}-${Calendar.addDays(startDate, 6).day}`,
                        ],
                      ),
                      h.button(
                        [
                          h.Class("text-slate-400 hover:bg-slate-100 cursor-pointer"),
                          h.AriaLabel("Next week"),
                          h.OnClick(Message.SelectedNextDateRange()),
                        ],
                        [h.span([h.AriaHidden(true)], [">"])],
                      ),
                    ],
                  ),
                Month: () => null,
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
                              [h.Class("uppercase text-sm text-slate-600")],
                              [
                                Option.match(ActiveDate.formatMonth({ format: "short" }, date), {
                                  onSome: (month) => month,
                                  onNone: () => "",
                                }),
                              ],
                            ),
                            h.span(
                              [h.Class("text-slate-600 font-light tracking-wide")],
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
                              "flex items-center text-4xl text-slate-600 hover:bg-slate-100 cursor-pointer",
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
                              "flex items-center text-4xl text-slate-600 hover:bg-slate-100 cursor-pointer",
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
            ActiveDate.isDateRangeCurrent(model.activeDateRange, model.today)
              ? h.span([])
              : h.button([
                  h.Class(
                    "text-sm text-slate-600 hover:bg-slate-100 underline-offset-2 cursor-pointer",
                  ),
                  h.OnClick(Message.SelectedCurrentDateRange()),
                  h.InnerHTML("Go to today &rarr;"),
                ]),
            h.submodel({
              slotId: "main-menu",
              model: model.menu,
              view: MainMenu.Popover.view,
              toParentMessage: (message) => Message.GotPopoverMessage({ message }),
              viewInputs: {
                ariaLabel: "Main menu",
                anchor: { placement: "top-end" },
                toView: ({ button, panel, backdrop, isVisible }) =>
                  h.div(
                    [h.Class("relative")],
                    [
                      h.button(
                        [
                          ...button,
                          h.Class("text-3xl text-slate-600 hover:bg-slate-100 cursor-pointer"),
                        ],
                        [h.span([h.AriaHidden(true), h.InnerHTML("&#x2630;")])],
                      ),
                      ...(isVisible
                        ? [
                            h.div([...backdrop, h.Class("fixed inset-0")]),
                            h.div(
                              [
                                ...panel,
                                h.Class(
                                  "z-10 rounded border border-slate-200 bg-white shadow-lg outline-none",
                                ),
                              ],
                              MainMenu.actions.map((action) =>
                                h.button(
                                  [
                                    h.Class(
                                      "block w-full px-3 py-2 text-left hover:bg-slate-100 cursor-pointer",
                                    ),
                                    h.OnClick(Message.SelectedMainMenuAction({ action })),
                                  ],
                                  [action],
                                ),
                              ),
                            ),
                          ]
                        : []),
                    ],
                  ),
              },
            }),
          ],
        ),
      ],
    ),
  };
};

// INIT

export const init: Runtime.ApplicationInit<Model, Message, Flags> = (flags: Flags) => ({
  model: {
    today: flags.today,
    activeDateRange: ActiveDate.machine.initial,
    menu: Popover.init({ id: "main-menu", contentFocus: true }),
    tabletOrAbove: flags.tabletOrAbove,
  },
  commands: [Command.SyncInitialDate({ today: flags.today })],
});
