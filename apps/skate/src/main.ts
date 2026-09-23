import { Clock, Effect, Schema } from "effect";
import type { Runtime, Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

// MODEL

export const Model = Schema.Struct({
  activeDate: Schema.Date,
});

export type Model = typeof Model.Type;

// FLAGS

export const Flags = Schema.Struct({
  activeDate: Schema.Date,
});

export type Flags = typeof Flags.Type;

export const flags: Effect.Effect<Flags> = Effect.gen(function* () {
  const activeDateMillis = yield* Clock.currentTimeMillis;
  return { activeDate: new Date(activeDateMillis) };
});

// MESSAGE

const Message = defineMessageUnion({});

export type Message = typeof Message.Type;

// UPDATE

export const update = (_model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {});

// VIEW

export const view = (_model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "skate",
  body: h.div([], [h.h1([], ["skate"])]),
});

// INIT

export const init: Runtime.ApplicationInit<Model, Message, Flags> = (flags) => ({
  model: { activeDate: flags.activeDate },
});
