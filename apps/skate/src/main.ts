import { Match, Option, Schema } from "effect";
import { type Runtime, type Update } from "foldkit";
import { Machine } from "foldkit/experimental";
import type { Document, HtmlBuilder } from "foldkit/html";
import { evo } from "foldkit/struct";
import { ActiveDate } from "./domain";
import { Message } from "./message";
import { Command } from "./command";

// MODEL

export const Model = Schema.Struct({
  activeDateRange: ActiveDate.Model,
});

export type Model = typeof Model.Type;

// UPDATE

const foldActiveDate = Machine.fold({
  machine: ActiveDate.machine,
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
      "ResolvedCurrentDateRange",
      () => foldActiveDate(model, message),
    ),
    Match.exhaustive,
  );

// VIEW

export const view = (_model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "skate",
  body: h.div([], [h.h1([], ["skate"])]),
});

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: { activeDateRange: ActiveDate.machine.initial },
  commands: [Command.ResolveCurrentDateRange({ granularity: "Day" })],
});
