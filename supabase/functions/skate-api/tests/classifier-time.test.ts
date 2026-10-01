import { Effect, Option, } from "effect";
import {
  decodeExactTime,
  decodeTimeChoice,
  hourOptions,
  timeOptions,
} from "../domain/classifier-time.ts";
import {
  makeDetailQuestions,
  makeExactTimeQuestions,
  sharedInstructions,
} from "../domain/questions.ts";
import { type Answer, type Interface } from "../services/classifier.ts";
import { classifySchedule } from "../services/session-classification.ts";
import {
  extractSession,
  sessionQuestionId,
} from "../services/session-extraction.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const answer = (choice: string, confidence = 0.9): Answer => ({
  type: "choice",
  choice,
  confidence,
  probabilities: { [choice]: confidence },
});

const date = "2026-10-01";
const sourceId = "test-source";

const session = (options: {
  start?: Answer;
  end?: Answer;
  endDay?: string;
  exactAnswers?: Readonly<Record<string, Answer>>;
}) =>
  extractSession({
    sourceId,
    date,
    sessionIndex: 1,
    countConfidence: 0.9,
    answers: {
      start_time: options.start,
      end_time: options.end ?? answer("7:30 PM"),
      category: answer("general"),
      cancellation: answer("scheduled"),
      end_day: answer(options.endDay ?? "same_day"),
    },
    exactAnswers: options.exactAnswers ?? {},
  });

const exactAnswers = (options: { hour: string; minute: string }) => ({
  [`${sessionQuestionId(date, 1, "start_time")}_hour`]: answer(
    options.hour,
    0.7,
  ),
  [`${sessionQuestionId(date, 1, "start_time")}_minute`]: answer(
    options.minute,
    0.6,
  ),
});

Deno.test("time contract contains chronological 12-hour choices with complete conversion coverage", () => {
  const keys = Object.keys(timeOptions);
  const concrete = keys.slice(0, 192);

  assert(
    keys.length === 195 && new Set(concrete).size === 192,
    "192 unique times plus sentinels",
  );

  concrete.forEach((key, index) => {
    const hour = String(Math.floor(index / 8)).padStart(2, "0");
    const minute = ["00", "10", "15", "20", "30", "40", "45", "50"][index % 8];

    assert(
      Option.match(decodeTimeChoice(key), {
        onNone: () => false,
        onSome: (value) => value === `${hour}:${minute}`,
      }),
      `chronological conversion of ${key}`,
    );
    assert(
      /^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/.test(key),
      "canonical 12-hour key",
    );
    assert(
      timeOptions[key] === `Local clock time ${key}`,
      "label only exposes 12-hour choice",
    );
  });

  assert(
    keys[0] === "12:00 AM" && keys[96] === "12:00 PM" &&
      keys[191] === "11:50 PM",
    "midnight, noon, evening ordering",
  );

  assert(
    Object.keys(hourOptions).join() ===
      [
        ...Array.from(
          { length: 24 },
          (_, hour) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`,
        ),
        "unknown",
      ].join(),
    "24 explicit hours followed by unknown",
  );

  Object.entries(hourOptions).slice(0, 24).forEach(([key, label], index) => {
    assert(label === `Hour ${key}`, "hour label includes period");
    assert(
      Option.match(decodeExactTime({ hour: key, minute: "07" }), {
        onNone: () => false,
        onSome: (value) => value === `${String(index).padStart(2, "0")}:07`,
      }),
      "every exact hour maps correctly",
    );
  });

  const details = makeDetailQuestions({
    date,
    sessionIndex: 1,
    totalSessions: 1,
  });

  [details.start_time, details.end_time].forEach((question) => {
    assert(
      question.type === "choice" && question.options === timeOptions,
      "regular questions use canonical options",
    );
    assert(
      question.instructions.includes("12-hour time with AM/PM"),
      "instructions request period",
    );
  });

  const exact = makeExactTimeQuestions(date, 1, "start_time");

  assert(
    exact.hour.type === "choice" && exact.hour.options === hourOptions,
    "follow-up uses combined hours",
  );
  assert(
    exact.minute.type === "choice" &&
      Object.keys(exact.minute.options).length === 61 &&
      exact.minute.options["07"] === "Minute 07",
    "two-digit minutes and unknown retained",
  );

  assert(
    exact.hour.instructions.includes("including AM/PM") &&
      exact.minute.instructions.includes("never round"),
    "exact instructions preserve period and minutes",
  );
});

Deno.test("conversion is strict for malformed and legacy concrete choices", () => {
  [
    "00:00",
    "18:30",
    "06:30 PM",
    "6:07 PM",
    "6:30 pm",
    "13:00 PM",
    "6:30 PM ",
    "toString",
    "",
  ].forEach((value) => {
    assert(Option.isNone(decodeTimeChoice(value)), `reject ${value}`);
    const result = session({ start: answer(value) });
    assert(
      result.startTime === null &&
        result.uncertaintyReasons.includes("invalid_time") &&
        result.uncertaintyReasons.includes("missing_start_time"),
      "invalid concrete time retains diagnostics",
    );
  });

  [
    { hour: "18", minute: "07" },
    { hour: "6 pm", minute: "07" },
    { hour: "6 PM", minute: "7" },
    { hour: "6 PM", minute: "60" },
    { hour: "6 PM", minute: "07\n" },
    { hour: "toString", minute: "07" },
  ].forEach((components) => {
    assert(
      Option.isNone(decodeExactTime(components)),
      "malformed exact components rejected",
    );
    const result = session({
      start: answer("off_grid"),
      exactAnswers: exactAnswers(components),
    });
    assert(
      result.startTime === null &&
        result.uncertaintyReasons.includes("invalid_time"),
      "malformed exact time retains diagnostic",
    );
  });
});

Deno.test("session conversion retains confidence, missing-time uncertainty and end-day authority", () => {
  [
    ["12:00 AM", "00:00"],
    ["12:15 AM", "00:15"],
    ["6:30 AM", "06:30"],
    ["12:00 PM", "12:00"],
    ["12:15 PM", "12:15"],
    ["6:30 PM", "18:30"],
  ].forEach(([input, expected]) => {
    const result = session({ start: answer(input, 0.8) });
    assert(
      result.startTime === expected && result.confidence.start_time === 0.8 &&
        result.certainty === "supported",
      "concrete conversion adds no confidence",
    );
  });

  const exact = session({
    start: answer("off_grid", 0.8),
    exactAnswers: exactAnswers({ hour: "6 PM", minute: "07" }),
  });
  assert(
    exact.startTime === "18:07" && exact.confidence.start_time === 0.6 &&
      exact.certainty === "supported",
    "exact conversion uses minimum confidence",
  );

  const low = session({
    start: answer("off_grid", 0.05),
    exactAnswers: exactAnswers({ hour: "12 AM", minute: "07" }),
  });
  assert(
    low.startTime === "00:07" && low.confidence.start_time === 0.05 &&
      low.uncertaintyReasons.includes("low_confidence"),
    "initial confidence still limits exact answers",
  );
  [undefined, answer("not_stated"), answer("unclear")].forEach((start) => {
    const result = session({ start });
    assert(
      result.startTime === null && result.confidence.start_time === 0 &&
        result.uncertaintyReasons.includes("missing_start_time") &&
        !result.uncertaintyReasons.includes("invalid_time"),
      "missing answer is distinct from invalid",
    );
  });

  [
    {},
    exactAnswers({ hour: "unknown", minute: "07" }),
    exactAnswers({ hour: "6 PM", minute: "unknown" }),
  ].forEach((components) => {
    const result = session({
      start: answer("off_grid"),
      exactAnswers: components,
    });
    assert(
      result.startTime === null &&
        result.uncertaintyReasons.includes("missing_start_time") &&
        !result.uncertaintyReasons.includes("invalid_time"),
      "unknown or missing component is missing time",
    );
  });

  const overnight = session({
    start: answer("11:30 PM"),
    end: answer("12:15 AM", 0.75),
    endDay: "next_day",
  });
  assert(
    overnight.startTime === "23:30" && overnight.endTime === "00:15" &&
      overnight.endDate === "2026-10-02" &&
      overnight.confidence.end_time === 0.75 &&
      overnight.certainty === "supported",
    "overnight conversion respects selected end date",
  );

  const sameDay = session({
    start: answer("11:30 PM"),
    end: answer("12:15 AM"),
  });
  assert(
    sameDay.endDate === date &&
      sameDay.uncertaintyReasons.includes("end_before_start"),
    "midnight does not automatically advance date",
  );
});

Deno.test("off-grid orchestration keeps two questions and correlates sessions and fields", async () => {
  const calls: Array<ReadonlyArray<string>> = [];

  const responses: Record<string, Answer> = {
    [`count_${date}`]: answer("2"),
    ...Object.fromEntries([1, 2].flatMap((index) =>
      Object.entries({
        start_time: "off_grid",
        end_time: index === 1 ? "7:30 PM" : "off_grid",
        category: "general",
        cancellation: "scheduled",
        end_day: index === 1 ? "same_day" : "next_day",
      }).map((
        [field, value],
      ) => [sessionQuestionId(date, index, field), answer(value)])
    )),
    [`${sessionQuestionId(date, 1, "start_time")}_hour`]: answer("6 PM", 0.7),
    [`${sessionQuestionId(date, 1, "start_time")}_minute`]: answer("07", 0.6),
    [`${sessionQuestionId(date, 2, "start_time")}_hour`]: answer("11 PM"),
    [`${sessionQuestionId(date, 2, "start_time")}_minute`]: answer("59"),
    [`${sessionQuestionId(date, 2, "end_time")}_hour`]: answer("12 AM", 0.8),
    [`${sessionQuestionId(date, 2, "end_time")}_minute`]: answer("07", 0.75),
  };

  const classifier: Interface = {
    model: "fake",
    classify: (_state, questions) =>
      Effect.sync(() => {
        calls.push(Object.keys(questions));
        return {
          answers: Object.fromEntries(
            Object.entries(questions).map(([id, question]) => {
              const selected = responses[id];
              assert(
                selected?.type === "choice" && question.type === "choice" &&
                  Object.hasOwn(question.options, selected.choice),
                `fake answer offered for ${id}`,
              );
              return [id, selected];
            }),
          ),
          providerModel: "fake",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }),
  };

  const result = await Effect.runPromise(classifySchedule({
    state: {
      rink_info: "6:07 PM; 11:59 PM to 12:07 AM next day",
      instructions: sharedInstructions,
      additional_notes: "",
    },
    sourceId,
    dates: [date],
    classifier,
  }));

  assert(
    calls.length === 3 && calls.map((ids) => ids.length).join() === "1,10,6",
    "count, details, two questions per off-grid field",
  );

  assert(
    calls[2].join() ===
      [1, 2].flatMap((index) =>
        (index === 1 ? ["start_time"] : ["start_time", "end_time"]).flatMap((
          field,
        ) =>
          ["hour", "minute"].map((part) =>
            `${sessionQuestionId(date, index, field)}_${part}`
          )
        )
      ).join(),
    "exact question IDs retain correlation",
  );

  assert(
    result.sessions[0].startTime === "18:07" &&
      result.sessions[0].endTime === "19:30" &&
      result.sessions[0].confidence.start_time === 0.6,
    "first session exact start",
  );
  assert(
    result.sessions[1].startTime === "23:59" &&
      result.sessions[1].endTime === "00:07" &&
      result.sessions[1].endDate === "2026-10-02" &&
      result.sessions[1].confidence.end_time === 0.75,
    "second session exact start and end",
  );

  assert(
    result.sessions.every((value) => value.certainty === "supported"),
    "all converted sessions supported",
  );
});
