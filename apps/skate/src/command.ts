import { Clock, Effect } from "effect";
import { Command } from "foldkit";
import { Message } from "./message";

export const GetCurrentDate = Command.define("GetCurrentDate", {
  messages: [Message.ReceivedCurrentDate],
  execute: Clock.currentTimeMillis.pipe(
    Effect.map((millis) => Message.ReceivedCurrentDate({ date: new Date(millis) })),
  ),
});
