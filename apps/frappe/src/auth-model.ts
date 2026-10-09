import { Schema } from "effect";

export interface User {
  readonly email: string;
}

export interface Credentials {
  readonly email: string;
}

export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  message: Schema.String,
}) {}
