import { defineMessageUnion } from "foldkit/message";
import { ActiveDate } from "./domain";

export const Message = defineMessageUnion({
  ...ActiveDate.Message,
});

export type Message = typeof Message.Type;
