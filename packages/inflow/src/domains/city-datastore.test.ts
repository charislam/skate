import { it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { describe, expect } from "vitest";
import { CityDatastore } from "./city-datastore.js";
import { CityDatastoreDtos } from "./city-datastore-dtos.js";

const records = [{ id: "record-1" }, { id: "record-2" }, { id: "record-3" }];

describe("streamRecordOfShape", () => {
  it.layer(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request, url) => {
        const resourceId = url.searchParams.get("id");
        if (resourceId === "http-error") {
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, new Response("unavailable", { status: 503 })),
          );
        }

        const offset = Number(url.searchParams.get("offset"));
        const limit = Number(url.searchParams.get("limit"));
        const resourceRecords =
          resourceId === "empty-resource"
            ? []
            : resourceId === "invalid-record"
              ? [{ unexpected: true }]
              : records;
        const pageRecords = resourceRecords.slice(offset, offset + limit);
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify({ success: true, result: { records: pageRecords } }), {
              headers: { "content-type": "application/json" },
            }),
          ),
        );
      }),
    ),
  )("with a mock HTTP client", (it) => {
    it.effect("streams records across all pages", () =>
      Effect.gen(function* () {
        const result = yield* CityDatastore.streamRecordOfShape(
          Schema.decodeUnknownSync(CityDatastoreDtos.ResourceId)("test-resource"),
          Schema.Struct({ id: Schema.String }),
          { batchSize: 2 },
        ).pipe(Stream.runCollect);

        expect(result).toEqual(records);
      }),
    );

    it.effect("streams all records correctly when last page is full", () =>
      Effect.gen(function* () {
        const result = yield* CityDatastore.streamRecordOfShape(
          Schema.decodeUnknownSync(CityDatastoreDtos.ResourceId)("test-resource"),
          Schema.Struct({ id: Schema.String }),
          { batchSize: records.length },
        ).pipe(Stream.runCollect);

        expect(result).toEqual(records);
      }),
    );

    it.effect("completes when the first page is empty", () =>
      Effect.gen(function* () {
        const result = yield* CityDatastore.streamRecordOfShape(
          Schema.decodeUnknownSync(CityDatastoreDtos.ResourceId)("empty-resource"),
          Schema.Struct({ id: Schema.String }),
          { batchSize: 2 },
        ).pipe(Stream.runCollect);

        expect(result).toEqual([]);
      }),
    );

    it.effect("fails with a schema mismatch for invalid records", () =>
      Effect.gen(function* () {
        const result = yield* CityDatastore.streamRecordOfShape(
          Schema.decodeUnknownSync(CityDatastoreDtos.ResourceId)("invalid-record"),
          Schema.Struct({ id: Schema.String }),
          { batchSize: 2 },
        )
          .pipe(Stream.runCollect)
          .pipe(
            Effect.match({
              onFailure: (error) => ({ _tag: "Failure" as const, error }),
              onSuccess: (value) => ({ _tag: "Success" as const, value }),
            }),
          );

        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.error.code).toBe("schema_mismatch");
        }
      }),
    );

    it.effect("maps unsuccessful HTTP statuses to an external fetch error", () =>
      Effect.gen(function* () {
        const result = yield* CityDatastore.streamRecordOfShape(
          Schema.decodeUnknownSync(CityDatastoreDtos.ResourceId)("http-error"),
          Schema.Struct({ id: Schema.String }),
          { batchSize: 2 },
        )
          .pipe(Stream.runCollect)
          .pipe(
            Effect.match({
              onFailure: (error) => ({ _tag: "Failure" as const, error }),
              onSuccess: (value) => ({ _tag: "Success" as const, value }),
            }),
          );

        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.error.code).toBe("http_client");
        }
      }),
    );
  });
});
