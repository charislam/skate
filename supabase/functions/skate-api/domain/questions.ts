import { Classifier } from "../services/classifier.ts";
import { weekdayName } from "./window.ts";

export const questionSetVersion = "source-scrape-v1" as const;

export const countOptions = Object.fromEntries([
  ...Array.from(
    { length: 201 },
    (_, count) => [String(count), `Exactly ${count} occurrences`],
  ),
  ["over_200", "More than 200 occurrences"],
  ["unknown", "The count cannot be established"],
]);

export const makeAvailabilityQuestions = (
  weekIndex: number,
  dates: ReadonlyArray<string>,
) => {
  const dateLabels = dates.join(", ");
  const rules =
    "Public skating means general, family, explicitly adult, children/preschool, or senior public skating. Exclude lessons, rentals, hockey, and competitive practices. Count each advertised occurrence once, include cancellations, expand only explicit weekly recurrence within its stated validity range, and use zero only when evidence supports no occurrences.";
  return {
    [`week_${weekIndex}_coverage`]: {
      type: "choice" as const,
      instructions:
        `For Week ${weekIndex}, ${dateLabels}: does the page contain a skating schedule applicable to these dates? ${rules}`,
      options: {
        complete: "Applicable schedule covers this week",
        partial: "Schedule covers only part of this week",
        not_available: "No applicable schedule is available",
        unclear: "Evidence is unclear",
      },
    },
    [`week_${weekIndex}_count`]: {
      type: "choice" as const,
      instructions:
        `For Week ${weekIndex}, ${dateLabels}: how many individual public skating occurrences are described for these seven dates? ${rules} Return unknown when the count cannot be established.`,
      options: countOptions,
    },
  } satisfies Readonly<Record<string, Classifier.Question>>;
};

export const makeOccurrenceQuestions = (
  occurrence: number,
  weekIndex: number,
  dates: ReadonlyArray<string>,
  blockRange: ReadonlyArray<{ readonly id: string; readonly text: string }>,
  hasMoreBlocks: boolean,
) => {
  const dateOptions = Object.fromEntries([
    ...dates.map((date) => [date, `${date} (${weekdayName(date)})`]),
    ["unknown", "Start date cannot be determined"],
    ["outside_week", "Start date falls outside this week"],
  ]);
  const evidenceOptions = Object.fromEntries([
    ...blockRange.map((block) => [block.id, block.text.slice(0, 40)]),
    ["unknown", "No source block can be selected"],
    ...(hasMoreBlocks
      ? [[
        "next_partition",
        "The best evidence may be in another block partition",
      ]]
      : []),
  ]);
  return {
    [`w${weekIndex}_o${occurrence}_exists`]: {
      type: "noul" as const,
      instructions:
        `Is occurrence ${occurrence} in Week ${weekIndex} a distinct public skating occurrence supported by the schedule? Order occurrences by local date, local start time, then document block order for ties; unknown dates/times follow known values in document order.`,
    },
    [`w${weekIndex}_o${occurrence}_date`]: {
      type: "choice" as const,
      instructions:
        `Which listed local date is the start date of occurrence ${occurrence} in Week ${weekIndex}?`,
      options: dateOptions,
    },
    [`w${weekIndex}_o${occurrence}_evidence`]: {
      type: "choice" as const,
      instructions:
        `Which source block most directly describes occurrence ${occurrence} in Week ${weekIndex}? Select the anchor block, not proof that the interpretation is correct.`,
      options: evidenceOptions,
    },
  } satisfies Readonly<Record<string, Classifier.Question>>;
};

const timeOptions = Object.fromEntries([
  ...Array.from(
    { length: 24 },
    (_, hour) =>
      [0, 10, 15, 20, 30, 40, 45, 50].map((minute) => {
        const value = `${String(hour).padStart(2, "0")}:${
          String(minute).padStart(2, "0")
        }`;
        return [value, `Local clock time ${value}`];
      }),
  ).flat(),
  ["off_grid", "An exact time is stated that is not among the listed marks"],
  ["not_stated", "No time is stated"],
  ["unclear", "The time cannot be determined"],
]);

export const makeFieldQuestions = (descriptor: string) =>
  ({
    start_time: {
      type: "choice" as const,
      instructions:
        `For this anchored occurrence, what local clock time does it start? ${descriptor}`,
      options: timeOptions,
    },
    end_time: {
      type: "choice" as const,
      instructions:
        `For this anchored occurrence, what local clock time does it end? ${descriptor}`,
      options: timeOptions,
    },
    end_day: {
      type: "choice" as const,
      instructions:
        `Does the end time belong to the start date or the following date? ${descriptor}`,
      options: {
        same_day: "Same local date",
        next_day: "Following local date",
        unknown: "End day cannot be determined",
      },
    },
    category: {
      type: "choice" as const,
      instructions:
        `Which advertised public skating category describes this occurrence? ${descriptor}`,
      options: {
        general: "Unrestricted public skating",
        family: "Family skating",
        adult: "Explicitly adult skating",
        children: "Children or preschool skating",
        senior: "Senior skating",
        unknown: "Ambiguous category",
      },
    },
    cancellation: {
      type: "choice" as const,
      instructions:
        `What cancellation status is supported for this occurrence, including applicable exception notices? ${descriptor}`,
      options: {
        scheduled: "Scheduled and not cancelled",
        cancelled: "Explicitly cancelled",
        unclear: "Status is unclear",
      },
    },
    certainty: {
      type: "choice" as const,
      instructions:
        `Is this occurrence presented as definite, tentative, or conflicting/unclear? ${descriptor}`,
      options: {
        definite: "Definite",
        tentative: "Tentative",
        conflicting: "Conflicting evidence",
        unknown: "Certainty cannot be determined",
      },
    },
  }) satisfies Readonly<Record<string, Classifier.Question>>;

export const makeExactTimeQuestions = (descriptor: string) =>
  ({
    hour: {
      type: "choice" as const,
      instructions:
        `Which exact local hour is explicitly stated? ${descriptor}`,
      options: Object.fromEntries([
        ...Array.from(
          { length: 24 },
          (
            _,
            hour,
          ) => [
            String(hour).padStart(2, "0"),
            `Hour ${String(hour).padStart(2, "0")}`,
          ],
        ),
        ["unknown", "Unknown hour"],
      ]),
    },
    minute: {
      type: "choice" as const,
      instructions:
        `Which exact local minute is explicitly stated? ${descriptor}`,
      options: Object.fromEntries([
        ...Array.from(
          { length: 60 },
          (
            _,
            minute,
          ) => [
            String(minute).padStart(2, "0"),
            `Minute ${String(minute).padStart(2, "0")}`,
          ],
        ),
        ["unknown", "Unknown minute"],
      ]),
    },
  }) satisfies Readonly<Record<string, Classifier.Question>>;
