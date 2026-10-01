import { Schema } from "effect";

export const Category = Schema.Literals([
  "general",
  "family",
  "adult",
  "children",
  "senior",
]);
export const LocalTime = Schema.String.check(
  Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/),
);
export const Cancellation = Schema.Literals(["scheduled", "cancelled"]);
export const EndDay = Schema.Literals(["same_day", "next_day"]);
export const UncertaintyReason = Schema.Literals([
  "count_unknown",
  "count_overflow",
  "low_confidence",
  "missing_start_time",
  "missing_end_time",
  "missing_category",
  "unknown_cancellation",
  "invalid_time",
  "invalid_end_date",
  "end_before_start",
  "count_mismatch",
]);
export const OccurrenceRef = Schema.String.pipe(Schema.brand("OccurrenceRef"));
export type OccurrenceRef = typeof OccurrenceRef.Type;

export const Session = Schema.Struct({
  occurrenceRef: OccurrenceRef,
  sessionIndex: Schema.Number,
  startDate: Schema.String,
  startTime: Schema.NullOr(LocalTime),
  endDate: Schema.NullOr(Schema.String),
  endTime: Schema.NullOr(LocalTime),
  timezone: Schema.String,
  category: Schema.NullOr(Category),
  cancellation: Schema.Literals(["scheduled", "cancelled", "unknown"]),
  certainty: Schema.Literals(["supported", "uncertain"]),
  confidence: Schema.Record(Schema.String, Schema.Number),
  uncertaintyReasons: Schema.Array(UncertaintyReason),
});
export interface Session extends Schema.Schema.Type<typeof Session> {}

export const Result = Schema.Struct({
  sourceId: Schema.String,
  sourceUrl: Schema.String,
  fetchedAt: Schema.String,
  completedAt: Schema.String,
  lastFetched: Schema.String,
  questionSetVersion: Schema.Literal("source-scrape-v3"),
  classifier: Schema.Struct({
    model: Schema.String,
    providerModel: Schema.NullOr(Schema.String),
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
  }),
  window: Schema.Struct({
    timezone: Schema.Literal("America/Toronto"),
    startDate: Schema.String,
    endDateExclusive: Schema.String,
  }),
  days: Schema.Array(
    Schema.Struct({
      date: Schema.String,
      weekday: Schema.String,
      modelCount: Schema.NullOr(Schema.Number),
      countConfidence: Schema.Number,
    }),
  ),
  sessions: Schema.Array(Session),
  summary: Schema.Struct({
    extractedCount: Schema.Number,
    cancelledCount: Schema.Number,
    uncertainCount: Schema.Number,
    completeness: Schema.Literals(["complete", "partial", "unknown"]),
  }),
  warnings: Schema.Array(Schema.String),
});
export interface Result extends Schema.Schema.Type<typeof Result> {}
