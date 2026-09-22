import { Schema } from "effect";

export const Id = Schema.NonEmptyString.pipe(Schema.brand("RinkId"));

export const Struct = Schema.Struct({
  id: Id,
  name: Schema.NonEmptyString,
  url: Schema.OptionFromUndefinedOr(Schema.URL),
});

export type Struct = typeof Struct.Type;

export * as Rinks from "./rinks";
