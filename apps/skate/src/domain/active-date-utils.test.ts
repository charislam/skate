import { expect, it } from "vitest";
import { ActiveDateUtils } from "./active-date-utils";

it("gets the start of a day", () => {
  expect(ActiveDateUtils.getStartOfDay(new Date(2024, 4, 17, 13, 42, 9, 123))).toEqual(
    new Date(2024, 4, 17),
  );
});

it("gets Monday as the start of the week", () => {
  expect(ActiveDateUtils.getStartOfWeek(new Date(2024, 4, 19, 12))).toEqual(new Date(2024, 4, 13));
  expect(ActiveDateUtils.getStartOfWeek(new Date(2024, 4, 13, 12))).toEqual(new Date(2024, 4, 13));
  expect(ActiveDateUtils.getStartOfWeek(new Date(2024, 0, 1, 12))).toEqual(new Date(2024, 0, 1));
  expect(ActiveDateUtils.getStartOfWeek(new Date(2023, 0, 1, 12))).toEqual(new Date(2022, 11, 26));
});

it("gets the first day of the month", () => {
  expect(ActiveDateUtils.getStartOfMonth(new Date(2024, 4, 17, 13, 42))).toEqual(
    new Date(2024, 4, 1),
  );
  expect(ActiveDateUtils.getStartOfMonth(new Date(2024, 0, 31, 23, 59))).toEqual(
    new Date(2024, 0, 1),
  );
  expect(ActiveDateUtils.getStartOfMonth(new Date(2023, 11, 31))).toEqual(new Date(2023, 11, 1));
});

it("increments and decrements a day across month boundaries", () => {
  expect(ActiveDateUtils.incrementDay(new Date(2024, 0, 31))).toEqual(new Date(2024, 1, 1));
  expect(ActiveDateUtils.incrementDay(new Date(2024, 1, 28))).toEqual(new Date(2024, 1, 29));
  expect(ActiveDateUtils.incrementDay(new Date(2023, 11, 31))).toEqual(new Date(2024, 0, 1));
  expect(ActiveDateUtils.decrementDay(new Date(2024, 2, 1))).toEqual(new Date(2024, 1, 29));
  expect(ActiveDateUtils.decrementDay(new Date(2024, 0, 1))).toEqual(new Date(2023, 11, 31));
});

it("increments and decrements a week", () => {
  expect(ActiveDateUtils.incrementWeek(new Date(2024, 4, 13))).toEqual(new Date(2024, 4, 20));
  expect(ActiveDateUtils.decrementWeek(new Date(2024, 4, 13))).toEqual(new Date(2024, 4, 6));
  expect(ActiveDateUtils.incrementWeek(new Date(2023, 11, 25))).toEqual(new Date(2024, 0, 1));
  expect(ActiveDateUtils.decrementWeek(new Date(2024, 0, 1))).toEqual(new Date(2023, 11, 25));
});

it("increments and decrements a month", () => {
  expect(ActiveDateUtils.incrementMonth(new Date(2024, 0, 1))).toEqual(new Date(2024, 1, 1));
  expect(ActiveDateUtils.decrementMonth(new Date(2024, 0, 1))).toEqual(new Date(2023, 11, 1));
  expect(ActiveDateUtils.incrementMonth(new Date(2023, 11, 1))).toEqual(new Date(2024, 0, 1));
  expect(ActiveDateUtils.incrementMonth(new Date(2024, 0, 31))).toEqual(new Date(2024, 1, 29));
  expect(ActiveDateUtils.decrementMonth(new Date(2024, 2, 31))).toEqual(new Date(2024, 1, 29));
  expect(ActiveDateUtils.incrementMonth(new Date(2023, 0, 31))).toEqual(new Date(2023, 1, 28));
  expect(ActiveDateUtils.decrementMonth(new Date(2023, 2, 31))).toEqual(new Date(2023, 1, 28));
  expect(ActiveDateUtils.incrementMonth(new Date(2023, 11, 31))).toEqual(new Date(2024, 0, 31));
  expect(ActiveDateUtils.decrementMonth(new Date(2024, 0, 31))).toEqual(new Date(2023, 11, 31));
});
