import { Schema } from "effect";
import { AdminAccess } from "../../domain/admin-access";
import { Sources } from "../../domain/sources";

export const Model = Schema.Struct({
  adminAccess: AdminAccess.schema,
  activeSourceCount: Sources.ActiveSourceCount.schema,
  adminRequestId: Schema.Number,
  sourceRequestId: Schema.Number,
  isNavigationOpen: Schema.Boolean,
});
export type Model = typeof Model.Type;

export const init = (): Model => ({
  adminAccess: AdminAccess.Idle(),
  activeSourceCount: Sources.ActiveSourceCount.Idle(),
  adminRequestId: 0,
  sourceRequestId: 0,
  isNavigationOpen: false,
});
