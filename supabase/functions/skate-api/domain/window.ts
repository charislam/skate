import { DateTime } from "effect";

export const timezone = "America/Toronto" as const;

export const localDateAt = (epochMilliseconds: number): string =>
  DateTime.formatIsoDate(
    DateTime.makeZonedUnsafe(epochMilliseconds, { timeZone: timezone }),
  );

export const addCalendarDays = (date: string, days: number): string =>
  DateTime.formatIsoDate(
    DateTime.add(
      DateTime.makeZonedUnsafe(`${date}T00:00:00`, {
        timeZone: timezone,
        adjustForTimeZone: true,
      }),
      { days },
    ),
  );

export const weekdayName = (date: string): string =>
  DateTime.formatIntl(
    DateTime.makeZonedUnsafe(`${date}T12:00:00`, { timeZone: timezone }),
    new Intl.DateTimeFormat("en", { timeZone: timezone, weekday: "long" }),
  );

export const makeWindow = (startDate: string) => {
  const dates = Array.from(
    { length: 28 },
    (_, day) => addCalendarDays(startDate, day),
  );
  return { startDate, endDateExclusive: addCalendarDays(startDate, 28), dates };
};
