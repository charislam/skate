import { Schema } from "effect";
import { AdminAccess } from "../../domain/admin-access";

export const Model = Schema.Struct({
  adminAccess: AdminAccess.schema,
  requestId: Schema.Number,
});
export type Model = typeof Model.Type;

export const init = (): Model => ({
  adminAccess: AdminAccess.Idle(),
  requestId: 0,
});
