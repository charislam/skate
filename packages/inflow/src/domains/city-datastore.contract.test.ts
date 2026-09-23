import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect } from "vitest";
import { CityDatastore } from "./city-datastore.js";
import { CityDatastoreConstants } from "./city-datastore-constants.js";
import { CityRinkDtos } from "./city-rink-dtos.js";

describe("fetchDatastoreMetadata", () => {
  it.layer(FetchHttpClient.layer)("with the fetch HTTP client", (it) => {
    it.effect("fetches metadata from city datastore API", () =>
      Effect.gen(function* () {
        const resources = yield* CityDatastore.fetchDatastoreMetadata(
          CityDatastoreConstants.DATASTORE_ID_OUTDOOR_RINK,
        );
        expect(resources.length).toBeGreaterThan(0);
      }),
    );
  });
});

describe("streamDatastoreRecordsOfShape", () => {
  it.layer(FetchHttpClient.layer)("with the fetch HTTP client", (it) => {
    it.effect("streams records of a specific shape from city datastore API", () =>
      Effect.gen(function* () {
        const firstRecord = yield* CityDatastore.streamDatastoreRecordsOfShape(
          CityDatastoreConstants.DATASTORE_ID_OUTDOOR_RINK,
          CityRinkDtos.Schema,
        ).pipe(Stream.runHead);
        expect(firstRecord._tag).toBe("Some");
      }),
    );
  });
});
