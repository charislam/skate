import { Data } from "effect";

export const ErrorCodes = {
  HTTP_CLIENT: "http_client",
  SCHEMA_MISMATCH: "schema_mismatch",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class Error extends Data.TaggedError("@inflow/errors-external-fetch")<{
  code: ErrorCode;
  message: string;
  cause?: unknown;
}> {}

export * as ErrorsExternalFetch from "./errors-external-fetch.js";
