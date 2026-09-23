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

export const fetchDatastoreMetadata: Effect.Effect<
  ReadonlyArray<CityDatastoreDtos.Resource>,
  ErrorsExternalFetch.Error,
  HttpClient.HttpClient
> = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const endpoint =
    CityDatastoreConstants.API_URL +
    "package_show?id=" +
    CityDatastoreConstants.PACKAGE_ID_OUTDOOR_RINK;

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
  S["Type"],
  ErrorsExternalFetch.Error,
  HttpClient.HttpClient | S["DecodingServices"]
> =>
  Stream.paginate(0, (offset) =>
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const limit = options?.batchSize ?? 1000;
      const endpoint =
        CityDatastoreConstants.API_URL +
        `datastore_search?id=${resourceId}&limit=${limit}&offset=${offset}`;

      const response = yield* httpClient.get(endpoint).pipe(Effect.mapError(mapHttpClientError));
      const successfulResponse = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.mapError(mapHttpClientError),
      );
      const page = yield* HttpClientResponse.schemaBodyJson(
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

      const nextOffset =
        page.result.records.length === limit ? Option.some(offset + limit) : Option.none();
      return [page.result.records, nextOffset] as const;
    }),
  );

export * as CityDatastore from "./city-datastore.js";
