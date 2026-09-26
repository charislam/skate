import { FieldValidation } from "foldkit";

export const searchTextRules = FieldValidation.makeRules({
  isEmpty: (value: string) => value.trim() === "",
  rules: [
    [
      (value: string) => value.trim().length <= 200,
      "Search names must be 200 characters or fewer.",
    ],
    [
      (value: string) => (value.trim().match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3,
      "Enter at least three letters or numbers to search names.",
    ],
  ],
});

export const validateSearchText = FieldValidation.validate(searchTextRules);
