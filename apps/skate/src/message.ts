import { defineMessageUnion } from "foldkit/message";
import { ActiveDateMessage } from "./domain/active-date-message";

export const Message = defineMessageUnion({
  ...ActiveDateMessage.MessageSchema,
});

export type Message = typeof Message.Type;
