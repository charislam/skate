import { Match, Option, Schema } from "effect";
import { addCalendarDays, timezone } from "../domain/window.ts";
import {
  Cancellation,
  Category,
  EndDay,
  LocalTime,
  OccurrenceRef,
  Session,
  UncertaintyReason,
} from "../domain/schedule.ts";
import { type Answer } from "./classifier.ts";
import type { SessionField } from "../domain/questions.ts";

export const confidenceThreshold = 0.6;

export const choice = (
  answer: Answer | undefined,
): Extract<Answer, { type: "choice" }> | undefined =>
  answer?.type === "choice" ? answer : undefined;

type Reason = typeof UncertaintyReason.Type;
const dedupe = (values: ReadonlyArray<Reason>): Array<Reason> => [
  ...new Set(values),
];

export const sessionQuestionId = (
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

export const extractSession = ({
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
  const startTime = Option.match(
    Schema.decodeUnknownOption(LocalTime)(start.value),
    { onNone: () => null, onSome: (value) => value },
  );
  const endTime = Option.match(
    Schema.decodeUnknownOption(LocalTime)(end.value),
    { onNone: () => null, onSome: (value) => value },
  );
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
    Object.entries(fieldAnswers).map(([key, answer]) => [
      key,
      choice(answer)?.confidence ?? 0,
    ]),
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
