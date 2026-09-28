import { Clock, Effect, Match, Option, Ref, Schema } from "effect";
import {
  countQuestionId,
  makeCountQuestion,
  makeDetailQuestions,
  makeExactTimeQuestions,
  questionSetVersion,
  type SessionField,
  sharedInstructions,
} from "../domain/questions.ts";
import {
  Cancellation,
  Category,
  EndDay,
  LocalTime,
  OccurrenceRef,
  Result,
  Session,
  UncertaintyReason,
} from "../domain/schedule.ts";
import { describeCause } from "../domain/error-details.ts";
import {
  addCalendarDays,
  localDateAt,
  makeWindow,
  timezone,
  weekdayName,
} from "../domain/window.ts";
import {
  SourceContentTooLarge,
  SourceDisabled,
  SourceFailure,
  SourceId,
  UnsupportedSourceType,
} from "../domain/source.ts";
import { type Answer, Classifier, type Question } from "./classifier.ts";
import { HtmlSource } from "./html-source.ts";
import { SourceRepository } from "./source-repository.ts";

const confidenceThreshold = 0.6;
const choice = (
  answer: Answer | undefined,
): Extract<Answer, { type: "choice" }> | undefined =>
  answer?.type === "choice" ? answer : undefined;
type Reason = typeof UncertaintyReason.Type;
const dedupe = (
  values: ReadonlyArray<Reason>,
): Array<Reason> => [...new Set(values)];
type Metrics = Ref.Ref<
  {
    readonly providerModel: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
  }
>;
type State = Classifier.ClassifierState;

const classify = (
  state: State,
  questions: Readonly<Record<string, Question>>,
  metrics: Metrics,
) =>
  Effect.gen(function* () {
    if (
      new TextEncoder().encode(JSON.stringify(state)).byteLength > 24 * 1024
    ) {
      return yield* Effect.fail(
        new SourceContentTooLarge({
          cause: "Serialized classifier state exceeded the 24-KiB limit",
        }),
      );
    }
    const classifier = yield* Classifier.Service;
    const result = yield* classifier.classify(state, questions);
    yield* Ref.update(
      metrics,
      (current) => ({
        providerModel: result.providerModel,
        inputTokens: current.inputTokens + result.usage.inputTokens,
        outputTokens: current.outputTokens + result.usage.outputTokens,
      }),
    );
    return result.answers;
  });

const makeState = (html: string, notes: string): State => ({
  rink_info: html,
  instructions: sharedInstructions,
  additional_notes: notes,
});

const sessionQuestionId = (
  date: string,
  sessionIndex: number,
  field: string,
): string => `session_${date}_${sessionIndex}_${field}`;

const exactTime = ({
  value,
  answers,
}: {
  readonly value: string | undefined;
  readonly answers: {
    readonly hour?: Answer;
    readonly minute?: Answer;
  };
}) =>
  Match.value(value).pipe(
    Match.when("not_stated", () => ({ value: null, confidence: 0 })),
    Match.when("unclear", () => ({ value: null, confidence: 0 })),
    Match.when(undefined, () => ({ value: null, confidence: 0 })),
    Match.when("off_grid", () => {
      const hour = choice(answers.hour);
      const minute = choice(answers.minute);
      const time = hour && minute && hour.choice !== "unknown" &&
          minute.choice !== "unknown"
        ? `${hour.choice}:${minute.choice}`
        : null;
      return {
        value: time,
        confidence: Math.min(hour?.confidence ?? 0, minute?.confidence ?? 0),
      };
    }),
    Match.when(Match.string, (time) => ({ value: time, confidence: 1 })),
    Match.exhaustive,
  );

const extractSession = ({
  sourceId,
  date,
  sessionIndex,
  countConfidence,
  answers,
  exactAnswers,
}: {
  readonly sourceId: string;
  readonly date: string;
  readonly sessionIndex: number;
  readonly countConfidence: number;
  readonly answers: Readonly<Record<SessionField, Answer | undefined>>;
  readonly exactAnswers: Readonly<Record<string, Answer | undefined>>;
}) => {
  const startAnswer = choice(answers.start_time);
  const endAnswer = choice(answers.end_time);
  const start = exactTime({
    value: startAnswer?.choice,
    answers: {
      hour: exactAnswers[
        `${sessionQuestionId(date, sessionIndex, "start_time")}_hour`
      ],
      minute: exactAnswers[
        `${sessionQuestionId(date, sessionIndex, "start_time")}_minute`
      ],
    },
  });
  const end = exactTime({
    value: endAnswer?.choice,
    answers: {
      hour: exactAnswers[
        `${sessionQuestionId(date, sessionIndex, "end_time")}_hour`
      ],
      minute: exactAnswers[
        `${sessionQuestionId(date, sessionIndex, "end_time")}_minute`
      ],
    },
  });
  const categoryAnswer = choice(answers.category);
  const category = Option.match(
    Schema.decodeUnknownOption(Category)(categoryAnswer?.choice),
    { onNone: () => null, onSome: (value) => value },
  );
  const cancelAnswer = choice(answers.cancellation);
  const cancellation = Option.match(
    Schema.decodeUnknownOption(Cancellation)(cancelAnswer?.choice),
    { onNone: () => "unknown" as const, onSome: (value) => value },
  );
  const dayAnswer = choice(answers.end_day);
  const decodedEndDay = Schema.decodeUnknownOption(EndDay)(dayAnswer?.choice);
  const hasEndDay = Option.match(decodedEndDay, {
    onNone: () => false,
    onSome: () => true,
  });
  const endDate = Option.match(decodedEndDay, {
    onNone: () => null,
    onSome: (value) => value === "same_day" ? date : addCalendarDays(date, 1),
  });
  const decodedStart = Schema.decodeUnknownOption(LocalTime)(start.value);
  const decodedEnd = Schema.decodeUnknownOption(LocalTime)(end.value);
  const startTime = Option.match(decodedStart, {
    onNone: () => null,
    onSome: (value) => value,
  });
  const endTime = Option.match(decodedEnd, {
    onNone: () => null,
    onSome: (value) => value,
  });
  const invalidTime = (start.value !== null && startTime === null) ||
    (end.value !== null && endTime === null);
  const reasons: Array<Reason> = [];
  if (countConfidence < confidenceThreshold) reasons.push("low_confidence");
  if (startTime === null) reasons.push("missing_start_time");
  if (endTime === null) reasons.push("missing_end_time");
  if (category === null) reasons.push("missing_category");
  if (cancellation === "unknown") reasons.push("unknown_cancellation");
  if (!hasEndDay) reasons.push("invalid_end_date");
  if (invalidTime) reasons.push("invalid_time");
  if (
    endDate !== null && endDate === date && startTime !== null &&
    endTime !== null && endTime <= startTime
  ) reasons.push("end_before_start");
  const fieldAnswers = {
    start_time: startAnswer,
    end_time: endAnswer,
    category: categoryAnswer,
    cancellation: cancelAnswer,
    end_day: dayAnswer,
  };
  const confidence = Object.fromEntries(
    Object.entries(fieldAnswers).map((
      [key, answer],
    ) => [key, choice(answer)?.confidence ?? 0]),
  );
  confidence.start_time = Math.min(
    confidence.start_time ?? 0,
    start.confidence,
  );
  confidence.end_time = Math.min(confidence.end_time ?? 0, end.confidence);
  if (
    Object.values(confidence).some((value) => value < confidenceThreshold)
  ) reasons.push("low_confidence");
  const uniqueReasons = dedupe(reasons);
  const occurrenceRef = Schema.decodeUnknownSync(OccurrenceRef)(
    `${sourceId}:${date}:${sessionIndex}`,
  );
  return Session.make({
    occurrenceRef,
    sessionIndex,
    startDate: date,
    startTime,
    endDate,
    endTime,
    timezone,
    category,
    cancellation,
    certainty: uniqueReasons.length === 0 ? "supported" : "uncertain",
    confidence,
    uncertaintyReasons: uniqueReasons,
  });
};

export const scrape = Effect.fn("SourceScraper.scrape")(
  function* (sourceId: SourceId) {
    const repository = yield* SourceRepository.Service;
    const htmlSource = yield* HtmlSource.Service;
    const classifier = yield* Classifier.Service;
    const metrics = yield* Ref.make({
      providerModel: classifier.model,
      inputTokens: 0,
      outputTokens: 0,
    });
    const startDate = localDateAt(yield* Clock.currentTimeMillis);
    const { dates, endDateExclusive } = makeWindow(startDate);
    const source = yield* repository.find(sourceId);
    if (!source.enabled) {
      return yield* Effect.fail(
        new SourceDisabled({ sourceId, cause: "The source row is disabled" }),
      );
    }
    if (source.type !== "web_scrape") {
      return yield* Effect.fail(
        new UnsupportedSourceType({
          sourceType: source.type,
          cause: `Expected source type 'web_scrape', received '${source.type}'`,
        }),
      );
    }
    const fetched = yield* htmlSource.fetch(source.url);
    const notes = source.notes ?? "";
    const state = makeState(fetched.html, notes);
    const stateBytes =
      new TextEncoder().encode(JSON.stringify(state)).byteLength;
    if (stateBytes > 24 * 1024) {
      return yield* Effect.fail(
        new SourceContentTooLarge({
          cause:
            `Serialized classifier state exceeded the 24-KiB limit (${stateBytes} bytes)`,
        }),
      );
    }

    const countQuestions = Object.fromEntries(
      dates.map((date) => [countQuestionId(date), makeCountQuestion(date)]),
    );
    const countAnswers = yield* classify(state, countQuestions, metrics);
    const daily = dates.map((date) => {
      const answer = choice(countAnswers[countQuestionId(date)]);
      const selected = answer?.choice ?? "unknown";
      const modelCount = /^\d+$/.test(selected) && Number(selected) <= 50
        ? Number(selected)
        : null;
      return {
        date,
        weekday: weekdayName(date),
        modelCount,
        countConfidence: answer?.confidence ?? 0,
        countUnknown: selected === "unknown",
        countOverflow: selected === "more_than_50",
      };
    });
    const jobs = daily.flatMap((day, dayIndex) =>
      day.modelCount === null ? [] : Array.from(
        { length: day.modelCount },
        (_, index) => ({ date: day.date, sessionIndex: index + 1, dayIndex }),
      )
    );
    const detailQuestions = Object.fromEntries(
      jobs.flatMap((job) =>
        Object.entries(makeDetailQuestions(job.date, job.sessionIndex)).map(
          ([field, question]) => [
            sessionQuestionId(job.date, job.sessionIndex, field),
            question,
          ],
        )
      ),
    );
    const detailAnswers = Object.keys(detailQuestions).length === 0
      ? {}
      : yield* classify(state, detailQuestions, metrics);
    const offGridFields = jobs.flatMap((job) =>
      (["start_time", "end_time"] as const).flatMap((field) =>
        choice(
            detailAnswers[sessionQuestionId(job.date, job.sessionIndex, field)],
          )
            ?.choice === "off_grid"
          ? [{ job, field }]
          : []
      )
    );
    const exactTimeQuestions = Object.fromEntries(
      offGridFields.flatMap(({ job, field }) =>
        Object.entries(
          makeExactTimeQuestions(job.date, job.sessionIndex, field),
        ).map(([part, question]) => [
          `${sessionQuestionId(job.date, job.sessionIndex, field)}_${part}`,
          question,
        ])
      ),
    );
    const exactTimeAnswers = Object.keys(exactTimeQuestions).length === 0
      ? {}
      : yield* classify(state, exactTimeQuestions, metrics);
    const extracted = jobs.map((job) => {
      const answerFor = (field: SessionField) =>
        detailAnswers[sessionQuestionId(job.date, job.sessionIndex, field)];
      return extractSession({
        sourceId: source.id,
        date: job.date,
        sessionIndex: job.sessionIndex,
        countConfidence: daily[job.dayIndex]!.countConfidence,
        answers: {
          start_time: answerFor("start_time"),
          end_time: answerFor("end_time"),
          category: answerFor("category"),
          cancellation: answerFor("cancellation"),
          end_day: answerFor("end_day"),
        },
        exactAnswers: exactTimeAnswers,
      });
    });
    const sessions = [...extracted].sort((a, b) =>
      a.startDate.localeCompare(b.startDate) || a.sessionIndex - b.sessionIndex
    );
    const countUncertain = daily.some((day) =>
      day.countUnknown || day.countOverflow ||
      day.countConfidence < confidenceThreshold
    );
    const uncertainCount =
      sessions.filter((session) => session.certainty === "uncertain").length;
    const cancelledCount =
      sessions.filter((session) => session.cancellation === "cancelled").length;
    const allCountsUnknown = daily.every((day) => day.countUnknown);
    const completeness: "unknown" | "partial" | "complete" = allCountsUnknown
      ? "unknown"
      : countUncertain || uncertainCount > 0
      ? "partial"
      : "complete";
    const completedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const diagnostic = yield* Ref.get(metrics);
    const warnings = daily.flatMap((day) =>
      day.countOverflow
        ? [
          `More than 50 public skating sessions were reported for ${day.date}; details were not extracted.`,
        ]
        : day.countUnknown
        ? [`The public skating session count is unknown for ${day.date}.`]
        : []
    );
    const resultBase = {
      sourceId: source.id,
      sourceUrl: source.url,
      fetchedAt: fetched.fetchedAt,
      completedAt,
      questionSetVersion,
      classifier: {
        model: classifier.model,
        providerModel: diagnostic.providerModel,
        inputTokens: diagnostic.inputTokens,
        outputTokens: diagnostic.outputTokens,
      },
      window: { timezone, startDate, endDateExclusive },
      days: daily.map(({ date, weekday, modelCount, countConfidence }) => ({
        date,
        weekday,
        modelCount,
        countConfidence,
      })),
      sessions,
      summary: {
        extractedCount: sessions.length,
        cancelledCount,
        uncertainCount,
        completeness,
      },
      warnings,
    };
    yield* Result.makeEffect({ ...resultBase, lastFetched: completedAt }).pipe(
      Effect.mapError((cause) =>
        new SourceFailure({
          operation: "result_validation",
          cause: describeCause(cause),
        })
      ),
    );
    const lastFetched = yield* repository.complete(source, completedAt);
    return yield* Result.makeEffect({ ...resultBase, lastFetched }).pipe(
      Effect.mapError((cause) =>
        new SourceFailure({
          operation: "result_validation",
          cause: describeCause(cause),
        })
      ),
    );
  },
);
