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

        expect(result).toEqual(records.map((record) => ({ _tag: "Record", record })));
      }),
    );

    it.effect("streams all records correctly when last page is full", () =>
      Effect.gen(function* () {
        const result = yield* CityDatastore.streamRecordOfShape(
          Schema.decodeUnknownSync(CityDatastoreDtos.ResourceId)("test-resource"),
          Schema.Struct({ id: Schema.String }),
          { batchSize: records.length },
        ).pipe(Stream.runCollect);

        expect(result).toEqual(records.map((record) => ({ _tag: "Record", record })));
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

    it.effect("emits a schema mismatch and stops for invalid records", () =>
      Effect.gen(function* () {
        const result = yield* CityDatastore.streamRecordOfShape(
          Schema.decodeUnknownSync(CityDatastoreDtos.ResourceId)("invalid-record"),
          Schema.Struct({ id: Schema.String }),
          { batchSize: 2 },
        ).pipe(Stream.runCollect);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          _tag: "Error",
          error: { code: "schema_mismatch" },
        });
      }),
    );

    it.effect("emits an HTTP error and stops after an unsuccessful status", () =>
      Effect.gen(function* () {
        const result = yield* CityDatastore.streamRecordOfShape(
          Schema.decodeUnknownSync(CityDatastoreDtos.ResourceId)("http-error"),
          Schema.Struct({ id: Schema.String }),
          { batchSize: 2 },
        ).pipe(Stream.runCollect);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          _tag: "Error",
          error: { code: "http_client" },
        });
      }),
    );
  });
});
