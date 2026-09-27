import { Clock, Effect, Ref, Schema } from "effect";
import {
  makeAvailabilityQuestions,
  makeExactTimeQuestions,
  makeFieldQuestions,
  makeOccurrenceQuestions,
  questionSetVersion,
} from "../domain/questions.ts";
import {
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
  SourceDisabled,
  SourceFailure,
  SourceId,
  UnsupportedSourceType,
} from "../domain/source.ts";
import {
  type Answer,
  Classifier,
  ClassifierFailure,
  type Question,
} from "./classifier.ts";
import { HtmlSource } from "./html-source.ts";
import { SourceRepository } from "./source-repository.ts";

const choice = (
  answer: Answer | undefined,
): Extract<Answer, { type: "choice" }> | undefined =>
  answer?.type === "choice" ? answer : undefined;
const noul = (
  answer: Answer | undefined,
): Extract<Answer, { type: "noul" }> | undefined =>
  answer?.type === "noul" ? answer : undefined;
const lowConfidence = (answer: Answer | undefined): boolean =>
  choice(answer)?.confidence !== undefined &&
  (choice(answer)?.confidence ?? 1) < 0.6;
type Reason = typeof UncertaintyReason.Type;
const reasonsUnique = (
  reasons: ReadonlyArray<Reason>,
): Array<Reason> => [...new Set(reasons)];
interface Occurrence {
  readonly index: number;
  readonly weekIndex: number;
  readonly dates: ReadonlyArray<string>;
  readonly existsProbability: number;
  readonly startDate: string | null;
  readonly evidenceId: string | null;
  readonly evidenceText: string | null;
  readonly reasons: Array<Reason>;
}

const classify = (
  state: string,
  questions: Readonly<Record<string, Question>>,
  metrics: Ref.Ref<{
    readonly providerModel: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
  }>,
) =>
  Effect.gen(function* () {
    const classifier = yield* Classifier.Service;
    const serializedBytes = new TextEncoder().encode(
      JSON.stringify({ state, model: classifier.model, questions }),
    ).byteLength;
    if (
      Object.keys(questions).length > 24 || serializedBytes > 48 * 1024
    ) {
      return yield* Effect.fail(
        new ClassifierFailure({
          status: 422,
          operation: "classifier_budget",
          cause:
            `Classification request exceeded the 24-question or 48-KiB budget (questions=${
              Object.keys(questions).length
            }, bytes=${serializedBytes})`,
        }),
      );
    }
    const classification = yield* classifier.classify(state, questions);
    yield* Ref.update(metrics, (current) => ({
      providerModel: classification.providerModel,
      inputTokens: current.inputTokens + classification.usage.inputTokens,
      outputTokens: current.outputTokens + classification.usage.outputTokens,
    }));
    return classification.answers;
  });

const fetchEvidence = (
  blocks: ReadonlyArray<HtmlSource.HtmlBlock>,
  blockIds: ReadonlyArray<string>,
): Readonly<Record<string, string>> => {
  const found = blockIds.flatMap((id) => {
    const block = blocks.find((candidate) => candidate.id === id);
    return block === undefined ? [] : [[id, block.text] as const];
  });
  return Object.fromEntries(found);
};

const readEvidenceChoice = (
  state: string,
  weekIndex: number,
  occurrenceIndex: number,
  dates: ReadonlyArray<string>,
  blocks: ReadonlyArray<HtmlSource.HtmlBlock>,
  metrics: Ref.Ref<{
    readonly providerModel: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
  }>,
) =>
  Effect.gen(function* () {
    const partitions = Array.from({
      length: Math.max(1, Math.ceil(blocks.length / 250)),
    }, (_, partition) => blocks.slice(partition * 250, (partition + 1) * 250));
    for (const [partitionIndex, partition] of partitions.entries()) {
      const more = partitionIndex < partitions.length - 1;
      const questions = makeOccurrenceQuestions(
        occurrenceIndex,
        weekIndex,
        dates,
        partition,
        more,
      );
      const answers = yield* classify(state, {
        [`w${weekIndex}_o${occurrenceIndex}_evidence`]:
          questions[`w${weekIndex}_o${occurrenceIndex}_evidence`],
      }, metrics);
      const selected = choice(
        answers[`w${weekIndex}_o${occurrenceIndex}_evidence`],
      );
      if (selected === undefined || selected.choice === "unknown") {
        return {
          evidenceId: null,
          evidenceText: null,
          confidence: selected?.confidence ?? 0,
        };
      }
      if (selected.choice !== "next_partition") {
        const block = partition.find((candidate) =>
          candidate.id === selected.choice
        );
        if (block !== undefined) {
          return {
            evidenceId: block.id,
            evidenceText: block.text,
            confidence: selected.confidence,
          };
        }
        return {
          evidenceId: null,
          evidenceText: null,
          confidence: selected.confidence,
        };
      }
    }
    return { evidenceId: null, evidenceText: null, confidence: 0 };
  });

const resolveOffGrid = (
  state: string,
  descriptor: string,
  answers: Readonly<Record<string, Answer>>,
  metrics: Ref.Ref<{
    readonly providerModel: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
  }>,
) =>
  Effect.gen(function* () {
    const result: Record<string, string | null> = {};
    for (const field of ["start_time", "end_time"] as const) {
      if (choice(answers[field])?.choice !== "off_grid") {
        result[field] = choice(answers[field])?.choice === "not_stated" ||
            choice(answers[field])?.choice === "unclear"
          ? null
          : choice(answers[field])?.choice ?? null;
        continue;
      }
      const exact = yield* classify(
        `${state}\nExact time descriptor: ${descriptor}`,
        makeExactTimeQuestions(descriptor),
        metrics,
      );
      const hour = choice(exact.hour)?.choice;
      const minute = choice(exact.minute)?.choice;
      result[field] =
        hour !== undefined && minute !== undefined && hour !== "unknown" &&
          minute !== "unknown"
          ? `${hour}:${minute}`
          : null;
      result[`${field}_confidence`] = String(
        Math.min(
          choice(exact.hour)?.confidence ?? 0,
          choice(exact.minute)?.confidence ?? 0,
        ),
      );
    }
    return result;
  });

const extractOccurrence = (
  occurrence: Occurrence,
  sourceState: string,
  metrics: Ref.Ref<{
    readonly providerModel: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
  }>,
) =>
  Effect.gen(function* () {
    const evidenceId = occurrence.evidenceId;
    const descriptor =
      `Week ${occurrence.weekIndex}, occurrence ${occurrence.index}; listed start date ${
        occurrence.startDate ?? "unknown"
      }; ordering is local date, local start time, then document block order for ties, with unknown dates/times following known values in document order. Selected evidence ${
        evidenceId ?? "unknown"
      }: ${occurrence.evidenceText ?? "unavailable"}.`;
    const state = JSON.stringify({
      sourceState,
      occurrence: descriptor,
      evidenceBlock: occurrence.evidenceText,
    });
    const fieldAnswers = yield* classify(
      state,
      makeFieldQuestions(descriptor),
      metrics,
    );
    const times = yield* resolveOffGrid(
      state,
      descriptor,
      fieldAnswers,
      metrics,
    );
    const supportState = JSON.stringify({
      sourceState,
      occurrence: descriptor,
      assembled: {
        date: occurrence.startDate,
        startTime: times.start_time,
        endTime: times.end_time,
        category: choice(fieldAnswers.category)?.choice,
        cancellation: choice(fieldAnswers.cancellation)?.choice,
      },
    });
    const supportAnswers = yield* classify(supportState, {
      supported: {
        type: "noul",
        instructions:
          `Does the page explicitly support this assembled date/time occurrence, including applicable exception notices? ${descriptor}`,
      },
    }, metrics);
    const supportProbability = noul(supportAnswers.supported)?.noul ?? 0.5;
    const categoryChoice = choice(fieldAnswers.category)?.choice;
    const category =
      ["general", "family", "adult", "children", "senior"].includes(
          categoryChoice ?? "",
        )
        ? categoryChoice as Session["category"]
        : null;
    const cancellationChoice = choice(fieldAnswers.cancellation)?.choice;
    const cancellation = cancellationChoice === "cancelled"
      ? "cancelled"
      : cancellationChoice === "scheduled"
      ? "scheduled"
      : "unknown";
    const certaintyChoice = choice(fieldAnswers.certainty)?.choice;
    const reasons: Array<Reason> = [...occurrence.reasons];
    if (occurrence.startDate === null) reasons.push("missing_date");
    if (times.start_time === null) reasons.push("missing_start_time");
    if (times.end_time === null) reasons.push("missing_end_time");
    if (certaintyChoice === "tentative") reasons.push("tentative");
    if (certaintyChoice === "conflicting") reasons.push("conflicting_evidence");
    if (supportProbability <= 0.2) reasons.push("conflicting_evidence");
    if (
      lowConfidence(fieldAnswers.start_time) ||
      lowConfidence(fieldAnswers.end_time) ||
      lowConfidence(fieldAnswers.category) ||
      lowConfidence(fieldAnswers.cancellation) ||
      lowConfidence(fieldAnswers.certainty) ||
      supportProbability > 0.2 && supportProbability < 0.65
    ) reasons.push("low_confidence");
    if (
      certaintyChoice === "unknown" || category === null ||
      cancellation === "unknown"
    ) reasons.push("conflicting_evidence");
    const startTime = typeof times.start_time === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(times.start_time)
      ? times.start_time
      : null;
    const endTime = typeof times.end_time === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(times.end_time)
      ? times.end_time
      : null;
    const endDay = choice(fieldAnswers.end_day)?.choice;
    const endDate = occurrence.startDate === null
      ? null
      : endDay === "same_day"
      ? occurrence.startDate
      : endDay === "next_day"
      ? addCalendarDays(occurrence.startDate, 1)
      : null;
    if (
      startTime !== null && endTime !== null &&
      endDate === occurrence.startDate && endTime <= startTime
    ) reasons.push("conflicting_evidence");
    if (endTime !== null && endDate === null) reasons.push("missing_end_time");
    const certainty =
      supportProbability >= 0.65 && certaintyChoice === "definite" &&
        reasons.length === 0
        ? "supported"
        : "uncertain";
    const confidence = Object.fromEntries(
      Object.entries(fieldAnswers).flatMap(([field, answer]) => {
        if (answer.type === "choice") return [[field, answer.confidence]];
        return [];
      }).concat([["existenceProbability", occurrence.existsProbability], [
        "assembledSupportProbability",
        supportProbability,
      ]]),
    );
    return Session.make({
      occurrenceRef: Schema.decodeUnknownSync(OccurrenceRef)(
        `w${occurrence.weekIndex}-o${occurrence.index}`,
      ),
      weekIndex: occurrence.weekIndex,
      startDate: occurrence.startDate,
      startTime,
      endDate,
      endTime,
      timezone: "America/Toronto",
      category,
      cancellation,
      certainty,
      confidence,
      evidenceBlockIds: evidenceId === null ? [] : [evidenceId],
      uncertaintyReasons: reasonsUnique(reasons),
    });
  });

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
    const requestTime = yield* Clock.currentTimeMillis;
    const startDate = localDateAt(requestTime);
    const { endDateExclusive, weeks: dates } = makeWindow(startDate);
    const source = yield* repository.find(sourceId);
    if (!source.enabled) {
      return yield* Effect.fail(
        new SourceDisabled({
          sourceId,
          cause: "The source row is disabled",
        }),
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
    const sourceState = JSON.stringify({
      sourceId,
      name: source.name,
      url: source.url,
      notes: source.notes,
      timezone,
      startDate,
      endDateExclusive,
      weeks: dates,
      blocks: fetched.blocks,
    });
    if (new TextEncoder().encode(sourceState).byteLength > 24 * 1024) {
      return yield* Effect.fail(
        new SourceFailure({
          operation: "state_too_large",
          cause: "Serialized source state exceeded the 24-KiB Jev input budget",
        }),
      );
    }
    const weekRecords: Array<
      {
        index: number;
        startDate: string;
        endDate: string;
        coverage: "complete" | "partial" | "not_available" | "unclear";
        modelCount: number | "over_200" | null;
        countConfidence: number | null;
        extractedCount: number;
        cancellationCount: number;
        uncertaintyReasons: Array<Reason>;
      }
    > = [];
    const sessions: Array<Session> = [];
    const evidenceRefs: Array<string> = [];
    for (const [zeroIndex, week] of dates.entries()) {
      const weekIndex = zeroIndex + 1;
      const availability = makeAvailabilityQuestions(
        weekIndex,
        week.map((date) => `${date} (${weekdayName(date)})`),
      );
      const answers = yield* classify(sourceState, availability, metrics);
      const coverageAnswer = choice(answers[`week_${weekIndex}_coverage`]);
      const countAnswer = choice(answers[`week_${weekIndex}_count`]);
      if (coverageAnswer === undefined || countAnswer === undefined) {
        return yield* Effect.fail(
          new ClassifierFailure({
            status: 502,
            operation: "missing_week_answers",
            cause:
              `Classifier response omitted coverage or count answer for week ${weekIndex}`,
          }),
        );
      }
      const coverage =
        ["complete", "partial", "not_available", "unclear"].includes(
            coverageAnswer.choice,
          )
          ? coverageAnswer.choice as
            | "complete"
            | "partial"
            | "not_available"
            | "unclear"
          : "unclear";
      const countChoice = countAnswer.choice;
      const modelCount = countChoice === "unknown"
        ? null
        : countChoice === "over_200"
        ? "over_200"
        : /^\d+$/.test(countChoice)
        ? Number(countChoice)
        : null;
      const weekReasons: Array<Reason> = [];
      if (coverage !== "complete") {
        weekReasons.push("schedule_not_available");
      }
      if (modelCount === null && countChoice === "unknown") {
        weekReasons.push("count_unknown");
      }
      if (modelCount === "over_200") weekReasons.push("count_overflow");
      if (coverageAnswer.confidence < 0.6 || countAnswer.confidence < 0.6) {
        weekReasons.push("low_confidence");
      }
      if (
        modelCount === null && !weekReasons.includes("count_unknown") &&
        !weekReasons.includes("count_overflow")
      ) weekReasons.push("count_unknown");
      const occurrences: Array<Occurrence> = [];
      if (typeof modelCount === "number" && modelCount > 0) {
        for (let index = 1; index <= modelCount; index += 1) {
          const occurrenceQuestions = makeOccurrenceQuestions(
            index,
            weekIndex,
            week,
            fetched.blocks.slice(0, 250),
            fetched.blocks.length > 250,
          );
          const roundTwo = yield* classify(
            sourceState,
            occurrenceQuestions,
            metrics,
          );
          const existence = noul(roundTwo[`w${weekIndex}_o${index}_exists`]);
          const dateAnswer = choice(roundTwo[`w${weekIndex}_o${index}_date`]);
          if (existence === undefined || dateAnswer === undefined) {
            return yield* Effect.fail(
              new ClassifierFailure({
                status: 502,
                operation: "missing_occurrence_answers",
                cause:
                  `Classifier response omitted existence or date answer for week ${weekIndex}, occurrence ${index}`,
              }),
            );
          }
          const initialEvidence = choice(
            roundTwo[`w${weekIndex}_o${index}_evidence`],
          );
          let evidence: {
            evidenceId: string | null;
            evidenceText: string | null;
            confidence: number;
          } = { evidenceId: null, evidenceText: null, confidence: 0 };
          if (initialEvidence?.choice === "next_partition") {
            evidence = yield* readEvidenceChoice(
              sourceState,
              weekIndex,
              index,
              week,
              fetched.blocks.slice(250),
              metrics,
            );
          } else if (
            initialEvidence !== undefined &&
            initialEvidence.choice !== "unknown"
          ) {
            const selected = fetched.blocks.slice(0, 250).find((block) =>
              block.id === initialEvidence.choice
            );
            if (selected !== undefined) {
              evidence = {
                evidenceId: selected.id,
                evidenceText: selected.text,
                confidence: initialEvidence.confidence,
              };
            }
          }
          if (evidence.evidenceId !== null) {
            evidenceRefs.push(
              evidence.evidenceId,
            );
          }
          const startDateValue = dateAnswer.choice !== "unknown" &&
              dateAnswer.choice !== "outside_week" &&
              week.includes(dateAnswer.choice)
            ? dateAnswer.choice
            : null;
          const reasons: Array<Reason> = [];
          if (existence.noul > 0.2 && existence.noul < 0.65) {
            reasons.push(
              "low_confidence",
            );
          }
          if (existence.noul <= 0.2) continue;
          if (startDateValue === null) reasons.push("missing_date");
          if (evidence.evidenceId === null) {
            reasons.push("conflicting_evidence");
          }
          if (
            existence.noul < 0.65 || dateAnswer.confidence < 0.6 ||
            evidence.confidence < 0.6
          ) reasons.push("low_confidence");
          occurrences.push({
            index,
            weekIndex,
            dates: week,
            existsProbability: existence.noul,
            startDate: startDateValue,
            evidenceId: evidence.evidenceId,
            evidenceText: evidence.evidenceText,
            reasons,
          });
        }
      }
      for (const occurrence of occurrences) {
        sessions.push(
          yield* extractOccurrence(occurrence, sourceState, metrics),
        );
      }
      const cancelledCount = sessions.filter((session) =>
        session.weekIndex === weekIndex &&
        session.cancellation === "cancelled"
      ).length;
      const extractedCount = sessions.filter((session) =>
        session.weekIndex === weekIndex
      ).length;
      if (modelCount !== extractedCount) weekReasons.push("count_mismatch");
      if (
        occurrences.some((occurrence) => occurrence.evidenceId === null)
      ) weekReasons.push("conflicting_evidence");
      weekRecords.push({
        index: weekIndex,
        startDate: week[0],
        endDate: week[6],
        coverage,
        modelCount,
        countConfidence: countAnswer.confidence,
        extractedCount,
        cancellationCount: cancelledCount,
        uncertaintyReasons: reasonsUnique(weekReasons),
      });
    }
    const fetchedAt = fetched.fetchedAt;
    const completedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const classifierDiagnostics = yield* Ref.get(metrics);
    const uncertainCount =
      sessions.filter((session) => session.certainty === "uncertain").length;
    const cancelledCount =
      sessions.filter((session) => session.cancellation === "cancelled").length;
    const hasGaps =
      weekRecords.some((week) => week.uncertaintyReasons.length > 0) ||
      uncertainCount > 0;
    const completeness: "partial" | "complete" = hasGaps
      ? "partial"
      : "complete";
    const resultBase = {
      sourceId: source.id,
      sourceUrl: source.url,
      fetchedAt,
      completedAt,
      questionSetVersion,
      classifier: {
        model: classifier.model,
        providerModel: classifierDiagnostics.providerModel,
        inputTokens: classifierDiagnostics.inputTokens,
        outputTokens: classifierDiagnostics.outputTokens,
      },
      window: {
        timezone: "America/Toronto" as const,
        startDate,
        endDateExclusive,
      },
      weeks: weekRecords,
      sessions,
      summary: {
        extractedCount: sessions.length,
        cancelledCount,
        uncertainCount,
        completeness,
      },
      evidence: fetchEvidence(fetched.blocks, [...new Set(evidenceRefs)]),
      warnings: [],
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
