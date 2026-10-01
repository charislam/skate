import { Effect, Schedule, Schema, Stream } from "effect";
import { Calendar, Subscription } from "foldkit";
import { Message } from "./message";
import type { Model } from "./model";

export const torontoCalendarDate = (now: number) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    numberingSystem: "latn",
  }).formatToParts(new Date(now));
  return Calendar.make(
    Number(parts.find((part) => part.type === "year")?.value),
    Number(parts.find((part) => part.type === "month")?.value),
    Number(parts.find((part) => part.type === "day")?.value),
  );
};

export const subscriptions = Subscription.make<Model, Message, never>()((entry) => ({
  pageVisibility: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Stream.unwrap(
          Effect.sync(() =>
            Subscription.fromEvent<Event, Message>({
              target: document,
              type: "visibilitychange",
              toMessage: () =>
                Message.ChangedPageVisibility({
                  isVisible: document.visibilityState === "visible",
                }),
            }),
          ),
        ),
    },
  ),
  freshness: entry(
    { isVisible: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ isVisible: model.pageVisible }),
      dependenciesToStream: ({ isVisible }) =>
        isVisible
          ? Stream.fromEffectSchedule(
              Effect.clockWith((clock) => clock.currentTimeMillis).pipe(
                Effect.map((now) =>
                  Message.CalendarFreshnessTick({ today: torontoCalendarDate(now), now }),
                ),
              ),
              Schedule.spaced("1 minute"),
            )
          : Stream.empty,
    },
  ),
}));
