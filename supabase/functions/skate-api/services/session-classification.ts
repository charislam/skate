import { Effect, Ref } from "effect";
import {
  countQuestionId,
  makeCountQuestion,
  makeDetailQuestions,
  makeExactTimeQuestions,
  type SessionField,
} from "../domain/questions.ts";
import { Session } from "../domain/schedule.ts";
import { weekdayName } from "../domain/window.ts";
import { SourceContentTooLarge } from "../domain/source.ts";
import type {
  ClassifierState,
  Interface as ClassifierService,
  Question,
} from "./classifier.ts";
import {
  choice,
  extractSession,
  sessionQuestionId,
} from "./session-extraction.ts";

export interface DailyCount {
  readonly date: string;
  readonly weekday: string;
  readonly modelCount: number | null;
  readonly countConfidence: number;
  readonly countUnknown: boolean;
  readonly countOverflow: boolean;
}

export interface ClassifiedSchedule {
  readonly daily: ReadonlyArray<DailyCount>;
  readonly sessions: ReadonlyArray<typeof Session.Type>;
  readonly diagnostics: {
    readonly providerModel: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

type Metrics = Ref.Ref<ClassifiedSchedule["diagnostics"]>;

const classify = (
  state: ClassifierState,
  questions: Readonly<Record<string, Question>>,
  metrics: Metrics,
  classifier: ClassifierService,
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
    const result = yield* classifier.classify(state, questions);
    yield* Ref.update(metrics, (current) => ({
      providerModel: result.providerModel,
      inputTokens: current.inputTokens + result.usage.inputTokens,
      outputTokens: current.outputTokens + result.usage.outputTokens,
    }));
    return result.answers;
  });

export const classifySchedule = Effect.fn("SessionClassification.classify")(
  function* ({
    state,
    sourceId,
    dates,
    classifier,
  }: {
    readonly state: ClassifierState;
    readonly sourceId: string;
    readonly dates: ReadonlyArray<string>;
    readonly classifier: ClassifierService;
  }) {
    const metrics = yield* Ref.make({
      providerModel: classifier.model,
      inputTokens: 0,
      outputTokens: 0,
    });
    const countQuestions = Object.fromEntries(
      dates.map((date) => [countQuestionId(date), makeCountQuestion(date)]),
    );
    const countAnswers = yield* classify(
      state,
      countQuestions,
      metrics,
      classifier,
    );
    const daily = dates.map((date): DailyCount => {
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
    const jobs = daily.flatMap((day) => {
      const count = day.modelCount;
      return count === null ? [] : Array.from(
        { length: count },
        (_, index) => ({
          date: day.date,
          sessionIndex: index + 1,
          totalSessions: count,
          countConfidence: day.countConfidence,
        }),
      );
    });
    const detailQuestions = Object.fromEntries(
      jobs.flatMap((job) =>
        Object.entries(makeDetailQuestions({
          date: job.date,
          sessionIndex: job.sessionIndex,
          totalSessions: job.totalSessions,
        })).map(([field, question]) => [
          sessionQuestionId(job.date, job.sessionIndex, field),
          question,
        ])
      ),
    );
    const detailAnswers = Object.keys(detailQuestions).length === 0
      ? {}
      : yield* classify(state, detailQuestions, metrics, classifier);
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
      : yield* classify(state, exactTimeQuestions, metrics, classifier);
    const sessions = jobs.map((job) => {
      const answerFor = (field: SessionField) =>
        detailAnswers[sessionQuestionId(job.date, job.sessionIndex, field)];
      return extractSession({
        sourceId,
        date: job.date,
        sessionIndex: job.sessionIndex,
        countConfidence: job.countConfidence,
        answers: {
          start_time: answerFor("start_time"),
          end_time: answerFor("end_time"),
          category: answerFor("category"),
          cancellation: answerFor("cancellation"),
          end_day: answerFor("end_day"),
        },
        exactAnswers: exactTimeAnswers,
      });
    }).sort((left, right) =>
      left.startDate.localeCompare(right.startDate) ||
      left.sessionIndex - right.sessionIndex
    );
    return {
      daily,
      sessions,
      diagnostics: yield* Ref.get(metrics),
    };
  },
);
