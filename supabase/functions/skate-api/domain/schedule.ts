import { Schema } from "effect";

export const Category = Schema.Literals([
  "general",
  "family",
  "adult",
  "children",
  "senior",
]);
export const UncertaintyReason = Schema.Literals([
  "schedule_not_available",
  "count_unknown",
  "count_overflow",
  "low_confidence",
  "missing_date",
  "missing_start_time",
  "missing_end_time",
  "tentative",
  "conflicting_evidence",
  "count_mismatch",
  "duplicate_ambiguous",
]);
export const OccurrenceRef = Schema.String.pipe(Schema.brand("OccurrenceRef"));
export type OccurrenceRef = typeof OccurrenceRef.Type;

export const Session = Schema.Struct({
  occurrenceRef: OccurrenceRef,
  weekIndex: Schema.Number,
  startDate: Schema.NullOr(Schema.String),
  startTime: Schema.NullOr(Schema.String),
  endDate: Schema.NullOr(Schema.String),
  endTime: Schema.NullOr(Schema.String),
  timezone: Schema.String,
  category: Schema.NullOr(Category),
  cancellation: Schema.Literals(["scheduled", "cancelled", "unknown"]),
  certainty: Schema.Literals(["supported", "uncertain"]),
  confidence: Schema.Record(Schema.String, Schema.Number),
  evidenceBlockIds: Schema.Array(Schema.String),
  uncertaintyReasons: Schema.Array(UncertaintyReason),
});
export interface Session extends Schema.Schema.Type<typeof Session> {}

export const Result = Schema.Struct({
  sourceId: Schema.String,
  sourceUrl: Schema.String,
  fetchedAt: Schema.String,
  completedAt: Schema.String,
  lastFetched: Schema.String,
  questionSetVersion: Schema.Literal("source-scrape-v1"),
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
  weeks: Schema.Array(Schema.Struct({
    index: Schema.Number,
    startDate: Schema.String,
    endDate: Schema.String,
    coverage: Schema.Literals([
      "complete",
      "partial",
      "not_available",
      "unclear",
    ]),
    modelCount: Schema.NullOr(
      Schema.Union([Schema.Number, Schema.Literal("over_200")]),
    ),
    countConfidence: Schema.NullOr(Schema.Number),
    extractedCount: Schema.Number,
    cancellationCount: Schema.Number,
    uncertaintyReasons: Schema.Array(UncertaintyReason),
  })),
  sessions: Schema.Array(Session),
  summary: Schema.Struct({
    extractedCount: Schema.Number,
    cancelledCount: Schema.Number,
    uncertainCount: Schema.Number,
    completeness: Schema.Literals(["complete", "partial", "unknown"]),
  }),
  evidence: Schema.Record(Schema.String, Schema.String),
  warnings: Schema.Array(Schema.String),
});
export interface Result extends Schema.Schema.Type<typeof Result> {}
