import { Schema } from "effect";
import { Dialog } from "@foldkit/ui";
import { FieldValidation } from "foldkit";
import { Field } from "foldkit/fieldValidation";

export const SourceType = Schema.Literals(["web_scrape"]);
export type SourceType = typeof SourceType.Type;
export const sourceTypes = SourceType.literals;

export const Model = Schema.Struct({
  dialog: Dialog.Model,
  pendingRequestIds: Schema.Array(Schema.Number),
  nextRequestId: Schema.Number,
  name: Field(Schema.String),
  type: Schema.Literals(["web_scrape"]),
  url: Field(Schema.String),
  notes: Field(Schema.String),
});

export type Model = typeof Model.Type;
export const init = (): Model => ({
  dialog: Dialog.init({ id: "create-source" }),
  pendingRequestIds: [],
  nextRequestId: 1,
  name: FieldValidation.NotValidated({ value: "" }),
  type: "web_scrape",
  url: FieldValidation.NotValidated({ value: "" }),
  notes: FieldValidation.NotValidated({ value: "" }),
});

export * as AdminSourcesFormModel from "./model";
