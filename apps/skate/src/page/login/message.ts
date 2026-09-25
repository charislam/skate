import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { Auth } from "../../domain/auth";
import { Session } from "../../domain/session";

export const Message = defineMessageUnion({
  UpdatedEmail: { value: Schema.String },
  UpdatedPassword: { value: Schema.String },
  BlurredEmail: {},
  BlurredPassword: {},
  SubmittedForm: {},
  SucceededSignIn: { session: Session },
  FailedSignIn: { kind: Auth.ErrorKind },
});

export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  SucceededLogin: { session: Session },
});

export type OutMessage = typeof OutMessage.Type;
