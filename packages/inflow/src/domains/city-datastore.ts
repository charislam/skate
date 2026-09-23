import { Effect } from "effect";
import { HttpClient, HttpClientError } from "effect/unstable/http";
import { CityDatastoreConstants } from "./city-datastore-constants.js";
import type { CityDatastoreDtos } from "./city-datastore-dtos.js";

export const fetchDatastoreMetadata: Effect.Effect<
  ReadonlyArray<CityDatastoreDtos.Resource>,
  HttpClientError.HttpClientError,
  HttpClient.HttpClient
> = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const endpoint =
    CityDatastoreConstants.API_URL +
    "package_show?id=" +
    CityDatastoreConstants.PACKAGE_ID_OUTDOOR_RINK;

  const response = yield* httpClient.get(endpoint);

  return undefined as unknown as CityDatastoreDtos.Resource[]; // Placeholder for actual implementation
});

export * as CityDatastore from "./city-datastore.js";
