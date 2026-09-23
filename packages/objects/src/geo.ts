import { Schema } from "effect";

export const Latitude = Schema.Finite.check(Schema.isBetween({ minimum: -90, maximum: 90 })).pipe(
  Schema.brand("@objects/geo/Latitude"),
);

export type Latitude = typeof Latitude.Type;

export const Longitude = Schema.Finite.check(
  Schema.isBetween({ minimum: -180, maximum: 180 }),
).pipe(Schema.brand("@objects/geo/Longitude"));

export type Longitude = typeof Longitude.Type;

export const Coordinates = Schema.Struct({
  latitude: Latitude,
  longitude: Longitude,
});

export type Coordinates = typeof Coordinates.Type;

export * as Geo from "./geo.js";
