import { Effect, Match, Option, Schema } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { MainMenu } from "~/domain/main-menu";
import { Message } from "./message";

export const CalendarView = MainMenu.ActionFields.action;
export type CalendarView = typeof CalendarView.Type;

export const userCalendarViewKey = "skate.userCalendarView.tabletOrAbove";

export const resolveCalendarView = (input: {
  maybeUserTabletView: Option.Option<CalendarView>;
  tabletOrAbove: boolean;
}): CalendarView =>
  input.tabletOrAbove ? Option.getOrElse(input.maybeUserTabletView, () => "Day") : "Day";

export const viewMessage = (view: CalendarView) =>
  Match.value(view).pipe(
    Match.when("Day", () => Message.SelectedDayView()),
    Match.when("Week", () => Message.SelectedWeekView()),
    Match.when("Month", () => Message.SelectedMonthView()),
    Match.exhaustive,
  );

export const loadUserCalendarView = Effect.fn("Calendar.loadUserCalendarView")(function* () {
  const store = yield* KeyValueStore.KeyValueStore;
  const maybeValue = Option.fromUndefinedOr(yield* store.get(userCalendarViewKey));
  return yield* Option.match(maybeValue, {
    onNone: () => Effect.succeed(Option.none<CalendarView>()),
    onSome: (value) =>
      Schema.decodeUnknownEffect(CalendarView)(value).pipe(Effect.map(Option.some)),
  });
});

export const saveUserCalendarView = Effect.fn("Calendar.saveUserCalendarView")(function* (
  view: CalendarView,
) {
  const store = yield* KeyValueStore.KeyValueStore;
  yield* store.set(userCalendarViewKey, view);
});
