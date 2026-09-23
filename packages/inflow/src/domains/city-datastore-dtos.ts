import { Schema } from "effect";

export const ResourceId = Schema.String.pipe(Schema.brand("@inflow/city-datastore/ResourceId"));

export const ResourceSchema = Schema.Struct({
  datastore_active: Schema.Boolean,
  id: ResourceId,
});

export type Resource = typeof ResourceSchema.Type;

export * as CityDatastoreDtos from "./city-datastore-dtos.js";
