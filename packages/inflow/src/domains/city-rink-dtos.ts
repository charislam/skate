import { Schema as S, SchemaGetter } from "effect";
import { Rinks } from "@charismaticalli/skate-objects";

const IncomingGeometrySchema = S.Struct({
  type: S.Literal("Point"),
  coordinates: S.Tuple([S.Number, S.Number]),
});

const IncomingSchema = S.Struct({
  Address: S.NonEmptyString,
  "Asset ID": S.NonEmptyString,
  "Asset Name": S.NonEmptyString,
  geometry: S.fromJsonString(IncomingGeometrySchema),
});

export const Schema = IncomingSchema.pipe(
  S.decodeTo(Rinks.Struct, {
    decode: SchemaGetter.transform((incoming) => ({
      id: Rinks.makeId("CITY_OF_TORONTO", incoming["Asset ID"]),
      name: incoming["Asset Name"],
      address: incoming.Address,
      location: {
        latitude: incoming.geometry.coordinates[1],
        longitude: incoming.geometry.coordinates[0],
      },
    })),
    encode: SchemaGetter.transform((rink) => ({
      Address: rink.address,
      "Asset ID": rink.id.slice(Rinks.ID_PREFIX.CITY_OF_TORONTO.length),
      "Asset Name": rink.name,
      geometry: {
        type: "Point" as const,
        coordinates: [rink.location.longitude, rink.location.latitude] as [number, number],
      },
    })),
  }),
);

export * as CityRinkDtos from "./city-rink-dtos.js";
