import { Invalid, Rule, makeRules, validate } from "foldkit/fieldValidation";
import type { AdminSourcesFormModel } from "./model";

const nameRules = makeRules({
  required: "Name is required",
  rules: [Rule.minLength(3, "Name must be at least 3 characters long")],
});

export const validateName = validate(nameRules);

const urlRules = makeRules({
  rules: [
    Rule.url({
      message: "URL must be a valid URL",
    }),
  ],
});

export const validateUrl = (type: AdminSourcesFormModel.SourceType, url: string) => {
  if (type === "web_scrape" && !url) {
    return Invalid({
      value: url,
      errors: ["URL is required for web scrape sources"],
    });
  }

  const result = validate(urlRules)(url);
  return result;
};

export * as AdminFormSourcesValidation from "./validation";
