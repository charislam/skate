import { Effect, Option, Schema, Stream } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";
import { CityDatastoreConstants } from "./city-datastore-constants.js";
import { CityDatastoreDtos } from "./city-datastore-dtos.js";
import { ErrorsExternalFetch } from "./errors-external-fetch.js";

const mapHttpClientError = (cause: HttpClientError.HttpClientError) =>
  new ErrorsExternalFetch.Error({
    code: ErrorsExternalFetch.ErrorCodes.HTTP_CLIENT,
    message: cause.message,
    cause,
  });

export type StreamRecordResult<A> =
  | { readonly _tag: "Record"; readonly record: A }
  | { readonly _tag: "Error"; readonly error: ErrorsExternalFetch.Error };

export const fetchDatastoreMetadata = (
  datastoreId: CityDatastoreConstants.DatastoreId,
): Effect.Effect<
  ReadonlyArray<CityDatastoreDtos.Resource>,
  ErrorsExternalFetch.Error,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const endpoint = CityDatastoreConstants.API_URL + "package_show?id=" + datastoreId;

    const response = yield* httpClient.get(endpoint).pipe(Effect.mapError(mapHttpClientError));
    const successfulResponse = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.mapError(mapHttpClientError),
    );
    const packageMetadata = yield* HttpClientResponse.schemaBodyJson(
      CityDatastoreDtos.PackageShowResponseSchema,
    )(successfulResponse).pipe(
      Effect.mapError((cause) =>
        cause instanceof Schema.SchemaError
          ? new ErrorsExternalFetch.Error({
              code: ErrorsExternalFetch.ErrorCodes.SCHEMA_MISMATCH,
              message: cause.message,
              cause,
            })
          : mapHttpClientError(cause),
      ),
    );

    return packageMetadata.result.resources;
  });

export const streamRecordOfShape = <S extends Schema.Schema<unknown>>(
  resourceId: CityDatastoreDtos.ResourceId,
  shape: S,
  options?: { batchSize?: number },
): Stream.Stream<
  StreamRecordResult<S["Type"]>,
  never,
  HttpClient.HttpClient | S["DecodingServices"]
> =>
  Stream.paginate(0, (offset) =>
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const limit = options?.batchSize ?? 1000;
      const endpoint =
        CityDatastoreConstants.API_URL +
        `datastore_search?id=${resourceId}&limit=${limit}&offset=${offset}`;

      const pageResult = yield* Effect.match(
        Effect.gen(function* () {
          const response = yield* httpClient
            .get(endpoint)
            .pipe(Effect.mapError(mapHttpClientError));
          const successfulResponse = yield* HttpClientResponse.filterStatusOk(response).pipe(
            Effect.mapError(mapHttpClientError),
          );
          return yield* HttpClientResponse.schemaBodyJson(
            Schema.Struct({
              success: Schema.Boolean,
              result: Schema.Struct({ records: Schema.Array(shape) }),
            }),
          )(successfulResponse).pipe(
            Effect.mapError((cause) =>
              cause instanceof Schema.SchemaError
                ? new ErrorsExternalFetch.Error({
                    code: ErrorsExternalFetch.ErrorCodes.SCHEMA_MISMATCH,
                    message: cause.message,
                    cause,
                  })
                : mapHttpClientError(cause),
            ),
          );
        }),
        {
          onFailure: (error) => ({ _tag: "Error" as const, error }),
          onSuccess: (page) => ({ _tag: "Page" as const, page }),
        },
      );

      if (pageResult._tag === "Error") {
        const events: ReadonlyArray<StreamRecordResult<S["Type"]>> = [pageResult];
        return [events, Option.none()] as const;
      }

      const records = pageResult.page.result.records;
      const nextOffset = records.length === limit ? Option.some(offset + limit) : Option.none();
      const events: ReadonlyArray<StreamRecordResult<S["Type"]>> = records.map((record) => ({
        _tag: "Record",
        record,
      }));
      return [events, nextOffset] as const;
    }),
  );

export const streamDatastoreRecordsOfShape = <S extends Schema.Schema<unknown>>(
  datastoreId: CityDatastoreConstants.DatastoreId,
  shape: S,
): Stream.Stream<
  StreamRecordResult<S["Type"]>,
  ErrorsExternalFetch.Error,
  HttpClient.HttpClient | S["DecodingServices"]
> =>
  Stream.unwrap(
    fetchDatastoreMetadata(datastoreId).pipe(
      Effect.map((resources) =>
        Stream.fromIterable(resources.filter((resource) => resource.datastore_active)).pipe(
          Stream.flatMap((resource) => streamRecordOfShape(resource.id, shape)),
        ),
      ),
    ),
  );

export * as CityDatastore from "./city-datastore.js";
