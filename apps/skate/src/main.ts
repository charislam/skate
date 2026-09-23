import { Schema } from "effect";
import type { Runtime, Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

// MODEL

export const Model = Schema.Struct({});

export type Model = typeof Model.Type;

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

export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: {} });
