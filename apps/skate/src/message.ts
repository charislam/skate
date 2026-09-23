import { defineMessageUnion } from "foldkit/message";
import { ActiveDate } from "./domain/active-date";

export const Message = defineMessageUnion({
  ...ActiveDate.Message,
});

export type Message = typeof Message.Type;
