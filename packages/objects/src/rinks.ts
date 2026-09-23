import { Schema } from "effect";
import { Geo } from "./geo.js";

const ID_BRAND = "@objects/rinks/RinkId";

export const ID_PREFIX = {
  CITY_OF_TORONTO: "tor_",
};

export type IdPrefix = keyof typeof ID_PREFIX;

const idPrefixPattern = new RegExp(`^(?:${Object.values(ID_PREFIX).join("|")})`);

export const Id = Schema.String.pipe(
  Schema.check(Schema.isPattern(idPrefixPattern)),
  Schema.brand(ID_BRAND),
);

export type Id = typeof Id.Type;

export const makeId = (source: IdPrefix, id: string): Id => {
  return Id.make(ID_PREFIX[source] + id);
};

export const Struct = Schema.Struct({
  id: Id,
  name: Schema.NonEmptyString,
  address: Schema.NonEmptyString,
  location: Geo.Coordinates,
});

export type Struct = typeof Struct.Type;

export * as Rinks from "./rinks.js";
