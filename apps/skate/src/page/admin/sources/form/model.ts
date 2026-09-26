import { Schema } from "effect";
import { Field } from "foldkit/fieldValidation";

export const SourceType = Schema.Literals(["web_scrape"]);
export type SourceType = typeof SourceType.Type;
export const sourceTypes = SourceType.literals;

export const Model = Schema.Struct({
  name: Field(Schema.String),
  type: Schema.Literals(["web_scrape"]),
  url: Field(Schema.String),
  notes: Field(Schema.String),
});

export * as AdminSourcesFormModel from "./model";
