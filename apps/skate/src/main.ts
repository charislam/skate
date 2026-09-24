import { Effect, Match, Option, Schema } from "effect";
import { Calendar, type Runtime, type Update } from "foldkit";
import { Machine } from "foldkit/experimental";
import type { Document, HtmlBuilder } from "foldkit/html";
import { evo } from "foldkit/struct";
import { ActiveDate } from "./domain";
import { Message } from "./message";
import { Command } from "./command";
import { cn } from "cn";

// MODEL

export const Model = Schema.Struct({
  today: Calendar.CalendarDate,
  activeDateRange: ActiveDate.Model,
});

export type Model = typeof Model.Type;

// FLAGS

export const Flags = Schema.Struct({
  today: Calendar.CalendarDate,
});

export type Flags = typeof Flags.Type;

export const flags = Effect.gen(function* () {
  const today = yield* Calendar.today.local;
  return { today };
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
      () => foldActiveDate(model, message),
    ),
    Match.exhaustive,
  );

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const isDayView = model.activeDateRange._tag === "Day";

  return {
    title: "skate",
    body: h.div(
      [h.Class(cn("h-screen mx-auto px-4 py-6 flex flex-col gap-8", isDayView && "max-w-xl"))],
      [
        h.hgroup(
          [h.Class("flex items-baseline")],
          [
            h.h1([h.Class("text-4xl")], ["skate"]),
            h.p([h.Class("text-sm text-slate-800 translate-y-1/4")], ["TO"]),
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
                                Calendar.formatShort(Calendar.defaultEnglishLocale)(date).split(
                                  " ",
                                )[0] ?? "",
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
                            h.span([h.Class("sr-only")], ["Previous"]),
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
                            h.span([h.Class("sr-only")], ["Next"]),
                            h.span([h.AriaHidden(true), h.InnerHTML("&#8827;")]),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ],
              Week: () => [],
              Month: () => [],
            }),
          ),
        ),
        h.footer(
          [],
          [
            h.button([
              h.Class("text-sm text-slate-600 hover:underline underline-offset-2 cursor-pointer"),
              h.OnClick(Message.SelectedCurrentDateRange()),
              h.InnerHTML("Go to today &rarr;"),
            ]),
          ],
        ),
      ],
    ),
  };
};

// INIT

export const init: Runtime.ApplicationInit<Model, Message, Flags> = (flags: Flags) => ({
  model: { today: flags.today, activeDateRange: ActiveDate.machine.initial },
  commands: [Command.SyncInitialDate({ today: flags.today })],
});
