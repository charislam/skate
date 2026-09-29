import { Equal, HashMap, Option } from "effect";
import type { Session } from "../domain/schedule.ts";
import { confidenceThreshold } from "./session-extraction.ts";
import type { DailyCount } from "./session-classification.ts";
import type {
  PersistenceSummary as StoredSummary,
  SessionWrite,
} from "./source-repository.ts";

type ExtractedSession = typeof Session.Type;

export interface PersistencePlan {
  readonly sessions: ReadonlyArray<SessionWrite>;
  readonly skippedCount: number;
  readonly skippedByDay: Readonly<Record<string, number>>;
  readonly duplicateCount: number;
  readonly conflictCount: number;
  readonly resolvedDays: ReadonlyArray<string>;
}

interface SessionKey {
  readonly start: string;
  readonly audience: SessionWrite["audience"];
}

const validDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = month === 2
    ? ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28)
    : [4, 6, 9, 11].includes(month)
    ? 30
    : 31;
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
};

export const preparePersistence = ({
  daily,
  sessions,
}: {
  readonly daily: ReadonlyArray<DailyCount>;
  readonly sessions: ReadonlyArray<ExtractedSession>;
}): PersistencePlan => {
  const skippedByDay = new Map<string, number>();
  const acceptedByDay = new Map<string, number>();
  let normalized = HashMap.empty<SessionKey, SessionWrite>();
  let conflictingKeys = HashMap.empty<SessionKey, true>();
  let skippedCount = 0;
  let duplicateCount = 0;
  let conflictCount = 0;
  const increment = (counts: Map<string, number>, date: string) =>
    counts.set(date, (counts.get(date) ?? 0) + 1);
  const skip = (date: string) => {
    skippedCount += 1;
    increment(skippedByDay, date);
  };

  for (const session of sessions) {
    if (
      session.startTime === null || session.endTime === null ||
      session.endDate === null || session.category === null ||
      !validDate(session.startDate) || !validDate(session.endDate)
    ) {
      skip(session.startDate);
      continue;
    }
    const start = `${session.startDate}T${session.startTime}:00`;
    const end = `${session.endDate}T${session.endTime}:00`;
    if (end <= start) {
      skip(session.startDate);
      continue;
    }
    const incoming: SessionWrite = {
      start,
      end,
      audience: session.category,
      isCancelled: session.cancellation === "cancelled",
      certainty: session.certainty === "supported" &&
          session.cancellation !== "unknown"
        ? "certain"
        : "uncertain",
    };
    const key: SessionKey = {
      start: incoming.start,
      audience: incoming.audience,
    };
    const prior = HashMap.get(normalized, key);
    if (Option.isSome(prior)) {
      if (Equal.equals(prior.value, incoming)) {
        duplicateCount += 1;
        continue;
      }
      if (!HashMap.has(conflictingKeys, key)) {
        conflictCount += 1;
        conflictingKeys = HashMap.set(conflictingKeys, key, true);
        normalized = HashMap.remove(normalized, key);
        const priorDay = prior.value.start.slice(0, 10);
        acceptedByDay.set(
          priorDay,
          (acceptedByDay.get(priorDay) ?? 1) - 1,
        );
        skip(priorDay);
      }
      skip(session.startDate);
      continue;
    }
    if (HashMap.has(conflictingKeys, key)) {
      skip(session.startDate);
      continue;
    }
    normalized = HashMap.set(normalized, key, incoming);
    increment(acceptedByDay, session.startDate);
  }

  const acceptedSessions = [...normalized].map(([, session]) => session);
  const resolvedDays = daily.filter((day) => {
    if (day.modelCount === null || day.countConfidence < confidenceThreshold) {
      return false;
    }
    const dayRows = acceptedSessions.filter((session) =>
      session.start.slice(0, 10) === day.date
    );
    return (acceptedByDay.get(day.date) ?? 0) === day.modelCount &&
      (skippedByDay.get(day.date) ?? 0) === 0 &&
      dayRows.length === day.modelCount &&
      dayRows.every((session) => session.certainty === "certain");
  }).map((day) => day.date);

  return {
    sessions: acceptedSessions,
    skippedCount,
    skippedByDay: Object.fromEntries(skippedByDay),
    duplicateCount,
    conflictCount,
    resolvedDays,
  };
};

export const makePersistenceSummary = ({
  requestId,
  sourceId,
  rinkId,
  timezone,
  startDate,
  endDateExclusive,
  daily,
  extractedSessions,
  plan,
  committed,
  persistenceDurationMs,
}: {
  readonly requestId: string;
  readonly sourceId: string;
  readonly rinkId: string;
  readonly timezone: string;
  readonly startDate: string;
  readonly endDateExclusive: string;
  readonly daily: ReadonlyArray<DailyCount>;
  readonly extractedSessions: ReadonlyArray<ExtractedSession>;
  readonly plan: PersistencePlan;
  readonly committed: StoredSummary;
  readonly persistenceDurationMs: number;
}) => ({
  requestId,
  sourceId,
  rinkId,
  window: { timezone, startDate, endDateExclusive },
  extractedCount: extractedSessions.length,
  acceptedCount: plan.sessions.length,
  skippedCount: plan.skippedCount,
  skippedByDay: plan.skippedByDay,
  duplicateCount: plan.duplicateCount,
  conflictCount: plan.conflictCount,
  insertedCount: committed.inserted,
  updatedCount: committed.updated,
  unchangedCount: committed.unchanged,
  missingMarkedUncertainCount: committed.missingMarkedUncertain,
  resolvedDayCount: plan.resolvedDays.length,
  unresolvedDayCount: daily.length - plan.resolvedDays.length,
  cancelledAcceptedCount:
    plan.sessions.filter((session) => session.isCancelled).length,
  uncertainAcceptedCount:
    plan.sessions.filter((session) => session.certainty === "uncertain").length,
  lastFetched: committed.lastFetched,
  persistenceDurationMs,
});
