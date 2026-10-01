# Classifier time choices in 12-hour format

## Objective

Present start and end time choices to Jev in 12-hour format with explicit AM/PM. Convert the selected answers deterministically to zero-padded `HH:mm` in application code before validating and assembling sessions. This removes the model's current responsibility to convert source times from 12-hour to 24-hour format.

This document is an implementation plan.

## Confirmed decisions

The following decisions were confirmed during planning:

- Continue instructing the model to assume source times use 12-hour time unless 24-hour time is explicitly stated. This change does not introduce a requirement for an explicit AM/PM suffix in source text.
- For an off-grid time such as `6:07 PM`, retain two follow-up questions: hour and minute. Give the hour question 24 explicit choices such as `6 AM` and `6 PM`, plus `unknown`. A separate AM/PM question is unnecessary with this representation.

## Current behavior

Paths below are relative to `supabase/functions/skate-api/`.

- `domain/questions.ts` generates 192 concrete time options: 24 hours multiplied by minute marks `00`, `10`, `15`, `20`, `30`, `40`, `45`, and `50`. Both the option keys and labels contain 24-hour times. Start/end instructions explicitly ask for 24-hour answers.
- The same file builds off-grid hour choices from `00` through `23`, with a separate minute question from `00` through `59`.
- `adapters/jev.ts` sends the option map directly as `criteria` and verifies that the returned choice belongs to it. Consequently, changing labels alone would still expose 24-hour answer keys to the model.
- `services/session-classification.ts` schedules exact-time questions for `off_grid` answers and correlates the hour/minute responses.
- `services/session-extraction.ts` currently uses concrete choices directly and concatenates off-grid hour/minute choices before decoding `LocalTime`.

## Question contract

Change both concrete choice keys and their descriptions to 12-hour notation. Use canonical keys such as `12:00 AM`, `6:30 AM`, `12:00 PM`, and `6:30 PM`, with descriptions such as `Local clock time 6:30 PM`. Do not embed the equivalent 24-hour value in either field.

Retain all 192 concrete choices in chronological order from midnight through the last evening mark, followed by `off_grid`, `not_stated`, and `unclear`. Retain their existing meanings. Update start/end instructions to request the appropriate 12-hour choice with AM/PM. Retain the shared instruction: "Assume that rink_info gives times in 12-hour time, unless a 24-hour time is explicitly stated." Preserve the existing rules for interpreting source material, including explicitly stated 24-hour source times, Toronto local time, and additional-note precedence. Raw source HTML can still contain 24-hour times; normalizing source content is outside this change.

For exact-time follow-ups, use hour keys and descriptions identifying both hour and period: `12 AM`, `1 AM`, through `11 AM`, then `12 PM` through `11 PM`. Keep `unknown`, the existing two-digit minute choices, and the `_hour` / `_minute` question IDs. Explain that the hour answer includes AM/PM and that minutes must be preserved without rounding.

Bump `questionSetVersion` from `source-scrape-v2` to `source-scrape-v3` so diagnostics identify the new contract.

## Deterministic conversion

Add a small domain module, such as `domain/classifier-time.ts`, to own canonical time-choice generation and decoding. Generate choices and their conversion mappings from the same definitions so they cannot drift. Keep this domain logic outside the provider adapter.

Use an explicit mapping for the 24 combined hour choices to canonical hours. Standard choices resolve through a generated mapping to `HH:mm`; exact answers combine the mapped hour with a validated minute. Avoid locale-sensitive parsing, JavaScript `Date`, timezone conversion, or permissive parsing of arbitrary model text. Any helper taking multiple related strings should accept a named options object, following repository signature conventions.

| Classifier answer | Internal time |
| --- | --- |
| `12:00 AM` | `00:00` |
| `12:15 AM` | `00:15` |
| `6:30 AM` | `06:30` |
| `12:00 PM` | `12:00` |
| `12:15 PM` | `12:15` |
| `6:30 PM` | `18:30` |
| Exact hour `6 PM`, minute `07` | `18:07` |
| Exact hour `12 AM`, minute `07` | `00:07` |

Integrate decoding into `exactTime` in `services/session-extraction.ts` for both concrete and off-grid answers. Conversion happens after the classifier response is validated and before `LocalTime` validation, temporal comparisons, or session construction.

Preserve the distinction between unknown/missing answers and invalid concrete values. Existing sentinels produce missing times with existing uncertainty handling. Malformed concrete values must never become valid times through coercion; retain `invalid_time` diagnostics where applicable. The adapter continues rejecting choices that were not offered. Do not accept legacy 24-hour choices in the new question contract.

Conversion adds no confidence. For a concrete answer, retain its classifier confidence. For an off-grid answer, retain the minimum of the initial time answer, exact hour answer, and exact minute answer. Missing or unknown exact components continue to yield no usable time and the existing uncertainty behavior.

Keep canonical `HH:mm` session values and persistence inputs. End-day selection remains authoritative: `12 AM` means hour `00`, and does not itself advance the date. For example, a session starting at `11:30 PM` and ending at `12:15 AM` with `next_day` becomes `23:30` on the start date and `00:15` on the next date. The same times with `same_day` still trigger `end_before_start`.

## Implementation sequence

1. Introduce canonical 12-hour choices and deterministic mappings in the domain module.
2. Update regular and exact-time question builders, instructions, and the question-set version together.
3. Update session extraction to decode the new values before existing validation. Confirm the classification orchestration still correlates the two exact-time answers without needing another question.
4. Update fake classifier responses and fixtures to use the new answer keys while keeping expected session times in canonical `HH:mm`.
5. Add focused coverage below and run repository checks.

## Validation and acceptance

- Verify 192 unique concrete choices plus the three sentinels, chronological ordering, and conversion coverage for every generated choice. Check that neither concrete keys nor labels expose their 24-hour equivalents.
- Cover midnight, noon, morning, evening, off-grid minutes, unknown components, and malformed choices. Verify representative full session extraction, including an overnight session and same-day invalid ordering.
- Assert confidence propagation and missing/invalid-time diagnostics after conversion.
- Exercise the off-grid orchestration with a fake classifier returning the new combined hour choices. Confirm question IDs, question count, and session correlation remain correct.
- Run `pnpm test:backend`, `pnpm fmt`, `pnpm lint`, and `pnpm typecheck` during implementation; inspect formatter changes for unrelated edits.

Completion means every supported model time answer uses the new 12-hour contract and produces the expected canonical session time, with existing uncertainty and end-date behavior covered by tests. Database migrations, UI changes, historical data repair, and deployment are outside this implementation.
