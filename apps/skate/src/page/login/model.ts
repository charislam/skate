import { Schema } from "effect";
import { Field, NotValidated } from "foldkit/fieldValidation";
import { defineTaggedUnion } from "foldkit/schema";
import { Auth } from "../../domain/auth";

const EmailField = Field(Schema.String);
const PasswordField = Field(Schema.String);

export const Model = defineTaggedUnion({
  Editing: {
    email: EmailField,
    password: PasswordField,
  },
  Submitting: {
    email: EmailField,
    password: PasswordField,
  },
  Failed: {
    email: EmailField,
    password: PasswordField,
    kind: Auth.ErrorKind,
  },
});

export type Model = typeof Model.Type;

export const init = (): Model =>
  Model.Editing({
    email: NotValidated({ value: "" }),
    password: NotValidated({ value: "" }),
  });
