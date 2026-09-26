import { Schema } from "effect";
import { Match } from "effect";
import { AsyncData } from "foldkit";

export class PermissionError extends Schema.TaggedError<PermissionError>()("PermissionError", {
  message: Schema.String,
}) {}

export const AdminAccess = AsyncData.Schema(Schema.Boolean, PermissionError);
export type AdminAccess = typeof AdminAccess.schema.Type;

export const canAccessAdmin = (access: AdminAccess): boolean => {
  return Match.value(access).pipe(
    Match.when({ _tag: "Success" }, ({ data }) => data),
    Match.when({ _tag: "Refreshing" }, ({ data }) => data),
    Match.when({ _tag: "Stale" }, ({ data }) => data),
    Match.orElse(() => false),
  );
};
