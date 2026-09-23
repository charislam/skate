import { Clock, Effect, Match } from "effect";
import { Command } from "foldkit";
import { Message } from "./message";
import { ActiveDateUtils } from "./domain";

export const ResolveCurrentDateRange = Command.define("ResolveCurrentDateRange", {
  args: {
    granularity: ActiveDateUtils.Granularity,
  },
  messages: [Message.ResolvedCurrentDateRange],
  execute: ({ granularity }) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((millis) => {
        const now = new Date(millis);

        return Match.value(granularity).pipe(
          Match.when("Day", () =>
            Message.ResolvedCurrentDateRange({
              granularity,
              date: ActiveDateUtils.getStartOfDay(now),
            }),
          ),
          Match.when("Week", () =>
            Message.ResolvedCurrentDateRange({
              granularity,
              date: ActiveDateUtils.getStartOfWeek(now),
            }),
          ),
          Match.when("Month", () =>
            Message.ResolvedCurrentDateRange({
              granularity,
              date: ActiveDateUtils.getStartOfMonth(now),
            }),
          ),
          Match.exhaustive,
        );
      }),
    ),
});
