import { describe, expect, test } from "vitest";
import { validateSearchText } from "./validation";

describe("search text validation", () => {
  test("allows empty and whitespace-only searches", () => {
    expect(validateSearchText("")).toEqual({ _tag: "NotValidated", value: "" });
    expect(validateSearchText("  ")).toEqual({ _tag: "NotValidated", value: "  " });
  });

  test("requires three letters or numbers", () => {
    expect(validateSearchText("ab")).toEqual({
      _tag: "Invalid",
      value: "ab",
      errors: ["Enter at least three letters or numbers to search names."],
    });
  });

  test("limits the trimmed search to 200 characters", () => {
    const value = `${"a".repeat(201)}   `;
    expect(validateSearchText(value)).toEqual({
      _tag: "Invalid",
      value,
      errors: ["Search names must be 200 characters or fewer."],
    });
  });

  test("accepts three Unicode letters or numbers", () => {
    expect(validateSearchText("猫犬鳥")).toEqual({ _tag: "Valid", value: "猫犬鳥" });
  });
});
