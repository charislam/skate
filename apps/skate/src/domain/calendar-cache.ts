import { Array, DateTime, HashMap, HashSet, Match, Option, Result, Schema } from "effect";
import { AsyncData, Calendar as FoldkitCalendar } from "foldkit";
import { evo } from "foldkit/struct";
import { Calendar } from "./calendar";
import type { Model as ActiveDateModel } from "./active-date";

const CACHE_FRESHNESS_MS = 600_000;

export const DayData = AsyncData.Schema(
  Schema.Array(Calendar.CalendarSession),
  Calendar.CalendarError,
);
type DayAsyncData = typeof DayData.schema.Type;
type NonPendingDayData = Exclude<DayAsyncData, { _tag: "Loading" | "Refreshing" }>;
type PendingDayData = Exclude<DayAsyncData, NonPendingDayData>;
export const DetailData = AsyncData.Schema(
  Schema.Option(Calendar.CalendarSession),
  Calendar.CalendarError,
);
export const DayEntry = Schema.Struct({
  sessions: DayData.schema,
  requestId: Schema.Number,
  requestOrigin: Schema.Literals(["automatic", "manual", "retry"]),
  fetchedAt: Schema.Option(Schema.Number),
  failedAt: Schema.Option(Schema.Number),
  lastUsed: Schema.Number,
});
export const Model = Schema.Struct({
  days: Schema.HashMap(FoldkitCalendar.CalendarDate, DayEntry),
  details: Schema.HashMap(
    Calendar.SessionId,
    Schema.Struct({
      value: DetailData.schema,
      requestId: Schema.Number,
      fetchedAt: Schema.Option(Schema.Number),
      failedAt: Schema.Option(Schema.Number),
    }),
  ),
  nextRequestId: Schema.Number,
});
export type Model = typeof Model.Type;

export const init = (): Model => ({
  days: HashMap.empty(),
  details: HashMap.empty(),
  nextRequestId: 1,
});

export const detailEntry = (model: Model, id: Calendar.SessionId) => HashMap.get(model.details, id);

export const dayEntry = (model: Model, date: FoldkitCalendar.CalendarDate) =>
  HashMap.get(model.days, date);

export const displayedDates = (range: ActiveDateModel) =>
  range._tag === "Initial"
    ? []
    : range._tag === "Day"
      ? [range.date]
      : range._tag === "Week"
        ? Array.makeBy(7, (index) => FoldkitCalendar.addDays(range.startDate, index))
        : monthDates(range.startDate);

export const monthDates = (month: FoldkitCalendar.CalendarDate) => {
  const first = FoldkitCalendar.firstOfMonth(month);
  const last = FoldkitCalendar.lastOfMonth(month);
  const firstCell = FoldkitCalendar.startOfWeek(first, "Monday");
  const weekdayIndex = (day: string) =>
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].indexOf(day);
  const count = Math.ceil((weekdayIndex(FoldkitCalendar.dayOfWeek(first)) + last.day) / 7) * 7;
  return Array.makeBy(count, (index) => FoldkitCalendar.addDays(firstCell, index));
};

export const cacheVisible = (
  model: Model,
  {
    dates,
    now,
    force = false,
    pinnedDates = dates,
    origin = force ? "manual" : "automatic",
  }: {
    dates: ReadonlyArray<FoldkitCalendar.CalendarDate>;
    now: number;
    force?: boolean;
    pinnedDates?: ReadonlyArray<FoldkitCalendar.CalendarDate>;
    origin?: "automatic" | "manual" | "retry";
  },
) => {
  const scheduled = scheduleVisibleRequests({
    days: model.days,
    nextRequestId: model.nextRequestId,
    dates,
    now,
    force,
    origin,
  });
  const days = evictUnusedDays(scheduled.days, pinnedDates);
  return {
    model: evo(model, {
      days: () => days,
      nextRequestId: () => scheduled.nextRequestId,
    }),
    requests: scheduled.requests,
  };
};

const scheduleVisibleRequests = (input: {
  days: Model["days"];
  nextRequestId: number;
  dates: ReadonlyArray<FoldkitCalendar.CalendarDate>;
  now: number;
  force: boolean;
  origin: "automatic" | "manual" | "retry";
}) => {
  let days = input.days;
  let nextRequestId = input.nextRequestId;
  let scheduled = Array.fromIterable(HashMap.values(days)).filter((entry) =>
    AsyncData.isPending(entry.sessions),
  ).length;
  const requests = input.dates.flatMap((date) => {
    if (scheduled >= 4) return [];
    const existing = HashMap.get(days, date);
    const currentSessions = Option.map(existing, (entry) => entry.sessions);
    if (isPendingDayData(currentSessions)) {
      if (Option.isSome(existing)) {
        days = HashMap.set(days, date, { ...existing.value, lastUsed: input.now });
      }
      return [];
    }
    if (isFreshDay(existing, input.now, input.force)) {
      if (Option.isSome(existing)) {
        days = HashMap.set(days, date, { ...existing.value, lastUsed: input.now });
      }
      return [];
    }

    const requestId = nextRequestId;
    nextRequestId += 1;
    const sessions = sessionsForRequest(Option.filter(currentSessions, isNonPendingDayData));
    days = HashMap.set(days, date, {
      sessions,
      requestId,
      requestOrigin: input.origin,
      fetchedAt: Option.isSome(existing) ? existing.value.fetchedAt : Option.none(),
      failedAt: Option.isSome(existing) ? existing.value.failedAt : Option.none(),
      lastUsed: input.now,
    });
    scheduled += 1;
    return [{ date, requestId }];
  });
  return { days, nextRequestId, requests };
};

const isPendingDayData = (
  sessions: Option.Option<DayAsyncData>,
): sessions is Option.Option<PendingDayData> =>
  Option.isSome(sessions) &&
  (sessions.value._tag === "Loading" || sessions.value._tag === "Refreshing");

const isNonPendingDayData = (sessions: DayAsyncData): sessions is NonPendingDayData =>
  sessions._tag !== "Loading" && sessions._tag !== "Refreshing";

const isFreshDay = (entry: Option.Option<typeof DayEntry.Type>, now: number, force: boolean) =>
  Option.isSome(entry) &&
  !force &&
  (isWithinFreshnessWindow(entry.value.fetchedAt, now) ||
    isWithinFreshnessWindow(entry.value.failedAt, now));

const isWithinFreshnessWindow = (timestamp: Option.Option<number>, now: number) =>
  Option.isSome(timestamp) && now - timestamp.value < CACHE_FRESHNESS_MS;

const sessionsForRequest = (maybeSessions: Option.Option<NonPendingDayData>) => {
  if (Option.isNone(maybeSessions)) {
    return DayData.Loading();
  }
  return Match.value(maybeSessions.value).pipe(
    Match.tagsExhaustive({
      Idle: () => DayData.Loading(),
      Failure: () => DayData.Loading(),
      Stale: ({ data }) => AsyncData.Refreshing({ data }),
      Success: ({ data }) => AsyncData.Refreshing({ data }),
    }),
  );
};

const evictUnusedDays = (
  days: Model["days"],
  pinnedDates: ReadonlyArray<FoldkitCalendar.CalendarDate>,
) => {
  let pinned = HashSet.fromIterable(pinnedDates);
  const entries = Array.fromIterable(HashMap.entries(days));
  for (const [date, entry] of entries) {
    if (AsyncData.isPending(entry.sessions)) pinned = HashSet.add(pinned, date);
  }
  const leastRecentlyUsed = entries
    .filter(([date]) => !HashSet.has(pinned, date))
    .sort(([, a], [, b]) => b.lastUsed - a.lastUsed);
  let retained = pinned;
  const capacity = Math.max(0, 120 - HashSet.size(pinned));
  for (const [date] of leastRecentlyUsed.slice(0, capacity)) {
    retained = HashSet.add(retained, date);
  }
  let result = days;
  for (const [date] of entries) {
    if (!HashSet.has(retained, date)) result = HashMap.remove(result, date);
  }
  return result;
};

export const settleDay = (
  model: Model,
  input: {
    date: FoldkitCalendar.CalendarDate;
    requestId: number;
    now: number;
    result: Result.Result<ReadonlyArray<Calendar.CalendarSession>, Calendar.CalendarError>;
  },
): Model => {
  const entry = dayEntry(model, input.date);
  if (Option.isNone(entry) || entry.value.requestId !== input.requestId) return model;
  const details =
    input.result._tag === "Success"
      ? input.result.success.reduce<Model["details"]>((current, session) => {
          const maybeExisting = HashMap.get(current, session.id);
          if (Option.isSome(maybeExisting) && maybeExisting.value.requestId > input.requestId) {
            return current;
          }
          return HashMap.set(current, session.id, {
            value: DetailData.Success({ data: Option.some(session) }),
            requestId: input.requestId,
            fetchedAt: Option.some(input.now),
            failedAt: Option.none(),
          });
        }, model.details)
      : model.details;
  const updatedEntry = {
    ...entry.value,
    sessions: AsyncData.settle(entry.value.sessions, input.result),
    fetchedAt: freshness(input.result, input.now, entry.value.fetchedAt),
    failedAt: input.result._tag === "Failure" ? Option.some(input.now) : Option.none(),
    lastUsed: input.now,
  };
  return {
    ...model,
    details,
    days: HashMap.set(model.days, input.date, updatedEntry),
  };
};

export const invalidateDaysForSessions = (
  model: Model,
  sessions: ReadonlyArray<Calendar.CalendarSession>,
): Model => {
  const dates = HashSet.fromIterable(sessions.flatMap((session) => sessionDateKeys(session)));
  let days = model.days;
  for (const [key, entry] of HashMap.entries(model.days)) {
    if (HashSet.has(dates, key)) {
      days = HashMap.set(days, key, { ...entry, fetchedAt: Option.none() });
    }
  }
  return {
    ...model,
    days,
  };
};

const sessionDateKeys = (session: Calendar.CalendarSession) => {
  const first = FoldkitCalendar.make(
    DateTime.getPart(session.start, "year"),
    DateTime.getPart(session.start, "month"),
    DateTime.getPart(session.start, "day"),
  );
  const last = FoldkitCalendar.make(
    DateTime.getPart(session.end, "year"),
    DateTime.getPart(session.end, "month"),
    DateTime.getPart(session.end, "day"),
  );
  const firstOrdinal = Date.UTC(first.year, first.month - 1, first.day);
  const lastOrdinal = Date.UTC(last.year, last.month - 1, last.day);
  const days = Math.floor((lastOrdinal - firstOrdinal) / 86_400_000) + 1;
  return Array.makeBy(days, (index) => FoldkitCalendar.addDays(first, index));
};

const freshness = (
  result: Result.Result<ReadonlyArray<Calendar.CalendarSession>, Calendar.CalendarError>,
  now: number,
  previous: Option.Option<number>,
) => (result._tag === "Success" ? Option.some(now) : previous);

export const requestDetail = (
  model: Model,
  input:
    | { readonly id: Calendar.SessionId; readonly now: number; readonly force?: false }
    | { readonly id: Calendar.SessionId; readonly force: true },
) => {
  const { id } = input;
  const maybeEntry = detailEntry(model, id);
  if (
    Option.isSome(maybeEntry) &&
    (AsyncData.isPending(maybeEntry.value.value) ||
      (input.force !== true &&
        (isWithinFreshnessWindow(maybeEntry.value.fetchedAt, input.now) ||
          isWithinFreshnessWindow(maybeEntry.value.failedAt, input.now))))
  ) {
    return { model, request: Option.none<{ id: Calendar.SessionId; requestId: number }>() };
  }
  const requestId = model.nextRequestId;
  const value = Option.isSome(maybeEntry)
    ? Option.getOrElse(
        AsyncData.revalidateOrLoad(maybeEntry.value.value),
        () => maybeEntry.value.value,
      )
    : DetailData.Loading();
  return {
    model: {
      ...model,
      nextRequestId: requestId + 1,
      details: HashMap.set(model.details, id, {
        value,
        requestId,
        fetchedAt: Option.isSome(maybeEntry) ? maybeEntry.value.fetchedAt : Option.none(),
        failedAt: Option.isSome(maybeEntry) ? maybeEntry.value.failedAt : Option.none(),
      }),
    },
    request: Option.some({ id, requestId }),
  };
};

export const settleDetail = (
  model: Model,
  input: {
    id: Calendar.SessionId;
    requestId: number;
    now: number;
    result: Result.Result<Option.Option<Calendar.CalendarSession>, Calendar.CalendarError>;
  },
): Model => {
  const entry = detailEntry(model, input.id);
  if (Option.isNone(entry) || entry.value.requestId !== input.requestId) return model;
  return {
    ...model,
    details: HashMap.set(model.details, input.id, {
      ...entry.value,
      value: AsyncData.settle(entry.value.value, input.result),
      fetchedAt: input.result._tag === "Success" ? Option.some(input.now) : entry.value.fetchedAt,
      failedAt: input.result._tag === "Failure" ? Option.some(input.now) : Option.none(),
    }),
  };
};
