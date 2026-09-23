import { Schema } from "effect";

export const ResourceId = Schema.String.pipe(Schema.brand("@inflow/city-datastore/ResourceId"));

export type ResourceId = typeof ResourceId.Type;

export const ResourceSchema = Schema.Struct({
  datastore_active: Schema.Boolean,
  id: ResourceId,
});

export type Resource = typeof ResourceSchema.Type;

export const PackageShowResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Struct({
    resources: Schema.Array(ResourceSchema),
  }),
});

export type PackageShowResponse = typeof PackageShowResponseSchema.Type;

export * as CityDatastoreDtos from "./city-datastore-dtos.js";
