import { Schema } from "effect";

export const Session = Schema.Struct({
  userId: Schema.String.pipe(Schema.brand("UserId")),
  email: Schema.Option(Schema.String),
});

export interface Session extends Schema.Schema.Type<typeof Session> {}

export const UserId = Session.fields.userId;
export type UserId = typeof UserId.Type;
