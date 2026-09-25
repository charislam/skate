import { Schema } from "effect";
import { AsyncData } from "foldkit";

export class PermissionError extends Schema.TaggedError<PermissionError>()("PermissionError", {
  message: Schema.String,
}) {}

export const AdminAccess = AsyncData.Schema(Schema.Boolean, PermissionError);
export type AdminAccess = typeof AdminAccess.schema.Type;

export const canAccessAdmin = (access: AdminAccess): boolean =>
  access._tag === "Success" && access.data;
