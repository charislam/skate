import { DateTime, Option, Result } from "effect";
import { Calendar } from "foldkit";
import { describe, expect, test } from "vitest";
import * as ActiveDate from "./active-date";
import * as CalendarCache from "./calendar-cache";
import { Calendar as CalendarDomain } from "./calendar";

describe("calendar cache", () => {
  test.each([
    [Calendar.make(2021, 2, 1), 28],
    [Calendar.make(2024, 2, 1), 35],
    [Calendar.make(2021, 5, 1), 42],
  ] as const)("builds the complete month grid for %s", (month, cellCount) => {
    const dates = CalendarCache.monthDates(month);
    expect(dates).toHaveLength(cellCount);
    const first = dates[0];
    const last = dates.at(-1);
    if (!first || !last) throw new Error("Month grid was empty");
    expect(Calendar.dayOfWeek(first)).toBe("Monday");
    expect(Calendar.dayOfWeek(last)).toBe("Sunday");
  });

  test("bounds day requests and deduplicates pending dates", () => {
    const dates = Array.from({ length: 7 }, (_, index) => Calendar.make(2024, 5, index + 1));
    const first = CalendarCache.cacheVisible(CalendarCache.init(), { dates, now: 1 });
    expect(first.requests).toHaveLength(4);
    expect(new Set(first.requests.map(({ date }) => date)).size).toBe(4);

    const duplicate = CalendarCache.cacheVisible(first.model, { dates, now: 2 });
    expect(duplicate.requests).toHaveLength(0);
  });

  test("settles a complete empty result and reuses it while fresh", () => {
    const date = Calendar.make(2024, 5, 17);
    const requested = CalendarCache.cacheVisible(CalendarCache.init(), { dates: [date], now: 10 });
    const request = requested.requests[0];
    if (!request) throw new Error("Expected the day request to be scheduled");
    const settled = CalendarCache.settleDay(requested.model, {
      date: request.date,
      requestId: request.requestId,
      now: 20,
      result: Result.succeed([]),
    });
    const entry = CalendarCache.dayEntry(settled, date);
    expect(Option.isSome(entry) && entry.value.sessions._tag).toBe("Success");
    expect(Option.flatMap(entry, (value) => value.fetchedAt)).toEqual(Option.some(20));
    expect(CalendarCache.cacheVisible(settled, { dates: [date], now: 20 }).requests).toHaveLength(
      0,
    );
    const expired = CalendarCache.cacheVisible(settled, { dates: [date], now: 600_020 });
    expect(expired.requests).toHaveLength(1);
    expect(
      Option.map(CalendarCache.dayEntry(expired.model, date), (value) => value.sessions._tag),
    ).toEqual(Option.some("Refreshing"));
  });

  test("uses the day request ID when seeding details from its response", () => {
    const date = Calendar.make(2024, 5, 17);
    const otherDate = Calendar.make(2024, 5, 18);
    const first = CalendarCache.cacheVisible(CalendarCache.init(), { dates: [date], now: 1 });
    const dayRequest = first.requests[0];
    if (!dayRequest) throw new Error("Expected the first day request");
    const laterRequests = CalendarCache.cacheVisible(first.model, { dates: [otherDate], now: 2 });
    const session: CalendarDomain.CalendarSession = {
      id: CalendarDomain.SessionId.make("session-from-day-request"),
      start: DateTime.makeZonedUnsafe(
        { year: 2024, month: 5, day: 17, hour: 10 },
        { timeZone: "America/Toronto", adjustForTimeZone: true },
      ),
      end: DateTime.makeZonedUnsafe(
        { year: 2024, month: 5, day: 17, hour: 11 },
        { timeZone: "America/Toronto", adjustForTimeZone: true },
      ),
      raw_start: "2024-05-17 10:00:00",
      raw_end: "2024-05-17 11:00:00",
      audience: "general",
      is_cancelled: false,
      certainty: "certain",
      rink_id: "7",
      rink_name: "Central rink",
      rink_address: null,
      rink_url: Option.none(),
    };
    const settled = CalendarCache.settleDay(laterRequests.model, {
      ...dayRequest,
      now: 3,
      result: Result.succeed([session]),
    });

    expect(
      Option.map(CalendarCache.detailEntry(settled, session.id), (entry) => entry.requestId),
    ).toEqual(Option.some(dayRequest.requestId));

    const detailRequest = CalendarCache.requestDetail(laterRequests.model, {
      id: session.id,
      now: 4,
    });
    if (Option.isNone(detailRequest.request)) throw new Error("Expected a detail request");
    const newerSession = { ...session, rink_name: "Newer detail result" };
    const newerDetail = CalendarCache.settleDetail(detailRequest.model, {
      id: session.id,
      requestId: detailRequest.request.value.requestId,
      now: 5,
      result: Result.succeed(Option.some(newerSession)),
    });
    const lateDayResult = CalendarCache.settleDay(newerDetail, {
      ...dayRequest,
      now: 6,
      result: Result.succeed([session]),
    });
    expect(
      Option.map(CalendarCache.detailEntry(lateDayResult, session.id), (entry) => entry.requestId),
    ).toEqual(Option.some(detailRequest.request.value.requestId));
  });

  test("cools down automatic retries after a failed attempt and lets Retry bypass it", () => {
    const date = Calendar.make(2024, 5, 17);
    const requested = CalendarCache.cacheVisible(CalendarCache.init(), { dates: [date], now: 10 });
    const request = requested.requests[0];
    if (!request) throw new Error("Expected the initial request");
    const failed = CalendarCache.settleDay(requested.model, {
      ...request,
      now: 20,
      result: Result.fail(
        new CalendarDomain.CalendarError({ message: "offline", cause: new Error("offline") }),
      ),
    });
    expect(
      CalendarCache.cacheVisible(failed, { dates: [date], now: 600_019 }).requests,
    ).toHaveLength(0);
    const retried = CalendarCache.cacheVisible(failed, {
      dates: [date],
      now: 600_020,
      force: true,
      pinnedDates: [date],
      origin: "retry",
    });
    expect(
      Option.map(CalendarCache.dayEntry(retried.model, date), (entry) => entry.requestOrigin),
    ).toEqual(Option.some("retry"));
  });

  test("discards a detail response after its request identity is superseded", () => {
    const sessionId = CalendarDomain.SessionId.make("opaque-id");
    const first = CalendarCache.requestDetail(CalendarCache.init(), { id: sessionId, now: 0 });
    if (Option.isNone(first.request)) throw new Error("Expected a detail request");
    const request = first.request.value;
    const firstSettled = CalendarCache.settleDetail(first.model, {
      id: sessionId,
      requestId: request.requestId,
      now: 1,
      result: Result.succeed(Option.none()),
    });
    const second = CalendarCache.requestDetail(firstSettled, { id: sessionId, now: 600_002 });
    if (Option.isNone(second.request)) throw new Error("Expected the refreshed detail request");
    const currentRequest = second.request.value;
    const late = CalendarCache.settleDetail(second.model, {
      id: sessionId,
      requestId: request.requestId,
      now: 10,
      result: Result.succeed(Option.none()),
    });
    expect(
      Option.map(CalendarCache.detailEntry(late, sessionId), (entry) => entry.requestId),
    ).toEqual(Option.some(currentRequest.requestId));
    expect(
      Option.map(CalendarCache.detailEntry(late, sessionId), (entry) => entry.value._tag),
    ).toEqual(Option.some("Refreshing"));
  });

  test("forces a detail refresh despite a fresh cached result", () => {
    const sessionId = CalendarDomain.SessionId.make("opaque-id");
    const first = CalendarCache.requestDetail(CalendarCache.init(), { id: sessionId, now: 0 });
    if (Option.isNone(first.request)) throw new Error("Expected the initial detail request");
    const cached = CalendarCache.settleDetail(first.model, {
      id: sessionId,
      requestId: first.request.value.requestId,
      now: 1,
      result: Result.succeed(Option.none()),
    });

    expect(CalendarCache.requestDetail(cached, { id: sessionId, now: 2 }).request).toEqual(
      Option.none(),
    );
    const forced = CalendarCache.requestDetail(cached, { id: sessionId, force: true });
    expect(Option.isSome(forced.request)).toBe(true);
  });

  test("uses calendar-date ranges for each view", () => {
    expect(
      CalendarCache.displayedDates(
        ActiveDate.Model.Week({ startDate: Calendar.make(2024, 12, 30) }),
      ),
    ).toEqual([
      Calendar.make(2024, 12, 30),
      Calendar.make(2024, 12, 31),
      Calendar.make(2025, 1, 1),
      Calendar.make(2025, 1, 2),
      Calendar.make(2025, 1, 3),
      Calendar.make(2025, 1, 4),
      Calendar.make(2025, 1, 5),
    ]);
  });
});
