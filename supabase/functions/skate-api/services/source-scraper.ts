import { Clock, Effect } from "effect";
import { questionSetVersion, sharedInstructions } from "../domain/questions.ts";
import { Result } from "../domain/schedule.ts";
import { describeCause } from "../domain/error-details.ts";
import { localDateAt, makeWindow, timezone } from "../domain/window.ts";
import {
  SourceContentTooLarge,
  SourceDisabled,
  SourceFailure,
  SourceId,
  UnsupportedSourceType,
} from "../domain/source.ts";
import { Classifier } from "./classifier.ts";
import { HtmlSource } from "./html-source.ts";
import { SourceRepository } from "./source-repository.ts";
import { classifySchedule } from "./session-classification.ts";
import {
  makePersistenceSummary,
  preparePersistence,
} from "./session-persistence.ts";

export const scrape = Effect.fn("SourceScraper.scrape")(
  function* (sourceId: SourceId, requestId: string) {
    const repository = yield* SourceRepository.Service;
    const htmlSource = yield* HtmlSource.Service;
    const classifier = yield* Classifier.Service;
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
    const state = {
      rink_info: fetched.html,
      instructions: sharedInstructions,
      additional_notes: source.notes ?? "",
    };
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

    const classified = yield* classifySchedule({
      state,
      sourceId: source.id,
      dates,
      classifier,
    });
    const { daily, sessions, diagnostics } = classified;
    const countUncertain = daily.some((day) =>
      day.countUnknown || day.countOverflow || day.countConfidence < 0.6
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
    const warnings = daily.flatMap((day) =>
      day.countOverflow
        ? [
          `More than 50 public skating sessions were reported for ${day.date}; details were not extracted.`,
        ]
        : day.countUnknown
        ? [`The public skating session count is unknown for ${day.date}.`]
        : []
    );
    const result = {
      sourceId: source.id,
      sourceUrl: source.url,
      fetchedAt: fetched.fetchedAt,
      completedAt,
      questionSetVersion,
      classifier: {
        model: classifier.model,
        providerModel: diagnostics.providerModel,
        inputTokens: diagnostics.inputTokens,
        outputTokens: diagnostics.outputTokens,
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
    yield* Result.makeEffect({ ...result, lastFetched: completedAt }).pipe(
      Effect.mapError((cause) =>
        new SourceFailure({
          operation: "result_validation",
          cause: describeCause(cause),
        })
      ),
    );

    const plan = preparePersistence({ daily, sessions });
    const persistenceStarted = yield* Clock.currentTimeMillis;
    const committed = yield* repository.persist(
      source,
      completedAt,
      plan.sessions,
      plan.resolvedDays,
    );
    const persistenceDurationMs = Math.max(
      0,
      (yield* Clock.currentTimeMillis) - persistenceStarted,
    );
    return makePersistenceSummary({
      requestId,
      sourceId: source.id,
      rinkId: source.rinkId,
      timezone,
      startDate,
      endDateExclusive,
      daily,
      extractedSessions: sessions,
      plan,
      committed,
      persistenceDurationMs,
    });
  },
);
